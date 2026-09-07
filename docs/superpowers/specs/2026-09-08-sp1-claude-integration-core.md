# SP1: Claude Integration Core — Design Spec

**Status:** Draft  
**Date:** 2026-09-08  
**Depends on:** Running system (Phases 1-4 + i18n/RBAC)  
**Source:** `vision.md`, `blueprint.md`, `specs_design.md`, `implementation_plan.md` — Phases 0 & 3

---

## 1. Overview

SP1 connects Universal Process OS to Claude Code. After this sub-project, installing the plugin from a clean machine and opening a project makes the Process OS board come alive with Claude's actual work.

**Deliverables:**
1. Claude Code plugin (marketplace-ready manifest, skills, agents)
2. Process MCP server (12 tools)
3. Hook handlers (Tier 1: 7 hooks, Tier 2: 7 hooks, Tier 3: 10 hooks)
4. Process Edge (WSS connection to control plane, local outbox, policy mirror)
5. Local storage layer (SQLite under `${CLAUDE_PLUGIN_DATA}`)
6. Session binding & Context Capsule injection
7. Capability discovery (feature probing, not version strings)
8. Device pairing flow

---

## 2. Plugin Manifest & Layout

### 2.1 Directory Structure

```
plugin/claude-code/
├── plugin.json                 # Manifest
├── package.json                # Dependencies (better-sqlite3, ws)
├── package-lock.json
├── bin/
│   └── process-edge            # Edge helper binary/script
├── skills/
│   ├── connect.md              # Pairing & setup
│   ├── process.md              # Process overview & current state
│   ├── why.md                  # WHY explanations
│   ├── steer.md                # Steering interface
│   └── context.md              # Context management
├── agents/
│   ├── process-architect.md    # AI process advisor
│   ├── process-guardian.md     # Scope/policy protector
│   └── evidence-verifier.md    # Evidence validation
├── hooks/
│   └── hooks.json              # Hook declarations
├── monitors/
│   └── monitors.json           # Background monitors
├── .mcp.json                   # MCP server declaration
└── src/
    ├── mcp/                    # Process MCP server
    │   ├── server.ts           # MCP server entry
    │   ├── tools/              # One file per tool
    │   └── auth.ts             # Request authentication
    ├── hooks/                  # Hook handlers
    │   ├── handler.ts          # Main hook dispatcher
    │   ├── session-start.ts
    │   ├── task-created.ts
    │   ├── task-completed.ts
    │   ├── pre-tool-use.ts
    │   ├── post-tool-use.ts
    │   ├── stop.ts
    │   └── session-end.ts
    ├── edge/                   # Process Edge
    │   ├── connection.ts       # WSS client
    │   ├── outbox.ts           # Local event outbox
    │   ├── policy-mirror.ts    # Cached policy enforcement
    │   └── dispatcher.ts       # Command dispatch
    ├── storage/                # Local persistent storage
    │   ├── db.ts               # SQLite wrapper
    │   ├── device.ts           # Device identity
    │   ├── sessions.ts         # Session bindings
    │   ├── cache.ts            # Process cache
    │   └── capability.ts       # Capability profile
    ├── context/                # Context Capsule
    │   ├── capsule.ts          # Capsule generator
    │   ├── hydration.ts        # SessionStart injection
    │   └── health.ts           # Context health assessment
    └── pairing/                # Device pairing
        ├── flow.ts             # Pairing flow
        └── token.ts            # Token management
```

### 2.2 plugin.json

```json
{
  "name": "universal-process-os",
  "version": "0.1.0",
  "displayName": "Universal Process OS",
  "description": "Semantic process management for Claude Code — event-sourced cases, moves, evidence, and bidirectional steering",
  "author": "YODA Digital",
  "homepage": "https://ai-kanban.yoda.digital",
  "skills": ["skills/*.md"],
  "agents": ["agents/*.md"],
  "hooks": "hooks/hooks.json",
  "monitors": "monitors/monitors.json",
  "mcpServers": ".mcp.json",
  "bin": { "process-edge": "bin/process-edge" },
  "userConfig": {
    "control_plane_url": {
      "type": "string",
      "description": "Process OS control plane URL",
      "default": "https://ai-kanban.yoda.digital"
    },
    "organization_hint": {
      "type": "string",
      "description": "Organization slug for auto-discovery"
    },
    "deployment_mode": {
      "type": "string",
      "enum": ["cloud", "self-hosted", "local"],
      "default": "local",
      "description": "Deployment mode"
    }
  }
}
```

