/**
 * API Executor (SP6 §2.4)
 *
 * Calls external REST APIs as execution. Designed for programmatic
 * integrations where the external system has a well-defined API.
 *
 * startAttempt   → call configured API endpoint with move context
 * reportProgress → poll status endpoint for updates
 * finishAttempt  → parse completion response from status endpoint
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
} from './executor-types.js';

// ── Configuration ───────────────────────────────────────────────────

export interface APIExecutorConfig {
  /** Name for this API executor instance */
  name: string;
  /** Base URL of the API */
  base_url: string;
  /** Authentication headers */
  auth_headers?: Record<string, string>;
  /** Endpoint paths (relative to base_url) */
  endpoints: {
    /** POST — start execution */
    start: string;
    /** GET — check status (appended with /{externalId}) */
    status?: string;
    /** POST — cancel execution */
    cancel?: string;
    /** GET — collect results */
    results?: string;
  };
  /** Poll interval in ms for status checks (0 = no polling) */
  poll_interval_ms?: number;
  /** Request timeout in ms */
  timeout_ms?: number;
  /** Transform functions for request/response mapping */
  transforms?: {
    /** Map move context to API request body */
    request?: (move: MoveRef, context: ContextCapsule) => Record<string, unknown>;
    /** Map API response to progress report */
    progress?: (response: Record<string, unknown>) => ProgressReport;
    /** Map API response to evidence */
    evidence?: (response: Record<string, unknown>) => Evidence[];
    /** Determine if the API response indicates completion */
    isComplete?: (response: Record<string, unknown>) => 'succeeded' | 'failed' | 'running';
  };
}

// ── Internal State ──────────────────────────────────────────────────

interface APIAttempt {
  attempt_id: string;
  move: MoveRef;
  state: 'active' | 'paused' | 'cancelled';
  external_id?: string;
  started_at: string;
  evidence: Evidence[];
  poll_timer?: ReturnType<typeof setInterval>;
}

// ── APIExecutor ─────────────────────────────────────────────────────

export class APIExecutor implements ExecutorContract {
  private config: APIExecutorConfig;
  private attempts = new Map<string, APIAttempt>();
  private startTime = Date.now();
  private completedCount = 0;
  private failedCount = 0;
  private lastError?: string;

  constructor(config: APIExecutorConfig) {
    this.config = config;
  }

  async discoverCapabilities(): Promise<ExecutorCapabilities> {
    const hostname = new URL(this.config.base_url).hostname;
    return {
      executor_id: `api-${hostname}`,
      executor_type: 'api',
      name: this.config.name,
      description: `Executes work via REST API at ${hostname}`,
      capabilities: ['external_api', 'automation', 'data_processing'],
      preferred_move_classes: ['DELEGATE', 'AUTOMATE', 'QUERY'],
      max_concurrent: 20,
      available: true,
    };
  }

  async canAccept(move: MoveRef): Promise<{ accepted: boolean; reason?: string }> {
    if (move.execution_policy?.['executor'] === 'api') {
      return { accepted: true, reason: 'Execution policy specifies API executor' };
    }

    if (move.execution_policy?.['api_url'] || move.execution_policy?.['api']) {
      return { accepted: true, reason: 'Execution policy includes API configuration' };
    }

    if (move.class === 'AUTOMATE' || move.class === 'QUERY') {
      return { accepted: true, reason: `Move class ${move.class} suitable for API executor` };
    }

    return { accepted: false, reason: 'Move does not target API executor' };
  }

  async startAttempt(move: MoveRef, context: ContextCapsule): Promise<AttemptBinding> {
    const attemptId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Build the request body
    const body = this.config.transforms?.request
      ? this.config.transforms.request(move, context)
      : {
          move_id: move.id,
          case_id: move.case_id,
          title: move.title,
          objective: move.objective,
          instructions: context.instructions,
          constraints: context.constraints,
          priority: move.priority,
          deadline: move.deadline,
        };

    const attempt: APIAttempt = {
      attempt_id: attemptId,
      move,
      state: 'active',
      started_at: now,
      evidence: [],
    };

    try {
      const response = await this.apiCall('POST', this.config.endpoints.start, body);
      const data = (await response.json()) as Record<string, unknown>;
      attempt.external_id = (data.id ?? data.job_id ?? data.task_id) as string | undefined;

      // Start polling if configured
      if (this.config.poll_interval_ms && this.config.poll_interval_ms > 0 && this.config.endpoints.status) {
        attempt.poll_timer = setInterval(() => {
          this.pollStatus(attemptId).catch((err) => {
            this.lastError = String(err);
          });
        }, this.config.poll_interval_ms);
      }
    } catch (err) {
      this.lastError = String(err);
      console.error(`[API Executor] Failed to start attempt at ${this.config.base_url}:`, err);
    }

    this.attempts.set(attemptId, attempt);

    return {
      attempt_id: attemptId,
      executor_id: `api-${new URL(this.config.base_url).hostname}`,
      started_at: now,
      metadata: {
        api_url: this.config.base_url,
        external_id: attempt.external_id,
      },
    };
  }

