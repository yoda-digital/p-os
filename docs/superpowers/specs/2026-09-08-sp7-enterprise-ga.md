# SP7: Enterprise + GA — Design Spec

**Status:** Approved  
**Date:** 2026-09-08  
**Depends on:** SP4 (Governance), SP6 (Integrations)  
**Source:** `implementation_plan.md` Phases 20-22, `specs_design.md`, `blueprint.md`

---

## 1. SSO Integration

### 1.1 OIDC Support

Standard OpenID Connect flow for enterprise identity providers:

```
User visits /login → redirect to IdP → authenticate → callback with id_token
→ validate token → find/create user → create session → redirect to app
```

**Supported providers:** Any OIDC-compliant IdP (Azure AD, Okta, Google Workspace, Keycloak).

### 1.2 SAML Support (Optional)

SAML 2.0 SP-initiated flow for legacy enterprise IdPs. Lower priority than OIDC.

### 1.3 Configuration

Per-organization SSO settings:

```typescript
interface SSOConfig {
  provider: 'oidc' | 'saml';
  issuer_url: string;        // OIDC discovery URL
  client_id: string;
  client_secret: EncryptedString;
  allowed_domains: string[]; // email domain restrictions
  auto_provision: boolean;   // auto-create users on first login
  default_role: string;      // role for auto-provisioned users
  enforce_sso: boolean;      // disable password login when true
}
```

### 1.4 API

```
GET    /v1/sso/config          — Get org SSO configuration
PUT    /v1/sso/config          — Set SSO configuration
GET    /v1/sso/login           — Initiate SSO flow
POST   /v1/sso/callback        — SSO callback handler
DELETE /v1/sso/config          — Remove SSO (revert to password)
```

---

## 2. SCIM Provisioning

### 2.1 SCIM 2.0 Server

Expose standard SCIM endpoints for automated user/group sync:

```
GET    /scim/v2/Users           — List users
POST   /scim/v2/Users           — Create user
GET    /scim/v2/Users/:id       — Get user
PUT    /scim/v2/Users/:id       — Replace user
PATCH  /scim/v2/Users/:id       — Update user (partial)
DELETE /scim/v2/Users/:id       — Deactivate user

GET    /scim/v2/Groups          — List groups (→ teams)
POST   /scim/v2/Groups          — Create group
GET    /scim/v2/Groups/:id      — Get group
PUT    /scim/v2/Groups/:id      — Replace group
PATCH  /scim/v2/Groups/:id      — Update group
DELETE /scim/v2/Groups/:id      — Remove group
```

### 2.2 Mapping

SCIM Users → Process OS Users + Memberships  
SCIM Groups → Process OS Teams  
SCIM attributes → display_name, email, active status, role (via custom schema extension)

---

## 3. Managed Marketplace Deployment

### 3.1 Organization Plugin Management

Leverage Claude's `managedPlugins` and `managedMcpServers`:

```typescript
interface ManagedDeployment {
  organization_id: string;
  plugin_version: string;          // pinned version
  control_plane_url: string;       // pre-configured
  auto_update: boolean;            // auto-update to latest compatible
  required_for_roles: string[];    // which roles must have it
  mcpServers: ManagedMcpConfig[];  // pre-configured MCP servers
}
```

### 3.2 Zero-Config Employee Onboarding

When organization manages the plugin:
1. Employee installs Claude Code
2. Plugin auto-installs from managed marketplace
3. Control plane URL pre-configured
4. SSO handles authentication
5. Device auto-pairs via enterprise identity
6. Board appears — no configuration steps

---

## 4. Device Policy

### 4.1 Organization Device Rules

```typescript
interface DevicePolicy {
  require_managed_plugin: boolean;
  min_plugin_version: string;
  allowed_platforms: ('linux' | 'macos' | 'windows' | 'wsl')[];
  require_encryption: boolean;
  max_devices_per_user: number;
  auto_revoke_inactive_days: number;
  allowed_models: string[];        // restrict which Claude models
  max_autonomous_cost_per_day_usd: number;
}
```

### 4.2 Compliance Enforcement

Device check on every edge connection handshake. Non-compliant devices get degraded access (read-only) or rejection.

---

## 5. Audit Export

### 5.1 Export Formats

```
GET /v1/admin/audit/export?format=json&from=<date>&to=<date>
GET /v1/admin/audit/export?format=csv&from=<date>&to=<date>
GET /v1/admin/audit/export?format=ocel  — OCEL 2.0 for process mining
```

### 5.2 Event Export

Full event ledger export for compliance/archival:

