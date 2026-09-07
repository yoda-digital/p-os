# Universal Process OS — i18n, ABAC, Superadmin Design Spec

**Status:** Approved  
**Date:** 2026-09-07  
**Depends on:** Running system (API + Web + Worker + Realtime + Embedded PG)

---

## 1. Internationalization

### 1.1 Interface Language

Three supported languages: Romanian (`ro`, default), Russian (`ru`), English (`en`).

**Library:** `react-i18next` with `i18next` backend.

**Translation file structure:**
```
apps/web/src/i18n/
  ├── config.ts              # i18next init
  ├── locales/
  │   ├── ro/
  │   │   ├── common.json    # Shared: buttons, labels, errors, nav
  │   │   ├── auth.json      # Login, register, profile
  │   │   ├── cases.json     # Case list, create, detail
  │   │   ├── kanban.json    # Board, columns, cards, drag
  │   │   ├── attention.json
  │   │   ├── timeline.json
  │   │   ├── dependencies.json
  │   │   ├── evidence.json
  │   │   ├── decisions.json
  │   │   ├── compliance.json
  │   │   ├── actors.json
  │   │   ├── resources.json
  │   │   ├── risk.json
  │   │   ├── why.json
  │   │   ├── time-travel.json
  │   │   ├── simulation.json
  │   │   ├── intelligence.json
  │   │   ├── steering.json
  │   │   └── admin.json     # Superadmin panel
  │   ├── ru/
  │   │   └── (same files)
  │   └── en/
  │       └── (same files)
```

**Language resolution chain:**
1. User profile `preferred_language` from DB (set during login/register)
2. `localStorage` cache key `pos_language` (instant render before auth)
3. Browser `navigator.language` / `Accept-Language`
4. Default: `ro`

**Component pattern:**
```tsx
import { useTranslation } from 'react-i18next';

function KanbanBoard() {
  const { t } = useTranslation('kanban');
  return <h2>{t('board.title')}</h2>;  // "Tablou Kanban" / "Канбан-доска" / "Kanban Board"
}
```

**LanguageSwitcher component:**
- Rendered in the app header, next to user name
- Shows current language flag/code
- Dropdown with three options
- On change: updates `localStorage`, fires API call to persist to user profile, triggers i18next language change (instant UI update, no reload)

**Date/number formatting:**
- All dates via `Intl.DateTimeFormat(locale)`
- All numbers via `Intl.NumberFormat(locale)`
- Relative time via `Intl.RelativeTimeFormat(locale)` (e.g., "acum 2 ore" / "2 часа назад" / "2 hours ago")

**Backend error messages:**
- API returns error keys: `{ error_key: 'auth.invalid_credentials', error: 'Invalid credentials' }`
- Frontend resolves `error_key` through i18n if present, falls back to `error` string
- All API validation errors return translatable keys

### 1.2 Content/Process Language

**Case-level attribute:**
```sql
ALTER TABLE cases ADD COLUMN content_language VARCHAR(5) NOT NULL DEFAULT 'ro';
```

Values: `ro`, `ru`, `en`.

