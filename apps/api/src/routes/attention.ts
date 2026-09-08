import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';
import { computeAttention } from '../services/attention-engine.js';
import { getAttentionQueue } from '../services/projection-service.js';

type Sql = ReturnType<typeof postgres>;

export function attentionRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  // GET / — returns computed attention items with priority scores
  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);

    const mode = c.req.query('mode'); // 'computed' (default) or 'raw'

    if (mode === 'raw') {
      const items = await getAttentionQueue(sql, caseId);
      return c.json(items);
    }

    const computed = await computeAttention(sql, caseId);
    return c.json(computed);
  });

  app.post('/:id/resolve', async (c) => {
    const id = c.req.param('id');
    await sql`UPDATE projection_attention SET resolved = true, resolved_at = NOW() WHERE id = ${id}`;
    return c.json({ status: 'resolved' });
  });

  return app;
}
