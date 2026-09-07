import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

let db: Database.Database | null = null;

/**
 * Resolve the plugin data directory. Claude Code sets `CLAUDE_PLUGIN_DATA`
 * for installed plugins; for local development we fall back to a
 * `.data/plugin` directory under the current working directory.
 */
function getDataDir(): string {
  const pluginData = process.env['CLAUDE_PLUGIN_DATA'];
  if (pluginData) return pluginData;
  return join(process.cwd(), '.data', 'plugin');
}

/**
 * Get (or lazily open) the singleton local SQLite database used by all
 * plugin storage modules. The database lives at
 * `${CLAUDE_PLUGIN_DATA}/process-os.db` (see spec section 6).
 */
export function getLocalDb(): Database.Database {
  if (db) return db;

  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'process-os.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    -- Device identity
    CREATE TABLE IF NOT EXISTS device (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      organization_id TEXT,
      paired_at TEXT,
      control_plane_url TEXT,
      auth_token TEXT
    );

    -- Session bindings
    CREATE TABLE IF NOT EXISTS session_bindings (
      session_id TEXT PRIMARY KEY,
      case_id TEXT,
      move_id TEXT,
      attempt_id TEXT,
      workspace_path TEXT,
      bound_at TEXT,
      status TEXT DEFAULT 'active'
    );

    -- Process cache (local copy of remote state)
    CREATE TABLE IF NOT EXISTS process_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT
    );

    -- Capability profile
    CREATE TABLE IF NOT EXISTS capabilities (
      feature TEXT PRIMARY KEY,
      supported INTEGER NOT NULL,
      detected_at TEXT NOT NULL,
      claude_version TEXT
    );

    -- Local event outbox (spec 5.2)
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      uploaded_at TEXT,
      retry_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending'
    );

    -- Local policy mirror (spec 5.3)
    CREATE TABLE IF NOT EXISTS policy_mirror (
      id TEXT PRIMARY KEY,
      policy_data TEXT NOT NULL,
      version INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      signature TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    -- Steering queue
    CREATE TABLE IF NOT EXISTS pending_steering (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      move_id TEXT,
      steering_class TEXT NOT NULL,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL,
      delivered_at TEXT,
      acknowledged_at TEXT
    );

    -- Stop block counter
    CREATE TABLE IF NOT EXISTS stop_blocks (
      session_id TEXT PRIMARY KEY,
      consecutive_count INTEGER DEFAULT 0,
      last_blocked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox (status);
    CREATE INDEX IF NOT EXISTS idx_policy_mirror_expires_at ON policy_mirror (expires_at);
    CREATE INDEX IF NOT EXISTS idx_pending_steering_case_id ON pending_steering (case_id);
    CREATE INDEX IF NOT EXISTS idx_session_bindings_status ON session_bindings (status);
  `);
}

/** Close the singleton database, if open. Mainly useful for tests. */
export function closeLocalDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
