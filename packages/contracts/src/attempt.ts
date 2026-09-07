import { z } from 'zod';
import {
  zAttemptId,
  zCaseId,
  zMoveId,
  zExecutorId,
  zActorId,
  zISODateString,
  zSemanticRef,
} from './ids.js';

// ---------------------------------------------------------------------------
// Execution strategy
// ---------------------------------------------------------------------------

export const ExecutionStrategy = {
  SameSession: 'same_session',
  FreshSession: 'fresh_session',
  Subagent: 'subagent',
  AgentTeam: 'agent_team',
  DynamicWorkflow: 'dynamic_workflow',
  BackgroundSession: 'background_session',
  WorktreeSession: 'worktree_session',
  Human: 'human',
  Api: 'api',
  Webhook: 'webhook',
  Wait: 'wait',
} as const;

export const zExecutionStrategy = z.enum([
  'same_session',
  'fresh_session',
  'subagent',
  'agent_team',
  'dynamic_workflow',
  'background_session',
  'worktree_session',
  'human',
  'api',
  'webhook',
  'wait',
]);
export type ExecutionStrategy = z.infer<typeof zExecutionStrategy>;

// ---------------------------------------------------------------------------
// Attempt state
// ---------------------------------------------------------------------------

export const AttemptState = {
  Pending: 'pending',
  Starting: 'starting',
  Running: 'running',
  Paused: 'paused',
  Succeeded: 'succeeded',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Superseded: 'superseded',
  Interrupted: 'interrupted',
  TimedOut: 'timed_out',
  Lost: 'lost',
} as const;

export const zAttemptState = z.enum([
  'pending',
  'starting',
  'running',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
  'superseded',
  'interrupted',
  'timed_out',
  'lost',
]);
export type AttemptState = z.infer<typeof zAttemptState>;

// ---------------------------------------------------------------------------
// Attempt
// ---------------------------------------------------------------------------

export const zAttempt = z.object({
  id: zAttemptId,
  case_id: zCaseId,
  move_id: zMoveId,
  executor_id: zExecutorId,
  strategy: zExecutionStrategy,
  state: zAttemptState.default('pending'),
  runtime_refs: z.record(z.string(), z.string()).default({}),
  model: z.string().optional(),
  effort: z.string().optional(),
  started_at: zISODateString.optional(),
  ended_at: zISODateString.optional(),
  cost: z
    .object({
      input_tokens: z.number().int().nonnegative().default(0),
      output_tokens: z.number().int().nonnegative().default(0),
      cache_tokens: z.number().int().nonnegative().default(0),
      monetary_cost: z.number().nonnegative().default(0),
      currency: z.string().default('USD'),
      duration_seconds: z.number().nonnegative().default(0),
    })
    .optional(),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().default(0),
      output_tokens: z.number().int().nonnegative().default(0),
      cache_tokens: z.number().int().nonnegative().default(0),
    })
    .optional(),
  failure_reason: z.string().optional(),
  produced_artifacts: z.array(zSemanticRef).default([]),
  steering_history: z
    .array(
      z.object({
        steering_id: z.string(),
        class: z.string(),
        instruction: z.string(),
        issued_at: zISODateString,
        applied_at: zISODateString.optional(),
      }),
    )
    .default([]),
  created_at: zISODateString,
  created_by: zActorId,
  revision: z.number().int().nonnegative().default(0),
});

export type Attempt = z.infer<typeof zAttempt>;
