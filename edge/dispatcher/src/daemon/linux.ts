// Linux Daemon Installer — systemd user service
// Installs to ~/.config/systemd/user/pos-dispatcher.service
// Enables linger so the service survives logout

import { writeFileSync, mkdirSync, existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { InstallOptions, DaemonStatus } from './install.js';

const SERVICE_NAME = 'pos-dispatcher';
const SERVICE_FILE = `${SERVICE_NAME}.service`;

function getServiceDir(): string {
  return join(homedir(), '.config', 'systemd', 'user');
}

function getServicePath(): string {
  return join(getServiceDir(), SERVICE_FILE);
}

// ── Unit File Generation ─────────────────────────────────────────────

function generateUnit(entryPath: string, logPath: string, options: InstallOptions): string {
  const nodePath = process.execPath; // Absolute path to node binary
  const controlPlaneUrl = options.controlPlaneUrl ?? process.env['CONTROL_PLANE_URL'] ?? '';

  const envLines: string[] = [
    'Environment=NODE_ENV=production',
    'Environment=POS_DAEMON_FOREGROUND=0',
  ];

  if (controlPlaneUrl) {
    envLines.push(`Environment=CONTROL_PLANE_URL=${controlPlaneUrl}`);
  }
  if (options.deviceId) {
    envLines.push(`Environment=DEVICE_ID=${options.deviceId}`);
  }
  if (options.deviceToken) {
    envLines.push(`Environment=DEVICE_TOKEN=${options.deviceToken}`);
  }

  return `[Unit]
Description=Universal Process OS Dispatcher
Documentation=https://github.com/yoda-digital/process-os
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${nodePath} ${entryPath}
Restart=always
RestartSec=5
${envLines.join('\n')}
StandardOutput=append:${logPath}
StandardError=append:${logPath}

# Resource limits
MemoryMax=512M
CPUQuota=50%

[Install]
WantedBy=default.target
`;
}

// ── Install ──────────────────────────────────────────────────────────

export function installSystemdService(
  entryPath: string,
  logPath: string,
  options: InstallOptions,
): void {
  const serviceDir = getServiceDir();
  const servicePath = getServicePath();

  // Create systemd user directory
  mkdirSync(serviceDir, { recursive: true });

  // Write the unit file
  const unit = generateUnit(entryPath, logPath, options);
  writeFileSync(servicePath, unit, 'utf-8');
  console.log(`[Install] Wrote ${servicePath}`);

  // Reload systemd
  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
    console.log('[Install] Reloaded systemd user daemon');
  } catch (err) {
    console.error('[Install] Failed to reload systemd:', (err as Error).message);
    throw err;
  }

  // Enable and start the service
  try {
    execFileSync('systemctl', ['--user', 'enable', '--now', SERVICE_NAME], { stdio: 'pipe' });
    console.log(`[Install] Enabled and started ${SERVICE_NAME}`);
  } catch (err) {
    console.error('[Install] Failed to enable service:', (err as Error).message);
    throw err;
  }

  // Enable lingering so service survives logout
  try {
    const user = process.env['USER'] ?? process.env['LOGNAME'] ?? '';
    if (user) {
      execFileSync('loginctl', ['enable-linger', user], { stdio: 'pipe' });
      console.log(`[Install] Enabled linger for user ${user}`);
    }
  } catch {
    console.warn('[Install] Could not enable linger — service may stop on logout');
  }
}

// ── Uninstall ────────────────────────────────────────────────────────

export function uninstallSystemdService(): void {
  const servicePath = getServicePath();

  // Stop and disable
  try {
    execFileSync('systemctl', ['--user', 'stop', SERVICE_NAME], { stdio: 'pipe' });
  } catch {
    // May not be running
  }
  try {
    execFileSync('systemctl', ['--user', 'disable', SERVICE_NAME], { stdio: 'pipe' });
  } catch {
    // May not be enabled
  }

  // Remove the unit file
  if (existsSync(servicePath)) {
    unlinkSync(servicePath);
    console.log(`[Uninstall] Removed ${servicePath}`);
  }

  // Reload
  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
  } catch {
    // Best effort
  }

  console.log('[Uninstall] Systemd service removed');
}

// ── Status ───────────────────────────────────────────────────────────

export function systemdStatus(): DaemonStatus {
  const installed = existsSync(getServicePath());
  if (!installed) {
    return { installed: false, running: false, platform: 'linux' };
  }

  try {
    execFileSync('systemctl', ['--user', 'is-active', SERVICE_NAME], { stdio: 'pipe' });
    // Exit code 0 = active
    return { installed: true, running: true, platform: 'linux', serviceName: SERVICE_NAME };
  } catch {
    // Non-zero exit = not active
    return { installed: true, running: false, platform: 'linux', serviceName: SERVICE_NAME };
  }
}

// ── Start / Stop ─────────────────────────────────────────────────────

export function startSystemd(): void {
  execFileSync('systemctl', ['--user', 'start', SERVICE_NAME], { stdio: 'pipe' });
  console.log(`[Service] Started ${SERVICE_NAME}`);
}

export function stopSystemd(): void {
  execFileSync('systemctl', ['--user', 'stop', SERVICE_NAME], { stdio: 'pipe' });
  console.log(`[Service] Stopped ${SERVICE_NAME}`);
}
