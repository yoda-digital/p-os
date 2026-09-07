# i18n + ABAC + Superadmin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full internationalization (ro/ru/en with separate interface vs. content language), hierarchical ABAC policy engine, system-organization superadmin, professional multi-user/multi-group system with invitations, teams, org units, and audit logging to the running Universal Process OS.

**Architecture:** Database migration adds all new tables (invitations, policies, team_memberships, case_team_assignments, organizational_units, unit_memberships, case_access_grants, audit_log) and columns (users: preferred_language/timezone/avatar_url/status, cases: content_language, organizations: is_system). ABAC policy engine evaluates subject/action/resource/environment conditions. react-i18next handles UI translations with namespace-per-feature. System org (`__system__`) provides superadmin scope.

**Tech Stack:** TypeScript, PostgreSQL, Hono, react-i18next, i18next, jose (JWT), React 19, Vite 6, Tailwind CSS 4, Zustand, @tanstack/react-query

**Spec:** `docs/superpowers/specs/2026-09-07-i18n-rbac-superadmin-design.md`

## Global Constraints

- Node.js ≥ 22, TypeScript strict mode, ESM throughout
- All IDs are UUIDv7
- All state mutations go through Commands → Events → Projections
- Three languages: `ro` (Romanian, default), `ru` (Russian), `en` (English)
- Default deny authorization — no policy match = denied
- System org ID: `00000000-0000-0000-0000-000000000000`
- All API mutations log to `audit_log` table
- Backend error responses include `error_key` for i18n resolution

---

### Task 1: Database Migration — RBAC, i18n, Audit Tables

**Files:**
- Create: `packages/db/src/migrations/002_rbac_i18n.sql`

**Interfaces:**
- Consumes: existing 001_initial.sql schema (organizations, users, memberships, teams, workspaces, cases tables)
- Produces: all new tables and columns for ABAC, invitations, audit, i18n

- [ ] **Step 1: Write migration SQL**

Create `packages/db/src/migrations/002_rbac_i18n.sql`:

