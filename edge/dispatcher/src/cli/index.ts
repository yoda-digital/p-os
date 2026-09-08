#!/usr/bin/env node
// Dispatcher Daemon CLI — manage the always-on dispatcher daemon
//
// Usage:
//   npx tsx edge/dispatcher/src/cli/index.ts install   — Install as system daemon
//   npx tsx edge/dispatcher/src/cli/index.ts uninstall — Remove daemon
//   npx tsx edge/dispatcher/src/cli/index.ts status    — Check daemon status
//   npx tsx edge/dispatcher/src/cli/index.ts start     — Start daemon
//   npx tsx edge/dispatcher/src/cli/index.ts stop      — Stop daemon
//   npx tsx edge/dispatcher/src/cli/index.ts logs      — Tail daemon logs
//   npx tsx edge/dispatcher/src/cli/index.ts health    — Check health endpoint

import { installDaemon, uninstallDaemon, daemonStatus, startDaemon, stopDaemon } from '../daemon/install.js';
import { detectPlatform, platformName } from '../daemon/detect.js';
import { loadConfig } from '../config.js';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Styling ──────────────────────────────────────────────────────────

const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

function success(msg: string): void { console.log(`${GREEN}OK${RESET} ${msg}`); }
function warn(msg: string): void { console.log(`${YELLOW}!!${RESET} ${msg}`); }
function fail(msg: string): void { console.log(`${RED}FAIL${RESET} ${msg}`); }
function info(msg: string): void { console.log(`${CYAN}>>>${RESET} ${msg}`); }

// ── Commands ─────────────────────────────────────────────────────────

