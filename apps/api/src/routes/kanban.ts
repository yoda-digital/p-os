import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';
import { getKanban } from '../services/projection-service.js';

type Sql = ReturnType<typeof postgres>;

// Map column transitions to semantic commands
const TRANSITION_MAP: Record<string, { command: string; extras?: Record<string, unknown> }> = {
  'BACKLOG->READY': { command: 'Move.RequestReadiness' },
  'READY->ACTIVE': { command: 'Move.Activate' },
  'BACKLOG->ACTIVE': { command: 'Move.Activate' },
  'ACTIVE->WAITING': { command: 'Move.Pause', extras: { reason: 'waiting' } },
  'ACTIVE->NEEDS_INPUT': { command: 'Move.Pause', extras: { reason: 'needs_input' } },
  'ACTIVE->VERIFY': { command: 'Move.RequestSatisfaction' },
  'RUNNING->VERIFY': { command: 'Move.RequestSatisfaction' },
  'VERIFY->DONE': { command: 'Move.RequestSatisfaction' },
  'VERIFY->ACTIVE': { command: 'Move.Resume' },
  'WAITING->ACTIVE': { command: 'Move.Resume' },
  'NEEDS_INPUT->ACTIVE': { command: 'Move.Resume' },
  'ACTIVE->BACKLOG': { command: 'Move.Pause' },
  'READY->BACKLOG': { command: 'Move.Pause' },
  'WAITING->BACKLOG': { command: 'Move.Pause' },
};

export function kanbanRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);

  app.use('*', authMiddleware);

  // GET /:caseId — get kanban projection
  app.get('/:caseId', async (c) => {
    const caseId = c.req.param('caseId');
    const columns = await getKanban(sql, caseId);
    return c.json({ columns });
  });

  // POST /move-card — move card between columns
  app.post('/move-card', async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{
      move_id: string;
      from_column: string;
      to_column: string;
      position?: number;
    }>();

    const { move_id, from_column, to_column, position } = body;

    if (from_column === to_column) {
      // Just reorder within column
      if (position != null) {
        await sql`
          UPDATE projection_kanban SET position = ${position}, updated_at = NOW()
          WHERE move_id = ${move_id}
        `;
      }
      return c.json({ status: 'reordered' });
    }

    // Look up the semantic command for this transition
    const transitionKey = `${from_column}->${to_column}`;
    const transition = TRANSITION_MAP[transitionKey];

    if (!transition) {
      return c.json({
        error: `Invalid transition: ${from_column} → ${to_column}`,
        valid_transitions: Object.keys(TRANSITION_MAP),
      }, 400);
    }

    // Get move info
    const [move] = await sql`SELECT case_id FROM moves WHERE id = ${move_id}`;
    if (!move) return c.json({ error: 'Move not found' }, 404);

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${move.case_id}`;

    // Special handling for VERIFY->DONE: check completion
    if (to_column === 'DONE') {
      const [moveDetail] = await sql`SELECT completion_contract, verification FROM moves WHERE id = ${move_id}`;
      // For now, allow it. Full completion engine would check evidence here.

      const result = await processor.process({
        command_id: crypto.randomUUID(),
        type: 'Move.RequestSatisfaction',
        tenant_id: caseRow?.organization_id as string,
        case_id: move.case_id as string,
        actor_id: user.user_id,
        target_ref: { id: move_id, type: 'move' },
        issued_at: new Date().toISOString(),
        payload: { id: move_id },
      });

      if (result.status === 'accepted') {
        // Mark as satisfied
        await sql`UPDATE moves SET execution = 'finished', outcome = 'satisfied', verification = 'passed', revision = revision + 1 WHERE id = ${move_id}`;
        await sql`UPDATE projection_kanban SET column_id = 'DONE', position = ${position ?? 0}, updated_at = NOW() WHERE move_id = ${move_id}`;
        await sql`
          UPDATE projection_case_summary SET
            completed_moves = (SELECT count(*) FROM moves WHERE case_id = ${move.case_id} AND outcome = 'satisfied'),
            active_moves = (SELECT count(*) FROM moves WHERE case_id = ${move.case_id} AND execution = 'running'),
            last_activity_at = NOW(), updated_at = NOW()
          WHERE case_id = ${move.case_id}
        `;
      }

      return c.json({ status: result.status, reason: result.reason });
    }

    // Execute the semantic command
    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: transition.command,
      tenant_id: caseRow?.organization_id as string,
      case_id: move.case_id as string,
      actor_id: user.user_id,
      target_ref: { id: move_id, type: 'move' },
      issued_at: new Date().toISOString(),
      payload: { id: move_id, ...(transition.extras ?? {}) },
    });

    if (result.status !== 'accepted') {
      return c.json({ error: result.reason, status: result.status }, 400);
    }

    // Update position if specified
    if (position != null) {
      await sql`
        UPDATE projection_kanban SET position = ${position}, updated_at = NOW()
        WHERE move_id = ${move_id}
      `;
    }

    return c.json({ status: 'accepted', transition: transitionKey });
  });

  return app;
}
