# SP6: Integrations + Executors + Mobile — Design Spec

**Status:** Approved  
**Date:** 2026-09-08  
**Depends on:** SP3 (Managed Execution), SP4 (Governance)  
**Source:** `implementation_plan.md` Phases 17-19, `specs_design.md`, `blueprint.md`

---

## 1. External Integrations

### 1.1 Priority Integration Families

| Family | Inbound | Outbound |
|--------|---------|----------|
| **GitHub** | Webhook: PR opened/merged/reviewed, issue created/closed, commit pushed, CI status | Create issues, post comments, request reviews |
| **Email** | Receive via webhook/IMAP polling | Send notifications, approvals, digests |
| **Calendar** | Read availability, meeting changes | Create events, send invites |
| **Drive/Docs** | Document upload, share notifications | Store evidence artifacts |
| **Slack/Teams/Telegram** | Messages mentioning process, commands | Notifications, approval requests, status updates |
| **CI** | Build started/passed/failed, deploy status | Trigger builds, request deployments |
| **Webhooks** | Generic inbound event receiver | Generic outbound HTTP calls |

### 1.2 Integration Configuration

Per-organization integration settings:

```typescript
interface IntegrationConfig {
  id: string;
  organization_id: string;
  type: 'github' | 'email' | 'calendar' | 'slack' | 'ci' | 'webhook';
  name: string;
  credentials: EncryptedJSON; // OAuth tokens, API keys (encrypted at rest)
  settings: Record<string, unknown>; // Per-type settings
  event_mappings: EventMapping[]; // What external events map to
  active: boolean;
}
```

### 1.3 External Interpretation Pipeline

CRITICAL: External content is DATA, not commands.

```
RawExternalEvent (e.g., email arrives)
  ↓
Semantic Interpretation Proposal
  (LLM proposes: "This email approves requirement R-7")
  ↓
Policy / Confidence Gate
  (confidence > 0.9 AND low risk? → auto-accept)
  (confidence < 0.9 OR high risk? → human review)
  ↓
Accepted Process Event OR Human Review Queue
```

NEVER: email arrives → LLM says approved → process closes. The human review gate is non-negotiable for consequential actions.

### 1.4 API Endpoints

```
GET    /v1/integrations              — List org integrations
POST   /v1/integrations              — Create integration
PATCH  /v1/integrations/:id          — Update integration
DELETE /v1/integrations/:id          — Remove integration
POST   /v1/integrations/:id/test     — Test connection
POST   /v1/integrations/webhook/:id  — Inbound webhook receiver
GET    /v1/integrations/:id/events   — Recent events from this integration
```

### 1.5 DB Changes

```sql
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  credentials_encrypted TEXT,
  settings JSONB DEFAULT '{}',
  event_mappings JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES integrations(id),
  raw_payload JSONB NOT NULL,
  interpreted_as JSONB,
  confidence NUMERIC(3,2),
  status TEXT DEFAULT 'pending', -- pending, accepted, rejected, review
  reviewed_by UUID REFERENCES users(id),
  process_event_id UUID REFERENCES events(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 2. Multiple Executors

### 2.1 Executor Contract (Universal Attempt Interface)

Every executor implements:

```typescript
interface ExecutorContract {
  // Discovery
  discoverCapabilities(): Promise<ExecutorCapabilities>;
  canAccept(move: Move): Promise<{ accepted: boolean; reason?: string }>;

  // Lifecycle
  startAttempt(move: Move, context: ContextCapsule): Promise<AttemptBinding>;
  reportProgress(attemptId: string, progress: ProgressReport): Promise<void>;
  receiveSteering(attemptId: string, steering: SteeringCommand): Promise<void>;
  pauseAttempt(attemptId: string): Promise<void>;
  resumeAttempt(attemptId: string): Promise<void>;
  cancelAttempt(attemptId: string): Promise<void>;

