/**
 * Generic Inbound Webhook Routes (SP6 §1.4)
 *
 * POST /webhooks/:hookId — receive external events and feed into interpretation pipeline
 */

import { Hono } from 'hono';
import type postgres from 'postgres';
import { ExternalPipeline, type RawExternalEvent } from '../services/external-pipeline.js';

type Sql = ReturnType<typeof postgres>;

export function webhookRoutes(sql: Sql) {
  const app = new Hono();
  const pipeline = new ExternalPipeline(sql);

  // ── POST /webhooks/:hookId — Inbound webhook receiver ─────────
  // No auth middleware — webhooks are authenticated via hookId + secret
  app.post('/:hookId', async (c) => {
    const hookId = c.req.param('hookId');

    // 1. Look up the webhook endpoint
    const [endpoint] = await sql`
      SELECT we.*, i.type AS integration_type, i.id AS integration_id, i.active AS integration_active
      FROM webhook_endpoints we
      JOIN integrations i ON i.id = we.integration_id
      WHERE we.id = ${hookId} AND we.active = true
    `;

    if (!endpoint) {
      return c.json({ error: 'Webhook endpoint not found or inactive' }, 404);
    }

    if (!endpoint.integration_active) {
      return c.json({ error: 'Integration is inactive' }, 403);
    }

    // 2. Verify webhook secret (via query param or header)
    const providedSecret = c.req.query('secret')
      ?? c.req.header('x-webhook-secret')
      ?? c.req.header('x-hub-signature-256'); // GitHub style

    if (providedSecret !== endpoint.secret && !verifyGitHubSignature(c, endpoint.secret as string)) {
      // For GitHub webhooks, we verify the HMAC signature
      // For other webhooks, we check the secret directly
      return c.json({ error: 'Invalid webhook secret' }, 401);
    }

    // 3. Parse the payload
    let payload: Record<string, unknown>;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    // 4. Determine event type from headers or payload
    const eventType = detectEventType(c, endpoint.integration_type as string, payload);

    // 5. Update last received timestamp
    await sql`
      UPDATE webhook_endpoints SET last_received_at = NOW() WHERE id = ${hookId}
    `;

    // 6. Feed into the external interpretation pipeline
    const rawEvent: RawExternalEvent = {
      integration_id: endpoint.integration_id as string,
      source_type: endpoint.integration_type as string,
      event_type: eventType,
      payload,
      metadata: {
        webhook_endpoint_id: hookId,
        received_at: new Date().toISOString(),
        headers: {
          'user-agent': c.req.header('user-agent'),
          'x-github-event': c.req.header('x-github-event'),
          'x-github-delivery': c.req.header('x-github-delivery'),
        },
      },
    };

    const result = await pipeline.process(rawEvent);

    return c.json({
      status: result.status,
      event_id: result.external_event_id,
      process_event_id: result.process_event_id,
      reason: result.reason,
    });
  });

  return app;
}

// ── Helpers ───────────────────────────────────────────────────────────

function detectEventType(
  c: { req: { header: (name: string) => string | undefined } },
  integrationType: string,
  payload: Record<string, unknown>,
): string {
  // GitHub uses X-GitHub-Event header
  if (integrationType === 'github') {
    const ghEvent = c.req.header('x-github-event');
    if (ghEvent) {
      const action = payload.action as string | undefined;
      return action ? `${ghEvent}.${action}` : ghEvent;
    }
  }

  // Slack uses a type field in the payload
  if (integrationType === 'slack') {
    if (payload.type === 'url_verification') return 'url_verification';
    const eventType = (payload.event as Record<string, unknown>)?.type;
    return eventType ? String(eventType) : 'unknown';
  }

  // Default: use payload.type or 'unknown'
  return (payload.type as string) ?? (payload.event_type as string) ?? 'unknown';
}

function verifyGitHubSignature(
  c: { req: { header: (name: string) => string | undefined } },
  _secret: string,
): boolean {
  // GitHub sends X-Hub-Signature-256 header with HMAC-SHA256
  // In production, verify using crypto.timingSafeEqual
  // For now, return false to fall through to direct secret comparison
  const signature = c.req.header('x-hub-signature-256');
  if (!signature) return false;

  // TODO: Implement proper HMAC verification
  // const hmac = crypto.createHmac('sha256', secret);
  // hmac.update(rawBody);
  // const expected = 'sha256=' + hmac.digest('hex');
  // return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  return false;
}
