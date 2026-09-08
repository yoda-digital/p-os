# SP2: Steering + Evidence + Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live steering delivery (browser → Claude), evidence staleness with causal propagation, completion contracts with TaskCompleted gating, and context recovery (clear/compact/resume/fork) — so that a user can steer Claude mid-execution from the Kanban board and "Done" means evidence-verified completion.

**Architecture:** Steering flows: browser → API command → steering_commands table → Edge WSS push → plugin pending_steering SQLite → PreToolUse hook → additionalContext injection. Evidence staleness: worker controller periodically checks freshness, propagates to dependent assertions/moves. Completion engine: TaskCompleted hook evaluates contracts locally. Context recovery: enhanced SessionStart/PreCompact/PostCompact handlers with checkpoint storage.

**Tech Stack:** TypeScript, Hono, React, postgres.js, better-sqlite3, WebSocket

**Spec:** `docs/superpowers/specs/2026-09-08-sp2-steering-evidence-context.md`

## Global Constraints

- All state mutations go through Commands → Events → Projections
- Hook latency: p95 no-op < 15ms, p95 cached policy < 50ms
- Critical enforcement runs locally (SQLite), never depends solely on cloud
- Steering never rewrites prior instructions — versioned append only
- Evidence staleness propagates causally through dependency chains
- System org ID: `00000000-0000-0000-0000-000000000000`

---

### Task 1: DB Migration 004 — Evidence + Context Tables

**Files:**
- Create: `packages/db/src/migrations/004_evidence_context.sql`

**Interfaces:**
- Consumes: existing evidence, moves, attempts, steering_commands tables
- Produces: new columns on evidence/moves, new tables (attempt_instruction_versions, context_checkpoints)

The agentic worker should create the migration with the exact SQL from the spec §4. Add columns to evidence (fresh_until, artifact_ref, source_ref, provenance, observed_at), add completion_contract JSONB to moves, create attempt_instruction_versions and context_checkpoints tables with indexes.

- [ ] **Step 1: Create migration, commit**

```bash
git commit -m "feat: migration 004 — evidence staleness, completion contracts, context checkpoints"
```

---

### Task 2: Steering Delivery Pipeline

**Files:**
- Modify: `apps/api/src/routes/steering.ts` — upgrade to full steering pipeline (create steering command → store in DB → push via WSS)
- Modify: `apps/realtime/src/edge.ts` — add steering push when new steering_commands are inserted
- Modify: `plugin/claude-code/src/hooks/pre-tool-use.ts` — enhance to deliver pending steering via additionalContext
- Modify: `plugin/claude-code/src/hooks/stop.ts` — deliver pending steering on Stop
- Create: `apps/api/src/services/steering-service.ts` — steering state machine (issued → delivered → acknowledged → applied)

**Interfaces:**
- Consumes: steering_commands table, Edge WSS connection, plugin SteeringQueueStore
- Produces: end-to-end steering delivery from API to Claude

The steering route should:
1. Accept `POST /api/v1/steering` with `{ case_id, move_id, attempt_id, class, instruction, ... }`
2. Create a steering_command record with state `issued`
3. Emit `SteeringIssued` event
4. Push to the Edge WSS if device is connected (update state to `delivered_to_edge`)
5. Plugin receives via WSS → stores in pending_steering SQLite → next PreToolUse/Stop delivers it

The pre-tool-use handler enhancement: check `steeringQueueStore.getPending(caseId)` → if pending, inject as `additionalContext` and mark delivered.

- [ ] **Steps 1-4: Implement steering pipeline end-to-end, commit**

```bash
git commit -m "feat: steering delivery pipeline (API → Edge WSS → plugin hook → Claude)"
```

---

### Task 3: Steering Composer UI

**Files:**
- Create: `apps/web/src/components/steering/steering-composer.tsx` — full steering UI with type selector, instruction input, state feedback
- Modify: `apps/web/src/components/steering/move-detail-drawer.tsx` — integrate steering composer
- Modify: `apps/web/src/lib/api.ts` — add `sendSteering` method (may already exist, verify/upgrade)
- Create: `apps/web/src/hooks/use-steering.ts` — react-query hooks for steering state
- Add i18n keys to `apps/web/src/i18n/locales/{ro,ru,en}/steering.json`

**Interfaces:**
- Consumes: steering API endpoints, steering_commands table state
- Produces: UI for sending steering commands with real-time state feedback

The composer shows: steering type selector (advisory/constraint/redirect/pause/stop/fork/reassign), instruction textarea, send button. After sending, shows real-time state: issued → edge → executor → acknowledged → applied.

- [ ] **Steps 1-3: Implement steering composer, integrate into move detail, commit**

```bash
git commit -m "feat: steering composer UI with real-time delivery state feedback"
```

---

### Task 4: Evidence Staleness + Completion Contracts