### 2.3 .mcp.json

```json
{
  "process-os": {
    "command": "node",
    "args": ["src/mcp/server.js"],
    "env": {
      "PLUGIN_DATA": "${CLAUDE_PLUGIN_DATA}",
      "CONTROL_PLANE_URL": "${userConfig.control_plane_url}"
    }
  }
}
```

### 2.4 hooks/hooks.json

```json
{
  "hooks": [
    {
      "event": "SessionStart",
      "command": "node src/hooks/handler.js session-start",
      "timeout": 5000
    },
    {
      "event": "TaskCreated",
      "command": "node src/hooks/handler.js task-created",
      "timeout": 2000
    },
    {
      "event": "TaskCompleted",
      "command": "node src/hooks/handler.js task-completed",
      "timeout": 3000
    },
    {
      "event": "PreToolUse",
      "command": "node src/hooks/handler.js pre-tool-use",
      "timeout": 1000,
      "matcher": { "tool_name": "*" }
    },
    {
      "event": "PostToolUse",
      "command": "node src/hooks/handler.js post-tool-use",
      "timeout": 1000
    },
    {
      "event": "Stop",
      "command": "node src/hooks/handler.js stop",
      "timeout": 2000
    },
    {
      "event": "SessionEnd",
      "command": "node src/hooks/handler.js session-end",
      "timeout": 2000
    },
    {
      "event": "PreCompact",
      "command": "node src/hooks/handler.js pre-compact",
      "timeout": 3000
    },
    {
      "event": "PostCompact",
      "command": "node src/hooks/handler.js post-compact",
      "timeout": 3000
    },
    {
      "event": "SubagentStart",
      "command": "node src/hooks/handler.js subagent-start",
      "timeout": 1000
    },
    {
      "event": "SubagentStop",
      "command": "node src/hooks/handler.js subagent-stop",
      "timeout": 1000
    }
  ]
}
```

---

## 3. Process MCP Server

### 3.1 Tools (12 total)

Each tool returns quickly. Long operations use the local outbox.

| Tool | Description | Returns |
|------|-------------|---------|
| `process.case.get` | Get current bound Case with summary | Case + summary + active intents |
| `process.case.search` | Search cases by title/type/lifecycle | Case list |
| `process.move.get` | Get Move details + state vector | Move + dependencies + evidence |
| `process.move.list` | List Moves for current Case | Move list with state |
| `process.move.propose` | Propose a new Move | Created Move (via Command) |
| `process.move.bind_task` | Map Claude native task to an Attempt | Attempt binding |
| `process.evidence.register` | Register Evidence (test pass, commit, review) | Evidence record |
| `process.assertion.propose` | Propose a factual assertion | Assertion record |
| `process.decision.request` | Request a human decision | Decision record |
| `process.context.get` | Get current Context Capsule | Capsule with 11 sections |
| `process.why.explain` | Ask WHY about any state | Causal chain + explanation |
| `process.steering.ack` | Acknowledge received steering | Ack status |

### 3.2 Authentication

Each MCP request carries identity via the local SQLite store:
- Device ID (from pairing)
- User ID (from pairing)
- Organization ID
- Current session binding (Case ID, Move ID, Attempt ID)

No per-request authentication tokens — the MCP server runs locally and trusts the local device identity established during pairing.

### 3.3 Transport

Local stdio (standard MCP transport). The MCP server process is started by Claude's MCP runtime from the `.mcp.json` declaration.

For operations requiring the control plane:
- MCP tool → local action (read cache, write outbox) → return immediately
- Background: outbox → WSS edge → control plane → response → update cache

---

## 4. Hook Handlers

### 4.1 Performance Budget

All hooks execute as local command hooks (stdin JSON → process → stdout JSON).

| Metric | Target |
|--------|--------|
| p95 no-op (session not bound) | < 15ms |
| p95 cached policy check | < 50ms |
| p95 SessionStart with cached capsule | < 200ms |
| p95 SessionStart cold (fetch from control plane) | < 2000ms |

### 4.2 SessionStart Handler

**Input:** `{ event: "SessionStart", session: { id, cwd, initiation_source }, ... }`

