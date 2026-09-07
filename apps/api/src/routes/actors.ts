import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

export function actorRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const user = getUser(c);
    const actors = await sql`
      SELECT a.*,
        (SELECT count(*) FROM attempts att WHERE att.executor_id = a.id AND att.state = 'running') AS active_attempts,
        (SELECT count(*) FROM attempts att WHERE att.executor_id = a.id AND att.state = 'succeeded') AS succeeded_attempts,
        (SELECT count(*) FROM attempts att WHERE att.executor_id = a.id AND att.state = 'failed') AS failed_attempts
      FROM actors a
      WHERE a.organization_id = ${user.organization_id}
      ORDER BY a.display_name
    `;
    return c.json(actors);
  });

  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json();

    const result = await processor.process({
      command_id: crypto.randomUUID(),
      type: 'Actor.Create',
      tenant_id: user.organization_id,
      actor_id: user.user_id,
      issued_at: new Date().toISOString(),
      payload: body,
    });

    if (result.status !== 'accepted') return c.json({ error: result.reason }, 400);
    const [actor] = await sql`SELECT * FROM actors WHERE id = ${result.data?.id as string}`;
    return c.json(actor, 201);
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    const [actor] = await sql`SELECT * FROM actors WHERE id = ${id}`;
    if (!actor) return c.json({ error: 'Actor not found' }, 404);
    return c.json(actor);
  });

  return app;
}
