# SP5: Intelligence + Search + History + Simulation — Implementation Report

**Status:** Complete  
**Date:** 2026-09-08  
**Branch:** `feat/sp5-intelligence-search`  
**Commits:** 6

---

## Commit 1: Universal Search
- `apps/api/src/services/search.ts` — ILIKE full-text search across 8 entity types (cases, moves, decisions, evidence, entities, assertions, intents, rules) with relevance scoring
- `apps/api/src/routes/search.ts` — `GET /v1/search?q=&type=&caseId=` + `GET /v1/search/graph` for recursive CTE graph traversal
- `apps/web/src/components/search/search-bar.tsx` — global search bar in app header with Ctrl/Cmd+K shortcut, type filter chips, results dropdown
- i18n: en, ro, ru `search.json` namespaces

## Commit 2: WHY Expansion (10 Types)
- `packages/why/src/index.ts` rewritten — 10 deterministic handlers:
  1. `blocked?` — unsatisfied deps + pending decisions + violated rules
  2. `not_ready?` — preconditions + dependencies + decisions
  3. `active?` — activation event + causation trace + current attempt
  4. `done?` — satisfaction event + evidence chain + successful attempt
  5. `failed?` — failed attempt analysis + pattern detection
  6. `this_agent?` — capability match + assignment events
  7. `this_model?` — model routing + attempt history + autonomy
  8. `this_task?` — intent decomposition + creation causation chain
  9. `changed?` — event diffs + steering commands
  10. `requires_me?` — attention items + decisions + governance authority
- Each returns `causalChain` with `causedBy` tracing + `deterministic: true|false`
- `apps/api/src/routes/why.ts` — `POST /v1/why` with `questionType` param, `GET /v1/why/types`
- why-view.tsx — 10 preset buttons, move ID input, causal chain visualization

## Commit 3: Historical WHY + Full Time Travel
- `apps/api/src/routes/time-travel.ts` — 4 endpoints:
  - `GET /at-event` — snapshot at event N
  - `GET /at-time` — snapshot at time T
  - `GET /diff?from=&to=` — before/after diff with per-field changes
  - `POST /historical-why` — run WHY against state at any historical point
- time-travel-view.tsx — diff mode (select two events), historical WHY panel
- Event replay handles `MoveSatisfied` properly

## Commit 4: Process Intelligence
- `apps/api/src/services/process-metrics.ts` — 11 metrics:
  cycle_time, waiting_time, rework_count, failed_attempts, human_attention_time,
  evidence_gaps, completion_reliability, cost, executor_performance,
  context_rotations, steering_frequency
- `apps/api/src/services/drift-detector.ts` — 5 drift signals:
  repeated_manual_steps, hidden_dependency, loop_detected, rework_hotspot, approval_bottleneck
- `apps/api/src/services/ai-architect.ts` — 5 insight types:
  parallelize, add_verification, reduce_rework, change_executor, add_evidence
- `apps/api/src/services/ai-guardian.ts` — 7 alert types:
  scope_drift, policy_breach, stale_evidence, deadline_risk, unauthorized_work, duplicate_effort, agent_loop
- `packages/db/src/migrations/007_intelligence.sql` — process_insights + simulation_events tables
- intelligence-view.tsx — 11 metric cards, drift anomalies, Architect analyze, Guardian check

## Commit 5: Simulation Engine
- `apps/api/src/services/simulation-engine.ts`:
  - `createSimulation` — fork state at any event
  - `applyHypothetical` — isolated simulation events (never mix with canonical)
  - `compareOutcomes` — canonical vs simulated state diff
  - `adoptSimulation` — explicit Commands from selected changes
- simulation routes: `POST /:id/apply`, `GET /:id/compare`, `POST /:id/adopt` (preview + confirm)
- simulation-view.tsx — add event panel, compare button, adopt flow

## Commit 6: Build Verification + Fixes
- Fixed TS errors: `useRef` initial value, `.catch()` type narrowing, `sql.json()` type cast
- `pnpm build` — all 31 tasks pass

---

## Files Created
| File | Purpose |
|------|---------|
| `apps/api/src/services/search.ts` | Universal search service |
| `apps/api/src/routes/search.ts` | Search API routes |
| `apps/api/src/services/process-metrics.ts` | 11 process metrics |
| `apps/api/src/services/drift-detector.ts` | 5 drift detection signals |
| `apps/api/src/services/ai-architect.ts` | Process optimization proposals |
| `apps/api/src/services/ai-guardian.ts` | 7 guardian alert monitors |
| `apps/api/src/services/simulation-engine.ts` | Fork/compare/adopt engine |
| `apps/web/src/components/search/search-bar.tsx` | Global search component |
| `apps/web/src/i18n/locales/{en,ro,ru}/search.json` | Search i18n |
| `packages/db/src/migrations/007_intelligence.sql` | Intelligence + simulation tables |

## Files Modified
| File | Changes |
|------|---------|
| `packages/why/src/index.ts` | Rewritten: 10 question handlers |
| `apps/api/src/routes/why.ts` | Rewritten: 10 types + types endpoint |
| `apps/api/src/routes/time-travel.ts` | Added diff + historical WHY |
| `apps/api/src/routes/intelligence.ts` | Real metrics/drift/architect/guardian |
| `apps/api/src/routes/simulation.ts` | Full engine: apply/compare/adopt |
| `apps/api/src/index.ts` | Register search routes |
| `apps/web/src/components/layout/app-layout.tsx` | Added SearchBar |
| `apps/web/src/components/views/why-view.tsx` | 10 presets + causal viz |
| `apps/web/src/components/views/time-travel-view.tsx` | Diff mode + historical WHY |
| `apps/web/src/components/views/intelligence-view.tsx` | 11 metrics + architect/guardian |
| `apps/web/src/components/views/simulation-view.tsx` | Apply/compare/adopt flow |
| `apps/web/src/lib/api.ts` | All new types + API methods |
| `apps/web/src/i18n/config.ts` | Register search namespace |
| `apps/web/src/i18n/locales/{en,ro,ru}/why.json` | 10 question presets |
| `apps/web/src/i18n/locales/{en,ro,ru}/time-travel.json` | Diff + historical WHY keys |
| `apps/web/src/i18n/locales/{en,ro,ru}/intelligence.json` | 11 metrics + architect/guardian |
| `apps/web/src/i18n/locales/{en,ro,ru}/simulation.json` | Apply/compare/adopt keys |

## Exit Gates
- **Phase 13:** Every major UI state exposes a meaningful WHY via 10 question types with deterministic causal paths
- **Phase 14:** Historical WHY answers using state as it existed at the queried time via event replay
- **Phase 15:** Drift detector produces structured evidence ("repeated 7 times", "4 failed attempts") not generic prose
- **Phase 16:** Simulation adoption creates explicit canonical Commands via `adoptSimulation`, never invisible merges
