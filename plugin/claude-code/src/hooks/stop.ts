/**
 * Stop hook handler (spec section 4.7).
 *
 * Before Claude stops:
 * 1. Fast exit if not paired / not bound
 * 2. Check consecutive block count (max 8 — never block forever)
 * 3. If bound to a Move with a completion policy → check for missing evidence
 * 4. Block stop with a reason, or allow it
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore } from '../storage/sessions.js';
import { OutboxStore } from '../storage/outbox.js';
import { PolicyMirrorStore } from '../storage/policy-mirror.js';
import { getLocalDb } from '../storage/db.js';

/** Claude caps consecutive stop-blocks at this limit to prevent infinite loops. */
const MAX_CONSECUTIVE_BLOCKS = 8;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleStop(input: HookInput): Promise<HookResult> {
  const deviceStore = new DeviceStore();
  if (!deviceStore.isPaired()) return {};

  const sessionId = extractSessionId(input);
  if (!sessionId) return {};

  const sessionStore = new SessionStore();
  const binding = sessionStore.get(sessionId);
  if (!binding?.case_id) return {};

  // Only enforce when there's an active Attempt
  if (!binding.attempt_id) return {};

  // ── Guard: max consecutive blocks ──────────────────────────────────────
  const db = getLocalDb();
  const blockRow = db
    .prepare<[string], { consecutive_count: number }>(
      'SELECT consecutive_count FROM stop_blocks WHERE session_id = ?',
    )
    .get(sessionId);

  const consecutiveBlocks = blockRow?.consecutive_count ?? 0;
  if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
    // Reset and allow — safety valve
    db.prepare('DELETE FROM stop_blocks WHERE session_id = ?').run(sessionId);
    return {};
  }

  // ── Check completion policy ─────────────────────────────────────────────
  const policyStore = new PolicyMirrorStore();
  const policies = policyStore.getActive();

  for (const policy of policies) {
    try {
      const data = JSON.parse(policy.policy_data) as Record<string, unknown>;
      if (data['type'] !== 'completion') continue;
      if (data['caseId'] !== binding.case_id && data['moveId'] !== binding.move_id) continue;

      const requiredEvidence = data['requiredEvidence'];
      if (!Array.isArray(requiredEvidence) || requiredEvidence.length === 0) continue;

      // Scan outbox for evidence
      const outbox = new OutboxStore();
      const pending = outbox.getPending();
      const seen = new Set<string>();

      for (const event of pending) {
        try {
          const payload = JSON.parse(event.payload) as Record<string, unknown>;
          if (typeof payload['evidenceType'] === 'string') seen.add(payload['evidenceType']);
          if (typeof payload['type'] === 'string') seen.add(payload['type']);
          seen.add(event.event_type);
        } catch {
          /* skip */
        }
      }

      const missing = (requiredEvidence as string[]).filter((r) => !seen.has(r));
      if (missing.length > 0) {
        // Increment block counter
        db.prepare(
          `INSERT INTO stop_blocks (session_id, consecutive_count, last_blocked_at)
           VALUES (?, 1, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             consecutive_count = consecutive_count + 1,
             last_blocked_at = excluded.last_blocked_at`,
        ).run(sessionId, new Date().toISOString());

        return {
          blocked: true,
          message: `[Process OS] Missing evidence before stop: ${missing.join(', ')}. Consider running verification before completing.`,
        };
      }
    } catch {
      /* skip unreadable policy */
    }
  }

  // ── Allow stop — reset block counter ────────────────────────────────────
  db.prepare('DELETE FROM stop_blocks WHERE session_id = ?').run(sessionId);
  return {};
}
