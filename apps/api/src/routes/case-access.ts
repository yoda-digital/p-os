import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';

type Sql = ReturnType<typeof postgres>;

export function caseAccessRoutes(sql: Sql) {
  const app = new Hono();

  app.use('*', authMiddleware);

  // POST / — grant access to a case (mounted at /cases/:id/access)
  app.post('/', async (c) => {
    const user = getUser(c);
    const caseId = c.req.param('id') as string;
    const body = await c.req.json<{
      user_id: string;
      role?: string;
    }>();

    if (!body.user_id) {
      return c.json({ error: 'user_id is required', error_key: 'case_access.user_id_required' }, 400);
    }

    // Verify the case exists and belongs to user's org
    const [caseRow] = await sql`
      SELECT id FROM cases WHERE id = ${caseId} AND organization_id = ${user.organization_id}
    `;
    if (!caseRow) {
      return c.json({ error: 'Case not found', error_key: 'case_access.case_not_found' }, 404);
    }

    // Verify the target user is a member of the org
    const [membership] = await sql`
      SELECT user_id FROM memberships
      WHERE user_id = ${body.user_id} AND organization_id = ${user.organization_id}
    `;
    if (!membership) {
      return c.json({ error: 'User is not a member of this organization', error_key: 'case_access.user_not_in_org' }, 400);
    }

    const role = body.role ?? 'case_viewer';

    await sql`
      INSERT INTO case_access_grants (case_id, user_id, role, granted_by)
      VALUES (${caseId}, ${body.user_id}, ${role}, ${user.user_id})
      ON CONFLICT (case_id, user_id) DO UPDATE SET role = ${role}, granted_by = ${user.user_id}, granted_at = NOW()
    `;

    await auditLog(sql, c, {
      action: 'case_access.granted',
      resource_type: 'case',
      resource_id: caseId,
      details: { user_id: body.user_id, role },
    });

    return c.json({ status: 'granted', case_id: caseId, user_id: body.user_id, role }, 201);
  });

  // DELETE /:userId — revoke access from a case
  app.delete('/:userId', async (c) => {
    const user = getUser(c);
    const caseId = c.req.param('id') as string;
    const userId = c.req.param('userId') as string;

    // Verify the case exists and belongs to user's org
    const [caseRow] = await sql`
      SELECT id FROM cases WHERE id = ${caseId} AND organization_id = ${user.organization_id}
    `;
    if (!caseRow) {
      return c.json({ error: 'Case not found', error_key: 'case_access.case_not_found' }, 404);
    }

    const result = await sql`
      DELETE FROM case_access_grants WHERE case_id = ${caseId} AND user_id = ${userId}
    `;
    if (result.count === 0) {
      return c.json({ error: 'Access grant not found', error_key: 'case_access.not_found' }, 404);
    }

    await auditLog(sql, c, {
      action: 'case_access.revoked',
      resource_type: 'case',
      resource_id: caseId,
      details: { user_id: userId },
    });

    return c.json({ status: 'revoked' });
  });

  return app;
}
