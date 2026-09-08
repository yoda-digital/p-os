import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';
import {
  STEERING_CLASSES,
  isSteeringClass,
  getSteeringForAttempt,
  getSteeringForMove,
  updateSteeringStateTransactional,
  InvalidSteeringTransitionError,
  SteeringNotFoundError,
} from '../services/steering-service.js';

type Sql = ReturnType<typeof postgres>;

/**
 * Steering delivery pipeline (spec §1.1):
 *
 *   Browser → POST /api/v1/steering → steering_commands (state=issued) → Edge WSS push
 *   → plugin pending_steering SQLite → PreToolUse/Stop hook → additionalContext → Claude
 *
 * This route creates the steering command and emits `SteeringIssued`. Delivery to a
 * connected device (state → `delivered_to_edge`) happens asynchronously in
 * apps/realtime/src/edge.ts, which polls for `issued` steering and pushes it over the
 * device's WebSocket. The plugin acknowledges delivery via `POST /:id/ack` (used by its
 * `process.steering.ack` MCP tool) once Claude has acted on the instruction.
 */
export function steeringRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  app.use('*', authMiddleware);

  // POST / — issue a steering command
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { case_id, move_id, attempt_id, class: steeringClass, instruction } = body as Record<string, unknown>;

    if (!case_id || !move_id || !steeringClass || !instruction) {
      return c.json({ error: 'case_id, move_id, class, and instruction are required' }, 400);
    }
    if (!isSteeringClass(steeringClass)) {
      return c.json({ error: `class must be one of: ${STEERING_CLASSES.join(', ')}` }, 400);
    }
    if (typeof instruction !== 'string' || !instruction.trim()) {
      return c.json({ error: 'instruction must be a non-empty string' }, 400);
    }

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${case_id as string}`;
    if (!caseRow) return c.json({ error: 'Case not found' }, 404);

    const [moveRow] = await sql`
      SELECT id FROM moves WHERE id = ${move_id as string} AND case_id = ${case_id as string}
    `;
    if (!moveRow) return c.json({ error: 'Move not found in this case' }, 404);

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Attempt.Steer',
      tenant_id: caseRow.organization_id as string,
      case_id: case_id as string,
      actor_id: user.user_id,
      target_ref: {
        id: (attempt_id as string) || (move_id as string),
        type: attempt_id ? 'attempt' : 'move',
      },
      issued_at: new Date().toISOString(),
      payload: { move_id, attempt_id: attempt_id || null, class: steeringClass, instruction },
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    return c.json(
      {
        status: 'accepted',
        steering_id: result.data?.['steering_id'],
        state: result.data?.['state'] ?? 'issued',
      },
      201
    );
  });

  // POST /:id/ack — acknowledge delivery (called by the plugin's process.steering.ack MCP tool
  // once Claude has received the steering via additionalContext and acted on it).
  app.post('/:id/ack', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');

    const [owner] = await sql`
      SELECT c.organization_id
      FROM steering_commands sc
      JOIN cases c ON c.id = sc.case_id
      WHERE sc.id = ${id}
    `;
    if (!owner) return c.json({ error: 'Steering command not found' }, 404);
    if (!user.is_system && owner.organization_id !== user.organization_id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    try {
      const updated = await updateSteeringStateTransactional(sql, id, 'acknowledged', {
        actorId: user.user_id,
      });

      // Create an instruction version when steering is acknowledged (spec §1.4)
      // Never rewrite prior instructions — each steering creates a new version.
      await createInstructionVersion(sql, id);

      return c.json(updated);
    } catch (err) {
      if (err instanceof SteeringNotFoundError) return c.json({ error: err.message }, 404);
      if (err instanceof InvalidSteeringTransitionError) return c.json({ error: err.message }, 409);
      throw err;
    }
  });

  // GET /versions/:attemptId — instruction version history for an attempt
  app.get('/versions/:attemptId', async (c) => {
    const attemptId = c.req.param('attemptId');
    const versions = await sql`
      SELECT * FROM attempt_instruction_versions
      WHERE attempt_id = ${attemptId}
      ORDER BY version ASC
    `;
    return c.json(versions);
  });

  // GET / — steering history for an attempt or a move
  app.get('/', async (c) => {
    const attemptId = c.req.query('attemptId');
    const moveId = c.req.query('moveId');

    if (attemptId) return c.json(await getSteeringForAttempt(sql, attemptId));
    if (moveId) return c.json(await getSteeringForMove(sql, moveId));

    return c.json({ error: 'attemptId or moveId required' }, 400);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Instruction versioning (spec §1.4)
// ---------------------------------------------------------------------------

/**
 * Create a new instruction version when steering is acknowledged. Each
 * steering creates a new version — we never rewrite prior instructions.
 *
 * E.g.:
 *   Attempt #1 Instructions v1: "Implement auth module"
 *   Attempt #1 Instructions v2: "Implement auth module. CONSTRAINT: Do not modify public API."
 */
async function createInstructionVersion(sql: Sql, steeringId: string): Promise<void> {
  const [sc] = await sql`
    SELECT sc.id, sc.attempt_id, sc.move_id, sc.instruction, sc.class,
           m.objective
    FROM steering_commands sc
    JOIN moves m ON m.id = sc.move_id
    WHERE sc.id = ${steeringId}
  `;
  if (!sc || !sc.attempt_id) return;

  const attemptId = sc.attempt_id as string;

  // Get the current highest version
  const [maxRow] = await sql`
    SELECT COALESCE(MAX(version), 0)::int AS max_version
    FROM attempt_instruction_versions
    WHERE attempt_id = ${attemptId}
  `;
  const nextVersion = (maxRow?.max_version ?? 0) + 1;

  // Build the new instruction text: base objective + all applied steering
  const appliedSteering = await sql`
    SELECT class, instruction FROM steering_commands
    WHERE attempt_id = ${attemptId}
      AND state IN ('acknowledged', 'applied')
    ORDER BY issued_at ASC
  `;

  const parts: string[] = [];
  if (sc.objective) parts.push(sc.objective as string);

  for (const s of appliedSteering) {
    const prefix = s.class === 'constraint' ? 'CONSTRAINT' : s.class === 'redirect' ? 'REDIRECT' : 'STEERING';
    parts.push(`${prefix}: ${s.instruction}`);
  }

  const fullInstructions = parts.join('. ');

  await sql`
    INSERT INTO attempt_instruction_versions (id, attempt_id, version, instructions, steering_id, created_at)
    VALUES (${crypto.randomUUID()}, ${attemptId}, ${nextVersion}, ${fullInstructions}, ${steeringId}, NOW())
  `;
}
