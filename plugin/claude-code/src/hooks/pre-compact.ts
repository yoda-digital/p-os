/**
 * PreCompact hook handler (spec §3.2).
 *
 * Before context compaction, save a semantic checkpoint with critical state
 * to SQLite so we can recover it after compaction if the native summary
 * loses important context.
 *
 * Checkpoint saves:
 * - case_id, move_id, attempt_id
 * - All active constraints/steering
 * - Critical assertions
 * - Failed approaches (DO NOT REPEAT)
 * - Current completion state
 * - Unsatisfied dependencies
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore } from '../storage/sessions.js';
import { saveCheckpoint, buildCheckpointFromCache } from '../context/checkpoint.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handlePreCompact(input: HookInput): Promise<HookResult> {
  const deviceStore = new DeviceStore();
  if (!deviceStore.isPaired()) return {};

  const sessionId = extractSessionId(input);
  if (!sessionId) return {};

  const sessionStore = new SessionStore();
  const binding = sessionStore.get(sessionId);
  if (!binding?.case_id) return {};

  // Build and save checkpoint from current cached state
  const checkpoint = buildCheckpointFromCache(sessionId, {
    case_id: binding.case_id!,
    move_id: binding.move_id ?? undefined,
    attempt_id: binding.attempt_id ?? undefined,
  });

  saveCheckpoint(sessionId, checkpoint);

  return {};
}
