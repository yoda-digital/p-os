import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';

type Sql = ReturnType<typeof postgres>;

export function auditRoutes(sql: Sql) {
  const app = new Hono();

  app.use('*', authMiddleware);

  // GET / — query audit log for user's org
  app.get('/', async (c) => {
    const user = getUser(c);

    const action = c.req.query('action');
    const resourceType = c.req.query('resource_type');
    const resourceId = c.req.query('resource_id');
    const actorId = c.req.query('actor_id');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    // Build dynamic WHERE conditions
    const conditions: string[] = [];
    const values: Record<string, unknown> = {};

    // Org scoping: non-system users see only their org
    if (!user.is_system) {
      conditions.push(`organization_id = $orgId`);
      values['orgId'] = user.organization_id;
    }

    // Build query with postgres template literals and dynamic filters
    let entries;
    if (!user.is_system) {
      if (action && resourceType && actorId && from && to && resourceId) {
        entries = await sql`
          SELECT * FROM audit_log
          WHERE organization_id = ${user.organization_id}
            AND action = ${action}
            AND resource_type = ${resourceType}
            AND resource_id = ${resourceId}::uuid
            AND actor_id = ${actorId}::uuid
            AND created_at >= ${from}::timestamptz
            AND created_at <= ${to}::timestamptz
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (action && resourceType) {
        entries = await sql`
          SELECT * FROM audit_log
          WHERE organization_id = ${user.organization_id}
            AND action = ${action}
            AND resource_type = ${resourceType}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (action) {
        entries = await sql`
          SELECT * FROM audit_log
          WHERE organization_id = ${user.organization_id}
            AND action = ${action}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (resourceType) {
        entries = await sql`
          SELECT * FROM audit_log
          WHERE organization_id = ${user.organization_id}
            AND resource_type = ${resourceType}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (actorId) {
        entries = await sql`
          SELECT * FROM audit_log
          WHERE organization_id = ${user.organization_id}
            AND actor_id = ${actorId}::uuid
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (from && to) {
        entries = await sql`
          SELECT * FROM audit_log
          WHERE organization_id = ${user.organization_id}
            AND created_at >= ${from}::timestamptz
            AND created_at <= ${to}::timestamptz
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        entries = await sql`
          SELECT * FROM audit_log
          WHERE organization_id = ${user.organization_id}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }
    } else {
      // System users can see all audit logs (admin audit)
      if (action) {
        entries = await sql`
          SELECT * FROM audit_log
          WHERE action = ${action}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else if (resourceType) {
        entries = await sql`
          SELECT * FROM audit_log
          WHERE resource_type = ${resourceType}
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        entries = await sql`
          SELECT * FROM audit_log
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }
    }

    return c.json({ entries, limit, offset });
  });

  return app;
}
