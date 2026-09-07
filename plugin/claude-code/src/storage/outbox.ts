import { getLocalDb } from './db.js';

export type OutboxStatus = 'pending' | 'uploaded' | 'failed';

export interface OutboxEvent {
  id: number;
  event_type: string;
  payload: string;
  created_at: string;
  uploaded_at: string | null;
  retry_count: number;
  status: OutboxStatus;
}

const DEFAULT_LIST_LIMIT = 100;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETENTION_DAYS = 7;

/**
 * Local event outbox (spec section 5.2). Every hook-generated event is
 * written here first, then drained to the control plane asynchronously by
 * the process edge (WSS connection). Writes are always available even when
 * offline; the drain loop reads via `getPending` / `getRetryable`.
 */
export class OutboxStore {
  /** Queue a new event for upload. Returns the new outbox row id. */
  enqueue(eventType: string, payload: unknown): number {
    const db = getLocalDb();
    const result = db
      .prepare(
        `INSERT INTO outbox (event_type, payload, created_at, retry_count, status)
         VALUES (?, ?, ?, 0, 'pending')`,
      )
      .run(eventType, JSON.stringify(payload), new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  /** List events awaiting their first upload attempt, oldest first. */
  getPending(limit: number = DEFAULT_LIST_LIMIT): OutboxEvent[] {
    const db = getLocalDb();
    return db
      .prepare<[number], OutboxEvent>(
        "SELECT * FROM outbox WHERE status = 'pending' ORDER BY id ASC LIMIT ?",
      )
      .all(limit);
  }

  /** Mark an event as successfully uploaded. */
  markUploaded(id: number): void {
    getLocalDb()
      .prepare("UPDATE outbox SET status = 'uploaded', uploaded_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  /** Mark an event as failed, incrementing its retry counter. */
  markFailed(id: number): void {
    getLocalDb()
      .prepare("UPDATE outbox SET status = 'failed', retry_count = retry_count + 1 WHERE id = ?")
      .run(id);
  }

  /**
   * List events that previously failed but have not exhausted their retry
   * budget, oldest first, so the drain loop can attempt them again.
   */
  getRetryable(
    maxRetries: number = DEFAULT_MAX_RETRIES,
    limit: number = DEFAULT_LIST_LIMIT,
  ): OutboxEvent[] {
    const db = getLocalDb();
    return db
      .prepare<[number, number], OutboxEvent>(
        "SELECT * FROM outbox WHERE status = 'failed' AND retry_count < ? ORDER BY id ASC LIMIT ?",
      )
      .all(maxRetries, limit);
  }

  /**
   * Delete uploaded events older than `retentionDays` to keep the outbox
   * table bounded. Returns the number of rows removed.
   */
  prune(retentionDays: number = DEFAULT_RETENTION_DAYS): number {
    const db = getLocalDb();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const result = db
      .prepare(
        "DELETE FROM outbox WHERE status = 'uploaded' AND uploaded_at IS NOT NULL AND uploaded_at < ?",
      )
      .run(cutoff);
    return result.changes;
  }
}
