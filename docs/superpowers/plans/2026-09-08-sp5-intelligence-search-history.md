# SP5: Intelligence + Search + History + Simulation — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add universal search, 10-type WHY with historical queries, full time travel with diffs, process intelligence (metrics, drift, AI architect/guardian), and simulation engine with forked state.

**Spec:** `docs/superpowers/specs/2026-09-08-sp5-intelligence-search-history.md`

## Tasks

### Task 1: Universal Search
- Create `apps/api/src/services/search.ts` — full-text + filtered + graph search across all entities
- Create `apps/api/src/routes/search.ts` — `GET /v1/search?q=...&type=...&filters=...`
- Create `apps/web/src/components/search/search-bar.tsx` — global search with type filters, results preview
- Add search to app layout header
- i18n keys

### Task 2: WHY Expansion (10 types)
- Rewrite `apps/api/src/routes/why.ts` — support all 10 question types: blocked?, active?, done?, this agent?, this model?, this task?, now?, did this change?, evidence stale?, requires me?
- Each returns deterministic causal path first, then wraps with explanation
- Rewrite `packages/why/src/index.ts` — implement 10 query handlers with real DB traversal
- Update WHY view UI with all 10 preset buttons

### Task 3: Historical WHY + Full Time Travel
- Upgrade `apps/api/src/routes/time-travel.ts` — return state + before/after diff at any event/time
- Implement historical WHY: replay events up to point N, run WHY against that historical state
- Upgrade time-travel-view.tsx — add diff visualization, historical WHY query input
- i18n keys

### Task 4: Process Intelligence (Metrics + Drift + AI Architect + Guardian)
- Create `apps/api/src/services/process-metrics.ts` — compute 11 metrics from event history
- Create `apps/api/src/services/drift-detector.ts` — compare expected vs observed process
- Create `apps/api/src/services/ai-architect.ts` — process optimization proposals
- Create `apps/api/src/services/ai-guardian.ts` — scope drift, policy breach, risk monitoring
- Upgrade intelligence routes + view with real data
- Migration 007: process_metrics_snapshots, drift_reports tables

### Task 5: Simulation Engine
- Create `apps/api/src/services/simulation-engine.ts` — fork case state, apply hypothetical events, compare outcomes
- Upgrade `apps/api/src/routes/simulation.ts` — create/list/evaluate simulations
- Upgrade simulation-view.tsx — create scenarios, compare forked vs canonical state
- Adoption flow: selected changes → explicit canonical Commands
- i18n keys

### Task 6: Integration + Build Verification
- Verify pnpm build passes
- Commit: `feat: SP5 complete`
