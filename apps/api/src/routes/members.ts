import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';

type Sql = ReturnType<typeof postgres>;

export function memberRoutes(sql: Sql) {
  const app = new Hono();

  app.use('*', authMiddleware);

  // GET / — list org members
  app.get('/', async (c) => {
    const user = getUser(c);

    const members = await sql`
      SELECT
        u.id,
        u.email,
        u.display_name,
        u.avatar_url,
        u.status,
        u.last_login_at,
        m.role,
        m.created_at AS joined_at,
        (SELECT json_agg(json_build_object('team_id', tm.team_id, 'role', tm.role, 'team_name', t.name))
         FROM team_memberships tm
         JOIN teams t ON t.id = tm.team_id
         WHERE tm.user_id = u.id AND t.organization_id = ${user.organization_id}
        ) AS teams
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${user.organization_id}
      ORDER BY u.display_name ASC
    `;

    return c.json(members);
  });

  // PATCH /:id — update member role
  app.patch('/:id', async (c) => {
    const user = getUser(c);
    const memberId = c.req.param('id');
    const body = await c.req.json<{
      role?: string;
    }>();

    if (!body.role) {
      return c.json({ error: 'Role is required', error_key: 'member.role_required' }, 400);
    }

    // Verify membership exists
    const [membership] = await sql`
      SELECT * FROM memberships
      WHERE user_id = ${memberId} AND organization_id = ${user.organization_id}
    `;
    if (!membership) {
      return c.json({ error: 'Member not found', error_key: 'member.not_found' }, 404);
    }

    // Prevent demoting yourself if you're the last admin
    if (memberId === user.user_id && body.role !== 'admin') {
      const [adminCount] = await sql`
        SELECT count(*) AS cnt FROM memberships
        WHERE organization_id = ${user.organization_id} AND role = 'admin'
      `;
      if (Number(adminCount?.cnt ?? 0) <= 1) {
        return c.json({
          error: 'Cannot demote the last admin',
          error_key: 'member.last_admin',
        }, 400);
      }
    }

    await sql`
      UPDATE memberships SET role = ${body.role}
      WHERE user_id = ${memberId} AND organization_id = ${user.organization_id}
    `;

    await auditLog(sql, c, {
      action: 'member.role_changed',
      resource_type: 'membership',
      resource_id: memberId,
      details: { old_role: membership.role, new_role: body.role },
    });

    return c.json({ status: 'updated', user_id: memberId, role: body.role });
  });

  // DELETE /:id — remove member from org
  app.delete('/:id', async (c) => {
    const user = getUser(c);
    const memberId = c.req.param('id');

    // Cannot remove yourself
    if (memberId === user.user_id) {
      return c.json({ error: 'Cannot remove yourself', error_key: 'member.cannot_remove_self' }, 400);
    }

    const [membership] = await sql`
      SELECT * FROM memberships
      WHERE user_id = ${memberId} AND organization_id = ${user.organization_id}
    `;
    if (!membership) {
      return c.json({ error: 'Member not found', error_key: 'member.not_found' }, 404);
    }

    await sql.begin(async (tx) => {
      // Remove from all teams in this org
      await tx`
        DELETE FROM team_memberships
        WHERE user_id = ${memberId}
          AND team_id IN (SELECT id FROM teams WHERE organization_id = ${user.organization_id})
      `;

      // Remove from all org units in this org
      await tx`
        DELETE FROM unit_memberships
        WHERE user_id = ${memberId}
          AND unit_id IN (SELECT id FROM organizational_units WHERE organization_id = ${user.organization_id})
      `;

      // Remove membership
      await tx`
        DELETE FROM memberships
        WHERE user_id = ${memberId} AND organization_id = ${user.organization_id}
      `;
    });

    await auditLog(sql, c, {
      action: 'member.removed',
      resource_type: 'membership',
      resource_id: memberId,
      details: { role: membership.role },
    });

    return c.json({ status: 'removed' });
  });

  return app;
}
