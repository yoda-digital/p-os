/**
 * Webhook Executor (SP6 §2.3)
 *
 * Delegates Moves to external systems via HTTP webhooks.
 * Polls for completion or waits for inbound callback.
 *
 * startAttempt   → POST to configured webhook URL with move context
 * reportProgress → inbound webhook with progress payload
 * receiveSteering → POST steering to webhook URL
 * finishAttempt   → inbound webhook with outcome
 * collectEvidence → parse evidence from webhook response
 */

import type {
  ExecutorContract,
  ExecutorCapabilities,
  ExecutorHealth,
  MoveRef,
  ContextCapsule,
  AttemptBinding,
  ProgressReport,
  SteeringCommand,
  Evidence,
} from '@pos/process-sdk/src/executor-contract.js';

// ── Configuration ───────────────────────────────────────────────────

export interface WebhookExecutorConfig {
  /** Base URL for outbound webhook calls */
  webhook_url: string;
  /** Headers to include with every request (e.g., auth tokens) */
  headers?: Record<string, string>;
  /** Callback URL for the external system to report back */
  callback_url?: string;
  /** Poll interval in ms when polling for completion (0 = callback only) */
  poll_interval_ms?: number;
  /** Request timeout in ms */
  timeout_ms?: number;
  /** Retry config for failed requests */
  retry?: { max_attempts: number; backoff_ms: number };
}

// ── Internal State ──────────────────────────────────────────────────

interface WebhookAttempt {
  attempt_id: string;
  move: MoveRef;
  state: 'active' | 'paused' | 'cancelled';
  external_id?: string; // ID from the external system
  started_at: string;
  last_poll_at?: string;
  evidence: Evidence[];
}

// ── WebhookExecutor ─────────────────────────────────────────────────

export class WebhookExecutor implements ExecutorContract {
  private config: WebhookExecutorConfig;
  private attempts = new Map<string, WebhookAttempt>();
  private startTime = Date.now();
  private completedCount = 0;
  private failedCount = 0;
  private lastError?: string;

  constructor(config: WebhookExecutorConfig) {
    this.config = config;
  }

  async discoverCapabilities(): Promise<ExecutorCapabilities> {
    const hostname = new URL(this.config.webhook_url).hostname;
    return {
      executor_id: `webhook-${hostname}`,
      executor_type: 'webhook',
      name: `Webhook (${hostname})`,
      description: `Delegates work to external system at ${hostname} via HTTP webhooks`,
      capabilities: ['external_api', 'notification', 'integration', 'delegation'],
      preferred_move_classes: ['DELEGATE', 'NOTIFY', 'WAIT'],
      max_concurrent: 50,
      available: true,
    };
  }

  async canAccept(move: MoveRef): Promise<{ accepted: boolean; reason?: string }> {
    // Accept DELEGATE moves or moves with webhook execution policy
    if (move.class === 'DELEGATE') {
      return { accepted: true, reason: 'DELEGATE class routes to webhook executor' };
    }

    if (move.execution_policy?.['webhook'] || move.execution_policy?.['executor'] === 'webhook') {
      return { accepted: true, reason: 'Execution policy specifies webhook executor' };
    }

    return { accepted: false, reason: 'Move does not target webhook executor' };
  }

  async startAttempt(move: MoveRef, context: ContextCapsule): Promise<AttemptBinding> {
    const attemptId = crypto.randomUUID();
    const now = new Date().toISOString();

    const attempt: WebhookAttempt = {
      attempt_id: attemptId,
      move,
      state: 'active',
      started_at: now,
      evidence: [],
    };

    // POST to the external webhook
    const payload = {
      type: 'attempt_started',
      attempt_id: attemptId,
      move: {
        id: move.id,
        case_id: move.case_id,
        class: move.class,
        title: move.title,
        objective: move.objective,
        priority: move.priority,
        risk: move.risk,
        deadline: move.deadline,
      },
      context: {
        case_title: context.case_title,
        instructions: context.instructions,
        constraints: context.constraints,
        budget: context.budget,
      },
      callback_url: this.config.callback_url
        ? `${this.config.callback_url}/attempts/${attemptId}`
        : undefined,
      timestamp: now,
    };

    try {
      const response = await this.post(payload);
      const responseData = await response.json().catch(() => ({})) as Record<string, unknown>;

      // Store external reference ID if provided
      attempt.external_id = (responseData.id ?? responseData.external_id) as string | undefined;
    } catch (err) {
      this.lastError = String(err);
      console.error(`[Webhook Executor] Failed to start attempt at ${this.config.webhook_url}:`, err);
      // Still create the attempt — webhook may be temporarily down
    }

    this.attempts.set(attemptId, attempt);

    return {
      attempt_id: attemptId,
      executor_id: `webhook-${new URL(this.config.webhook_url).hostname}`,
      started_at: now,
      metadata: {
        webhook_url: this.config.webhook_url,
        external_id: attempt.external_id,
      },
    };
  }

