import { getLocalDb } from './db.js';

export interface PolicyMirrorEntry {
  id: string;
  policy_data: string;
  version: number;
  expires_at: string;
  signature: string;
  fetched_at: string;
}

export interface UpsertPolicyMirrorInput {
  id: string;
  policyData: unknown;
  version: number;
  expiresAt: string;
  signature: string;
}

/**
 * Local policy mirror (spec section 5.3): a signed, expiring subset of
 * control-plane policy cached locally so PreToolUse can enforce policy
 * without a network round trip. Never trust this store for policy that
 * has expired — always prefer `getActive`.
 */
export class PolicyMirrorStore {
  /** Get one policy mirror entry by id, regardless of expiry. */
  get(id: string): PolicyMirrorEntry | null {
    const db = getLocalDb();
    const row = db
      .prepare<[string], PolicyMirrorEntry>('SELECT * FROM policy_mirror WHERE id = ?')
      .get(id);
    return row ?? null;
  }

  /** Insert or replace a policy mirror entry, stamping `fetched_at`. */
  upsert(input: UpsertPolicyMirrorInput): void {
    const db = getLocalDb();
    db.prepare(
      `INSERT INTO policy_mirror (id, policy_data, version, expires_at, signature, fetched_at)
       VALUES (@id, @policy_data, @version, @expires_at, @signature, @fetched_at)
       ON CONFLICT(id) DO UPDATE SET
         policy_data = excluded.policy_data,
         version = excluded.version,
         expires_at = excluded.expires_at,
         signature = excluded.signature,
         fetched_at = excluded.fetched_at`,
    ).run({
      id: input.id,
      policy_data: JSON.stringify(input.policyData),
      version: input.version,
      expires_at: input.expiresAt,
      signature: input.signature,
      fetched_at: new Date().toISOString(),
    });
  }

  /** List all policy mirror entries that have not yet expired. */
  getActive(): PolicyMirrorEntry[] {
    const db = getLocalDb();
    return db
      .prepare<[string], PolicyMirrorEntry>(
        'SELECT * FROM policy_mirror WHERE expires_at > ? ORDER BY version DESC',
      )
      .all(new Date().toISOString());
  }

  /** Delete expired policy mirror entries. Returns the number removed. */
  pruneExpired(): number {
    const db = getLocalDb();
    const result = db
      .prepare('DELETE FROM policy_mirror WHERE expires_at <= ?')
      .run(new Date().toISOString());
    return result.changes;
  }
}
