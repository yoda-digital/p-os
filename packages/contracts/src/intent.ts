import { z } from 'zod';
import {
  zIntentId,
  zCaseId,
  zActorId,
  zISODateString,
  zPriority,
  zSemanticRef,
} from './ids.js';

// ---------------------------------------------------------------------------
// Intent class
// ---------------------------------------------------------------------------

export const IntentClass = {
  Achieve: 'ACHIEVE',
  Maintain: 'MAINTAIN',
  Avoid: 'AVOID',
  Learn: 'LEARN',
  Decide: 'DECIDE',
  Explore: 'EXPLORE',
  Negotiate: 'NEGOTIATE',
  Create: 'CREATE',
  Recover: 'RECOVER',
  Comply: 'COMPLY',
  Monitor: 'MONITOR',
} as const;

export const zIntentClass = z.enum([
  'ACHIEVE',
  'MAINTAIN',
  'AVOID',
  'LEARN',
  'DECIDE',
  'EXPLORE',
  'NEGOTIATE',
  'CREATE',
  'RECOVER',
  'COMPLY',
  'MONITOR',
]);
export type IntentClass = z.infer<typeof zIntentClass>;

// ---------------------------------------------------------------------------
// Intent status
// ---------------------------------------------------------------------------

export const IntentStatus = {
  Active: 'active',
  Suspended: 'suspended',
  Satisfied: 'satisfied',
  Failed: 'failed',
  Abandoned: 'abandoned',
  Superseded: 'superseded',
} as const;

export const zIntentStatus = z.enum([
  'active',
  'suspended',
  'satisfied',
  'failed',
  'abandoned',
  'superseded',
]);
export type IntentStatus = z.infer<typeof zIntentStatus>;

// ---------------------------------------------------------------------------
// Completion contract (shared by Intent and Move)
// ---------------------------------------------------------------------------

export const zCompletionContract = z.object({
  description: z.string().default(''),
  predicates: z
    .array(
      z.object({
        type: z.enum(['evidence_required', 'approval_required', 'external_state', 'threshold', 'all', 'any']),
        description: z.string(),
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default([]),
});
export type CompletionContract = z.infer<typeof zCompletionContract>;

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export const zIntent = z.object({
  id: zIntentId,
  case_id: zCaseId,
  class: zIntentClass,
  statement: z.string().min(1),
  priority: zPriority.default('medium'),
  owner_refs: z.array(zSemanticRef).default([]),
  success_contract: zCompletionContract.optional(),
  stop_contract: zCompletionContract.optional(),
  failure_contract: zCompletionContract.optional(),
  status: zIntentStatus.default('active'),
  constraints: z.array(z.string()).default([]),
  dependencies: z.array(zIntentId).default([]),
  conflict_refs: z.array(zIntentId).default([]),
  confidence: z.number().min(0).max(1).default(1),
  time_horizon: z.string().optional(), // e.g. '2026-12-31', 'indefinite'
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
});

export type Intent = z.infer<typeof zIntent>;
