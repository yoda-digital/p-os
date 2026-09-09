<p align="center">
  <img src="https://img.shields.io/badge/status-active_development-brightgreen" alt="Status" />
  <img src="https://img.shields.io/badge/license-proprietary-blue" alt="License" />
  <img src="https://img.shields.io/badge/node-%3E%3D22-green" alt="Node" />
  <img src="https://img.shields.io/badge/typescript-strict-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/languages-ro%20%7C%20ru%20%7C%20en-orange" alt="Languages" />
</p>

<h1 align="center">⬡ Universal Process OS</h1>

<p align="center">
  Event-sourced process kernel with Claude Code execution, bidirectional steering, and 7 domain packs.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> •
  <a href="#claude-code-integration">Claude Code</a> •
  <a href="#what-this-is">What this is</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#features">Features</a> •
  <a href="#configuring-integrations">Integrations</a> •
  <a href="#for-developers">For developers</a>
</p>

---

## What this is

Universal Process OS manages structured processes (software delivery, procurement tenders, investigations, research, negotiations, incident response, physical logistics) through a single event-sourced kernel that Claude Code or other executors operate within.

Three properties separate it from task boards and project management tools:

**Process, not tasks.** Every action is a semantic Move within a Case. A Move carries intent, constraints, evidence, and dependencies. It knows why it exists, what must be true for it to be done, and what breaks if its evidence goes stale. This is not a ticket with a status field.

**Claude works inside the process.** A Claude Code plugin with hooks, an MCP server, and a WSS edge connection means Claude reports evidence, proposes moves, acknowledges steering, and respects completion contracts. The process survives session crashes, context compaction, and model changes.

**Humans steer, not babysit.** A Kanban board with 7 semantic columns where drag-and-drop emits Commands (not database writes). Steering delivery reaches active Claude sessions in real time. An attention engine tells you what actually needs you, ranked by risk, deadline, authority, and downstream impact.

---

## Quick start

```bash
# Prerequisites: Node.js >= 22, pnpm >= 10
git clone git@github.com:yoda-digital/p-os.git
cd p-os
pnpm install
npx tsx dev.ts
```

This starts four services:

| Service | Port | What |
|---------|------|------|
| PostgreSQL | 5432 | Embedded, zero install. Data persists in `.data/postgres/` |
| API server | 4000 | Hono HTTP with 35 route modules and 48+ command handlers |
| WebSocket | 4001 | Projection deltas + edge device connections |
| Web UI | 3000 | React 19 + Vite 6, 61 components across 13+ views |

Open `http://localhost:3000`, register, create a Case.

### First superadmin

```bash
# Option 1: env var (grants superadmin when that email registers)
SUPERADMIN_EMAIL=you@company.com npx tsx dev.ts

# Option 2: CLI
npx tsx apps/api/src/cli/create-superadmin.ts you@company.com yourpassword
```

---

## Claude Code Integration

Process OS ships a Claude Code plugin that gives Claude direct access to Cases, Moves, Evidence, steering, and the WHY engine. Here's how to set it up.

### Install the plugin

```bash
# From the repository root
claude plugin add ./plugin/claude-code
```

This registers the plugin with Claude Code and makes its skills, agents, hooks, and MCP tools available in all sessions started from this workspace.

> **Not using the repo locally?** Publish the plugin to npm and install globally:
> ```bash
> cd plugin/claude-code && npm publish
> claude plugin add @pos/plugin-claude-code
> ```

### Configure the control plane URL

By default the plugin talks to `http://localhost:4000` (local dev). For a hosted instance:

```bash
claude plugin config universal-process-os control_plane_url https://pos.yoda.digital
```

Other config options:

| Key | Default | Description |
|-----|---------|-------------|
| `control_plane_url` | `http://localhost:4000` | Process OS API endpoint |
| `organization_hint` | — | Organization slug for auto-discovery |
| `deployment_mode` | `local` | `local`, `self-hosted`, or `cloud` |

### Pair your device

Every Claude Code installation needs a one-time pairing to link it to your Process OS account:

