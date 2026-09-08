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
  <a href="#what-this-is">What this is</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#features">Features</a> •
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

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | API server port |
| `JWT_SECRET` | dev secret | Change in production |
| `SUPERADMIN_EMAIL` | — | Auto-grant superadmin on register |
| `DATABASE_URL` | embedded | PostgreSQL connection string |
| `CLAUDE_PLUGIN_DATA` | — | Plugin persistent data directory |

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
