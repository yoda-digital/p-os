import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

export function evidenceRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);
    const evidence = await sql`SELECT * FROM evidence WHERE case_id = ${caseId} ORDER BY created_at DESC`;
    return c.json(evidence);
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
      type: 'Evidence.Attach',
      tenant_id: caseRow.organization_id as string,
      case_id: caseId,
      actor_id: user.user_id,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    const [ev] = await sql`SELECT * FROM evidence WHERE id = ${result.data?.id as string}`;
    return c.json(ev, 201);
  });

  app.post('/:id/invalidate', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const [ev] = await sql`SELECT case_id FROM evidence WHERE id = ${id}`;
    if (!ev) return c.json({ error: 'Evidence not found' }, 404);

    const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${ev.case_id}`;

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Evidence.Invalidate',
      tenant_id: caseRow?.organization_id as string,
      case_id: ev.case_id as string,
      actor_id: user.user_id,
      target_ref: { id, type: 'evidence' },
      issued_at: new Date().toISOString(),
      payload: { id, reason: (body as Record<string, unknown>).reason ?? 'Manually invalidated' },
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    return c.json({ status: 'invalidated' });
  });

  return app;
}
