import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';

type Sql = ReturnType<typeof postgres>;

export function simulationRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  // GET / — list simulation forks
  app.get('/', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);
    const forks = await sql`
      SELECT * FROM simulation_forks WHERE source_case_id = ${caseId} ORDER BY created_at DESC
    `;
    return c.json(forks);
  });

  // POST / — create simulation fork
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json();
    const { case_id, title, description, hypothetical_changes, fork_at_event_id } = body;

    if (!case_id || !title) return c.json({ error: 'case_id and title required' }, 400);

    const forkId = crypto.randomUUID();

    await sql`
      INSERT INTO simulation_forks (id, source_case_id, fork_event_id, title, description, hypothetical_changes, created_by)
      VALUES (${forkId}, ${case_id}, ${fork_at_event_id ?? null}, ${title},
              ${description ?? null},
              ${sql.json(hypothetical_changes ?? [])},
              ${user.user_id})
    `;

    const [fork] = await sql`SELECT * FROM simulation_forks WHERE id = ${forkId}`;
    return c.json(fork, 201);
  });

  // POST /:id/adopt — adopt simulation changes as real commands
  app.post('/:id/adopt', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');

    const [fork] = await sql`SELECT * FROM simulation_forks WHERE id = ${id}`;
    if (!fork) return c.json({ error: 'Simulation fork not found' }, 404);

    const changes = (fork.hypothetical_changes as Array<Record<string, unknown>>) ?? [];

    // For now, return the changes that would be applied
    // Full implementation would create real commands for each hypothetical change
    return c.json({
      status: 'preview',
      fork_id: id,
      changes_to_apply: changes,
      message: 'Review and confirm these changes to apply them as real commands.',
    });
  });

  return app;
}