  async reportProgress(attemptId: string, progress: ProgressReport): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    console.log(
      `[API Executor] Progress for "${attempt.move.title}": ${progress.current_activity}`,
    );
  }

  async receiveSteering(attemptId: string, steering: SteeringCommand): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    console.log(
      `[API Executor] Steering for "${attempt.move.title}": [${steering.class}] ${steering.instruction}`,
    );

    if (steering.class === 'hard_stop') {
      await this.cancelAttempt(attemptId);
    }
  }

  async pauseAttempt(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    attempt.state = 'paused';
    if (attempt.poll_timer) clearInterval(attempt.poll_timer);
  }

  async resumeAttempt(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    attempt.state = 'active';

    // Restart polling
    if (this.config.poll_interval_ms && this.config.endpoints.status) {
      attempt.poll_timer = setInterval(() => {
        this.pollStatus(attemptId).catch((err) => {
          this.lastError = String(err);
        });
      }, this.config.poll_interval_ms);
    }
  }

  async cancelAttempt(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    if (attempt.poll_timer) clearInterval(attempt.poll_timer);
    attempt.state = 'cancelled';

    // Call cancel endpoint if configured
    if (this.config.endpoints.cancel && attempt.external_id) {
      try {
        await this.apiCall('POST', `${this.config.endpoints.cancel}/${attempt.external_id}`);
      } catch (err) {
        console.error(`[API Executor] Cancel request failed:`, err);
      }
    }

    this.attempts.delete(attemptId);
  }

  async collectEvidence(attemptId: string): Promise<Evidence[]> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return [];

    // Try to fetch results from results endpoint
    if (this.config.endpoints.results && attempt.external_id) {
      try {
        const response = await this.apiCall(
          'GET',
          `${this.config.endpoints.results}/${attempt.external_id}`,
        );
        const data = (await response.json()) as Record<string, unknown>;

        if (this.config.transforms?.evidence) {
          return this.config.transforms.evidence(data);
        }

        // Default: wrap the entire response as evidence
        return [{
          type: 'api_result',
          subject_refs: [{ id: attempt.move.id, type: 'move' }],
          relation: 'PRODUCED_BY',
          data,
          confidence: 0.9,
          source: `api:${this.config.base_url}`,
          observed_at: new Date().toISOString(),
        }];
      } catch (err) {
        this.lastError = String(err);
      }
    }

    return attempt.evidence;
  }

  async finishAttempt(attemptId: string, outcome: 'succeeded' | 'failed'): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    if (attempt.poll_timer) clearInterval(attempt.poll_timer);

    if (outcome === 'succeeded') this.completedCount++;
    else this.failedCount++;

    this.attempts.delete(attemptId);
  }

  async health(): Promise<ExecutorHealth> {
    let status: ExecutorHealth['status'] = 'healthy';

    try {
      const response = await fetch(this.config.base_url, {
        method: 'HEAD',
        headers: this.config.auth_headers,
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

  // ── Internal Helpers ──────────────────────────────────────────────

  private async apiCall(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.config.base_url}${path}`;
    const timeout = this.config.timeout_ms ?? 10000;

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this.config.auth_headers,
      },
      signal: AbortSignal.timeout(timeout),
    };

    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`API ${method} ${path} returned ${response.status}: ${text}`);
    }

    return response;
  }

  private async pollStatus(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.state !== 'active' || !attempt.external_id) return;
    if (!this.config.endpoints.status) return;

    try {
      const response = await this.apiCall(
        'GET',
        `${this.config.endpoints.status}/${attempt.external_id}`,
      );
      const data = (await response.json()) as Record<string, unknown>;

      // Report progress
      if (this.config.transforms?.progress) {
        const progress = this.config.transforms.progress(data);
        await this.reportProgress(attemptId, progress);
      }

      // Check completion
      if (this.config.transforms?.isComplete) {
        const status = this.config.transforms.isComplete(data);
        if (status === 'succeeded' || status === 'failed') {
          // Collect evidence before finishing
          if (data) {
            attempt.evidence.push({
              type: 'api_status_final',
              subject_refs: [{ id: attempt.move.id, type: 'move' }],
              relation: 'PRODUCED_BY',
              data,
              confidence: 0.9,
              source: `api:${this.config.base_url}`,
              observed_at: new Date().toISOString(),
            });
          }
          await this.finishAttempt(attemptId, status);
        }
      }
    } catch (err) {
      this.lastError = String(err);
      console.error(`[API Executor] Poll failed for ${attemptId}:`, err);
    }
  }
}
