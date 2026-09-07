import { z } from 'zod';
import { zId, zCaseId, zMoveId, zAttemptId, zISODateString, zSemanticRef } from './ids.js';

// ---------------------------------------------------------------------------
// Context action
// ---------------------------------------------------------------------------

export const ContextAction = {
  Continue: 'CONTINUE',
  CompactRecommended: 'COMPACT_RECOMMENDED',
  RotateFresh: 'ROTATE_FRESH',
  Resume: 'RESUME',
  Fork: 'FORK',
  OffloadSubagent: 'OFFLOAD_SUBAGENT',
  OffloadWorkflow: 'OFFLOAD_WORKFLOW',
} as const;

export const zContextAction = z.enum([
  'CONTINUE',
  'COMPACT_RECOMMENDED',
  'ROTATE_FRESH',
  'RESUME',
  'FORK',
  'OFFLOAD_SUBAGENT',
  'OFFLOAD_WORKFLOW',
]);
export type ContextAction = z.infer<typeof zContextAction>;

// ---------------------------------------------------------------------------
// Context health
// ---------------------------------------------------------------------------

export const zContextHealth = z.object({
  token_pressure: z.number().min(0).max(1).default(0),
  relevance_density: z.number().min(0).max(1).default(1),
  stale_assumption_density: z.number().min(0).max(1).default(0),
  contradiction_density: z.number().min(0).max(1).default(0),
  tool_output_bloat: z.number().min(0).max(1).default(0),
  phase_shift: z.number().int().nonnegative().default(0),
  pivot_count: z.number().int().nonnegative().default(0),
  remaining_expected_work: z.number().min(0).max(1).default(1),
  resume_cache_cost: z.number().nonnegative().default(0),
});
export type ContextHealth = z.infer<typeof zContextHealth>;

// ---------------------------------------------------------------------------
// Context capsule sections
// ---------------------------------------------------------------------------

export const zContextCapsuleSections = z.object({
  identity: z.string().default(''),
  intent: z.string().default(''),
  reality: z.string().default(''),
  decisions: z.string().default(''),
  constraints: z.string().default(''),
  progress: z.string().default(''),
  dependencies: z.string().default(''),
  evidence: z.string().default(''),
  delta: z.string().default(''),
  next: z.string().default(''),
  do_not_repeat: z.string().default(''),
});
export type ContextCapsuleSections = z.infer<typeof zContextCapsuleSections>;

// ---------------------------------------------------------------------------
// Context capsule
// ---------------------------------------------------------------------------

export const zContextCapsule = z.object({
  capsule_id: zId,
  case_id: zCaseId,
  case_revision: z.number().int().nonnegative(),
  move_id: zMoveId.optional(),
  move_revision: z.number().int().nonnegative().optional(),
  attempt_id: zAttemptId.optional(),
  generated_at: zISODateString,
  generator_version: z.string().default('1.0.0'),
  sections: zContextCapsuleSections,
  included_object_refs: z.array(zSemanticRef).default([]),
  token_estimate: z.number().int().nonnegative().default(0),
});
export type ContextCapsule = z.infer<typeof zContextCapsule>;
