# SP6: Integrations + Executors + Mobile — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Add external integrations (GitHub, email, Slack, CI, webhooks), multiple executor types (Human, Webhook, API), and a mobile-first PWA with semantic notifications.

**Spec:** `docs/superpowers/specs/2026-09-08-sp6-integrations-executors-mobile.md`

## Tasks

### Task 1: External Interpretation Pipeline + Webhook Integration
- Create `apps/api/src/services/external-pipeline.ts` — RawExternalEvent → semantic proposal → policy gate → accepted/review
- Create `apps/api/src/routes/webhooks.ts` — generic inbound webhook endpoint
- Migration 008: external_events, webhook_configs tables
- Outbound webhook executor for triggering external systems

### Task 2: GitHub Integration
- Create `apps/api/src/integrations/github.ts` — PR/issue/commit sync via GitHub API
- GitHub webhook handler — parse events, feed into external pipeline
- Map: PR → Move, commit → Evidence, review → Decision
- OAuth connection flow in settings

### Task 3: Slack/Email/Calendar Integration
- Create `apps/api/src/integrations/slack.ts` — notifications, approval commands
- Create `apps/api/src/integrations/email.ts` — inbound/outbound email processing
- Create `apps/api/src/integrations/calendar.ts` — deadline sync
- Integration settings pages in web UI

### Task 4: Multiple Executors (Human, Webhook, API)
- Rewrite `executors/human/src/index.ts` — HumanExecutor implementing full Attempt contract
- Rewrite `executors/webhook/src/index.ts` — WebhookExecutor with callback handling
- Create `executors/api/src/index.ts` — APIExecutor for external API calls
- Create `packages/process-sdk/src/executor-contract.ts` — formal 12-method interface
- Execution compiler routes to non-Claude executors when appropriate

### Task 5: Mobile PWA
- Create `apps/web/src/pwa/` — service worker, manifest.json, offline cache
- Create `apps/web/src/components/mobile/` — mobile-optimized views for Attention, Decision, Approve
- Semantic notifications: "Release blocked. Security approval critical." not "Task #417 changed"
- Add web push notification support
- Responsive design verification on all views

### Task 6: Integration + Build
- Verify pnpm build
- Commit: `feat: SP6 complete`
