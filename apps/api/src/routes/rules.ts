import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

export function ruleRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);
    const rules = await sql`SELECT * FROM rules WHERE case_id = ${caseId} ORDER BY type, created_at`;
    return c.json(rules);
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
      type: 'Rule.Create',
      tenant_id: caseRow.organization_id as string,
      case_id: caseId,
      actor_id: user.user_id,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    const [rule] = await sql`SELECT * FROM rules WHERE id = ${result.data?.id as string}`;
    return c.json(rule, 201);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const [rule] = await sql`SELECT * FROM rules WHERE id = ${id}`;
    if (!rule) return c.json({ error: 'Rule not found' }, 404);
    return c.json(rule);
  });

  return app;
}
