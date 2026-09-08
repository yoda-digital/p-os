/**
 * Semantic checkpoint persistence for context recovery.
 *
 * Saves and loads context checkpoints to/from local SQLite. Used by:
 * - PreCompact hook: save critical state before compaction
 * - PostCompact hook: compare with native summary to detect gaps
 * - SessionStart(compact): load checkpoint for rehydration
 * - SessionStart(resume): load checkpoint for delta comparison
 *
 * Spec: §3.2 PreCompact Handler, §3.3 PostCompact Handler
 */
import { getLocalDb } from '../storage/db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckpointData {
  /** Active case ID. */
  case_id: string;
  /** Active move ID. */
  move_id?: string;
  /** Active attempt ID. */
  attempt_id?: string;
  /** All active constraints (rules + steering). */
  constraints: string[];
  /** Active steering commands not yet applied. */
  active_steering: SteeringSnapshot[];
  /** Critical assertions (high-confidence, verified modality). */
  critical_assertions: string[];
  /** Failed approaches — DO NOT REPEAT these. */
  failed_approaches: string[];
  /** Current completion state of the active move. */
  completion_state?: string;
  /** Unsatisfied dependencies blocking the current move. */
  unsatisfied_dependencies: string[];
  /** The current objective text. */
  objective?: string;
  /** Last known event sequence number for delta calculation. */
  last_event_sequence?: number;
  /** Timestamp of checkpoint creation. */
  created_at: string;
}

export interface SteeringSnapshot {
  id: string;
  class: string;
  instruction: string;
  state: string;
}

// ---------------------------------------------------------------------------
// SQLite schema initialization
// ---------------------------------------------------------------------------

function ensureCheckpointTable(): void {
  const db = getLocalDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS context_checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      checkpoint_data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_context_checkpoints_session
      ON context_checkpoints (session_id, created_at DESC);
  `);
}

// ---------------------------------------------------------------------------
// Save checkpoint
// ---------------------------------------------------------------------------

/**
 * Save a semantic checkpoint for the given session. Checkpoints are
 * append-only — each save creates a new row so we never lose history.
 */
export function saveCheckpoint(sessionId: string, data: CheckpointData): string {
  ensureCheckpointTable();
  const db = getLocalDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO context_checkpoints (id, session_id, case_id, checkpoint_data, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, sessionId, data.case_id, JSON.stringify(data), now);

  return id;
}

// ---------------------------------------------------------------------------
// Load checkpoint
// ---------------------------------------------------------------------------

/**
 * Load the most recent checkpoint for a session. Returns null if none exists.
 */
export function loadCheckpoint(sessionId: string): CheckpointData | null {
  ensureCheckpointTable();
  const db = getLocalDb();

  const row = db
    .prepare<[string], { checkpoint_data: string }>(
      'SELECT checkpoint_data FROM context_checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(sessionId);

  if (!row?.checkpoint_data) return null;

  try {
    return JSON.parse(row.checkpoint_data) as CheckpointData;
  } catch {
    return null;
  }
}

/**
 * Load the most recent checkpoint for a case (across all sessions).
 * Useful for fork recovery where we need the parent's state.
 */
export function loadCheckpointByCase(caseId: string): CheckpointData | null {
  ensureCheckpointTable();
  const db = getLocalDb();

  const row = db
    .prepare<[string], { checkpoint_data: string }>(
      'SELECT checkpoint_data FROM context_checkpoints WHERE case_id = ? ORDER BY created_at DESC LIMIT 1',
    )
    .get(caseId);

  if (!row?.checkpoint_data) return null;

  try {
    return JSON.parse(row.checkpoint_data) as CheckpointData;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build checkpoint from current state
// ---------------------------------------------------------------------------

/**
 * Build a CheckpointData from the current session binding and local cache.
 * Used by PreCompact to capture critical state before compaction.
 */
export function buildCheckpointFromCache(
  sessionId: string,
  binding: { case_id: string; move_id?: string; attempt_id?: string },
): CheckpointData {
  const db = getLocalDb();
  const data: CheckpointData = {
    case_id: binding.case_id,
    move_id: binding.move_id,
    attempt_id: binding.attempt_id,
    constraints: [],
    active_steering: [],
    critical_assertions: [],
    failed_approaches: [],
    unsatisfied_dependencies: [],
    created_at: new Date().toISOString(),
  };

  // Load constraints from cache
  try {
    const caseCache = db
      .prepare<[string], { value: string }>('SELECT value FROM process_cache WHERE key = ?')
      .get(`case:${binding.case_id}`);
    if (caseCache?.value) {
      const caseData = JSON.parse(caseCache.value) as Record<string, unknown>;
      if (Array.isArray(caseData['constraints'])) {
        data.constraints = caseData['constraints'] as string[];
      }
      if (typeof caseData['intent'] === 'string') {
        data.objective = caseData['intent'];
      }
      if (Array.isArray(caseData['doNotRepeat'])) {
        data.failed_approaches = caseData['doNotRepeat'] as string[];
      }
    }
  } catch {
    /* cache miss */
  }

  // Load active steering from pending_steering table
  try {
    const steering = db
      .prepare<[string], { id: string; steering_class: string; payload: string }>(
        "SELECT id, steering_class, payload FROM pending_steering WHERE case_id = ? AND delivered_at IS NULL",
      )
      .all(binding.case_id);

    for (const s of steering) {
      let instruction = s.payload;
      try {
        const parsed = JSON.parse(s.payload) as Record<string, unknown>;
        if (typeof parsed['instruction'] === 'string') instruction = parsed['instruction'];
      } catch { /* payload is the instruction itself */ }

      data.active_steering.push({
        id: s.id,
        class: s.steering_class,
        instruction,
        state: 'pending',
      });
    }
  } catch {
    /* table may not exist yet */
  }

  return data;
}
