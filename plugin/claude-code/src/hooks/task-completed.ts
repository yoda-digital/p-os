/**
 * TaskCompleted hook handler (spec section 4.4).
 *
 * When a Claude task finishes:
 * 1. Fast exit if not paired / session not bound
 * 2. If bound to a Move with an Attempt → check completion policy
 * 3. If required evidence is missing → block completion
 * 4. If satisfied → emit AttemptSucceeded
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore } from '../storage/sessions.js';
import { OutboxStore } from '../storage/outbox.js';
import { PolicyMirrorStore } from '../storage/policy-mirror.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleTaskCompleted(input: HookInput): Promise<HookResult> {
  const deviceStore = new DeviceStore();
  if (!deviceStore.isPaired()) return {};

  const sessionId = extractSessionId(input);
  if (!sessionId) return {};

  const sessionStore = new SessionStore();
  const binding = sessionStore.get(sessionId);
  if (!binding?.case_id) return {};

  // Only enforce completion policy when bound to a Move/Attempt
  if (!binding.attempt_id) return {};

  const taskId = extractTaskId(input);

  // ── Check completion policy from local mirror ───────────────────────────
  const policyStore = new PolicyMirrorStore();
  const policies = policyStore.getActive();

  for (const policy of policies) {
    try {
      const data = JSON.parse(policy.policy_data) as Record<string, unknown>;
      if (data['type'] !== 'completion') continue;
      if (data['caseId'] !== binding.case_id && data['moveId'] !== binding.move_id) continue;

      const requiredEvidence = data['requiredEvidence'];
      if (!Array.isArray(requiredEvidence) || requiredEvidence.length === 0) continue;

      // Scan pending outbox for evidence of the required types
      const outbox = new OutboxStore();
      const pending = outbox.getPending();
      const seen = new Set<string>();

      for (const event of pending) {
        try {
          const payload = JSON.parse(event.payload) as Record<string, unknown>;
          if (typeof payload['evidenceType'] === 'string') seen.add(payload['evidenceType']);
          if (typeof payload['type'] === 'string') seen.add(payload['type']);
          // CommitCreated, FileModified events use event_type directly
          seen.add(event.event_type);
        } catch {
          /* skip malformed payload */
        }
      }

      const missing = (requiredEvidence as string[]).filter((r) => !seen.has(r));
      if (missing.length > 0) {
        return {
          decision: 'block',
          reason: `Move completion blocked: missing required evidence — ${missing.join(', ')}`,
        };
      }
    } catch {
      /* skip unreadable policy */
    }
  }

  // ── Completion allowed — emit success ───────────────────────────────────
  const outbox = new OutboxStore();
  outbox.enqueue('AttemptSucceeded', {
    sessionId,
    caseId: binding.case_id,
    moveId: binding.move_id,
    attemptId: binding.attempt_id,
    taskId,
  });

  return {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTaskId(input: HookInput): string {
  if (typeof input['task_id'] === 'string') return input['task_id'];
  const task = input['task'];
  if (task && typeof task === 'object') {
    const id = (task as Record<string, unknown>)['id'];
    if (typeof id === 'string') return id;
  }
  return '';
}
