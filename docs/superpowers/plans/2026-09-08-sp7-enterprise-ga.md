# SP7: Enterprise + GA — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add SSO/SCIM, privacy modes (Metadata/Structured/Rich/Sovereign), self-hosting path, marketplace readiness with plugin validation and security review.

**Spec:** `docs/superpowers/specs/2026-09-08-sp7-enterprise-ga.md`

## Tasks

### Task 1: SSO + SCIM
- Create `apps/api/src/auth/sso.ts` — OIDC provider integration (generic, supports Okta/Azure AD/Google)
- Create `apps/api/src/auth/scim.ts` — SCIM 2.0 provisioning endpoint for automated user/group sync
- Migration 009: sso_connections, scim_tokens tables
- SSO configuration page in admin panel
- Auth flow: SSO redirect → callback → JWT issuance

### Task 2: Managed Deployment + Device Policy
- Create `apps/api/src/routes/managed.ts` — managed plugin distribution endpoint
- Implement organization device policies (enrollment requirements, compliance checks)
- Plugin auto-update mechanism
- Admin panel: device fleet management, compliance dashboard

### Task 3: Privacy Modes
- Create `apps/api/src/middleware/privacy.ts` — privacy mode enforcement middleware
  - Metadata: strip all content, send only structural events
  - Structured: send events/commands, no raw content
  - Rich: full content (current behavior)
  - Sovereign: block all cloud communication
- Organization setting for privacy mode
- Audit of what data leaves the local network
- Privacy documentation page

### Task 4: Self-Hosting + Regional Data
- Create `infra/docker/` — Dockerfile, docker-compose.yml for self-hosted deployment
- Same codebase, configurable data stores (PostgreSQL connection string)
- Environment-based configuration for all external dependencies
- Health check endpoints for container orchestration
- Regional data residency configuration

### Task 5: Marketplace Readiness
- Create `plugin/claude-code/tests/` — plugin validation tests
- Run `claude plugin validate --strict` (or simulate if CLI not available)
- Dependency audit (check for vulnerabilities)
- Cross-platform compatibility notes (Linux, macOS, Windows, WSL)
- Upgrade/rollback test (plugin data persistence across versions)
- Create SECURITY.md, PRIVACY.md documentation
- Create `infra/ci/` — CI pipeline configuration

### Task 6: Final GA Verification
- Full build verification
- All migrations apply cleanly from scratch
- All 13+ views render
- All API endpoints respond
- Plugin validates
- Commit: `feat: SP7 complete — enterprise hardening + GA readiness`
