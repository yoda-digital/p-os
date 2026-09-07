import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type postgres from 'postgres';
import * as jose from 'jose';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { ContextOrchestrator } from '@pos/context';
import { authMiddleware, getUser } from '../middleware/auth.js';
import { CommandProcessor } from '../services/command-processor.js';

type Sql = ReturnType<typeof postgres>;

const JWT_SECRET = new TextEncoder().encode(
  process.env['JWT_SECRET'] ?? 'pos-dev-secret-change-in-production'
);

// 6-char alphanumeric, excluding easily-confused characters (I, O, 0, 1)
const PAIRING_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEVICE_TOKEN_TTL = '30d';
const POLICY_MIRROR_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface DeviceTokenPayload {
  device_id: string;
  user_id: string;
  organization_id: string;
  type: 'device';
}

// ── Device token helpers ─────────────────────────────────────────
// A device auth token is a distinct JWT from the user auth token
// (signJwt/authenticateRequest in middleware/auth.ts): longer-lived
// (30 days) and scoped to a paired device rather than a logged-in user.

async function signDeviceToken(payload: DeviceTokenPayload): Promise<string> {
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(DEVICE_TOKEN_TTL)
    .sign(JWT_SECRET);
}

async function verifyDeviceToken(token: string): Promise<DeviceTokenPayload> {
  const { payload } = await jose.jwtVerify(token, JWT_SECRET);
  if (payload['type'] !== 'device') {
    throw new Error('Not a device token');
  }
  return {
    device_id: payload['device_id'] as string,
    user_id: payload['user_id'] as string,
    organization_id: payload['organization_id'] as string,
    type: 'device',
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generatePairingCode(): string {
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += PAIRING_CODE_CHARS[bytes[i]! % PAIRING_CODE_CHARS.length];
  }
  return code;
}

/** Authenticates a device by its own long-lived device token (separate from user JWTs). */
function deviceAuth(sql: Sql) {
  return createMiddleware(async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing device auth token', error_key: 'edge.missing_token' }, 401);
    }

    const token = header.slice(7);
    let payload: DeviceTokenPayload;
    try {
      payload = await verifyDeviceToken(token);
    } catch {
      return c.json({ error: 'Invalid or expired device token', error_key: 'edge.invalid_token' }, 401);
    }

    const [device] = await sql`
      SELECT id, status, auth_token_hash FROM devices WHERE id = ${payload.device_id}
    `;
    if (!device || device.status !== 'active') {
      return c.json({ error: 'Device not found or inactive', error_key: 'edge.device_inactive' }, 401);
    }
    if (device.auth_token_hash && device.auth_token_hash !== hashToken(token)) {
      return c.json({ error: 'Device token has been revoked', error_key: 'edge.token_revoked' }, 401);
    }

    c.set('device', payload);
    await sql`UPDATE devices SET last_seen_at = NOW() WHERE id = ${payload.device_id}`;
    await next();
  });
}

function getDevice(c: { get: (key: 'device') => unknown }): DeviceTokenPayload {
  return c.get('device') as DeviceTokenPayload;
}

