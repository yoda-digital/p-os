# SP4: Governance + Deep Packs + Adaptive Views — Design Spec

**Status:** Approved  
**Date:** 2026-09-08  
**Depends on:** SP1, SP2  
**Source:** `implementation_plan.md` Phases 10-12, `specs_design.md`, `blueprint.md`

---

## 1. Attention Engine

### 1.1 Computed Priority Queue

Every Case-scoped item that needs human attention gets a computed priority score:

```
score = w_risk × risk_factor
      + w_deadline × deadline_urgency
      + w_authority × authority_level
      + w_critical × is_critical_path
      + w_downstream × downstream_impact
```

Weights are configurable per organization (stored in `organizations.settings`).

### 1.2 Attention Levels

| Level | Meaning | Routing |
|-------|---------|---------|
| `human_decision_required` | A Decision is pending that only a human can resolve | Decision Center |
| `human_approval_required` | An action needs explicit human sign-off | Approval flow |
| `critical_intervention` | Something is going wrong — risk escalation, policy breach, agent loop | Alert + block |
| `watch` | Worth monitoring but no action required yet | Dashboard only |
| `autonomous` | AI can proceed without human input | No attention item |

### 1.3 Attention Item Schema

```typescript
interface AttentionItem {
  id: string;
  case_id: string;
  move_id?: string;
  attempt_id?: string;
  level: AttentionLevel;
  category: 'decision' | 'approval' | 'intervention' | 'escalation' | 'deadline' | 'evidence_gap';
  title: string;
  description: string;
  priority_score: number;
  required_authority: string[];
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution?: string;
}
```

### 1.4 Attention Triggers

The worker evaluates attention on every event cycle:
- `DecisionCreated` → `human_decision_required`
- Move blocked + high risk → `critical_intervention`
- Deadline < 24h + move not started → `human_approval_required` (to reprioritize or extend)
- Evidence stale on critical-path move → `watch` → escalate to `critical_intervention` if unresolved
- Budget threshold exceeded → `human_approval_required`
- Consecutive attempt failures (≥ 3) → `critical_intervention`

---

## 2. Decision Center

### 2.1 Decision Workflow

```
Question → Options (with evidence/risks/tradeoffs per option)
→ AI Recommendation (with confidence + rationale)
→ Authority gate (who can decide?)
→ Human resolves (selects option + records rationale)
→ Decision event emitted → downstream moves unblocked
```

### 2.2 Decision UI

Full-page decision view with:
- Question statement + context
- Options as cards, each showing: description, supporting evidence, risks, tradeoffs
- AI recommendation with confidence bar
- Approve/Select buttons per option
- Rationale textarea (required)
- Mobile-optimized: swipe-to-approve pattern

### 2.3 API Additions

```
PATCH /v1/decisions/:id          — Update decision options/evidence
POST  /v1/decisions/:id/recommend — Generate AI recommendation
```

---

## 3. Governance Layer

### 3.1 Case Autonomy Profile

Per-Case configuration controlling how much AI can do unsupervised:

```typescript
interface AutonomyProfile {
  level: 'supervised' | 'guided' | 'autonomous' | 'full_autonomous';
  auto_create_moves: boolean;
  auto_activate_moves: boolean;
  auto_approve_evidence: boolean;
  max_cost_per_attempt_usd: number;
  max_concurrent_attempts: number;
  require_human_approval_for: string[]; // action types
}
```

### 3.2 Action Authority Matrix

Maps actions to required authority levels:

```
move.activate (risk=high)   → requires org_admin or case_owner
decision.resolve            → requires listed authority role
evidence.invalidate         → requires case_contributor + justification
steering.hard_stop          → requires case_owner or org_admin
budget.exceed_threshold     → requires org_billing or org_owner
```

### 3.3 Budget Controls

Track per-Case and per-Organization:
- Token usage (input/output)
- Monetary cost (from attempt cost tracking)
- Threshold alerts at 50%, 75%, 90%, 100%

### 3.4 Override Recording

Every governance override (human overriding AI recommendation, bypassing policy) emits `GovernanceOverride` event with: who, what was overridden, why (required), original recommendation, actual decision.

---

## 4. Deep Domain Packs

