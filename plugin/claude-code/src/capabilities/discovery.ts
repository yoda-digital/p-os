/**
 * Capability discovery (spec section 9) — runs every probe in
 * `./probes.ts`, persists each result to the `CapabilityStore`, and returns
 * the aggregate profile. Meant to be called at `SessionStart` and whenever
 * the Claude Code version changes; the resulting feature list is what gets
 * sent as the `capabilities` array in the edge handshake (spec section 5.1).
 */
import { CapabilityStore } from '../storage/capabilities.js';
import { PROBES } from './probes.js';

export interface CapabilityProfile {
  claudeVersion: string | null;
  detectedAt: string;
  capabilities: Record<string, boolean>;
}

/** Best-effort Claude Code version, read from whichever env var the running
 * host happens to set. Used only to know *when* to re-run discovery — never
 * to infer a capability directly (spec section 9). */
function resolveClaudeVersion(): string | null {
  return process.env['CLAUDE_CODE_VERSION'] ?? process.env['CLAUDE_VERSION'] ?? null;
}

/**
 * Run every registered probe and persist each result, keyed by feature name,
 * alongside the Claude version observed at detection time.
 *
 * A probe throwing is recorded as "not detected" rather than aborting the
 * whole pass — one bad probe must never block SessionStart or leave the
 * remaining features undetected.
 */
export async function discoverCapabilities(): Promise<CapabilityProfile> {
  const store = new CapabilityStore();
  const claudeVersion = resolveClaudeVersion();
  const capabilities: Record<string, boolean> = {};

  for (const [feature, probe] of Object.entries(PROBES)) {
    let supported: boolean;
    try {
      supported = probe();
    } catch {
      supported = false;
    }
    capabilities[feature] = supported;
    store.set(feature, supported, claudeVersion);
  }

  return {
    claudeVersion,
    detectedAt: new Date().toISOString(),
    capabilities,
  };
}

/**
 * Whether discovery should re-run: no capability has ever been recorded, or
 * the Claude version has changed since the last detection pass (spec
 * section 9 — "At every SessionStart + on Claude version change").
 */
export function shouldRediscover(store: CapabilityStore = new CapabilityStore()): boolean {
  const existing = store.getAll();
  if (existing.length === 0) return true;

  const claudeVersion = resolveClaudeVersion();
  return existing.some((record) => record.claude_version !== claudeVersion);
}

/**
 * The capability list shape the edge handshake expects (spec section 5.1):
 * the names of every feature currently recorded as supported.
 */
export function toHandshakeCapabilities(store: CapabilityStore = new CapabilityStore()): string[] {
  return store
    .getAll()
    .filter((record) => record.supported)
    .map((record) => record.feature);
}
