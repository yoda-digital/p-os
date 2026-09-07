/**
 * SessionEnd hook handler (spec section 4.8).
 *
 * When a Claude session ends:
 * 1. Update session binding status to "ended"
 * 2. Emit SessionEnded to outbox (for async flush by edge)
 * 3. Clean up stop-block counter
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore } from '../storage/sessions.js';
import { OutboxStore } from '../storage/outbox.js';
import { getLocalDb } from '../storage/db.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleSessionEnd(input: HookInput): Promise<HookResult> {
  const deviceStore = new DeviceStore();
  if (!deviceStore.isPaired()) return {};

  const sessionId = extractSessionId(input);
  if (!sessionId) return {};

  const sessionStore = new SessionStore();
  const binding = sessionStore.get(sessionId);

  // ── Mark session ended ──────────────────────────────────────────────────
  if (binding) {
    sessionStore.updateStatus(sessionId, 'ended');
  }

  // ── Emit session-end event to outbox ────────────────────────────────────
  const outbox = new OutboxStore();
  outbox.enqueue('SessionEnded', {
    sessionId,
    caseId: binding?.case_id ?? null,
    moveId: binding?.move_id ?? null,
    attemptId: binding?.attempt_id ?? null,
  });

  // ── Clean up stop-block counter ─────────────────────────────────────────
  const db = getLocalDb();
  db.prepare('DELETE FROM stop_blocks WHERE session_id = ?').run(sessionId);

  return {};
}
