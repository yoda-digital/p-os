// Execution Compiler — maps Move semantics to execution strategy
// Spec reference: SP3 §2 (Execution Compiler)

// ── Types ────────────────────────────────────────────────────────────

export type ExecutionStrategy =
  | 'current_session'
  | 'fresh_session'
  | 'background_session'
  | 'subagent'
  | 'agent_team'
  | 'dynamic_workflow'
  | 'human'
  | 'wait'
  // Aliases / extended strategies used by executor adapters
  | 'same_session'
  | 'worktree_session'
  | 'api'
  | 'webhook';

export type ExecutorType = 'claude_code' | 'claude-code' | 'human' | 'webhook';

export type SessionPolicy = 'fresh' | 'resume' | 'fork';

export type ModelPolicy = 'auto' | 'fast' | 'standard' | 'capable';

export type EffortPolicy = 'low' | 'medium' | 'high';

export type IsolationLevel = 'none' | 'worktree' | 'container';

export interface ExecutionPlan {
  moveId: string;
  executor: ExecutorType;
  strategy: ExecutionStrategy;
  session_policy: SessionPolicy;
  model_policy: ModelPolicy;
  effort_policy: EffortPolicy;
  isolation: IsolationLevel;
  parallelism: number;
  verification_strategy: string;
  budget?: {
    max_tokens?: number;
    max_cost_usd?: number;
    max_duration_seconds?: number;
  };
  model_hint?: string;
  why: string;
}

export interface MoveInput {
  id: string;
  class: string;
  title?: string;
  priority?: string;
  risk?: string;
  complexity?: 'low' | 'medium' | 'high';
  required_capabilities?: string[];
  execution_policy?: Record<string, unknown>;
  dependencies?: string[];
  deadline?: string;
  constraints?: unknown[];
}

export interface CapabilitySet {
  agent_team?: boolean;
  dynamic_workflow?: boolean;
  subagent?: boolean;
  background_session?: boolean;
  worktree?: boolean;
  cross_session_messaging?: boolean;
}

export interface OrganizationPolicy {
  allowed_models?: string[];
  max_cost_per_attempt?: number;
  max_tokens_per_attempt?: number;
  require_worktree_for_risk?: string[];
  allowed_strategies?: ExecutionStrategy[];
}

export interface DeviceState {
  active_session_count: number;
  max_parallel_sessions?: number;
}

// ── Executor capabilities (for registry) ─────────────────────────────

export interface ExecutorCapabilities {
  executorId: string;
  type: ExecutorType;
  canExecute: boolean;
  capabilities: string[];
  supportedStrategies: ExecutionStrategy[];
  availability: 'available' | 'busy' | 'offline';
  costProfile?: { perToken?: number; perHour?: number };
}

export interface ExecutorContract {
  discoverCapabilities(): Promise<ExecutorCapabilities>;
  canAccept(move: unknown): Promise<boolean>;
  startAttempt(plan: ExecutionPlan, context: unknown): Promise<{ attemptId: string }>;
  reportProgress(attemptId: string, progress: unknown): Promise<void>;
  receiveSteering(attemptId: string, steering: unknown): Promise<void>;
  pauseAttempt(attemptId: string): Promise<void>;
  resumeAttempt(attemptId: string): Promise<void>;
  cancelAttempt(attemptId: string): Promise<void>;
  collectEvidence(attemptId: string): Promise<unknown[]>;
  finishAttempt(attemptId: string, result: unknown): Promise<void>;
  health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }>;
}

// ── Execution Compiler ───────────────────────────────────────────────

export class ExecutionCompiler {
  /**
   * Compile a Move into an ExecutionPlan.
   *
   * Applies strategy selection rules (spec §2.3), model/effort routing (spec §2.4),
   * and produces a human-readable WHY explanation (spec §2.5).
   */
  compile(
    move: MoveInput,
    capabilities: CapabilitySet = {},
    policy: OrganizationPolicy = {},
    device?: DeviceState,
  ): ExecutionPlan {
    const reasons: string[] = [];
    const complexity = move.complexity ?? this.inferComplexity(move);

    // 1. Strategy selection (spec §2.3)
    const strategy = this.selectStrategy(move, capabilities, reasons);

    // 2. Executor type
    const executor = this.selectExecutor(strategy);

    // 3. Session policy
    const session_policy = this.selectSessionPolicy(strategy, move);

    // 4. Model/effort routing (spec §2.4)
    const { model_policy, effort_policy, model_hint } = this.selectModelEffort(
      move,
      complexity,
      reasons,
    );

    // 5. Isolation
    const isolation = this.selectIsolation(move, strategy, policy, reasons);

    // 6. Parallelism
    const parallelism = this.selectParallelism(strategy, device);

    // 7. Verification strategy
    const verification_strategy = this.selectVerification(move);

    // 8. Budget
    const budget = this.computeBudget(move, complexity, policy);

    // 9. Policy overrides
    this.applyPolicyOverrides(policy, strategy, reasons);

    const why = `Strategy: ${strategy}. ${reasons.join('. ')}.`;

    return {
      moveId: move.id,
      executor,
      strategy,
      session_policy,
      model_policy,
      effort_policy,
      isolation,
      parallelism,
      verification_strategy,
      budget,
      model_hint,
      why,
    };
  }

