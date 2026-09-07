import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

export function moveRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);

  app.use('*', authMiddleware);

  // GET / — list moves for case
  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId is required' }, 400);

    const moves = await sql`
      SELECT m.*,
        (SELECT count(*) FROM attempts a WHERE a.move_id = m.id) AS attempt_count,
        (SELECT count(*) FROM attempts a WHERE a.move_id = m.id AND a.state = 'running') AS active_attempts,
        (SELECT count(*) FROM evidence e WHERE e.case_id = m.case_id) AS evidence_count
      FROM moves m
      WHERE m.case_id = ${caseId}
      ORDER BY m.created_at ASC
    `;
    return c.json(moves);
  });

  // POST / — create move
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json();
    const caseId = body.case_id;
    if (!caseId) return c.json({ error: 'case_id is required' }, 400);

    // Get tenant_id from case
    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${caseId}`;
    if (!caseRow) return c.json({ error: 'Case not found' }, 404);

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Move.Create',
      tenant_id: caseRow.organization_id as string,
      case_id: caseId,
      actor_id: user.user_id,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') {
      return c.json({ error: result.reason }, 400);
    }

    const [move] = await sql`SELECT * FROM moves WHERE id = ${result.data?.id as string}`;
    return c.json(move, 201);
  });

  // GET /:id — get move detail
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const [move] = await sql`SELECT * FROM moves WHERE id = ${id}`;
    if (!move) return c.json({ error: 'Move not found' }, 404);

    const attempts = await sql`SELECT * FROM attempts WHERE move_id = ${id} ORDER BY created_at DESC`;
    const evidence = await sql`
      SELECT * FROM evidence WHERE case_id = ${move.case_id}
      AND subject_refs @> ${sql.json([{ id }])}::jsonb
    `.catch(() => []);
    const steering = await sql`SELECT * FROM steering_commands WHERE move_id = ${id} ORDER BY issued_at DESC`;

    return c.json({
      ...move,
      state_vector: {
        readiness: move.readiness,
        execution: move.execution,
        verification: move.verification,
        attention: move.attention,
        risk: move.risk_level,
        temporal: move.temporal,
        outcome: move.outcome,
      },
      attempts,
      evidence,
      steering,
    });
  });

  // PATCH /:id — edit move
  app.patch('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json();

    const [move] = await sql`SELECT case_id FROM moves WHERE id = ${id}`;
    if (!move) return c.json({ error: 'Move not found' }, 404);

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${move.case_id}`;

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Move.Edit',
      tenant_id: caseRow?.organization_id as string,
      case_id: move.case_id as string,
      actor_id: user.user_id,
      target_ref: { id, type: 'move' },
      expected_revision: body.expected_revision,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') {
      return c.json({ error: result.reason }, result.status === 'conflict' ? 409 : 400);
    }

    const [updated] = await sql`SELECT * FROM moves WHERE id = ${id}`;
    return c.json(updated);
  });

  // Helper to run move lifecycle commands
  async function lifecycleAction(c: any, type: string, extra: Record<string, unknown> = {}) {
    const user = getUser(c);
    const id = c.req.param('id');

    const [move] = await sql`SELECT case_id FROM moves WHERE id = ${id}`;
    if (!move) return c.json({ error: 'Move not found' }, 404);

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${move.case_id}`;

    let body: Record<string, unknown> = {};
    try { body = await c.req.json(); } catch { /* no body is fine */ }

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type,
      tenant_id: caseRow?.organization_id as string,
      case_id: move.case_id as string,
      actor_id: user.user_id,
      target_ref: { id, type: 'move' },
      issued_at: new Date().toISOString(),
      payload: { id, ...body, ...extra },
    });

    if (result.status !== 'accepted') {
      return c.json({ error: result.reason }, result.status === 'conflict' ? 409 : 400);
    }

    const [updated] = await sql`SELECT * FROM moves WHERE id = ${id}`;
    return c.json(updated);
  }

  app.post('/:id/activate', (c) => lifecycleAction(c, 'Move.Activate'));
  app.post('/:id/pause', (c) => lifecycleAction(c, 'Move.Pause'));
  app.post('/:id/resume', (c) => lifecycleAction(c, 'Move.Resume'));
  app.post('/:id/cancel', (c) => lifecycleAction(c, 'Move.Cancel'));
  app.post('/:id/satisfy', (c) => lifecycleAction(c, 'Move.RequestSatisfaction'));

  return app;
}
