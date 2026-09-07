#!/usr/bin/env node
/**
 * Device pairing flow (spec section 8) — the plugin side of pairing a
 * Claude Code install with a Process OS account:
 *
 * 1. Generate (or reuse) a device id.
 * 2. `POST /edge/v1/pair` to register it and receive a 6-character code.
 * 3. Print the code + pairing URL for the user to open in a browser.
 * 4. Poll `GET /edge/v1/pair/status?code=XXX` until the web UI confirms it.
 * 5. Store the resulting device identity in local SQLite (`DeviceStore`).
 *
 * Invoked by the `connect` skill: `node plugin/claude-code/dist/pairing/flow.js`.
 */
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { httpClient, HttpClientError } from '../mcp/http-client.js';
import { DeviceStore } from '../storage/device.js';

const require = createRequire(import.meta.url);

// Mirrors the server-side pairing code TTL (spec section 8.2) — used as the
// default polling deadline so the plugin gives up around the same time the
// code itself expires, rather than polling forever.
const PAIRING_TTL_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PairResponse {
  code: string;
  device_id: string;
  expires_at: string;
}

type PairStatusResponse =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'confirmed'; device_id: string; auth_token: string; user_id: string };

export interface PairInitiateResult {
  code: string;
  deviceId: string;
  expiresAt: string;
  pairingUrl: string;
}

export interface PairingConfirmed {
  deviceId: string;
  userId: string;
  organizationId: string | null;
  authToken: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function controlPlaneUrl(): string {
  return (process.env['CONTROL_PLANE_URL'] ?? 'http://localhost:4000').replace(/\/+$/, '');
}

function pluginVersion(): string {
  try {
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decode a JWT's payload without verifying its signature. Only used to read
 * non-security-critical claims (here: `organization_id`) for local
 * bookkeeping — the token itself, not this decoded copy, is what's sent on
 * every subsequent request, so a tampered payload can't grant anything.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const segment = token.split('.')[1];
    if (!segment) return {};
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Flow steps
// ---------------------------------------------------------------------------

/** Step 1-2: register this device with the control plane and get a pairing code. */
export async function initiatePairing(): Promise<PairInitiateResult> {
  const deviceId = new DeviceStore().get()?.id ?? randomUUID();
  const deviceInfo = {
    name: hostname(),
    plugin_version: pluginVersion(),
  };

  const res = await httpClient.post<PairResponse>('/edge/v1/pair', {
    device_id: deviceId,
    device_info: deviceInfo,
  });

  return {
    code: res.code,
    deviceId: res.device_id,
    expiresAt: res.expires_at,
    pairingUrl: `${controlPlaneUrl()}/pair`,
  };
}

/** Step 4: poll pairing status until confirmed, expired, or timed out. */
export async function pollPairingStatus(
  code: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<PairingConfirmed> {
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? PAIRING_TTL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = await httpClient.get<PairStatusResponse>(
      `/edge/v1/pair/status?code=${encodeURIComponent(code)}`,
    );

    if (status.status === 'confirmed') {
      const claims = decodeJwtPayload(status.auth_token);
      const organizationId = typeof claims['organization_id'] === 'string' ? claims['organization_id'] : null;
      return {
        deviceId: status.device_id,
        userId: status.user_id,
        organizationId,
        authToken: status.auth_token,
      };
    }

    if (status.status === 'expired' || status.status === 'not_found') {
      throw new Error(
        `Pairing code ${code} is ${status.status.replace('_', ' ')}. Run /connect again for a new code.`,
      );
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Pairing code ${code} was not confirmed within ${Math.round(timeoutMs / 1000)}s. Run /connect again.`,
  );
}

/** Step 5: persist the confirmed device identity locally. */
function saveDeviceIdentity(deviceId: string, confirmed: PairingConfirmed): void {
  new DeviceStore().save({
    id: confirmed.deviceId || deviceId,
    user_id: confirmed.userId,
    organization_id: confirmed.organizationId,
    paired_at: new Date().toISOString(),
    control_plane_url: controlPlaneUrl(),
    auth_token: confirmed.authToken,
  });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full pairing flow end to end. Safe to call repeatedly — if this
 * device is already paired it exits immediately without generating a new
 * code (spec section 8.1, step 8: "future sessions auto-connect").
 */
export async function runPairingFlow(): Promise<void> {
  const existing = new DeviceStore().get();
  if (existing?.user_id) {
    console.log(`[Process OS] Already paired as device ${existing.id} (user ${existing.user_id}).`);
    return;
  }

  const { code, deviceId, expiresAt, pairingUrl } = await initiatePairing();

  console.log('[Process OS] Device pairing code:', code);
  console.log(`[Process OS] Open ${pairingUrl}, sign in, and enter this code.`);
  console.log(`[Process OS] Code expires at ${expiresAt}. Waiting for confirmation...`);

  const confirmed = await pollPairingStatus(code);
  saveDeviceIdentity(deviceId, confirmed);

  console.log(`[Process OS] Paired successfully as user ${confirmed.userId}.`);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPairingFlow().catch((err) => {
    console.error('[Process OS] Pairing failed:', err instanceof HttpClientError ? err.message : err);
    process.exit(1);
  });
}
