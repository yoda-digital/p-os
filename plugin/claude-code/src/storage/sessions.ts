import { getLocalDb } from './db.js';

export type SessionStatus = 'active' | 'ended' | 'blocked' | string;

export interface SessionBinding {
  session_id: string;
  case_id: string | null;
  move_id: string | null;
  attempt_id: string | null;
  workspace_path: string | null;
  bound_at: string | null;
  status: SessionStatus;
}

export interface BindSessionInput {
  sessionId: string;
  caseId?: string | null;
  moveId?: string | null;
  attemptId?: string | null;
  workspacePath?: string | null;
  status?: SessionStatus;
}

/**
 * Session-binding storage: maps a Claude Code session id to the
 * case/move/attempt it is working on (spec section 6, `session_bindings`).
 */
export class SessionStore {
  /**
   * Bind (create or update) a session to a case/move/attempt. Re-binding an
   * existing session id overwrites its binding in place.
   */
  bind(input: BindSessionInput): void {
    const db = getLocalDb();
    db.prepare(
      `INSERT INTO session_bindings (session_id, case_id, move_id, attempt_id, workspace_path, bound_at, status)
       VALUES (@session_id, @case_id, @move_id, @attempt_id, @workspace_path, @bound_at, @status)
       ON CONFLICT(session_id) DO UPDATE SET
         case_id = excluded.case_id,
         move_id = excluded.move_id,
         attempt_id = excluded.attempt_id,
         workspace_path = excluded.workspace_path,
         bound_at = excluded.bound_at,
         status = excluded.status`,
    ).run({
      session_id: input.sessionId,
      case_id: input.caseId ?? null,
      move_id: input.moveId ?? null,
      attempt_id: input.attemptId ?? null,
      workspace_path: input.workspacePath ?? null,
      bound_at: new Date().toISOString(),
      status: input.status ?? 'active',
    });
  }

  /** Get the binding for a session id, or `null` if it isn't bound. */
  get(sessionId: string): SessionBinding | null {
    const db = getLocalDb();
    const row = db
      .prepare<[string], SessionBinding>('SELECT * FROM session_bindings WHERE session_id = ?')
      .get(sessionId);
    return row ?? null;
  }

  /** List all bindings currently in `active` status. */
  getActive(): SessionBinding[] {
    const db = getLocalDb();
    return db
      .prepare<[], SessionBinding>(
        "SELECT * FROM session_bindings WHERE status = 'active' ORDER BY bound_at ASC",
      )
      .all();
  }

  /** Remove a session's binding entirely. */
  unbind(sessionId: string): void {
    getLocalDb().prepare('DELETE FROM session_bindings WHERE session_id = ?').run(sessionId);
  }

  /** Update just the status of an existing session binding. */
  updateStatus(sessionId: string, status: SessionStatus): void {
    getLocalDb()
      .prepare('UPDATE session_bindings SET status = ? WHERE session_id = ?')
      .run(status, sessionId);
  }
}
