import { z } from 'zod';
import { zCaseId, zISODateString } from './ids.js';

// ---------------------------------------------------------------------------
// Process metrics
// ---------------------------------------------------------------------------

export const zProcessMetrics = z.object({
  case_id: zCaseId,
  cycle_time: z.number().nonnegative().default(0), // seconds
  waiting_time: z.number().nonnegative().default(0),
  rework_count: z.number().int().nonnegative().default(0),
  failed_attempts: z.number().int().nonnegative().default(0),
  human_attention_time: z.number().nonnegative().default(0), // seconds
  evidence_gaps: z.number().int().nonnegative().default(0),
  completion_reliability: z.number().min(0).max(1).default(0),
  cost: z.number().nonnegative().default(0),
  executor_performance: z.record(z.string(), z.object({
    success_rate: z.number().min(0).max(1),
    avg_duration: z.number().nonnegative(),
    total_attempts: z.number().int().nonnegative(),
  })).default({}),
  context_rotations: z.number().int().nonnegative().default(0),
  steering_frequency: z.number().nonnegative().default(0), // per hour
  computed_at: zISODateString,
});
export type ProcessMetrics = z.infer<typeof zProcessMetrics>;

// ---------------------------------------------------------------------------
// Drift deviation
// ---------------------------------------------------------------------------

export const zDriftDeviation = z.object({
  type: z.enum([
    'repeated_manual_step',
    'hidden_dependency',
    'loop',
    'rework_hotspot',
    'approval_bottleneck',
    'dead_step',
    'implicit_dependency',
    'scope_drift',
    'missing_evidence',
    'policy_violation',
  ]),
  description: z.string(),
  evidence: z.array(z.string()).default([]),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  affected_moves: z.array(z.string()).default([]),
});
export type DriftDeviation = z.infer<typeof zDriftDeviation>;

// ---------------------------------------------------------------------------
// Drift report
// ---------------------------------------------------------------------------

export const zDriftReport = z.object({
  case_id: zCaseId,
  expected_process: z.string().default(''),
  observed_process: z.string().default(''),
  deviations: z.array(zDriftDeviation).default([]),
  recommendations: z.array(z.object({
    action: z.enum([
      'parallelize',
      'add_verification',
      'remove_obsolete_step',
      'change_executor',
      'modify_pack',
      'add_dependency',
      'add_rule',
      'escalate',
    ]),
    description: z.string(),
    confidence: z.number().min(0).max(1),
    impact: z.enum(['high', 'medium', 'low']),
  })).default([]),
  computed_at: zISODateString,
});
export type DriftReport = z.infer<typeof zDriftReport>;

// ---------------------------------------------------------------------------
// Guardian alert
// ---------------------------------------------------------------------------

export const zGuardianAlert = z.object({
  id: z.string(),
  case_id: zCaseId,
  type: z.enum([
    'scope_drift',
    'policy_breach',
    'stale_evidence',
    'deadline_risk',
    'unauthorized_work',
    'duplicate_effort',
    'agent_loop',
    'budget_exceeded',
  ]),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  description: z.string(),
  affected_refs: z.array(z.string()).default([]),
  recommended_action: z.string().default(''),
  raised_at: zISODateString,
  resolved_at: zISODateString.optional(),
});
export type GuardianAlert = z.infer<typeof zGuardianAlert>;
