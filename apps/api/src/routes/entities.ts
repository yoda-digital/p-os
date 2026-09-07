import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

export function entityRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);
    const entities = await sql`SELECT * FROM entities WHERE case_id = ${caseId} ORDER BY created_at`;
    return c.json(entities);
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
      type: 'Entity.Create',
      tenant_id: caseRow.organization_id as string,
      case_id: caseId,
      actor_id: user.user_id,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    const [entity] = await sql`SELECT * FROM entities WHERE id = ${result.data?.id as string}`;
    return c.json(entity, 201);
  });

  app.patch('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json();

    const [entity] = await sql`SELECT case_id FROM entities WHERE id = ${id}`;
    if (!entity) return c.json({ error: 'Entity not found' }, 404);
    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${entity.case_id}`;

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Entity.Update',
      tenant_id: caseRow?.organization_id as string,
      case_id: entity.case_id as string,
      actor_id: user.user_id,
      target_ref: { id, type: 'entity' },
      expected_revision: body.expected_revision,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    const [updated] = await sql`SELECT * FROM entities WHERE id = ${id}`;
    return c.json(updated);
  });

  return app;
}