  // Completion
  collectEvidence(attemptId: string): Promise<Evidence[]>;
  finishAttempt(attemptId: string, outcome: 'succeeded' | 'failed'): Promise<void>;

  // Health
  health(): Promise<ExecutorHealth>;
}
```

### 2.2 HumanExecutor

Routes work to the Attention queue. Tracks human actions through the web UI.

```
startAttempt → creates Attention item "Work assigned to you: <move title>"
reportProgress → human updates via Move detail drawer
receiveSteering → creates new Attention item with constraint
pauseAttempt → marks attention as "paused"
finishAttempt → human clicks "Mark Complete" in UI
collectEvidence → gathers evidence attached by the human
```

### 2.3 WebhookExecutor

Triggers external webhooks and polls for completion.

```
startAttempt → POST to configured webhook URL with move context
reportProgress → inbound webhook with progress payload
receiveSteering → POST steering to webhook URL
finishAttempt → inbound webhook with outcome
collectEvidence → parse evidence from webhook response
```

### 2.4 APIExecutor

Calls external APIs programmatically.

```
startAttempt → call configured API endpoint
reportProgress → poll status endpoint
finishAttempt → parse completion response
```

### 2.5 Executor Registry

```
GET  /v1/executors             — List available executors
POST /v1/executors             — Register new executor
GET  /v1/executors/:id/health  — Check executor health
```

### 2.6 DB Changes

```sql
CREATE TABLE IF NOT EXISTS executor_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL, -- claude_code, human, webhook, api
  name TEXT NOT NULL,
  config JSONB DEFAULT '{}',
  capabilities JSONB DEFAULT '[]',
  health_status TEXT DEFAULT 'unknown',
  last_health_check_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 3. Mobile / PWA

### 3.1 Control Surface (Not Miniature Enterprise Config)

Mobile prioritizes ACTION over configuration:

| Action | UI Pattern |
|--------|-----------|
| Attention | Priority-sorted card list with swipe actions |
| Decision | Full decision card with approve/reject swipe |
| Approve | One-tap approval with confirmation |
| Steer | Quick steering: constraint input + send |
| Pause/Stop | One-tap with confirmation |
| Comment | Text input on any move/evidence |
| Attach Evidence | Camera + file picker |
| WHY | Tap any state → causal explanation |

### 3.2 Semantic Notifications

```
✅ Good: "Release blocked. Security approval is now critical."
❌ Bad:  "Task #417 changed status."

✅ Good: "Decision required: Should we proceed with vendor A or B? 3 team members waiting."
❌ Bad:  "New decision created."
```

Notification payload includes: attention level, case title, action required, deadline if applicable.

### 3.3 PWA Implementation

- Service worker for offline support (view cached state, queue actions)
- Push notifications via Web Push API
- Installable (manifest.json, icons, splash screen)
- Responsive design (existing Tailwind already responsive, but mobile-first for key flows)

### 3.4 API

```
POST /v1/notifications/subscribe    — Register push subscription
POST /v1/notifications/unsubscribe  — Remove subscription
GET  /v1/notifications/preferences  — Get notification preferences
PATCH /v1/notifications/preferences — Update preferences
```

### 3.5 DB Changes

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  keys JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  attention_critical BOOLEAN DEFAULT true,
  attention_high BOOLEAN DEFAULT true,
  attention_medium BOOLEAN DEFAULT false,
  decisions BOOLEAN DEFAULT true,
  steering_updates BOOLEAN DEFAULT false,
  digest_frequency TEXT DEFAULT 'daily' -- realtime, hourly, daily, weekly, off
);
```

---

## 4. Exit Gates

**Phase 17:** Each integration works end-to-end with real external services. GitHub PR → evidence. Email → interpreted event.

**Phase 18:** HumanExecutor routes work to attention queue. WebhookExecutor triggers and receives results. All implement universal Attempt contract.

**Phase 19:** Mobile approval flow works on a phone. Notifications are semantic. Offline viewing works.
