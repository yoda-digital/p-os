import type postgres from 'postgres';
import type { ActorContext } from './types.js';

type Sql = ReturnType<typeof postgres>;

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

// In-memory cache with TTL.
const cache = new Map<string, { ctx: ActorContext; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function loadActorContext(sql: Sql, userId: string, organizationId: string): Promise<ActorContext> {
  const cacheKey = `${userId}:${organizationId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.ctx;

  // Load user.
  const [user] = await sql`SELECT id, email FROM users WHERE id = ${userId}`;
  if (!user) throw new Error('User not found');

  // Load membership roles: both the requested org and the system org (superadmin/support/auditor).
  const memberships = await sql`
    SELECT organization_id, role FROM memberships
    WHERE user_id = ${userId} AND status = 'active'
  `;

  const roles: string[] = [];
  let isSystemMember = false;

  for (const m of memberships) {
    if (m.organization_id === SYSTEM_ORG_ID) {
      isSystemMember = true;
      roles.push(m.role as string); // superadmin, support, auditor
    }
    if (m.organization_id === organizationId) {
      roles.push(m.role as string);
    }
  }

  // If no explicit role in org, default to org_member if they have a membership.
  if (!isSystemMember && roles.length === 0) {
    const hasOrgMembership = memberships.some((m) => m.organization_id === organizationId);
    if (hasOrgMembership) roles.push('org_member');
  }

  // Load teams.
  const teamRows = await sql`
    SELECT tm.team_id FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ${userId} AND t.organization_id = ${organizationId} AND t.status = 'active'
  `;
  const teams = teamRows.map((r) => r.team_id as string);

  // Load org units — recursive walk up the parent chain so membership in a
  // unit implies membership in every ancestor unit too.
  const unitRows = await sql`
    WITH RECURSIVE unit_tree AS (
      SELECT ou.id, ou.parent_id FROM organizational_units ou
      JOIN unit_memberships um ON um.unit_id = ou.id
      WHERE um.user_id = ${userId} AND ou.organization_id = ${organizationId}
      UNION
      SELECT ou.id, ou.parent_id FROM organizational_units ou
      JOIN unit_tree ut ON ou.id = ut.parent_id
    )
    SELECT DISTINCT id FROM unit_tree
  `;
  const orgUnits = unitRows.map((r) => r.id as string);

  // Load direct case grants.
  const grantRows = await sql`
    SELECT case_id, role FROM case_access_grants WHERE user_id = ${userId}
  `;
  const caseGrants = new Map<string, string>();
  for (const g of grantRows) {
    caseGrants.set(g.case_id as string, g.role as string);
  }

  // Also add grants inherited from team case assignments (direct grants take precedence).
  if (teams.length > 0) {
    const teamGrants = await sql`
      SELECT case_id, role FROM case_team_assignments WHERE team_id = ANY(${teams})
    `;
    for (const tg of teamGrants) {
      if (!caseGrants.has(tg.case_id as string)) {
        caseGrants.set(tg.case_id as string, tg.role as string);
      }
    }
  }

  const ctx: ActorContext = {
    user_id: userId,
    email: user.email as string,
    organization_id: organizationId,
    roles,
    teams,
    org_units: orgUnits,
    case_grants: caseGrants,
    is_system_member: isSystemMember,
  };

  cache.set(cacheKey, { ctx, expires: Date.now() + CACHE_TTL });
  return ctx;
}

export function invalidateActorCache(userId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

export function invalidateAllCaches(): void {
  cache.clear();
}
