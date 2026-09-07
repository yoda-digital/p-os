import { z } from 'zod';
import type { CaseId, MoveId, ActorId, EvidenceId, DecisionId, AttemptId, ExecutorId } from './ids.js';
import { zCaseId, zMoveId, zActorId, zEvidenceId, zDecisionId, zAttemptId, zExecutorId, zISODateString, zPriority, zRiskLevel, zSemanticRef } from './ids.js';
import { zCaseLifecycle } from './case.js';
import { zMoveStateVector, zMoveClass } from './move.js';
import { zAttemptState, zExecutionStrategy } from './attempt.js';
import { zEvidenceValidity } from './evidence.js';
import { zDecisionState } from './decision.js';
import { zRuleEvaluationStatus } from './rule.js';

// ---------------------------------------------------------------------------
// Kanban column
// ---------------------------------------------------------------------------

export const KanbanColumn = {
  Backlog: 'BACKLOG',
  Ready: 'READY',
  Active: 'ACTIVE',
  Waiting: 'WAITING',
  NeedsInput: 'NEEDS_INPUT',
  Verify: 'VERIFY',
  Done: 'DONE',
} as const;

export const zKanbanColumn = z.enum([
  'BACKLOG',
  'READY',
  'ACTIVE',
  'WAITING',
  'NEEDS_INPUT',
  'VERIFY',
  'DONE',
]);
export type KanbanColumn = z.infer<typeof zKanbanColumn>;

// ---------------------------------------------------------------------------
// Kanban card
// ---------------------------------------------------------------------------

export const zKanbanCard = z.object({
  move_id: zMoveId,
  case_id: zCaseId,
  title: z.string(),
  class: zMoveClass,
  executor: z.string().optional(),
  executor_id: zActorId.optional(),
  state: zMoveStateVector,
  priority: zPriority,
  risk: zRiskLevel,
  deadline: zISODateString.optional(),
  verification: z.string().optional(),
  evidence_progress: z.object({
    total: z.number().int().nonnegative(),
    satisfied: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
  }).default({ total: 0, satisfied: 0, stale: 0 }),
  dependencies: z.object({
    total: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    blocking: z.number().int().nonnegative(),
  }).default({ total: 0, resolved: 0, blocking: 0 }),
  attention_state: z.string().default('autonomous'),
  current_activity: z.string().optional(),
  attempt_count: z.number().int().nonnegative().default(0),
  child_move_count: z.number().int().nonnegative().default(0),
  column: zKanbanColumn,
});
export type KanbanCard = z.infer<typeof zKanbanCard>;

// ---------------------------------------------------------------------------
// Kanban projection
// ---------------------------------------------------------------------------

export const zKanbanProjection = z.object({
  case_id: zCaseId,
  columns: z.record(zKanbanColumn, z.array(zKanbanCard)),
  updated_at: zISODateString,
});
export type KanbanProjection = z.infer<typeof zKanbanProjection>;

// ---------------------------------------------------------------------------
// Case summary
// ---------------------------------------------------------------------------

export const zCaseSummary = z.object({
  case_id: zCaseId,
  title: z.string(),
  type: z.string(),
  lifecycle: zCaseLifecycle,
  intent_count: z.number().int().nonnegative(),
  move_count: z.number().int().nonnegative(),
  active_move_count: z.number().int().nonnegative(),
  completed_move_count: z.number().int().nonnegative(),
  blocked_move_count: z.number().int().nonnegative(),
  decision_count: z.number().int().nonnegative(),
  pending_decision_count: z.number().int().nonnegative(),
  evidence_count: z.number().int().nonnegative(),
  stale_evidence_count: z.number().int().nonnegative(),
  active_attempt_count: z.number().int().nonnegative(),
  attention_items: z.number().int().nonnegative(),
  owner_names: z.array(z.string()),
  created_at: zISODateString,
  updated_at: zISODateString,
});
export type CaseSummary = z.infer<typeof zCaseSummary>;

// ---------------------------------------------------------------------------
// Move state projection
// ---------------------------------------------------------------------------

export const zMoveStateProjection = z.object({
  move_id: zMoveId,
  case_id: zCaseId,
  title: z.string(),
  class: zMoveClass,
  state: zMoveStateVector,
  priority: zPriority,
  risk: zRiskLevel,
  deadline: zISODateString.optional(),
  assigned_actors: z.array(z.string()),
  parent_move_id: zMoveId.nullable(),
  dependencies: z.array(zMoveId),
  child_move_ids: z.array(zMoveId),
  attempt_count: z.number().int().nonnegative(),
  active_attempt_id: zAttemptId.optional(),
  evidence_count: z.number().int().nonnegative(),
  updated_at: zISODateString,
});
export type MoveStateProjection = z.infer<typeof zMoveStateProjection>;

// ---------------------------------------------------------------------------
// Attention item
// ---------------------------------------------------------------------------