**Logic:**
1. Load device identity from local SQLite
2. If not paired → return `{ additionalContext: "Run /process:connect to pair this device" }`
3. Detect repository (git remote, cwd) → look up Case binding in local cache
4. If Case found → generate Context Capsule from local cache + delta from control plane
5. If no Case → propose Case creation based on project metadata
6. Return `{ additionalContext: capsule, sessionTitle: "Case: <title>" }`

**Initiation source handling:**
- `new` → full capsule
- `resume` → capsule with delta section populated
- `clear` → full capsule (critical constraints MUST be restored)
- `compact` → full capsule (compare with PostCompact native summary)
- `fork` → capsule with fork context

### 4.3 TaskCreated Handler

**Input:** `{ event: "TaskCreated", session, task: { id, description, ... } }`

**Logic:**
1. If session not bound to Case → exit (< 5ms)
2. Attempt to map Claude task to an existing Move (fuzzy match on description)
3. If match confidence > 0.8 → create Attempt binding, emit `AttemptStarted` to outbox
4. If no match → emit `UnmappedTaskCreated` to outbox for human review
5. Return `{}` (no blocking)

### 4.4 TaskCompleted Handler

**Input:** `{ event: "TaskCompleted", session, task: { id, ... } }`

**Logic:**
1. If session not bound → exit
2. Look up Attempt binding for this task ID
3. If bound → check local completion policy:
   - Are required evidence types present?
   - Did tests pass (check PostToolUse evidence)?
   - Is completion contract satisfied?
4. If policy fails → return `{ blockCompletion: true, message: "Missing: <requirement>" }`
5. If passes → emit `AttemptSucceeded` to outbox, return `{}`

### 4.5 PreToolUse Handler

**Input:** `{ event: "PreToolUse", session, tool: { name, input } }`

**Logic:**
1. If session not bound → exit (fastest path)
2. Check pending steering queue → if steering pending, inject via `additionalContext`
3. Check local policy mirror → if tool/action blocked by policy, return `{ blocked: true, reason: "..." }`
4. Return `{}`

### 4.6 PostToolUse Handler

**Input:** `{ event: "PostToolUse", session, tool: { name, input, output } }`

**Logic:**
1. If session not bound → exit
2. Detect evidence artifacts:
   - `Bash` with test commands → emit `EvidenceDetected` (test results)
   - `Write`/`Edit` → emit `FileModified` for evidence tracking
   - `Bash` with `git commit` → emit `CommitCreated`
3. Enqueue to local outbox
4. Return `{}`

### 4.7 Stop Handler

**Input:** `{ event: "Stop", session }`

**Logic:**
1. If session not bound → exit
2. Check if verification is required before stop:
   - Are there unsatisfied completion requirements?
   - Should we suggest running tests?
3. Max 8 consecutive blocks (tracked in local state)
4. Return `{ blocked: true, message: "..." }` or `{}`

### 4.8 SessionEnd Handler

**Input:** `{ event: "SessionEnd", session }`

**Logic:**
1. Flush local outbox (best-effort)
2. Update session binding status to "ended"
3. Return `{}`

---

## 5. Process Edge

### 5.1 WSS Connection

Outbound-only WebSocket to the control plane.

**Connection URL:** `wss://<control_plane_url>/edge/v1/connect`

**Handshake payload:**
```json
{
  "device_id": "<uuid>",
  "plugin_version": "0.1.0",
  "claude_version": "<detected>",
  "capabilities": ["hooks", "mcp", "tasks", "subagents", ...],
  "active_sessions": [{ "id": "...", "case_id": "...", "move_id": "..." }],
  "last_event_ack": 42
}
```

**Reconnection:** Exponential backoff starting at 1s, max 60s, with jitter. Heartbeat every 30s.

**Resume:** On reconnect, send `last_event_ack` to receive missed events.

### 5.2 Local Outbox

Every hook-generated event writes to SQLite first, then uploads asynchronously:

```sql
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,  -- JSON
  created_at TEXT NOT NULL,
  uploaded_at TEXT,
  retry_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending'  -- pending, uploaded, failed
);
```

Background goroutine/interval drains the outbox every 500ms when WSS is connected.
When WSS is down, events accumulate locally and drain on reconnect.

### 5.3 Local Policy Mirror

Signed policy subset cached locally for offline enforcement:

```sql
CREATE TABLE policy_mirror (
  id TEXT PRIMARY KEY,
  policy_data TEXT NOT NULL,  -- JSON
  version INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  signature TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
```