Each pack extends the kernel with domain-specific BEHAVIOR, not just renamed labels.

### 4.1 Pack Structure

```typescript
interface DomainPack {
  id: string;
  name: string;
  version: string;
  domain: string;
  // Domain-specific entity types with schemas
  entity_types: Record<string, JSONSchema>;
  // Domain-specific relation types
  relation_types: string[];
  // Domain-specific controllers (evaluate on every event)
  controllers: PackController[];
  // Domain-specific evidence types with validation
  evidence_types: Record<string, EvidenceTypeSpec>;
  // Domain-specific move classes
  move_classes: string[];
  // View priority ordering
  view_priority: string[];
  // Default rules
  default_rules: RuleTemplate[];
  // Intent templates
  intent_templates: IntentTemplate[];
}
```

### 4.2 Software Delivery Pack

**Entity types:** `repository`, `commit`, `pull_request`, `deployment`, `test_suite`, `branch`, `worktree`  
**Relation types:** `IMPLEMENTS`, `TESTS`, `DEPLOYS`, `REVIEWS`, `DEPENDS_ON`, `CHERRY_PICKED_FROM`  
**Controllers:**
- TestPassController: when test evidence attached → auto-advance verification
- ReviewController: when review approved → mark review evidence valid
- DeployController: when deployment succeeds → collect deployment evidence  
**Evidence types:** `test_result` (pass/fail/coverage), `code_review` (approved/changes_requested), `deployment_status`, `security_scan`  
**Move classes:** `IMPLEMENT`, `REVIEW`, `TEST`, `DEPLOY`, `HOTFIX`  
**Views:** Kanban → Dependencies → Agents → Evidence → Timeline

### 4.3 Procurement / Tender Pack

**Entity types:** `requirement`, `document`, `submission`, `clarification`, `evaluation_criterion`, `bidder`  
**Relation types:** `SATISFIES`, `CLARIFIES`, `REFERENCES`, `SUPERSEDES`, `CONFLICTS_WITH`  
**Controllers:**
- ClarificationController: clarification → re-evaluate affected requirements
- DeadlineController: track submission deadlines with escalation
- ComplianceController: auto-check mandatory document presence  
**Evidence types:** `document_present`, `requirement_met`, `compliance_check`, `deadline_met`  
**Move classes:** `DRAFT`, `CLARIFY`, `EVALUATE`, `SUBMIT`, `AWARD`  
**Views:** Compliance → Requirements → Documents → Deadlines → Decisions

### 4.4 Investigative Journalism Pack

**Entity types:** `source`, `claim`, `document`, `interview`, `publication`  
**Relation types:** `SUPPORTS`, `CONTRADICTS`, `CITES`, `RETRACTS`, `CORROBORATES`  
**Controllers:**
- ContradictionController: new evidence → check for contradictions with existing claims
- SourceVerificationController: require independent corroboration for high-impact claims
- RetractionController: source retraction → cascade to all derived claims  
**Evidence types:** `source_statement`, `document_excerpt`, `public_record`, `expert_opinion`  
**Move classes:** `INVESTIGATE`, `INTERVIEW`, `VERIFY_CLAIM`, `DRAFT_ARTICLE`, `PUBLISH`  
**Views:** Evidence → Claims → Sources → Contradictions → Timeline

### 4.5 Research Pack

**Entity types:** `hypothesis`, `experiment`, `dataset`, `finding`, `methodology`  
**Relation types:** `TESTS`, `SUPPORTS`, `DISPROVES`, `EXTENDS`, `REPLICATES`  
**Controllers:**
- HypothesisController: experiment result → update hypothesis status
- NegativeFindingController: rejected hypothesis CAN satisfy LEARN intent
- ReproducibilityController: flag unreproduced findings  
**Evidence types:** `experimental_result`, `statistical_analysis`, `peer_review`, `dataset_validation`  
**Move classes:** `HYPOTHESIZE`, `EXPERIMENT`, `ANALYZE`, `REPLICATE`, `PUBLISH`  
**Views:** Hypotheses → Experiments → Findings → Evidence → Timeline

### 4.6 Negotiation / Sales Pack

