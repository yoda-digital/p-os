-- Migration 006: Governance — autonomy profiles, budget controls, overrides

-- Case autonomy profile (per-case AI behavior controls)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS autonomy_profile JSONB DEFAULT '{}';

-- Pack controller state (tracks per-controller evaluation state per case)
CREATE TABLE IF NOT EXISTS pack_controller_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  pack_id UUID NOT NULL REFERENCES process_packs(id) ON DELETE CASCADE,
  controller_name TEXT NOT NULL,
  state JSONB NOT NULL DEFAULT '{}',
  last_evaluated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(case_id, pack_id, controller_name)
);

-- Budget tracking (per-case and per-organization cost monitoring)
CREATE TABLE IF NOT EXISTS budget_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  input_tokens BIGINT DEFAULT 0,
  output_tokens BIGINT DEFAULT 0,
  monetary_cost_usd NUMERIC(10,4) DEFAULT 0,
  attempt_count INTEGER DEFAULT 0,
  budget_limit_usd NUMERIC(10,4),
  alert_threshold_pct INTEGER DEFAULT 75,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_tracking_org ON budget_tracking(organization_id);
CREATE INDEX IF NOT EXISTS idx_budget_tracking_case ON budget_tracking(case_id);
CREATE INDEX IF NOT EXISTS idx_budget_tracking_period ON budget_tracking(period_start, period_end);

-- Governance overrides (audit trail for every human override of AI/policy)
CREATE TABLE IF NOT EXISTS governance_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  original_recommendation TEXT,
  actual_decision TEXT NOT NULL,
  justification TEXT NOT NULL,
  override_type TEXT NOT NULL DEFAULT 'policy', -- 'policy', 'ai_recommendation', 'autonomy', 'budget'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_governance_overrides_case ON governance_overrides(case_id);
CREATE INDEX IF NOT EXISTS idx_governance_overrides_actor ON governance_overrides(actor_id);
CREATE INDEX IF NOT EXISTS idx_governance_overrides_org ON governance_overrides(organization_id);

-- Action authority matrix (configurable per organization)
-- Stored in organizations.settings as 'action_authority_matrix' JSONB key
-- Example: { "move.activate.high_risk": ["org_admin", "case_owner"],
--            "decision.resolve": ["listed_authority"],
--            "budget.exceed_threshold": ["org_billing", "org_owner"] }
-- No table needed — uses existing organizations.settings column.