  /**
   * Explain WHY a particular strategy was chosen for a Move, without
   * actually producing a full plan. Useful for the UI preview.
   */
  explainStrategy(
    move: MoveInput,
    capabilities: CapabilitySet = {},
  ): string {
    const reasons: string[] = [];
    const complexity = move.complexity ?? this.inferComplexity(move);
    const strategy = this.selectStrategy(move, capabilities, reasons);

    // Add model/effort reasoning
    this.selectModelEffort(move, complexity, reasons);

    if (reasons.length === 0) {
      reasons.push('Default strategy: current session (no special requirements detected)');
    }

    return `Strategy: ${strategy}. ${reasons.join('. ')}.`;
  }

  // ── Strategy selection (spec §2.3) ──────────────────────────────

  private selectStrategy(
    move: MoveInput,
    capabilities: CapabilitySet,
    reasons: string[],
  ): ExecutionStrategy {
    // Human authority required
    if (move.class === 'APPROVE' || move.class === 'REJECT') {
      reasons.push(`Move class is ${move.class} — requires human authority`);
      return 'human';
    }

    // External wait
    if (move.class === 'WAIT') {
      reasons.push('Move class is WAIT — no active execution needed, awaiting external event');
      return 'wait';
    }

    // Delegation to external API/webhook is handled as background
    if (move.class === 'DELEGATE') {
      reasons.push('Move class is DELEGATE — routed as background session to external handler');
      return 'background_session';
    }

    // Fan-out/fan-in, research
    if (
      move.required_capabilities?.includes('parallel') ||
      move.required_capabilities?.includes('fan_out')
    ) {
      if (capabilities.dynamic_workflow) {
        reasons.push('Requires parallel/fan-out execution — using dynamic workflow');
        return 'dynamic_workflow';
      }
      // Fallback: multiple subagents
      reasons.push('Requires parallel execution but dynamic_workflow unavailable — using agent team');
      return capabilities.agent_team ? 'agent_team' : 'subagent';
    }

    // Team collaboration
    if (move.required_capabilities?.includes('team')) {
      if (capabilities.agent_team) {
        reasons.push('Requires team collaboration — using agent team');
        return 'agent_team';
      }
      reasons.push('Requires team but agent_team unavailable — falling back to subagent');
      return 'subagent';
    }

    // Explicit background request in execution policy
    if (move.execution_policy?.['background']) {
      reasons.push('Execution policy requests background mode — using background session');
      return 'background_session';
    }

    // High risk → isolated background with worktree
    if (move.risk === 'critical' || move.risk === 'high') {
      reasons.push(`Risk is ${move.risk} — using background session with isolation for safety`);
      return 'background_session';
    }

    // Explicit isolation request
    if (move.execution_policy?.['isolated']) {
      reasons.push('Execution policy requests isolation — using subagent');
      return 'subagent';
    }

    // Independent investigation
    if (move.class === 'OBSERVE' || move.class === 'ASK') {
      reasons.push(`Move class is ${move.class} — independent investigation, using subagent`);
      return 'subagent';
    }

    // Has unresolved dependencies — can't start yet, but ready to queue
    if (move.dependencies && move.dependencies.length > 0) {
      reasons.push('Move has dependencies — using fresh session (will be queued until deps resolve)');
      return 'fresh_session';
    }

    // Simple local task — default
    reasons.push('Simple local task with no special requirements — using current session');
    return 'current_session';
  }

  // ── Executor type ───────────────────────────────────────────────

  private selectExecutor(strategy: ExecutionStrategy): ExecutorType {
    if (strategy === 'human') return 'human';
    if (strategy === 'wait') return 'webhook'; // wait for external event
    return 'claude_code';
  }

  // ── Session policy ──────────────────────────────────────────────

  private selectSessionPolicy(strategy: ExecutionStrategy, move: MoveInput): SessionPolicy {
    if (strategy === 'current_session') return 'resume';
    if (move.execution_policy?.['fork']) return 'fork';
    return 'fresh';
  }

  // ── Model/effort routing (spec §2.4) ────────────────────────────

  private selectModelEffort(
    move: MoveInput,
    complexity: 'low' | 'medium' | 'high',
    reasons: string[],
  ): { model_policy: ModelPolicy; effort_policy: EffortPolicy; model_hint?: string } {
    // Risk override: high/critical risk always gets capable + high
    if (move.risk === 'critical' || move.risk === 'high') {
      reasons.push(`Risk is ${move.risk} — overriding to capable model with high effort`);
      return {
        model_policy: 'capable',
        effort_policy: 'high',
        model_hint: move.risk === 'critical' ? 'claude-opus-4-6' : 'claude-sonnet-4-5',
      };
    }

    // Complexity-based routing
    switch (complexity) {
      case 'low':
        reasons.push('Low complexity — using fast model with low effort');
        return { model_policy: 'fast', effort_policy: 'low', model_hint: 'claude-haiku-4-5' };
      case 'high':
        reasons.push('High complexity — using capable model with high effort');
        return { model_policy: 'capable', effort_policy: 'high', model_hint: 'claude-sonnet-4-5' };
      case 'medium':
      default:
        reasons.push('Medium complexity — using standard model with medium effort');
        return { model_policy: 'standard', effort_policy: 'medium', model_hint: 'claude-sonnet-4-5' };
    }
  }

