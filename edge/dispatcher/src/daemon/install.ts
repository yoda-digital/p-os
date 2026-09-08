// Unified Daemon Installer — cross-platform install/uninstall/status
// Routes to platform-specific implementations based on detectPlatform()

import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { detectPlatform, platformName, type Platform } from './detect.js';
import { installSystemdService, uninstallSystemdService, systemdStatus, startSystemd, stopSystemd } from './linux.js';
import { installLaunchdAgent, uninstallLaunchdAgent, launchdStatus, startLaunchd, stopLaunchd } from './macos.js';
import { installWindowsTask, uninstallWindowsTask, windowsTaskStatus, startWindowsTask, stopWindowsTask } from './windows.js';
import { installWslDaemon, uninstallWslDaemon, wslDaemonStatus, startWslDaemon, stopWslDaemon } from './wsl.js';

// ── Types ────────────────────────────────────────────────────────────

export interface InstallOptions {
  /** Override data directory (default: ~/.pos) */
  dataDir?: string;
  /** Control plane URL override */
  controlPlaneUrl?: string;
  /** Device identity overrides */
  deviceId?: string;
  deviceToken?: string;
}

export interface DaemonStatus {
  installed: boolean;
  running: boolean;
  platform: Platform;
  serviceName?: string;
  pid?: number;
}

// ── Default Paths ────────────────────────────────────────────────────

function getDefaultDataDir(): string {
  return join(homedir(), '.pos');
}

function getEntryPath(): string {
  // When running from compiled output, use the dist path
  // When running via tsx, use the source path
  const distEntry = resolve(__dirname, '..', 'dist', 'entry.js');
  const srcEntry = resolve(__dirname, 'entry.js');

  // In production, we'd use the compiled entry. For now, resolve to source.
  // The daemon installer will store the absolute path at install time.
  return distEntry;
}

// ── Install ──────────────────────────────────────────────────────────

export async function installDaemon(options: InstallOptions = {}): Promise<void> {
  const platform = detectPlatform();
  const entryPath = getEntryPath();
  const dataDir = options.dataDir ?? getDefaultDataDir();
  const logPath = join(dataDir, 'dispatcher.log');

  console.log(`[Install] Platform: ${platformName(platform)}`);
  console.log(`[Install] Entry: ${entryPath}`);
  console.log(`[Install] Log: ${logPath}`);
  console.log(`[Install] Node: ${process.execPath}`);
  console.log('');

  switch (platform) {
    case 'linux':
      return installSystemdService(entryPath, logPath, options);
    case 'macos':
      return installLaunchdAgent(entryPath, logPath, options);
    case 'windows':
      return installWindowsTask(entryPath, logPath, options);
    case 'wsl':
      return installWslDaemon(entryPath, logPath, options);
  }
}

// ── Uninstall ────────────────────────────────────────────────────────

export async function uninstallDaemon(): Promise<void> {
  const platform = detectPlatform();

  console.log(`[Uninstall] Platform: ${platformName(platform)}`);
  console.log('');

  switch (platform) {
    case 'linux':
      return uninstallSystemdService();
    case 'macos':
      return uninstallLaunchdAgent();
    case 'windows':
      return uninstallWindowsTask();
    case 'wsl':
      return uninstallWslDaemon();
  }
}

// ── Status ───────────────────────────────────────────────────────────

export async function daemonStatus(): Promise<DaemonStatus> {
  const platform = detectPlatform();

  switch (platform) {
    case 'linux':
      return systemdStatus();
    case 'macos':
      return launchdStatus();
    case 'windows':
      return windowsTaskStatus();
    case 'wsl':
      return wslDaemonStatus();
  }
}

// ── Start / Stop ─────────────────────────────────────────────────────

export async function startDaemon(): Promise<void> {
  const platform = detectPlatform();

  switch (platform) {
    case 'linux':
      return startSystemd();
    case 'macos':
      return startLaunchd();
    case 'windows':
      return startWindowsTask();
    case 'wsl':
      return startWslDaemon();
  }
}

export async function stopDaemon(): Promise<void> {
  const platform = detectPlatform();

  switch (platform) {
    case 'linux':
      return stopSystemd();
    case 'macos':
      return stopLaunchd();
    case 'windows':
      return stopWindowsTask();
    case 'wsl':
      return stopWslDaemon();
  }
}
