-- Fix: Integration schema corrections discovered during audit
-- 1. ON DELETE CASCADE for external_events.integration_id (prevents FK violation on integration delete)
-- 2. FK reference for process_event_id → events(id) (enforces referential integrity)
-- 3. Widen confidence column (NUMERIC(3,2) can't hold threshold values like 1.1)
-- 4. Add updated_at column to integrations
-- 5. Add performance indexes for ORDER BY created_at queries

-- ── Fix external_events.integration_id CASCADE ────────────────────────
ALTER TABLE external_events
  DROP CONSTRAINT IF EXISTS external_events_integration_id_fkey;
ALTER TABLE external_events
  ADD CONSTRAINT external_events_integration_id_fkey
  FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE;

-- ── Add FK for process_event_id ───────────────────────────────────────
-- Using SET NULL on delete: if the process event is removed, keep the external event record
ALTER TABLE external_events
  ADD CONSTRAINT external_events_process_event_id_fkey
  FOREIGN KEY (process_event_id) REFERENCES events(id) ON DELETE SET NULL;

-- ── Widen confidence column ───────────────────────────────────────────
ALTER TABLE external_events
  ALTER COLUMN confidence TYPE NUMERIC(4,3);

-- ── Add updated_at to integrations ────────────────────────────────────
ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ── Performance indexes ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_external_events_created_at
  ON external_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_events_status_created
  ON external_events(status, created_at DESC);