**Behavior:**
- Set at Case creation (dropdown in Create Case dialog, defaults to user's interface language)
- Displayed as a language badge on the case header
- Input fields on moves/evidence/decisions get `lang` and `spellcheck` HTML attributes matching the case content language
- WHY explanations and AI summaries respect content language
- Mixed-language content allowed — `content_language` is primary, not restrictive
- Case content language can be changed (emits `CaseContentLanguageChanged` event)

### 1.3 Backend i18n

- API error responses include `error_key` for frontend translation
- Seeded data (process pack names, default rule statements) stored with translations:
  ```json
  { "name": { "ro": "Livrare Software", "ru": "Разработка ПО", "en": "Software Delivery" } }
  ```
- Event summaries in timeline stored in the actor's interface language at time of action
- System-generated notifications use the recipient's preferred language

---

## 2. System Organization (Superadmin)

### 2.1 `__system__` Organization

Seeded during migration `002_rbac_i18n.sql`:

```sql
INSERT INTO organizations (id, name, slug, is_system)
VALUES ('00000000-0000-0000-0000-000000000000', 'System', '__system__', true);
```

- `is_system: boolean` column on `organizations` — exactly one org has this true
- Cannot be deleted, renamed, or archived
- Membership in `__system__` org grants cross-organization access

### 2.2 System Roles

| Role | Capabilities |
|------|-------------|
| `superadmin` | Full CRUD on all orgs, users, cases. Policy override. Impersonation. System config. |
| `support` | Read-only cross-org access. Can view cases, users, events. Cannot modify. |
| `auditor` | Read-only access to audit logs, compliance data, events across all orgs. |

### 2.3 Superadmin Capabilities

**Organization management:**
- List all organizations with stats (users, cases, events, storage)
- Create new organizations
- Disable/re-enable organizations (disabled org users cannot log in)
- Configure org-level settings (max users, max cases, feature flags)
- View org membership

**User management:**
- Global user search (by email, name, org)
- View any user profile
- Disable/suspend/reactivate users
- Reset user credentials
- Elevate/demote roles (including granting system roles)
- View user activity log

**Policy override:**
- Override any organization-level policy
- Every override emits `PolicyOverridden` event with:
  - `overriding_actor_id` (the superadmin)
  - `original_policy_id`
  - `override_reason` (required — superadmin must provide justification)
  - `override_duration` (optional — temporary overrides auto-revert)

**Impersonation:**
- Superadmin can act as any user
- Emits `ImpersonationStarted` event (actor: superadmin, target: impersonated user)
- All actions during impersonation are attributed to the impersonated user BUT tagged with `impersonated_by` in event metadata
- `ImpersonationEnded` event on exit
- Visible in audit log with distinct styling

**System health:**
- Active users (online now, daily/weekly/monthly active)
- Event throughput (events/second, total)
- Projection lag (time since last projection update)
- Database stats (table sizes, connection pool)
- Worker health (outbox lag, controller evaluation times)

### 2.4 First Superadmin Bootstrap

Environment variable `SUPERADMIN_EMAIL` checked on first boot:
1. If set and no superadmin exists: first user registering with that email gets superadmin
2. If not set: first user to register becomes superadmin (with warning in logs)
3. CLI command: `npx tsx apps/api/src/cli/create-superadmin.ts --email=admin@example.com --password=...`

### 2.5 Admin UI Routes

```
/admin                    → Dashboard (system stats overview)
/admin/organizations      → Org list + CRUD
/admin/organizations/:id  → Org detail (members, cases, settings)
/admin/users              → Global user search + management
/admin/users/:id          → User detail (memberships, activity, sessions)
/admin/audit              → System-wide audit log with filters
/admin/packs              → Process pack management
/admin/policies           → System-level policy editor
/admin/health             → System health dashboard
```

Protected by system org membership check. Non-system users see 404.

---

## 3. Professional Multi-User ABAC

### 3.1 Entity Hierarchy

```
System (__system__ org)
  └── Organization
       ├── Organizational Units (hierarchical departments)
       │    └── Sub-units (recursive)
       ├── Teams (cross-functional groups)
       │    └── Members + team roles
       ├── Workspaces (case containers)
       │    └── Cases (with case-level grants)
       └── Members (users with org roles)
```

### 3.2 Role Hierarchy

Each level can grant roles at its level or below. Higher roles inherit all lower permissions.

**System level:**
- `superadmin` — everything
- `support` — read-only cross-org
- `auditor` — audit/compliance read-only cross-org

**Organization level:**
- `org_owner` — full org control, billing, can delete org
- `org_admin` — manage members, teams, workspaces, policies; cannot delete org
- `org_manager` — manage cases, invite members; cannot manage policies
- `org_member` — create cases, participate; limited management
- `org_viewer` — read-only access to allowed cases
- `org_billing` — billing/subscription management only

**Workspace level:**
- `ws_admin` — manage workspace settings, cases, members within workspace
- `ws_member` — create/participate in cases within workspace
- `ws_viewer` — read-only within workspace

**Team level:**
- `team_lead` — manage team members, assign team to cases, set team policies
- `team_member` — participate in cases the team is assigned to

**Case level (explicit grants):**
- `case_owner` — full case control, can delete, manage access
- `case_contributor` — create/edit moves, attach evidence, participate in decisions
- `case_reviewer` — review, comment, approve/reject; cannot create moves
- `case_viewer` — read-only

### 3.3 ABAC Policy Engine

```typescript
interface Policy {
  id: string;
  organization_id: string | null; // null = system-level policy
  name: string;
  description: string;
  subject: AttributeCondition[];
  actions: string[];
  resource: AttributeCondition[];
  environment: AttributeCondition[];
  effect: 'allow' | 'deny';
  priority: number;
  scope: 'system' | 'organization' | 'workspace' | 'case';
  active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface AttributeCondition {
  attribute: string;
  operator: 'eq' | 'ne' | 'in' | 'not_in' | 'contains' | 'gte' | 'lte' | 'exists' | 'matches';
  value: unknown;
}

// Evaluation
interface AuthorizationRequest {
  actor: {
    user_id: string;
    roles: string[];           // all roles across all levels
    teams: string[];           // team IDs
    org_units: string[];       // org unit IDs
    organization_id: string;
    is_system_member: boolean;
  };
  action: string;              // 'case.create', 'move.activate', 'decision.resolve', etc.
  resource: {
    type: string;              // 'case', 'move', 'decision', 'evidence', etc.
    id?: string;
    case_id?: string;
    workspace_id?: string;
    organization_id?: string;
    attributes: Record<string, unknown>; // risk level, pack, lifecycle, etc.
  };
  environment: {
    timestamp: string;
    ip?: string;
    device_id?: string;
  };
}

interface AuthorizationResult {
  allowed: boolean;
  matching_policy_id: string | null;
  reason: string;
}
```

**Evaluation algorithm:**
1. Collect all applicable policies (system + org + workspace + case scope)
2. Filter to policies matching the action
3. Evaluate subject conditions against actor attributes
4. Evaluate resource conditions against resource attributes
5. Evaluate environment conditions
6. Among matching policies, apply priority ordering:
   - System `deny` policies always win (safety net)
   - Then highest priority matching policy wins
   - If no policy matches: **default deny**
7. Return result with matching policy ID for audit

**Action taxonomy:**
```
case.create, case.read, case.update, case.close, case.reopen, case.archive, case.delete
move.create, move.read, move.activate, move.pause, move.resume, move.cancel, move.satisfy
move.assign, move.change_priority, move.change_deadline, move.supersede
decision.create, decision.read, decision.resolve, decision.defer, decision.supersede
evidence.attach, evidence.read, evidence.invalidate, evidence.dispute
intent.create, intent.read, intent.update, intent.satisfy
rule.create, rule.read, rule.update, rule.supersede, rule.evaluate
entity.create, entity.read, entity.update, entity.remove
relation.add, relation.read, relation.remove
actor.create, actor.read, actor.update
resource.create, resource.read, resource.update, resource.reserve, resource.release
steering.send, steering.read
attempt.start, attempt.read, attempt.steer, attempt.cancel
simulation.create, simulation.read
admin.org.manage, admin.user.manage, admin.policy.manage, admin.audit.read
```

### 3.4 Invitation System

**Schema:**
```sql
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'org_member',
  team_id UUID REFERENCES teams(id),
  workspace_id UUID REFERENCES workspaces(id),
  token VARCHAR(255) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, accepted, expired, revoked
  message TEXT,                                     -- optional personal message
  invited_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Flow:**
1. Org admin/manager sends invitation (email + role + optional team/workspace)
2. System creates invitation record with unique token, expiry (default 7 days)
3. For now: invitation link displayed to admin (email integration later)
4. Invitee opens link → `/invite/:token` route
5. If not authenticated: redirect to register with email pre-filled, then auto-accept
6. If authenticated: auto-accept and join org with specified role
7. Events emitted: `InvitationCreated`, `InvitationAccepted`

**Bulk invite:**
- CSV upload (email, role, team_name)
- Creates multiple invitations in one transaction
- Shows results (created, duplicates, errors)

**Management:**
- Pending invitations dashboard (filterable by status)
- Revoke pending invitations
- Resend invitation (generates new token, extends expiry)

### 3.5 User Profile

```sql
ALTER TABLE users ADD COLUMN preferred_language VARCHAR(5) NOT NULL DEFAULT 'ro';
ALTER TABLE users ADD COLUMN timezone VARCHAR(50) NOT NULL DEFAULT 'Europe/Chisinau';
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';  -- active, suspended, disabled
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;
```

**Multi-org membership:**
A user can belong to multiple organizations. JWT payload includes the currently-selected org:
```json
{
  "user_id": "...",
  "email": "...",
  "organization_id": "current-org-id",
  "roles": ["org_admin"],
  "is_system": false
}
```

**Organization switcher:**
- Dropdown in header (next to language switcher)
- Shows all orgs the user belongs to
- Switching org refreshes JWT and reloads case list

### 3.6 Team Management

```sql
-- teams table already exists; add:
ALTER TABLE teams ADD COLUMN description TEXT;
ALTER TABLE teams ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';  -- active, archived
ALTER TABLE teams ADD COLUMN default_case_role VARCHAR(50) DEFAULT 'case_contributor';
ALTER TABLE teams ADD COLUMN policies JSONB DEFAULT '{}';

CREATE TABLE team_memberships (
  team_id UUID NOT NULL REFERENCES teams(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role VARCHAR(50) NOT NULL DEFAULT 'team_member',  -- team_lead, team_member
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE case_team_assignments (
  case_id UUID NOT NULL REFERENCES cases(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  role VARCHAR(50) NOT NULL DEFAULT 'case_contributor',
  assigned_by UUID NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, team_id)
);
```

When a team is assigned to a case, all team members get the specified case role.

### 3.7 Organizational Units

```sql
CREATE TABLE organizational_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  parent_id UUID REFERENCES organizational_units(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE unit_memberships (
  unit_id UUID NOT NULL REFERENCES organizational_units(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (unit_id, user_id)
);
```

Members inherit parent unit membership (recursive query for authorization).

### 3.8 Audit Log

```sql
CREATE TABLE audit_log (
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
  impersonated_by UUID REFERENCES users(id),  -- set during impersonation
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_org ON audit_log(organization_id, created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id, created_at DESC);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);
```

Every state-changing API call logs to the audit table.

### 3.9 Case Access Grants

```sql
CREATE TABLE case_access_grants (
  case_id UUID NOT NULL REFERENCES cases(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role VARCHAR(50) NOT NULL DEFAULT 'case_viewer',
  granted_by UUID NOT NULL REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, user_id)
);
```

Explicit per-user access grants on individual cases.

### 3.10 Authorization Middleware

Replace the current simple `authMiddleware` with a full authorization layer:

```typescript
// New middleware stack:
// 1. authenticateRequest — verify JWT, extract user
// 2. loadActorContext — fetch roles, teams, org units from DB (cached)
// 3. authorize(action, resourceLoader) — evaluate ABAC policies

app.use('*', authenticateRequest);

// Per-route authorization:
app.post('/v1/cases', authorize('case.create'), async (c) => { ... });
app.get('/v1/cases/:id', authorize('case.read', loadCaseResource), async (c) => { ... });
app.post('/v1/moves/:id/activate', authorize('move.activate', loadMoveResource), async (c) => { ... });
```

**Actor context caching:**
- On login: fetch all roles/teams/units, cache in memory with 5-minute TTL
- On role change: invalidate cache for affected user
- JWT includes basic roles; full context loaded from cache/DB for ABAC evaluation

---

## 4. UI Changes Summary

### 4.1 New Components

- `LanguageSwitcher` — header dropdown (ro/ru/en flags)
- `OrganizationSwitcher` — header dropdown for multi-org users
- `InvitationDialog` — invite users by email
- `BulkInviteDialog` — CSV upload
- `UserManagement` — org-level user list + role management
- `TeamManagement` — team CRUD + member management
- `PolicyEditor` — ABAC policy creation/editing
- `AuditLogViewer` — filterable event log
- Admin panel: 8 pages (dashboard, orgs, users, audit, packs, policies, health, settings)

### 4.2 Modified Components (i18n)

Every existing component gets `useTranslation()` — all hardcoded strings replaced with `t()` calls. This affects all 30+ components.

### 4.3 New Routes

```
/invite/:token          — Invitation acceptance
/settings/profile       — User profile + language + timezone
/settings/organization  — Org settings (admin only)
/settings/teams         — Team management
/settings/members       — Member management + invitations
/settings/policies      — Policy editor (admin only)
/admin/*                — Superadmin panel (8 pages)
```

---

## 5. API Changes Summary

### 5.1 New Endpoints

```
POST   /v1/auth/switch-org           — Switch active organization
PATCH  /v1/auth/profile              — Update profile (language, timezone, avatar)

GET    /v1/invitations               — List pending invitations
POST   /v1/invitations               — Create invitation
POST   /v1/invitations/:id/revoke    — Revoke invitation
POST   /v1/invitations/:token/accept — Accept invitation

GET    /v1/teams                     — List teams
POST   /v1/teams                     — Create team
PATCH  /v1/teams/:id                 — Update team
POST   /v1/teams/:id/members         — Add member
DELETE /v1/teams/:id/members/:userId — Remove member
POST   /v1/cases/:id/teams           — Assign team to case

GET    /v1/org-units                 — List org units (tree)
POST   /v1/org-units                 — Create unit
PATCH  /v1/org-units/:id             — Update unit

GET    /v1/policies                  — List policies
POST   /v1/policies                  — Create policy
PATCH  /v1/policies/:id              — Update policy
DELETE /v1/policies/:id              — Delete policy

GET    /v1/audit                     — Audit log (filtered)

GET    /v1/members                   — List org members
PATCH  /v1/members/:id               — Update member role
DELETE /v1/members/:id               — Remove member

POST   /v1/cases/:id/access          — Grant case access
DELETE /v1/cases/:id/access/:userId  — Revoke case access

# Admin endpoints (system org only)
GET    /v1/admin/organizations       — List all orgs
POST   /v1/admin/organizations       — Create org
PATCH  /v1/admin/organizations/:id   — Update org
GET    /v1/admin/users               — Search all users
PATCH  /v1/admin/users/:id           — Update user (disable/role)
POST   /v1/admin/impersonate/:id     — Start impersonation
POST   /v1/admin/impersonate/end     — End impersonation
GET    /v1/admin/audit               — System-wide audit log
GET    /v1/admin/health              — System health stats
```

### 5.2 Modified Endpoints

Every existing endpoint gets:
- ABAC authorization check (replace simple org_id check)
- Audit log entry on mutations
- Error responses with i18n keys

---

## 6. Migration Plan

Single migration file `002_rbac_i18n.sql`:
1. Add columns to existing tables (users, cases, organizations)
2. Create new tables (invitations, policies, team_memberships, case_team_assignments, organizational_units, unit_memberships, case_access_grants, audit_log, user_sessions)
3. Seed `__system__` organization
4. Seed default system policies (deny-all base, allow basic operations for org_member, etc.)
5. Create first superadmin if `SUPERADMIN_EMAIL` env var set
6. Add indexes

---

## 7. Event Types Added

```
InvitationCreated, InvitationAccepted, InvitationRevoked, InvitationExpired
TeamCreated, TeamUpdated, TeamArchived, TeamMemberAdded, TeamMemberRemoved
TeamAssignedToCase, TeamUnassignedFromCase
OrgUnitCreated, OrgUnitUpdated, UnitMemberAdded, UnitMemberRemoved
PolicyCreated, PolicyUpdated, PolicyDeleted, PolicyOverridden
CaseAccessGranted, CaseAccessRevoked
UserSuspended, UserReactivated, UserDisabled
ImpersonationStarted, ImpersonationEnded
CaseContentLanguageChanged
UserLanguageChanged
OrganizationCreated, OrganizationDisabled, OrganizationReactivated
MemberRoleChanged
```

All events follow the existing event envelope pattern with causation_id, correlation_id, actor_id attribution.