```sql
-- 002_rbac_i18n.sql — ABAC, i18n, Audit, Superadmin

-- === ALTER EXISTING TABLES ===

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_cases INTEGER DEFAULT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(5) NOT NULL DEFAULT 'ro';
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'Europe/Chisinau';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE cases ADD COLUMN IF NOT EXISTS content_language VARCHAR(5) NOT NULL DEFAULT 'ro';

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';

-- === ORGANIZATIONAL UNITS ===

CREATE TABLE IF NOT EXISTS organizational_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  parent_id UUID REFERENCES organizational_units(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_units_org ON organizational_units(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_units_parent ON organizational_units(parent_id);

CREATE TABLE IF NOT EXISTS unit_memberships (
  unit_id UUID NOT NULL REFERENCES organizational_units(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (unit_id, user_id)
);

-- === TEAM ENHANCEMENTS ===

ALTER TABLE teams ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS default_case_role VARCHAR(50) DEFAULT 'case_contributor';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS policies JSONB DEFAULT '{}';

CREATE TABLE IF NOT EXISTS team_memberships (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'team_member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS case_team_assignments (
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'case_contributor',
  assigned_by UUID NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, team_id)
);

-- === INVITATIONS ===

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'org_member',
  team_id UUID REFERENCES teams(id),
  workspace_id UUID REFERENCES workspaces(id),
  token VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  message TEXT,
  invited_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);

-- === ABAC POLICIES ===

CREATE TABLE IF NOT EXISTS policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  subject JSONB NOT NULL DEFAULT '[]',
  actions JSONB NOT NULL DEFAULT '[]',
  resource JSONB NOT NULL DEFAULT '[]',
  environment JSONB NOT NULL DEFAULT '[]',
  effect VARCHAR(10) NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow', 'deny')),
  priority INTEGER NOT NULL DEFAULT 0,
  scope VARCHAR(20) NOT NULL DEFAULT 'organization' CHECK (scope IN ('system', 'organization', 'workspace', 'case')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_policies_org ON policies(organization_id, active);
CREATE INDEX IF NOT EXISTS idx_policies_scope ON policies(scope, active);

-- === CASE ACCESS GRANTS ===

CREATE TABLE IF NOT EXISTS case_access_grants (
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'case_viewer',
  granted_by UUID NOT NULL REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, user_id)
);

-- === AUDIT LOG ===

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  actor_email VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id UUID,
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  impersonated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id);

-- === USER SESSIONS ===

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_info JSONB DEFAULT '{}',
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expired_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, expired_at);

-- === SEED SYSTEM ORGANIZATION ===

INSERT INTO organizations (id, name, slug, is_system)
VALUES ('00000000-0000-0000-0000-000000000000', 'System', '__system__', true)
ON CONFLICT (id) DO NOTHING;

-- === SEED DEFAULT SYSTEM POLICIES ===

-- Default deny-all base policy (lowest priority)
INSERT INTO policies (id, organization_id, name, description, subject, actions, resource, environment, effect, priority, scope, active, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'Default Deny',
  'Base policy: deny everything not explicitly allowed',
  '[]'::jsonb,
  '["*"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'deny',
  -1000,
  'system',
  true,
  '00000000-0000-0000-0000-000000000000'
) ON CONFLICT (id) DO NOTHING;

-- Allow superadmins everything
INSERT INTO policies (id, organization_id, name, description, subject, actions, resource, environment, effect, priority, scope, active, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  NULL,
  'Superadmin Allow All',
  'Superadmins can do everything',
  '[{"attribute": "actor.is_system_member", "operator": "eq", "value": true}]'::jsonb,
  '["*"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'allow',
  10000,
  'system',
  true,
  '00000000-0000-0000-0000-000000000000'
) ON CONFLICT (id) DO NOTHING;

-- Allow org members basic operations in their org
INSERT INTO policies (id, organization_id, name, description, subject, actions, resource, environment, effect, priority, scope, active, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000003',
  NULL,
  'Org Member Base',
  'Organization members can read and create within their org',
  '[{"attribute": "actor.roles", "operator": "contains", "value": "org_member"}]'::jsonb,
  '["case.create","case.read","move.create","move.read","move.activate","move.pause","move.resume","decision.create","decision.read","evidence.attach","evidence.read","intent.create","intent.read","entity.create","entity.read","relation.add","relation.read","rule.create","rule.read","actor.read","resource.read","steering.send","steering.read","attempt.read","simulation.create","simulation.read"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'allow',
  100,
  'system',
  true,
  '00000000-0000-0000-0000-000000000000'
) ON CONFLICT (id) DO NOTHING;

-- Allow org admins to manage their org
INSERT INTO policies (id, organization_id, name, description, subject, actions, resource, environment, effect, priority, scope, active, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000004',
  NULL,
  'Org Admin Manage',
  'Org admins can manage members, teams, policies, and all case operations',
  '[{"attribute": "actor.roles", "operator": "contains", "value": "org_admin"}]'::jsonb,
  '["*"]'::jsonb,
  '[{"attribute": "resource.organization_id", "operator": "eq", "value": "__actor_org__"}]'::jsonb,
  '[]'::jsonb,
  'allow',
  500,
  'system',
  true,
  '00000000-0000-0000-0000-000000000000'
) ON CONFLICT (id) DO NOTHING;

-- Allow org viewers read-only access
INSERT INTO policies (id, organization_id, name, description, subject, actions, resource, environment, effect, priority, scope, active, created_by)
VALUES (
  '00000000-0000-0000-0000-000000000005',
  NULL,
  'Org Viewer Read',
  'Org viewers can only read',
  '[{"attribute": "actor.roles", "operator": "contains", "value": "org_viewer"}]'::jsonb,
  '["case.read","move.read","decision.read","evidence.read","intent.read","entity.read","relation.read","rule.read","actor.read","resource.read","attempt.read"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  'allow',
  50,
  'system',
  true,
  '00000000-0000-0000-0000-000000000000'
) ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `npx tsx packages/db/src/start.ts` (should start PG and apply migration)

Then verify new tables exist:
```bash
curl -s http://localhost:4000/api/health
# Should return ok if API starts with the new schema
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/migrations/002_rbac_i18n.sql
git commit -m "feat: add RBAC, i18n, audit, invitation schema (migration 002)"
```

---

### Task 2: ABAC Policy Engine

**Files:**
- Rewrite: `packages/policy/src/index.ts`
- Create: `packages/policy/src/evaluate.ts`
- Create: `packages/policy/src/types.ts`
- Create: `packages/policy/src/loader.ts`

**Interfaces:**
- Consumes: `policies` table from migration 002, `memberships`, `team_memberships`, `unit_memberships`, `case_access_grants` tables
- Produces: `authorize(request: AuthorizationRequest): Promise<AuthorizationResult>`, `loadActorContext(sql, userId, orgId): Promise<ActorContext>`

- [ ] **Step 1: Create ABAC types**

Create `packages/policy/src/types.ts`:

```typescript
export interface AttributeCondition {
  attribute: string;
  operator: 'eq' | 'ne' | 'in' | 'not_in' | 'contains' | 'gte' | 'lte' | 'exists' | 'matches';
  value: unknown;
}

export interface Policy {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  subject: AttributeCondition[];
  actions: string[];
  resource: AttributeCondition[];
  environment: AttributeCondition[];
  effect: 'allow' | 'deny';
  priority: number;
  scope: 'system' | 'organization' | 'workspace' | 'case';
  active: boolean;
}

export interface ActorContext {
  user_id: string;
  email: string;
  organization_id: string;
  roles: string[];
  teams: string[];
  org_units: string[];
  case_grants: Map<string, string>; // case_id → role
  is_system_member: boolean;
}

export interface ResourceContext {
  type: string;
  id?: string;
  case_id?: string;
  workspace_id?: string;
  organization_id?: string;
  attributes: Record<string, unknown>;
}

export interface EnvironmentContext {
  timestamp: string;
  ip?: string;
  device_id?: string;
}

export interface AuthorizationRequest {
  actor: ActorContext;
  action: string;
  resource: ResourceContext;
  environment: EnvironmentContext;
}

export interface AuthorizationResult {
  allowed: boolean;
  matching_policy_id: string | null;
  reason: string;
}
```

- [ ] **Step 2: Create policy evaluator**

Create `packages/policy/src/evaluate.ts`:

```typescript
import type { AttributeCondition, Policy, AuthorizationRequest, AuthorizationResult } from './types.js';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCondition(condition: AttributeCondition, context: Record<string, unknown>): boolean {
  const actual = getNestedValue(context, condition.attribute);
  const expected = condition.value;

  switch (condition.operator) {
    case 'eq': return actual === expected;
    case 'ne': return actual !== expected;
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'not_in': return Array.isArray(expected) && !expected.includes(actual);
    case 'contains': {
      if (Array.isArray(actual)) return actual.includes(expected);
      if (typeof actual === 'string') return actual.includes(String(expected));
      return false;
    }
    case 'gte': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lte': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'exists': return actual !== undefined && actual !== null;
    case 'matches': {
      if (typeof actual !== 'string' || typeof expected !== 'string') return false;
      return new RegExp(expected).test(actual);
    }
    default: return false;
  }
}

