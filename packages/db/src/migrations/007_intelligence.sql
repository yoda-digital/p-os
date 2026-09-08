-- SP5: Intelligence + Search + Simulation
-- Process insights (architect + guardian + drift)
CREATE TABLE IF NOT EXISTS process_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id),
  type TEXT NOT NULL,
  source TEXT NOT NULL, -- 'architect' | 'guardian' | 'drift'
  recommendation TEXT NOT NULL,
  confidence NUMERIC(3,2),
  affected_move_ids UUID[] DEFAULT '{}',
  estimated_impact TEXT,
  status TEXT DEFAULT 'open', -- open, accepted, rejected, superseded
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_process_insights_case ON process_insights(case_id);
CREATE INDEX IF NOT EXISTS idx_process_insights_status ON process_insights(status);

-- Simulation events (separate from canonical events — isolation guarantee)
CREATE TABLE IF NOT EXISTS simulation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id UUID NOT NULL REFERENCES simulation_forks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  sequence INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simulation_events_sim ON simulation_events(simulation_id);

-- Add status column to simulation_forks if not present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulation_forks' AND column_name = 'status'
  ) THEN
    ALTER TABLE simulation_forks ADD COLUMN status TEXT DEFAULT 'active';
  END IF;
END $$;

-- Add adopted_at column to simulation_forks if not present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulation_forks' AND column_name = 'adopted_at'
  ) THEN
    ALTER TABLE simulation_forks ADD COLUMN adopted_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add resolved_at to projection_attention for attention time metric
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projection_attention' AND column_name = 'resolved_at'
  ) THEN
    ALTER TABLE projection_attention ADD COLUMN resolved_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add deadline to moves for deadline risk detection
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'moves' AND column_name = 'deadline'
  ) THEN
    ALTER TABLE moves ADD COLUMN deadline TIMESTAMPTZ;
  END IF;
END $$;
