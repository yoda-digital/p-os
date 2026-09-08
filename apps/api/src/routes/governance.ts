import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import {
  getAutonomyProfile,
  setAutonomyProfile,
  checkAutonomy,
  getBudgetStatus,
  recordGovernanceOverride,
  getGovernanceOverrides,
} from '../services/governance.js';

type Sql = ReturnType<typeof postgres>;

export function governanceRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  // GET /autonomy?caseId=xxx — get case autonomy profile
  app.get('/autonomy', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);
    const profile = await getAutonomyProfile(sql, caseId);
    return c.json(profile);
  });

  // PATCH /autonomy — update case autonomy profile
  app.patch('/autonomy', async (c) => {
    const body = await c.req.json();
    const caseId = body.case_id;
    if (!caseId) return c.json({ error: 'case_id required' }, 400);
    const profile = await setAutonomyProfile(sql, caseId, body);
    return c.json(profile);
  });

  // POST /check — check if an action is allowed under governance rules
  app.post('/check', async (c) => {
    const body = await c.req.json();
    const { case_id, action, actor_roles } = body;
    if (!case_id || !action) return c.json({ error: 'case_id and action required' }, 400);
    const result = await checkAutonomy(sql, case_id, action, actor_roles ?? []);
    return c.json(result);
  });

  // GET /budget?caseId=xxx — get budget status
  app.get('/budget', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);
    const status = await getBudgetStatus(sql, caseId);
    return c.json(status ?? { alert_level: 'normal', message: 'No budget tracking configured' });
  });

  // POST /override — record a governance override
  app.post('/override', async (c) => {
    const user = getUser(c);
    const body = await c.req.json();

    if (!body.action || !body.actual_decision || !body.justification) {
      return c.json({ error: 'action, actual_decision, and justification required' }, 400);
    }

    // Look up org ID
    let orgId = body.organization_id;
    if (!orgId && body.case_id) {
      const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${body.case_id}`;
      orgId = caseRow?.organization_id as string;
    }
    if (!orgId) return c.json({ error: 'Could not determine organization' }, 400);

    const id = await recordGovernanceOverride(sql, {
      case_id: body.case_id ?? null,
      organization_id: orgId,
      actor_id: user.user_id,
      action: body.action,
      original_recommendation: body.original_recommendation ?? null,
      actual_decision: body.actual_decision,
      justification: body.justification,
      override_type: body.override_type,
      metadata: body.metadata,
    });

    return c.json({ id, status: 'recorded' }, 201);
  });

  // GET /overrides?caseId=xxx or organizationId=xxx — list governance overrides
  app.get('/overrides', async (c) => {
    const caseId = c.req.query('caseId');
    const orgId = c.req.query('organizationId');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const overrides = await getGovernanceOverrides(sql, {
      case_id: caseId,
      organization_id: orgId,
      limit,
      offset,
    });

    return c.json(overrides);
  });

  return app;
}
