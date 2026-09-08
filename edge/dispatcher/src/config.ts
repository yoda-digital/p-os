// Dispatcher Configuration Loader
// Reads config from: 1) environment variables, 2) plugin SQLite, 3) fallback config file
// Priority: env vars > SQLite > config file > defaults

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { DispatcherConfig } from './index.js';

// ── Types ────────────────────────────────────────────────────────────

export interface LoadedConfig extends DispatcherConfig {
  /** Where the config was loaded from */
  source: 'env' | 'sqlite' | 'file' | 'defaults';
  /** Data directory for logs and state */
  dataDir: string;
  /** Path to the log file */
  logPath: string;
  /** Health server port */
  healthPort: number;
}

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_CONTROL_PLANE_URL = 'wss://control.pos.digital';
const DEFAULT_HEALTH_PORT = 4002;
const DEFAULT_PLUGIN_VERSION = '0.1.0';
const DEFAULT_CLAUDE_VERSION = 'unknown';

// ── Config Loading ───────────────────────────────────────────────────

/**
 * Load configuration with fallback chain:
 * env vars > plugin SQLite > config file > defaults
 */
export function loadConfig(): LoadedConfig {
  const dataDir = getDataDir();
  const logPath = join(dataDir, 'dispatcher.log');
  const healthPort = parseInt(process.env['POS_HEALTH_PORT'] ?? '', 10) || DEFAULT_HEALTH_PORT;

  // 1. Try environment variables (highest priority)
  const envConfig = loadFromEnv();
  if (envConfig) {
    return {
      ...envConfig,
      source: 'env',
      dataDir,
      logPath,
      healthPort,
    };
  }

  // 2. Try plugin SQLite (if CLAUDE_PLUGIN_DATA is set)
  const pluginDataDir = process.env['CLAUDE_PLUGIN_DATA'];
  if (pluginDataDir) {
    const sqliteConfig = loadFromSqlite(pluginDataDir);
    if (sqliteConfig) {
      return {
        ...sqliteConfig,
        source: 'sqlite',
        dataDir,
        logPath,
        healthPort,
      };
    }
  }

  // 3. Try config file
  const fileConfig = loadFromFile();
  if (fileConfig) {
    return {
      ...fileConfig,
      source: 'file',
      dataDir,
      logPath,
      healthPort,
    };
  }

  // 4. Defaults (will connect to default control plane)
  console.warn('[Config] No config found — using defaults. Set CONTROL_PLANE_URL, DEVICE_ID, DEVICE_TOKEN env vars.');
  return {
    serverUrl: DEFAULT_CONTROL_PLANE_URL,
    deviceId: `device-${homedir().split('/').pop() ?? 'unknown'}-${process.pid}`,
    token: '',
    pluginVersion: DEFAULT_PLUGIN_VERSION,
    claudeVersion: DEFAULT_CLAUDE_VERSION,
    source: 'defaults',
    dataDir,
    logPath,
    healthPort,
  };
}

// ── Environment Variables ────────────────────────────────────────────

function loadFromEnv(): DispatcherConfig | null {
  const serverUrl = process.env['CONTROL_PLANE_URL'];
  const deviceId = process.env['DEVICE_ID'];
  const token = process.env['DEVICE_TOKEN'];

  if (!serverUrl || !deviceId || !token) {
    return null;
  }

  return {
    serverUrl,
    deviceId,
    token,
    pluginVersion: process.env['PLUGIN_VERSION'] ?? DEFAULT_PLUGIN_VERSION,
    claudeVersion: process.env['CLAUDE_VERSION'] ?? DEFAULT_CLAUDE_VERSION,
    capabilities: process.env['CAPABILITIES']?.split(',').filter(Boolean),
    forceMock: process.env['FORCE_MOCK'] === '1' || process.env['FORCE_MOCK'] === 'true',
    pollIntervalMs: parseInt(process.env['POLL_INTERVAL_MS'] ?? '', 10) || undefined,
  };
}

// ── Plugin SQLite ────────────────────────────────────────────────────

function loadFromSqlite(pluginDataDir: string): DispatcherConfig | null {
  // The plugin stores device identity in a SQLite database
  // We read it via a JSON sidecar that the plugin writes on registration
  const sidecarPath = join(pluginDataDir, 'device-identity.json');

  if (!existsSync(sidecarPath)) {
    return null;
  }

  try {
    const raw = readFileSync(sidecarPath, 'utf-8');
    const identity = JSON.parse(raw) as Record<string, unknown>;

    const serverUrl = identity['serverUrl'] as string | undefined;
    const deviceId = identity['deviceId'] as string | undefined;
    const token = identity['token'] as string | undefined;

    if (!serverUrl || !deviceId || !token) {
      console.warn('[Config] SQLite sidecar missing required fields');
      return null;
    }

    return {
      serverUrl,
      deviceId,
      token,
      pluginVersion: (identity['pluginVersion'] as string) ?? DEFAULT_PLUGIN_VERSION,
      claudeVersion: (identity['claudeVersion'] as string) ?? DEFAULT_CLAUDE_VERSION,
      capabilities: identity['capabilities'] as string[] | undefined,
    };
  } catch (err) {
    console.warn('[Config] Failed to read SQLite sidecar:', (err as Error).message);
    return null;
  }
}

// ── Config File ──────────────────────────────────────────────────────

function loadFromFile(): DispatcherConfig | null {
  const configPath = join(getDefaultDataDir(), 'config.json');

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;

    const serverUrl = config['serverUrl'] as string | undefined;
    const deviceId = config['deviceId'] as string | undefined;
    const token = config['token'] as string | undefined;

    if (!serverUrl || !deviceId || !token) {
      console.warn('[Config] Config file missing required fields (serverUrl, deviceId, token)');
      return null;
    }

    return {
      serverUrl,
      deviceId,
      token,
      pluginVersion: (config['pluginVersion'] as string) ?? DEFAULT_PLUGIN_VERSION,
      claudeVersion: (config['claudeVersion'] as string) ?? DEFAULT_CLAUDE_VERSION,
      capabilities: config['capabilities'] as string[] | undefined,
      forceMock: config['forceMock'] === true,
      pollIntervalMs: typeof config['pollIntervalMs'] === 'number' ? config['pollIntervalMs'] : undefined,
    };
  } catch (err) {
    console.warn('[Config] Failed to read config file:', (err as Error).message);
    return null;
  }
}

// ── Data Directory ───────────────────────────────────────────────────

export function getDefaultDataDir(): string {
  return join(homedir(), '.pos');
}

function getDataDir(): string {
  // CLAUDE_PLUGIN_DATA takes priority
  if (process.env['CLAUDE_PLUGIN_DATA']) {
    return process.env['CLAUDE_PLUGIN_DATA'];
  }

  // POS_DATA_DIR explicit override
  if (process.env['POS_DATA_DIR']) {
    return process.env['POS_DATA_DIR'];
  }

  return getDefaultDataDir();
}