**Files:**
- Modify: `apps/api/src/services/command-processor.ts` — add completion_contract handling to Move.Create/Move.Edit
- Create: `apps/api/src/services/completion-engine.ts` — evaluate completion contracts
- Create: `apps/api/src/services/evidence-staleness.ts` — staleness detection and propagation
- Modify: `apps/worker/src/controller-runner.ts` — add evidence staleness controller
- Modify: `plugin/claude-code/src/hooks/task-completed.ts` — use completion engine for gating
- Modify: `plugin/claude-code/src/hooks/post-tool-use.ts` — detect evidence artifacts (test results, commits)

**Interfaces:**
- Consumes: evidence table (with new columns), moves.completion_contract, events
- Produces: `evaluateCompletion(sql, moveId): Promise<CompletionResult>`, staleness controller

**Completion engine logic:**
```typescript
interface CompletionResult {
  satisfied: boolean;
  missing: string[];  // human-readable list of unsatisfied conditions
}

function evaluateContract(contract: CompletionContract, evidence: Evidence[], approvals: Decision[]): CompletionResult
```

**Evidence staleness controller (worker):**
- Runs every 30 seconds
- Checks `fresh_until` on all evidence → mark stale if expired
- Checks recent `CommitCreated` events → mark affected test/build evidence stale
- Propagates: stale evidence → recalculate assertion confidence → if move verification was based on now-stale evidence, set `verification = 'stale'` and move card to VERIFY

- [ ] **Steps 1-5: Implement completion engine, staleness controller, TaskCompleted gate, commit**

```bash
git commit -m "feat: completion contracts + evidence staleness with causal propagation"
```

---

### Task 5: Context Recovery (Clear, Compact, Resume, Fork)

**Files:**
- Modify: `plugin/claude-code/src/hooks/session-start.ts` — full context recovery logic per initiation_source
- Modify: `plugin/claude-code/src/hooks/pre-compact.ts` — semantic checkpoint to SQLite
- Modify: `plugin/claude-code/src/hooks/post-compact.ts` — compare native summary with checkpoint
- Create: `plugin/claude-code/src/context/checkpoint.ts` — checkpoint save/load logic
- Create: `plugin/claude-code/src/context/resume-intelligence.ts` — decide resume strategy
- Modify: `plugin/claude-code/src/storage/db.ts` — add context_checkpoints table to SQLite schema (if not already)

**Interfaces:**
- Consumes: SQLite stores, Context Capsule generator (from SP1 Task 6), edge API for fresh capsules
- Produces: Full context recovery across all session lifecycle events

**SessionStart enhancement by initiation_source:**
- `new` → full capsule from edge or cache
- `resume` → assess via resume-intelligence → capsule with DELTA or full rehydration
- `clear` → full capsule (MUST restore all constraints)
- `compact` → load checkpoint → compare with PostCompact summary → fill gaps
- `fork` → capsule with parent attempt context + fork point

**PreCompact checkpoint saves:**
- case_id, move_id, attempt_id
- All active constraints/steering
- Critical assertions
- Failed approaches list
- Current completion state

**Resume intelligence:**
```typescript
function decideResumeStrategy(timeSinceLastResponse: number, eventsSince: number): 'resume' | 'resume_delta' | 'fresh'
```

- [ ] **Steps 1-4: Implement all context recovery handlers, checkpoint logic, resume intelligence, commit**

```bash
git commit -m "feat: context recovery — clear/compact/resume/fork with semantic checkpoints"
```

---

### Task 6: Steering Instruction Versioning + Evidence UI Upgrade

**Files:**
- Modify: `apps/api/src/routes/steering.ts` — create instruction version on steering delivery
- Modify: `apps/web/src/components/views/evidence-view.tsx` — show validity badges, staleness indicators
- Modify: `apps/web/src/components/steering/move-detail-drawer.tsx` — show instruction version history
- Modify: `apps/web/src/components/kanban/kanban-card.tsx` — show verification state (stale badge)
- Add i18n keys for evidence staleness and steering versioning

**Interfaces:**
- Consumes: attempt_instruction_versions table, evidence validity states
- Produces: visible steering history + evidence validity in UI

- [ ] **Steps 1-3: Implement versioning, evidence UI, commit**

```bash
git commit -m "feat: steering instruction versioning + evidence staleness UI indicators"
```

---

### Task 7: Integration Test — Phase 5/6/7 Exit Gates

**Files:**
- No new files — this is verification of the complete SP2 stack

**Tests:**

1. **Phase 5 exit gate:** While Claude-equivalent process runs → user sends constraint from browser → verify steering_command created → verify edge push → verify steering appears in pending queue → verify hook delivers it
2. **Phase 6 exit gate:** Create evidence with `fresh_until` → verify valid → advance time past expiry → worker marks stale → move re-enters VERIFY
3. **Phase 7 exit gate:** Create case with constraints → simulate clear (SessionStart with source=clear) → verify constraints in capsule output

- [ ] **Step 1: Run full E2E verification, commit any fixes**

```bash
git commit -m "feat: SP2 complete — steering + evidence + context recovery"
```