export function edgeRoutes(sql: Sql) {
  const app = new Hono();
  const processor = new CommandProcessor(sql);
  const contextOrchestrator = new ContextOrchestrator(sql);

  // ── Pairing ──────────────────────────────────────────────────

  // POST /pair — device initiates pairing (no auth required)
  app.post('/pair', async (c) => {
    const body = await c.req
      .json<{ device_id?: string; device_info?: Record<string, unknown> }>()
      .catch(() => ({}) as { device_id?: string; device_info?: Record<string, unknown> });

    const deviceId = body.device_id ?? crypto.randomUUID();
    const deviceInfo = body.device_info ?? {};
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

    let code = '';
    let inserted = false;
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      code = generatePairingCode();
      try {
        await sql`
          INSERT INTO pairing_codes (code, device_id, device_info, status, expires_at)
          VALUES (${code}, ${deviceId}, ${sql.json(deviceInfo as any)}, 'pending', ${expiresAt.toISOString()})
        `;
        inserted = true;
      } catch (err: unknown) {
        // Unique violation on the code PK — regenerate and retry
        if ((err as { code?: string })?.code !== '23505') throw err;
      }
    }
    if (!inserted) {
      return c.json({ error: 'Failed to generate a unique pairing code, please retry' }, 500);
    }

    return c.json({ code, device_id: deviceId, expires_at: expiresAt.toISOString() }, 201);
  });

  // GET /pair/status?code=XXX — device polls for pairing confirmation (no auth required)
  app.get('/pair/status', async (c) => {
    const codeParam = c.req.query('code');
    if (!codeParam) return c.json({ error: 'code query param is required' }, 400);
    const code = codeParam.toUpperCase();

    const [row] = await sql`SELECT * FROM pairing_codes WHERE code = ${code}`;
    if (!row) return c.json({ status: 'not_found' }, 404);

    if (row.status === 'pending' && new Date(row.expires_at as string) < new Date()) {
      await sql`UPDATE pairing_codes SET status = 'expired' WHERE code = ${code}`;
      return c.json({ status: 'expired' });
    }

    if (row.status === 'pending') {
      return c.json({ status: 'pending' });
    }

    if (row.status === 'confirmed') {
      const info = (row.device_info as Record<string, unknown>) ?? {};
      const authToken = (info['_pending_token'] as string | undefined) ?? null;
      // One-time delivery of the device token — clear it once the device claims it
      await sql`
        UPDATE pairing_codes SET status = 'claimed', device_info = device_info - '_pending_token'
        WHERE code = ${code}
      `;
      return c.json({
        status: 'confirmed',
        device_id: row.device_id,
        auth_token: authToken,
        user_id: row.confirmed_by,
      });
    }

    return c.json({ status: row.status });
  });

  // POST /pair/confirm — authenticated user confirms a pairing code from the web UI
  app.post('/pair/confirm', authMiddleware, async (c) => {
    const user = getUser(c);
    const body = await c.req.json<{ code?: string; name?: string }>();
    if (!body.code) return c.json({ error: 'code is required' }, 400);

    const code = body.code.toUpperCase();
    const [row] = await sql`SELECT * FROM pairing_codes WHERE code = ${code}`;
    if (!row) {
      return c.json({ error: 'Pairing code not found', error_key: 'edge.code_not_found' }, 404);
    }
    if (row.status !== 'pending') {
      return c.json({ error: `Pairing code already ${row.status}`, error_key: 'edge.code_not_pending' }, 400);
    }
    if (new Date(row.expires_at as string) < new Date()) {
      await sql`UPDATE pairing_codes SET status = 'expired' WHERE code = ${code}`;
      return c.json({ error: 'Pairing code expired', error_key: 'edge.code_expired' }, 400);
    }

    const deviceId = row.device_id as string;
    const deviceInfo = (row.device_info as Record<string, unknown>) ?? {};

    const authToken = await signDeviceToken({
      device_id: deviceId,
      user_id: user.user_id,
      organization_id: user.organization_id,
      type: 'device',
    });
    const tokenHash = hashToken(authToken);

    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO devices (id, user_id, organization_id, name, claude_version, plugin_version, capabilities, last_seen_at, auth_token_hash, status)
        VALUES (
          ${deviceId}, ${user.user_id}, ${user.organization_id},
          ${body.name ?? (deviceInfo['name'] as string) ?? 'Unnamed device'},
          ${(deviceInfo['claude_version'] as string) ?? null},
          ${(deviceInfo['plugin_version'] as string) ?? null},
          ${sql.json((deviceInfo['capabilities'] as any) ?? [])},
          NOW(), ${tokenHash}, 'active'
        )
        ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          organization_id = EXCLUDED.organization_id,
          auth_token_hash = EXCLUDED.auth_token_hash,
          status = 'active',
          last_seen_at = NOW()
      `;
      await tx`
        UPDATE pairing_codes SET
          status = 'confirmed',
          confirmed_by = ${user.user_id},
          confirmed_at = NOW(),
          device_info = device_info || ${sql.json({ _pending_token: authToken } as any)}
        WHERE code = ${code}
      `;
    });

    return c.json(
      {
        device_id: deviceId,
        auth_token: authToken,
        user_id: user.user_id,
        organization_id: user.organization_id,
      },
      201
    );
  });

  // ── Event ingestion ──────────────────────────────────────────

  // POST /events — receive a batch of hook/outbox events from a paired device
  app.post('/events', deviceAuth(sql), async (c) => {
    const device = getDevice(c);
    const body = await c.req.json<{
      events?: Array<{ type: string; payload?: Record<string, unknown>; timestamp?: string }>;
    }>();
    const events = Array.isArray(body.events) ? body.events : [];

    const results: Array<{ status: string; reason?: string; data?: Record<string, unknown> }> = [];

    for (const evt of events) {
      if (!evt?.type) {
        results.push({ status: 'rejected', reason: 'Missing event type' });
        continue;
      }
      const payload = evt.payload ?? {};
      try {
        const result = await processor.process({
          command_id: crypto.randomUUID(),
          type: evt.type,
          tenant_id: device.organization_id,
          case_id: payload['case_id'] as string | undefined,
          actor_id: device.user_id,
          target_ref: payload['target_ref'] as { id: string; type: string } | undefined,
          issued_at: evt.timestamp ?? new Date().toISOString(),
          payload,
        });
        results.push({ status: result.status, reason: result.reason, data: result.data });
      } catch (err: unknown) {
        results.push({ status: 'rejected', reason: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    return c.json({ received: events.length, accepted: results.filter((r) => r.status === 'accepted').length, results });
  });

  // ── Context Capsule ──────────────────────────────────────────

  // GET /context/:caseId — Context Capsule for a case (case + moves + recent events + generated capsule)
  app.get('/context/:caseId', deviceAuth(sql), async (c) => {
    const device = getDevice(c);
    const caseId = c.req.param('caseId');

    const [caseRow] = await sql`SELECT * FROM cases WHERE id = ${caseId}`;
    if (!caseRow) return c.json({ error: 'Case not found' }, 404);
    if (caseRow.organization_id !== device.organization_id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const moves = await sql`SELECT * FROM moves WHERE case_id = ${caseId} ORDER BY created_at DESC`;
    const recentEvents = await sql`
      SELECT id, type, actor_id, occurred_at, data, case_sequence
      FROM events WHERE case_id = ${caseId}
      ORDER BY case_sequence DESC LIMIT 50
    `;

    let capsule = null;
    try {
      capsule = await contextOrchestrator.generateCapsule(caseId);
    } catch (err) {
      console.error('[Edge] Failed to generate context capsule:', err);
    }

    return c.json({ case: caseRow, moves, recent_events: recentEvents, capsule });
  });

  // ── Policy mirror ────────────────────────────────────────────

  // GET /policies — active policies for the device's org, for offline local enforcement
  app.get('/policies', deviceAuth(sql), async (c) => {
    const device = getDevice(c);

    const policies = await sql`
      SELECT * FROM policies
      WHERE active = true
        AND (organization_id = ${device.organization_id} OR organization_id IS NULL OR scope = 'system')
      ORDER BY priority DESC, name ASC
    `;

    const fetchedAt = new Date();
    const expiresAt = new Date(fetchedAt.getTime() + POLICY_MIRROR_TTL_MS);
    const version = policies.reduce(
      (max: number, p: any) => Math.max(max, new Date(p.updated_at as string).getTime()),
      0
    );
    const signature = createHmac('sha256', JWT_SECRET)
      .update(JSON.stringify(policies) + fetchedAt.toISOString())
      .digest('hex');

    return c.json({
      policies,
      version,
      fetched_at: fetchedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      signature,
    });
  });

  return app;
}
