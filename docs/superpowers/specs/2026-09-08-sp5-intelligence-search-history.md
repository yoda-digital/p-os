# SP5: Intelligence + Search + History + Simulation — Design Spec

**Status:** Approved  
**Date:** 2026-09-08  
**Depends on:** SP1, SP2, SP4 (for pack-aware search/WHY)  
**Source:** `implementation_plan.md` Phases 13-16, `specs_design.md`, `blueprint.md`

---

## 1. Universal Search

### 1.1 Search Modes

| Mode | Input | Mechanism |
|------|-------|-----------|
| Exact | keyword string | SQL `ILIKE` across title, description, statement fields |
| Filtered | structured filters | SQL `WHERE` with type, lifecycle, priority, date range, actor |
| Semantic | natural-language phrase | pg_trgm similarity + optional embedding-based retrieval |
| Graph | entity/relation traversal | Recursive CTE across relations table |
| Natural language | free-form question | LLM compiles to a structured query, then executes it — never opaque |

### 1.2 NL Query Compilation

User types: "Show me all blocked moves with high priority"  
System compiles to: `{ type: 'move', filters: { readiness: 'not_ready', priority: 'high' } }`  
Executes the structured query. Shows the compiled query to the user for transparency.

### 1.3 Search Scope

Searches across: Cases, Moves, Decisions, Evidence, Assertions, Entities, Relations, Rules, Events, Actors.

### 1.4 API

```
GET  /v1/search?q=<text>&type=<type>&filters=<json>
POST /v1/search/nl   — { query: "natural language question" } → compiled structured query + results
```

### 1.5 UI

Global search bar in the app header. Results grouped by type. Filter sidebar. Saved searches.

---

## 2. WHY Expansion

### 2.1 Ten Question Types

| Question | Returns |
|----------|---------|
| `WHY blocked?` | Unsatisfied dependencies + pending decisions |
| `WHY active?` | Activation event + who activated + why |
| `WHY done?` | Satisfaction evidence + completion contract evaluation |
| `WHY this agent?` | Execution compiler decision + capability match |
| `WHY this model?` | Model routing policy + risk/complexity assessment |
| `WHY this task?` | Intent → Move decomposition chain |
| `WHY now?` | Priority + deadline + dependency readiness |
| `WHY did this change?` | Event diff between two states |
| `WHY is evidence stale?` | Staleness trigger chain (commit → test stale → verification stale) |
| `WHY does this require me?` | Authority policy + action type + role requirement |

### 2.2 Deterministic First, AI Second

Every WHY answer returns:
1. **Deterministic causal path** — the actual events and data that caused the state
2. **LLM explanation** (optional wrap) — human-readable prose summarizing the causal path

The LLM may improve prose but MUST NOT invent causality.

### 2.3 API

```
POST /v1/why  — { caseId, question, moveId?, targetId?, timestamp? }
→ { question, explanation, causal_chain: [...], deterministic_path: [...] }
```

---

## 3. Historical WHY

### 3.1 Mechanism

"Why was M42 blocked at 14:37?" requires:
1. Replay events up to `case_sequence` at timestamp 14:37
2. Reconstruct Move state at that point (readiness, dependencies, decisions)
3. Run the WHY engine against that reconstructed state

### 3.2 Implementation

```typescript
async function historicalWhy(sql, caseId, moveId, timestamp, question) {
  // Get events up to timestamp
  const events = await getEventsUpToTime(sql, caseId, timestamp);
  // Reconstruct state by replaying events
  const state = replayEvents(events);
  // Run WHY against reconstructed state
  return evaluateWhy(state, moveId, question);
}
```

### 3.3 State Reconstruction

Replay events to build point-in-time snapshots of: moves (state vector), dependencies, evidence validity, active rules, pending decisions.

---

## 4. Time Travel (Full)

### 4.1 Enhancements over Existing

Current: event slider + event list + "select to view snapshot"  
Full: + before/after diff view + causal event list for any change + historical WHY integration

### 4.2 Before/After Diff

Select two events → show what changed between them: moves added/modified, evidence attached/invalidated, decisions made, steering applied.

### 4.3 API

```
GET /v1/time-travel/:caseId/diff?from=<seq>&to=<seq>
→ { changes: [{ type, entity, field, before, after, caused_by_event }] }
```

---

## 5. Process Metrics

### 5.1 Eleven Metrics

