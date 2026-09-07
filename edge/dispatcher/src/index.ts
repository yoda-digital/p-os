// Process Dispatcher — thin always-on daemon for cloud-triggered execution
// Maintains WSS connection, receives signed commands, launches/stops claude --bg sessions

import {
  ProcessEdge,
  type EdgeConfig,
  type SteeringMessage,
  type StartMoveMessage,
  type StopMessage,
} from '@pos/edge-core';

interface ActiveSession {
  sessionId: string;
  moveId: string;
  caseId: string;
  strategy: string;
  startedAt: string;
  pid?: number;
}

export class ProcessDispatcher {
  private edge: ProcessEdge;
  private activeSessions = new Map<string, ActiveSession>();
  private running = false;

  constructor(config: EdgeConfig) {
    this.edge = new ProcessEdge(config, {
      onSteering: (msg) => this.handleSteering(msg),
      onStartMove: (msg) => this.handleStartMove(msg),
      onStop: (msg) => this.handleStop(msg),
      onConnected: () => {
        console.log('[Dispatcher] Edge connected — listening for commands');
        // Report active sessions to control plane
        this.reportActiveSessions();
      },
      onDisconnected: () => {
        console.log('[Dispatcher] Edge disconnected — sessions continue locally');
      },
    });
  }

  async start(): Promise<void> {
    console.log('[Dispatcher] Starting...');
    this.running = true;

    try {
      await this.edge.connect();
    } catch (err) {
      console.error('[Dispatcher] Initial connection failed, will retry:', err);
    }

    console.log('[Dispatcher] Ready.');
  }

  private async handleStartMove(msg: StartMoveMessage): Promise<void> {
    const { caseId, moveId, executionPlan, contextCapsule } = msg;
    console.log(`[Dispatcher] Start move ${moveId} for case ${caseId}`);

    const sessionId = crypto.randomUUID();
    const session: ActiveSession = {
      sessionId,
      moveId,
      caseId,
      strategy: (executionPlan.strategy as string) ?? 'background_session',
      startedAt: new Date().toISOString(),
    };

    this.activeSessions.set(sessionId, session);

    // In production: launch claude --bg with context
    // const { execFile } = await import('node:child_process');
    // const proc = execFile('claude', ['--bg', '--name', moveId, '-p', capsuleText]);
    // session.pid = proc.pid;

    console.log(`[Dispatcher] Session ${sessionId} started for move ${moveId}`);

    await this.edge.sendEvent({
      type: 'session_started',
      sessionId,
      moveId,
      caseId,
      timestamp: new Date().toISOString(),
    });
  }

  private async handleSteering(msg: SteeringMessage): Promise<void> {
    const { attemptId, instruction } = msg;
    console.log(`[Dispatcher] Steering for attempt ${attemptId}: ${instruction}`);

    // Find the session bound to this attempt
    // In production: write to pending-steering.json for hook delivery
    await this.edge.sendEvent({
      type: 'steering_delivered',
      attemptId,
      deliveredAt: new Date().toISOString(),
    });
  }

  private async handleStop(msg: StopMessage): Promise<void> {
    const { moveId, attemptId, reason } = msg;
    console.log(`[Dispatcher] Stop move ${moveId}: ${reason}`);

    // Find and stop the session
    for (const [sessionId, session] of this.activeSessions) {
      if (session.moveId === moveId) {
        await this.stopSession(sessionId);
        break;
      }
    }

    await this.edge.sendEvent({
      type: 'session_stopped',
      moveId,
      attemptId,
      reason,
      timestamp: new Date().toISOString(),
    });
  }

  async launchBackgroundSession(
    moveId: string,
    caseId: string,
    contextText: string,
  ): Promise<string> {
    const sessionId = crypto.randomUUID();
    console.log(
      `[Dispatcher] Launching background session ${sessionId} for move ${moveId}`,
    );

    this.activeSessions.set(sessionId, {
      sessionId,
      moveId,
      caseId,
      strategy: 'background_session',
      startedAt: new Date().toISOString(),
    });

    // In production: exec('claude', ['--bg', '--name', moveId, '-p', contextText])

    return sessionId;
  }

  async stopSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    console.log(`[Dispatcher] Stopping session ${sessionId}`);

    // In production: exec('claude', ['stop', jobId])
    if (session.pid) {
      try {
        process.kill(session.pid, 'SIGTERM');
      } catch {
        // Process may already be gone
      }
    }

    this.activeSessions.delete(sessionId);
  }

  async listActiveSessions(): Promise<ActiveSession[]> {
    return Array.from(this.activeSessions.values());
  }

  private async reportActiveSessions(): Promise<void> {
    const sessions = Array.from(this.activeSessions.values());
    if (sessions.length > 0) {
      await this.edge.sendEvent({
        type: 'active_sessions_report',
        sessions: sessions.map((s) => ({
          sessionId: s.sessionId,
          moveId: s.moveId,
          caseId: s.caseId,
          strategy: s.strategy,
          startedAt: s.startedAt,
        })),
        timestamp: new Date().toISOString(),
      });
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    // Stop all active sessions
    for (const sessionId of this.activeSessions.keys()) {
      await this.stopSession(sessionId);
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
    return this.activeSessions.size;
  }
}
