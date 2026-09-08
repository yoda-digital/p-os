/**
 * Formal Executor Contract (SP6 §2.1)
 *
 * Every executor implements this 12-method interface.
 * This is the CANONICAL definition — @pos/execution re-exports a
 * simplified version for backward compatibility.
 */

// ── Core Types ──────────────────────────────────────────────────────

/** Unique reference to a Move in the system */
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

/** Context capsule provided to executors at attempt start */
export interface ContextCapsule {
  /** Case-level context */
  case_id: string;
  case_title: string;
  case_type: string;

  /** Move-specific instructions */
  instructions: string;
  constraints: unknown[];

  /** Related entities for awareness */
  related_moves?: Array<{ id: string; title: string; state: string }>;
  related_evidence?: Array<{ id: string; summary: string }>;
  related_decisions?: Array<{ id: string; question: string; state: string }>;

  /** Process rules that apply */
  active_rules?: Array<{ type: string; statement: string }>;

  /** Execution budget */
  budget?: {
    max_tokens?: number;
    max_cost_usd?: number;
    max_duration_seconds?: number;
  };
}

/** Binding returned when an attempt starts */
export interface AttemptBinding {
  attempt_id: string;
  executor_id: string;
  started_at: string;
  estimated_duration_seconds?: number;
  metadata?: Record<string, unknown>;
}

/** Progress report from an active attempt */
export interface ProgressReport {
  percent_complete?: number;
  current_activity: string;
  artifacts_produced?: string[];
  tokens_used?: number;
  cost_usd?: number;
  warnings?: string[];
}

/** Steering command sent to a running attempt */
export interface SteeringCommand {
  id: string;
  class: 'advisory' | 'constraint' | 'redirect' | 'pause' | 'hard_stop' | 'fork' | 'reassign';
  instruction: string;
  issued_by: string;
  issued_at: string;
}

/** Evidence collected from an attempt */
export interface Evidence {
  type: string;
  subject_refs: Array<{ id: string; type: string }>;
  relation: string;
  data: Record<string, unknown>;
  confidence: number;
  source: string;
  observed_at: string;
}

/** Executor capabilities declaration */
export interface ExecutorCapabilities {
  executor_id: string;
  executor_type: string;
  name: string;
  description: string;
  /** What kinds of work this executor can do */
  capabilities: string[];
  /** Move classes this executor naturally handles */
  preferred_move_classes: string[];
  /** Maximum concurrent attempts */
  max_concurrent: number;
  /** Whether this executor is currently available */
  available: boolean;
  /** Cost profile for budget planning */
  cost_profile?: {
    per_token?: number;
    per_hour?: number;
    fixed_per_attempt?: number;
  };
}

/** Health status of an executor */
export interface ExecutorHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  active_attempts: number;
  uptime_seconds: number;
  last_error?: string;
  metrics?: {
    attempts_completed: number;
    attempts_failed: number;
    avg_duration_seconds: number;
  };
}

// ── The Contract ────────────────────────────────────────────────────

/**
 * Universal Executor Contract.
 *
 * Every executor — human, webhook, API, Claude Code, or future types —
 * implements this interface. The execution compiler routes Moves to
 * the appropriate executor based on capabilities and Move requirements.
 */
export interface ExecutorContract {
  // ── Discovery ─────────────────────────────────────────────────
  /**
   * Declare what this executor can do.
   * Called by the execution compiler to match Moves to executors.
   */
  discoverCapabilities(): Promise<ExecutorCapabilities>;

  /**
   * Can this executor accept a specific Move?
   * Returns acceptance decision with optional reason.
   */
  canAccept(move: MoveRef): Promise<{ accepted: boolean; reason?: string }>;

  // ── Lifecycle ─────────────────────────────────────────────────
  /**
   * Begin executing a Move. Returns an attempt binding.
   */
  startAttempt(move: MoveRef, context: ContextCapsule): Promise<AttemptBinding>;

  /**
   * Report progress on an active attempt.
   */
  reportProgress(attemptId: string, progress: ProgressReport): Promise<void>;

  /**
   * Receive a steering command for an active attempt.
   */
  receiveSteering(attemptId: string, steering: SteeringCommand): Promise<void>;

  /**
   * Pause an active attempt (preserving state for later resume).
   */
  pauseAttempt(attemptId: string): Promise<void>;

  /**
   * Resume a paused attempt.
   */
  resumeAttempt(attemptId: string): Promise<void>;

  /**
   * Cancel an attempt (no resume possible).
   */
  cancelAttempt(attemptId: string): Promise<void>;

  // ── Completion ────────────────────────────────────────────────
  /**
   * Collect evidence produced during an attempt.
   */
  collectEvidence(attemptId: string): Promise<Evidence[]>;

  /**
   * Mark an attempt as finished (succeeded or failed).
   */
  finishAttempt(attemptId: string, outcome: 'succeeded' | 'failed'): Promise<void>;

  // ── Health ────────────────────────────────────────────────────
  /**
   * Check executor health.
   */
  health(): Promise<ExecutorHealth>;
}
