# SP3: Managed Execution — Design Spec

**Status:** Approved  
**Date:** 2026-09-08  
**Depends on:** SP1, SP2  
**Source:** `implementation_plan.md` Phases 8-9, `specs_design.md`, `blueprint.md`

---

## 1. Thin Dispatcher

### 1.1 Responsibilities
- Maintain WSS connection to control plane (reuse ProcessEdge from SP1)
- Receive signed semantic commands (StartMove, Stop)
- Launch `claude --bg --name <moveId>` with hydrated context capsule
- Query `claude agents --json` for session discovery
- Stop/respawn via `claude stop <id>`
- Map background sessions → Attempts (store job ID, session ID, working directory, worktree, model)
- MUST NOT recreate Claude's supervisor — use native Agent View

### 1.2 CLI Integration
```
claude --bg --name <moveId> -p "<context capsule text>"
claude agents --json → [{ id, name, status, cwd, ... }]
claude stop <id>
claude respawn <id>
claude logs <id>
```

### 1.3 Session Binding
When dispatcher launches a session:
1. Create Attempt record with `executor_id`, `strategy`, `model`
2. Store `claude_job_id` from `--bg` response
3. Store working directory and worktree path
4. Update edge connection's `active_sessions`

### 1.4 Recovery
On dispatcher restart:
1. Run `claude agents --json` to discover existing sessions
2. Match by `name` (which is moveId) → rebind to canonical Attempts
3. Update any stale session states
4. Report reconciliation to control plane

---

## 2. Execution Compiler

### 2.1 Inputs
- Move semantics (class, priority, risk, constraints, dependencies)
- Available capabilities (from CapabilityStore)
- Organization policy (model restrictions, budget)
- Current device state (active sessions count, available resources)

### 2.2 Output — ExecutionPlan
```typescript
interface ExecutionPlan {
  executor: 'claude_code' | 'human' | 'webhook';
  strategy: 'current_session' | 'fresh_session' | 'background_session' | 'subagent' | 'agent_team' | 'dynamic_workflow' | 'human' | 'wait';
  session_policy: 'fresh' | 'resume' | 'fork';
  model_policy: 'auto' | 'fast' | 'standard' | 'capable';
  effort_policy: 'low' | 'medium' | 'high';
  isolation: 'none' | 'worktree' | 'container';
  parallelism: number;
  verification_strategy: string;
  budget?: { max_tokens?: number; max_cost_usd?: number };
}
```

### 2.3 Strategy Selection Rules
```
simple local task (low complexity, no deps) → current_session or fresh_session
independent investigation → subagent
parallel independent work → agent_team (if available, else multiple subagents)
fan-out/fan-in, research → dynamic_workflow (if available)
background coding → background_session + worktree
human authority required → human executor → Attention queue
external wait → wait strategy
```

### 2.4 Model/Effort Routing
```
low complexity  → model: fast, effort: low
medium          → model: standard, effort: medium
high complexity → model: capable, effort: high
high risk       → model: capable, effort: high (override)
```

### 2.5 WHY Explanation
The compiler must explain its choices: `WHY this execution strategy?` returns the decision factors.

---

## 3. Browser-Triggered Execution

### 3.1 Flow
1. User clicks "Execute" on a Move from the Kanban board
2. API creates ExecutionPlan via compiler
3. If strategy needs a device: push StartMove command via Edge WSS
4. Dispatcher receives → launches `claude --bg`
5. Board shows live progress (via existing WebSocket)

### 3.2 API Endpoints
```
POST /api/v1/moves/:id/execute    — Trigger execution (compile + dispatch)
GET  /api/v1/moves/:id/execution  — Get execution status
POST /api/v1/moves/:id/stop       — Stop execution
GET  /api/v1/attempts/:id/logs    — Get attempt logs
```

### 3.3 Execution Status Widget
On the Kanban card and Move detail drawer: execution indicator showing strategy, model, progress, logs link.

---

## 4. Cross-Session Messaging
- Use native `SendMessage` where available (capability-probed)
- Mirror meaningful messages into Process Events
- Fallback: handoff via Process Events when messaging unavailable

---

## 5. DB Changes
```sql
-- Migration 005
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS claude_job_id TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS working_directory TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS worktree_path TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS execution_plan JSONB;
```

---

## 6. Exit Gates

**Phase 8:** Move created from browser → machine launches Claude → context hydrated → executes → progress visible → evidence produced — without user opening terminal.

**Phase 9:** Four test Moves → compiler selects different strategies for each → WHY explains each choice.
