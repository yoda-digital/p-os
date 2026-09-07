// Webhook Executor Adapter — delegates Moves to external systems via HTTP webhooks

import type {
  ExecutorContract,
  ExecutorCapabilities,
  ExecutionPlan,
} from '@pos/execution';

export class WebhookExecutor implements ExecutorContract {
  private webhookUrl: string;
  private headers: Record<string, string>;

  constructor(
    webhookUrl: string,
    headers: Record<string, string> = {},
  ) {
    this.webhookUrl = webhookUrl;
    this.headers = headers;
  }

  async discoverCapabilities(): Promise<ExecutorCapabilities> {
    return {
      executorId: `webhook-${new URL(this.webhookUrl).hostname}`,
      type: 'webhook',
      canExecute: true,
      capabilities: ['external_api', 'notification', 'integration'],
      supportedStrategies: ['webhook', 'api'],
      availability: 'available',
    };
  }

  async canAccept(move: Record<string, unknown>): Promise<boolean> {
    return (
      move.class === 'DELEGATE' ||
      !!(move.execution_policy as Record<string, unknown>)?.webhook
    );
  }

  async startAttempt(
    plan: ExecutionPlan,
    context: unknown,
  ): Promise<{ attemptId: string }> {
    const attemptId = crypto.randomUUID();

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({
          type: 'attempt_started',
          attemptId,
          plan,
          context,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Webhook returned ${response.status}: ${await response.text()}`,
        );
      }
    } catch (err) {
      console.error(
        `[Webhook Executor] Failed to notify ${this.webhookUrl}:`,
        err,
      );
      // Still return the attemptId — the webhook may be down temporarily
    }

    return { attemptId };
  }

  async reportProgress(
    attemptId: string,
    progress: unknown,
  ): Promise<void> {
    await this.notify('progress', { attemptId, progress });
  }

  async receiveSteering(
    attemptId: string,
    steering: unknown,
  ): Promise<void> {
    await this.notify('steering', { attemptId, steering });
  }

  async pauseAttempt(attemptId: string): Promise<void> {
    await this.notify('pause', { attemptId });
  }

  async resumeAttempt(attemptId: string): Promise<void> {
    await this.notify('resume', { attemptId });
  }

  async cancelAttempt(attemptId: string): Promise<void> {
    await this.notify('cancel', { attemptId });
  }

  async collectEvidence(_attemptId: string): Promise<unknown[]> {
    return [];
  }

  async finishAttempt(attemptId: string, result: unknown): Promise<void> {
    await this.notify('finish', { attemptId, result });
  }

  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy' }> {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      return { status: response.ok ? 'healthy' : 'degraded' };
    } catch {
      return { status: 'unhealthy' };
    }
  }

  private async notify(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({
          type,
          ...payload,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.error(`[Webhook Executor] Notify ${type} failed:`, err);
    }
  }
}
