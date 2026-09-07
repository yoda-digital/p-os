import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser, signJwt } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';

type Sql = ReturnType<typeof postgres>;

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

export function adminRoutes(sql: Sql) {
  const app = new Hono();

  app.use('*', authMiddleware);

  // Guard: all admin routes require system org membership
  app.use('*', async (c, next) => {
    const user = getUser(c);
    if (!user.is_system) {
      return c.json({ error: 'Not found', error_key: 'admin.not_found' }, 404);
    }
    await next();
  });

  // ──── Organization Management ────

  // GET /organizations — list all organizations with stats
  app.get('/organizations', async (c) => {
    const orgs = await sql`
      SELECT
        o.*,
        (SELECT count(*) FROM memberships m WHERE m.organization_id = o.id) AS user_count,
        (SELECT count(*) FROM cases ca WHERE ca.organization_id = o.id) AS case_count
      FROM organizations o
      ORDER BY o.created_at DESC
    `;

    return c.json(orgs);
  });

  // POST /organizations — create organization
  app.post('/organizations', async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{
      name: string;
      slug?: string;
      settings?: Record<string, unknown>;
    }>();

    if (!body.name) {
      return c.json({ error: 'Organization name is required', error_key: 'admin.org_name_required' }, 400);
    }

    const id = crypto.randomUUID();
    const slug = body.slug ?? body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // Check slug uniqueness
    const [existingSlug] = await sql`SELECT id FROM organizations WHERE slug = ${slug}`;
    if (existingSlug) {
      return c.json({ error: 'Organization slug already exists', error_key: 'admin.org_slug_exists' }, 409);
    }

    const [org] = await sql`
      INSERT INTO organizations (id, name, slug, settings)
      VALUES (${id}, ${body.name}, ${slug}, ${sql.json((body.settings ?? {}) as any)})
      RETURNING *
    `;

    await auditLog(sql, c, {
      action: 'admin.org_created',
      resource_type: 'organization',
      resource_id: id,
      details: { name: body.name, slug },
    });

    return c.json(org, 201);
  });

  // PATCH /organizations/:id — update organization
  app.patch('/organizations/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      status?: string;
      settings?: Record<string, unknown>;
    }>();

    // Cannot modify the system org's core properties
    if (id === SYSTEM_ORG_ID && (body.name || body.status)) {
      return c.json({ error: 'Cannot modify system organization', error_key: 'admin.cannot_modify_system_org' }, 400);
    }

    const [existing] = await sql`SELECT * FROM organizations WHERE id = ${id}`;
    if (!existing) {
      return c.json({ error: 'Organization not found', error_key: 'admin.org_not_found' }, 404);
    }

    const [updated] = await sql`
      UPDATE organizations SET
        name = COALESCE(${body.name ?? null}, name),
        status = COALESCE(${body.status ?? null}, status),
        settings = COALESCE(${body.settings ? sql.json(body.settings as any) : null}, settings)
      WHERE id = ${id}
      RETURNING *
    `;

    await auditLog(sql, c, {
      action: 'admin.org_updated',
      resource_type: 'organization',
      resource_id: id,
      details: body,
    });

    return c.json(updated);
  });

  // ──── User Management ────

  // GET /users — search all users
  app.get('/users', async (c) => {
    const search = c.req.query('search');
    const status = c.req.query('status');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    let users;
    if (search && status) {
      users = await sql`
        SELECT u.id, u.email, u.display_name, u.status, u.last_login_at, u.login_count, u.created_at,
          (SELECT json_agg(json_build_object('organization_id', m.organization_id, 'role', m.role, 'org_name', o.name))
           FROM memberships m JOIN organizations o ON o.id = m.organization_id
           WHERE m.user_id = u.id) AS memberships
        FROM users u
        WHERE (u.email ILIKE ${'%' + search + '%'} OR u.display_name ILIKE ${'%' + search + '%'})
          AND u.status = ${status}
        ORDER BY u.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (search) {
      users = await sql`
        SELECT u.id, u.email, u.display_name, u.status, u.last_login_at, u.login_count, u.created_at,
          (SELECT json_agg(json_build_object('organization_id', m.organization_id, 'role', m.role, 'org_name', o.name))
           FROM memberships m JOIN organizations o ON o.id = m.organization_id
           WHERE m.user_id = u.id) AS memberships
        FROM users u
        WHERE u.email ILIKE ${'%' + search + '%'} OR u.display_name ILIKE ${'%' + search + '%'}
        ORDER BY u.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (status) {
      users = await sql`
        SELECT u.id, u.email, u.display_name, u.status, u.last_login_at, u.login_count, u.created_at,
          (SELECT json_agg(json_build_object('organization_id', m.organization_id, 'role', m.role, 'org_name', o.name))
           FROM memberships m JOIN organizations o ON o.id = m.organization_id
           WHERE m.user_id = u.id) AS memberships
        FROM users u
        WHERE u.status = ${status}
        ORDER BY u.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      users = await sql`
        SELECT u.id, u.email, u.display_name, u.status, u.last_login_at, u.login_count, u.created_at,
          (SELECT json_agg(json_build_object('organization_id', m.organization_id, 'role', m.role, 'org_name', o.name))
           FROM memberships m JOIN organizations o ON o.id = m.organization_id
           WHERE m.user_id = u.id) AS memberships
        FROM users u
        ORDER BY u.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    return c.json({ users, limit, offset });
  });

  // PATCH /users/:id — update user (disable, suspend, change role)
  app.patch('/users/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json<{
      status?: string;
      display_name?: string;
      roles?: string[];
    }>();

    const [existing] = await sql`SELECT * FROM users WHERE id = ${id}`;
    if (!existing) {
      return c.json({ error: 'User not found', error_key: 'admin.user_not_found' }, 404);
    }

    const updates: Record<string, unknown> = {};
    if (body.status !== undefined) updates['status'] = body.status;
    if (body.display_name !== undefined) updates['display_name'] = body.display_name;

    if (Object.keys(updates).length > 0) {
      const statusVal = body.status ?? null;
      const displayNameVal = body.display_name ?? null;
      await sql`
        UPDATE users SET
          status = COALESCE(${statusVal}, status),
          display_name = COALESCE(${displayNameVal}, display_name)
        WHERE id = ${id}
      `;
    }

    // If system roles are specified, manage system org membership
    if (body.roles) {
      // Check if user has system org membership
      const [sysMemb] = await sql`
        SELECT * FROM memberships WHERE user_id = ${id} AND organization_id = ${SYSTEM_ORG_ID}
      `;

      if (body.roles.length > 0) {
        const role = body.roles[0]!;
        if (sysMemb) {
          await sql`
            UPDATE memberships SET role = ${role}
            WHERE user_id = ${id} AND organization_id = ${SYSTEM_ORG_ID}
          `;
        } else {
          await sql`
            INSERT INTO memberships (user_id, organization_id, role)
            VALUES (${id}, ${SYSTEM_ORG_ID}, ${role})
          `;
        }
      } else if (sysMemb) {
        await sql`
          DELETE FROM memberships WHERE user_id = ${id} AND organization_id = ${SYSTEM_ORG_ID}
        `;
      }
    }

    await auditLog(sql, c, {
      action: 'admin.user_updated',
      resource_type: 'user',
      resource_id: id,
      details: body,
    });

    const [updated] = await sql`SELECT id, email, display_name, status, last_login_at, login_count FROM users WHERE id = ${id}`;
    return c.json(updated);
  });

  // ──── Impersonation ────

  // POST /impersonate/:id — start impersonation
  app.post('/impersonate/:id', async (c) => {
    const admin = getUser(c);
    const targetId = c.req.param('id');

    // Verify target user exists
    const [targetUser] = await sql`
      SELECT u.id, u.email, u.display_name, u.preferred_language FROM users u WHERE u.id = ${targetId}
    `;
    if (!targetUser) {
      return c.json({ error: 'User not found', error_key: 'admin.user_not_found' }, 404);
    }

    // Cannot impersonate yourself
    if (targetId === admin.user_id) {
      return c.json({ error: 'Cannot impersonate yourself', error_key: 'admin.cannot_impersonate_self' }, 400);
    }

    // Get target user's primary membership
    const [membership] = await sql`
      SELECT organization_id, role FROM memberships
      WHERE user_id = ${targetId} AND organization_id != ${SYSTEM_ORG_ID}
      LIMIT 1
    `;

    if (!membership) {
      return c.json({ error: 'Target user has no organization membership', error_key: 'admin.no_org_membership' }, 400);
    }

    // Issue impersonation JWT
    const token = await signJwt({
      user_id: targetUser.id as string,
      email: targetUser.email as string,
      organization_id: membership.organization_id as string,
      roles: [membership.role as string],
      is_system: false,
      preferred_language: (targetUser.preferred_language as string) ?? 'ro',
      impersonated_by: admin.user_id,
    });

    await auditLog(sql, c, {
      action: 'admin.impersonation_started',
      resource_type: 'user',
      resource_id: targetId,
      details: {
        admin_id: admin.user_id,
        admin_email: admin.email,
        target_email: targetUser.email,
      },
    });

    return c.json({
      token,
      impersonating: {
        user_id: targetUser.id,
        email: targetUser.email,
        display_name: targetUser.display_name,
        organization_id: membership.organization_id,
      },
    });
  });

  // POST /impersonate/end — end impersonation
  app.post('/impersonate/end', async (c) => {
    const user = getUser(c);

    // This endpoint is called by the admin when they have an impersonation token.
    // The is_system check already passed because the impersonated_by user is a system user.
    // We need to re-issue a token for the admin.

    // If the current token doesn't have impersonated_by, there's nothing to end
    if (!user.impersonated_by) {
      // The caller is already a system user (passed the guard), just acknowledge
      return c.json({ status: 'not_impersonating' });
    }

    // Get the admin user
    const [adminUser] = await sql`
      SELECT u.id, u.email, u.display_name, u.preferred_language FROM users u WHERE u.id = ${user.impersonated_by}
    `;
    if (!adminUser) {
      return c.json({ error: 'Admin user not found', error_key: 'admin.admin_not_found' }, 500);
    }

    // Re-issue admin JWT
    const token = await signJwt({
      user_id: adminUser.id as string,
      email: adminUser.email as string,
      organization_id: SYSTEM_ORG_ID,
      roles: ['superadmin'],
      is_system: true,
      preferred_language: (adminUser.preferred_language as string) ?? 'ro',
    });

    await auditLog(sql, c, {
      action: 'admin.impersonation_ended',
      resource_type: 'user',
      resource_id: user.user_id,
      details: {
        admin_id: user.impersonated_by,
        was_impersonating: user.email,
      },
    });

    return c.json({
      token,
      user: {
        user_id: adminUser.id,
        email: adminUser.email,
        display_name: adminUser.display_name,
      },
    });
  });

  // ──── System Health ────

  // GET /health — system health stats
  app.get('/health', async (c) => {
    const [userStats] = await sql`
      SELECT
        count(*) AS total_users,
        count(*) FILTER (WHERE status = 'active') AS active_users,
        count(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '24 hours') AS daily_active,
        count(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '7 days') AS weekly_active,
        count(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '30 days') AS monthly_active
      FROM users
    `;

    const [orgStats] = await sql`
      SELECT count(*) AS total_organizations FROM organizations WHERE id != ${SYSTEM_ORG_ID}
    `;

    const [caseStats] = await sql`
      SELECT
        count(*) AS total_cases,
        count(*) FILTER (WHERE lifecycle = 'active') AS active_cases
      FROM cases
    `;

    const [eventStats] = await sql`
      SELECT count(*) AS total_events FROM events
    `;

    const [auditStats] = await sql`
      SELECT
        count(*) AS total_audit_entries,
        count(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS audit_entries_24h
      FROM audit_log
    `;

    // Database table sizes
    const tableSizes = await sql`
      SELECT
        relname AS table_name,
        pg_size_pretty(pg_total_relation_size(quote_ident(relname)::regclass)) AS total_size,
        n_live_tup AS row_count
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(quote_ident(relname)::regclass) DESC
      LIMIT 20
    `;

    return c.json({
      users: userStats,
      organizations: orgStats,
      cases: caseStats,
      events: eventStats,
      audit: auditStats,
      tables: tableSizes,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
