import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';
import { universalSearch, graphSearch } from '../services/search.js';

type Sql = ReturnType<typeof postgres>;

export function searchRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  // GET / — universal search across all entities
  app.get('/', async (c) => {
    const q = c.req.query('q');
    const type = c.req.query('type');
    const caseId = c.req.query('caseId');
    const lifecycle = c.req.query('lifecycle');
    const priority = c.req.query('priority');
    const actorId = c.req.query('actorId');
    const dateFrom = c.req.query('dateFrom');
    const dateTo = c.req.query('dateTo');
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;
    const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!, 10) : undefined;

    if (!q && !type && !caseId) {
      return c.json({ error: 'At least one of q, type, or caseId is required' }, 400);
    }

    try {
      const response = await universalSearch(sql, {
        q, type, caseId, lifecycle, priority, actorId, dateFrom, dateTo, limit, offset,
      });
      return c.json(response);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Search failed' }, 500);
    }
  });

  // GET /graph — graph traversal from a source entity
  app.get('/graph', async (c) => {
    const sourceId = c.req.query('sourceId');
    const maxDepth = c.req.query('maxDepth') ? parseInt(c.req.query('maxDepth')!, 10) : 3;

    if (!sourceId) {
      return c.json({ error: 'sourceId is required' }, 400);
    }

    try {
      const results = await graphSearch(sql, sourceId, maxDepth);
      return c.json({ source_id: sourceId, max_depth: maxDepth, results });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Graph search failed' }, 500);
    }
  });

  return app;
}
