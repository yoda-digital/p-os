import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

export function decisionRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);
    const decisions = await sql`SELECT * FROM decisions WHERE case_id = ${caseId} ORDER BY created_at DESC`;
    return c.json(decisions);
  });

  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json();
    const caseId = body.case_id;
    if (!caseId) return c.json({ error: 'case_id required' }, 400);

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${caseId}`;
    if (!caseRow) return c.json({ error: 'Case not found' }, 404);

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Decision.Create',
      tenant_id: caseRow.organization_id as string,
      case_id: caseId,
      actor_id: user.user_id,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    const [decision] = await sql`SELECT * FROM decisions WHERE id = ${result.data?.id as string}`;
    return c.json(decision, 201);
  });

  app.post('/:id/resolve', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json();

    const [decision] = await sql`SELECT case_id FROM decisions WHERE id = ${id}`;
    if (!decision) return c.json({ error: 'Decision not found' }, 404);

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${decision.case_id}`;

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Decision.Resolve',
      tenant_id: caseRow?.organization_id as string,
      case_id: decision.case_id as string,
      actor_id: user.user_id,
      target_ref: { id, type: 'decision' },
      issued_at: new Date().toISOString(),
      payload: { id, selected_option: body.selected_option, rationale: body.rationale },
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    const [updated] = await sql`SELECT * FROM decisions WHERE id = ${id}`;
    return c.json(updated);
  });

  return app;
}
