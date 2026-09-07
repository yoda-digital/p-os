import { z } from 'zod';
import {
  zCommandId,
  zOrganizationId,
  zCaseId,
  zActorId,
  zISODateString,
  zSemanticRef,
  zId,
  zMoveId,
  zAttemptId,
  zEvidenceId,
  zDecisionId,
  zEntityId,
  zRelationId,
  zAssertionId,
  zIntentId,
  zRuleId,
  zResourceId,
  zExecutorId,
  zPriority,
  zRiskLevel,
} from './ids.js';
import { zMoveClass } from './move.js';
import { zCaseLifecycle } from './case.js';
import { zIntentClass, zIntentStatus, zCompletionContract } from './intent.js';
import { zRelationType } from './relation.js';
import { zAssertionModality } from './assertion.js';
import { zRuleType } from './rule.js';
import { zEvidenceRelation } from './evidence.js';
import { zDecisionState } from './decision.js';
import { zExecutionStrategy } from './attempt.js';

// ---------------------------------------------------------------------------
// Command envelope
// ---------------------------------------------------------------------------

export const zCommandEnvelope = z.object({
  command_id: zCommandId,
  type: z.string().min(1),
  tenant_id: zOrganizationId,
  case_id: zCaseId.optional(),
  actor_id: zActorId,
  target_ref: zSemanticRef.optional(),
  expected_revision: z.number().int().nonnegative().optional(),
  issued_at: zISODateString,
  expires_at: zISODateString.optional(),
  idempotency_key: z.string().optional(),
  payload: z.unknown(),
});

export type CommandEnvelope = z.infer<typeof zCommandEnvelope>;

// ---------------------------------------------------------------------------
// Command result
// ---------------------------------------------------------------------------

export const zCommandResultStatus = z.enum([
  'accepted',
  'rejected',
  'conflict',
  'deferred',
  'expired',
  'unauthorized',
  'unsupported',
]);
export type CommandResultStatus = z.infer<typeof zCommandResultStatus>;

export const zCommandResult = z.object({
  status: zCommandResultStatus,
  command_id: zCommandId,
  events: z.array(z.unknown()).default([]),
  reason: z.string().optional(),
  new_revision: z.number().int().nonnegative().optional(),
});
export type CommandResult = z.infer<typeof zCommandResult>;

// ---------------------------------------------------------------------------
// Command types — comprehensive enumeration
// ---------------------------------------------------------------------------

export const CommandType = {
  // Case
  CaseCreate: 'case.create',
  CaseUpdate: 'case.update',
  CaseClose: 'case.close',
  CaseReopen: 'case.reopen',
  CaseArchive: 'case.archive',
  CaseVoid: 'case.void',

  // Entity
  EntityCreate: 'entity.create',
  EntityUpdate: 'entity.update',
  EntityRemove: 'entity.remove',

  // Relation
  RelationAdd: 'relation.add',
  RelationRemove: 'relation.remove',
  RelationUpdate: 'relation.update',

  // Assertion
  AssertionCreate: 'assertion.create',
  AssertionUpdate: 'assertion.update',
  AssertionRetract: 'assertion.retract',

  // Intent
  IntentCreate: 'intent.create',
  IntentUpdate: 'intent.update',
  IntentSatisfy: 'intent.satisfy',
  IntentFail: 'intent.fail',
  IntentAbandon: 'intent.abandon',

  // Rule
  RuleCreate: 'rule.create',
  RuleUpdate: 'rule.update',
  RuleSupersede: 'rule.supersede',
  RuleEvaluate: 'rule.evaluate',

  // Actor
  ActorCreate: 'actor.create',
  ActorUpdate: 'actor.update',

  // Resource
  ResourceCreate: 'resource.create',
  ResourceUpdate: 'resource.update',
  ResourceReserve: 'resource.reserve',
  ResourceRelease: 'resource.release',

  // Move
  MoveCreate: 'move.create',
  MoveEdit: 'move.edit',
  MoveActivate: 'move.activate',
  MovePause: 'move.pause',
  MoveResume: 'move.resume',
  MoveCancel: 'move.cancel',
  MoveSupersede: 'move.supersede',
  MoveChangePriority: 'move.change_priority',
  MoveChangeDeadline: 'move.change_deadline',
  MoveAssign: 'move.assign',
  MoveRequestReadiness: 'move.request_readiness',
  MoveRequestActivation: 'move.request_activation',
  MoveRequestSatisfaction: 'move.request_satisfaction',

  // Attempt
  AttemptStart: 'attempt.start',
  AttemptUpdateProgress: 'attempt.update_progress',
  AttemptSteer: 'attempt.steer',
  AttemptPause: 'attempt.pause',
  AttemptResume: 'attempt.resume',
  AttemptCancel: 'attempt.cancel',
  AttemptSucceed: 'attempt.succeed',
  AttemptFail: 'attempt.fail',

  // Evidence
  EvidenceAttach: 'evidence.attach',
  EvidenceInvalidate: 'evidence.invalidate',
  EvidenceDispute: 'evidence.dispute',

  // Decision
  DecisionCreate: 'decision.create',
  DecisionUpdate: 'decision.update',
  DecisionResolve: 'decision.resolve',
  DecisionDefer: 'decision.defer',
  DecisionSupersede: 'decision.supersede',
} as const;

