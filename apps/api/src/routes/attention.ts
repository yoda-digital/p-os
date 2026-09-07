import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';
import { getAttentionQueue } from '../services/projection-service.js';

type Sql = ReturnType<typeof postgres>;

export function attentionRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);
    const items = await getAttentionQueue(sql, caseId);
    return c.json(items);
  });

  app.post('/:id/resolve', async (c) => {
    const id = c.req.param('id');
    await sql`UPDATE projection_attention SET resolved = true, resolved_at = NOW() WHERE id = ${id}`;
    return c.json({ status: 'resolved' });
  });

  return app;
}
