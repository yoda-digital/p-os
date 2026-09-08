import type postgres from 'postgres';
import { appendEvents, type EventRecord } from './event-store.js';

type Sql = ReturnType<typeof postgres>;

// ---------------------------------------------------------------------------
// Steering types (spec §1.2)
// ---------------------------------------------------------------------------

export const STEERING_CLASSES = [
  'advisory',
  'constraint',
  'redirect',
  'pause',
  'hard_stop',
  'fork',
  'reassign',
] as const;

export type SteeringClass = (typeof STEERING_CLASSES)[number];

export function isSteeringClass(value: unknown): value is SteeringClass {
  return typeof value === 'string' && (STEERING_CLASSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Steering state machine (spec §1.3)
// ---------------------------------------------------------------------------

export const STEERING_STATES = [
  'issued',
  'delivered_to_edge',
  'delivered_to_executor',
  'acknowledged',
  'applied',
] as const;

export type SteeringState = (typeof STEERING_STATES)[number];

export function isSteeringState(value: unknown): value is SteeringState {
  return typeof value === 'string' && (STEERING_STATES as readonly string[]).includes(value);
}

export interface SteeringCommandRow {
  id: string;
  case_id: string;
  move_id: string;
  attempt_id: string | null;
  class: SteeringClass;
  instruction: string;
  state: SteeringState;
  issued_by: string | null;
  issued_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
  applied_at: string | null;
}

export class InvalidSteeringClassError extends Error {}
export class InvalidSteeringTransitionError extends Error {}
export class SteeringNotFoundError extends Error {}

// ---------------------------------------------------------------------------
// Create — issue a new steering command
// ---------------------------------------------------------------------------

export interface CreateSteeringParams {
  case_id: string;
  move_id: string;
  attempt_id?: string | null;
  class: SteeringClass;
  instruction: string;
  /** Organization id — required to append tenant-scoped events. */
  tenant_id: string;
  /** Actor issuing the steering (nullable for system-issued steering). */
  actor_id: string | null;
  /** Optional causation/correlation override (e.g. the originating command id). */
  causation_id?: string;
  correlation_id?: string;
}

/**
 * Create a steering command: writes the `steering_commands` row (state `issued`),
 * appends a `SteeringIssued` event (and an `AttemptSteered` event when the steering
 * targets a live attempt, for the attempt's own audit trail), and records the
 * steering on the attempt's `steering_history`.
 *
 * Composable inside an existing transaction — mirrors `event-store.appendEvents`:
 * pass a `tx` if already inside one (see `createSteeringTransactional` otherwise).
 */
export async function createSteering(sql: Sql, params: CreateSteeringParams): Promise<SteeringCommandRow> {
  if (!isSteeringClass(params.class)) {
    throw new InvalidSteeringClassError(
      `Invalid steering class "${String(params.class)}" — must be one of: ${STEERING_CLASSES.join(', ')}`
    );
  }
  if (!params.instruction || !params.instruction.trim()) {
    throw new Error('instruction is required');
  }

  const id = crypto.randomUUID();
  const causationId = params.causation_id ?? crypto.randomUUID();
  const correlationId = params.correlation_id ?? causationId;
  const attemptId = params.attempt_id ?? null;

  const [row] = await sql`
    INSERT INTO steering_commands (id, case_id, move_id, attempt_id, class, instruction, state, issued_by)
    VALUES (${id}, ${params.case_id}, ${params.move_id}, ${attemptId},
            ${params.class}, ${params.instruction}, 'issued', ${params.actor_id})
    RETURNING *
  `;

  const events: EventRecord[] = [
    {
      id: crypto.randomUUID(),
      tenant_id: params.tenant_id,
      case_id: params.case_id,
      type: 'SteeringIssued',
      actor_id: params.actor_id,
      occurred_at: new Date(),
      causation_id: causationId,
      correlation_id: correlationId,
      data: {
        steering_id: id,
        move_id: params.move_id,
        attempt_id: attemptId,
        class: params.class,
        instruction: params.instruction,
      },
    },
  ];

  if (attemptId) {
    events.push({
      id: crypto.randomUUID(),
      tenant_id: params.tenant_id,
      case_id: params.case_id,
      type: 'AttemptSteered',
      actor_id: params.actor_id,
      occurred_at: new Date(),
      causation_id: causationId,
      correlation_id: correlationId,
      data: {
        attempt_id: attemptId,
        steering_id: id,
        move_id: params.move_id,
        class: params.class,
        instruction: params.instruction,
      },
    });
  }

  await appendEvents(sql, events);

  if (attemptId) {
    await sql`
      UPDATE attempts SET
        steering_history = steering_history || ${sql.json([
          { id, class: params.class, instruction: params.instruction, issued_at: new Date().toISOString() },
        ] as any)},
        revision = revision + 1
      WHERE id = ${attemptId}
    `;
  }

  return row as unknown as SteeringCommandRow;
}

/** Same as `createSteering`, wrapped in its own transaction for callers not already inside one. */
export async function createSteeringTransactional(
  sql: Sql,
  params: CreateSteeringParams
): Promise<SteeringCommandRow> {
  let result: SteeringCommandRow | undefined;
  await sql.begin(async (tx) => {
    result = await createSteering(tx as unknown as Sql, params);
  });
  return result!;
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

const STATE_EVENT_TYPE: Record<Exclude<SteeringState, 'issued'>, string> = {
  delivered_to_edge: 'SteeringDelivered',
  delivered_to_executor: 'SteeringDelivered',
  acknowledged: 'SteeringAcknowledged',
  applied: 'SteeringApplied',
};

export interface UpdateSteeringStateOptions {
  /** Actor responsible for this transition (e.g. the device or the acking user). */
  actorId?: string | null;
  /** Extra context folded into the emitted event's data (e.g. `{ target: 'edge' }`). */
  eventData?: Record<string, unknown>;
}

/**
 * Advance a steering command through `issued → delivered_to_edge → delivered_to_executor →
 * acknowledged → applied`. Regressing to an earlier state is rejected. Re-asserting the current
 * state is a no-op (idempotent — returns the row unchanged). Every real transition emits the
 * matching `Steering*` lifecycle event so the UI's state feed always reflects the truth — "Sent"
 * never silently becomes "Applied" (spec §1.3).
 */
export async function updateSteeringState(
  sql: Sql,
  steeringId: string,
  newState: SteeringState,
  options: UpdateSteeringStateOptions = {}
): Promise<SteeringCommandRow> {
  if (!isSteeringState(newState)) {
    throw new InvalidSteeringTransitionError(`Unknown steering state: ${String(newState)}`);
  }

  const [current] = await sql`
    SELECT sc.*, c.organization_id AS tenant_id
    FROM steering_commands sc
    JOIN cases c ON c.id = sc.case_id
    WHERE sc.id = ${steeringId}
  `;
  if (!current) {
    throw new SteeringNotFoundError(`Steering command not found: ${steeringId}`);
  }

  const currentIdx = STEERING_STATES.indexOf(current['state'] as SteeringState);
  const nextIdx = STEERING_STATES.indexOf(newState);

  if (nextIdx < currentIdx) {
    throw new InvalidSteeringTransitionError(
      `Cannot move steering ${steeringId} backward from '${current['state']}' to '${newState}'`
    );
  }
  if (nextIdx === currentIdx) {
    return current as unknown as SteeringCommandRow; // idempotent no-op
  }

  const isDeliveryState = newState === 'delivered_to_edge' || newState === 'delivered_to_executor';
  const isAcknowledged = newState === 'acknowledged';
  const isApplied = newState === 'applied';

  const [updated] = await sql`
    UPDATE steering_commands SET
      state = ${newState},
      delivered_at = CASE WHEN ${isDeliveryState} AND delivered_at IS NULL THEN NOW() ELSE delivered_at END,
      acknowledged_at = CASE WHEN ${isAcknowledged} AND acknowledged_at IS NULL THEN NOW() ELSE acknowledged_at END,
      applied_at = CASE WHEN ${isApplied} AND applied_at IS NULL THEN NOW() ELSE applied_at END
    WHERE id = ${steeringId}
    RETURNING *
  `;

  const eventId = crypto.randomUUID();
  await appendEvents(sql, [
    {
      id: eventId,
      tenant_id: current['tenant_id'] as string,
      case_id: current['case_id'] as string,
      type: STATE_EVENT_TYPE[newState as Exclude<SteeringState, 'issued'>],
      actor_id: options.actorId ?? null,
      occurred_at: new Date(),
      causation_id: eventId,
      correlation_id: eventId,
      data: {
        steering_id: steeringId,
        move_id: current['move_id'],
        attempt_id: current['attempt_id'],
        state: newState,
        ...(options.eventData ?? {}),
      },
    },
  ]);

  return updated as unknown as SteeringCommandRow;
}

/** Same as `updateSteeringState`, wrapped in its own transaction for callers not already inside one. */
export async function updateSteeringStateTransactional(
  sql: Sql,
  steeringId: string,
  newState: SteeringState,
  options: UpdateSteeringStateOptions = {}
): Promise<SteeringCommandRow> {
  let result: SteeringCommandRow | undefined;
  await sql.begin(async (tx) => {
    result = await updateSteeringState(tx as unknown as Sql, steeringId, newState, options);
  });
  return result!;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getSteeringById(sql: Sql, steeringId: string): Promise<SteeringCommandRow | null> {
  const [row] = await sql`SELECT * FROM steering_commands WHERE id = ${steeringId}`;
  return (row as unknown as SteeringCommandRow) ?? null;
}

export async function getSteeringForAttempt(sql: Sql, attemptId: string): Promise<SteeringCommandRow[]> {
  return (await sql`
    SELECT * FROM steering_commands WHERE attempt_id = ${attemptId} ORDER BY issued_at DESC
  `) as unknown as SteeringCommandRow[];
}

export async function getSteeringForMove(sql: Sql, moveId: string): Promise<SteeringCommandRow[]> {
  return (await sql`
    SELECT * FROM steering_commands WHERE move_id = ${moveId} ORDER BY issued_at DESC
  `) as unknown as SteeringCommandRow[];
}