function evaluateConditions(conditions: AttributeCondition[], context: Record<string, unknown>): boolean {
  if (conditions.length === 0) return true; // no conditions = matches all
  return conditions.every(c => evaluateCondition(c, context));
}

function actionMatches(policyActions: string[], requestedAction: string): boolean {
  return policyActions.some(pa => pa === '*' || pa === requestedAction);
}

function resolveSpecialValues(conditions: AttributeCondition[], actor: Record<string, unknown>): AttributeCondition[] {
  return conditions.map(c => {
    if (c.value === '__actor_org__') {
      return { ...c, value: actor['organization_id'] };
    }
    return c;
  });
}

export function evaluate(policies: Policy[], request: AuthorizationRequest): AuthorizationResult {
  const actorCtx = { actor: request.actor as unknown as Record<string, unknown> };
  const resourceCtx = { resource: request.resource as unknown as Record<string, unknown> };
  const envCtx = { environment: request.environment as unknown as Record<string, unknown> };
  const fullCtx = { ...actorCtx, ...resourceCtx, ...envCtx };

  // Sort by priority descending
  const sorted = [...policies]
    .filter(p => p.active)
    .sort((a, b) => b.priority - a.priority);

  // System deny policies always win — check them first
  const systemDenies = sorted.filter(p => p.scope === 'system' && p.effect === 'deny' && p.priority > 0);
  for (const policy of systemDenies) {
    if (
      actionMatches(policy.actions, request.action) &&
      evaluateConditions(policy.subject, actorCtx) &&
      evaluateConditions(resolveSpecialValues(policy.resource, request.actor as unknown as Record<string, unknown>), resourceCtx) &&
      evaluateConditions(policy.environment, envCtx)
    ) {
      return { allowed: false, matching_policy_id: policy.id, reason: `Denied by system policy: ${policy.name}` };
    }
  }

  // Evaluate remaining policies by priority
  for (const policy of sorted) {
    if (!actionMatches(policy.actions, request.action)) continue;
    if (!evaluateConditions(policy.subject, actorCtx)) continue;
    if (!evaluateConditions(resolveSpecialValues(policy.resource, request.actor as unknown as Record<string, unknown>), resourceCtx)) continue;
    if (!evaluateConditions(policy.environment, envCtx)) continue;

    return {
      allowed: policy.effect === 'allow',
      matching_policy_id: policy.id,
      reason: `${policy.effect === 'allow' ? 'Allowed' : 'Denied'} by policy: ${policy.name}`,
    };
  }

  // Default deny
  return { allowed: false, matching_policy_id: null, reason: 'No matching policy — default deny' };
}
```

- [ ] **Step 3: Create actor context loader**

Create `packages/policy/src/loader.ts`:

```typescript
import type postgres from 'postgres';
import type { ActorContext } from './types.js';

type Sql = ReturnType<typeof postgres>;

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

