-- Edge commands table for dispatching execution commands to devices
-- This is the bridge between the API (which queues commands) and the
-- realtime server (which polls and pushes them to connected edge devices)

CREATE TABLE IF NOT EXISTS edge_commands (
  id             TEXT PRIMARY KEY,
  device_id      TEXT NOT NULL REFERENCES devices(id),
  type           TEXT NOT NULL,                    -- 'start_move', 'stop'
  payload        JSONB NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending, delivered, acked, failed
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at   TIMESTAMPTZ,
  acked_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_edge_commands_pending
  ON edge_commands (status, device_id)
  WHERE status = 'pending';
