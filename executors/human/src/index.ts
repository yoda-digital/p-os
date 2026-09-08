/**
 * Human Executor (SP6 §2.2)
 *
 * Routes Moves requiring human authority to the Attention queue.
 * Tracks human work through the web UI. Resolves when human marks complete.
 *
 * startAttempt  → creates Attention item "Work assigned to you: <move title>"
 * reportProgress → human updates via Move detail drawer
 * receiveSteering → creates new Attention item with constraint
 * pauseAttempt  → marks attention as "paused"
 * finishAttempt  → human clicks "Mark Complete" in UI
 * collectEvidence → gathers evidence attached by the human
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

// ── Internal State ──────────────────────────────────────────────────

interface HumanAttempt {
  attempt_id: string;
  move: MoveRef;
  state: 'active' | 'paused' | 'cancelled';
  started_at: string;
  assigned_to: string[];
  progress: ProgressReport[];
  steering: SteeringCommand[];
  evidence: Evidence[];
}

// ── HumanExecutor ───────────────────────────────────────────────────

export class HumanExecutor implements ExecutorContract {
  private attempts = new Map<string, HumanAttempt>();
  private startTime = Date.now();
  private completedCount = 0;
  private failedCount = 0;

  async discoverCapabilities(): Promise<ExecutorCapabilities> {
    return {
      executor_id: 'human',
      executor_type: 'human',
      name: 'Human Executor',
      description: 'Routes work to human attention queue. Handles approval, decision, review, creative, physical, and authority tasks.',
      capabilities: [
        'approval', 'decision', 'review', 'creative', 'physical',
        'communication', 'authority', 'negotiation', 'judgment',
        'escalation', 'manual_verification',
      ],
      preferred_move_classes: [
        'APPROVE', 'REJECT', 'DECIDE', 'COMMUNICATE',
        'ESCALATE', 'NEGOTIATE', 'REVIEW', 'VERIFY',
      ],
      max_concurrent: 100, // Humans manage their own queue
      available: true,
    };
  }

  async canAccept(move: MoveRef): Promise<{ accepted: boolean; reason?: string }> {
    const humanClasses = new Set([
      'APPROVE', 'REJECT', 'DECIDE', 'COMMUNICATE',
      'ESCALATE', 'NEGOTIATE', 'REVIEW', 'VERIFY',
    ]);

    if (humanClasses.has(move.class)) {
      return { accepted: true, reason: `Move class ${move.class} requires human authority` };
    }

    // Accept anything explicitly assigned to human actors
    if (move.execution_policy?.['executor'] === 'human') {
      return { accepted: true, reason: 'Explicitly assigned to human executor' };
    }

    // Check for required capabilities that only humans have
    const humanOnly = ['authority', 'judgment', 'negotiation', 'physical'];
    const needsHuman = move.required_capabilities?.some((cap: string) => humanOnly.includes(cap));
    if (needsHuman) {
      return { accepted: true, reason: 'Move requires human-only capabilities' };
    }

    return { accepted: false, reason: `Move class ${move.class} does not require human executor` };
  }

  async startAttempt(move: MoveRef, context: ContextCapsule): Promise<AttemptBinding> {
    const attemptId = crypto.randomUUID();
    const now = new Date().toISOString();

    const attempt: HumanAttempt = {
      attempt_id: attemptId,
      move,
      state: 'active',
      started_at: now,
      assigned_to: move.assigned_actor_ids ?? [],
      progress: [],
      steering: [],
      evidence: [],
    };

    this.attempts.set(attemptId, attempt);

    // In production: create an attention item in the attention queue
    // Priority derived from move priority + case urgency
    console.log(
      `[Human Executor] Created attention item for "${move.title}" (${move.class}) ` +
      `— assigned to ${attempt.assigned_to.length} actor(s), priority: ${move.priority}`,
    );

    // In production: optionally send push notification
    // if (move.priority === 'critical') sendPushNotification(...)

    return {
      attempt_id: attemptId,
      executor_id: 'human',
      started_at: now,
      metadata: {
        attention_priority: move.priority,
        assigned_actors: attempt.assigned_to,
        action_required: this.getActionDescription(move),
      },
    };
  }

  async reportProgress(attemptId: string, progress: ProgressReport): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    attempt.progress.push(progress);
    console.log(
      `[Human Executor] Progress on "${attempt.move.title}": ${progress.current_activity} ` +
      `(${progress.percent_complete ?? '?'}%)`,
    );
  }

  async receiveSteering(attemptId: string, steering: SteeringCommand): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    attempt.steering.push(steering);

    // In production: create a new attention item with the steering instruction
    // so the human sees it in their attention queue
    console.log(
      `[Human Executor] Steering for "${attempt.move.title}": ` +
      `[${steering.class}] ${steering.instruction}`,
    );

    // Hard stop means cancel
    if (steering.class === 'hard_stop') {
      await this.cancelAttempt(attemptId);
    }
  }

  async pauseAttempt(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    attempt.state = 'paused';
    console.log(`[Human Executor] Paused attention for "${attempt.move.title}"`);
    // In production: mark the attention item as paused
  }

  async resumeAttempt(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    attempt.state = 'active';
    console.log(`[Human Executor] Resumed attention for "${attempt.move.title}"`);
    // In production: re-activate the attention item
  }

  async cancelAttempt(attemptId: string): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    attempt.state = 'cancelled';
    this.attempts.delete(attemptId);
    console.log(`[Human Executor] Cancelled attention for "${attempt.move.title}"`);
    // In production: remove from attention queue
  }

  async collectEvidence(attemptId: string): Promise<Evidence[]> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return [];

    // In production: query the evidence table for evidence attached
    // by the human during this attempt (via Move detail drawer, camera, file picker)
    return attempt.evidence;
  }

  async finishAttempt(attemptId: string, outcome: 'succeeded' | 'failed'): Promise<void> {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) return;

    if (outcome === 'succeeded') {
      this.completedCount++;
    } else {
      this.failedCount++;
    }

    this.attempts.delete(attemptId);
    console.log(
      `[Human Executor] Finished "${attempt.move.title}" — ${outcome}`,
    );
    // In production: mark the attention item as resolved
  }

  async health(): Promise<ExecutorHealth> {
    return {
      status: 'healthy',
      active_attempts: this.attempts.size,
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      metrics: {
        attempts_completed: this.completedCount,
        attempts_failed: this.failedCount,
        avg_duration_seconds: 0, // Would compute from historical data
      },
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  /**
   * Generate a human-readable action description for the attention queue.
   */
  private getActionDescription(move: MoveRef): string {
    switch (move.class) {
      case 'APPROVE': return `Approve: ${move.title}`;
      case 'REJECT': return `Review and decide: ${move.title}`;
      case 'DECIDE': return `Decision required: ${move.title}`;
      case 'COMMUNICATE': return `Communication needed: ${move.title}`;
      case 'ESCALATE': return `Escalation: ${move.title}`;
      case 'NEGOTIATE': return `Negotiation task: ${move.title}`;
      case 'REVIEW': return `Review needed: ${move.title}`;
      case 'VERIFY': return `Verification needed: ${move.title}`;
      default: return `Work assigned: ${move.title}`;
    }
  }

  /**
   * Add evidence to an attempt (called from the web UI when human attaches evidence).
   */
  addEvidence(attemptId: string, evidence: Evidence): void {
    const attempt = this.attempts.get(attemptId);
    if (attempt) {
      attempt.evidence.push(evidence);
    }
  }

  /**
   * Get active attempts (for the attention queue display).
   */
  getActiveAttempts(): Array<HumanAttempt & { attempt_id: string }> {
    return Array.from(this.attempts.values());
  }
}
