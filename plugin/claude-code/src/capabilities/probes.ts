/**
 * Capability probes (spec section 9) — one function per Claude Code feature
 * the plugin cares about, each attempting to detect that feature at
 * runtime. Never infer a capability from a parsed Claude version string:
 * a probe either observes the feature directly (a command flag exists, a
 * binary succeeds, a protocol version is new enough) or, when a feature
 * genuinely can't be confirmed before it's used, defaults to `true` and
 * leaves the actual usage site to correct the record (e.g. the
 * `TaskCreated` hook confirms `task_tools` simply by having fired at all).
 *
 * Every probe is synchronous and defensive — a probe must never throw past
 * its own boundary, since discovery runs all of them at SessionStart and one
 * misbehaving probe must not block the others (discovery.ts also wraps each
 * call, but probes are written not to need that safety net).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Run a short-lived command and report whether it exited successfully. */
function commandSucceeds(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Run a command and check its combined output for a marker string. */
function commandOutputIncludes(command: string, args: string[], marker: string): boolean {
  try {
    const output = execFileSync(command, args, { timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'] });
    return output.toString().includes(marker);
  } catch {
    return false;
  }
}

function hasNonEmptyEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0;
}

// ---------------------------------------------------------------------------
// Always true — inherent to running as an installed Claude Code plugin
// ---------------------------------------------------------------------------

/** This code is executing as a plugin hook/MCP process right now — hook
 * support is a precondition for the plugin existing at all. */
export function probePluginHooks(): boolean {
  return true;
}

/** The Process MCP server is declared in `.mcp.json` and ships with this
 * plugin — MCP support is inherent to Claude Code, not something to detect. */
export function probePluginMcp(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Detectable at startup
// ---------------------------------------------------------------------------

/** `claude --bg` / managed background sessions. Checked via an env var
 * Claude Code sets when already running in one, falling back to scanning
 * `claude --help` for the flag. */
export function probeBackgroundSessions(): boolean {
  if (hasNonEmptyEnv('CLAUDE_BACKGROUND_SESSION')) return true;
  return commandOutputIncludes('claude', ['--help'], '--bg');
}

/** Native `git worktree` support — required for parallel Move execution
 * across isolated working copies. */
export function probeWorktrees(): boolean {
  return commandSucceeds('git', ['worktree', 'list']);
}

/** MCP protocol/SDK generation in use. Probed by feature, not version
 * string (per spec section 9): `registerTool` — the high-level tool
 * registration API this plugin's own MCP server uses — only exists on the
 * 1.x `@modelcontextprotocol/sdk` line, so its presence on `McpServer` is
 * itself the "v2" signal. (The package's `./package.json` export subpath
 * resolves to a small `{"type":"commonjs"}` shim rather than the real
 * manifest, so parsing a version string back out of it isn't reliable
 * anyway — one more reason to probe the actual API surface instead.) */
export function probeMcpV2(): boolean {
  try {
    const mod = require('@modelcontextprotocol/sdk/server/mcp.js') as {
      McpServer?: { prototype?: Record<string, unknown> };
    };
    return typeof mod.McpServer?.prototype?.['registerTool'] === 'function';
  } catch {
    // Can't load the SDK to inspect it — assume the newer generation rather
    // than penalize a probe implementation detail.
    return true;
  }
}

// ---------------------------------------------------------------------------
// Not testable in isolation at startup — default true, confirmed by usage
// ---------------------------------------------------------------------------

/** Confirmed in practice by `task-created.ts` actually firing; nothing to
 * check before that happens. */
export function probeTaskTools(): boolean {
  return true;
}

/** Subagent dispatch support. No reliable startup signal exists; assumed
 * available until a dispatch attempt says otherwise. */
export function probeSubagents(): boolean {
  return true;
}

/** Multi-agent "team" orchestration. No startup signal available. */
export function probeAgentTeams(): boolean {
  return true;
}

/** Dynamic (non-linear) workflow support. No startup signal available. */
export function probeDynamicWorkflows(): boolean {
  return true;
}

/** Supervisor visibility into agent views. No startup signal available. */
export function probeAgentViewSupervisor(): boolean {
  return true;
}

/** Cross-session messaging (spec section 12's guardian/architect agents
 * rely on this eventually). No startup signal available. */
export function probeCrossSessionMessaging(): boolean {
  return true;
}

/** Channel-based delivery (e.g. Slack/Telegram bridges). No startup signal
 * available from inside a plugin process. */
export function probeChannels(): boolean {
  return true;
}

/** MCP tool search (progressive tool disclosure) — assumed available on any
 * 1.x SDK generation; usage of the search itself is the real confirmation. */
export function probeMcpToolSearch(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All 13 capability probes, keyed by the feature name discovery.ts stores
 * them under (spec section 9). */
export const PROBES: Record<string, () => boolean> = {
  plugin_hooks: probePluginHooks,
  plugin_mcp: probePluginMcp,
  task_tools: probeTaskTools,
  subagents: probeSubagents,
  agent_teams: probeAgentTeams,
  dynamic_workflows: probeDynamicWorkflows,
  background_sessions: probeBackgroundSessions,
  agent_view_supervisor: probeAgentViewSupervisor,
  cross_session_messaging: probeCrossSessionMessaging,
  worktrees: probeWorktrees,
  channels: probeChannels,
  mcp_v2: probeMcpV2,
  mcp_tool_search: probeMcpToolSearch,
};