```
GET /v1/admin/events/export?caseId=<id>&format=json
```

---

## 6. Retention Policies

### 6.1 Configuration

```typescript
interface RetentionPolicy {
  organization_id: string;
  event_retention_days: number;    // canonical events
  audit_retention_days: number;    // audit log
  session_retention_days: number;  // session data
  evidence_retention_days: number; // evidence artifacts
  archive_after_days: number;      // move closed cases to archive
  delete_after_archive_days: number; // permanent deletion
}
```

### 6.2 Retention Worker

Background job that enforces retention policies: archive, prune, anonymize per policy.

---

## 7. Privacy Modes

### 7.1 Four Modes

| Mode | What goes to cloud | What stays local |
|------|-------------------|-----------------|
| **Metadata** | Event types, timestamps, actor IDs, structural relationships | All content (titles, descriptions, evidence, tool output) |
| **Structured** | Events + commands with field names but no content values | Actual content values |
| **Rich** | Everything — full content processing in cloud | Nothing special |
| **Sovereign** | Nothing — self-hosted control plane | Everything |

### 7.2 Implementation

Privacy mode set per-organization. The Edge connection filters outbound events based on the mode before transmission.

```typescript
function filterForPrivacy(event: ProcessEvent, mode: PrivacyMode): ProcessEvent | null {
  switch (mode) {
    case 'metadata':
      return { ...event, data: stripContent(event.data) };
    case 'structured':
      return { ...event, data: stripValues(event.data) };
    case 'rich':
      return event;
    case 'sovereign':
      return null; // never transmit
  }
}
```

---

## 8. Self-Hosting Path

### 8.1 Deployment

Same codebase, different deployment target:

```
Docker Compose (single machine):
  - postgres (or external PG)
  - api
  - worker
  - realtime
  - web (nginx serving static build)

Kubernetes:
  - Helm chart
  - Horizontal scaling for API/worker
  - Managed PG (RDS/CloudSQL)
  - Ingress for web + WebSocket
```

### 8.2 Configuration

All cloud-specific behavior controlled by environment variables:
```
DEPLOYMENT_MODE=self-hosted
DATABASE_URL=postgresql://...
JWT_SECRET=<generated>
COOKIE_DOMAIN=<internal domain>
DISABLE_TELEMETRY=true
```

### 8.3 Protocol Compatibility

Self-hosted control plane speaks the same Edge protocol. Plugins connect to the internal URL instead of the cloud URL. No code differences.

---

## 9. Restricted Claude Compatibility

### 9.1 Graceful Degradation

When Claude runs in `--restricted` mode:
- No shell commands → WebhookExecutor/APIExecutor still work, Claude executor degraded
- No file access → evidence collection limited
- Plugin hooks still fire (hooks are not restricted)
- MCP still available (MCP is not restricted)

### 9.2 Capability-Based Behavior

The capability discovery system (from SP1) detects restricted mode and adjusts execution plans accordingly. Never assume full capabilities.

---

## 10. Marketplace Readiness

### 10.1 Validation Checklist

```
✅ claude plugin validate --strict — passes
✅ Security review — no secrets in source, proper credential handling
✅ Dependency audit — no known vulnerabilities, minimal dependencies
✅ Cross-platform CI — Linux, macOS, Windows, WSL
✅ Upgrade tests — N → N+1 preserves ${CLAUDE_PLUGIN_DATA}
✅ Rollback tests — N+1 → N without data corruption
✅ Privacy documentation — what data leaves the device
✅ Threat model — documented and reviewed
```

### 10.2 Release Pipeline

```
build → validate → package → cross-platform smoke test
→ publish to community marketplace → fresh-machine install test → promote
```

---

## 11. DB Changes

```sql
-- Migration: enterprise tables

CREATE TABLE IF NOT EXISTS sso_configs (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id),
  provider TEXT NOT NULL,
  issuer_url TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT NOT NULL,
  allowed_domains TEXT[] DEFAULT '{}',
  auto_provision BOOLEAN DEFAULT false,
  default_role TEXT DEFAULT 'org_member',
  enforce_sso BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_policies (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id),
  policy JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retention_policies (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id),
  policy JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 12. Exit Gates

**Phase 20:** SSO login works, SCIM syncs users/groups, managed deployment delivers zero-config onboarding, audit export produces valid data.

**Phase 21:** Four privacy modes work correctly. Self-hosted deployment runs the same codebase. Sovereign mode transmits nothing externally.

**Phase 22:** `claude plugin validate --strict` passes. Security review complete. Community marketplace submission ready.
