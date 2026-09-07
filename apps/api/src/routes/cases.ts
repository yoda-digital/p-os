import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';
import { getCaseSummary } from '../services/projection-service.js';

type Sql = ReturnType<typeof postgres>;

export function caseRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);

  app.use('*', authMiddleware);

  // GET / — list cases for user's org
  app.get('/', async (c) => {
    const user = getUser(c);
    const lifecycle = c.req.query('lifecycle');

    let cases;
    if (lifecycle) {
      cases = await sql`
        SELECT c.*, cs.total_moves, cs.active_moves, cs.completed_moves, cs.pending_decisions, cs.last_activity_at
        FROM cases c
        LEFT JOIN projection_case_summary cs ON cs.case_id = c.id
        WHERE c.organization_id = ${user.organization_id} AND c.lifecycle = ${lifecycle}
        ORDER BY c.created_at DESC
      `;
    } else {
      cases = await sql`
        SELECT c.*, cs.total_moves, cs.active_moves, cs.completed_moves, cs.pending_decisions, cs.last_activity_at
        FROM cases c
        LEFT JOIN projection_case_summary cs ON cs.case_id = c.id
        WHERE c.organization_id = ${user.organization_id}
        ORDER BY c.created_at DESC
      `;
    }

    return c.json(cases);
  });

  // POST / — create case
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json();

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Case.Create',
      tenant_id: user.organization_id,
      actor_id: user.user_id,
      issued_at: new Date().toISOString(),
      payload: {
        ...body,
        workspace_id: body.workspace_id ?? null,
      },
    });

    if (result.status !== 'accepted') {
      return c.json({ error: result.reason }, result.status === 'conflict' ? 409 : 400);
    }

    // If initial intent provided, create it
    if (body.initial_intent) {
      const caseId = result.data?.id as string;
      await processor.process({
        command_id: crypto.randomUUID(),
        type: 'Intent.Create',
        tenant_id: user.organization_id,
        case_id: caseId,
        actor_id: user.user_id,
        issued_at: new Date().toISOString(),
        payload: {
          class: 'ACHIEVE',
          statement: body.initial_intent,
          priority: 'high',
        },
      });
    }

    const caseData = await sql`SELECT * FROM cases WHERE id = ${result.data?.id as string}`;
    return c.json(caseData[0], 201);
  });

  // GET /:id — get case detail
  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const [caseRow] = await sql`SELECT * FROM cases WHERE id = ${id}`;
    if (!caseRow) return c.json({ error: 'Case not found' }, 404);

    const summary = await getCaseSummary(sql, id);
    const intents = await sql`SELECT * FROM intents WHERE case_id = ${id} AND status = 'active'`;

    return c.json({ ...caseRow, summary, intents });
  });

  // PATCH /:id — update case
  app.patch('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json();

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Case.Update',
      tenant_id: user.organization_id,
      case_id: id,
      actor_id: user.user_id,
      target_ref: { id, type: 'case' },
      expected_revision: body.expected_revision,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') {
      return c.json({ error: result.reason }, result.status === 'conflict' ? 409 : 400);
    }

    const [updated] = await sql`SELECT * FROM cases WHERE id = ${id}`;
    return c.json(updated);
  });

  // POST /:id/close
  app.post('/:id/close', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Case.Close',
      tenant_id: user.organization_id,
      case_id: id,
      actor_id: user.user_id,
      target_ref: { id, type: 'case' },
      issued_at: new Date().toISOString(),
      payload: { id },
    });

    if (result.status !== 'accepted') {
      return c.json({ error: result.reason }, 400);
    }
    return c.json({ status: 'closed' });
  });

  // POST /:id/reopen
  app.post('/:id/reopen', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Case.Reopen',
      tenant_id: user.organization_id,
      case_id: id,
      actor_id: user.user_id,
      target_ref: { id, type: 'case' },
      issued_at: new Date().toISOString(),
      payload: { id },
    });

    if (result.status !== 'accepted') {
      return c.json({ error: result.reason }, 400);
    }
    return c.json({ status: 'reopened' });
  });

  return app;
}