export type CommandType = (typeof CommandType)[keyof typeof CommandType];

// ---------------------------------------------------------------------------
// Command payloads
// ---------------------------------------------------------------------------

// Case commands
export const zCaseCreatePayload = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  description: z.string().default(''),
  workspace_id: z.string(),
  pack_refs: z.array(zSemanticRef).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type CaseCreatePayload = z.infer<typeof zCaseCreatePayload>;

export const zCaseUpdatePayload = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CaseUpdatePayload = z.infer<typeof zCaseUpdatePayload>;

export const zCaseClosePayload = z.object({ reason: z.string().optional() });
export const zCaseReopenPayload = z.object({ reason: z.string().optional() });
export const zCaseArchivePayload = z.object({});
export const zCaseVoidPayload = z.object({ reason: z.string().min(1) });

// Entity commands
export const zEntityCreatePayload = z.object({
  case_id: zCaseId,
  type: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  properties: z.record(z.string(), z.unknown()).default({}),
});
export type EntityCreatePayload = z.infer<typeof zEntityCreatePayload>;

export const zEntityUpdatePayload = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
});

export const zEntityRemovePayload = z.object({ reason: z.string().optional() });

// Relation commands
export const zRelationAddPayload = z.object({
  case_id: zCaseId,
  source_ref: zSemanticRef,
  target_ref: zSemanticRef,
  type: zRelationType,
  qualifier: z.string().optional(),
  confidence: z.number().min(0).max(1).default(1),
});
export type RelationAddPayload = z.infer<typeof zRelationAddPayload>;

