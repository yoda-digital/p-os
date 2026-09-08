/**
 * Generic Inbound Webhook Routes (SP6 §1.4)
 *
 * POST /webhooks/:hookId — receive external events and feed into interpretation pipeline
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type postgres from 'postgres';
import { ExternalPipeline, type RawExternalEvent } from '../services/external-pipeline.js';
import { GitHubIntegration } from '../integrations/github.js';
import { SlackIntegration } from '../integrations/slack.js';

type Sql = ReturnType<typeof postgres>;

export function webhookRoutes(sql: Sql) {
  const app = new Hono();
  const pipeline = new ExternalPipeline(sql);
  const github = new GitHubIntegration(sql);
  const slack = new SlackIntegration(sql);

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

    // 2. Parse the payload (need raw body for HMAC verification)
    let payload: Record<string, unknown>;
    let rawBody: string;
    try {
      rawBody = await c.req.text();
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    // 3. Handle Slack url_verification BEFORE secret check
    // Slack sends url_verification without the webhook secret
    if (endpoint.integration_type === 'slack' && payload.type === 'url_verification') {
      return c.json({ challenge: payload.challenge });
    }

    // 4. Verify webhook secret (via query param, header, or GitHub HMAC)
    const querySecret = c.req.query('secret');
    const headerSecret = c.req.header('x-webhook-secret');
    const githubSignature = c.req.header('x-hub-signature-256');

    let authenticated = false;
    if (querySecret === endpoint.secret || headerSecret === endpoint.secret) {
      authenticated = true;
    } else if (githubSignature && endpoint.integration_type === 'github') {
      authenticated = verifyGitHubSignature(rawBody, endpoint.secret as string, githubSignature);
    }

    if (!authenticated) {
      return c.json({ error: 'Invalid webhook secret' }, 401);
    }

    // 5. Determine event type from headers or payload
    const eventType = detectEventType(c, endpoint.integration_type as string, payload);

    // 6. Update last received timestamp
    await sql`
      UPDATE webhook_endpoints SET last_received_at = NOW() WHERE id = ${hookId}
    `;

    // 7. Handle Slack slash commands directly (they need an immediate response)
    if (endpoint.integration_type === 'slack' && eventType === 'slash_command') {
      // Slack sends slash commands as form-encoded but we've already parsed as JSON
      // In production, Slack slash commands come as application/x-www-form-urlencoded
      const response = await slack.handleSlashCommand(
        endpoint.integration_id as string,
        payload as unknown as Parameters<typeof slack.handleSlashCommand>[1],
      );
      return c.json(response);
    }

    // 8. Feed into the external interpretation pipeline
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
    // Check if it's a slash command (has 'command' field)
    if (payload.command) return 'slash_command';
    const eventType = (payload.event as Record<string, unknown>)?.type;
    return eventType ? String(eventType) : 'unknown';
  }

  // Default: use payload.type or 'unknown'
  return (payload.type as string) ?? (payload.event_type as string) ?? 'unknown';
}

/**
 * Verify GitHub webhook HMAC-SHA256 signature.
 * GitHub sends X-Hub-Signature-256: sha256=<hex_digest>
 */
function verifyGitHubSignature(
  rawBody: string,
  secret: string,
  signatureHeader: string,
): boolean {
  if (!signatureHeader.startsWith('sha256=')) return false;

  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

  // Constant-time comparison to prevent timing attacks
  if (expected.length !== signatureHeader.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}
