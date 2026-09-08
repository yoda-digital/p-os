-- Evidence staleness tracking
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS fresh_until TIMESTAMPTZ;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS artifact_ref JSONB;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS source_ref JSONB;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS provenance JSONB DEFAULT '{}';
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ;

-- Completion contracts on moves
ALTER TABLE moves ADD COLUMN IF NOT EXISTS completion_contract JSONB;

-- Steering instruction versions
CREATE TABLE IF NOT EXISTS attempt_instruction_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES attempts(id),
  version INTEGER NOT NULL,
  instructions TEXT NOT NULL,
  steering_id UUID REFERENCES steering_commands(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attempt_versions ON attempt_instruction_versions(attempt_id, version);

-- Context checkpoints (for compact recovery)
CREATE TABLE IF NOT EXISTS context_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  case_id UUID NOT NULL REFERENCES cases(id),
  checkpoint_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_context_checkpoints ON context_checkpoints(session_id, created_at DESC);
