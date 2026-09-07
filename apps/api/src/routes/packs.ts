import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';

type Sql = ReturnType<typeof postgres>;

export function packRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const packs = await sql`SELECT * FROM process_packs ORDER BY domain, name`;
    return c.json(packs);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const [pack] = await sql`SELECT * FROM process_packs WHERE id = ${id}`;
    if (!pack) return c.json({ error: 'Pack not found' }, 404);
    return c.json(pack);
  });

  return app;
}