// In-memory cache with TTL
const cache = new Map<string, { ctx: ActorContext; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function loadActorContext(sql: Sql, userId: string, organizationId: string): Promise<ActorContext> {
  const cacheKey = `${userId}:${organizationId}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.ctx;

  // Load user
  const [user] = await sql`SELECT id, email FROM users WHERE id = ${userId}`;
  if (!user) throw new Error('User not found');

  // Load membership roles for current org
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

  // If no explicit role in org, default to org_member if they have a membership
  if (!isSystemMember && roles.length === 0) {
    const hasOrgMembership = memberships.some(m => m.organization_id === organizationId);
    if (hasOrgMembership) roles.push('org_member');
  }

  // Load teams
  const teamRows = await sql`
    SELECT tm.team_id FROM team_memberships tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.user_id = ${userId} AND t.organization_id = ${organizationId} AND t.status = 'active'
  `;
  const teams = teamRows.map(r => r.team_id as string);

  // Load org units (recursive — include parent units)
  const unitRows = await sql`
    WITH RECURSIVE unit_tree AS (
      SELECT ou.id FROM organizational_units ou
      JOIN unit_memberships um ON um.unit_id = ou.id
      WHERE um.user_id = ${userId} AND ou.organization_id = ${organizationId}
      UNION
      SELECT ou.id FROM organizational_units ou
      JOIN unit_tree ut ON ou.id = ut.id
    )
    SELECT id FROM unit_tree
  `;
  const orgUnits = unitRows.map(r => r.id as string);

  // Load case grants
  const grantRows = await sql`
    SELECT case_id, role FROM case_access_grants WHERE user_id = ${userId}
  `;
  const caseGrants = new Map<string, string>();
  for (const g of grantRows) {
    caseGrants.set(g.case_id as string, g.role as string);
  }

  // Also add grants from team assignments
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
```

- [ ] **Step 4: Rewrite policy package barrel**

Rewrite `packages/policy/src/index.ts`:

```typescript
export { evaluate } from './evaluate.js';
export { loadActorContext, invalidateActorCache, invalidateAllCaches } from './loader.js';
export type {
  AttributeCondition,
  Policy,
  ActorContext,
  ResourceContext,
  EnvironmentContext,
  AuthorizationRequest,
  AuthorizationResult,
} from './types.js';
```

- [ ] **Step 5: Commit**

```bash
git add packages/policy/src/
git commit -m "feat: ABAC policy engine with condition evaluator and actor context loader"
```

---

### Task 3: Auth Middleware Upgrade + Audit Logger

**Files:**
- Rewrite: `apps/api/src/middleware/auth.ts`
- Create: `apps/api/src/middleware/audit.ts`
- Create: `apps/api/src/middleware/authorize.ts`

**Interfaces:**
- Consumes: `loadActorContext` and `evaluate` from `@pos/policy`, `policies` table
- Produces: `authenticateRequest` middleware, `authorize(action, resourceLoader?)` middleware factory, `auditLog(sql, entry)` function

- [ ] **Step 1: Rewrite auth middleware**

Rewrite `apps/api/src/middleware/auth.ts` to include `is_system` flag and `preferred_language` in JWT and AuthUser:

```typescript
import { type Context, type Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env['JWT_SECRET'] ?? 'pos-dev-secret-change-in-production'
);

export interface AuthUser {
  user_id: string;
  email: string;
  organization_id: string;
  roles: string[];
  is_system: boolean;
  preferred_language: string;
  impersonated_by?: string;
}

type Variables = { user: AuthUser };

export const authenticateRequest = createMiddleware<{ Variables: Variables }>(
  async (c: Context, next: Next) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header', error_key: 'auth.missing_token' }, 401);
    }
    const token = header.slice(7);
    try {
      const { payload } = await jose.jwtVerify(token, JWT_SECRET);
      c.set('user', {
        user_id: payload['user_id'] as string,
        email: payload['email'] as string,
        organization_id: payload['organization_id'] as string,
        roles: (payload['roles'] as string[]) ?? ['org_member'],
        is_system: (payload['is_system'] as boolean) ?? false,
        preferred_language: (payload['preferred_language'] as string) ?? 'ro',
        impersonated_by: payload['impersonated_by'] as string | undefined,
      });
      await next();
    } catch {
      return c.json({ error: 'Invalid or expired token', error_key: 'auth.invalid_token' }, 401);
    }
  }
);

// Keep backward compat alias
export const authMiddleware = authenticateRequest;

export function getUser(c: Context): AuthUser {
  return c.get('user') as AuthUser;
}

export async function signJwt(payload: Record<string, unknown>): Promise<string> {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}
```

- [ ] **Step 2: Create authorization middleware**

Create `apps/api/src/middleware/authorize.ts`:

```typescript
import { type Context, type Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import type postgres from 'postgres';
import { evaluate, loadActorContext, type Policy, type ResourceContext } from '@pos/policy';
import { getUser } from './auth.js';

type Sql = ReturnType<typeof postgres>;
type ResourceLoader = (c: Context, sql: Sql) => Promise<ResourceContext>;

// Cache policies for 60 seconds
let policyCache: { policies: Policy[]; expires: number } | null = null;
const POLICY_CACHE_TTL = 60_000;

async function loadPolicies(sql: Sql): Promise<Policy[]> {
  if (policyCache && policyCache.expires > Date.now()) return policyCache.policies;

  const rows = await sql`SELECT * FROM policies WHERE active = true ORDER BY priority DESC`;
  const policies = rows.map(r => ({
    id: r.id as string,
    organization_id: r.organization_id as string | null,
    name: r.name as string,
    description: r.description as string | null,
    subject: r.subject as any[],
    actions: r.actions as string[],
    resource: r.resource as any[],
    environment: r.environment as any[],
    effect: r.effect as 'allow' | 'deny',
    priority: r.priority as number,
    scope: r.scope as 'system' | 'organization' | 'workspace' | 'case',
    active: true,
  }));

  policyCache = { policies, expires: Date.now() + POLICY_CACHE_TTL };
  return policies;
}

export function invalidatePolicyCache(): void {
  policyCache = null;
}

export function createAuthorizer(sql: Sql) {
  return function authorize(action: string, resourceLoader?: ResourceLoader) {
    return createMiddleware(async (c: Context, next: Next) => {
      const user = getUser(c);

      const actorCtx = await loadActorContext(sql, user.user_id, user.organization_id);
      const policies = await loadPolicies(sql);

      const resource: ResourceContext = resourceLoader
        ? await resourceLoader(c, sql)
        : { type: 'api', organization_id: user.organization_id, attributes: {} };

      const result = evaluate(policies, {
        actor: actorCtx,
        action,
        resource,
        environment: {
          timestamp: new Date().toISOString(),
          ip: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
        },
      });

      if (!result.allowed) {
        return c.json({
          error: 'Forbidden',
          error_key: 'auth.forbidden',
          reason: result.reason,
          policy_id: result.matching_policy_id,
        }, 403);
      }

      await next();
    });
  };
}
```

- [ ] **Step 3: Create audit logger**

Create `apps/api/src/middleware/audit.ts`:

```typescript
import type postgres from 'postgres';
import type { Context } from 'hono';
import { getUser } from './auth.js';

type Sql = ReturnType<typeof postgres>;

export interface AuditEntry {
  action: string;
  resource_type: string;
  resource_id?: string;
  details?: Record<string, unknown>;
}

export async function auditLog(sql: Sql, c: Context, entry: AuditEntry): Promise<void> {
  const user = getUser(c);
  try {
    await sql`
      INSERT INTO audit_log (organization_id, actor_id, actor_email, action, resource_type, resource_id, details, ip_address, user_agent, impersonated_by)
      VALUES (
        ${user.organization_id},
        ${user.user_id},
        ${user.email},
        ${entry.action},
        ${entry.resource_type},
        ${entry.resource_id ?? null},
        ${sql.json(entry.details ?? {})},
        ${c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null},
        ${c.req.header('user-agent') ?? null},
        ${user.impersonated_by ?? null}
      )
    `;
  } catch (err) {
    console.error('[Audit] Failed to log:', err);
    // Never fail the request because of audit logging
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/middleware/
git commit -m "feat: ABAC authorization middleware + audit logger"
```

---

### Task 4: i18n Foundation (react-i18next + Translation Files)

**Files:**
- Create: `apps/web/src/i18n/config.ts`
- Create: `apps/web/src/i18n/locales/ro/*.json` (18 namespace files)
- Create: `apps/web/src/i18n/locales/ru/*.json` (18 namespace files)
- Create: `apps/web/src/i18n/locales/en/*.json` (18 namespace files)
- Modify: `apps/web/src/main.tsx` (add i18n init)
- Modify: `apps/web/package.json` (add i18next deps)

**Interfaces:**
- Consumes: nothing
- Produces: `useTranslation(namespace)` hook available in all components, `i18n.changeLanguage(lang)` for switching

- [ ] **Step 1: Install i18n dependencies**

```bash
pnpm --filter @pos/web add i18next react-i18next i18next-browser-languagedetector
```

- [ ] **Step 2: Create i18n config**

Create `apps/web/src/i18n/config.ts`:

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import all locale files
import roCommon from './locales/ro/common.json';
import roAuth from './locales/ro/auth.json';
import roCases from './locales/ro/cases.json';
import roKanban from './locales/ro/kanban.json';
import roAttention from './locales/ro/attention.json';
import roTimeline from './locales/ro/timeline.json';
import roDependencies from './locales/ro/dependencies.json';
import roEvidence from './locales/ro/evidence.json';
import roDecisions from './locales/ro/decisions.json';
import roCompliance from './locales/ro/compliance.json';
import roActors from './locales/ro/actors.json';
import roResources from './locales/ro/resources.json';
import roRisk from './locales/ro/risk.json';
import roWhy from './locales/ro/why.json';
import roTimeTravel from './locales/ro/time-travel.json';
import roSimulation from './locales/ro/simulation.json';
import roIntelligence from './locales/ro/intelligence.json';
import roAdmin from './locales/ro/admin.json';

import ruCommon from './locales/ru/common.json';
import ruAuth from './locales/ru/auth.json';
import ruCases from './locales/ru/cases.json';
import ruKanban from './locales/ru/kanban.json';
import ruAttention from './locales/ru/attention.json';
import ruTimeline from './locales/ru/timeline.json';
import ruDependencies from './locales/ru/dependencies.json';
import ruEvidence from './locales/ru/evidence.json';
import ruDecisions from './locales/ru/decisions.json';
import ruCompliance from './locales/ru/compliance.json';
import ruActors from './locales/ru/actors.json';
import ruResources from './locales/ru/resources.json';
import ruRisk from './locales/ru/risk.json';
import ruWhy from './locales/ru/why.json';
import ruTimeTravel from './locales/ru/time-travel.json';
import ruSimulation from './locales/ru/simulation.json';
import ruIntelligence from './locales/ru/intelligence.json';
import ruAdmin from './locales/ru/admin.json';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enCases from './locales/en/cases.json';
import enKanban from './locales/en/kanban.json';
import enAttention from './locales/en/attention.json';
import enTimeline from './locales/en/timeline.json';
import enDependencies from './locales/en/dependencies.json';
import enEvidence from './locales/en/evidence.json';
import enDecisions from './locales/en/decisions.json';
import enCompliance from './locales/en/compliance.json';
import enActors from './locales/en/actors.json';
import enResources from './locales/en/resources.json';
import enRisk from './locales/en/risk.json';
import enWhy from './locales/en/why.json';
import enTimeTravel from './locales/en/time-travel.json';
import enSimulation from './locales/en/simulation.json';
import enIntelligence from './locales/en/intelligence.json';
import enAdmin from './locales/en/admin.json';

const ns = ['common','auth','cases','kanban','attention','timeline','dependencies','evidence','decisions','compliance','actors','resources','risk','why','time-travel','simulation','intelligence','admin'] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ro: { common: roCommon, auth: roAuth, cases: roCases, kanban: roKanban, attention: roAttention, timeline: roTimeline, dependencies: roDependencies, evidence: roEvidence, decisions: roDecisions, compliance: roCompliance, actors: roActors, resources: roResources, risk: roRisk, why: roWhy, 'time-travel': roTimeTravel, simulation: roSimulation, intelligence: roIntelligence, admin: roAdmin },
      ru: { common: ruCommon, auth: ruAuth, cases: ruCases, kanban: ruKanban, attention: ruAttention, timeline: ruTimeline, dependencies: ruDependencies, evidence: ruEvidence, decisions: ruDecisions, compliance: ruCompliance, actors: ruActors, resources: ruResources, risk: ruRisk, why: ruWhy, 'time-travel': ruTimeTravel, simulation: ruSimulation, intelligence: ruIntelligence, admin: ruAdmin },
      en: { common: enCommon, auth: enAuth, cases: enCases, kanban: enKanban, attention: enAttention, timeline: enTimeline, dependencies: enDependencies, evidence: enEvidence, decisions: enDecisions, compliance: enCompliance, actors: enActors, resources: enResources, risk: enRisk, why: enWhy, 'time-travel': enTimeTravel, simulation: enSimulation, intelligence: enIntelligence, admin: enAdmin },
    },
    fallbackLng: 'ro',
    defaultNS: 'common',
    ns: ns as unknown as string[],
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'pos_language',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
export type SupportedLanguage = 'ro' | 'ru' | 'en';
export const SUPPORTED_LANGUAGES: { code: SupportedLanguage; label: string; flag: string }[] = [
  { code: 'ro', label: 'Română', flag: '🇲🇩' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
];
```

- [ ] **Step 3: Create all 18 Romanian translation files**

This step creates every JSON file for the `ro` locale. Each file contains ALL strings for that namespace extracted from the existing hardcoded component text.

The agentic worker should: read each component file that uses the namespace, extract every hardcoded string, and create the corresponding JSON with nested keys. Key naming convention: `section.element.state` (e.g., `board.title`, `card.execution.running`, `empty.title`).

Create all files under `apps/web/src/i18n/locales/ro/`. Example for `common.json`:

```json
{
  "app_name": "Universal Process OS",
  "nav": {
    "cases": "Cazuri",
    "all_cases": "Toate cazurile",
    "settings": "Setări",
    "admin": "Administrare",
    "logout": "Ieșire"
  },
  "actions": {
    "create": "Creează",
    "edit": "Editează",
    "delete": "Șterge",
    "save": "Salvează",
    "cancel": "Anulează",
    "close": "Închide",
    "confirm": "Confirmă",
    "submit": "Trimite",
    "search": "Caută",
    "filter": "Filtrează",
    "refresh": "Reîncarcă",
    "back": "Înapoi",
    "next": "Următorul",
    "previous": "Anterior",
    "loading": "Se încarcă...",
    "saving": "Se salvează...",
    "no_results": "Niciun rezultat",
    "error": "Eroare",
    "success": "Succes",
    "view_all": "Vezi toate",
    "sign_in": "Conectare",
    "sign_up": "Înregistrare"
  },
  "status": {
    "open": "deschis",
    "closed": "închis",
    "dormant": "inactiv",
    "archived": "arhivat",
    "active": "activ",
    "paused": "în pauză",
    "running": "în execuție",
    "not_started": "neînceput",
    "finished": "finalizat",
    "satisfied": "satisfăcut",
    "unsatisfied": "nesatisfăcut"
  },
  "priority": {
    "critical": "Critic",
    "high": "Înalt",
    "medium": "Mediu",
    "low": "Scăzut"
  },
  "language": {
    "ro": "Română",
    "ru": "Русский",
    "en": "English",
    "interface": "Limba interfeței",
    "content": "Limba conținutului"
  },
  "time": {
    "just_now": "chiar acum",
    "minutes_ago": "acum {{count}} minute",
    "hours_ago": "acum {{count}} ore",
    "days_ago": "acum {{count}} zile"
  },
  "user": {
    "profile": "Profil",
    "organization": "Organizație",
    "switch_org": "Schimbă organizația"
  },
  "errors": {
    "network": "Eroare de rețea",
    "unauthorized": "Neautorizat",
    "forbidden": "Acces interzis",
    "not_found": "Nu a fost găsit",
    "server_error": "Eroare de server",
    "validation": "Date invalide"
  }
}
```

Create similar files for: `auth.json`, `cases.json`, `kanban.json`, `attention.json`, `timeline.json`, `dependencies.json`, `evidence.json`, `decisions.json`, `compliance.json`, `actors.json`, `resources.json`, `risk.json`, `why.json`, `time-travel.json`, `simulation.json`, `intelligence.json`, `admin.json`.

- [ ] **Step 4: Create Russian and English translation files**

Copy the Romanian structure and translate to Russian and English. Same keys, different values. Russian uses Cyrillic. English uses the existing hardcoded strings.

- [ ] **Step 5: Add i18n init to main.tsx**

Modify `apps/web/src/main.tsx` — add `import './i18n/config';` before the App import:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './i18n/config';  // ← ADD THIS LINE
import { App } from './app';
import './app.css';
// ... rest unchanged
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/i18n/ apps/web/src/main.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat: i18n foundation — react-i18next with ro/ru/en translation files"
```

---

### Task 5: API Routes — Auth Profile, Org Switch, Invitations, Teams, Policies, Admin, Audit

**Files:**
- Modify: `apps/api/src/routes/auth.ts` (add profile update, org switch, language change)
- Create: `apps/api/src/routes/invitations.ts`
- Create: `apps/api/src/routes/teams-management.ts`
- Create: `apps/api/src/routes/org-units.ts`
- Create: `apps/api/src/routes/policy-management.ts`
- Create: `apps/api/src/routes/members.ts`
- Create: `apps/api/src/routes/case-access.ts`
- Create: `apps/api/src/routes/audit.ts`
- Create: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/index.ts` (register new routes)

**Interfaces:**
- Consumes: `authenticateRequest`, `createAuthorizer`, `auditLog` from middleware, all new DB tables
- Produces: REST endpoints per spec §5.1

This is a large task. The agentic worker should implement each route file following the existing pattern (Hono router factory receiving `sql`, using `authMiddleware` + `getUser`). Each route file should:
1. Use `authenticateRequest` middleware
2. Call `auditLog` on mutations
3. Return `error_key` in error responses for i18n
4. Follow the exact endpoint paths from the spec

Key implementation notes:

- **Auth profile update** (`PATCH /v1/auth/profile`): updates `preferred_language`, `timezone`, `display_name`, `avatar_url`. Emits `UserLanguageChanged` event when language changes.
- **Org switch** (`POST /v1/auth/switch-org`): validates user has membership in target org, issues new JWT with the new `organization_id`.
- **Invitations**: token generation uses `crypto.randomBytes(32).toString('hex')`, expiry default 7 days.
- **Admin routes**: all guarded by `is_system` check on the auth user. First superadmin bootstrap: check `SUPERADMIN_EMAIL` env var in the API startup, auto-grant system org membership on first login match.
- **Impersonation** (`POST /v1/admin/impersonate/:id`): issues a new JWT with the target user's identity but `impersonated_by` set to the superadmin's user_id. All actions during impersonation are audited with `impersonated_by`.

- [ ] **Step 1-8: Implement each route file**

The agentic worker creates each file following the patterns established in existing routes like `apps/api/src/routes/auth.ts` and `apps/api/src/routes/cases.ts`. Register all new routes in `apps/api/src/index.ts`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/ apps/api/src/index.ts
git commit -m "feat: API routes for invitations, teams, policies, admin, audit, profile"
```

---

### Task 6: Frontend i18n — Rewrite All Components

**Files:**
- Modify: ALL 30+ component files in `apps/web/src/components/`
- Create: `apps/web/src/components/common/language-switcher.tsx`
- Create: `apps/web/src/components/common/org-switcher.tsx`
- Modify: `apps/web/src/components/layout/app-layout.tsx` (add switchers to header)

**Interfaces:**
- Consumes: `useTranslation(namespace)` from react-i18next, `SUPPORTED_LANGUAGES` from i18n config
- Produces: Fully translated UI in all three languages

The agentic worker should:
1. For each component, add `const { t } = useTranslation('namespace');` at the top
2. Replace every hardcoded string with `t('key')` using the keys from the translation files
3. Create `LanguageSwitcher` component (dropdown with flag + language name, calls `i18n.changeLanguage()` + persists to API)
4. Create `OrgSwitcher` component (dropdown showing user's orgs, calls `api.switchOrg()` on change)
5. Add both switchers to the app header in `app-layout.tsx`
6. Update date/number formatting to use `Intl` with the current locale

- [ ] **Step 1-4: Rewrite components with useTranslation()**

Process each component file. The pattern for every file:

```tsx
// Before:
<h2>Kanban Board</h2>
<span>No moves yet</span>

// After:
import { useTranslation } from 'react-i18next';
// ...
const { t } = useTranslation('kanban');
// ...
<h2>{t('board.title')}</h2>
<span>{t('empty.title')}</span>
```

- [ ] **Step 5: Create LanguageSwitcher**

```tsx
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n/config';
import { api } from '../../lib/api';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = SUPPORTED_LANGUAGES.find(l => l.code === i18n.language) ?? SUPPORTED_LANGUAGES[0]!;

  const handleChange = async (lang: SupportedLanguage) => {
    await i18n.changeLanguage(lang);
    localStorage.setItem('pos_language', lang);
    try { await api.updateProfile({ preferred_language: lang }); } catch { /* offline ok */ }
  };

  return (
    <div className="relative group">
      <button className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-sm">
        <span>{current.flag}</span>
        <span className="hidden sm:inline">{current.label}</span>
      </button>
      <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg hidden group-hover:block z-50 min-w-[140px]">
        {SUPPORTED_LANGUAGES.map(lang => (
          <button
            key={lang.code}
            onClick={() => handleChange(lang.code)}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-2 ${lang.code === i18n.language ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400' : ''}`}
          >
            <span>{lang.flag}</span> {lang.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/
git commit -m "feat: i18n all components (ro/ru/en) + language/org switchers"
```

---

### Task 7: Frontend — Admin Panel + Settings Pages

**Files:**
- Create: `apps/web/src/components/admin/admin-layout.tsx`
- Create: `apps/web/src/components/admin/admin-dashboard.tsx`
- Create: `apps/web/src/components/admin/admin-organizations.tsx`
- Create: `apps/web/src/components/admin/admin-users.tsx`
- Create: `apps/web/src/components/admin/admin-audit.tsx`
- Create: `apps/web/src/components/admin/admin-packs.tsx`
- Create: `apps/web/src/components/admin/admin-policies.tsx`
- Create: `apps/web/src/components/admin/admin-health.tsx`
- Create: `apps/web/src/components/settings/profile-settings.tsx`
- Create: `apps/web/src/components/settings/org-settings.tsx`
- Create: `apps/web/src/components/settings/team-management.tsx`
- Create: `apps/web/src/components/settings/member-management.tsx`
- Create: `apps/web/src/components/settings/invitation-management.tsx`
- Create: `apps/web/src/components/settings/policy-editor.tsx`
- Modify: `apps/web/src/app.tsx` (add admin + settings routes)
- Modify: `apps/web/src/lib/api.ts` (add admin + settings API methods)

**Interfaces:**
- Consumes: admin API endpoints, i18n `admin` namespace, `useAuthStore`
- Produces: Full admin panel (8 pages), settings pages (6 pages)

The agentic worker should implement each page as a React component following the existing view pattern (data fetching via react-query, Tailwind styling, i18n via `useTranslation`). All admin pages are guarded by a `SystemGuard` component that checks `user.is_system`.

Key pages:
- **Admin Dashboard**: stats cards (total orgs, users, cases, events), recent activity
- **Admin Organizations**: table with search, create dialog, disable/enable buttons
- **Admin Users**: table with search, role management dropdown, disable/suspend/reactivate
- **Admin Audit**: filterable table (by action, resource_type, actor, date range)
- **Admin Health**: live stats cards (event count, projection lag, active sessions, DB stats)
- **Profile Settings**: display_name, email (readonly), language, timezone, avatar
- **Team Management**: team list, create team, add/remove members, assign to cases
- **Member Management**: member list with role dropdown, invite button
- **Invitation Management**: pending invitations table, resend/revoke actions
- **Policy Editor**: policy list, create/edit dialog with condition builder

- [ ] **Step 1-6: Create all admin and settings components**

- [ ] **Step 7: Update app.tsx with new routes**

Add to `apps/web/src/app.tsx`:

```tsx
// New imports for admin + settings
import { AdminLayout } from './components/admin/admin-layout';
import { AdminDashboard } from './components/admin/admin-dashboard';
// ... etc

// Inside Routes, after AuthGuard:
<Route path="/admin" element={<SystemGuard><AdminLayout /></SystemGuard>}>
  <Route index element={<AdminDashboard />} />
  <Route path="organizations" element={<AdminOrganizations />} />
  <Route path="users" element={<AdminUsers />} />
  <Route path="audit" element={<AdminAudit />} />
  <Route path="packs" element={<AdminPacks />} />
  <Route path="policies" element={<AdminPolicies />} />
  <Route path="health" element={<AdminHealth />} />
</Route>
<Route path="/settings" element={<AppLayout />}>
  <Route path="profile" element={<ProfileSettings />} />
  <Route path="organization" element={<OrgSettings />} />
  <Route path="teams" element={<TeamManagement />} />
  <Route path="members" element={<MemberManagement />} />
  <Route path="policies" element={<PolicyEditor />} />
</Route>
<Route path="/invite/:token" element={<InvitationAccept />} />
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/
git commit -m "feat: admin panel (8 pages) + settings pages + invitation accept"
```

---

### Task 8: Superadmin Bootstrap + Integration Test

**Files:**
- Create: `apps/api/src/cli/create-superadmin.ts`
- Modify: `apps/api/src/index.ts` (add superadmin bootstrap on startup)

**Interfaces:**
- Consumes: `SUPERADMIN_EMAIL` env var, `__system__` org from migration
- Produces: CLI command for manual superadmin creation, auto-bootstrap on first boot

- [ ] **Step 1: Create superadmin CLI**

Create `apps/api/src/cli/create-superadmin.ts`:

```typescript
import { getDb } from '@pos/db';
import { scryptSync, randomBytes } from 'node:crypto';

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: npx tsx apps/api/src/cli/create-superadmin.ts <email> <password>');
    process.exit(1);
  }

  const sql = getDb();

  // Check if user exists
  let [user] = await sql`SELECT id FROM users WHERE email = ${email}`;

  if (!user) {
    const userId = crypto.randomUUID();
    const passwordHash = hashPassword(password);
    await sql`
      INSERT INTO users (id, email, display_name, password_hash, status)
      VALUES (${userId}, ${email}, 'Superadmin', ${passwordHash}, 'active')
    `;
    user = { id: userId };
    console.log(`Created user ${email} (${userId})`);
  } else {
    console.log(`User ${email} already exists (${user.id})`);
  }

  // Check if already superadmin
  const [existing] = await sql`
    SELECT 1 FROM memberships WHERE user_id = ${user.id} AND organization_id = ${SYSTEM_ORG_ID}
  `;

  if (existing) {
    console.log(`User ${email} is already a superadmin`);
  } else {
    await sql`
      INSERT INTO memberships (user_id, organization_id, role, status)
      VALUES (${user.id}, ${SYSTEM_ORG_ID}, 'superadmin', 'active')
    `;
    console.log(`Granted superadmin role to ${email}`);
  }

  await sql.end();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add startup bootstrap to API server**

In `apps/api/src/index.ts`, after migrations, add:

```typescript
// Bootstrap superadmin from env var
const superadminEmail = process.env['SUPERADMIN_EMAIL'];
if (superadminEmail) {
  const [existing] = await sql`
    SELECT u.id FROM users u
    JOIN memberships m ON m.user_id = u.id
    WHERE u.email = ${superadminEmail}
    AND m.organization_id = '00000000-0000-0000-0000-000000000000'
  `;
  if (!existing) {
    console.log(`[API] SUPERADMIN_EMAIL set — ${superadminEmail} will be granted superadmin on next login/register`);
    // Store pending superadmin grant (checked during auth)
    await sql`
      INSERT INTO invitations (organization_id, email, role, token, status, invited_by, expires_at)
      VALUES ('00000000-0000-0000-0000-000000000000', ${superadminEmail}, 'superadmin',
              ${'system-bootstrap-' + Date.now()}, 'pending',
              '00000000-0000-0000-0000-000000000000',
              NOW() + INTERVAL '365 days')
      ON CONFLICT DO NOTHING
    `;
  }
}
```

- [ ] **Step 3: End-to-end verification**

Run the full system: `npx tsx dev.ts`

Verify:
1. Migration 002 applies cleanly
2. System org exists in DB
3. Default policies seeded
4. Login still works
5. Case creation still works (ABAC allows org_member)
6. Language switcher visible and functional
7. Admin panel accessible for superadmin
8. All 13 existing views still render in all three languages

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: superadmin bootstrap + end-to-end integration"
```
