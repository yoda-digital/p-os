import { z } from 'zod';
import { zEventId, zOrganizationId, zCaseId, zActorId, zISODateString } from './ids.js';

// ---------------------------------------------------------------------------
// Event types — comprehensive enumeration
// ---------------------------------------------------------------------------

export const EventType = {
  // Case
  CaseCreated: 'case.created',
  CaseUpdated: 'case.updated',
  CaseClosed: 'case.closed',
  CaseReopened: 'case.reopened',
  CaseArchived: 'case.archived',
  CaseVoided: 'case.voided',

  // Entity
  EntityCreated: 'entity.created',
  EntityUpdated: 'entity.updated',
  EntityRemoved: 'entity.removed',

  // Relation
  RelationAdded: 'relation.added',
  RelationRemoved: 'relation.removed',
  RelationUpdated: 'relation.updated',

  // Assertion
  AssertionCreated: 'assertion.created',
  AssertionUpdated: 'assertion.updated',
  AssertionRetracted: 'assertion.retracted',

  // Intent
  IntentCreated: 'intent.created',
  IntentUpdated: 'intent.updated',
  IntentSatisfied: 'intent.satisfied',
  IntentFailed: 'intent.failed',
  IntentAbandoned: 'intent.abandoned',

  // Rule
  RuleCreated: 'rule.created',
  RuleUpdated: 'rule.updated',
  RuleSuperseded: 'rule.superseded',
  RuleEvaluated: 'rule.evaluated',

  // Actor
  ActorCreated: 'actor.created',
  ActorUpdated: 'actor.updated',

  // Resource
  ResourceCreated: 'resource.created',
  ResourceUpdated: 'resource.updated',
  ResourceReserved: 'resource.reserved',
  ResourceReleased: 'resource.released',

  // Move
  MoveCreated: 'move.created',
  MoveUpdated: 'move.updated',
  MoveActivated: 'move.activated',
  MovePaused: 'move.paused',
  MoveResumed: 'move.resumed',
  MoveCancelled: 'move.cancelled',
  MoveSuperseded: 'move.superseded',
  MoveSatisfied: 'move.satisfied',
  MoveFailed: 'move.failed',
  MoveAbandoned: 'move.abandoned',

  // Attempt
  AttemptStarted: 'attempt.started',
  AttemptProgressUpdated: 'attempt.progress_updated',
  AttemptSteered: 'attempt.steered',
  AttemptPaused: 'attempt.paused',
  AttemptResumed: 'attempt.resumed',
  AttemptSucceeded: 'attempt.succeeded',
  AttemptFailed: 'attempt.failed',
  AttemptCancelled: 'attempt.cancelled',
  AttemptInterrupted: 'attempt.interrupted',
  AttemptTimedOut: 'attempt.timed_out',
  AttemptLost: 'attempt.lost',

  // Evidence
  EvidenceAttached: 'evidence.attached',
  EvidenceInvalidated: 'evidence.invalidated',
  EvidenceDisputed: 'evidence.disputed',

  // Decision
  DecisionCreated: 'decision.created',
  DecisionUpdated: 'decision.updated',
  DecisionResolved: 'decision.resolved',
  DecisionDeferred: 'decision.deferred',
  DecisionSuperseded: 'decision.superseded',

  // Steering
  SteeringIssued: 'steering.issued',
  SteeringDelivered: 'steering.delivered',
  SteeringAcknowledged: 'steering.acknowledged',
  SteeringApplied: 'steering.applied',

  // External
  ExternalEventObserved: 'external.event_observed',

  // Controllers
  CompletionEvaluated: 'completion.evaluated',
  PolicyEvaluated: 'policy.evaluated',
  AttentionRaised: 'attention.raised',
  AttentionResolved: 'attention.resolved',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export const zEventType = z.string().min(1);

// ---------------------------------------------------------------------------
// Event envelope (CloudEvents-compatible + Process OS extensions)
// ---------------------------------------------------------------------------

export const zProcessEvent = z.object({
  id: zEventId,
  tenant_id: zOrganizationId,
  case_id: zCaseId,
  type: zEventType,
  actor_id: zActorId,
  occurred_at: zISODateString,
  recorded_at: zISODateString,
  causation_id: z.string().min(1),
  correlation_id: z.string().min(1),
  case_sequence: z.number().int().nonnegative(),
  data: z.unknown(),
});

export type ProcessEvent = z.infer<typeof zProcessEvent>;

// ---------------------------------------------------------------------------
// Event data payloads — typed per event type
// ---------------------------------------------------------------------------

export const zCaseCreatedData = z.object({
  title: z.string(),
  type: z.string(),
  description: z.string().optional(),
  pack_refs: z.array(z.object({ id: z.string(), type: z.string() })).optional(),
});
export type CaseCreatedData = z.infer<typeof zCaseCreatedData>;

export const zMoveCreatedData = z.object({
  move_id: z.string(),
  class: z.string(),
  title: z.string(),
  objective: z.string().optional(),
  priority: z.string().optional(),
  risk: z.string().optional(),
  parent_move_id: z.string().nullable().optional(),
  dependencies: z.array(z.string()).optional(),
  assigned_actor_ids: z.array(z.string()).optional(),
});
export type MoveCreatedData = z.infer<typeof zMoveCreatedData>;

export const zMoveStateChangedData = z.object({
  move_id: z.string(),
  previous_state: z.record(z.string(), z.string()).optional(),
  new_state: z.record(z.string(), z.string()),
  reason: z.string().optional(),
});
export type MoveStateChangedData = z.infer<typeof zMoveStateChangedData>;

export const zAttemptStartedData = z.object({
  attempt_id: z.string(),
  move_id: z.string(),
  executor_id: z.string(),
  strategy: z.string(),
  model: z.string().optional(),
});
export type AttemptStartedData = z.infer<typeof zAttemptStartedData>;

export const zEvidenceAttachedData = z.object({
  evidence_id: z.string(),
  subject_refs: z.array(z.object({ id: z.string(), type: z.string() })),
  relation: z.string(),
  scope: z.object({ description: z.string() }),
});
export type EvidenceAttachedData = z.infer<typeof zEvidenceAttachedData>;

export const zDecisionResolvedData = z.object({
  decision_id: z.string(),
  selected_option: z.string(),
  rationale: z.string().optional(),
});
export type DecisionResolvedData = z.infer<typeof zDecisionResolvedData>;

export const zSteeringIssuedData = z.object({
  steering_id: z.string(),
  move_id: z.string(),
  attempt_id: z.string().optional(),
  class: z.string(),
  instruction: z.string(),
});
export type SteeringIssuedData = z.infer<typeof zSteeringIssuedData>;

export const zGenericEventData = z.record(z.string(), z.unknown());
export type GenericEventData = z.infer<typeof zGenericEventData>;