export const zAttentionItem = z.object({
  id: z.string(),
  case_id: zCaseId,
  move_id: zMoveId.optional(),
  decision_id: zDecisionId.optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  reason: z.string(),
  action_required: z.string(),
  deadline: zISODateString.optional(),
  blocking_impact: z.number().int().nonnegative().default(0),
  raised_at: zISODateString,
  resolved_at: zISODateString.optional(),
});
export type AttentionItem = z.infer<typeof zAttentionItem>;

// ---------------------------------------------------------------------------
// Timeline entry
// ---------------------------------------------------------------------------

export const zTimelineEntry = z.object({
  event_id: z.string(),
  case_id: zCaseId,
  type: z.string(),
  actor_name: z.string(),
  summary: z.string(),
  occurred_at: zISODateString,
  target_ref: zSemanticRef.optional(),
  data: z.unknown(),
});
export type TimelineEntry = z.infer<typeof zTimelineEntry>;

// ---------------------------------------------------------------------------
// Dependency node
// ---------------------------------------------------------------------------

export const zDependencyNode = z.object({
  move_id: zMoveId,
  title: z.string(),
  state: zMoveStateVector,
  depends_on: z.array(zMoveId),
  depended_by: z.array(zMoveId),
});
export type DependencyNode = z.infer<typeof zDependencyNode>;

// ---------------------------------------------------------------------------
// Evidence status
// ---------------------------------------------------------------------------

export const zEvidenceStatusProjection = z.object({
  evidence_id: zEvidenceId,
  case_id: zCaseId,
  relation: z.string(),
  scope_description: z.string(),
  validity: zEvidenceValidity,
  confidence: z.number(),
  subject_refs: z.array(zSemanticRef),
  observed_at: zISODateString,
  fresh_until: zISODateString.optional(),
});
export type EvidenceStatusProjection = z.infer<typeof zEvidenceStatusProjection>;

// ---------------------------------------------------------------------------
// Rule compliance
// ---------------------------------------------------------------------------

export const zRuleCompliance = z.object({
  rule_id: z.string(),
  case_id: zCaseId,
  type: z.string(),
  statement: z.string(),
  status: zRuleEvaluationStatus,
  evidence_refs: z.array(z.string()),
  last_evaluated_at: zISODateString.optional(),
});
export type RuleCompliance = z.infer<typeof zRuleCompliance>;

// ---------------------------------------------------------------------------
// Decision queue item
// ---------------------------------------------------------------------------

export const zDecisionQueueItem = z.object({
  decision_id: zDecisionId,
  case_id: zCaseId,
  question: z.string(),
  state: zDecisionState,
  option_count: z.number().int().nonnegative(),
  blocking_move_count: z.number().int().nonnegative(),
  has_recommendation: z.boolean(),
  required_authority: z.array(z.string()),
  created_at: zISODateString,
});
export type DecisionQueueItem = z.infer<typeof zDecisionQueueItem>;

// ---------------------------------------------------------------------------
// Executor status
// ---------------------------------------------------------------------------

export const zExecutorStatus = z.object({
  executor_id: zExecutorId,
  name: z.string(),
  type: z.string(),
  status: z.enum(['online', 'busy', 'offline', 'error']),
  active_attempt_count: z.number().int().nonnegative(),
  capabilities: z.array(z.string()),
  last_seen: zISODateString.optional(),
});
export type ExecutorStatus = z.infer<typeof zExecutorStatus>;

// ---------------------------------------------------------------------------
// Context status
// ---------------------------------------------------------------------------

export const zContextStatus = z.object({
  session_binding_id: z.string().optional(),
  case_id: zCaseId,
  move_id: zMoveId.optional(),
  attempt_id: zAttemptId.optional(),
  health: z.object({
    token_pressure: z.number().min(0).max(1),
    relevance_density: z.number().min(0).max(1),
    stale_assumption_density: z.number().min(0).max(1),
    tool_output_bloat: z.number().min(0).max(1),
    phase_shift: z.number().int().nonnegative(),
    pivot_count: z.number().int().nonnegative(),
    remaining_expected_work: z.number().min(0).max(1),
  }),
  recommended_action: z.enum([
    'CONTINUE',
    'COMPACT_RECOMMENDED',
    'ROTATE_FRESH',
    'RESUME',
    'FORK',
    'OFFLOAD_SUBAGENT',
    'OFFLOAD_WORKFLOW',
  ]),
  updated_at: zISODateString,
});
export type ContextStatus = z.infer<typeof zContextStatus>;

// ---------------------------------------------------------------------------
// Cost summary
// ---------------------------------------------------------------------------

export const zCostSummary = z.object({
  case_id: zCaseId,
  total_input_tokens: z.number().int().nonnegative(),
  total_output_tokens: z.number().int().nonnegative(),
  total_cache_tokens: z.number().int().nonnegative(),
  total_monetary_cost: z.number().nonnegative(),
  currency: z.string().default('USD'),
  total_duration_seconds: z.number().nonnegative(),
  attempt_count: z.number().int().nonnegative(),
  by_model: z.record(z.string(), z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cost: z.number().nonnegative(),
  })).default({}),
  updated_at: zISODateString,
});
export type CostSummary = z.infer<typeof zCostSummary>;