```
> /process:connect
```

This triggers the pairing flow:

1. A **6-character code** and a pairing URL are displayed
2. Open the URL in your browser (where you're signed in to Process OS)
3. Enter the code and confirm
4. The plugin stores a device JWT locally — you won't need to pair again for 30 days

After pairing, the `process.*` MCP tools are live:

```
> Use process.case.get to show the current case
> Use process.move.propose to suggest a new move
> Use process.evidence.register to register evidence
```

### What you get after installation

**12 MCP Tools** — available as `process.*` in any Claude session:

| Tool | What it does |
|------|-------------|
| `case.get` | Get the current Case (or a specific one by ID) |
| `case.search` | Search Cases by title, status, or pack |
| `move.list` | List Moves in a Case |
| `move.get` | Get a specific Move with its full state vector |
| `move.propose` | Propose a new Move with intent and constraints |
| `move.bind-task` | Bind the current Claude task to a Move |
| `evidence.register` | Register evidence (test results, code, documents) |
| `assertion.propose` | Propose an assertion with confidence level |
| `decision.request` | Request a human decision with options and recommendation |
| `context.get` | Get the 11-section Context Capsule |
| `steering.ack` | Acknowledge a steering instruction |
| `why.explain` | Ask WHY with 10 causal query types |

**7 Hook Handlers** — fire automatically:

| Hook | When | What it does |
|------|------|-------------|
| `SessionStart` | Session opens | Injects Context Capsule, checks pairing, loads pending steering |
| `TaskCreated` | Task begins | Binds task to Move if context matches |
| `TaskCompleted` | Task finishes | Validates completion contracts, blocks close if evidence missing |
| `PreToolUse` | Before any tool | Policy enforcement (forbidden tools, mandatory evidence) |
| `PostToolUse` | After any tool | Captures tool outputs as evidence candidates |
| `Stop` | Session pausing | Checkpoints context, flushes outbox |
| `SessionEnd` | Session closes | Persists session summary, closes edge connection |

**5 Skills:**

| Skill | Trigger | What it does |
|-------|---------|-------------|
| `/process:connect` | First-time setup | Device pairing flow |
| `/process` | Any process question | Route to the right MCP tool for the task |
| `/why` | "Why did X happen?" | 10 causal query types with deterministic paths |
| `/steer` | "Change direction" | Compose and deliver a steering instruction |
| `/context` | "What's the situation?" | Generate a fresh Context Capsule |

**3 Agents:**

| Agent | When to use |
|-------|------------|
| Process Architect | Analyze stalled work, propose structural optimizations |
| Process Guardian | Monitor invariants, alert on drift or contract violations |
| Evidence Verifier | Verify evidence freshness and causal chain integrity |

### Manual setup (without `claude plugin add`)

If you prefer manual configuration:

**1. Register the MCP server** in `~/.claude/settings.json` or `.claude/settings.json`:

```json
{
  "mcpServers": {
    "process-os": {
      "command": "node",
      "args": ["--import", "tsx/esm", "<path-to-repo>/plugin/claude-code/src/mcp/server.ts"],
      "env": {
        "PLUGIN_DATA": "<path-for-sqlite-storage>",
        "CONTROL_PLANE_URL": "https://pos.yoda.digital"
      }
    }
  }
}
```

**2. Register hooks** in the same settings file:

```json
{
  "hooks": {
    "SessionStart": [{ "command": "node <path-to-repo>/plugin/claude-code/hooks/session-start.js", "timeout": 5000 }],
    "PreToolUse": [{ "command": "node <path-to-repo>/plugin/claude-code/hooks/pre-tool-use.js", "timeout": 1000 }],
    "PostToolUse": [{ "command": "node <path-to-repo>/plugin/claude-code/hooks/post-tool-use.js", "timeout": 1000 }],
    "Stop": [{ "command": "node <path-to-repo>/plugin/claude-code/hooks/stop.js", "timeout": 2000 }],
    "TaskCreated": [{ "command": "node <path-to-repo>/plugin/claude-code/hooks/task-created.js", "timeout": 2000 }],
    "TaskCompleted": [{ "command": "node <path-to-repo>/plugin/claude-code/hooks/task-completed.js", "timeout": 3000 }],
    "SessionEnd": [{ "command": "node <path-to-repo>/plugin/claude-code/hooks/session-end.js", "timeout": 2000 }]
  }
}
```

**3. Copy skills and agents** to your Claude Code directory:

```bash
cp -r plugin/claude-code/skills/* .claude/skills/
cp -r plugin/claude-code/agents/* .claude/agents/
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser / Mobile PWA                     │
│  React 19 · Tailwind 4 · 13 views · i18n (ro/ru/en)            │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP + WebSocket
┌──────────────────────────────┴──────────────────────────────────┐
│                        Control plane                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ API (Hono)│  │ Realtime │  │  Worker  │  │ Edge gateway   │  │
│  │ Commands  │  │ WS deltas│  │Controllers│  │ Device WSS     │  │
│  │ Queries   │  │ Edge WSS │  │Projections│  │ Steering push  │  │
│  └─────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬────────┘  │
│        └──────────────┴─────────────┴────────────────┘           │
│                        PostgreSQL (event-sourced)                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │ WSS (outbound-only)
┌──────────────────────────────┴──────────────────────────────────┐
│                        Process edge (local)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Hooks   │  │ MCP server│  │ Outbox   │  │  Dispatcher    │  │
│  │ 7 events │  │ 12 tools  │  │ SQLite   │  │ claude --bg    │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────────┘  │
│                        Claude Code plugin                        │
└─────────────────────────────────────────────────────────────────┘
```

### Event sourcing

Every mutation flows: Command → Validate → Event(s) → Outbox → Projection. No direct database writes from UI endpoints. The event ledger is the canonical history. Projections are derived and can be rebuilt from scratch.

### Hierarchy

```
Process > Case > Move > Attempt > Session > Context Window
```

A Claude session can disappear. An Attempt can fail. A Move can be replaced. The Process stays coherent.

---

## Features

### Case runtime
- 14 kernel primitives: Case, Entity, Relation, Assertion, Intent, Rule, Actor, Resource, Move (7-dimensional state vector), Attempt, Evidence, Decision, Steering Command, Context Capsule
- 48+ command handlers with idempotency, revision-based optimistic concurrency, and full event attribution
- 8 database migrations covering auth, RBAC, edge, governance, execution, intelligence, integrations

### Views

| View | What it shows |
|------|---------------|
| Kanban | 7 semantic columns. Drag emits Commands, cards show execution state |
| Attention | Computed priority queue (risk × deadline × authority × critical path) |
| Timeline | Event history with type badges and filters |
| Dependencies | Move dependency graph with state |
| Evidence | Validity badges (valid/stale/invalid/disputed), freshness countdown |
| Decisions | Options, evidence, AI recommendation, resolution with rationale |
| Compliance | Rules and constraints with evaluation status |
| Actors | Human and AI actors with roles |
| Resources | Resource tracking and allocation |
| Risk | Severity distribution across moves |
| WHY | 10 causal query types + historical WHY at any point in time |
| Time travel | Replay to any event, before/after diff |
| Simulation | Forked state, what-if scenarios, explicit adoption |
| Intelligence | 11 metrics, drift detection, AI Architect proposals, Guardian alerts |

### Claude integration (plugin)

12 MCP tools (case.get, move.propose, evidence.register, context.get, why.explain, steering.ack, and others). 7 hook handlers covering the full session lifecycle: SessionStart, TaskCreated, TaskCompleted, PreToolUse, PostToolUse, Stop, SessionEnd.

The plugin injects an 11-section Context Capsule at every session start covering identity, intent, constraints, progress, failed approaches, and next actions. Context survives `/clear`, compaction, resume, and fork. Constraints are never lost.

5 skills (`/process:connect`, `process`, `why`, `steer`, `context`) and 3 agents (Process Architect, Process Guardian, Evidence Verifier).

### Steering

7 types: advisory, constraint, redirect, pause, hard_stop, fork, reassign. Delivery path: browser → API → Edge WSS → plugin pending queue → hook safe point → Claude. Instructions are append-only and never rewritten. The UI shows honest delivery state: issued → edge → executor → acknowledged → applied.

### Evidence and completion

5 validity states (valid, stale, invalid, disputed, unknown). Staleness triggers on git commits, file changes, rule supersession, expiry, and retraction. Staleness propagates causally: stale evidence recalculates assertion confidence, and moves re-enter the Verify column automatically.

Completion contracts support ALL, ANY, threshold, approval, evidence predicate, and external state composition. The TaskCompleted hook blocks Claude from closing a task when required evidence is missing.

### Managed execution

The execution compiler selects a strategy (single session, subagent, agent team, dynamic workflow, background session, human executor, or wait) based on move semantics, available capabilities, and organization policy. Model and effort routing: low complexity gets a fast model, high risk gets the most capable one.

The dispatcher launches `claude --bg`, queries `claude agents --json`, and handles crash recovery. You can click Execute on a Move from the browser without opening a terminal.

The dispatcher runs as a persistent system daemon. Install it with one command:

```bash
npx tsx edge/dispatcher/src/cli/index.ts install
```

This auto-detects the platform and installs the right service:

| Platform | Mechanism |
|----------|-----------|
| Linux (systemd) | systemd user service (`~/.config/systemd/user/`) |
| macOS | launchd agent (`~/Library/LaunchAgents/`) |
| Windows | Task Scheduler (runs at login) |
| WSL2 | Windows Task Scheduler keeps WSL alive + systemd inside WSL |
| Termux (Android) | termux-services (runit), falls back to nohup + PID |
| proot-distro | Self-supervised nohup wrapper with shell profile auto-start |
| Any other Linux | Universal fallback — nohup + PID + crash respawn |

The universal fallback means the dispatcher works on **any system with `/bin/sh` and Node.js** — Alpine, Void, Artix, containers, Chromebooks, and anything else. No init system required.

Other commands: `uninstall`, `status`, `start`, `stop`, `logs`, `health`. Health endpoint on `:4002`.

### Authorization

ABAC policy engine evaluating subject × action × resource × environment conditions with priority-based ordering. Hierarchical roles: system → organization → workspace → team → case. Superadmin via a system organization with an 8-page admin panel. Token-based invitations, audit logging on every mutation with IP and impersonation tracking.

### Internationalization

Romanian 🇲🇩 (default), Russian 🇷🇺, English 🇬🇧. 69 translation files across 19+ namespaces. Interface language is per-user, case content language is per-case. Language switches instantly without a page reload.

### Domain packs

Each pack adds types, controllers, evidence types, and views specific to a domain:

| Pack | What makes it different from relabeled Kanban |
|------|----------------------------------------------|
| Software delivery | Tests-must-pass controller, PR/commit as evidence |
| Procurement | Clarification invalidates previously satisfied requirement |
| Journalism | Claims need independent sources, contradiction detection |
| Research | Negative findings are valid outcomes, stopping rules |
| Negotiation | No deal is a valid successful outcome |
| Incident response | Automatic escalation, real-time risk reassessment |
| Logistics | Quantity-balance invariant, custody chain enforcement |

### External integrations

GitHub (PR/issue/commit sync), Slack (notifications, approval commands), email (inbound/outbound), calendar (deadline sync), and generic webhooks. External events pass through an interpretation pipeline: raw event → semantic proposal → confidence/policy gate → accepted or routed to human review.

### Mobile PWA

Service worker with offline caching, mobile-optimized Attention and Decision views, semantic push notifications ("Release blocked. Security approval is now critical." not "Task #417 changed status."), responsive design.

---

## Configuring integrations

All integrations are managed per-organization from the web UI at **Settings → Integrations** (`/settings/integrations`). External events flow through a single interpretation pipeline: raw event → semantic proposal → confidence/policy gate → accepted automatically or routed to human review.

### GitHub

Connect GitHub to sync PRs, commits, code reviews, and issues as process evidence and attention items.

**Setup:**

1. [Create a GitHub OAuth App](https://github.com/settings/developers) with the callback URL `<your-app-url>/api/v1/integrations/:id/github/callback`
2. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in your environment
3. In the web UI, go to Settings → Integrations → Add Integration → GitHub
4. Click **Connect GitHub** — you'll be redirected to authorize with scope `repo,read:org`
5. Copy the generated webhook URL and add it to your GitHub repository (Settings → Webhooks)

**Webhook events to enable:** `pull_request`, `push`, `pull_request_review`, `issues`

**Event mapping:**

| GitHub event | Process interpretation | Confidence | Auto-accept |
|---|---|---|---|
| PR opened / merged / closed | `PRStateChanged` → Move evidence | 0.9 | ✅ Yes (low risk) |
| Push (commits) | `CommitCreated` → Evidence | 0.95 | ✅ Yes (low risk) |
| Code review submitted | `ReviewSubmitted` → Decision input | 0.85 | ❌ Always human review (decision) |
| Issue opened / closed | `IssueStateChanged` → Attention | 0.85 | ✅ Yes (low risk) |

**Priority escalation:** Issues with labels `urgent`, `critical`, `p0`, or `p1` get critical priority. Issues with a `bug` label get high priority.

### Slack

Connect Slack for notifications, interactive approval requests, and slash commands.

**Setup:**

1. [Create a Slack App](https://api.slack.com/apps) with these features:
   - **Bot Token Scopes:** `chat:write`, `commands`
   - **Slash Commands:** `/pos` pointed at `<your-app-url>/api/v1/webhooks/:hookId`
   - **Event Subscriptions:** (optional) enable `message.channels` for message monitoring
2. Install the app to your workspace and copy the **Bot User OAuth Token** (`xoxb-...`)
3. In the web UI, go to Settings → Integrations → Add Integration → Slack
4. Store the bot token in the integration credentials
5. Copy the generated webhook URL for Slack's Event Subscriptions and Slash Commands request URL

**Slash commands:**

```
/pos approve <move-id>   Submit approval for a move
/pos status              Check current process status
/pos attention           View your attention queue
/pos help                Show available commands
```

**Outbound notifications:**

| Notification type | Format |
|---|---|
| Status updates | Emoji-tagged messages (ℹ️ info, ⚠️ warning, ❌ error, ✅ success) |
| Approval requests | Block Kit buttons: Approve, Reject, View in Process OS |
| Process events | Semantic messages ("Release blocked" not "Task #417 changed") |

### Email

Connect email for inbound event parsing and outbound notifications.

**Setup:**

1. Configure an inbound email webhook via your provider (SendGrid Inbound Parse, Mailgun Routes, etc.)
2. Point the provider's webhook at `<your-app-url>/api/v1/webhooks/:hookId`
3. In the web UI, go to Settings → Integrations → Add Integration → Email
4. Store your SMTP/API credentials in the integration config

**Behavior:** Inbound emails are always routed to human review (confidence 0.4, high risk) — they are never auto-accepted. Email body is truncated to 2000 characters for storage.

**Outbound capabilities:**

- **Notification emails** — semantic event summaries
- **Approval request emails** — HTML-formatted with a "Review & Decide" button
- **Digest emails** — periodic summary of pending attention items, grouped by priority

> **Note:** Outbound email sending requires an SMTP or email service provider in production. The current implementation logs to console.

### Calendar

Connect a calendar for deadline sync and availability checking.

**Setup:**

1. In the web UI, go to Settings → Integrations → Add Integration → Calendar
2. Configure Google Calendar OAuth or CalDAV credentials
3. Enable calendar push notifications pointed at `<your-app-url>/api/v1/webhooks/:hookId`

**Capabilities:**

| Feature | Description |
|---|---|
| Deadline sync | Creates calendar events for move deadlines with attendees and reminders |
| Availability check | Queries free/busy API to find scheduling windows |
| Slot finder | Finds the next available slot for all specified users within 7 days |
| Change detection | Calendar updates feed through the interpretation pipeline (confidence 0.75, auto-accepted) |

> **Note:** Calendar API integration requires a provider connection in production. The current implementation uses placeholder data.

### Generic webhooks

Accept events from any external system via HTTP webhook.

**Setup:**

1. In the web UI, go to Settings → Integrations → Add Integration → Webhook
2. A webhook endpoint with a random secret is auto-generated
3. Copy the URL and secret, configure them in the sending system

**Authentication** (any one of these):

| Method | How |
|---|---|
| Query parameter | `POST /api/v1/webhooks/:hookId?secret=YOUR_SECRET` |
| Header | `x-webhook-secret: YOUR_SECRET` |
| GitHub HMAC | `x-hub-signature-256` (HMAC-SHA256 of the request body) |

**Behavior:** Generic webhook events get confidence 0.3 and medium risk, so they always go to human review. The payload is stored as-is in `external_events` for inspection.

### External event pipeline

All external events — regardless of source — pass through the same interpretation pipeline before affecting the process state.

```
External system → POST /webhooks/:hookId
  → Record raw event in external_events table
  → Interpret: map source + event_type → process event + confidence + risk
  → Policy gate: check confidence against threshold
  → Auto-accepted → creates process event (actor: system:external-pipeline)
  → Below threshold → routed to human review queue
```

**Confidence thresholds by risk level:**

| Risk | Threshold | Meaning |
|---|---|---|
| Low | 0.7 | Events with clear intent (commits, PR state changes) |
| Medium | 0.85 | Events needing some interpretation (slash commands) |
| High | 0.95 | Ambiguous events (emails, generic messages) |
| Critical | 1.1 | Never auto-accepted — always requires human review |

**Actions that always require human review** regardless of confidence: `decision`, `move_complete`, `budget_change`, `access_change`.

**Human review API:**

```bash
# List events pending review
GET /api/v1/integrations/review/pending

# Accept or reject an event (with optional data override)
POST /api/v1/integrations/review/:eventId
  { "decision": "accepted" | "rejected", "override_data": { ... } }
```

### Device pairing (Edge connection)

The Process Edge is a WSS connection between local Claude Code sessions and the control plane. Devices must pair before they can receive steering commands.

**Pairing flow:**

1. Run `/process:connect` in Claude Code (or the plugin auto-detects an unpaired device)
2. A 6-character pairing code is generated (valid for 5 minutes)
3. Open `<control-plane-url>/pair` in a browser, log in, enter the code
4. A device JWT (30-day TTL) is issued and stored locally
5. The device connects to the edge WebSocket at `/edge?token=<device_jwt>`

**Edge message flow:**

| Direction | Message types |
|---|---|
| Server → Device | `steering`, `start_move`, `stop`, `policy_update`, `pong` |
| Device → Server | `handshake`, `heartbeat`, `session_update`, `ack`, `session_started/ended/stopped` |

Reconnection uses exponential backoff (1s → 60s with jitter) and a 30-second heartbeat interval.

### Push notifications (PWA)

Semantic push notifications that tell you what happened, not what changed.

**Setup:**

1. Generate a VAPID key pair (`npx web-push generate-vapid-keys`)
2. Set `VITE_VAPID_PUBLIC_KEY` in your environment
3. Users opt-in via the browser notification prompt

**Notification format:** "Release blocked. Security approval is now critical." — not "Task #417 changed status." Notifications are formatted per event type with computed severity.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | API server port |
| `REALTIME_PORT` | `4001` | WebSocket server port |
| `JWT_SECRET` | dev secret | Shared secret for user + device JWTs. **Change in production.** |
| `SUPERADMIN_EMAIL` | — | Auto-grant superadmin when this email registers |
| `DATABASE_URL` | embedded | PostgreSQL connection string |
| `CLAUDE_PLUGIN_DATA` | — | Plugin persistent data directory |
| `APP_URL` | `http://localhost:3000` | Base URL for links in Slack messages and emails |
| `GITHUB_CLIENT_ID` | — | GitHub OAuth App client ID |
| `GITHUB_CLIENT_SECRET` | — | GitHub OAuth App client secret |
| `VITE_VAPID_PUBLIC_KEY` | — | VAPID public key for Web Push API (client-side) |
| `CONTROL_PLANE_URL` | `wss://control.pos.digital` | WSS URL for edge device connections |
| `DEVICE_ID` | — | Unique device identifier (edge/dispatcher) |
| `DEVICE_TOKEN` | — | Device auth JWT (edge/dispatcher) |
| `POS_HEALTH_PORT` | `4002` | Dispatcher health endpoint port |
| `POS_DATA_DIR` | `~/.pos` | Data directory for edge/dispatcher |
| `START_DISPATCHER` | enabled | Set to `0` to skip dispatcher in dev |

---

## For developers

### Project structure

```
p-os/
├── apps/
│   ├── api/          # Hono HTTP server (35 route modules)
│   ├── web/          # React 19 + Vite 6 (61 components)
│   ├── worker/       # Background controllers + projections
│   └── realtime/     # WebSocket server (browser + edge)
├── packages/
│   ├── contracts/    # TypeScript types + Zod schemas
│   ├── db/           # Embedded PostgreSQL + migrations
│   ├── policy/       # ABAC policy engine
│   ├── why/          # WHY causal traversal engine
│   ├── execution/    # Execution compiler
│   ├── context/      # Context Capsule generator
│   ├── process-sdk/  # Pack + Executor SDK
│   └── ...           # kernel, events, commands, projections, controllers, schema-registry
├── executors/
│   ├── claude-code/  # Claude Code executor
│   ├── human/        # Human executor (routes to Attention)
│   ├── webhook/      # Webhook executor
│   └── api/          # API executor
├── plugin/
│   └── claude-code/  # Claude Code plugin (hooks, MCP, skills, agents)
├── edge/
│   ├── core/         # WSS connection to control plane
│   └── dispatcher/   # claude --bg orchestration
├── packs/            # 7 domain packs
├── docs/             # Vision, blueprint, specs, plans
└── dev.ts            # One-command dev start
```

### Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Language | TypeScript 5 (strict, ESM) |
| Monorepo | pnpm workspaces + Turborepo |
| API | Hono |
| Database | PostgreSQL (embedded-postgres for dev) |
| Frontend | React 19, Vite 6, Tailwind CSS 4 |
| State | Zustand + @tanstack/react-query |
| Drag and drop | @dnd-kit |
| Auth | JWT (jose), ABAC policy engine |
| i18n | react-i18next |
| Plugin storage | better-sqlite3 |
| MCP | @modelcontextprotocol/sdk |
| WebSocket | ws |

### Commands

```bash
pnpm install          # Install dependencies
npx tsx dev.ts        # Start everything (PG + API + WS + Worker + Dispatcher + Web)
pnpm build            # Build all 32 packages
pnpm test             # Run tests
pnpm lint             # Lint

# Database
pnpm db:start         # Start embedded PostgreSQL
pnpm db:migrate       # Run migrations

# Superadmin
npx tsx apps/api/src/cli/create-superadmin.ts <email> <password>

# Dispatcher daemon (persistent background service)
npx tsx edge/dispatcher/src/cli/index.ts install    # Install as system service
npx tsx edge/dispatcher/src/cli/index.ts status     # Check daemon status
npx tsx edge/dispatcher/src/cli/index.ts logs       # Tail daemon logs
npx tsx edge/dispatcher/src/cli/index.ts uninstall  # Remove daemon
```

### Design documents

The `docs/` directory contains the full product design:

- `vision.md` — product vision and philosophy
- `blueprint.md` — technical architecture
- `specs_design.md` — detailed specifications
- `implementation_plan.md` — 22-phase delivery plan
- `superpowers/specs/` — sub-project design specs (SP1 through SP7)

---

<p align="center">
  Built by <a href="https://yoda.digital">YODA Digital</a>
</p>
