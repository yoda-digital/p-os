-- Universal Process OS — Complete Schema
-- All state mutations go through events. These tables hold canonical state.

-- === AUTH & ORGANIZATION ===

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id UUID NOT NULL REFERENCES users(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, organization_id)
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  member_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  public_key TEXT,
  trust_status TEXT NOT NULL DEFAULT 'trusted',
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- === EVENT LEDGER (append-only) ===

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES organizations(id),
  case_id UUID,
  type TEXT NOT NULL,
  actor_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  causation_id TEXT,
  correlation_id TEXT,
  case_sequence BIGINT,
  data JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_case_id ON events(case_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_tenant_id ON events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_case_sequence ON events(case_id, case_sequence);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id);
CREATE INDEX IF NOT EXISTS idx_events_recorded_at ON events(recorded_at);

-- === TRANSACTIONAL OUTBOX ===

CREATE TABLE IF NOT EXISTS event_outbox (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES events(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON event_outbox(id) WHERE processed_at IS NULL;

-- === CASE SEQUENCES ===

CREATE TABLE IF NOT EXISTS case_sequences (
  case_id UUID PRIMARY KEY,
  next_sequence BIGINT NOT NULL DEFAULT 1
);

-- === CANONICAL AGGREGATES ===

CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  workspace_id UUID REFERENCES workspaces(id),
  type TEXT NOT NULL DEFAULT 'general',
  title TEXT NOT NULL,
  description TEXT,
  lifecycle TEXT NOT NULL DEFAULT 'open' CHECK (lifecycle IN ('open', 'dormant', 'closed', 'archived', 'void')),
  primary_intent_ids UUID[] NOT NULL DEFAULT '{}',
  owner_actor_ids UUID[] NOT NULL DEFAULT '{}',
  pack_refs JSONB NOT NULL DEFAULT '[]',
  project_refs JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_cases_org ON cases(organization_id);
CREATE INDEX IF NOT EXISTS idx_cases_lifecycle ON cases(lifecycle);

CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  properties JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entities_case ON entities(case_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);

CREATE TABLE IF NOT EXISTS relations (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  source_ref JSONB NOT NULL,
  target_ref JSONB NOT NULL,
  type TEXT NOT NULL,
  qualifier TEXT,
  confidence REAL DEFAULT 1.0,
  effective_from TIMESTAMPTZ,
  effective_until TIMESTAMPTZ,
  source_refs JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_relations_case ON relations(case_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(type);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations USING GIN (source_ref);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations USING GIN (target_ref);

CREATE TABLE IF NOT EXISTS assertions (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  subject_ref JSONB NOT NULL,
  predicate TEXT NOT NULL,
  value JSONB,
  modality TEXT NOT NULL DEFAULT 'claimed',
  source_refs JSONB NOT NULL DEFAULT '[]',
  evidence_refs UUID[] NOT NULL DEFAULT '{}',
  confidence REAL DEFAULT 0.5,
  effective_from TIMESTAMPTZ,
  effective_until TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retracted', 'superseded', 'disputed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_assertions_case ON assertions(case_id);
CREATE INDEX IF NOT EXISTS idx_assertions_status ON assertions(status);

CREATE TABLE IF NOT EXISTS intents (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  class TEXT NOT NULL,
  statement TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  owner_refs JSONB NOT NULL DEFAULT '[]',
  success_contract JSONB,
  stop_contract JSONB,
  failure_contract JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'satisfied', 'failed', 'abandoned', 'superseded')),
  constraints JSONB NOT NULL DEFAULT '[]',
  dependencies JSONB NOT NULL DEFAULT '[]',
  conflict_refs UUID[] NOT NULL DEFAULT '{}',
  confidence REAL,
  time_horizon JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_intents_case ON intents(case_id);
CREATE INDEX IF NOT EXISTS idx_intents_status ON intents(status);
CREATE INDEX IF NOT EXISTS idx_intents_class ON intents(class);

CREATE TABLE IF NOT EXISTS rules (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  type TEXT NOT NULL,
  statement TEXT NOT NULL,
  authority_ref JSONB,
  applicability JSONB,
  predicate JSONB,
  effective_from TIMESTAMPTZ,
  effective_until TIMESTAMPTZ,
  supersedes UUID,
  evaluation_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rules_case ON rules(case_id);
CREATE INDEX IF NOT EXISTS idx_rules_type ON rules(type);

CREATE TABLE IF NOT EXISTS actors (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  class TEXT NOT NULL,
  identity_ref JSONB,
  display_name TEXT NOT NULL,
  roles JSONB NOT NULL DEFAULT '[]',
  capabilities JSONB NOT NULL DEFAULT '[]',
  authority_grants JSONB NOT NULL DEFAULT '[]',
  availability JSONB,
  cost_profile JSONB,
  trust_level TEXT DEFAULT 'standard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_actors_org ON actors(organization_id);
CREATE INDEX IF NOT EXISTS idx_actors_class ON actors(class);

CREATE TABLE IF NOT EXISTS resources (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  capacity JSONB,
  available JSONB,
  reserved JSONB,
  cost_per_unit JSONB,
  location TEXT,
  consumable BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_resources_case ON resources(case_id);

CREATE TABLE IF NOT EXISTS moves (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  class TEXT NOT NULL,
  title TEXT NOT NULL,
  objective TEXT,
  intent_refs UUID[] NOT NULL DEFAULT '{}',
  parent_move_id UUID REFERENCES moves(id),
  preconditions JSONB NOT NULL DEFAULT '[]',
  postconditions JSONB NOT NULL DEFAULT '[]',
  completion_contract JSONB,
  required_capabilities JSONB NOT NULL DEFAULT '[]',
  required_authority JSONB NOT NULL DEFAULT '[]',
  constraints JSONB NOT NULL DEFAULT '[]',
  dependencies UUID[] NOT NULL DEFAULT '{}',
  priority TEXT NOT NULL DEFAULT 'medium',
  risk TEXT NOT NULL DEFAULT 'none',
  deadline TIMESTAMPTZ,
  execution_policy JSONB,
  assigned_actor_ids UUID[] NOT NULL DEFAULT '{}',
  -- State vector (7 dimensions)
  readiness TEXT NOT NULL DEFAULT 'not_ready',
  execution TEXT NOT NULL DEFAULT 'not_started',
  verification TEXT NOT NULL DEFAULT 'not_required',
  attention TEXT NOT NULL DEFAULT 'autonomous',
  risk_level TEXT NOT NULL DEFAULT 'none',
  temporal TEXT NOT NULL DEFAULT 'on_track',
  outcome TEXT NOT NULL DEFAULT 'unsatisfied',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_moves_case ON moves(case_id);
CREATE INDEX IF NOT EXISTS idx_moves_class ON moves(class);
CREATE INDEX IF NOT EXISTS idx_moves_execution ON moves(execution);
CREATE INDEX IF NOT EXISTS idx_moves_outcome ON moves(outcome);
CREATE INDEX IF NOT EXISTS idx_moves_parent ON moves(parent_move_id);

CREATE TABLE IF NOT EXISTS attempts (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  move_id UUID NOT NULL REFERENCES moves(id),
  executor_id UUID,
  strategy TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  runtime_refs JSONB NOT NULL DEFAULT '{}',
  model TEXT,
  effort TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  cost JSONB,
  usage JSONB,
  failure_reason TEXT,
  produced_artifacts JSONB NOT NULL DEFAULT '[]',
  steering_history JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attempts_case ON attempts(case_id);
CREATE INDEX IF NOT EXISTS idx_attempts_move ON attempts(move_id);
CREATE INDEX IF NOT EXISTS idx_attempts_state ON attempts(state);

CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  subject_refs JSONB NOT NULL DEFAULT '[]',
  relation TEXT NOT NULL,
  artifact_ref JSONB,
  source_ref JSONB,
  scope JSONB,
  provenance JSONB,
  observed_at TIMESTAMPTZ,
  fresh_until TIMESTAMPTZ,
  confidence REAL DEFAULT 1.0,
  validity TEXT NOT NULL DEFAULT 'valid' CHECK (validity IN ('valid', 'stale', 'invalid', 'disputed', 'unknown')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_evidence_case ON evidence(case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_validity ON evidence(validity);

CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  question TEXT NOT NULL,
  context TEXT,
  options JSONB NOT NULL DEFAULT '[]',
  evidence_refs UUID[] NOT NULL DEFAULT '{}',
  risk_refs JSONB NOT NULL DEFAULT '[]',
  recommended_option JSONB,
  recommendation_confidence REAL,
  recommendation_rationale TEXT,
  required_authority JSONB,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'requested', 'in_review', 'decided', 'deferred', 'superseded', 'cancelled')),
  selected_option JSONB,
  rationale TEXT,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  blocking_move_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  revision BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_decisions_case ON decisions(case_id);
CREATE INDEX IF NOT EXISTS idx_decisions_state ON decisions(state);

-- === STEERING ===

CREATE TABLE IF NOT EXISTS steering_commands (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  move_id UUID NOT NULL REFERENCES moves(id),
  attempt_id UUID REFERENCES attempts(id),
  class TEXT NOT NULL,
  instruction TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'issued',
  issued_by UUID,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_steering_attempt ON steering_commands(attempt_id);
CREATE INDEX IF NOT EXISTS idx_steering_state ON steering_commands(state);

-- === PROJECTIONS (materialized, rebuildable) ===

CREATE TABLE IF NOT EXISTS projection_case_summary (
  case_id UUID PRIMARY KEY REFERENCES cases(id),
  organization_id UUID NOT NULL,
  title TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  total_moves INT NOT NULL DEFAULT 0,
  active_moves INT NOT NULL DEFAULT 0,
  completed_moves INT NOT NULL DEFAULT 0,
  blocked_moves INT NOT NULL DEFAULT 0,
  total_evidence INT NOT NULL DEFAULT 0,
  pending_decisions INT NOT NULL DEFAULT 0,
  attention_required BOOLEAN NOT NULL DEFAULT false,
  primary_risk TEXT DEFAULT 'none',
  last_activity_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projection_kanban (
  move_id UUID PRIMARY KEY REFERENCES moves(id),
  case_id UUID NOT NULL,
  column_id TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  card_data JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kanban_case ON projection_kanban(case_id);
CREATE INDEX IF NOT EXISTS idx_kanban_column ON projection_kanban(column_id);

CREATE TABLE IF NOT EXISTS projection_attention (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL,
  move_id UUID,
  decision_id UUID,
  priority TEXT NOT NULL DEFAULT 'medium',
  reason TEXT NOT NULL,
  action_required TEXT,
  actor_ids UUID[] NOT NULL DEFAULT '{}',
  deadline TIMESTAMPTZ,
  blocking_impact INT NOT NULL DEFAULT 0,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attention_resolved ON projection_attention(resolved);
CREATE INDEX IF NOT EXISTS idx_attention_priority ON projection_attention(priority);

CREATE TABLE IF NOT EXISTS projection_timeline (
  event_id UUID PRIMARY KEY,
  case_id UUID NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  actor_id UUID,
  summary TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  move_id UUID,
  attempt_id UUID
);

CREATE INDEX IF NOT EXISTS idx_timeline_case ON projection_timeline(case_id, occurred_at);

-- === CONTEXT ORCHESTRATION ===

CREATE TABLE IF NOT EXISTS context_capsules (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  case_revision BIGINT NOT NULL,
  move_id UUID,
  move_revision BIGINT,
  attempt_id UUID,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generator_version TEXT NOT NULL DEFAULT '0.1.0',
  sections JSONB NOT NULL DEFAULT '{}',
  included_object_refs JSONB NOT NULL DEFAULT '[]',
  token_estimate INT
);

CREATE INDEX IF NOT EXISTS idx_capsules_case ON context_capsules(case_id);

-- === PROCESS PACKS ===

CREATE TABLE IF NOT EXISTS process_packs (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  domain TEXT NOT NULL,
  type_schemas JSONB NOT NULL DEFAULT '{}',
  relation_types JSONB NOT NULL DEFAULT '[]',
  views JSONB NOT NULL DEFAULT '[]',
  controllers JSONB NOT NULL DEFAULT '[]',
  default_rules JSONB NOT NULL DEFAULT '[]',
  execution_hints JSONB NOT NULL DEFAULT '{}',
  extractors JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, version)
);

-- === SCHEMA REGISTRY ===

CREATE TABLE IF NOT EXISTS type_registry (
  type_id TEXT PRIMARY KEY,
  semantic_class TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  json_schema JSONB NOT NULL,
  traits TEXT[] NOT NULL DEFAULT '{}',
  display JSONB NOT NULL DEFAULT '{}',
  migration JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- === SIMULATION ===

CREATE TABLE IF NOT EXISTS simulation_forks (
  id UUID PRIMARY KEY,
  source_case_id UUID NOT NULL REFERENCES cases(id),
  fork_event_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  hypothetical_changes JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

-- === PROCESS INTELLIGENCE ===

CREATE TABLE IF NOT EXISTS process_metrics (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cycle_time INTERVAL,
  waiting_time INTERVAL,
  rework_count INT NOT NULL DEFAULT 0,
  failed_attempts INT NOT NULL DEFAULT 0,
  human_attention_time INTERVAL,
  evidence_gaps INT NOT NULL DEFAULT 0,
  completion_reliability REAL,
  cost JSONB,
  executor_performance JSONB NOT NULL DEFAULT '{}',
  context_rotations INT NOT NULL DEFAULT 0,
  steering_frequency INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_metrics_case ON process_metrics(case_id);

CREATE TABLE IF NOT EXISTS drift_reports (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  expected_process JSONB NOT NULL,
  observed_process JSONB NOT NULL,
  deviations JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
