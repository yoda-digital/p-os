// Human Executor Adapter — routes Moves requiring human authority to the attention queue

import type {
  ExecutorContract,
  ExecutorCapabilities,
  ExecutionPlan,
} from '@pos/execution';

export class HumanExecutor implements ExecutorContract {
  async discoverCapabilities(): Promise<ExecutorCapabilities> {
    return {
      executorId: 'human',
      type: 'human',
      canExecute: true,
      capabilities: [
        'approval',
        'decision',
        'review',
        'creative',
        'physical',
        'communication',
        'authority',
        'negotiation',
        'judgment',
      ],
      supportedStrategies: ['human'],
      availability: 'available',
    };
  }

  async canAccept(move: Record<string, unknown>): Promise<boolean> {
    const humanClasses = [
      'APPROVE',
      'REJECT',
      'DECIDE',
      'COMMUNICATE',
      'ESCALATE',
      'NEGOTIATE',
    ];
    return humanClasses.includes(move.class as string);
  }

  async startAttempt(
    plan: ExecutionPlan,
    _context: unknown,
  ): Promise<{ attemptId: string }> {
    const attemptId = crypto.randomUUID();
    console.log(
      `[Human Executor] Created attention item for move ${plan.moveId} — awaiting human action`,
    );
    // In production: create an attention item in the attention queue
    // and optionally send a push notification
    return { attemptId };
  }

  async reportProgress(
    _attemptId: string,
    _progress: unknown,
  ): Promise<void> {
    // Humans report progress through the UI
  }

  async receiveSteering(
    _attemptId: string,
    _steering: unknown,
  ): Promise<void> {
    // Steering for humans goes through the attention queue / notifications
  }

  async pauseAttempt(_attemptId: string): Promise<void> {
    // Humans pause themselves
  }

  async resumeAttempt(_attemptId: string): Promise<void> {
    // Humans resume themselves
  }

  async cancelAttempt(_attemptId: string): Promise<void> {
    // Remove from attention queue
  }

  async collectEvidence(_attemptId: string): Promise<unknown[]> {
    return [];
  }

  async finishAttempt(_attemptId: string, _result: unknown): Promise<void> {
    // Human completion comes through the UI
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }> {
    return { status: 'healthy' };
  }
}
