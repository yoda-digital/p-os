// Claude Code Executor Adapter — implements the universal ExecutorContract

import type {
  ExecutorContract,
  ExecutorCapabilities,
  ExecutionPlan,
} from '@pos/execution';

export class ClaudeCodeExecutor implements ExecutorContract {
  private capabilities: string[] = [];
  private activeAttempts = new Map<
    string,
    { moveId: string; strategy: string; startedAt: string }
  >();

  async discoverCapabilities(): Promise<ExecutorCapabilities> {
    this.capabilities = [
      'code_execution',
      'file_editing',
      'web_search',
      'web_fetch',
      'bash',
      'subagents',
      'background_sessions',
      'worktrees',
      'mcp',
      'hooks',
      'agent_teams',
      'dynamic_workflows',
      'cross_session_messaging',
    ];

    return {
      executorId: 'claude-code-local',
      type: 'claude-code',
      canExecute: true,
      capabilities: this.capabilities,
      supportedStrategies: [
        'same_session',
        'fresh_session',
        'subagent',
        'agent_team',
        'dynamic_workflow',
        'background_session',
        'worktree_session',
      ],
      availability: 'available',
      costProfile: { perToken: 0.000003 },
    };
  }

  async canAccept(move: Record<string, unknown>): Promise<boolean> {
    const required = (move.required_capabilities as string[]) ?? [];
    return required.every((cap: string) => this.capabilities.includes(cap));
  }

  async startAttempt(
    plan: ExecutionPlan,
    context: unknown,
  ): Promise<{ attemptId: string }> {
    const attemptId = crypto.randomUUID();

    this.activeAttempts.set(attemptId, {
      moveId: plan.moveId,
      strategy: plan.strategy,
      startedAt: new Date().toISOString(),
    });

    console.log(
      `[Claude Executor] Starting attempt ${attemptId} for move ${plan.moveId} with strategy ${plan.strategy}`,
    );

    // In production, this would launch the actual Claude session:
    // - same_session: inject context into current session via MCP
    // - fresh_session: claude --resume or new session with capsule
    // - subagent: spawn via Agent tool
    // - background_session: claude --bg --name <moveId>
    // - worktree_session: claude --bg with worktree isolation
    // - agent_team: spawn Agent Team
    // - dynamic_workflow: launch Workflow

    return { attemptId };
  }

  async reportProgress(
    attemptId: string,
    progress: unknown,
  ): Promise<void> {
    const attempt = this.activeAttempts.get(attemptId);
    if (!attempt) return;
    console.log(
      `[Claude Executor] Progress for ${attemptId} (move ${attempt.moveId}):`,
      progress,
    );
  }

  async receiveSteering(
    attemptId: string,
    steering: unknown,
  ): Promise<void> {
    const attempt = this.activeAttempts.get(attemptId);
    if (!attempt) return;
    console.log(
      `[Claude Executor] Steering for ${attemptId} (move ${attempt.moveId}):`,
      steering,
    );
    // In production: write to pending-steering.json for PreToolUse hook delivery
  }

  async pauseAttempt(attemptId: string): Promise<void> {
    console.log(`[Claude Executor] Pausing ${attemptId}`);
    // In production: send pause signal via hooks or claude stop
  }

  async resumeAttempt(attemptId: string): Promise<void> {
    console.log(`[Claude Executor] Resuming ${attemptId}`);
    // In production: claude --resume or respawn
  }

  async cancelAttempt(attemptId: string): Promise<void> {
    console.log(`[Claude Executor] Cancelling ${attemptId}`);
    this.activeAttempts.delete(attemptId);
    // In production: claude stop <job-id>
  }

  async collectEvidence(attemptId: string): Promise<unknown[]> {
    // In production: read from local outbox for evidence candidates
    return [];
  }

  async finishAttempt(attemptId: string, result: unknown): Promise<void> {
    console.log(`[Claude Executor] Finished ${attemptId}:`, result);
    this.activeAttempts.delete(attemptId);
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }> {
    // In production: check claude --version, agent view status
    return { status: 'healthy' };
  }

  getActiveAttempts(): Map<
    string,
    { moveId: string; strategy: string; startedAt: string }
  > {
    return new Map(this.activeAttempts);
  }
}
