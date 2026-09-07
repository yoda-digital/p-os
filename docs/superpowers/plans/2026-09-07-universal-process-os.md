# Universal Process OS — Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Universal Process OS — an event-sourced universal semantic control plane with full Kanban UI, Claude integration, and all domain packs — running locally end-to-end.

**Architecture:** TypeScript monorepo (pnpm + turborepo). Event-sourced backend with PostgreSQL (embedded-postgres for zero-install local dev). Hono HTTP server + native WebSocket realtime. React + Vite frontend. All state changes flow: Command → Event → Projection → UI.

**Tech Stack:** TypeScript 5.x, pnpm workspaces, turborepo, PostgreSQL (embedded-postgres), Hono, React 19, Vite 6, Tailwind CSS 4, @tanstack/react-query, dnd-kit, Zod, uuid (v7), ws, jose (JWT), bcrypt

**Spec:** `docs/vision.md`, `docs/blueprint.md`, `docs/specs_design.md`, `docs/implementation_plan.md`

## Global Constraints

- Node.js ≥ 22 (available: v24.15.0)
- TypeScript strict mode, ESM throughout
- All IDs are UUIDv7
- All mutable aggregates carry `revision: number` with optimistic concurrency
- All state mutations go through Commands → Events → Projections
- No direct DB writes from UI endpoints
- No Docker required — embedded-postgres for local PostgreSQL

---

## Phase 1: Monorepo Scaffold + Database Foundation

### Task 1: Monorepo Setup
Create the full monorepo structure with all packages, turborepo config, and shared TypeScript config.

### Task 2: Database + Embedded PostgreSQL
Set up embedded-postgres dev server, migration system, and the complete database schema (event ledger, all aggregates, projections, auth tables).

### Task 3: Contracts Package
All TypeScript types, Zod schemas, and constants shared across the entire system — the canonical type definitions for every kernel primitive.

## Phase 2: Kernel Packages

### Task 4: Events Package
Event envelope types, event registry, serialization, and the append-only event store with case_sequence.

### Task 5: Commands Package
Command envelope, command processor, idempotency, expected_revision validation, and all command handlers for every kernel primitive.

### Task 6: Projections Package
Projection engine, all materialized projections (case_summary, move_state, kanban, attention_queue, timeline, dependency_graph, evidence_status, rule_compliance, decision_queue, executor_status, context_status, cost_summary), and projection rebuild.

### Task 7: Controllers Package
All 13 controllers (Intent, Dependency, Evidence, Completion, Rule, Deadline, Risk, Resource, Attention, Context, Execution, Cost, Drift).

### Task 8: Policy & WHY Engine
Authorization kernel, policy evaluation, rule engine, and the WHY causal traversal engine.

## Phase 3: API Server + Realtime

### Task 9: API Server
Hono HTTP server with all REST endpoints (/v1/cases, /v1/moves, /v1/decisions, etc.), command processing, auth middleware, and error handling.

### Task 10: WebSocket Realtime Gateway
Projection delta streaming, browser subscriptions, and edge WSS endpoint.

### Task 11: Background Worker
Outbox processor, projection updater, controller evaluator, event fan-out.

## Phase 4: Auth & Organization

### Task 12: Authentication
OIDC-compatible auth, JWT sessions, user registration/login, device identity, organization/workspace/team management.

## Phase 5: Web UI

### Task 13: Frontend Foundation
React + Vite app, routing, auth flows, layout, theme system, API client.

### Task 14: Kanban Board
Full bidirectional Kanban with rich cards, drag semantics (dnd-kit), semantic command emission, live WebSocket updates.

### Task 15: All Views
Attention, Timeline, Dependencies, Evidence Graph, Decisions, Compliance, Actors/Agents, Resources, Risk, Calendar views. Adaptive view compiler.

### Task 16: Steering & Case Detail
Steering composer, case detail page, move detail, attempt timeline, WHY explorer, time travel UI.

## Phase 6: Claude Integration Packages

### Task 17: Process MCP Server
Full MCP server with all process tools.

### Task 18: Plugin & Edge Packages
Claude Code plugin manifest, hooks, edge connection, dispatcher, execution compiler.

## Phase 7: Advanced Features

### Task 19: Domain Packs
All 7 domain packs (Software, Procurement, Journalism, Research, Negotiation, Incident, Logistics) + behavior packs.

### Task 20: Process Intelligence & Simulation
AI Process Architect, Guardian, drift detection, process mining, simulation engine.

### Task 21: Dev Orchestration Script
Single `pnpm dev` command that starts embedded-postgres, runs migrations, starts API server, worker, realtime gateway, and web UI.

---

This plan will be executed via parallel subagents — one per major subsystem — with the monorepo scaffold built first, then all packages in parallel.
