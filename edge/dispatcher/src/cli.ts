// Claude CLI wrapper — thin interface over `claude --bg`, `claude agents --json`, `claude stop`
// Uses child_process.execFile for safe argument handling (no shell injection)

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { access, constants } from 'node:fs/promises';

const execFile = promisify(execFileCb);

// ── Types ────────────────────────────────────────────────────────────

export interface LaunchResult {
  jobId: string;
  sessionId?: string;
  pid?: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  status: string;
  cwd?: string;
  model?: string;
  started_at?: string;
  pid?: number;
}

export interface StopResult {
  stopped: boolean;
  jobId: string;
}

// ── CLI availability detection ────────────────────────────────────────

let _cliAvailable: boolean | null = null;

export async function isCliAvailable(): Promise<boolean> {
  if (_cliAvailable !== null) return _cliAvailable;

  try {
    // Check if 'claude' binary is on PATH
    const { stdout } = await execFile('which', ['claude'], { timeout: 5000 });
    _cliAvailable = stdout.trim().length > 0;
  } catch {
    _cliAvailable = false;
  }

  return _cliAvailable;
}

/** Reset cached CLI detection (useful for tests). */
export function resetCliDetection(): void {
  _cliAvailable = null;
}

// ── CLI operations ────────────────────────────────────────────────────

/**
 * Launch a background Claude session: `claude --bg --name <moveId> -p "<prompt>"`
 *
 * Returns the job ID from stdout. The CLI prints the job ID on success.
 */
export async function launchBackgroundSession(
  moveId: string,
  promptText: string,
  options?: {
    model?: string;
    cwd?: string;
    maxTokens?: number;
  },
): Promise<LaunchResult> {
  // The prompt is the positional argument (not -p which means --print)
  const args = ['--bg', '--name', moveId, promptText];

  if (options?.model) {
    args.push('--model', options.model);
  }
  if (options?.maxTokens) {
    args.push('--max-tokens', String(options.maxTokens));
  }

  const { stdout, stderr } = await execFile('claude', args, {
    cwd: options?.cwd,
    timeout: 30_000,
    env: { ...process.env },
  });

  // Parse the job ID from stdout
  // claude --bg typically prints: "Started background job: <id>" or just the ID
  const jobId = parseJobId(stdout.trim());

  if (!jobId) {
    throw new Error(
      `Failed to parse job ID from claude --bg output: ${stdout.trim()}${stderr ? ` (stderr: ${stderr.trim()})` : ''}`,
    );
  }

  return { jobId };
}

/**
 * Query running sessions: `claude agents --json`
 *
 * Returns a list of active/recent agent sessions with their metadata.
 */
export async function listAgents(): Promise<AgentInfo[]> {
  const { stdout } = await execFile('claude', ['agents', '--json'], {
    timeout: 10_000,
    env: { ...process.env },
  });

  try {
    const parsed = JSON.parse(stdout.trim());
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeAgentInfo);
    }
    // Some versions wrap in an object
    if (parsed.agents && Array.isArray(parsed.agents)) {
      return parsed.agents.map(normalizeAgentInfo);
    }
    return [];
  } catch {
    console.warn('[CLI] Failed to parse agents JSON:', stdout.substring(0, 200));
    return [];
  }
}

/**
 * Stop a running session: `claude stop <jobId>`
 */
export async function stopSession(jobId: string): Promise<StopResult> {
  try {
    await execFile('claude', ['stop', jobId], {
      timeout: 10_000,
      env: { ...process.env },
    });
    return { stopped: true, jobId };
  } catch (err) {
    // The session may already be stopped
    console.warn(`[CLI] Stop failed for job ${jobId}:`, (err as Error).message);
    return { stopped: false, jobId };
  }
}

/**
 * Get logs for a session: `claude logs <jobId>`
 */
export async function getSessionLogs(jobId: string): Promise<string> {
  try {
    const { stdout } = await execFile('claude', ['logs', jobId], {
      timeout: 10_000,
      env: { ...process.env },
    });
    return stdout;
  } catch {
    return '';
  }
}

// ── Mock mode ─────────────────────────────────────────────────────────

/** Mock implementations for development when `claude` CLI is not available. */
export const mockCli = {
  sessions: new Map<string, AgentInfo>(),

  async launchBackgroundSession(
    moveId: string,
    promptText: string,
    options?: { model?: string; cwd?: string },
  ): Promise<LaunchResult> {
    const jobId = `mock-${crypto.randomUUID().slice(0, 8)}`;
    const info: AgentInfo = {
      id: jobId,
      name: moveId,
      status: 'running',
      cwd: options?.cwd ?? process.cwd(),
      model: options?.model ?? 'claude-sonnet-4-5',
      started_at: new Date().toISOString(),
    };
    this.sessions.set(jobId, info);
    console.log(`[CLI:mock] Launched mock session ${jobId} for move ${moveId}`);
    return { jobId };
  },

  async listAgents(): Promise<AgentInfo[]> {
    return Array.from(this.sessions.values());
  },

  async stopSession(jobId: string): Promise<StopResult> {
    const info = this.sessions.get(jobId);
    if (info) {
      info.status = 'stopped';
      this.sessions.delete(jobId);
      console.log(`[CLI:mock] Stopped mock session ${jobId}`);
      return { stopped: true, jobId };
    }
    return { stopped: false, jobId };
  },

  async getSessionLogs(_jobId: string): Promise<string> {
    return '[mock] No real logs available in mock mode';
  },

  reset(): void {
    this.sessions.clear();
  },
};

// ── Helpers ───────────────────────────────────────────────────────────

function parseJobId(output: string): string | null {
  if (!output) return null;

  // Try common patterns:
  // "Started background job: abc123"
  const matchStarted = output.match(/(?:started|launched|job)[:\s]+([a-zA-Z0-9_-]+)/i);
  if (matchStarted) return matchStarted[1]!;

  // Plain UUID or short ID on a line by itself
  const matchId = output.match(/^([a-zA-Z0-9_-]{6,})$/m);
  if (matchId) return matchId[1]!;

  // JSON response with an id field
  try {
    const parsed = JSON.parse(output);
    if (parsed.id) return parsed.id;
    if (parsed.job_id) return parsed.job_id;
  } catch {
    // not JSON
  }

  // Last resort: first non-empty line
  const lines = output.split('\n').filter((l) => l.trim());
  return lines[0]?.trim() || null;
}

function normalizeAgentInfo(raw: Record<string, unknown>): AgentInfo {
  return {
    id: String(raw['id'] ?? raw['job_id'] ?? ''),
    name: String(raw['name'] ?? ''),
    status: String(raw['status'] ?? 'unknown'),
    cwd: raw['cwd'] as string | undefined,
    model: raw['model'] as string | undefined,
    started_at: raw['started_at'] as string | undefined,
    pid: typeof raw['pid'] === 'number' ? raw['pid'] : undefined,
  };
}
