/**
 * TaskCreated hook handler (spec section 4.3).
 *
 * When Claude creates a native task:
 * 1. Fast exit if not paired / session not bound to a Case
 * 2. Fuzzy-match the task description to an existing Move
 * 3. If confidence > 0.8 → create Attempt binding, emit AttemptStarted
 * 4. Otherwise → emit UnmappedTaskCreated for human review
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore } from '../storage/sessions.js';
import { OutboxStore } from '../storage/outbox.js';
import { getLocalDb } from '../storage/db.js';

const MATCH_THRESHOLD = 0.8;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleTaskCreated(input: HookInput): Promise<HookResult> {
  const deviceStore = new DeviceStore();
  if (!deviceStore.isPaired()) return {};

  const sessionId = extractSessionId(input);
  if (!sessionId) return {};

  const sessionStore = new SessionStore();
  const binding = sessionStore.get(sessionId);
  if (!binding?.case_id) return {};

  const taskId = extractString(input, 'task_id', ['task', 'id']);
  const taskDescription = extractString(input, 'task_title', ['task', 'description']) ||
    extractString(input, 'title', ['task', 'title']);

  const outbox = new OutboxStore();
  const moveMatch = findMoveMatch(binding.case_id, taskDescription);

  if (moveMatch && moveMatch.confidence > MATCH_THRESHOLD) {
    // Create Attempt binding
    const attemptId = `attempt-${Date.now()}`;
    sessionStore.bind({
      sessionId,
      caseId: binding.case_id,
      moveId: moveMatch.moveId,
      attemptId,
      workspacePath: binding.workspace_path,
    });

    outbox.enqueue('AttemptStarted', {
      attemptId,
      sessionId,
      caseId: binding.case_id,
      moveId: moveMatch.moveId,
      taskId,
      taskDescription,
      matchConfidence: moveMatch.confidence,
    });
  } else {
    outbox.enqueue('UnmappedTaskCreated', {
      sessionId,
      caseId: binding.case_id,
      taskId,
      taskDescription,
    });
  }

  return {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a string from flat key or nested path. */
function extractString(
  input: HookInput,
  flatKey: string,
  nestedPath: [string, string],
): string {
  const flat = input[flatKey];
  if (typeof flat === 'string') return flat;
  const parent = input[nestedPath[0]];
  if (parent && typeof parent === 'object') {
    const val = (parent as Record<string, unknown>)[nestedPath[1]];
    if (typeof val === 'string') return val;
  }
  return '';
}

interface MoveMatch {
  moveId: string;
  confidence: number;
}

/**
 * Simple word-overlap matching against cached moves.
 * Full fuzzy matching is implemented in Task 6.
 */
function findMoveMatch(caseId: string, taskDescription: string): MoveMatch | null {
  if (!taskDescription) return null;

  try {
    const db = getLocalDb();
    const row = db
      .prepare<[string], { value: string }>('SELECT value FROM process_cache WHERE key = ?')
      .get(`moves:${caseId}`);

    if (!row?.value) return null;

    const moves = JSON.parse(row.value) as Array<{ id: string; title: string }>;
    const taskWords = new Set(
      taskDescription
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );

    let bestMatch: MoveMatch | null = null;
    for (const move of moves) {
      const moveWords = new Set(
        move.title
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 2),
      );
      const overlap = [...taskWords].filter((w) => moveWords.has(w)).length;
      const denominator = Math.max(taskWords.size, moveWords.size, 1);
      const confidence = overlap / denominator;

      if (confidence > (bestMatch?.confidence ?? 0)) {
        bestMatch = { moveId: move.id, confidence };
      }
    }

    return bestMatch;
  } catch {
    return null;
  }
}
