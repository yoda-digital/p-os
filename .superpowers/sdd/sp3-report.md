# SP3: Managed Execution — Implementation Report

**Status:** Complete
**Date:** 2026-09-08
**Build:** All 31 turbo tasks pass (`pnpm build` clean)

---

## Summary

SP3 enables browser-triggered Claude execution: a user clicks "Execute" on a Move, the system compiles an execution strategy, dispatches to a connected device, launches `claude --bg`, and shows live progress — without the user opening a terminal.

## Tasks Completed

### Task 1: Migration 005 + Execution Compiler
- **Migration:** `packages/db/src/migrations/005_managed_execution.sql` — adds `claude_job_id`, `working_directory`, `worktree_path`, `model_used`, `execution_plan` columns to `attempts` table with indexes
- **Execution Compiler:** `packages/execution/src/index.ts` — full rewrite with:
  - `compile(move, capabilities, policy, device)` → `ExecutionPlan`
  - Strategy selection rules matching spec §2.3 (8 strategies)
  - Model/effort routing matching spec §2.4 (risk override, complexity-based)
  - WHY explanation for every strategy choice (spec §2.5)
  - Complexity inference from move metadata
  - Budget computation with deadline awareness
  - Organization policy overrides

### Task 2: Dispatcher Upgrade
- **ProcessDispatcher:** `edge/dispatcher/src/index.ts` — rewritten with real CLI integration
- **CLI wrapper:** `edge/dispatcher/src/cli.ts` — typed interface over `claude --bg`, `claude agents --json`, `claude stop`, `claude logs`
- **Session tracker:** `edge/dispatcher/src/session-tracker.ts` — tracks active sessions with full recovery via `claude agents --json` reconciliation
- **Mock mode:** auto-detected when `claude` CLI unavailable (dev environments)
- **Polling:** periodic session status check to detect ended sessions

### Task 3: Execution API Routes
- **Routes:** `apps/api/src/routes/execution.ts` with 4 endpoints:
  - `POST /v1/moves/:id/execute` — compile plan + dispatch via Edge WSS
  - `GET /v1/moves/:id/execution` — get current execution status with WHY
  - `POST /v1/moves/:id/stop` — stop execution
  - `GET /v1/attempts/:id/logs` — get attempt logs with events + steering
- **Edge dispatch:** `apps/realtime/src/edge.ts` — added `dispatchPendingCommands()` for StartMove/Stop command delivery, session lifecycle event handling (session_started, session_ended, session_stopped, session_start_failed)
- **Registered** in `apps/api/src/index.ts`

### Task 4: Execution UI
- **ExecutionControls:** `apps/web/src/components/execution/execution-controls.tsx` — Execute/Stop buttons, strategy badge, model/effort display, WHY explanation, progress
- **StrategyBadge:** reusable component for kanban card strategy indicator
- **Hooks:** `apps/web/src/hooks/use-execution.ts` — react-query hooks with 5s polling
- **API methods:** added to `apps/web/src/lib/api.ts` (executeMove, getExecutionStatus, stopExecution, getAttemptLogs)
- **Kanban card:** shows strategy badge next to execution state
- **Move detail drawer:** integrated ExecutionControls between Actions and Dependencies
- **i18n:** added `execution.json` for en/ro/ru locales

### Task 5: Cross-Session Messaging + Integration
- **Messaging:** `edge/dispatcher/src/messaging.ts` — cross-session message relay with:
  - Native SendMessage when available (capability-probed)
  - Fallback via Process Events
  - Message queue for undelivered messages
  - Mirror all messages into Process Events for audit trail
- **Plugin hook:** `plugin/claude-code/src/hooks/post-tool-use.ts` — detects SendMessage tool usage and enqueues CrossSessionMessage events
- **Build verified:** `pnpm build` passes all 31 turbo tasks

## Files Created
- `packages/db/src/migrations/005_managed_execution.sql`
- `edge/dispatcher/src/cli.ts`
- `edge/dispatcher/src/session-tracker.ts`
- `edge/dispatcher/src/messaging.ts`
- `apps/api/src/routes/execution.ts`
- `apps/web/src/components/execution/execution-controls.tsx`
- `apps/web/src/hooks/use-execution.ts`
- `apps/web/src/i18n/locales/en/execution.json`
- `apps/web/src/i18n/locales/ro/execution.json`
- `apps/web/src/i18n/locales/ru/execution.json`

## Files Modified
- `packages/execution/src/index.ts` (rewritten)
- `edge/dispatcher/src/index.ts` (rewritten)
- `apps/api/src/index.ts` (route registration)
- `apps/realtime/src/edge.ts` (command dispatch + session events)
- `apps/web/src/lib/api.ts` (execution API methods + types)
- `apps/web/src/components/kanban/kanban-card.tsx` (strategy badge)
- `apps/web/src/components/steering/move-detail-drawer.tsx` (execution controls)
- `apps/web/src/i18n/config.ts` (execution namespace)
- `plugin/claude-code/src/hooks/post-tool-use.ts` (cross-session detection)

## Architecture Notes
- The dispatcher is a thin daemon — it does NOT recreate Claude's supervisor
- All state mutations flow through Commands → Events
- The execution compiler is deterministic: same input → same plan
- Mock mode allows full development without the Claude CLI installed
- Session recovery uses `claude agents --json` to rebind orphaned sessions
