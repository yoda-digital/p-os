import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import {
  createSimulation,
  applyHypothetical,
  compareOutcomes,
  adoptSimulation,
} from '../services/simulation-engine.js';

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
    const { case_id, title, description, fork_at_event_id } = body;

    if (!case_id || !title) return c.json({ error: 'case_id and title required' }, 400);

    try {
      const sim = await createSimulation(sql, case_id, title, description ?? null, user.user_id, fork_at_event_id);
      return c.json(sim, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to create simulation' }, 500);
    }
  });

  // GET /:id — get simulation state with events
  app.get('/:id', async (c) => {
    const id = c.req.param('id');

    const [fork] = await sql`SELECT * FROM simulation_forks WHERE id = ${id}`;
    if (!fork) return c.json({ error: 'Simulation fork not found' }, 404);

    const simEvents = await sql`
      SELECT * FROM simulation_events WHERE simulation_id = ${id} ORDER BY sequence ASC
    `;

    return c.json({
      ...fork,
      simulation_events: simEvents,
    });
  });

  // POST /:id/apply — apply hypothetical events
  app.post('/:id/apply', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ events: Array<{ type: string; data: Record<string, unknown> }> }>();

    if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
      return c.json({ error: 'events array is required and must not be empty' }, 400);
    }

    try {
      const applied = await applyHypothetical(sql, id, body.events);
      return c.json({ applied_count: applied.length, events: applied });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to apply events' }, 500);
    }
  });

  // GET /:id/compare — compare canonical vs simulated state
  app.get('/:id/compare', async (c) => {
    const id = c.req.param('id');

    try {
      const comparison = await compareOutcomes(sql, id);
      return c.json(comparison);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Comparison failed' }, 500);
    }
  });

  // POST /:id/adopt — adopt simulation changes as real commands
  app.post('/:id/adopt', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json<{ selected_event_ids?: string[]; confirm?: boolean }>().catch(() => ({}));

    const [fork] = await sql`SELECT * FROM simulation_forks WHERE id = ${id}`;
    if (!fork) return c.json({ error: 'Simulation fork not found' }, 404);

    // If no confirm flag, return preview
    if (!body.confirm) {
      const simEvents = await sql`
        SELECT * FROM simulation_events WHERE simulation_id = ${id} ORDER BY sequence ASC
      `;
      return c.json({
        status: 'preview',
        fork_id: id,
        events_to_adopt: simEvents.length,
        events: simEvents.map((e: Record<string, unknown>) => ({
          id: e.id,
          type: e.type,
          data: e.data,
          sequence: e.sequence,
        })),
        message: 'Send confirm: true to adopt these changes as real commands.',
      });
    }

    try {
      const result = await adoptSimulation(sql, id, body.selected_event_ids ?? null, user.user_id);
      return c.json({
        status: 'adopted',
        fork_id: id,
        ...result,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Adoption failed' }, 500);
    }
  });

  return app;
}
