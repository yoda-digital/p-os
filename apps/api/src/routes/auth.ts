import { Hono } from 'hono';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { signJwt, authMiddleware, getUser } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';

type Sql = ReturnType<typeof postgres>;

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, 64);
  return timingSafeEqual(Buffer.from(hash, 'hex'), computed);
}

export function authRoutes(sql: Sql) {
  const app = new Hono();

  // POST /register
  app.post('/register', async (c) => {
    const body = await c.req.json<{
      email: string;
      password: string;
      display_name: string;
      organization_name?: string;
    }>();

    if (!body.email || !body.password || !body.display_name) {
      return c.json({ error: 'email, password, and display_name are required' }, 400);
    }

    // Check if user exists
    const [existing] = await sql`SELECT id FROM users WHERE email = ${body.email}`;
    if (existing) {
      return c.json({ error: 'User already exists' }, 409);
    }

    const userId = crypto.randomUUID();
    const orgId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const passwordHash = hashPassword(body.password);
    const orgName = body.organization_name ?? `${body.display_name}'s Organization`;

    let isSystem = false;

    await sql.begin(async (tx) => {
      // Create organization
      await tx`
        INSERT INTO organizations (id, name, slug)
        VALUES (${orgId}, ${orgName}, ${orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-')})
      `;
      // Create user
      await tx`
        INSERT INTO users (id, email, display_name, password_hash)
        VALUES (${userId}, ${body.email}, ${body.display_name}, ${passwordHash})
      `;
      // Create membership
      await tx`
        INSERT INTO memberships (user_id, organization_id, role)
        VALUES (${userId}, ${orgId}, 'admin')
      `;
      // Create default workspace
      await tx`
        INSERT INTO workspaces (id, organization_id, name)
        VALUES (${workspaceId}, ${orgId}, 'Default')
      `;
      // Create actor for user
      await tx`
        INSERT INTO actors (id, organization_id, class, identity_ref, display_name, roles, capabilities, authority_grants, created_by, revision)
        VALUES (${actorId}, ${orgId}, 'human',
                ${sql.json({ type: 'user', user_id: userId })},
                ${body.display_name},
                ${sql.json(['admin'])},
                ${sql.json(['*'])},
                ${sql.json(['*'])},
                ${userId}, 0)
      `;

      // Auto-accept any pending system org invitations for this email
      const [pendingSystemInvite] = await tx`
        SELECT id FROM invitations
        WHERE email = ${body.email}
          AND organization_id = ${SYSTEM_ORG_ID}
          AND status = 'pending'
          AND expires_at > NOW()
        LIMIT 1
      `;
      if (pendingSystemInvite) {
        await tx`
          INSERT INTO memberships (user_id, organization_id, role, status)
          VALUES (${userId}, ${SYSTEM_ORG_ID}, 'superadmin', 'active')
        `;
        await tx`
          UPDATE invitations SET status = 'accepted', accepted_at = NOW(), accepted_by = ${userId}
          WHERE id = ${pendingSystemInvite.id}
        `;
        isSystem = true;
      }
    });

    const token = await signJwt({
      user_id: userId,
      email: body.email,
      organization_id: orgId,
      roles: ['admin'],
      is_system: isSystem,
    });

    return c.json({
      token,
      user: {
        id: userId,
        email: body.email,
        display_name: body.display_name,
        organization_id: orgId,
        workspace_id: workspaceId,
        actor_id: actorId,
        is_system: isSystem,
      },
    }, 201);
  });

  // POST /login
  app.post('/login', async (c) => {
    const body = await c.req.json<{ email: string; password: string }>();

    if (!body.email || !body.password) {
      return c.json({ error: 'email and password are required' }, 400);
    }

    const [user] = await sql`SELECT * FROM users WHERE email = ${body.email}`;
    if (!user || !verifyPassword(body.password, user.password_hash as string)) {
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Auto-accept any pending system org invitations for this email
    const [pendingSystemInvite] = await sql`
      SELECT id FROM invitations
      WHERE email = ${body.email}
        AND organization_id = ${SYSTEM_ORG_ID}
        AND status = 'pending'
        AND expires_at > NOW()
      LIMIT 1
    `;
    if (pendingSystemInvite) {
      // Check if membership already exists
      const [existingSystemMembership] = await sql`
        SELECT 1 FROM memberships WHERE user_id = ${user.id} AND organization_id = ${SYSTEM_ORG_ID}
      `;
      if (!existingSystemMembership) {
        await sql`
          INSERT INTO memberships (user_id, organization_id, role, status)
          VALUES (${user.id}, ${SYSTEM_ORG_ID}, 'superadmin', 'active')
        `;
      }
      await sql`
        UPDATE invitations SET status = 'accepted', accepted_at = NOW(), accepted_by = ${user.id}
        WHERE id = ${pendingSystemInvite.id}
      `;
    }

    // Check if user has system org membership
    const [systemMembership] = await sql`
      SELECT 1 FROM memberships
      WHERE user_id = ${user.id} AND organization_id = ${SYSTEM_ORG_ID}
    `;
    const isSystem = !!systemMembership;

    // Get membership (prefer non-system org for default context)
    const [membership] = await sql`
      SELECT organization_id, role FROM memberships
      WHERE user_id = ${user.id} AND organization_id != ${SYSTEM_ORG_ID}
      LIMIT 1
    `;

    if (!membership) {
      return c.json({ error: 'No organization found' }, 403);
    }

    const token = await signJwt({
      user_id: user.id as string,
      email: user.email as string,
      organization_id: membership.organization_id as string,
      roles: [membership.role as string],
      is_system: isSystem,
    });

    return c.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        organization_id: membership.organization_id,
        is_system: isSystem,
      },
    });
  });

  // GET /profile
  app.get('/profile', authMiddleware, async (c) => {
    const authUser = getUser(c);
    const [user] = await sql`SELECT id, email, display_name, preferred_language, timezone, avatar_url, status, created_at FROM users WHERE id = ${authUser.user_id}`;
    if (!user) return c.json({ error: 'User not found', error_key: 'auth.user_not_found' }, 404);

    const memberships = await sql`
      SELECT m.organization_id, m.role, o.name AS organization_name
      FROM memberships m JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${authUser.user_id}
    `;

    // Check if user has system org membership
    const [systemMembership] = await sql`
      SELECT 1 FROM memberships
      WHERE user_id = ${authUser.user_id} AND organization_id = ${SYSTEM_ORG_ID}
    `;
    const isSystem = !!systemMembership;

    return c.json({ ...user, memberships, is_system: isSystem });
  });

  // PATCH /profile — update user profile (language, timezone, display_name, avatar)
  app.patch('/profile', authMiddleware, async (c) => {
    const authUser = getUser(c);
    const body = await c.req.json<{
      preferred_language?: string;
      timezone?: string;
      display_name?: string;
      avatar_url?: string;
    }>();

    const [existing] = await sql`SELECT * FROM users WHERE id = ${authUser.user_id}`;
    if (!existing) {
      return c.json({ error: 'User not found', error_key: 'auth.user_not_found' }, 404);
    }

    const [updated] = await sql`
      UPDATE users SET
        preferred_language = COALESCE(${body.preferred_language ?? null}, preferred_language),
        timezone = COALESCE(${body.timezone ?? null}, timezone),
        display_name = COALESCE(${body.display_name ?? null}, display_name),
        avatar_url = COALESCE(${body.avatar_url ?? null}, avatar_url)
      WHERE id = ${authUser.user_id}
      RETURNING id, email, display_name, preferred_language, timezone, avatar_url, status
    `;

    await auditLog(sql, c, {
      action: 'user.profile_updated',
      resource_type: 'user',
      resource_id: authUser.user_id,
      details: body,
    });

    return c.json(updated);
  });

  // POST /switch-org — switch active organization
  app.post('/switch-org', authMiddleware, async (c) => {
    const authUser = getUser(c);
    const body = await c.req.json<{ organization_id: string }>();

    if (!body.organization_id) {
      return c.json({ error: 'organization_id is required', error_key: 'auth.org_id_required' }, 400);
    }

    // Verify user has membership in the target org
    const [membership] = await sql`
      SELECT m.organization_id, m.role, o.name AS organization_name
      FROM memberships m JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${authUser.user_id} AND m.organization_id = ${body.organization_id}
    `;

    if (!membership) {
      return c.json({ error: 'Not a member of this organization', error_key: 'auth.not_member' }, 403);
    }

    // Check if user has system org membership (superadmin regardless of active org)
    const [sysCheck] = await sql`
      SELECT 1 FROM memberships
      WHERE user_id = ${authUser.user_id} AND organization_id = ${SYSTEM_ORG_ID}
    `;
    const isSystem = !!sysCheck;

    // Get user's preferred language
    const [userRow] = await sql`SELECT preferred_language FROM users WHERE id = ${authUser.user_id}`;

    // Issue new JWT with the new org
    const token = await signJwt({
      user_id: authUser.user_id,
      email: authUser.email,
      organization_id: body.organization_id,
      roles: [membership.role as string],
      is_system: isSystem,
      preferred_language: (userRow?.preferred_language as string) ?? 'ro',
    });

    await auditLog(sql, c, {
      action: 'user.org_switched',
      resource_type: 'organization',
      resource_id: body.organization_id,
      details: { from_org: authUser.organization_id, to_org: body.organization_id },
    });

    return c.json({
      token,
      organization: {
        id: membership.organization_id,
        name: membership.organization_name,
        role: membership.role,
      },
    });
  });

  return app;
}