| Metric | Computation |
|--------|------------|
| cycle_time | Mean time from Move creation to satisfaction |
| waiting_time | Mean time Moves spend in WAITING/NEEDS_INPUT |
| rework_count | Moves that re-entered ACTIVE after being in VERIFY |
| failed_attempts | Total failed attempts / total attempts |
| human_attention_time | Time between Attention item creation and resolution |
| evidence_gaps | Moves with completion contracts missing evidence |
| completion_reliability | Moves satisfied on first attempt / total satisfied |
| cost | Total monetary cost across all attempts |
| executor_performance | Success rate per executor/model combination |
| context_rotations | Session rotations per Case |
| steering_frequency | Steering commands per Case per hour |

### 5.2 API

```
GET /v1/intelligence/metrics?caseId=<id>&period=<7d|30d|all>
```

---

## 6. Process Drift Detection

### 6.1 Drift Signals

| Signal | Detection |
|--------|-----------|
| Repeated manual steps | Same action pattern by same actor > 3 times |
| Hidden dependencies | Moves frequently blocked by the same other move |
| Loops | Move enters same state > 2 times |
| Rework hotspots | Moves with > 2 failed attempts |
| Approval bottlenecks | Decisions pending > threshold time |

### 6.2 Drift Report

```
GET /v1/intelligence/drift?caseId=<id>
→ { anomalies: [{ type, description, severity, affected_moves, recommendation }] }
```

---

## 7. AI Process Architect

Advisor agent — proposes but never autonomously mutates.

**Proposals:** parallelize sequential moves, add missing verification, remove obsolete steps, change executor, modify pack, add missing evidence requirements.

**Implementation:** A scheduled analysis (triggered manually or on significant events) that examines the Case process graph and generates `ProcessInsight` records.

```
POST /v1/intelligence/analyze?caseId=<id>
→ { insights: [{ type, recommendation, confidence, affected_moves, estimated_impact }] }
```

---

## 8. AI Process Guardian

Protector agent — monitors continuously.

**Monitors for:** scope drift (new moves outside original intent), policy breach (action without authority), stale evidence on critical paths, deadline risk, unauthorized work, duplicate effort across attempts, agent loops (repeated tool failures).

**Implementation:** Worker controller that evaluates on every event cycle and creates Attention items for detected issues.

---

## 9. Simulation Engine

### 9.1 Forked State

Create a hypothetical fork of a Case at a point in time. Apply simulated changes. See projected outcomes.

```
POST /v1/simulation/fork   — { caseId, description, changes: [...] }
GET  /v1/simulation/:id    — get simulation state
POST /v1/simulation/:id/apply  — apply simulated event
POST /v1/simulation/:id/adopt  — adopt selected changes as real Commands
```

### 9.2 What-If Scenarios

- What if deadline moves to next week?
- What if a key person becomes unavailable?
- What if we choose strategy B?
- What if budget is reduced by 30%?

### 9.3 Isolation

Simulation events NEVER mix with canonical events. Separate `simulation_events` table. Adoption creates explicit canonical Commands.

### 9.4 DB Changes

```sql
-- Migration 007_intelligence_simulation.sql

-- Search index support
CREATE INDEX IF NOT EXISTS idx_cases_title_trgm ON cases USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_moves_title_trgm ON moves USING gin (title gin_trgm_ops);
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Process insights
CREATE TABLE IF NOT EXISTS process_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id),
  type TEXT NOT NULL,
  source TEXT NOT NULL, -- 'architect' | 'guardian' | 'drift'
  recommendation TEXT NOT NULL,
  confidence NUMERIC(3,2),
  affected_move_ids UUID[] DEFAULT '{}',
  estimated_impact TEXT,
  status TEXT DEFAULT 'open', -- open, accepted, rejected, superseded
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Simulation events (separate from canonical)
CREATE TABLE IF NOT EXISTS simulation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID NOT NULL REFERENCES simulation_forks(id),
  type TEXT NOT NULL,
  data JSONB NOT NULL,
  sequence INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 10. Exit Gates

**Phase 13:** Every major visible UI state exposes a meaningful WHY.

**Phase 14:** Historical WHY answers using state as it existed at the queried time.

**Phase 15:** "This process repeatedly stalls here and these three historical patterns are responsible" — structured evidence, not generic prose.

**Phase 16:** Simulation adoption creates explicit canonical Commands, never invisible merges.