**Entity types:** `stakeholder`, `offer`, `commitment`, `signal`, `deal_term`  
**Relation types:** `PROPOSES`, `COUNTERS`, `COMMITS`, `REJECTS`, `ESCALATES`  
**Controllers:**
- CommitmentTracker: track what each party has committed to
- SignalAnalyzer: interpret signals for deal health
- NoDealController: "no deal" is a valid successful outcome  
**Evidence types:** `verbal_commitment`, `written_agreement`, `market_signal`, `competitive_intel`  
**Move classes:** `PROSPECT`, `PROPOSE`, `NEGOTIATE`, `CLOSE`, `DELIVER`  
**Views:** Stakeholders → Commitments → Signals → Decisions → Timeline

### 4.7 Incident Response Pack

**Entity types:** `alert`, `hypothesis`, `mitigation`, `postmortem`, `affected_system`  
**Relation types:** `CAUSES`, `MITIGATES`, `ESCALATES`, `RECOVERS`, `ROOT_CAUSE_OF`  
**Controllers:**
- EscalationController: impact increase → auto-escalate
- MitigationTracker: track mitigation effectiveness
- PostmortemController: require post-incident review  
**Evidence types:** `log_entry`, `metric_snapshot`, `user_report`, `mitigation_result`  
**Move classes:** `TRIAGE`, `INVESTIGATE`, `MITIGATE`, `RECOVER`, `POSTMORTEM`  
**Views:** Timeline → Hypotheses → Risk → Evidence → Actors

### 4.8 Physical Logistics Pack

**Entity types:** `asset`, `shipment`, `location`, `custody_record`, `container`  
**Relation types:** `CONTAINS`, `LOCATED_AT`, `CUSTODY_OF`, `SPLITS`, `MERGES`, `TRANSFERS_TO`  
**Controllers:**
- CustodyController: chain of custody must be maintained (no gaps)
- QuantityBalancer: asset quantities must balance across split/merge
- LocationTracker: track asset location through custody chain  
**Evidence types:** `receipt`, `inspection_report`, `weight_certificate`, `custody_handoff`  
**Move classes:** `RECEIVE`, `STORE`, `TRANSPORT`, `SPLIT`, `MERGE`, `DELIVER`  
**Views:** Resources → Timeline → Risk → Compliance → Actors

---

## 5. Adaptive View Compiler

### 5.1 Semantic Composition Detection

Analyze Case contents to determine dominant domain patterns:

```typescript
function compileViewPriority(caseId: string, packRefs: string[]): string[] {
  // Count entity types, evidence types, relation types
  // Match against pack view priorities
  // If many Claims + Evidence → prioritize Evidence view
  // If many Requirements → prioritize Compliance
  // If parallel Moves → prioritize Kanban
  // If many Decisions → prioritize Decisions
  // Pack-specific ordering takes precedence
}
```

### 5.2 View Priority Response

API returns ordered view list. Frontend sidebar renders in that order. User can always override manually.

```
GET /v1/cases/:id/views → { views: [{ id, label, priority, reason }] }
```

---

## 6. DB Changes

```sql
-- Migration 006_governance_packs.sql

-- Case autonomy profile
ALTER TABLE cases ADD COLUMN IF NOT EXISTS autonomy_profile JSONB DEFAULT '{}';

-- Pack controller state
CREATE TABLE IF NOT EXISTS pack_controller_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id),
  pack_id UUID NOT NULL REFERENCES process_packs(id),
  controller_name TEXT NOT NULL,
  state JSONB NOT NULL DEFAULT '{}',
  last_evaluated_at TIMESTAMPTZ,
  UNIQUE(case_id, pack_id, controller_name)
);

-- Budget tracking
CREATE TABLE IF NOT EXISTS budget_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  monetary_cost_usd NUMERIC(10,4) DEFAULT 0,
  attempt_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Governance overrides
CREATE TABLE IF NOT EXISTS governance_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  original_recommendation TEXT,
  actual_decision TEXT NOT NULL,
  justification TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Exit Gates

**Phase 10:** Claude can technically perform action → policy blocks it → Attention item → human approves → execution continues — with full audit trail.

**Phase 11:** No kernel schema modification for any of 7 domains. Extensions only via types/traits/packs/controllers/views.

**Phase 12:** Opening 7 different-domain Cases feels like 7 different applications, not Jira with different nouns.
