import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

export function resourceRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);
    const resources = await sql`SELECT * FROM resources WHERE case_id = ${caseId} ORDER BY name`;
    return c.json(resources);
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
      type: 'Resource.Create',
      tenant_id: caseRow.organization_id as string,
      case_id: caseId,
      actor_id: user.user_id,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    const [resource] = await sql`SELECT * FROM resources WHERE id = ${result.data?.id as string}`;
    return c.json(resource, 201);
  });

  return app;
}
