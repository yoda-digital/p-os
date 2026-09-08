# SP2: Steering + Evidence + Context — Design Spec

**Status:** Approved  
**Date:** 2026-09-08  
**Depends on:** SP1 (Claude Integration Core)  
**Source:** `implementation_plan.md` Phases 5-7, `specs_design.md`, `blueprint.md`

---

## 1. Live Steering (Phase 5)

### 1.1 Steering Delivery Pipeline

Three delivery classes, baseline is Class 2 (safe-point injection):

```
Browser → POST /api/v1/steering → steering_commands table → Edge WSS push
→ plugin pending_steering SQLite → PreToolUse/Stop hook → additionalContext injection → Claude
```

### 1.2 Steering Types

| Type | Effect | Delivery |
|------|--------|----------|
| `advisory` | Suggestion, Claude may ignore | Safe-point |
| `constraint` | Must be followed | Safe-point |
| `redirect` | Change direction | Safe-point |
| `pause` | Pause execution | Safe-point |
| `hard_stop` | Terminate immediately | Runtime interruption |
| `fork` | Create parallel attempt | Safe-point |
| `reassign` | Change executor | Safe-point |

### 1.3 Steering State Machine

`issued` → `delivered_to_edge` → `delivered_to_executor` → `acknowledged` → `applied`

Each transition emits an event. UI shows honest state — "Sent" never falsely means "Applied."

### 1.4 Steering Versioning

Never rewrite prior instructions. Each steering creates a new Attempt instruction version:
```
Attempt #1 Instructions v1: "Implement auth module"
Attempt #1 Instructions v2: "Implement auth module. CONSTRAINT: Do not modify public API."
```

### 1.5 Steering Composer UI

Active card exposes: STEER, PAUSE, STOP, FORK, REASSIGN, ADD CONSTRAINT buttons.

UI distinguishes advisory/constraint/redirect with visual indicators.

Real-time state feedback: issued → edge → executor → acknowledged → applied.

### 1.6 Hard Stop

For background sessions: `claude stop <job-id>` via dispatcher.
For interactive sessions: UI shows "Cannot hard-stop an interactive session — user controls the terminal."

---

## 2. Evidence & Completion Engine (Phase 6)

### 2.1 Evidence Registry Upgrade

Evidence fields: `scope`, `provenance`, `observed_at`, `fresh_until`, `confidence` (0-1), `relation` (supports/contradicts/...), `artifact_ref`, `source_ref`, `validity` (valid/stale/invalid/disputed/unknown).

### 2.2 Staleness Triggers

| Trigger | Mechanism |
|---------|-----------|
| Git commit after evidence | PostToolUse detects `git commit` → mark test/build evidence stale |
| File hash change | FileChanged hook → evidence referencing that file becomes stale |
| Rule superseded | Rule.Supersede command → compliance evidence needs re-eval |
| Approval expires | `fresh_until` timestamp passed → evidence stale |
| Source retracted | Manual retraction → cascading confidence recalculation |

### 2.3 Staleness Propagation

Causal chain: if evidence A supports assertion B which justifies move C's verification, invalidating A cascades:
1. A → stale
2. B → confidence recalculated
3. C → if verification depended on A, C re-enters VERIFY column

### 2.4 Completion Contracts

```typescript
type CompletionContract =
  | { type: 'all'; conditions: CompletionCondition[] }
  | { type: 'any'; conditions: CompletionCondition[] }
  | { type: 'threshold'; count: number; conditions: CompletionCondition[] }
  | { type: 'approval'; approver_role: string }
  | { type: 'evidence'; evidence_type: string; scope: Record<string, unknown> }
  | { type: 'external_state'; check: string };
```

### 2.5 Completion Engine

Evaluates independently from executor task state. Claude saying "done" ≠ Move satisfied.

```
TaskCompleted hook → load Move's completion_contract → evaluate against evidence/approvals
→ all conditions met? → allow completion + emit MoveSatisfied
→ conditions missing? → block completion + return { blockCompletion: true, message: "Missing: ..." }
```

