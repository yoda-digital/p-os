import { Hono } from 'hono';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { signJwt, authMiddleware, getUser } from '../middleware/auth.js';

type Sql = ReturnType<typeof postgres>;

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
    });

    const token = await signJwt({
      user_id: userId,
      email: body.email,
      organization_id: orgId,
      roles: ['admin'],
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

    // Get membership
    const [membership] = await sql`
      SELECT organization_id, role FROM memberships WHERE user_id = ${user.id}
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
    });

    return c.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        organization_id: membership.organization_id,
      },
    });
  });

  // GET /profile
  app.get('/profile', authMiddleware, async (c) => {
    const authUser = getUser(c);
    const [user] = await sql`SELECT id, email, display_name, created_at FROM users WHERE id = ${authUser.user_id}`;
    if (!user) return c.json({ error: 'User not found' }, 404);

    const memberships = await sql`
      SELECT m.organization_id, m.role, o.name AS organization_name
      FROM memberships m JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ${authUser.user_id}
    `;

    return c.json({ ...user, memberships });
  });

  return app;
}
