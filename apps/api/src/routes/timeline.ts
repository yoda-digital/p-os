import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';
import { getTimeline } from '../services/projection-service.js';

type Sql = ReturnType<typeof postgres>;

export function timelineRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);

    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    const type = c.req.query('type');

    let timeline = await getTimeline(sql, caseId, { limit, offset });

    if (type) {
      timeline = timeline.filter((e: Record<string, unknown>) => e.type === type);
    }

    return c.json(timeline);
  });

  return app;
}
