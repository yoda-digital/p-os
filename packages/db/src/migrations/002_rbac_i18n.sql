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

-- === SEED SYSTEM USER ===
-- Required so the system policies below (created_by) satisfy the FK on users(id).
-- Not a login-capable account (empty password_hash blocks authentication).

INSERT INTO users (id, email, display_name, password_hash)
VALUES ('00000000-0000-0000-0000-000000000000', 'system@internal', 'System', '')
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