  async reportProgress(attemptId: string, progress: ProgressReport): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    console.log(
      `[Webhook Executor] Progress for "${attempt.move.title}": ${progress.current_activity}`,
    );
  }

  async receiveSteering(attemptId: string, steering: SteeringCommand): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    // Forward the steering command to the external system
    try {
      await this.post({
        type: 'steering',
        attempt_id: attemptId,
        external_id: attempt.external_id,
        steering: {
          class: steering.class,
          instruction: steering.instruction,
          issued_by: steering.issued_by,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.lastError = String(err);
      console.error(`[Webhook Executor] Failed to deliver steering:`, err);
    }

    if (steering.class === 'hard_stop') {
      await this.cancelAttempt(attemptId);
    }
  }

  async pauseAttempt(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    attempt.state = 'paused';
    await this.notify('pause', attemptId, attempt.external_id);
  }

  async resumeAttempt(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    attempt.state = 'active';
    await this.notify('resume', attemptId, attempt.external_id);
  }

  async cancelAttempt(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    attempt.state = 'cancelled';
    await this.notify('cancel', attemptId, attempt.external_id);
    this.attempts.delete(attemptId);
  }

  async collectEvidence(attemptId: string): Promise<Evidence[]> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return [];
    return attempt.evidence;
  }

  async finishAttempt(attemptId: string, outcome: 'succeeded' | 'failed'): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    await this.notify('finish', attemptId, attempt.external_id, { outcome });

    if (outcome === 'succeeded') this.completedCount++;
    else this.failedCount++;

    this.attempts.delete(attemptId);
  }

  async health(): Promise<ExecutorHealth> {
    // Probe the webhook endpoint
    let status: ExecutorHealth['status'] = 'healthy';
    try {
      const response = await fetch(this.config.webhook_url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(this.config.timeout_ms ?? 5000),
      });
      if (!response.ok) status = 'degraded';
    } catch {
      status = 'unhealthy';
    }

    return {
      status,
      active_attempts: this.attempts.size,
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      last_error: this.lastError,
      metrics: {
        attempts_completed: this.completedCount,
        attempts_failed: this.failedCount,
        avg_duration_seconds: 0,
      },
    };
  }

  // ── Inbound Callback Handler ──────────────────────────────────────

  /**
   * Handle an inbound callback from the external system.
   * Called when the external system POSTs back to our callback URL.
   */
  handleCallback(
    attemptId: string,
    payload: {
      type: 'progress' | 'evidence' | 'completed' | 'failed';
      data?: Record<string, unknown>;
    },
  ): void {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    switch (payload.type) {
      case 'progress':
        this.reportProgress(attemptId, {
          current_activity: (payload.data?.activity as string) ?? 'External progress update',
          percent_complete: payload.data?.percent as number | undefined,
        });
        break;

      case 'evidence':
        if (payload.data) {
          attempt.evidence.push({
            type: 'webhook_evidence',
            subject_refs: [{ id: attempt.move.id, type: 'move' }],
            relation: 'PRODUCED_BY',
            data: payload.data,
            confidence: 0.8,
            source: `webhook:${this.config.webhook_url}`,
            observed_at: new Date().toISOString(),
          });
        }
        break;

      case 'completed':
        this.finishAttempt(attemptId, 'succeeded');
        break;

      case 'failed':
        this.finishAttempt(attemptId, 'failed');
        break;
    }
  }

  // ── Internal Helpers ──────────────────────────────────────────────

  private async post(payload: Record<string, unknown>): Promise<Response> {
    const timeout = this.config.timeout_ms ?? 10000;
    const maxRetries = this.config.retry?.max_attempts ?? 1;
    const backoff = this.config.retry?.backoff_ms ?? 1000;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(this.config.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.config.headers,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeout),
        });

        if (!response.ok && attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, backoff * (attempt + 1)));
          continue;
        }

        return response;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, backoff * (attempt + 1)));
        }
      }
    }

    throw lastError;
  }

  private async notify(
    type: string,
    attemptId: string,
    externalId?: string,
    extra?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.post({
        type,
        attempt_id: attemptId,
        external_id: externalId,
        ...extra,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      this.lastError = String(err);
      console.error(`[Webhook Executor] Notify ${type} failed:`, err);
    }
  }
}