PreToolUse checks policies from this mirror — never from the control plane (too slow for hook latency budget).

### 5.4 Edge API Endpoint (Control Plane Side)

Add to the API server:

```
GET  /edge/v1/connect          — WebSocket upgrade for edge connections
POST /edge/v1/events           — Receive event batch from edge (HTTP fallback)
GET  /edge/v1/context/:caseId  — Get Context Capsule for a case
GET  /edge/v1/policies         — Get policy mirror for a device
POST /edge/v1/pair             — Device pairing initiation
POST /edge/v1/pair/confirm     — Pairing confirmation
```

---

## 6. Local Storage (SQLite)

All plugin state under `${CLAUDE_PLUGIN_DATA}/process-os.db`:

```sql
-- Device identity
CREATE TABLE device (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  organization_id TEXT,
  paired_at TEXT,
  control_plane_url TEXT,
  auth_token TEXT
);

-- Session bindings
CREATE TABLE session_bindings (
  session_id TEXT PRIMARY KEY,
  case_id TEXT,
  move_id TEXT,
  attempt_id TEXT,
  workspace_path TEXT,
  bound_at TEXT,
  status TEXT DEFAULT 'active'
);

-- Process cache (local copy of remote state)
CREATE TABLE process_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT
);

-- Capability profile
CREATE TABLE capabilities (
  feature TEXT PRIMARY KEY,
  supported INTEGER NOT NULL,
  detected_at TEXT NOT NULL,
  claude_version TEXT
);

-- Steering queue
CREATE TABLE pending_steering (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  move_id TEXT,
  steering_class TEXT NOT NULL,
  payload TEXT NOT NULL,
  received_at TEXT NOT NULL,
  delivered_at TEXT,
  acknowledged_at TEXT
);

-- Stop block counter
CREATE TABLE stop_blocks (
  session_id TEXT PRIMARY KEY,
  consecutive_count INTEGER DEFAULT 0,
  last_blocked_at TEXT
);
```

---

## 7. Context Capsule

### 7.1 Structure (11 sections)

Generated from canonical state (control plane) + local cache:

```markdown
# Process Context — {Case Title}

## IDENTITY
Case: {id} — {title}
Move: {id} — {title} (if bound)
Attempt: {id} (if active)
Organization: {name}

## INTENT
{Primary intent statement}
Success criteria: {completion contract}

## REALITY
{Key entities, verified assertions, known facts}
Uncertainty: {unverified claims}

## DECISIONS
{Applicable decisions — pending and resolved}

## CONSTRAINTS
{Active rules, steering constraints}
{Policy restrictions}

## PROGRESS
Completed: {satisfied moves}
Current: {active moves with state}
Failed approaches: {failed attempts with reasons — DO NOT REPEAT}

## DEPENDENCIES
Blockers: {unsatisfied dependencies}
Downstream: {what depends on current work}

## EVIDENCE
{Relevant evidence — validity status}

## DELTA
{Changes since last session — new events, steering, decisions}

## NEXT
{Recommended next actions based on process state}

## DO NOT REPEAT
{Superseded approaches, cancelled moves, failed strategies}
```

### 7.2 Generation

- **Local cache hit:** Generate from cached state (< 200ms)
- **Cache miss:** Fetch from control plane via HTTP (< 2s), cache locally
- **Delta mode (resume):** Fetch events since `last_event_ack`, append to cached capsule

---

## 8. Device Pairing

### 8.1 Flow

1. User runs `/process:connect` skill in Claude
2. Plugin generates a pairing code (6-digit alphanumeric)
3. Plugin registers code with control plane: `POST /edge/v1/pair { code, device_info }`
4. User opens `<control_plane_url>/pair` in browser, enters the code
5. Browser authenticates user (already logged in) and confirms pairing
6. Control plane calls back to plugin: pairing confirmed with `{ user_id, org_id, auth_token }`
7. Plugin stores device identity in local SQLite
8. Future sessions auto-connect using stored identity

### 8.2 Security

- Pairing codes expire in 5 minutes
- One-time use
- Device auth token is a long-lived JWT (30 days, renewable)
- Private key stays local (future: device key pair for signed commands)

---

## 9. Capability Discovery

At every SessionStart + on Claude version change:

