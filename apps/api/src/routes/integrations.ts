/**
 * Integration Configuration Routes (SP6 §1.4)
 *
 * CRUD for integration configs + webhook endpoint management.
 * Also: event review and external event listing.
 */

import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { ExternalPipeline } from '../services/external-pipeline.js';

type Sql = ReturnType<typeof postgres>;

export function integrationRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  const pipeline = new ExternalPipeline(sql);

  // ── GET /integrations — List org integrations ─────────────────
  app.get('/', async (c) => {
    const user = getUser(c);
    const orgId = user.organization_id;

    const integrations = await sql`
      SELECT id, organization_id, type, name, settings, event_mappings,
             active, last_sync_at, created_by, created_at
      FROM integrations
      WHERE organization_id = ${orgId}
      ORDER BY created_at DESC
    `;

    return c.json(integrations);
  });

  // ── POST /integrations — Create integration ───────────────────
  app.post('/', async (c) => {
    const user = getUser(c);
    const body = await c.req.json();

    const { type, name, settings, event_mappings } = body;
    if (!type || !name) {
      return c.json({ error: 'type and name are required' }, 400);
    }

    const validTypes = ['github', 'email', 'calendar', 'slack', 'ci', 'webhook'];
    if (!validTypes.includes(type)) {
      return c.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, 400);
    }

    const [integration] = await sql`
      INSERT INTO integrations (organization_id, type, name, settings, event_mappings, created_by)
      VALUES (${user.organization_id}, ${type}, ${name},
              ${sql.json((settings ?? {}) as any)}, ${sql.json((event_mappings ?? []) as any)},
              ${user.user_id})
      RETURNING *
    `;

    if (!integration) return c.json({ error: 'Failed to create integration' }, 500);

    // Auto-create a webhook endpoint for webhook-type integrations
    if (type === 'webhook' || type === 'github' || type === 'slack') {
      const secret = crypto.randomUUID().replace(/-/g, '');
      const [endpoint] = await sql`
        INSERT INTO webhook_endpoints (integration_id, secret)
        VALUES (${integration.id}, ${secret})
        RETURNING id, secret
      `;
      if (endpoint) {
        return c.json({
          ...integration,
          webhook_endpoint: {
            id: endpoint.id,
            secret: endpoint.secret,
            url: `/api/v1/webhooks/${endpoint.id}`,
          },
        }, 201);
      }
    }

    return c.json(integration, 201);
  });

  // ── GET /integrations/:id — Get single integration ────────────
  app.get('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');

    const [integration] = await sql`
      SELECT id, organization_id, type, name, settings, event_mappings,
             active, last_sync_at, created_by, created_at
      FROM integrations
      WHERE id = ${id} AND organization_id = ${user.organization_id}
    `;

    if (!integration) return c.json({ error: 'Integration not found' }, 404);

    // Include webhook endpoints
    const endpoints = await sql`
      SELECT id, active, last_received_at, created_at
      FROM webhook_endpoints
      WHERE integration_id = ${id}
    `;

    return c.json({ ...integration, webhook_endpoints: endpoints });
  });

  // ── PATCH /integrations/:id — Update integration ──────────────
  app.patch('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const body = await c.req.json();

    const [existing] = await sql`
      SELECT id FROM integrations WHERE id = ${id} AND organization_id = ${user.organization_id}
    `;
    if (!existing) return c.json({ error: 'Integration not found' }, 404);

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.settings !== undefined) updates.settings = sql.json(body.settings as any);
    if (body.event_mappings !== undefined) updates.event_mappings = sql.json(body.event_mappings as any);
    if (body.active !== undefined) updates.active = body.active;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'No valid fields to update' }, 400);
    }

    // Build dynamic update
    const setClauses = Object.entries(updates)
      .map(([k, _v]) => `${k} = $${k}`)
      .join(', ');

    const [updated] = await sql`
      UPDATE integrations
      SET ${sql(updates as Record<string, unknown>, ...Object.keys(updates))}
      WHERE id = ${id}
      RETURNING *
    `;

    return c.json(updated);
  });

  // ── DELETE /integrations/:id — Remove integration ─────────────
  app.delete('/:id', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');

    const [existing] = await sql`
      SELECT id FROM integrations WHERE id = ${id} AND organization_id = ${user.organization_id}
    `;
    if (!existing) return c.json({ error: 'Integration not found' }, 404);

    await sql`DELETE FROM integrations WHERE id = ${id}`;
    return c.json({ status: 'deleted' });
  });

  // ── POST /integrations/:id/test — Test connection ─────────────
  app.post('/:id/test', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');

    const [integration] = await sql`
      SELECT * FROM integrations WHERE id = ${id} AND organization_id = ${user.organization_id}
    `;
    if (!integration) return c.json({ error: 'Integration not found' }, 404);

    // Test connection based on type
    const result = await testIntegrationConnection(integration);
    return c.json(result);
  });

  // ── GET /integrations/:id/events — Recent events ──────────────
  app.get('/:id/events', async (c) => {
    const user = getUser(c);
    const id = c.req.param('id');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);

    const [integration] = await sql`
      SELECT id FROM integrations WHERE id = ${id} AND organization_id = ${user.organization_id}
    `;
    if (!integration) return c.json({ error: 'Integration not found' }, 404);

    const events = await sql`
      SELECT id, raw_payload, interpreted_as, confidence, status, reviewed_by, process_event_id, created_at
      FROM external_events
      WHERE integration_id = ${id}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return c.json(events);
  });

  // ── GET /integrations/review — Pending review items ───────────
  app.get('/review/pending', async (c) => {
    const items = await pipeline.listPendingReview();
    return c.json(items);
  });

  // ── POST /integrations/review/:eventId — Review an event ──────
  app.post('/review/:eventId', async (c) => {
    const user = getUser(c);
    const eventId = c.req.param('eventId');
    const body = await c.req.json();

    const { decision, override_data } = body;
    if (!decision || !['accepted', 'rejected'].includes(decision)) {
      return c.json({ error: 'decision must be "accepted" or "rejected"' }, 400);
    }

    const result = await pipeline.review(eventId, decision, user.user_id, override_data);
    return c.json(result);
  });

  return app;
}

// ── Connection test stubs ───────────────────────────────────────────

async function testIntegrationConnection(
  integration: Record<string, unknown>,
): Promise<{ success: boolean; message: string; latency_ms?: number }> {
  const start = Date.now();

  switch (integration.type) {
    case 'github':
      // In production: test GitHub API with stored OAuth token
      return { success: true, message: 'GitHub connection test: OK (placeholder)', latency_ms: Date.now() - start };

    case 'slack':
      // In production: test Slack API with bot token
      return { success: true, message: 'Slack connection test: OK (placeholder)', latency_ms: Date.now() - start };

    case 'email':
      // In production: test SMTP/IMAP connection
      return { success: true, message: 'Email connection test: OK (placeholder)', latency_ms: Date.now() - start };

    case 'calendar':
      // In production: test Google Calendar / CalDAV API
      return { success: true, message: 'Calendar connection test: OK (placeholder)', latency_ms: Date.now() - start };

    case 'webhook':
      return { success: true, message: 'Webhook endpoint is ready to receive events', latency_ms: 0 };

    default:
      return { success: false, message: `Unknown integration type: ${integration.type}` };
  }
}
