# SP2 Tasks 4-7 Report

**Date:** 2026-09-08  
**Branch:** `feat/sp2-steering-evidence-context`  
**Build status:** PASS (31/31 packages)

---

## Task 4: Completion Contracts + Evidence Staleness

### Commits
- `ff53099` feat: completion contracts + evidence staleness with causal propagation

### Files Created
- `apps/api/src/services/completion-engine.ts` — Recursive contract evaluator supporting all contract types: `all`, `any`, `threshold`, `approval`, `evidence`, `external_state`, `evidence_count`, `all_evidence_valid`, `attempt_succeeded`. Returns `{ satisfied, missing[] }`.
- `apps/api/src/services/evidence-staleness.ts` — `checkStaleness()` marks evidence with expired `fresh_until` as stale; `propagateStaleness()` cascades to moves (verification → stale, kanban → VERIFY column); `runStalenessCheck()` for worker entry.

### Files Modified
- `apps/worker/src/controller-runner.ts` — Added `commitStalenessController`: when `CommitCreated` events arrive, marks prior test/build evidence as stale since code has changed.
- `apps/worker/src/index.ts` — Added `evidenceStalenessLoop()` running every 30 seconds: checks `fresh_until` expiration, marks stale, propagates to moves, raises attention items.
- `plugin/claude-code/src/hooks/task-completed.ts` — Loads move's `completion_contract` from local cache, evaluates against outbox evidence locally, blocks completion if unsatisfied. Falls back to legacy policy-based checks.
- `plugin/claude-code/src/hooks/post-tool-use.ts` — Detects test results with exit code (pass/fail), build commands, extracts commit hashes; enqueues typed evidence (test_run, build_result, git_commit).

---

## Task 5: Context Recovery

### Commits
- `1821748` feat: context recovery — clear/compact/resume/fork with semantic checkpoints

### Files Created
- `plugin/claude-code/src/context/checkpoint.ts` — `saveCheckpoint()` and `loadCheckpoint()` for SQLite-backed semantic checkpoints. `buildCheckpointFromCache()` captures constraints, steering, failed approaches, completion state, dependencies.
- `plugin/claude-code/src/context/resume-intelligence.ts` — `decideResumeStrategy()` with time-based thresholds: <5min → resume, 5-60min → delta, 1-24h → fresh, >24h → recommend fresh.
- `plugin/claude-code/src/hooks/pre-compact.ts` — Saves semantic checkpoint before compaction.
- `plugin/claude-code/src/hooks/post-compact.ts` — Compares checkpoint with native summary, flags missing constraints/steering/failed approaches.

### Files Modified
- `plugin/claude-code/src/hooks/session-start.ts` — Full routing by `initiation_source`: `new` (full capsule), `resume` (intelligence-driven), `clear` (MUST restore all constraints — safety gate), `compact` (checkpoint recovery), `fork` (parent context + divergence).
- `plugin/claude-code/src/hooks/handler.ts` — Registered `pre-compact` and `post-compact` handlers.
- `plugin/claude-code/src/storage/db.ts` — Added `context_checkpoints` table to SQLite schema.

---

## Task 6: Steering Versioning + Evidence UI

### Commits
- `22656d6` feat: steering instruction versioning + evidence staleness UI indicators

### Files Modified
- `apps/api/src/routes/steering.ts` — Creates `attempt_instruction_versions` records on steering acknowledgment (spec §1.4). Added `GET /v1/steering/versions/:attemptId` endpoint.
- `apps/web/src/components/views/evidence-view.tsx` — Validity badges with icons (valid=green/shield, stale=yellow/refresh, invalid=red/x, disputed=orange/alert, unknown=gray). Fresh-until countdown timer. Staleness reason banner. Filter count badges.
- `apps/web/src/components/kanban/kanban-card.tsx` — Shows "stale" badge (warning variant) when move verification is stale.
- `apps/web/src/components/steering/move-detail-drawer.tsx` — Shows instruction version history section with version numbers and timestamps.
- `apps/web/src/hooks/use-steering.ts` — Added `useInstructionVersions` hook.
- `apps/web/src/lib/api.ts` — Added `InstructionVersion` type and `getInstructionVersions()` API method.
- i18n: Added `validity.*`, `staleness.*` keys to evidence namespace; `instruction_versions`, `version_label` to steering namespace; `verification_stale` to kanban namespace — in all 3 languages (en, ro, ru).

---

## Task 7: Integration Test

### Commits
- `673d7ad` feat: SP2 complete — steering + evidence + context recovery

### Verification
1. **Build passes:** `pnpm build` — 31/31 packages compile cleanly, 0 errors
2. **TypeScript strict checks:** Fixed all null/undefined mismatches between `SessionBinding` (string | null fields from SQLite) and narrowed `SafeBinding` (string | undefined) used by context builders
3. **Completion engine:** Evaluates all 9 contract types recursively, returning structured `{ satisfied, missing[] }` results
4. **Evidence staleness controller:** 30-second periodic check for `fresh_until` expiration, causal propagation to moves and kanban
5. **Steering versioning:** Creates `attempt_instruction_versions` records — never rewrites prior instructions, each steering creates a new version
6. **Context recovery:** All 5 `initiation_source` values handled with appropriate context injection
7. **Vite serves steering composer:** Steering composer component exists and is rendered in move-detail-drawer

### Exit Gates (from spec §5)
- **Phase 5:** Steering commands create records in `steering_commands` table → edge push → plugin pending_steering → PreToolUse delivers → Claude receives → ack creates instruction version
- **Phase 6:** Evidence with `fresh_until` → worker marks stale when expired → move verification → stale → VERIFY column → attention raised
- **Phase 7:** Session with `source=clear` → full capsule with all constraints restored (safety gate); `source=compact` → checkpoint recovery; `source=resume` → intelligence-driven strategy
