-- 003_edge_devices.sql — Device registry, pairing, edge connections

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT,
  claude_version TEXT,
  plugin_version TEXT,
  capabilities JSONB DEFAULT '[]',
  last_seen_at TIMESTAMPTZ,
  auth_token_hash TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_org ON devices(organization_id);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  device_id UUID NOT NULL,
  device_info JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edge_connections (
  device_id UUID PRIMARY KEY REFERENCES devices(id),
  connected_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  active_sessions JSONB DEFAULT '[]',
  last_event_ack BIGINT DEFAULT 0
);
