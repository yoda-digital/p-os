import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';

type Sql = ReturnType<typeof postgres>;

const INVITATION_EXPIRY_DAYS = 7;

export function invitationRoutes(sql: Sql) {
  const app = new Hono();

  app.use('*', authMiddleware);

  // GET / — list invitations for user's org
  app.get('/', async (c) => {
    const user = getUser(c);
    const status = c.req.query('status');

    let invitations;
    if (status) {
      invitations = await sql`
        SELECT i.*, u.display_name AS invited_by_name, u.email AS invited_by_email
        FROM invitations i
        LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.organization_id = ${user.organization_id} AND i.status = ${status}
        ORDER BY i.created_at DESC
      `;
    } else {
      invitations = await sql`
        SELECT i.*, u.display_name AS invited_by_name, u.email AS invited_by_email
        FROM invitations i
        LEFT JOIN users u ON u.id = i.invited_by
        WHERE i.organization_id = ${user.organization_id}
        ORDER BY i.created_at DESC
      `;
    }

    return c.json(invitations);
  });

  // POST / — create invitation
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{
      email: string;
      role?: string;
      team_id?: string;
      workspace_id?: string;
      message?: string;
    }>();

    if (!body.email) {
      return c.json({ error: 'Email is required', error_key: 'invitation.email_required' }, 400);
    }

    // Check for existing pending invitation
    const [existing] = await sql`
      SELECT id FROM invitations
      WHERE organization_id = ${user.organization_id}
        AND email = ${body.email}
        AND status = 'pending'
    `;
    if (existing) {
      return c.json({ error: 'Pending invitation already exists for this email', error_key: 'invitation.duplicate' }, 409);
    }

    // Check if user is already a member
    const [existingMember] = await sql`
      SELECT m.user_id FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${user.organization_id} AND u.email = ${body.email}
    `;
    if (existingMember) {
      return c.json({ error: 'User is already a member of this organization', error_key: 'invitation.already_member' }, 409);
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const id = crypto.randomUUID();

    const [invitation] = await sql`
      INSERT INTO invitations (id, organization_id, email, role, team_id, workspace_id, token, status, message, invited_by, expires_at)
      VALUES (
        ${id},
        ${user.organization_id},
        ${body.email},
        ${body.role ?? 'org_member'},
        ${body.team_id ?? null},
        ${body.workspace_id ?? null},
        ${token},
        'pending',
        ${body.message ?? null},
        ${user.user_id},
        ${expiresAt}
      )
      RETURNING *
    `;

    await auditLog(sql, c, {
      action: 'invitation.created',
      resource_type: 'invitation',
      resource_id: id,
      details: { email: body.email, role: body.role ?? 'org_member' },
    });

    return c.json({ ...invitation, token }, 201);
  });

  // POST /:id/revoke — revoke a pending invitation
  app.post('/:id/revoke', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');

    const [invitation] = await sql`
      SELECT * FROM invitations
      WHERE id = ${id} AND organization_id = ${user.organization_id}
    `;
    if (!invitation) {
      return c.json({ error: 'Invitation not found', error_key: 'invitation.not_found' }, 404);
    }
    if (invitation.status !== 'pending') {
      return c.json({ error: 'Only pending invitations can be revoked', error_key: 'invitation.not_pending' }, 400);
    }

    await sql`UPDATE invitations SET status = 'revoked' WHERE id = ${id}`;

    await auditLog(sql, c, {
      action: 'invitation.revoked',
      resource_type: 'invitation',
      resource_id: id,
      details: { email: invitation.email },
    });

    return c.json({ status: 'revoked' });
  });

  // POST /:token/accept — accept an invitation by token
  app.post('/:token/accept', async (c) => {
    const user = getUser(c);
    const token = c.req.param('token');

    const [invitation] = await sql`
      SELECT * FROM invitations WHERE token = ${token}
    `;
    if (!invitation) {
      return c.json({ error: 'Invalid invitation token', error_key: 'invitation.invalid_token' }, 404);
    }
    if (invitation.status !== 'pending') {
      return c.json({ error: 'Invitation is no longer pending', error_key: 'invitation.not_pending' }, 400);
    }
    if (new Date(invitation.expires_at as string) < new Date()) {
      await sql`UPDATE invitations SET status = 'expired' WHERE id = ${invitation.id}`;
      return c.json({ error: 'Invitation has expired', error_key: 'invitation.expired' }, 400);
    }

    // Check if already a member
    const [existingMembership] = await sql`
      SELECT user_id FROM memberships
      WHERE user_id = ${user.user_id} AND organization_id = ${invitation.organization_id}
    `;
    if (existingMembership) {
      await sql`UPDATE invitations SET status = 'accepted', accepted_at = NOW(), accepted_by = ${user.user_id} WHERE id = ${invitation.id}`;
      return c.json({ error: 'Already a member of this organization', error_key: 'invitation.already_member' }, 409);
    }

    await sql.begin(async (tx) => {
      // Create membership
      await tx`
        INSERT INTO memberships (user_id, organization_id, role)
        VALUES (${user.user_id}, ${invitation.organization_id}, ${invitation.role})
      `;

      // Add to team if specified
      if (invitation.team_id) {
        await tx`
          INSERT INTO team_memberships (team_id, user_id, role)
          VALUES (${invitation.team_id}, ${user.user_id}, 'team_member')
          ON CONFLICT (team_id, user_id) DO NOTHING
        `;
      }

      // Mark invitation as accepted
      await tx`
        UPDATE invitations
        SET status = 'accepted', accepted_at = NOW(), accepted_by = ${user.user_id}
        WHERE id = ${invitation.id}
      `;
    });

    await auditLog(sql, c, {
      action: 'invitation.accepted',
      resource_type: 'invitation',
      resource_id: invitation.id as string,
      details: { organization_id: invitation.organization_id, role: invitation.role },
    });

    return c.json({ status: 'accepted', organization_id: invitation.organization_id });
  });

  return app;
}