### 2.6 Evidence Staleness Controller

New controller in the worker that periodically:
1. Checks `fresh_until` timestamps on evidence → mark expired ones stale
2. Checks recent git events → mark affected test/build evidence stale
3. Propagates staleness to dependent assertions and moves
4. Re-evaluates completion contracts on affected moves
5. Moves cards back to VERIFY if verification was based on now-stale evidence

---

## 3. Context Orchestrator (Phase 7)

### 3.1 SessionStart Hydration (already partially in SP1)

Enhance the SP1 SessionStart handler to use the full Context Capsule generator:
- `new` → full capsule
- `resume` → capsule with DELTA section from events since last ack
- `clear` → full capsule (critical constraints MUST survive)
- `compact` → full capsule (compare with PostCompact native summary, fill gaps)
- `fork` → capsule with fork context (parent attempt + divergence point)

### 3.2 PreCompact Handler

```
PreCompact → save semantic checkpoint to SQLite:
  - Current case/move/attempt IDs
  - Critical constraints
  - Active steering
  - Unsatisfied dependencies
  - Failed approaches (DO NOT REPEAT)
```

### 3.3 PostCompact Handler

```
PostCompact → receive native compact summary → compare with checkpoint:
  - Are critical constraints preserved in the summary?
  - Are active steering commands mentioned?
  - Is the current objective clear?
  → If gaps: flag for SessionStart(compact) rehydration
```

### 3.4 Resume Intelligence

On SessionStart with `initiation_source: 'resume'`:
```
Assess:
  - seconds_since_last_response
  - estimated context tokens (if available)
  - prompt_cache_likely_expired
  - number of events since last session

Decide:
  - < 5 min, cache likely warm → resume as-is (no extra context)
  - 5-60 min → resume + delta (inject only new events)
  - 1-24 hours → full capsule rehydration
  - > 24 hours → recommend fresh session
```

### 3.5 Context Health Assessment

9 dimensions (from SP1 Task 6 health.ts — enhance):
```
token_pressure, relevance_density, stale_assumption_density,
contradiction_density, tool_output_bloat, phase_shift,
pivot_count, remaining_expected_work, resume_cache_cost
```

### 3.6 Session Rotation Recommendations

Context health → recommendation:
- Green (all healthy) → CONTINUE
- Yellow (some pressure) → COMPACT_RECOMMENDED
- Orange (degraded) → ROTATE_FRESH recommended
- Red (critical) → ROTATE_FRESH required

Initially: system recommends, human approves via Attention item.

---

## 4. DB Changes

Migration `004_evidence_context.sql`:
```sql
-- Evidence staleness tracking
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS fresh_until TIMESTAMPTZ;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS artifact_ref JSONB;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS source_ref JSONB;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS provenance JSONB DEFAULT '{}';
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ;

-- Completion contracts on moves
ALTER TABLE moves ADD COLUMN IF NOT EXISTS completion_contract JSONB;

-- Steering instruction versions
CREATE TABLE IF NOT EXISTS attempt_instruction_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES attempts(id),
  version INTEGER NOT NULL,
  instructions TEXT NOT NULL,
  steering_id UUID REFERENCES steering_commands(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attempt_versions ON attempt_instruction_versions(attempt_id, version);

-- Context checkpoints (for compact recovery)
CREATE TABLE IF NOT EXISTS context_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  case_id UUID NOT NULL REFERENCES cases(id),
  checkpoint_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_context_checkpoints ON context_checkpoints(session_id, created_at DESC);
```

---

## 5. Exit Gates

**Phase 5:** User changes constraint from browser → Claude receives it → Attempt history records both versions → board updates → WHY explains the redirect.

**Phase 6:** Tests pass → evidence valid → commit changes code → evidence stale → Move re-enters Verify → automatically.

**Phase 7:** Case survives: new, resume, compact, clear, fresh, fork — preserving objective, decisions, constraints, blockers, evidence, failed approaches.
