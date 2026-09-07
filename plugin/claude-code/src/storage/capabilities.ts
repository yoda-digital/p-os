import { getLocalDb } from './db.js';

export interface CapabilityRecord {
  feature: string;
  supported: boolean;
  detected_at: string;
  claude_version: string | null;
}

interface CapabilityRow {
  feature: string;
  supported: number;
  detected_at: string;
  claude_version: string | null;
}

function toRecord(row: CapabilityRow): CapabilityRecord {
  return { ...row, supported: row.supported !== 0 };
}

/**
 * Capability profile storage: which Claude Code capabilities (hooks, MCP,
 * tasks, subagents, ...) were detected as supported on this install, used
 * to build the edge handshake's `capabilities` array (spec section 5.1).
 */
export class CapabilityStore {
  /** Get the detection record for one feature, or `null` if never detected. */
  get(feature: string): CapabilityRecord | null {
    const db = getLocalDb();
    const row = db
      .prepare<[string], CapabilityRow>('SELECT * FROM capabilities WHERE feature = ?')
      .get(feature);
    return row ? toRecord(row) : null;
  }

  /** Record (or update) whether a feature is supported. */
  set(feature: string, supported: boolean, claudeVersion: string | null = null): void {
    const db = getLocalDb();
    db.prepare(
      `INSERT INTO capabilities (feature, supported, detected_at, claude_version)
       VALUES (@feature, @supported, @detected_at, @claude_version)
       ON CONFLICT(feature) DO UPDATE SET
         supported = excluded.supported,
         detected_at = excluded.detected_at,
         claude_version = excluded.claude_version`,
    ).run({
      feature,
      supported: supported ? 1 : 0,
      detected_at: new Date().toISOString(),
      claude_version: claudeVersion,
    });
  }

  /** List every recorded capability. */
  getAll(): CapabilityRecord[] {
    const db = getLocalDb();
    return db
      .prepare<[], CapabilityRow>('SELECT * FROM capabilities ORDER BY feature ASC')
      .all()
      .map(toRecord);
  }
}
