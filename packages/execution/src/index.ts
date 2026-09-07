// Execution Compiler — maps Move semantics to execution strategy

export interface ExecutionPlan {
  moveId: string;
  strategy: ExecutionStrategy;
  executor: string;
  model?: string;
  effort?: string;
  isolation?: 'none' | 'worktree' | 'container';
  parallelism?: number;
  verificationStrategy?: string;
  contextPolicy?: string;
  budget?: { maxTokens?: number; maxCost?: number; maxDuration?: number };
}

export type ExecutionStrategy =
  | 'same_session'
  | 'fresh_session'
  | 'subagent'
  | 'agent_team'
  | 'dynamic_workflow'
  | 'background_session'
  | 'worktree_session'
  | 'human'
  | 'api'
  | 'webhook'
  | 'wait';

export interface ExecutorCapabilities {
  executorId: string;
  type: string;
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

interface MoveInput {
  id: string;
  class: string;
  risk?: string;
  required_capabilities?: string[];
  execution_policy?: Record<string, unknown>;
  deadline?: string;
}

export class ExecutionCompiler {
  compile(move: MoveInput, availableExecutors: ExecutorCapabilities[]): ExecutionPlan {
    const strategy = this.selectStrategy(move);
    const executor = this.selectExecutor(move, availableExecutors, strategy);

    return {
      moveId: move.id,
      strategy,
      executor: executor?.executorId ?? 'human',
      model: this.selectModel(move),
      effort: this.selectEffort(move),
      isolation: this.selectIsolation(move, strategy),
      budget: this.computeBudget(move),
    };
  }

  explainStrategy(move: MoveInput): string {
    const strategy = this.selectStrategy(move);
    const reasons: string[] = [];

    if (move.class === 'WAIT') {
      reasons.push('Move class is WAIT — no active execution needed');
    } else if (move.class === 'APPROVE' || move.class === 'REJECT') {
      reasons.push(`Move class is ${move.class} — requires human authority`);
    } else if (move.class === 'DELEGATE') {
      reasons.push('Move class is DELEGATE — routed to external API');
    } else {
      if (move.risk === 'critical' || move.risk === 'high') {
        reasons.push(`Risk is ${move.risk} — using isolated worktree session for safety`);
      }
      if (move.required_capabilities?.includes('parallel')) {
        reasons.push('Requires parallel execution — using dynamic workflow');
      }
      if (move.required_capabilities?.includes('team')) {
        reasons.push('Requires team collaboration — using Agent Team');
      }
      if ((move.execution_policy as Record<string, unknown>)?.background) {
        reasons.push('Execution policy requests background — using background session');
      }
      if ((move.execution_policy as Record<string, unknown>)?.isolated) {
        reasons.push('Execution policy requests isolation — using subagent');
      }
    }

    if (reasons.length === 0) {
      reasons.push('Default strategy: same session (no special requirements)');
    }

    return `Strategy: ${strategy}. ${reasons.join('. ')}.`;
  }

  private selectStrategy(move: MoveInput): ExecutionStrategy {
    if (move.class === 'WAIT') return 'wait';
    if (move.class === 'APPROVE' || move.class === 'REJECT') return 'human';
    if (move.class === 'DELEGATE') return 'api';

    if (move.risk === 'critical' || move.risk === 'high') return 'worktree_session';
    if (move.required_capabilities?.includes('parallel')) return 'dynamic_workflow';
    if (move.required_capabilities?.includes('team')) return 'agent_team';
    if ((move.execution_policy as Record<string, unknown>)?.background) return 'background_session';
    if ((move.execution_policy as Record<string, unknown>)?.isolated) return 'subagent';

    return 'same_session';
  }

  private selectExecutor(
    move: MoveInput,
    executors: ExecutorCapabilities[],
    strategy: ExecutionStrategy,
  ): ExecutorCapabilities | undefined {
    const compatible = executors.filter(
      (e) =>
        e.canExecute &&
        e.availability === 'available' &&
        e.supportedStrategies.includes(strategy) &&
        (move.required_capabilities ?? []).every((cap: string) => e.capabilities.includes(cap)),
    );

    const typeOrder: Record<string, number> = {
      'claude-code': 0,
      human: 1,
      api: 2,
      webhook: 3,
    };
    compatible.sort((a, b) => (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99));

    return compatible[0];
  }

  private selectModel(move: MoveInput): string {
    if (move.risk === 'critical') return 'claude-opus-5';
    if (move.risk === 'high') return 'claude-sonnet-5';
    if (move.class === 'OBSERVE' || move.class === 'VERIFY') return 'claude-haiku-4-5-20251001';
    return 'claude-sonnet-5';
  }

  private selectEffort(move: MoveInput): string {
    if (move.risk === 'critical') return 'max';
    if (move.risk === 'high') return 'high';
    return 'medium';
  }

  private selectIsolation(
    move: MoveInput,
    strategy: ExecutionStrategy,
  ): 'none' | 'worktree' | 'container' {
    if (strategy === 'worktree_session') return 'worktree';
    if ((move.execution_policy as Record<string, unknown>)?.isolated) return 'worktree';
    return 'none';
  }

  private computeBudget(move: MoveInput): ExecutionPlan['budget'] {
    return {
      maxTokens: move.risk === 'critical' ? 1_000_000 : 500_000,
      maxCost: move.risk === 'critical' ? 10.0 : 5.0,
      maxDuration: move.deadline
        ? Math.floor((new Date(move.deadline).getTime() - Date.now()) / 1000)
        : 3600,
    };
  }
}

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
