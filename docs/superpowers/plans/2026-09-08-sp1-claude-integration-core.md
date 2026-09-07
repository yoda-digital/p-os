# SP1: Claude Integration Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Universal Process OS to Claude Code via a plugin with hooks, MCP tools, edge connection, and context capsule injection — so that opening a project with the plugin installed makes the Process OS board come alive with Claude's actual work.

**Architecture:** Claude Code plugin runs locally with SQLite for device identity/outbox/policy cache. Hook handlers intercept Claude lifecycle events (SessionStart, Task*, PreToolUse, etc.) and map them to Process OS events. A Process MCP server exposes 12 tools for Claude to interact with the process model. A WSS edge connection uploads events to the control plane and receives steering commands. The control plane gets new edge API routes for device pairing, event ingestion, and context capsule serving.

**Tech Stack:** TypeScript, better-sqlite3 (plugin local storage), ws (edge WSS), Hono (edge API routes), MCP TypeScript SDK (`@modelcontextprotocol/sdk`), existing embedded-postgres backend

**Spec:** `docs/superpowers/specs/2026-09-08-sp1-claude-integration-core.md`

## Global Constraints

- Node.js ≥ 22, TypeScript strict mode, ESM throughout
- All IDs are UUIDv7
- Hook latency: p95 no-op < 15ms, p95 cached policy < 50ms, p95 SessionStart < 200ms cached
- Plugin persistent data under `${CLAUDE_PLUGIN_DATA}`
- Local outbox: write locally first → ack hook → upload async (never block Claude)
- MCP tools return quickly — long operations use the local outbox
- System org ID: `00000000-0000-0000-0000-000000000000`
- All state mutations go through Commands → Events → Projections

---

### Task 1: DB Migration 003 — Edge & Device Tables

**Files:**
- Create: `packages/db/src/migrations/003_edge_devices.sql`

**Interfaces:**
- Consumes: existing schema (organizations, users)
- Produces: `devices`, `pairing_codes`, `edge_connections` tables for Tasks 5, 7

- [ ] **Step 1: Write migration**

Create `packages/db/src/migrations/003_edge_devices.sql`:

```sql
-- 003_edge_devices.sql — Device registry, pairing, edge connections

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_org ON devices(organization_id);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  device_id UUID NOT NULL,
  device_info JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edge_connections (
  device_id UUID PRIMARY KEY REFERENCES devices(id),
  connected_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  active_sessions JSONB DEFAULT '[]',
  last_event_ack BIGINT DEFAULT 0
);
```

- [ ] **Step 2: Verify migration applies**

```bash
# Dev server should apply it on restart automatically
# Or run manually:
npx tsx packages/db/src/start.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/migrations/003_edge_devices.sql
git commit -m "feat: migration 003 — device registry, pairing codes, edge connections"
```

---

### Task 2: Plugin Local Storage (SQLite)

**Files:**
- Create: `plugin/claude-code/src/storage/db.ts`
- Create: `plugin/claude-code/src/storage/device.ts`
- Create: `plugin/claude-code/src/storage/sessions.ts`
- Create: `plugin/claude-code/src/storage/outbox.ts`
- Create: `plugin/claude-code/src/storage/policy-mirror.ts`
- Create: `plugin/claude-code/src/storage/capabilities.ts`
- Create: `plugin/claude-code/src/storage/steering-queue.ts`
- Modify: `plugin/claude-code/package.json` (add better-sqlite3)

**Interfaces:**
- Consumes: `${CLAUDE_PLUGIN_DATA}` environment variable
- Produces: `getLocalDb()`, `DeviceStore`, `SessionStore`, `OutboxStore`, `PolicyMirrorStore`, `CapabilityStore`, `SteeringQueueStore` — used by hooks, MCP server, and edge

- [ ] **Step 1: Add better-sqlite3 dependency**

```bash
cd plugin/claude-code && pnpm add better-sqlite3 && pnpm add -D @types/better-sqlite3
```

- [ ] **Step 2: Create SQLite database wrapper**

Create `plugin/claude-code/src/storage/db.ts`:

```typescript
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

let db: Database.Database | null = null;

function getDataDir(): string {
  const pluginData = process.env['CLAUDE_PLUGIN_DATA'];
  if (pluginData) return pluginData;
  // Fallback for development
  const fallback = join(process.cwd(), '.data', 'plugin');
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

export function getLocalDb(): Database.Database {
  if (db) return db;

  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'process-os.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS device (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      organization_id TEXT,
      paired_at TEXT,
      control_plane_url TEXT,
      auth_token TEXT
    );

    CREATE TABLE IF NOT EXISTS session_bindings (
      session_id TEXT PRIMARY KEY,
      case_id TEXT,
      move_id TEXT,
      attempt_id TEXT,
      workspace_path TEXT,
      bound_at TEXT,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS process_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT
    );

    CREATE TABLE IF NOT EXISTS capabilities (
      feature TEXT PRIMARY KEY,
      supported INTEGER NOT NULL,
      detected_at TEXT NOT NULL,
      claude_version TEXT
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      uploaded_at TEXT,
      retry_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS policy_mirror (
      id TEXT PRIMARY KEY,
      policy_data TEXT NOT NULL,
      version INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      signature TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_steering (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      move_id TEXT,
      steering_class TEXT NOT NULL,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL,
      delivered_at TEXT,
      acknowledged_at TEXT
    );

    CREATE TABLE IF NOT EXISTS stop_blocks (
      session_id TEXT PRIMARY KEY,
      consecutive_count INTEGER DEFAULT 0,
      last_blocked_at TEXT
    );
  `);
}

export function closeLocalDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

- [ ] **Step 3: Create store modules**

Create each store module (`device.ts`, `sessions.ts`, `outbox.ts`, `policy-mirror.ts`, `capabilities.ts`, `steering-queue.ts`) as thin wrappers over the SQLite tables. Each store module exports a class with CRUD methods that operate on `getLocalDb()`.

Example `plugin/claude-code/src/storage/device.ts`:

