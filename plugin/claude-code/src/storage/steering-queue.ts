import { randomUUID } from 'node:crypto';
import { getLocalDb } from './db.js';

export interface SteeringMessage {
  id: string;
  case_id: string;
  move_id: string | null;
  steering_class: string;
  payload: string;
  received_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
}

export interface EnqueueSteeringInput {
  id?: string;
  caseId: string;
  moveId?: string | null;
  steeringClass: string;
  payload: unknown;
}

/**
 * Steering queue storage: control-plane steering commands (pause, redirect,
 * inject guidance, ...) delivered over the edge WSS connection and queued
 * here until the relevant hook (e.g. PreToolUse / UserPromptSubmit) can
 * deliver them into the running session.
 */
export class SteeringQueueStore {
  /** Queue an incoming steering command. Returns its id (generated if omitted). */
  enqueue(input: EnqueueSteeringInput): string {
    const db = getLocalDb();
    const id = input.id ?? randomUUID();
    db.prepare(
      `INSERT INTO pending_steering (id, case_id, move_id, steering_class, payload, received_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.caseId,
      input.moveId ?? null,
      input.steeringClass,
      JSON.stringify(input.payload),
      new Date().toISOString(),
    );
    return id;
  }

  /**
   * List steering commands not yet delivered to a session, oldest first.
   * Pass `caseId` to scope the lookup to a single case.
   */
  getPending(caseId?: string): SteeringMessage[] {
    const db = getLocalDb();
    if (caseId) {
      return db
        .prepare<[string], SteeringMessage>(
          'SELECT * FROM pending_steering WHERE delivered_at IS NULL AND case_id = ? ORDER BY received_at ASC',
        )
        .all(caseId);
    }
    return db
      .prepare<[], SteeringMessage>(
        'SELECT * FROM pending_steering WHERE delivered_at IS NULL ORDER BY received_at ASC',
      )
      .all();
  }

  /** Mark a steering command as delivered into a session. */
  markDelivered(id: string): void {
    getLocalDb()
      .prepare('UPDATE pending_steering SET delivered_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  /** Mark a steering command as acknowledged (acted upon) by a session. */
  markAcknowledged(id: string): void {
    getLocalDb()
      .prepare('UPDATE pending_steering SET acknowledged_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }
}
