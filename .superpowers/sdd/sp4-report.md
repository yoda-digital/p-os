# SP4: Governance + Deep Packs + Adaptive Views — Implementation Report

**Branch:** `feat/sp4-governance-packs-views`  
**Date:** 2026-09-08  
**Status:** Complete  
**Build:** `pnpm build` passes (31/31 tasks)

---

## Commits

### 1. `feat: attention engine — computed priority queue with risk/deadline/authority ranking`
- **Created** `apps/api/src/services/attention-engine.ts` — multi-factor priority scoring
  - `computeAttention(sql, caseId)` ranks items by weighted formula: risk x deadline x authority x critical_path x downstream_impact
  - Critical path detection via topological sort + longest-path DP
  - Configurable weights per organization (stored in `organizations.settings.attention_weights`)
  - Five attention levels: `human_decision_required`, `human_approval_required`, `critical_intervention`, `watch`, `autonomous`
  - Six categories: `decision`, `approval`, `intervention`, `escalation`, `deadline`, `evidence_gap`
- **Modified** `apps/worker/src/controller-runner.ts` — added `attentionPriorityController`
  - Updates `blocking_impact` from dependency graph on every state-changing event
  - Auto-resolves attention items when decisions are resolved or moves reach terminal state
  - Escalation: items unresolved > 24h get bumped to `critical`
- **Modified** `apps/api/src/routes/attention.ts` — returns computed priorities (mode=computed by default, mode=raw for legacy)
- **Modified** `apps/web/src/components/views/attention-view.tsx` — shows level badges, category tags, priority scores, decision links

### 2. `feat: decision center — full decision workflow with options, evidence, recommendations`
- **Upgraded** `apps/api/src/routes/decisions.ts` — three new endpoints:
  - `GET /:id` — single decision with linked evidence
  - `PATCH /:id` — update options, evidence, context, state
  - `POST /:id/recommend` — generates AI recommendation with confidence score from evidence strength analysis
- **Created** `apps/web/src/components/decisions/decision-detail-dialog.tsx` — full detail view:
  - Options as selectable cards with evidence counts, risks, tradeoffs
  - AI recommendation with confidence bar and rationale
  - Resolution form with required rationale
  - "Get AI Recommendation" button
- **Upgraded** `apps/web/src/components/views/decisions-view.tsx`:
  - Create dialog now supports adding options
  - Pending decisions show evidence/risk/tradeoff counts per option
  - AI recommendation bar with confidence percentage
  - Click-to-detail on resolved decisions

### 3. `feat: governance — case autonomy profiles, action authority matrix, budget controls`
- **Created** `packages/db/src/migrations/006_governance.sql`:
  - `ALTER TABLE cases ADD COLUMN autonomy_profile JSONB`
  - `pack_controller_state` table (per-controller state per case)
  - `budget_tracking` table (per-case per-org cost monitoring with alerts)
  - `governance_overrides` table (full audit trail for human overrides)
- **Created** `apps/api/src/services/governance.ts`:
  - `getAutonomyProfile()` / `setAutonomyProfile()` — four levels: supervised, guided, autonomous, full_autonomous
  - `checkAutonomy()` — validates actions against autonomy profile + authority matrix + budget
  - `trackBudgetUsage()` — accumulates token/cost tracking per month
  - `recordGovernanceOverride()` — emits GovernanceOverride event with full audit trail
  - Default authority matrix: 8 action types mapped to required roles
- **Created** `apps/api/src/routes/governance.ts` — REST endpoints for autonomy, budget, governance check, override recording
- **Created** `apps/web/src/components/admin/admin-governance.tsx` — admin panel with:
  - Override Audit Trail tab (chronological override log)
  - Authority Matrix tab (reference table of actions vs roles)
- Registered governance routes in API index, added admin route in app.tsx

### 4. `feat: deep domain packs — 7 packs with domain-specific types, controllers, views`
- **Created** `packages/process-sdk/src/index.ts` — full DomainPack interface:
  - `PackController` with `triggers` and `evaluate()` returning `ControllerAction[]`
  - `ControllerContext` with event data and `PackQueryFn` for case state queries
  - `EvidenceTypeSpec`, `RuleTemplate`, `IntentTemplate` types
  - `definePack()` helper
