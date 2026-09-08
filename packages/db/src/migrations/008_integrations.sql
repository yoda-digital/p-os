-- SP6: Integrations + Executors + Mobile
-- External integrations, webhook endpoints, executor registry, push subscriptions, notifications

-- ── Integration configs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  type TEXT NOT NULL, -- github, email, calendar, slack, ci, webhook
  name TEXT NOT NULL,
  credentials_encrypted TEXT,
  settings JSONB DEFAULT '{}',
  event_mappings JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrations_org ON integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_integrations_type ON integrations(type);

-- ── Webhook endpoints (inbound) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  secret TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  last_received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_integration ON webhook_endpoints(integration_id);

-- ── External events (inbound, interpretation pipeline) ──────────────
CREATE TABLE IF NOT EXISTS external_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES integrations(id),
  raw_payload JSONB NOT NULL,
  interpreted_as JSONB,
  confidence NUMERIC(3,2),
  status TEXT DEFAULT 'pending', -- pending, accepted, rejected, review
  reviewed_by UUID REFERENCES users(id),
  process_event_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_events_integration ON external_events(integration_id);
CREATE INDEX IF NOT EXISTS idx_external_events_status ON external_events(status);

-- ── Executor registry ───────────────────────────────────────────────
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

CREATE INDEX IF NOT EXISTS idx_executor_registry_org ON executor_registry(organization_id);
CREATE INDEX IF NOT EXISTS idx_executor_registry_type ON executor_registry(type);

-- ── Push subscriptions (mobile/PWA) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL,
  keys JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

-- ── Notification preferences ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  attention_critical BOOLEAN DEFAULT true,
  attention_high BOOLEAN DEFAULT true,
  attention_medium BOOLEAN DEFAULT false,
  decisions BOOLEAN DEFAULT true,
  steering_updates BOOLEAN DEFAULT false,
  digest_frequency TEXT DEFAULT 'daily' -- realtime, hourly, daily, weekly, off
);
