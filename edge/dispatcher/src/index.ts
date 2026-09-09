// Process Dispatcher — thin always-on daemon for cloud-triggered execution
// Maintains WSS connection, receives signed commands, launches/stops claude --bg sessions
// Spec reference: SP3 §1 (Thin Dispatcher)

import {
  ProcessEdge,
  type EdgeConfig,
  type SteeringMessage,
  type StartMoveMessage,
  type StopMessage,
} from '@pos/edge-core';
import type { ExecutionPlan } from '@pos/execution';
import {
  isCliAvailable,
  launchBackgroundSession,
  listAgents,
  stopSession as cliStopSession,
  getSessionLogs,
  mockCli,
} from './cli.js';
import { SessionTracker, type TrackedSession, type ReconciliationResult } from './session-tracker.js';

// ── Types ────────────────────────────────────────────────────────────

export interface DispatcherConfig extends EdgeConfig {
  /** Use mock mode even if CLI is available */
  forceMock?: boolean;
  /** How often to poll for session status (ms). Default: 30000 */
  pollIntervalMs?: number;
}

export { SessionTracker, type TrackedSession, type ReconciliationResult };

// ── Dispatcher ───────────────────────────────────────────────────────

export class ProcessDispatcher {
  private edge: ProcessEdge;
  private tracker = new SessionTracker();
  private running = false;
  private useMock = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private config: DispatcherConfig;

  constructor(config: DispatcherConfig) {
    this.config = config;
    this.edge = new ProcessEdge(config, {
      onSteering: (msg) => this.handleSteering(msg),
      onStartMove: (msg) => this.handleStartMove(msg),
      onStop: (msg) => this.handleStop(msg),
      onConnected: () => {
        console.log('[Dispatcher] Edge connected — listening for commands');
        this.reportActiveSessions();
        this.recoverSessions();
      },
      onDisconnected: () => {
        console.log('[Dispatcher] Edge disconnected — sessions continue locally');
      },
    });
  }

  async start(): Promise<void> {
    console.log('[Dispatcher] Starting...');
    this.running = true;

    // Detect CLI availability
    if (this.config.forceMock) {
      this.useMock = true;
      console.log('[Dispatcher] Mock mode forced by config');
    } else {
      this.useMock = !(await isCliAvailable());
      if (this.useMock) {
        console.log('[Dispatcher] claude CLI not found — running in mock mode');
      } else {
        console.log('[Dispatcher] claude CLI detected — using real CLI');
      }
    }

    // Connect to control plane
    try {
      await this.edge.connect();
    } catch (err) {
      console.error('[Dispatcher] Initial connection failed, will retry:', err);
    }

    // Start session status polling
    const pollInterval = this.config.pollIntervalMs ?? 30_000;
    this.pollTimer = setInterval(() => {
      this.pollSessionStatus().catch((err) =>
        console.error('[Dispatcher] Poll error:', err),
      );
    }, pollInterval);

    console.log('[Dispatcher] Ready.');
  }

  // ── Command handlers ────────────────────────────────────────────