export const zRelationRemovePayload = z.object({ reason: z.string().optional() });
export const zRelationUpdatePayload = z.object({
  type: zRelationType.optional(),
  qualifier: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

// Assertion commands
export const zAssertionCreatePayload = z.object({
  case_id: zCaseId,
  subject_ref: zSemanticRef,
  predicate: z.string().min(1),
  value: z.unknown(),
  modality: zAssertionModality,
  source_refs: z.array(zSemanticRef).default([]),
  confidence: z.number().min(0).max(1).default(1),
});
export type AssertionCreatePayload = z.infer<typeof zAssertionCreatePayload>;

export const zAssertionUpdatePayload = z.object({
  value: z.unknown().optional(),
  modality: zAssertionModality.optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export const zAssertionRetractPayload = z.object({ reason: z.string().min(1) });

// Intent commands
export const zIntentCreatePayload = z.object({
  case_id: zCaseId,
  class: zIntentClass,
  statement: z.string().min(1),
  priority: zPriority.default('medium'),
  success_contract: zCompletionContract.optional(),
  constraints: z.array(z.string()).default([]),
});
export type IntentCreatePayload = z.infer<typeof zIntentCreatePayload>;

export const zIntentUpdatePayload = z.object({
  statement: z.string().optional(),
  priority: zPriority.optional(),
  status: zIntentStatus.optional(),
});
export const zIntentSatisfyPayload = z.object({ evidence_refs: z.array(z.string()).default([]) });
export const zIntentFailPayload = z.object({ reason: z.string().min(1) });
export const zIntentAbandonPayload = z.object({ reason: z.string().min(1) });

// Rule commands
export const zRuleCreatePayload = z.object({
  case_id: zCaseId,
  type: zRuleType,
  statement: z.string().min(1),
  authority_ref: zSemanticRef.optional(),
  applicability: z.string().default(''),
  predicate: z.record(z.string(), z.unknown()).default({}),
});
export type RuleCreatePayload = z.infer<typeof zRuleCreatePayload>;

export const zRuleUpdatePayload = z.object({
  statement: z.string().optional(),
  predicate: z.record(z.string(), z.unknown()).optional(),
});
export const zRuleSupersedepayload = z.object({ new_rule_id: zRuleId });
export const zRuleEvaluatePayload = z.object({
  status: z.string(),
  evidence_refs: z.array(z.string()).default([]),
});

// Actor commands
export const zActorCreatePayload = z.object({
  class: z.string().min(1),
  display_name: z.string().min(1),
  roles: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
});
export type ActorCreatePayload = z.infer<typeof zActorCreatePayload>;

export const zActorUpdatePayload = z.object({
  display_name: z.string().optional(),
  roles: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
});

// Resource commands
export const zResourceCreatePayload = z.object({
  case_id: zCaseId,
  type: z.string().min(1),
  name: z.string().min(1),
  capacity: z.number().nonnegative().default(0),
  cost_per_unit: z.number().nonnegative().default(0),
  consumable: z.boolean().default(true),
});
export type ResourceCreatePayload = z.infer<typeof zResourceCreatePayload>;

export const zResourceUpdatePayload = z.object({
  capacity: z.number().nonnegative().optional(),
  cost_per_unit: z.number().nonnegative().optional(),
});
export const zResourceReservePayload = z.object({ amount: z.number().positive() });
export const zResourceReleasePayload = z.object({ amount: z.number().positive() });

// Move commands
export const zMoveCreatePayload = z.object({
  case_id: zCaseId,
  class: zMoveClass,
  title: z.string().min(1),
  objective: z.string().default(''),
  intent_refs: z.array(z.string()).default([]),
  parent_move_id: z.string().nullable().default(null),
  dependencies: z.array(z.string()).default([]),
  priority: zPriority.default('medium'),
  risk: zRiskLevel.default('none'),
  deadline: z.string().optional(),
  assigned_actor_ids: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  completion_contract: zCompletionContract.optional(),
});
export type MoveCreatePayload = z.infer<typeof zMoveCreatePayload>;

export const zMoveEditPayload = z.object({
  title: z.string().optional(),
  objective: z.string().optional(),
  constraints: z.array(z.string()).optional(),
});
export type MoveEditPayload = z.infer<typeof zMoveEditPayload>;

export const zMoveActivatePayload = z.object({});
export const zMovePausePayload = z.object({ reason: z.string().optional() });
export const zMoveResumePayload = z.object({});
export const zMoveCancelPayload = z.object({ reason: z.string().min(1) });
export const zMoveSupersedepayload = z.object({ new_move_id: zMoveId });
export const zMoveChangePriorityPayload = z.object({ priority: zPriority });
export const zMoveChangeDeadlinePayload = z.object({ deadline: z.string() });
export const zMoveAssignPayload = z.object({ actor_ids: z.array(z.string()).min(1) });
export const zMoveRequestReadinessPayload = z.object({});
export const zMoveRequestActivationPayload = z.object({});
export const zMoveRequestSatisfactionPayload = z.object({
  evidence_refs: z.array(z.string()).default([]),
});

// Attempt commands
export const zAttemptStartPayload = z.object({
  move_id: zMoveId,
  executor_id: zExecutorId,
  strategy: zExecutionStrategy,
  model: z.string().optional(),
  effort: z.string().optional(),
});
export type AttemptStartPayload = z.infer<typeof zAttemptStartPayload>;

export const zAttemptUpdateProgressPayload = z.object({
  progress: z.number().min(0).max(1).optional(),
  message: z.string().optional(),
  artifacts: z.array(zSemanticRef).optional(),
});
export const zAttemptSteerPayload = z.object({
  class: z.enum(['advisory', 'constraint', 'redirect', 'pause', 'hard_stop', 'fork', 'reassign']),
  instruction: z.string().min(1),
});
export const zAttemptPausePayload = z.object({ reason: z.string().optional() });
export const zAttemptResumePayload = z.object({});
export const zAttemptCancelPayload = z.object({ reason: z.string().optional() });
export const zAttemptSucceedPayload = z.object({
  evidence_refs: z.array(z.string()).default([]),
  artifacts: z.array(zSemanticRef).default([]),
});
export const zAttemptFailPayload = z.object({
  reason: z.string().min(1),
  retriable: z.boolean().default(true),
});

// Evidence commands
export const zEvidenceAttachPayload = z.object({
  case_id: zCaseId,
  subject_refs: z.array(zSemanticRef).min(1),
  relation: zEvidenceRelation,
  scope: z.object({ description: z.string(), params: z.record(z.string(), z.unknown()).default({}) }),
  artifact_ref: zSemanticRef.optional(),
  source_ref: zSemanticRef.optional(),
  confidence: z.number().min(0).max(1).default(1),
  fresh_until: z.string().optional(),
});
export type EvidenceAttachPayload = z.infer<typeof zEvidenceAttachPayload>;

export const zEvidenceInvalidatePayload = z.object({ reason: z.string().min(1) });
export const zEvidenceDisputePayload = z.object({ reason: z.string().min(1) });

// Decision commands
export const zDecisionCreatePayload = z.object({
  case_id: zCaseId,
  question: z.string().min(1),
  context: z.string().default(''),
  options: z.array(z.object({
    label: z.string().min(1),
    description: z.string().default(''),
  })).default([]),
  required_authority: z.array(z.string()).default([]),
  blocking_move_ids: z.array(z.string()).default([]),
});
export type DecisionCreatePayload = z.infer<typeof zDecisionCreatePayload>;

export const zDecisionUpdatePayload = z.object({
  context: z.string().optional(),
  options: z.array(z.object({
    label: z.string().min(1),
    description: z.string().default(''),
  })).optional(),
});
export const zDecisionResolvePayload = z.object({
  selected_option: z.string().min(1),
  rationale: z.string().optional(),
});
export const zDecisionDeferPayload = z.object({ reason: z.string().min(1) });
export const zDecisionSupersedepayload = z.object({ new_decision_id: zDecisionId });
