import { z } from 'zod';
import {
  zRuleId,
  zCaseId,
  zActorId,
  zISODateString,
  zSemanticRef,
} from './ids.js';

// ---------------------------------------------------------------------------
// Rule type
// ---------------------------------------------------------------------------

export const RuleType = {
  Requirement: 'Requirement',
  Obligation: 'Obligation',
  Prohibition: 'Prohibition',
  Permission: 'Permission',
  Deadline: 'Deadline',
  Policy: 'Policy',
  Invariant: 'Invariant',
  ApprovalRule: 'ApprovalRule',
  BudgetRule: 'BudgetRule',
  SafetyRule: 'SafetyRule',
  RetentionRule: 'RetentionRule',
  SeparationOfDuties: 'SeparationOfDuties',
} as const;

export const zRuleType = z.enum([
  'Requirement',
  'Obligation',
  'Prohibition',
  'Permission',
  'Deadline',
  'Policy',
  'Invariant',
  'ApprovalRule',
  'BudgetRule',
  'SafetyRule',
  'RetentionRule',
  'SeparationOfDuties',
]);
export type RuleType = z.infer<typeof zRuleType>;

// ---------------------------------------------------------------------------
// Rule evaluation status
// ---------------------------------------------------------------------------

export const RuleEvaluationStatus = {
  Satisfied: 'satisfied',
  Unsatisfied: 'unsatisfied',
  Unknown: 'unknown',
  Violated: 'violated',
  Waived: 'waived',
  NotApplicable: 'not_applicable',
  AtRisk: 'at_risk',
} as const;

export const zRuleEvaluationStatus = z.enum([
  'satisfied',
  'unsatisfied',
  'unknown',
  'violated',
  'waived',
  'not_applicable',
  'at_risk',
]);
export type RuleEvaluationStatus = z.infer<typeof zRuleEvaluationStatus>;

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

export const zRule = z.object({
  id: zRuleId,
  case_id: zCaseId,
  type: zRuleType,
  statement: z.string().min(1),
  authority_ref: zSemanticRef.optional(),
  applicability: z.string().default(''),
  predicate: z.record(z.string(), z.unknown()).default({}),
  effective_from: zISODateString.optional(),
  effective_until: zISODateString.optional(),
  supersedes: zRuleId.optional(),
  evaluation_status: zRuleEvaluationStatus.default('unknown'),
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
});

export type Rule = z.infer<typeof zRule>;