  private async handleStartMove(msg: StartMoveMessage): Promise<void> {
    const { caseId, moveId, executionPlan, contextCapsule } = msg;
    const plan = executionPlan as unknown as ExecutionPlan;
    console.log(`[Dispatcher] Start move ${moveId} for case ${caseId} (strategy: ${plan.strategy})`);

    // Check if already running
    const existing = this.tracker.findByMove(moveId);
    if (existing && existing.status === 'running') {
      console.log(`[Dispatcher] Move ${moveId} already has an active session (${existing.jobId})`);
      await this.edge.sendEvent({
        type: 'start_move_rejected',
        moveId,
        caseId,
        reason: 'already_running',
        existingJobId: existing.jobId,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Build context capsule text for the CLI prompt
    const capsuleText = buildCapsuleText(contextCapsule);

    try {
      let jobId: string;
      let workingDirectory: string | undefined;

      // Use the current working directory as the project root for Claude
      // The dispatcher should be started from the project directory
      workingDirectory = process.cwd();

      if (this.useMock) {
        const result = await mockCli.launchBackgroundSession(moveId, capsuleText, {
          model: plan.model_hint,
          cwd: workingDirectory,
        });
        jobId = result.jobId;
      } else {
        const result = await launchBackgroundSession(moveId, capsuleText, {
          model: plan.model_hint,
          maxTokens: plan.budget?.max_tokens,
          cwd: workingDirectory,
        });
        jobId = result.jobId;
      }

      // Track the session
      const session: TrackedSession = {
        jobId,
        moveId,
        caseId,
        strategy: plan.strategy,
        model: plan.model_hint,
        workingDirectory,
        worktreePath: plan.isolation === 'worktree' ? `worktree-${moveId}` : undefined,
        startedAt: new Date().toISOString(),
        status: 'running',
      };
      this.tracker.track(session);

      // Report to control plane
      await this.edge.sendEvent({
        type: 'session_started',
        sessionId: jobId,
        moveId,
        caseId,
        strategy: plan.strategy,
        model: plan.model_hint,
        claudeJobId: jobId,
        workingDirectory,
        worktreePath: session.worktreePath,
        timestamp: new Date().toISOString(),
      });

      console.log(`[Dispatcher] Session ${jobId} started for move ${moveId}`);
    } catch (err) {
      console.error(`[Dispatcher] Failed to launch session for move ${moveId}:`, err);
      await this.edge.sendEvent({
        type: 'session_start_failed',
        moveId,
        caseId,
        error: (err as Error).message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleSteering(msg: SteeringMessage): Promise<void> {
    const { attemptId, instruction } = msg;
    console.log(`[Dispatcher] Steering for attempt ${attemptId}: ${instruction}`);

    // In production: write to pending-steering.json for hook delivery
    // The Claude Code plugin's pre-tool-use hook reads this file
    await this.edge.sendEvent({
      type: 'steering_delivered',
      attemptId,
      deliveredAt: new Date().toISOString(),
    });
  }

  private async handleStop(msg: StopMessage): Promise<void> {
    const { moveId, attemptId, reason } = msg;
    console.log(`[Dispatcher] Stop move ${moveId}: ${reason}`);

    const session = this.tracker.findByMove(moveId);
    if (!session) {
      console.log(`[Dispatcher] No active session found for move ${moveId}`);
      return;
    }

    await this.doStopSession(session.jobId);

    await this.edge.sendEvent({
      type: 'session_stopped',
      moveId,
      attemptId,
      sessionId: session.jobId,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Public API ──────────────────────────────────────────────────

  async launchBackgroundSession(
    moveId: string,
    caseId: string,
    contextText: string,
    plan?: Partial<ExecutionPlan>,
  ): Promise<string> {
    console.log(`[Dispatcher] Launching background session for move ${moveId}`);

    let jobId: string;
    if (this.useMock) {
      const result = await mockCli.launchBackgroundSession(moveId, contextText, {
        model: plan?.model_hint,
      });
      jobId = result.jobId;
    } else {
      const result = await launchBackgroundSession(moveId, contextText, {
        model: plan?.model_hint,
        maxTokens: plan?.budget?.max_tokens,
      });
      jobId = result.jobId;
    }

    this.tracker.track({
      jobId,
      moveId,
      caseId,
      strategy: plan?.strategy ?? 'background_session',
      model: plan?.model_hint,
      startedAt: new Date().toISOString(),
      status: 'running',
    });

    return jobId;
  }

  async stopMoveSession(moveId: string): Promise<boolean> {
    const session = this.tracker.findByMove(moveId);
    if (!session) return false;
    return this.doStopSession(session.jobId);
  }

  async getSessionLogs(jobId: string): Promise<string> {
    if (this.useMock) {
      return mockCli.getSessionLogs(jobId);
    }
    return getSessionLogs(jobId);
  }

  listActiveSessions(): TrackedSession[] {
    return this.tracker.getActive();
  }

  getSessionByMove(moveId: string): TrackedSession | undefined {
    return this.tracker.findByMove(moveId);
  }

  // ── Recovery (spec §1.4) ────────────────────────────────────────

  private async recoverSessions(): Promise<void> {
    console.log('[Dispatcher] Running session recovery...');

    try {
      let agents;
      if (this.useMock) {
        agents = await mockCli.listAgents();
      } else {
        agents = await listAgents();
      }

      const result = this.tracker.reconcile(agents);

      if (result.rebound.length > 0) {
        console.log(`[Dispatcher] Rebound ${result.rebound.length} session(s)`);
      }
      if (result.stale.length > 0) {
        console.log(`[Dispatcher] Found ${result.stale.length} stale session(s)`);
      }
      if (result.orphaned.length > 0) {
        console.log(`[Dispatcher] Found ${result.orphaned.length} orphaned agent(s)`);
      }

      // Report reconciliation to control plane
      await this.edge.sendEvent({
        type: 'session_reconciliation',
        rebound: result.rebound.length,
        stale: result.stale.length,
        orphaned: result.orphaned.length,
        activeSessions: this.tracker.getActive().map((s) => ({
          jobId: s.jobId,
          moveId: s.moveId,
          caseId: s.caseId,
          strategy: s.strategy,
          status: s.status,
        })),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[Dispatcher] Recovery failed:', err);
    }
  }

  // ── Session status polling ──────────────────────────────────────

  private async pollSessionStatus(): Promise<void> {
    const active = this.tracker.getActive();
    if (active.length === 0) return;

    try {
      let agents;
      if (this.useMock) {
        agents = await mockCli.listAgents();
      } else {
        agents = await listAgents();
      }

      const agentIds = new Set(agents.map((a) => a.id));
      const agentNames = new Set(agents.map((a) => a.name));

      for (const session of active) {
        const isStillRunning = agentIds.has(session.jobId) || agentNames.has(session.moveId);

        if (!isStillRunning && session.status === 'running') {
          console.log(`[Dispatcher] Session ${session.jobId} for move ${session.moveId} has ended`);
          session.status = 'stopped';

          await this.edge.sendEvent({
            type: 'session_ended',
            sessionId: session.jobId,
            moveId: session.moveId,
            caseId: session.caseId,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch {
      // Polling failure is non-critical
    }
  }

  // ── Internal helpers ────────────────────────────────────────────

  private async doStopSession(jobId: string): Promise<boolean> {
    const session = this.tracker.get(jobId);
    if (!session) return false;

    console.log(`[Dispatcher] Stopping session ${jobId}`);
    session.status = 'stopping';

    try {
      if (this.useMock) {
        await mockCli.stopSession(jobId);
      } else {
        await cliStopSession(jobId);
      }
    } catch {
      // Session may already be gone
    }

    session.status = 'stopped';
    return true;
  }

  private async reportActiveSessions(): Promise<void> {
    const sessions = this.tracker.getActive();
    if (sessions.length > 0) {
      await this.edge.sendEvent({
        type: 'active_sessions_report',
        sessions: sessions.map((s) => ({
          sessionId: s.jobId,
          moveId: s.moveId,
          caseId: s.caseId,
          strategy: s.strategy,
          startedAt: s.startedAt,
        })),
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────

  async stop(): Promise<void> {
    this.running = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Stop all active sessions
    for (const session of this.tracker.getActive()) {
      await this.doStopSession(session.jobId);
    }

    await this.edge.disconnect();
    console.log('[Dispatcher] Stopped.');
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isConnected(): boolean {
    return this.edge.isConnected;
  }

  get sessionCount(): number {
    return this.tracker.activeCount;
  }

  get isMockMode(): boolean {
    return this.useMock;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Build a prompt text from the context capsule for `claude --bg -p <text>`.
 * The capsule is a structured object; we serialize it into a readable prompt.
 */
function buildCapsuleText(capsule: Record<string, unknown>): string {
  const parts: string[] = [];

  if (capsule['title']) parts.push(`# ${capsule['title']}`);
  if (capsule['objective']) parts.push(`Objective: ${capsule['objective']}`);
  if (capsule['instructions']) parts.push(`\n${capsule['instructions']}`);
  if (capsule['constraints'] && Array.isArray(capsule['constraints'])) {
    parts.push(`\nConstraints:\n${(capsule['constraints'] as string[]).map((c) => `- ${c}`).join('\n')}`);
  }
  if (capsule['context']) parts.push(`\nContext:\n${capsule['context']}`);

  if (parts.length === 0) {
    // Fallback: serialize the whole capsule
    return JSON.stringify(capsule, null, 2);
  }

  return parts.join('\n');
}