  // ── Isolation ───────────────────────────────────────────────────

  private selectIsolation(
    move: MoveInput,
    strategy: ExecutionStrategy,
    policy: OrganizationPolicy,
    reasons: string[],
  ): IsolationLevel {
    // Policy-mandated worktree for certain risk levels
    if (policy.require_worktree_for_risk?.includes(move.risk ?? 'none')) {
      reasons.push(`Organization policy requires worktree isolation for risk=${move.risk}`);
      return 'worktree';
    }

    if (move.risk === 'critical' || move.risk === 'high') {
      return 'worktree';
    }

    if (strategy === 'background_session' && move.execution_policy?.['isolated']) {
      return 'worktree';
    }

    return 'none';
  }

  // ── Parallelism ─────────────────────────────────────────────────

  private selectParallelism(strategy: ExecutionStrategy, device?: DeviceState): number {
    if (strategy === 'agent_team' || strategy === 'dynamic_workflow') {
      const max = device?.max_parallel_sessions ?? 4;
      return Math.min(max, 4);
    }
    return 1;
  }

  // ── Verification ────────────────────────────────────────────────

  private selectVerification(move: MoveInput): string {
    if (move.class === 'VERIFY') return 'self_verify';
    if (move.risk === 'critical') return 'independent_verification';
    if (move.risk === 'high') return 'automated_tests';
    return 'evidence_based';
  }

  // ── Budget ──────────────────────────────────────────────────────

  private computeBudget(
    move: MoveInput,
    complexity: 'low' | 'medium' | 'high',
    policy: OrganizationPolicy,
  ): ExecutionPlan['budget'] {
    const base_tokens = complexity === 'high' ? 1_000_000 : complexity === 'medium' ? 500_000 : 200_000;
    const base_cost = complexity === 'high' ? 10.0 : complexity === 'medium' ? 5.0 : 2.0;

    let max_duration_seconds = 3600; // 1 hour default
    if (move.deadline) {
      const remaining = Math.floor((new Date(move.deadline).getTime() - Date.now()) / 1000);
      if (remaining > 0) {
        max_duration_seconds = Math.min(remaining, max_duration_seconds);
      }
    }

    return {
      max_tokens: policy.max_tokens_per_attempt
        ? Math.min(base_tokens, policy.max_tokens_per_attempt)
        : base_tokens,
      max_cost_usd: policy.max_cost_per_attempt
        ? Math.min(base_cost, policy.max_cost_per_attempt)
        : base_cost,
      max_duration_seconds,
    };
  }

  // ── Policy overrides ────────────────────────────────────────────

  private applyPolicyOverrides(
    policy: OrganizationPolicy,
    strategy: ExecutionStrategy,
    reasons: string[],
  ): void {
    if (policy.allowed_strategies && !policy.allowed_strategies.includes(strategy)) {
      reasons.push(`Note: strategy ${strategy} may be restricted by organization policy`);
    }
  }

  // ── Complexity inference ────────────────────────────────────────

  private inferComplexity(move: MoveInput): 'low' | 'medium' | 'high' {
    let score = 0;

    // Risk contributes to complexity
    if (move.risk === 'critical') score += 3;
    else if (move.risk === 'high') score += 2;
    else if (move.risk === 'medium') score += 1;

    // Priority contributes
    if (move.priority === 'critical') score += 1;

    // Dependencies contribute
    if (move.dependencies && move.dependencies.length > 2) score += 1;
    if (move.dependencies && move.dependencies.length > 5) score += 1;

    // Constraints contribute
    if (move.constraints && move.constraints.length > 2) score += 1;

    // Required capabilities contribute
    if (move.required_capabilities && move.required_capabilities.length > 2) score += 1;

    // Certain move classes are inherently complex
    if (move.class === 'DECIDE' || move.class === 'ESCALATE') score += 1;

    if (score >= 4) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }
}

// ── Executor Registry ────────────────────────────────────────────────

export class ExecutorRegistry {
  private executors = new Map<string, ExecutorContract>();

  register(id: string, executor: ExecutorContract): void {
    this.executors.set(id, executor);
  }

  unregister(id: string): void {
    this.executors.delete(id);
  }

  get(id: string): ExecutorContract | undefined {
    return this.executors.get(id);
  }

  list(): string[] {
    return Array.from(this.executors.keys());
  }

  async getAllCapabilities(): Promise<ExecutorCapabilities[]> {
    const caps: ExecutorCapabilities[] = [];
    for (const [, executor] of this.executors) {
      try {
        caps.push(await executor.discoverCapabilities());
      } catch {
        // Skip unhealthy executors
      }
    }
    return caps;
  }
}