```typescript
const PROBES: Record<string, () => boolean> = {
  plugin_hooks: () => true,  // we're running as a plugin
  plugin_mcp: () => true,
  task_tools: () => checkTaskTools(),
  subagents: () => checkSubagents(),
  agent_teams: () => checkAgentTeams(),
  dynamic_workflows: () => checkWorkflows(),
  background_sessions: () => checkBgSessions(),
  agent_view_supervisor: () => checkAgentView(),
  cross_session_messaging: () => checkMessaging(),
  worktrees: () => checkWorktrees(),
  channels: () => checkChannels(),
  mcp_v2: () => checkMcpV2(),
  mcp_tool_search: () => checkToolSearch(),
};
```

Results cached in SQLite `capabilities` table. Capability profile sent in edge handshake.

Never rely solely on Claude version string — feature-probe each capability.

---

## 10. Control Plane Extensions

### 10.1 New API Routes

```
# Edge endpoints
WS   /edge/v1/connect              — WebSocket for edge connections
POST /edge/v1/events               — Event batch upload (HTTP fallback)
GET  /edge/v1/context/:caseId      — Context Capsule
GET  /edge/v1/policies             — Policy mirror
POST /edge/v1/pair                 — Initiate pairing
POST /edge/v1/pair/confirm         — Confirm pairing

# Web UI additions
GET  /pair                         — Pairing page (enter code)
```

### 10.2 New DB Tables

```sql
-- Device registry
CREATE TABLE devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT,
  claude_version TEXT,
  plugin_version TEXT,
  capabilities JSONB DEFAULT '[]',
  last_seen_at TIMESTAMPTZ,
  auth_token_hash TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pairing codes
CREATE TABLE pairing_codes (
  code TEXT PRIMARY KEY,
  device_id UUID NOT NULL,
  device_info JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Edge connections
CREATE TABLE edge_connections (
  device_id UUID PRIMARY KEY REFERENCES devices(id),
  connected_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  active_sessions JSONB DEFAULT '[]',
  last_event_ack BIGINT DEFAULT 0
);
```

### 10.3 WebSocket Handler

New file `apps/realtime/src/edge.ts` — handles edge WSS connections separately from browser WebSocket. Authenticates via device auth token, manages session bindings, dispatches steering commands, receives outbox events.

---

## 11. Skills

### 11.1 connect.md

```yaml
---
name: connect
description: Pair this device with your Process OS account
---
```

Guides the user through pairing. Generates code, shows URL, waits for confirmation.

### 11.2 process.md

```yaml
---
name: process
description: Show current process state — Case, Moves, progress, what needs attention
---
```

Calls Process MCP tools to show current state. Uses Context Capsule.

### 11.3 why.md / steer.md / context.md

Process-specific skills for WHY queries, steering commands, and context management.

---

## 12. Agents

### 12.1 process-architect.md

Advisor agent. Analyzes process state and proposes optimizations: parallelize, add verification, change executor, modify pack.

### 12.2 process-guardian.md

Protection agent. Monitors for: scope drift, policy breach, stale evidence, deadline risk, unauthorized work, duplicate effort, agent loops.

### 12.3 evidence-verifier.md

Verification agent. Validates evidence: runs tests, checks assertions, verifies claims against sources.

---

## 13. Implementation Technology

### 13.1 Plugin Runtime

Node.js (ships with Claude Code). No native compilation needed for initial release.

**Dependencies (minimal):**
- `better-sqlite3` — local storage (single dependency for SQLite)
- `ws` — WebSocket client for edge connection

### 13.2 Build

Plugin source in TypeScript, compiled to JS for distribution. The plugin's `package.json` + `package-lock.json` declare dependencies; Claude's plugin system installs them.

### 13.3 Testing

- Hook handlers: unit tests with mock stdin/stdout
- MCP tools: unit tests with mock SQLite
- Edge connection: integration tests with mock WebSocket server
- End-to-end: manual test script that simulates full flow

---

## 14. Migration

New migration `003_edge_devices.sql`:
- `devices` table
- `pairing_codes` table
- `edge_connections` table
- Indexes

---

## 15. What This Spec Does NOT Cover

- Managed background execution (SP3)
- Execution compiler / strategy selection (SP3)
- Deep domain pack behavior (SP4)
- Process intelligence / AI architect (SP5)
- External integrations (SP6)
- Enterprise features (SP7)
- Mobile/PWA (SP6)

These are separate sub-projects with their own specs.
