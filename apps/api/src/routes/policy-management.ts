import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import { invalidatePolicyCache } from '../middleware/authorize.js';

type Sql = ReturnType<typeof postgres>;

export function policyManagementRoutes(sql: Sql) {
  const app = new Hono();

  app.use('*', authMiddleware);

  // GET / — list policies for user's org (plus system policies)
  app.get('/', async (c) => {
    const user = getUser(c);

    const policies = await sql`
      SELECT * FROM policies
      WHERE organization_id = ${user.organization_id}
         OR organization_id IS NULL
         OR scope = 'system'
      ORDER BY priority DESC, name ASC
    `;

    return c.json(policies);
  });

  // POST / — create policy
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{
      name: string;
      description?: string;
      subject: Record<string, unknown>;
      actions: string[];
      resource: Record<string, unknown>;
      environment?: Record<string, unknown>;
      effect: 'allow' | 'deny';
      priority?: number;
      scope?: string;
    }>();

    if (!body.name || !body.subject || !body.actions || !body.resource || !body.effect) {
      return c.json({
        error: 'name, subject, actions, resource, and effect are required',
        error_key: 'policy.missing_fields',
      }, 400);
    }

    if (!['allow', 'deny'].includes(body.effect)) {
      return c.json({ error: 'Effect must be "allow" or "deny"', error_key: 'policy.invalid_effect' }, 400);
    }

    const id = crypto.randomUUID();

    const [policy] = await sql`
      INSERT INTO policies (id, organization_id, name, description, subject, actions, resource, environment, effect, priority, scope, active)
      VALUES (
        ${id},
        ${user.organization_id},
        ${body.name},
        ${body.description ?? null},
        ${sql.json(body.subject as any)},
        ${sql.json(body.actions as any)},
        ${sql.json(body.resource as any)},
        ${sql.json((body.environment ?? {}) as any)},
        ${body.effect},
        ${body.priority ?? 0},
        ${body.scope ?? 'organization'},
        true
      )
      RETURNING *
    `;

    invalidatePolicyCache();

    await auditLog(sql, c, {
      action: 'policy.created',
      resource_type: 'policy',
      resource_id: id,
      details: { name: body.name, effect: body.effect },
    });

    return c.json(policy, 201);
  });

  // PATCH /:id — update policy
  app.patch('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      description?: string;
      subject?: Record<string, unknown>;
      actions?: string[];
      resource?: Record<string, unknown>;
      environment?: Record<string, unknown>;
      effect?: 'allow' | 'deny';
      priority?: number;
      active?: boolean;
    }>();

    const [existing] = await sql`
      SELECT * FROM policies
      WHERE id = ${id} AND organization_id = ${user.organization_id}
    `;
    if (!existing) {
      return c.json({ error: 'Policy not found', error_key: 'policy.not_found' }, 404);
    }

    if (body.effect && !['allow', 'deny'].includes(body.effect)) {
      return c.json({ error: 'Effect must be "allow" or "deny"', error_key: 'policy.invalid_effect' }, 400);
    }

    const [updated] = await sql`
      UPDATE policies SET
        name = COALESCE(${body.name ?? null}, name),
        description = COALESCE(${body.description ?? null}, description),
        subject = COALESCE(${body.subject ? sql.json(body.subject as any) : null}, subject),
        actions = COALESCE(${body.actions ? sql.json(body.actions as any) : null}, actions),
        resource = COALESCE(${body.resource ? sql.json(body.resource as any) : null}, resource),
        environment = COALESCE(${body.environment ? sql.json(body.environment as any) : null}, environment),
        effect = COALESCE(${body.effect ?? null}, effect),
        priority = COALESCE(${body.priority ?? null}, priority),
        active = COALESCE(${body.active ?? null}, active)
      WHERE id = ${id}
      RETURNING *
    `;

    invalidatePolicyCache();

    await auditLog(sql, c, {
      action: 'policy.updated',
      resource_type: 'policy',
      resource_id: id,
      details: body,
    });

    return c.json(updated);
  });

  // DELETE /:id — delete (deactivate) policy
  app.delete('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');

    const [existing] = await sql`
      SELECT * FROM policies
      WHERE id = ${id} AND organization_id = ${user.organization_id}
    `;
    if (!existing) {
      return c.json({ error: 'Policy not found', error_key: 'policy.not_found' }, 404);
    }

    await sql`DELETE FROM policies WHERE id = ${id}`;

    invalidatePolicyCache();

    await auditLog(sql, c, {
      action: 'policy.deleted',
      resource_type: 'policy',
      resource_id: id,
      details: { name: existing.name },
    });

    return c.json({ status: 'deleted' });
  });

  return app;
}
