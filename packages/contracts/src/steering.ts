import { z } from 'zod';
import { zId, zCaseId, zMoveId, zAttemptId, zActorId, zISODateString } from './ids.js';

// ---------------------------------------------------------------------------
// Steering class
// ---------------------------------------------------------------------------

export const SteeringClass = {
  Advisory: 'advisory',
  Constraint: 'constraint',
  Redirect: 'redirect',
  Pause: 'pause',
  HardStop: 'hard_stop',
  Fork: 'fork',
  Reassign: 'reassign',
} as const;

export const zSteeringClass = z.enum([
  'advisory',
  'constraint',
  'redirect',
  'pause',
  'hard_stop',
  'fork',
  'reassign',
]);
export type SteeringClass = z.infer<typeof zSteeringClass>;

// ---------------------------------------------------------------------------
// Steering delivery state
// ---------------------------------------------------------------------------

export const SteeringState = {
  Issued: 'issued',
  DeliveredToEdge: 'delivered_to_edge',
  DeliveredToExecutor: 'delivered_to_executor',
  Acknowledged: 'acknowledged',
  Applied: 'applied',
} as const;

export const zSteeringState = z.enum([
  'issued',
  'delivered_to_edge',
  'delivered_to_executor',
  'acknowledged',
  'applied',
]);
export type SteeringState = z.infer<typeof zSteeringState>;

// ---------------------------------------------------------------------------
// Steering command
// ---------------------------------------------------------------------------

export const zSteeringCommand = z.object({
  id: zId,
  case_id: zCaseId,
  move_id: zMoveId,
  attempt_id: zAttemptId.optional(),
  class: zSteeringClass,
  instruction: z.string().min(1),
  delivery_state: zSteeringState.default('issued'),
  issued_by: zActorId,
  issued_at: zISODateString,
  delivered_at: zISODateString.optional(),
  acknowledged_at: zISODateString.optional(),
  applied_at: zISODateString.optional(),
});
export type SteeringCommand = z.infer<typeof zSteeringCommand>;