- **Upgraded all 7 packs** from metadata stubs to behavioral packs:
  - **Software:** 3 controllers (TestPassController, ReviewController, DeployController), 4 evidence types, 5 move classes, 3 intent templates
  - **Procurement:** 3 controllers (ClarificationController — invalidates requirement evidence, DeadlineController, ComplianceController — checks mandatory docs), 4 evidence types, 5 move classes
  - **Investigation:** 3 controllers (ContradictionController, SourceVerificationController — requires 2+ independent sources, RetractionController — cascade invalidation), 4 evidence types, 5 move classes
  - **Research:** 3 controllers (HypothesisController, NegativeFindingController — negative findings valid, ReproducibilityController), 4 evidence types, 5 move classes
  - **Negotiation:** 3 controllers (CommitmentTracker — conflict detection, SignalAnalyzer — deal health, NoDealController), 4 evidence types, 5 move classes
  - **Incident:** 3 controllers (EscalationController — severity/impact auto-escalation, MitigationTracker, PostmortemController — requires post-incident review), 4 evidence types, 5 move classes
  - **Logistics:** 3 controllers (CustodyController — gap detection, QuantityBalancer — split/merge conservation, LocationTracker), 4 evidence types, 6 move classes
- **Core pack** also implements DomainPack interface (no controllers — kernel handles it)

### 5. `feat: adaptive view compiler — semantic composition detection + view prioritization`
- **Created** `apps/api/src/services/view-compiler.ts`:
  - `compileViews(sql, caseId)` analyzes case composition with 12 SQL counts
  - Heuristic rules: many claims+evidence → Evidence first; many requirements → Compliance; parallel moves → Kanban; pending decisions → Decisions; etc.
  - Pack-specific view ordering takes precedence when a pack is referenced
  - Returns `CompiledView[]` with `{ id, label, priority, reason }`
- **Added** `GET /v1/cases/:id/views` endpoint in cases routes
- **Modified** sidebar to:
  - Fetch compiled view order via `useQuery` (30s stale time)
  - Sort view links by compiled priority
  - Toggle button (ArrowUpDown icon) to switch between adaptive and default ordering

### 6. `feat: SP4 complete — governance + deep packs + adaptive views`
- Fixed TypeScript errors:
  - `readonly` return types for postgres.js query results
  - Non-null assertions for conditional SQL parameters
  - `as any` cast for `sql.json()` with `Record<string, unknown>`
- **Build verified:** `pnpm build` passes all 31 tasks (0 failures)

---

## Architecture Decisions

1. **Attention scoring weights** stored in `organizations.settings` — no migration needed for weight changes
2. **Pack controllers** are typed interfaces with `evaluate()` returning action arrays — side-effect free, testable
3. **Governance checks** are composable: autonomy → authority → budget, each layer can block independently
4. **View compiler** runs server-side (SQL counts) rather than client-side to access the full case composition
5. **Override audit** emits events into the standard event stream for timeline visibility

## Files Created

- `apps/api/src/services/attention-engine.ts` (260 lines)
- `apps/api/src/services/governance.ts` (430 lines)
- `apps/api/src/services/view-compiler.ts` (170 lines)
- `apps/api/src/routes/governance.ts` (90 lines)
- `apps/web/src/components/decisions/decision-detail-dialog.tsx` (240 lines)
- `apps/web/src/components/admin/admin-governance.tsx` (130 lines)
- `packages/db/src/migrations/006_governance.sql` (55 lines)
- `packages/process-sdk/src/index.ts` (138 lines)

## Files Modified

- `apps/api/src/routes/attention.ts` — computed priorities
- `apps/api/src/routes/decisions.ts` — PATCH, recommend, full detail
- `apps/api/src/routes/cases.ts` — views endpoint
- `apps/api/src/index.ts` — governance route registration
- `apps/worker/src/controller-runner.ts` — attention priority controller
- `apps/web/src/components/views/attention-view.tsx` — level/category display
- `apps/web/src/components/views/decisions-view.tsx` — full workflow UI
- `apps/web/src/components/layout/sidebar.tsx` — adaptive view ordering
- `apps/web/src/lib/api.ts` — governance + view types and methods
- `apps/web/src/app.tsx` — admin governance route
- All 8 pack files (`packs/*/src/index.ts`)
- All 8 pack package.json files (added process-sdk dep)