```typescript
import { getLocalDb } from './db.js';

export interface DeviceIdentity {
  id: string;
  user_id: string | null;
  organization_id: string | null;
  paired_at: string | null;
  control_plane_url: string | null;
  auth_token: string | null;
}

export class DeviceStore {
  get(): DeviceIdentity | null {
    const db = getLocalDb();
    const row = db.prepare('SELECT * FROM device LIMIT 1').get() as DeviceIdentity | undefined;
    return row ?? null;
  }

  isPaired(): boolean {
    return this.get()?.user_id != null;
  }

  save(device: DeviceIdentity): void {
    const db = getLocalDb();
    db.prepare(`
      INSERT OR REPLACE INTO device (id, user_id, organization_id, paired_at, control_plane_url, auth_token)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(device.id, device.user_id, device.organization_id, device.paired_at, device.control_plane_url, device.auth_token);
  }

  clear(): void {
    getLocalDb().prepare('DELETE FROM device').run();
  }
}
```

Follow the same pattern for `SessionStore` (CRUD on session_bindings), `OutboxStore` (enqueue, dequeue, markUploaded, getPending, getRetryable), `PolicyMirrorStore` (get, upsert, getActive, prune), `CapabilityStore` (get, set, getAll), `SteeringQueueStore` (enqueue, getPending, markDelivered, markAcknowledged).

- [ ] **Step 4: Commit**

```bash
git add plugin/claude-code/
git commit -m "feat: plugin local SQLite storage layer (device, sessions, outbox, policies, capabilities, steering)"
```

---

### Task 3: Hook Handlers

**Files:**
- Create: `plugin/claude-code/src/hooks/handler.ts` (main dispatcher)
- Create: `plugin/claude-code/src/hooks/session-start.ts`
- Create: `plugin/claude-code/src/hooks/task-created.ts`
- Create: `plugin/claude-code/src/hooks/task-completed.ts`
- Create: `plugin/claude-code/src/hooks/pre-tool-use.ts`
- Create: `plugin/claude-code/src/hooks/post-tool-use.ts`
- Create: `plugin/claude-code/src/hooks/stop.ts`
- Create: `plugin/claude-code/src/hooks/session-end.ts`
- Rewrite: `plugin/claude-code/hooks/*.js` (thin shims that call the TS handlers)
- Update: `plugin/claude-code/plugin.json` (add SessionEnd hook)

**Interfaces:**
- Consumes: `DeviceStore`, `SessionStore`, `OutboxStore`, `PolicyMirrorStore`, `SteeringQueueStore` from Task 2
- Produces: Hook handlers that read stdin JSON, process, and write stdout JSON per Claude hook contract

Each hook handler:
1. Reads JSON from stdin
2. Checks if device is paired + session is Case-bound (fast exit if not: < 15ms)
3. Performs its logic using local SQLite stores
4. Writes JSON response to stdout

The handler.ts is the entry point called by the JS shims: `node src/hooks/handler.js <event-name>`. It parses the event name from argv, reads stdin, routes to the correct handler, and writes the response.

Each JS shim in `hooks/` becomes a one-liner: `#!/usr/bin/env node\nimport('../src/hooks/handler.js').then(m => m.handle(process.argv[2] ?? 'unknown'));` — but since Claude hooks expect a `command` that runs directly, the shims must be pre-compiled JS or use tsx. For development, use `node --import tsx/esm src/hooks/handler.ts session-start`.

**Key handler logic (from spec §4):**

- **session-start**: load device → check pairing → detect repo → find Case binding → generate Context Capsule → return `{ additionalContext, sessionTitle }`
- **task-created**: if session bound → fuzzy-match Claude task to Move → create Attempt binding → emit to outbox
- **task-completed**: if bound → check completion policy from policy mirror → `{ blockCompletion }` or `{}`
- **pre-tool-use**: check pending steering → check policy mirror → `{ blocked, additionalContext }` or `{}`
- **post-tool-use**: detect evidence artifacts (test runs, git commits, file changes) → enqueue to outbox
- **stop**: check unsatisfied completion requirements → max 8 consecutive blocks
- **session-end**: flush outbox, update session binding status

- [ ] **Step 1-3: Implement handler.ts and all 7 hook handlers**

The agentic worker should read the spec §4.2-4.8 for exact logic, then implement each handler following the performance budget.

- [ ] **Step 4: Rewrite JS shim files**

Each `plugin/claude-code/hooks/<event>.js` becomes:

```javascript
#!/usr/bin/env node
import { handle } from '../src/hooks/handler.js';
handle(process.argv[2] ?? '<event-name>');
```

- [ ] **Step 5: Update plugin.json with SessionEnd hook**

- [ ] **Step 6: Commit**

```bash
git add plugin/claude-code/
git commit -m "feat: hook handlers (SessionStart, Task*, PreToolUse, PostToolUse, Stop, SessionEnd)"
```

---

### Task 4: Process MCP Server

**Files:**
- Create: `plugin/claude-code/src/mcp/server.ts` (MCP server entry)
- Create: `plugin/claude-code/src/mcp/tools/case-get.ts`
- Create: `plugin/claude-code/src/mcp/tools/case-search.ts`
- Create: `plugin/claude-code/src/mcp/tools/move-get.ts`
- Create: `plugin/claude-code/src/mcp/tools/move-list.ts`
- Create: `plugin/claude-code/src/mcp/tools/move-propose.ts`
- Create: `plugin/claude-code/src/mcp/tools/move-bind-task.ts`
- Create: `plugin/claude-code/src/mcp/tools/evidence-register.ts`
- Create: `plugin/claude-code/src/mcp/tools/assertion-propose.ts`
- Create: `plugin/claude-code/src/mcp/tools/decision-request.ts`
- Create: `plugin/claude-code/src/mcp/tools/context-get.ts`
- Create: `plugin/claude-code/src/mcp/tools/why-explain.ts`
- Create: `plugin/claude-code/src/mcp/tools/steering-ack.ts`
- Create: `plugin/claude-code/.mcp.json`
- Modify: `plugin/claude-code/package.json` (add @modelcontextprotocol/sdk)

**Interfaces:**
- Consumes: local SQLite stores (SessionStore, OutboxStore, DeviceStore), control plane HTTP API
- Produces: 12 MCP tools exposed via stdio transport

- [ ] **Step 1: Install MCP SDK**

```bash
cd plugin/claude-code && pnpm add @modelcontextprotocol/sdk
```

- [ ] **Step 2: Create MCP server entry point**

`plugin/claude-code/src/mcp/server.ts` — uses `@modelcontextprotocol/sdk` to create a stdio server, registers all 12 tools. Each tool reads from local cache first, falls back to HTTP to the control plane. Write operations go to the local outbox.

- [ ] **Step 3: Create all 12 tool handlers**

Each tool in `tools/` is a function: `(params, context) => result`. The context includes the local stores and the device identity.

Tool descriptions must be concise and highly discriminative (spec §38) so Claude's tool search can defer them efficiently.

- [ ] **Step 4: Create .mcp.json**

```json
{
  "process-os": {
    "command": "node",
    "args": ["--import", "tsx/esm", "src/mcp/server.ts"],
    "env": {
      "PLUGIN_DATA": "${CLAUDE_PLUGIN_DATA}",
      "CONTROL_PLANE_URL": "${userConfig.control_plane_url}"
    }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add plugin/claude-code/
git commit -m "feat: Process MCP server with 12 tools (case, move, evidence, context, why, steering)"
```

---

### Task 5: Control Plane Edge Routes + WebSocket Handler

**Files:**
- Create: `apps/api/src/routes/edge.ts` (HTTP routes: pair, events, context, policies)
- Create: `apps/realtime/src/edge.ts` (WebSocket handler for edge connections)
- Create: `apps/api/src/routes/pairing.ts` (pairing initiation + confirmation)
- Modify: `apps/api/src/index.ts` (register edge routes)
- Modify: `apps/realtime/src/index.ts` (add edge WebSocket handler)

**Interfaces:**
- Consumes: `devices`, `pairing_codes`, `edge_connections` tables from Task 1, existing event store, Context Capsule from packages/context
- Produces: HTTP endpoints for edge communication, WebSocket handler for persistent edge connections

**Endpoints:**
```
POST /edge/v1/pair            — Create pairing code
POST /edge/v1/pair/confirm    — Confirm pairing (from web UI)
POST /edge/v1/events          — Receive event batch from edge
GET  /edge/v1/context/:caseId — Get Context Capsule
GET  /edge/v1/policies        — Get policy mirror
```

**WebSocket:**
`/edge/v1/connect` — authenticated via device auth token in query params. Handles heartbeat, event ack, steering dispatch, session tracking.

- [ ] **Step 1-4: Implement edge routes and WebSocket handler**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/edge.ts apps/api/src/routes/pairing.ts apps/realtime/src/edge.ts apps/api/src/index.ts apps/realtime/src/index.ts
git commit -m "feat: control plane edge API + WebSocket handler for device connections"
```

---

### Task 6: Context Capsule Generator

**Files:**
- Rewrite: `packages/context/src/index.ts` (use existing ContextCapsule interface, implement generation)
- Create: `packages/context/src/capsule-generator.ts`
- Create: `packages/context/src/health.ts`

**Interfaces:**
- Consumes: DB tables (cases, moves, intents, decisions, rules, evidence, events, assertions, relations), existing ContextCapsule interface
- Produces: `generateCapsule(sql, caseId, moveId?, lastEventAck?): Promise<ContextCapsule>`, `assessHealth(sql, sessionId, caseId): Promise<ContextHealth>`

The capsule generator builds the 11-section markdown Context Capsule from canonical DB state:
- IDENTITY, INTENT, REALITY, DECISIONS, CONSTRAINTS, PROGRESS, DEPENDENCIES, EVIDENCE, DELTA, NEXT, DO NOT REPEAT

- [ ] **Step 1-3: Implement capsule generator and health assessment**

- [ ] **Step 4: Commit**

```bash
git add packages/context/
git commit -m "feat: Context Capsule generator (11 sections) + context health assessment"
```

---

### Task 7: Device Pairing UI + Flow

**Files:**
- Create: `apps/web/src/components/pairing/pairing-page.tsx`
- Modify: `apps/web/src/app.tsx` (add /pair route)
- Modify: `apps/web/src/lib/api.ts` (add pairing API methods)
- Create: `plugin/claude-code/src/pairing/flow.ts` (plugin-side pairing logic)

**Interfaces:**
- Consumes: edge pairing API (Task 5), DeviceStore (Task 2)
- Produces: `/pair` web page + plugin pairing skill

The pairing flow:
1. Plugin generates device ID + calls `POST /edge/v1/pair` to register
2. Returns a 6-digit code
3. User opens `<url>/pair` in browser, enters code while authenticated
4. Browser calls `POST /edge/v1/pair/confirm` with code + user's auth token
5. Plugin polls or receives confirmation, stores device identity locally

- [ ] **Step 1-3: Implement pairing page, API methods, and plugin flow**

- [ ] **Step 4: Commit**

```bash
git add apps/web/ plugin/claude-code/
git commit -m "feat: device pairing flow (web UI + plugin + API)"
```

---

### Task 8: Capability Discovery

**Files:**
- Create: `plugin/claude-code/src/capabilities/probes.ts`
- Create: `plugin/claude-code/src/capabilities/discovery.ts`

**Interfaces:**
- Consumes: `CapabilityStore` from Task 2
- Produces: `discoverCapabilities(): Promise<CapabilityProfile>` — called at SessionStart and on version change

Feature probes (not version-string based):
```
plugin_hooks, plugin_mcp, task_tools, subagents, agent_teams,
dynamic_workflows, background_sessions, agent_view_supervisor,
cross_session_messaging, worktrees, channels, mcp_v2, mcp_tool_search
```

Each probe attempts to detect the feature at runtime and caches the result.

- [ ] **Step 1-2: Implement capability probes and discovery**

- [ ] **Step 3: Commit**

```bash
git add plugin/claude-code/src/capabilities/
git commit -m "feat: capability discovery with runtime feature probes"
```

---

### Task 9: Plugin Skills & Agents

**Files:**
- Create: `plugin/claude-code/skills/connect.md`
- Create: `plugin/claude-code/skills/process.md`
- Create: `plugin/claude-code/skills/why.md`
- Create: `plugin/claude-code/skills/steer.md`
- Create: `plugin/claude-code/skills/context.md`
- Create: `plugin/claude-code/agents/process-architect.md`
- Create: `plugin/claude-code/agents/process-guardian.md`
- Create: `plugin/claude-code/agents/evidence-verifier.md`
- Modify: `plugin/claude-code/plugin.json` (register skills + agents)

**Interfaces:**
- Consumes: Process MCP tools (Task 4)
- Produces: 5 skills + 3 agents registered in plugin manifest

Skills are markdown files with frontmatter. They instruct Claude on how to use the Process MCP tools.

Agents are markdown files defining autonomous agent personas that can be dispatched as subagents.

- [ ] **Step 1: Create all 5 skills and 3 agents**

- [ ] **Step 2: Update plugin.json manifest**

```json
{
  "skills": ["skills/*.md"],
  "agents": ["agents/*.md"],
  "hooks": "hooks/hooks.json",
  "mcpServers": ".mcp.json"
}
```

Note: hooks move from inline in plugin.json to a separate `hooks/hooks.json` file (spec §2.4).

- [ ] **Step 3: Commit**

```bash
git add plugin/claude-code/
git commit -m "feat: plugin skills (connect, process, why, steer, context) + agents (architect, guardian, verifier)"
```

---

### Task 10: Integration — Plugin Manifest + Dev Script + E2E Test

**Files:**
- Rewrite: `plugin/claude-code/plugin.json` (final manifest with all components)
- Create: `plugin/claude-code/hooks/hooks.json` (hook declarations)
- Modify: `dev.ts` (add plugin validation step)
- Create: `plugin/claude-code/src/index.ts` (plugin barrel export)

**Interfaces:**
- Consumes: everything from Tasks 1-9
- Produces: complete, validated plugin + working dev environment

- [ ] **Step 1: Finalize plugin.json with all components**

- [ ] **Step 2: Create hooks/hooks.json**

Move hook declarations from plugin.json inline format to the separate hooks.json format (spec §2.4).

- [ ] **Step 3: Verify build**

```bash
pnpm build
# All 31+ packages should build clean
```

- [ ] **Step 4: Start full system and test**

```bash
npx tsx dev.ts
```

Verify:
1. Migration 003 applies
2. API starts with edge routes
3. Realtime server starts with edge WebSocket
4. Plugin MCP server starts (if running as installed plugin)
5. Hook handlers respond to stdin JSON
6. Pairing page accessible at /pair

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: SP1 complete — Claude Integration Core (plugin, MCP, hooks, edge, pairing)"
```
