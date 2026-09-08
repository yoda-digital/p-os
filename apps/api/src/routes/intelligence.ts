import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';
import { computeProcessMetrics } from '../services/process-metrics.js';
import { detectDrift } from '../services/drift-detector.js';
import { analyzeProcess } from '../services/ai-architect.js';
import { runGuardianCheck } from '../services/ai-guardian.js';

type Sql = ReturnType<typeof postgres>;

export function intelligenceRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  // GET /metrics — 11 process metrics computed from event history
  app.get('/metrics', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);

    try {
      const metrics = await computeProcessMetrics(sql, caseId);
      return c.json(metrics);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Failed to compute metrics' }, 500);
    }
  });

  // GET /drift — drift detection report
  app.get('/drift', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);

    try {
      const report = await detectDrift(sql, caseId);
      return c.json(report);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Drift detection failed' }, 500);
    }
  });

  // POST /analyze — AI Process Architect analysis
  app.post('/analyze', async (c) => {
    const body = await c.req.json<{ caseId: string }>();
    if (!body.caseId) return c.json({ error: 'caseId required' }, 400);

    try {
      const analysis = await analyzeProcess(sql, body.caseId);
      return c.json(analysis);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Analysis failed' }, 500);
    }
  });

  // POST /guardian — AI Process Guardian check
  app.post('/guardian', async (c) => {
    const body = await c.req.json<{ caseId: string }>();
    if (!body.caseId) return c.json({ error: 'caseId required' }, 400);

    try {
      const report = await runGuardianCheck(sql, body.caseId);
      return c.json(report);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Guardian check failed' }, 500);
    }
  });

  // GET /insights — list process insights for a case
  app.get('/insights', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);

    const status = c.req.query('status') ?? 'open';

    try {
      const insights = await sql`
        SELECT * FROM process_insights
        WHERE case_id = ${caseId}
        ${status !== 'all' ? sql`AND status = ${status}` : sql``}
        ORDER BY created_at DESC
        LIMIT 50
      `;
      return c.json(insights);
    } catch {
      return c.json([]);
    }
  });

  // PATCH /insights/:id — update insight status (accept/reject)
  app.patch('/insights/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{ status: string }>();

    if (!['accepted', 'rejected', 'superseded'].includes(body.status)) {
      return c.json({ error: 'status must be accepted, rejected, or superseded' }, 400);
    }

    try {
      const [updated] = await sql`
        UPDATE process_insights SET status = ${body.status} WHERE id = ${id} RETURNING *
      `;
      if (!updated) return c.json({ error: 'Insight not found' }, 404);
      return c.json(updated);
    } catch {
      return c.json({ error: 'Failed to update insight' }, 500);
    }
  });

  return app;
}
