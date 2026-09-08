/**
 * Executor Contract Types (mirrored from @pos/process-sdk/executor-contract)
 * SP6 §2.1 — Universal Attempt Interface
 */

export interface MoveRef {
  id: string;
  case_id: string;
  class: string;
  title: string;
  objective?: string;
  priority: string;
  risk: string;
  deadline?: string;
  required_capabilities?: string[];
  execution_policy?: Record<string, unknown>;
  dependencies?: string[];
  constraints?: unknown[];
  assigned_actor_ids?: string[];
}

export interface ContextCapsule {
  case_id: string;
  case_title: string;
  case_type: string;
  instructions: string;
  constraints: unknown[];
  related_moves?: Array<{ id: string; title: string; state: string }>;
  related_evidence?: Array<{ id: string; summary: string }>;
  related_decisions?: Array<{ id: string; question: string; state: string }>;
  active_rules?: Array<{ type: string; statement: string }>;
  budget?: { max_tokens?: number; max_cost_usd?: number; max_duration_seconds?: number };
}

export interface AttemptBinding {
  attempt_id: string;
  executor_id: string;
  started_at: string;
  estimated_duration_seconds?: number;
  metadata?: Record<string, unknown>;
}

export interface ProgressReport {
  percent_complete?: number;
  current_activity: string;
  artifacts_produced?: string[];
  tokens_used?: number;
  cost_usd?: number;
  warnings?: string[];
}

export interface SteeringCommand {
  id: string;
  class: 'advisory' | 'constraint' | 'redirect' | 'pause' | 'hard_stop' | 'fork' | 'reassign';
  instruction: string;
  issued_by: string;
  issued_at: string;
}

export interface Evidence {
  type: string;
  subject_refs: Array<{ id: string; type: string }>;
  relation: string;
  data: Record<string, unknown>;
  confidence: number;
  source: string;
  observed_at: string;
}

export interface ExecutorCapabilities {
  executor_id: string;
  executor_type: string;
  name: string;
  description: string;
  capabilities: string[];
  preferred_move_classes: string[];
  max_concurrent: number;
  available: boolean;
  cost_profile?: { per_token?: number; per_hour?: number; fixed_per_attempt?: number };
}

export interface ExecutorHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  active_attempts: number;
  uptime_seconds: number;
  last_error?: string;
  metrics?: { attempts_completed: number; attempts_failed: number; avg_duration_seconds: number };
}

export interface ExecutorContract {
  discoverCapabilities(): Promise<ExecutorCapabilities>;
  canAccept(move: MoveRef): Promise<{ accepted: boolean; reason?: string }>;
  startAttempt(move: MoveRef, context: ContextCapsule): Promise<AttemptBinding>;
  reportProgress(attemptId: string, progress: ProgressReport): Promise<void>;
  receiveSteering(attemptId: string, steering: SteeringCommand): Promise<void>;
  pauseAttempt(attemptId: string): Promise<void>;
  resumeAttempt(attemptId: string): Promise<void>;
  cancelAttempt(attemptId: string): Promise<void>;
  collectEvidence(attemptId: string): Promise<Evidence[]>;
  finishAttempt(attemptId: string, outcome: 'succeeded' | 'failed'): Promise<void>;
  health(): Promise<ExecutorHealth>;
}
