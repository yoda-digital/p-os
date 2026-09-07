import { z } from 'zod';
import {
  zDecisionId,
  zCaseId,
  zMoveId,
  zEvidenceId,
  zActorId,
  zISODateString,
  zId,
  zSemanticRef,
} from './ids.js';

// ---------------------------------------------------------------------------
// Decision state
// ---------------------------------------------------------------------------

export const DecisionState = {
  Draft: 'draft',
  Requested: 'requested',
  InReview: 'in_review',
  Decided: 'decided',
  Deferred: 'deferred',
  Superseded: 'superseded',
  Cancelled: 'cancelled',
} as const;

export const zDecisionState = z.enum([
  'draft',
  'requested',
  'in_review',
  'decided',
  'deferred',
  'superseded',
  'cancelled',
]);
export type DecisionState = z.infer<typeof zDecisionState>;

// ---------------------------------------------------------------------------
// Decision option
// ---------------------------------------------------------------------------

export const zDecisionOption = z.object({
  id: zId,
  label: z.string().min(1),
  description: z.string().default(''),
  evidence_refs: z.array(zEvidenceId).default([]),
  risks: z.array(z.string()).default([]),
  tradeoffs: z.array(z.string()).default([]),
});
export type DecisionOption = z.infer<typeof zDecisionOption>;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export const zDecision = z.object({
  id: zDecisionId,
  case_id: zCaseId,
  question: z.string().min(1),
  context: z.string().default(''),
  options: z.array(zDecisionOption).default([]),
  evidence_refs: z.array(zEvidenceId).default([]),
  risk_refs: z.array(zSemanticRef).default([]),
  recommended_option: zId.optional(),
  recommendation_confidence: z.number().min(0).max(1).optional(),
  recommendation_rationale: z.string().optional(),
  required_authority: z.array(z.string()).default([]),
  state: zDecisionState.default('draft'),
  selected_option: zId.optional(),
  rationale: z.string().optional(),
  decided_by: zActorId.optional(),
  decided_at: zISODateString.optional(),
  blocking_move_ids: z.array(zMoveId).default([]),
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
});

export type Decision = z.infer<typeof zDecision>;
