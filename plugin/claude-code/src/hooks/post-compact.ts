/**
 * PostCompact hook handler (spec §3.3).
 *
 * After context compaction:
 * 1. Load the checkpoint saved by PreCompact
 * 2. Compare with what's in the PostCompact native summary
 * 3. Flag any missing critical items for SessionStart(compact) rehydration
 *
 * The PostCompact hook receives the native summary that Claude's compaction
 * produced. We compare it with our checkpoint to detect if critical
 * information was lost.
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore } from '../storage/sessions.js';
import { loadCheckpoint, type CheckpointData } from '../context/checkpoint.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handlePostCompact(input: HookInput): Promise<HookResult> {
  const deviceStore = new DeviceStore();
  if (!deviceStore.isPaired()) return {};

  const sessionId = extractSessionId(input);
  if (!sessionId) return {};

  const sessionStore = new SessionStore();
  const binding = sessionStore.get(sessionId);
  if (!binding?.case_id) return {};

  // Load the checkpoint we saved in PreCompact
  const checkpoint = loadCheckpoint(sessionId);
  if (!checkpoint) return {};

  // Extract the native summary from the input
  const nativeSummary = extractNativeSummary(input);
  if (!nativeSummary) return {};

  // Compare checkpoint with native summary to detect gaps
  const gaps = detectGaps(checkpoint, nativeSummary);

  if (gaps.length === 0) return {};

  // Return additional context to fill the gaps
  const recovery: string[] = [
    '[Process OS] Context recovery after compaction — the following critical items were not preserved in the native summary:',
    '',
  ];

  for (const gap of gaps) {
    recovery.push(`- ${gap}`);
  }

  return {
    additionalContext: recovery.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

function detectGaps(checkpoint: CheckpointData, nativeSummary: string): string[] {
  const gaps: string[] = [];
  const summaryLower = nativeSummary.toLowerCase();

  // Check if constraints are preserved
  for (const constraint of checkpoint.constraints) {
    // Check if the constraint text (or a significant portion) appears in the summary
    const words = constraint.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const found = words.some((w) => summaryLower.includes(w));
    if (!found) {
      gaps.push(`CONSTRAINT missing: "${constraint}"`);
    }
  }

  // Check if active steering is preserved
  for (const steering of checkpoint.active_steering) {
    const words = steering.instruction.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const found = words.some((w) => summaryLower.includes(w));
    if (!found) {
      gaps.push(`STEERING [${steering.class}] missing: "${steering.instruction}"`);
    }
  }

  // Check if failed approaches are preserved
  for (const failure of checkpoint.failed_approaches) {
    const words = failure.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const found = words.some((w) => summaryLower.includes(w));
    if (!found) {
      gaps.push(`DO NOT REPEAT missing: "${failure}"`);
    }
  }

  // Check if the objective is preserved
  if (checkpoint.objective) {
    const words = checkpoint.objective.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const found = words.some((w) => summaryLower.includes(w));
    if (!found) {
      gaps.push(`OBJECTIVE missing: "${checkpoint.objective}"`);
    }
  }

  // Check if case/move IDs are preserved
  if (!summaryLower.includes(checkpoint.case_id.slice(0, 8).toLowerCase())) {
    gaps.push(`Case ID not in summary: ${checkpoint.case_id}`);
  }
  if (checkpoint.move_id && !summaryLower.includes(checkpoint.move_id.slice(0, 8).toLowerCase())) {
    gaps.push(`Move ID not in summary: ${checkpoint.move_id}`);
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractNativeSummary(input: HookInput): string | null {
  // Claude Code passes the compact summary in several possible locations
  if (typeof input['summary'] === 'string') return input['summary'];
  if (typeof input['compact_summary'] === 'string') return input['compact_summary'];

  const session = input['session'] as Record<string, unknown> | undefined;
  if (session) {
    if (typeof session['compact_summary'] === 'string') return session['compact_summary'];
    if (typeof session['summary'] === 'string') return session['summary'];
  }

  // If no summary available, we can't compare
  return null;
}
