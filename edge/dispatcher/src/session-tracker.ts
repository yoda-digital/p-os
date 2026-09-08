// Session Tracker — tracks active Claude sessions and handles recovery
// Spec reference: SP3 §1.3 (Session Binding), §1.4 (Recovery)

import type { AgentInfo } from './cli.js';

// ── Types ────────────────────────────────────────────────────────────

export interface TrackedSession {
  /** Claude background job ID (from `claude --bg`) */
  jobId: string;
  /** The Move this session is executing */
  moveId: string;
  /** The Case the Move belongs to */
  caseId: string;
  /** The Attempt record ID in the database */
  attemptId?: string;
  /** Execution strategy used */
  strategy: string;
  /** Model used for this session */
  model?: string;
  /** Working directory */
  workingDirectory?: string;
  /** Git worktree path (if isolation=worktree) */
  worktreePath?: string;
  /** When the session was started */
  startedAt: string;
  /** Current session status */
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'lost';
  /** PID of the Claude process (if known) */
  pid?: number;
}

export interface ReconciliationResult {
  /** Sessions found running that we already track */
  rebound: TrackedSession[];
  /** Sessions found running that we don't know about (orphans) */
  orphaned: AgentInfo[];
  /** Sessions we thought were running but aren't (stale) */
  stale: TrackedSession[];
}

// ── Session Tracker ──────────────────────────────────────────────────

export class SessionTracker {
  private sessions = new Map<string, TrackedSession>();

  /** Register a new session after launching it. */
  track(session: TrackedSession): void {
    this.sessions.set(session.jobId, session);
  }

  /** Get a tracked session by job ID. */
  get(jobId: string): TrackedSession | undefined {
    return this.sessions.get(jobId);
  }

  /** Find a tracked session by move ID. */
  findByMove(moveId: string): TrackedSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.moveId === moveId && session.status !== 'stopped') {
        return session;
      }
    }
    return undefined;
  }

  /** Remove a session from tracking. */
  untrack(jobId: string): boolean {
    return this.sessions.delete(jobId);
  }

  /** Mark a session as stopped. */
  markStopped(jobId: string): void {
    const session = this.sessions.get(jobId);
    if (session) {
      session.status = 'stopped';
    }
  }

  /** Mark a session as running (e.g. after recovery). */
  markRunning(jobId: string): void {
    const session = this.sessions.get(jobId);
    if (session) {
      session.status = 'running';
    }
  }

  /** Get all active (non-stopped) sessions. */
  getActive(): TrackedSession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status !== 'stopped',
    );
  }

  /** Get all tracked sessions (including stopped). */
  getAll(): TrackedSession[] {
    return Array.from(this.sessions.values());
  }

  /** Count of active sessions. */
  get activeCount(): number {
    return this.getActive().length;
  }

  /**
   * Recovery: reconcile tracked sessions against actual running agents.
   *
   * On dispatcher restart (spec §1.4):
   * 1. Run `claude agents --json` to discover existing sessions
   * 2. Match by name (which is moveId) to rebind to canonical Attempts
   * 3. Update any stale session states
   */
  reconcile(discoveredAgents: AgentInfo[]): ReconciliationResult {
    const result: ReconciliationResult = {
      rebound: [],
      orphaned: [],
      stale: [],
    };

    const discoveredByName = new Map<string, AgentInfo>();
    const discoveredById = new Map<string, AgentInfo>();

    for (const agent of discoveredAgents) {
      if (agent.name) discoveredByName.set(agent.name, agent);
      if (agent.id) discoveredById.set(agent.id, agent);
    }

    // Check our tracked sessions against discovered agents
    for (const session of this.sessions.values()) {
      if (session.status === 'stopped') continue;

      // Try to match by job ID first, then by name (moveId)
      const matchById = discoveredById.get(session.jobId);
      const matchByName = discoveredByName.get(session.moveId);
      const match = matchById ?? matchByName;

      if (match) {
        // Session is still running — rebind
        const isRunning = match.status === 'running' || match.status === 'active';
        session.status = isRunning ? 'running' : 'stopped';

        if (match.cwd) session.workingDirectory = match.cwd;
        if (match.model) session.model = match.model;
        if (match.pid) session.pid = match.pid;

        result.rebound.push(session);

        // Remove from discovered so we can find orphans
        if (matchById) discoveredById.delete(session.jobId);
        if (matchByName) discoveredByName.delete(session.moveId);
      } else {
        // Session is gone — mark stale
        session.status = 'lost';
        result.stale.push(session);
      }
    }

    // Any remaining discovered agents are orphans (running but not tracked by us)
    const knownIds = new Set(Array.from(this.sessions.values()).map((s) => s.jobId));
    const knownNames = new Set(Array.from(this.sessions.values()).map((s) => s.moveId));

    for (const agent of discoveredAgents) {
      if (!knownIds.has(agent.id) && !knownNames.has(agent.name)) {
        result.orphaned.push(agent);
      }
    }

    return result;
  }

  /** Clear all tracked sessions. */
  clear(): void {
    this.sessions.clear();
  }
}
