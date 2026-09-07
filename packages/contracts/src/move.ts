import { z } from 'zod';
import {
  zMoveId,
  zCaseId,
  zIntentId,
  zActorId,
  zISODateString,
  zPriority,
  zRiskLevel,
} from './ids.js';
import { zCompletionContract } from './intent.js';

// ---------------------------------------------------------------------------
// Move class
// ---------------------------------------------------------------------------

export const MoveClass = {
  Act: 'ACT',
  Observe: 'OBSERVE',
  Ask: 'ASK',
  Wait: 'WAIT',
  Decide: 'DECIDE',
  Communicate: 'COMMUNICATE',
  Verify: 'VERIFY',
  Delegate: 'DELEGATE',
  Escalate: 'ESCALATE',
  Approve: 'APPROVE',
  Reject: 'REJECT',
  Stop: 'STOP',
} as const;

export const zMoveClass = z.enum([
  'ACT',
  'OBSERVE',
  'ASK',
  'WAIT',
  'DECIDE',
  'COMMUNICATE',
  'VERIFY',
  'DELEGATE',
  'ESCALATE',
  'APPROVE',
  'REJECT',
  'STOP',
]);
export type MoveClass = z.infer<typeof zMoveClass>;

// ---------------------------------------------------------------------------
// Move state vector — 7 independent dimensions
// ---------------------------------------------------------------------------

export const MoveReadiness = {
  NotReady: 'not_ready',
  Ready: 'ready',
  Conditional: 'conditional',
} as const;
export const zMoveReadiness = z.enum(['not_ready', 'ready', 'conditional']);
export type MoveReadiness = z.infer<typeof zMoveReadiness>;

export const MoveExecution = {
  NotStarted: 'not_started',
  Queued: 'queued',
  Starting: 'starting',
  Running: 'running',
  Pausing: 'pausing',
  Paused: 'paused',
  Suspended: 'suspended',
  Finishing: 'finishing',
  Finished: 'finished',
} as const;
export const zMoveExecution = z.enum([
  'not_started',
  'queued',
  'starting',
  'running',
  'pausing',
  'paused',
  'suspended',
  'finishing',
  'finished',
]);
export type MoveExecution = z.infer<typeof zMoveExecution>;

export const MoveVerification = {
  NotRequired: 'not_required',
  Pending: 'pending',
  Running: 'running',
  Passed: 'passed',
  Failed: 'failed',
  Waived: 'waived',
  Stale: 'stale',
} as const;
export const zMoveVerification = z.enum([
  'not_required',
  'pending',
  'running',
  'passed',
  'failed',
  'waived',
  'stale',
]);
export type MoveVerification = z.infer<typeof zMoveVerification>;

export const MoveAttention = {
  Autonomous: 'autonomous',
  Watch: 'watch',
  HumanInput: 'human_input',
  HumanDecision: 'human_decision',
  HumanApproval: 'human_approval',
  CriticalIntervention: 'critical_intervention',
} as const;
export const zMoveAttention = z.enum([
  'autonomous',
  'watch',
  'human_input',
  'human_decision',
  'human_approval',
  'critical_intervention',
]);
export type MoveAttention = z.infer<typeof zMoveAttention>;

export const MoveTemporal = {
  Ahead: 'ahead',
  OnTrack: 'on_track',
  AtRisk: 'at_risk',
  Overdue: 'overdue',
  Expired: 'expired',
} as const;
export const zMoveTemporal = z.enum(['ahead', 'on_track', 'at_risk', 'overdue', 'expired']);
export type MoveTemporal = z.infer<typeof zMoveTemporal>;

export const MoveOutcome = {
  Unsatisfied: 'unsatisfied',
  PartiallySatisfied: 'partially_satisfied',
  Satisfied: 'satisfied',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Superseded: 'superseded',
  Expired: 'expired',
  NotApplicable: 'not_applicable',
  Abandoned: 'abandoned',
} as const;
export const zMoveOutcome = z.enum([
  'unsatisfied',
  'partially_satisfied',
  'satisfied',
  'failed',
  'cancelled',
  'superseded',
  'expired',
  'not_applicable',
  'abandoned',
]);
export type MoveOutcome = z.infer<typeof zMoveOutcome>;

export const zMoveStateVector = z.object({
  readiness: zMoveReadiness.default('not_ready'),
  execution: zMoveExecution.default('not_started'),
  verification: zMoveVerification.default('not_required'),
  attention: zMoveAttention.default('autonomous'),
  risk: zRiskLevel.default('none'),
  temporal: zMoveTemporal.default('on_track'),
  outcome: zMoveOutcome.default('unsatisfied'),
});
export type MoveStateVector = z.infer<typeof zMoveStateVector>;

// ---------------------------------------------------------------------------
// Move
// ---------------------------------------------------------------------------

export const zMove = z.object({
  id: zMoveId,
  case_id: zCaseId,
  class: zMoveClass,
  title: z.string().min(1),
  objective: z.string().default(''),
  intent_refs: z.array(zIntentId).default([]),
  parent_move_id: zMoveId.nullable().default(null),
  preconditions: z.array(z.string()).default([]),
  postconditions: z.array(z.string()).default([]),
  completion_contract: zCompletionContract.optional(),
  required_capabilities: z.array(z.string()).default([]),
  required_authority: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  dependencies: z.array(zMoveId).default([]),
  priority: zPriority.default('medium'),
  risk: zRiskLevel.default('none'),
  deadline: zISODateString.optional(),
  execution_policy: z
    .object({
      max_attempts: z.number().int().positive().default(3),
      timeout_seconds: z.number().int().positive().optional(),
      preferred_executor: z.string().optional(),
      preferred_strategy: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
      isolation: z.enum(['none', 'worktree', 'container']).default('none'),
    })
    .default({}),
  assigned_actor_ids: z.array(zActorId).default([]),
  state: zMoveStateVector.default({
    readiness: 'not_ready',
    execution: 'not_started',
    verification: 'not_required',
    attention: 'autonomous',
    risk: 'none',
    temporal: 'on_track',
    outcome: 'unsatisfied',
  }),
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
});

export type Move = z.infer<typeof zMove>;
