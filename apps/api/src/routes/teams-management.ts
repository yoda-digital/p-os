import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';

type Sql = ReturnType<typeof postgres>;

export function teamManagementRoutes(sql: Sql) {
  const app = new Hono();

  app.use('*', authMiddleware);

  // GET / — list teams for user's org
  app.get('/', async (c) => {
    const user = getUser(c);

    const teams = await sql`
      SELECT t.*,
        (SELECT count(*) FROM team_memberships tm WHERE tm.team_id = t.id) AS member_count
      FROM teams t
      WHERE t.organization_id = ${user.organization_id}
      ORDER BY t.name ASC
    `;

    return c.json(teams);
  });

  // POST / — create team
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{
      name: string;
      description?: string;
      default_case_role?: string;
    }>();

    if (!body.name) {
      return c.json({ error: 'Team name is required', error_key: 'team.name_required' }, 400);
    }

    const id = crypto.randomUUID();

    const [team] = await sql`
      INSERT INTO teams (id, organization_id, name, description, default_case_role)
      VALUES (
        ${id},
        ${user.organization_id},
        ${body.name},
        ${body.description ?? null},
        ${body.default_case_role ?? 'case_contributor'}
      )
      RETURNING *
    `;

    await auditLog(sql, c, {
      action: 'team.created',
      resource_type: 'team',
      resource_id: id,
      details: { name: body.name },
    });

    return c.json(team, 201);
  });

  // PATCH /:id — update team
  app.patch('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      description?: string;
      status?: string;
      default_case_role?: string;
      policies?: Record<string, unknown>;
    }>();

    const [existing] = await sql`
      SELECT * FROM teams WHERE id = ${id} AND organization_id = ${user.organization_id}
    `;
    if (!existing) {
      return c.json({ error: 'Team not found', error_key: 'team.not_found' }, 404);
    }

    const [updated] = await sql`
      UPDATE teams SET
        name = COALESCE(${body.name ?? null}, name),
        description = COALESCE(${body.description ?? null}, description),
        status = COALESCE(${body.status ?? null}, status),
        default_case_role = COALESCE(${body.default_case_role ?? null}, default_case_role),
        policies = COALESCE(${body.policies ? sql.json(body.policies as any) : null}, policies)
      WHERE id = ${id}
      RETURNING *
    `;

    await auditLog(sql, c, {
      action: 'team.updated',
      resource_type: 'team',
      resource_id: id,
      details: body,
    });

    return c.json(updated);
  });

  // POST /:id/members — add member to team
  app.post('/:id/members', async (c) => {
    const user = getUser(c);
    const teamId = c.req.param('id');
    const body = await c.req.json<{
      user_id: string;
      role?: string;
    }>();

    if (!body.user_id) {
      return c.json({ error: 'user_id is required', error_key: 'team.user_id_required' }, 400);
    }

    // Verify team belongs to user's org
    const [team] = await sql`
      SELECT id FROM teams WHERE id = ${teamId} AND organization_id = ${user.organization_id}
    `;
    if (!team) {
      return c.json({ error: 'Team not found', error_key: 'team.not_found' }, 404);
    }

    // Verify target user is a member of the org
    const [membership] = await sql`
      SELECT user_id FROM memberships
      WHERE user_id = ${body.user_id} AND organization_id = ${user.organization_id}
    `;
    if (!membership) {
      return c.json({ error: 'User is not a member of this organization', error_key: 'team.user_not_in_org' }, 400);
    }

    // Check for existing team membership
    const [existing] = await sql`
      SELECT team_id FROM team_memberships WHERE team_id = ${teamId} AND user_id = ${body.user_id}
    `;
    if (existing) {
      return c.json({ error: 'User is already a member of this team', error_key: 'team.already_member' }, 409);
    }

    await sql`
      INSERT INTO team_memberships (team_id, user_id, role)
      VALUES (${teamId}, ${body.user_id}, ${body.role ?? 'team_member'})
    `;

    await auditLog(sql, c, {
      action: 'team.member_added',
      resource_type: 'team',
      resource_id: teamId,
      details: { user_id: body.user_id, role: body.role ?? 'team_member' },
    });

    return c.json({ status: 'added' }, 201);
  });

  // DELETE /:id/members/:userId — remove member from team
  app.delete('/:id/members/:userId', async (c) => {
    const user = getUser(c);
    const teamId = c.req.param('id');
    const userId = c.req.param('userId');

    // Verify team belongs to user's org
    const [team] = await sql`
      SELECT id FROM teams WHERE id = ${teamId} AND organization_id = ${user.organization_id}
    `;
    if (!team) {
      return c.json({ error: 'Team not found', error_key: 'team.not_found' }, 404);
    }

    const result = await sql`
      DELETE FROM team_memberships WHERE team_id = ${teamId} AND user_id = ${userId}
    `;
    if (result.count === 0) {
      return c.json({ error: 'User is not a member of this team', error_key: 'team.not_member' }, 404);
    }

    await auditLog(sql, c, {
      action: 'team.member_removed',
      resource_type: 'team',
      resource_id: teamId,
      details: { user_id: userId },
    });

    return c.json({ status: 'removed' });
  });

  // POST /cases/:caseId/teams — assign team to case (mounted separately)
  // This will be mounted at /cases/:caseId/teams in index.ts
  // For now, we expose it as a helper

  return app;
}

/**
 * Case team assignment routes — mounted under /api/v1/cases/:caseId/teams
 */
export function caseTeamRoutes(sql: Sql) {
  const app = new Hono();

  app.use('*', authMiddleware);

  // POST / — assign team to case
  app.post('/', async (c) => {
    const user = getUser(c);
    const caseId = c.req.param('caseId') as string;
    const body = await c.req.json<{
      team_id: string;
      role?: string;
    }>();

    if (!body.team_id) {
      return c.json({ error: 'team_id is required', error_key: 'case_team.team_id_required' }, 400);
    }

    // Verify case belongs to user's org
    const [caseRow] = await sql`
      SELECT id FROM cases WHERE id = ${caseId} AND organization_id = ${user.organization_id}
    `;
    if (!caseRow) {
      return c.json({ error: 'Case not found', error_key: 'case_team.case_not_found' }, 404);
    }

    // Verify team belongs to user's org
    const [team] = await sql`
      SELECT id, default_case_role FROM teams WHERE id = ${body.team_id} AND organization_id = ${user.organization_id}
    `;
    if (!team) {
      return c.json({ error: 'Team not found', error_key: 'case_team.team_not_found' }, 404);
    }

    const role = body.role ?? (team.default_case_role as string) ?? 'case_contributor';

    await sql`
      INSERT INTO case_team_assignments (case_id, team_id, role, assigned_by)
      VALUES (${caseId}, ${body.team_id}, ${role}, ${user.user_id})
      ON CONFLICT (case_id, team_id) DO UPDATE SET role = ${role}, assigned_by = ${user.user_id}, assigned_at = NOW()
    `;

    await auditLog(sql, c, {
      action: 'case.team_assigned',
      resource_type: 'case',
      resource_id: caseId,
      details: { team_id: body.team_id, role },
    });

    return c.json({ status: 'assigned', case_id: caseId, team_id: body.team_id, role }, 201);
  });

  return app;
}
