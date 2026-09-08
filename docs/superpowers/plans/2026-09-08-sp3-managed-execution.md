# SP3: Managed Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable browser-triggered Claude execution — click Execute on a Move, the system compiles a strategy, dispatches to a device, launches `claude --bg`, and shows live progress — without the user opening a terminal.

**Architecture:** Execution Compiler analyzes Move semantics and selects strategy. ProcessDispatcher (upgraded from SP1) receives commands via Edge WSS and launches `claude --bg`. Attempts track claude_job_id, worktree, and model. Recovery via `claude agents --json`.

**Tech Stack:** TypeScript, Hono, child_process (for CLI), ws, React

**Spec:** `docs/superpowers/specs/2026-09-08-sp3-managed-execution.md`

## Global Constraints
- MUST NOT recreate Claude's supervisor — use native Agent View
- All state mutations through Commands → Events
- Execution strategies: current_session, fresh_session, background_session, subagent, agent_team, dynamic_workflow, human, wait

---

### Task 1: Migration 005 + Execution Compiler

**Files:**
- Create: `packages/db/src/migrations/005_managed_execution.sql`
- Rewrite: `packages/execution/src/index.ts` — full execution compiler

Add columns to attempts (claude_job_id, working_directory, worktree_path, model_used, execution_plan). Implement the execution compiler with strategy selection rules and model/effort routing from spec §2.

- [ ] **Commit:** `feat: migration 005 + execution compiler (strategy selection, model routing)`

---

### Task 2: Dispatcher Upgrade

**Files:**
- Rewrite: `edge/dispatcher/src/index.ts` — real CLI integration
- Create: `edge/dispatcher/src/cli.ts` — Claude CLI wrapper (`claude --bg`, `claude agents --json`, `claude stop`)
- Create: `edge/dispatcher/src/session-tracker.ts` — active session tracking and recovery

Upgrade the existing ProcessDispatcher skeleton to actually call `claude --bg` via child_process, parse `claude agents --json`, handle crash recovery by re-querying Agent View.

For development (when `claude` CLI may not be available), use a mock mode that simulates session lifecycle.

- [ ] **Commit:** `feat: dispatcher with real CLI integration (claude --bg, agents, stop, recovery)`

---

### Task 3: Execution API Routes + Browser Trigger

**Files:**
- Create: `apps/api/src/routes/execution.ts` — execute, status, stop, logs endpoints
- Modify: `apps/api/src/index.ts` — register execution routes
- Modify: `apps/realtime/src/edge.ts` — dispatch StartMove commands to connected devices

Endpoints: `POST /moves/:id/execute`, `GET /moves/:id/execution`, `POST /moves/:id/stop`, `GET /attempts/:id/logs`.

Execute flow: validate move → compile execution plan → find connected device → push StartMove via Edge WSS → create Attempt record.

- [ ] **Commit:** `feat: execution API routes (trigger, status, stop, logs) + Edge dispatch`

---

### Task 4: Execution UI

**Files:**
- Create: `apps/web/src/components/execution/execution-controls.tsx` — Execute/Stop buttons + strategy display
- Modify: `apps/web/src/components/kanban/kanban-card.tsx` — execution indicator
- Modify: `apps/web/src/components/steering/move-detail-drawer.tsx` — integrate execution controls
- Modify: `apps/web/src/lib/api.ts` — add execution API methods
- Create: `apps/web/src/hooks/use-execution.ts` — react-query hooks
- Add i18n keys for execution

Execution controls show: strategy badge, model/effort, progress, Execute/Stop buttons, logs link.

- [ ] **Commit:** `feat: execution UI — trigger from board, live strategy display`

---

### Task 5: Cross-Session Messaging + Integration

**Files:**
- Create: `edge/dispatcher/src/messaging.ts` — cross-session message relay
- Modify: `plugin/claude-code/src/hooks/post-tool-use.ts` — detect cross-session messages

If cross_session_messaging capability is available, relay messages between sessions and mirror into Process Events. Integration test: verify full flow from browser Execute → dispatcher → Claude launch → progress visible.

- [ ] **Commit:** `feat: SP3 complete — managed execution with browser-triggered Claude launch`