async function cmdInstall(args: string[]): Promise<void> {
  console.log(`${BOLD}Installing Process OS Dispatcher Daemon${RESET}\n`);

  // Parse optional flags
  const controlPlaneUrl = getFlag(args, '--url');
  const deviceId = getFlag(args, '--device-id');
  const deviceToken = getFlag(args, '--token');

  const platform = detectPlatform();
  info(`Platform: ${platformName(platform)}`);

  try {
    await installDaemon({
      controlPlaneUrl: controlPlaneUrl ?? undefined,
      deviceId: deviceId ?? undefined,
      deviceToken: deviceToken ?? undefined,
    });
    console.log('');
    success('Dispatcher daemon installed and started');
    console.log(`${DIM}Run "pos-dispatcher status" to verify${RESET}`);
  } catch (err) {
    fail(`Installation failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function cmdUninstall(): Promise<void> {
  console.log(`${BOLD}Uninstalling Process OS Dispatcher Daemon${RESET}\n`);

  try {
    await uninstallDaemon();
    console.log('');
    success('Dispatcher daemon uninstalled');
  } catch (err) {
    fail(`Uninstall failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function cmdStatus(): Promise<void> {
  console.log(`${BOLD}Dispatcher Daemon Status${RESET}\n`);

  const platform = detectPlatform();
  info(`Platform: ${platformName(platform)}`);

  try {
    const status = await daemonStatus();

    if (!status.installed) {
      warn('Daemon is NOT installed');
      console.log(`${DIM}Run "pos-dispatcher install" to install${RESET}`);
      return;
    }

    if (status.running) {
      success(`Daemon is running (service: ${status.serviceName ?? 'unknown'})`);
    } else {
      warn(`Daemon is installed but NOT running (service: ${status.serviceName ?? 'unknown'})`);
    }

    // Also try health endpoint
    console.log('');
    try {
      const health = await fetchHealth();
      info('Health endpoint responsive');
      console.log(`  Connected:  ${health.connected ? GREEN + 'yes' : RED + 'no'}${RESET}`);
      console.log(`  Sessions:   ${health.sessions}`);
      console.log(`  Mock mode:  ${health.mockMode ? 'yes' : 'no'}`);
      console.log(`  Uptime:     ${formatUptime(health.uptime)}`);
      console.log(`  Config:     ${health.configSource}`);
      console.log(`  Device:     ${health.deviceId}`);
      console.log(`  PID:        ${health.pid}`);
    } catch {
      warn('Health endpoint not responding (daemon may be starting up)');
    }
  } catch (err) {
    fail(`Status check failed: ${(err as Error).message}`);
  }
}

async function cmdStart(): Promise<void> {
  console.log(`${BOLD}Starting Dispatcher Daemon${RESET}\n`);

  try {
    await startDaemon();
    success('Daemon started');
  } catch (err) {
    fail(`Start failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function cmdStop(): Promise<void> {
  console.log(`${BOLD}Stopping Dispatcher Daemon${RESET}\n`);

  try {
    await stopDaemon();
    success('Daemon stopped');
  } catch (err) {
    fail(`Stop failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function cmdLogs(): Promise<void> {
  const config = loadConfig();
  const logPath = config.logPath;

  if (!existsSync(logPath)) {
    warn(`No log file found at ${logPath}`);
    return;
  }

  const stats = statSync(logPath);
  info(`Log file: ${logPath} (${formatBytes(stats.size)})`);
  console.log(`${DIM}--- Last 50 lines ---${RESET}\n`);

  // Read last 50 lines using a reverse scan
  await tailFile(logPath, 50);
}

async function cmdHealth(): Promise<void> {
  console.log(`${BOLD}Dispatcher Health Check${RESET}\n`);

  const config = loadConfig();
  const url = `http://127.0.0.1:${config.healthPort}/health`;
  info(`Checking ${url}`);
  console.log('');

  try {
    const health = await fetchHealth(config.healthPort);
    console.log(JSON.stringify(health, null, 2));
  } catch {
    fail('Health endpoint not responding. Is the daemon running?');
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function getFlag(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) {
    return args[idx + 1] ?? null;
  }
  return null;
}

interface HealthResponse {
  status: string;
  connected: boolean;
  sessions: number;
  mockMode: boolean;
  uptime: number;
  configSource: string;
  deviceId: string;
  pid: number;
  timestamp: string;
}

function fetchHealth(port: number = 4002): Promise<HealthResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path: '/health', method: 'GET', timeout: 3000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as HealthResponse);
          } catch {
            reject(new Error('Invalid JSON from health endpoint'));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours < 24) return `${hours}h ${mins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ${mins}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function tailFile(filePath: string, lines: number): Promise<void> {
  return new Promise((resolve) => {
    const allLines: string[] = [];
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      allLines.push(line);
      // Keep a sliding window to avoid memory issues with huge logs
      if (allLines.length > lines * 2) {
        allLines.splice(0, allLines.length - lines);
      }
    });

    rl.on('close', () => {
      const tail = allLines.slice(-lines);
      for (const line of tail) {
        console.log(line);
      }
      resolve();
    });
  });
}

// ── Usage ────────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`${BOLD}pos-dispatcher${RESET} — Process OS Dispatcher Daemon Manager\n`);
  console.log('Commands:');
  console.log(`  ${CYAN}install${RESET}    Install as a system daemon (auto-detects platform)`);
  console.log(`             Options: --url <control-plane-url> --device-id <id> --token <token>`);
  console.log(`  ${CYAN}uninstall${RESET}  Remove the daemon`);
  console.log(`  ${CYAN}status${RESET}     Check daemon status and health`);
  console.log(`  ${CYAN}start${RESET}      Start the daemon`);
  console.log(`  ${CYAN}stop${RESET}       Stop the daemon`);
  console.log(`  ${CYAN}logs${RESET}       Show the last 50 log lines`);
  console.log(`  ${CYAN}health${RESET}     Check the health HTTP endpoint (JSON)`);
  console.log('');
  console.log(`${DIM}Platform: ${platformName(detectPlatform())}${RESET}`);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'install':
      return cmdInstall(args.slice(1));
    case 'uninstall':
      return cmdUninstall();
    case 'status':
      return cmdStatus();
    case 'start':
      return cmdStart();
    case 'stop':
      return cmdStop();
    case 'logs':
      return cmdLogs();
    case 'health':
      return cmdHealth();
    case '--help':
    case '-h':
    case 'help':
      printUsage();
      return;
    default:
      if (command) {
        fail(`Unknown command: ${command}`);
        console.log('');
      }
      printUsage();
      if (command) process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
