/**
 * Shared helpers for Process MCP tool handlers (spec section 3):
 *   - `ToolResult` / `textResult` / `errorResult` — uniform tool responses
 *   - `getCache` / `setCache` — the local `process_cache` read/fallback path
 *   - `resolveActiveBinding` — "current" case/move/attempt/session lookup
 *
 * Every tool follows: try local cache -> fall back to HTTP -> cache the
 * result. Write tools additionally enqueue to the local outbox first so the
 * command is durable even if the control plane is unreachable.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getLocalDb } from '../storage/db.js';
import { SessionStore } from '../storage/sessions.js';

// ---------------------------------------------------------------------------
// Tool result helpers
// ---------------------------------------------------------------------------

export type ToolResult = CallToolResult;

/** Build a successful tool result from arbitrary JSON-serializable data. */
export function textResult(data: unknown): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Build a tool error result. Claude sees the message and can self-correct. */
export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

// ---------------------------------------------------------------------------
// Process cache (spec section 6, `process_cache` table)
// ---------------------------------------------------------------------------

/** Default freshness window for cached reads before we prefer a refetch. */
export const DEFAULT_CACHE_TTL_MS = 30_000;

interface CacheRow {
  value: string;
  expires_at: string | null;
}

/** Read a cached value, honoring `expires_at`. Returns `null` on miss/expiry/parse error. */
export function getCache<T>(key: string): T | null {
  try {
    const db = getLocalDb();
    const row = db
      .prepare<[string], CacheRow>('SELECT value, expires_at FROM process_cache WHERE key = ?')
      .get(key);
    if (!row) return null;
    if (row.expires_at && row.expires_at < new Date().toISOString()) return null;
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

/** Write (upsert) a cached value. Pass `ttlMs` to expire it; omit for no expiry. */
export function setCache(key: string, value: unknown, ttlMs: number = DEFAULT_CACHE_TTL_MS): void {
  try {
    const db = getLocalDb();
    const now = new Date();
    const expiresAt = ttlMs > 0 ? new Date(now.getTime() + ttlMs).toISOString() : null;
    db.prepare(
      `INSERT INTO process_cache (key, value, updated_at, expires_at)
       VALUES (@key, @value, @updated_at, @expires_at)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at`,
    ).run({
      key,
      value: JSON.stringify(value),
      updated_at: now.toISOString(),
      expires_at: expiresAt,
    });
  } catch {
    // Cache is best-effort — a write failure must never break a tool call.
  }
}

// ---------------------------------------------------------------------------
// "Current" case/move/attempt resolution
// ---------------------------------------------------------------------------

export interface ActiveBinding {
  sessionId: string | null;
  caseId: string | null;
  moveId: string | null;
  attemptId: string | null;
  workspacePath: string | null;
}

const EMPTY_BINDING: ActiveBinding = {
  sessionId: null,
  caseId: null,
  moveId: null,
  attemptId: null,
  workspacePath: null,
};

/**
 * Resolve the "current" session binding for tools that default to the
 * caller's active work (e.g. `process.case.get` with no `case_id`).
 *
 * The MCP stdio transport carries no session id of its own, so we fall back
 * to the most recently bound `active` session for this device — in normal
 * single-workspace usage there is exactly one. Tools that need a specific
 * case/move should still accept an explicit id argument to disambiguate.
 */
export function resolveActiveBinding(): ActiveBinding {
  const active = new SessionStore().getActive();
  if (active.length === 0) return EMPTY_BINDING;
  const latest = active[active.length - 1];
  if (!latest) return EMPTY_BINDING;
  return {
    sessionId: latest.session_id,
    caseId: latest.case_id,
    moveId: latest.move_id,
    attemptId: latest.attempt_id,
    workspacePath: latest.workspace_path,
  };
}

/** Human-readable guidance returned when a tool needs a case but none is bound. */
export const NO_CASE_BOUND_MESSAGE =
  'No case_id was given and no case is bound to the active session. ' +
  'Pass an explicit case_id, or run /process:connect and bind a case first.';
