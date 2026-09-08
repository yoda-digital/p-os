// macOS Daemon Installer — launchd user agent
// Installs to ~/Library/LaunchAgents/digital.yoda.pos-dispatcher.plist
// Runs at login and stays alive via KeepAlive

import { writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { InstallOptions, DaemonStatus } from './install.js';

const LABEL = 'digital.yoda.pos-dispatcher';
const PLIST_FILE = `${LABEL}.plist`;

function getLaunchAgentsDir(): string {
  return join(homedir(), 'Library', 'LaunchAgents');
}

function getPlistPath(): string {
  return join(getLaunchAgentsDir(), PLIST_FILE);
}

// ── Plist Generation ─────────────────────────────────────────────────

function generatePlist(entryPath: string, logPath: string, options: InstallOptions): string {
  const nodePath = process.execPath;
  const controlPlaneUrl = options.controlPlaneUrl ?? process.env['CONTROL_PLANE_URL'] ?? '';

  const envEntries: string[] = [];

  const addEnv = (key: string, value: string): void => {
    envEntries.push(`      <key>${escapeXml(key)}</key>`);
    envEntries.push(`      <string>${escapeXml(value)}</string>`);
  };

  addEnv('NODE_ENV', 'production');
  addEnv('POS_DAEMON_FOREGROUND', '0');

  if (controlPlaneUrl) addEnv('CONTROL_PLANE_URL', controlPlaneUrl);
  if (options.deviceId) addEnv('DEVICE_ID', options.deviceId);
  if (options.deviceToken) addEnv('DEVICE_TOKEN', options.deviceToken);

  // Preserve PATH so node can find claude CLI
  const currentPath = process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin';
  addEnv('PATH', currentPath);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(entryPath)}</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>ThrottleInterval</key>
  <integer>5</integer>

  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>

  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>

  <key>EnvironmentVariables</key>
  <dict>
${envEntries.join('\n')}
  </dict>

  <key>ProcessType</key>
  <string>Background</string>

  <key>LowPriorityIO</key>
  <true/>
</dict>
</plist>
`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Install ──────────────────────────────────────────────────────────

export function installLaunchdAgent(
  entryPath: string,
  logPath: string,
  options: InstallOptions,
): void {
  const agentsDir = getLaunchAgentsDir();
  const plistPath = getPlistPath();

  mkdirSync(agentsDir, { recursive: true });

  // Unload first if already loaded
  if (existsSync(plistPath)) {
    try {
      execFileSync('launchctl', ['unload', '-w', plistPath], { stdio: 'pipe' });
    } catch {
      // May not be loaded
    }
  }

  // Write the plist
  const plist = generatePlist(entryPath, logPath, options);
  writeFileSync(plistPath, plist, 'utf-8');
  console.log(`[Install] Wrote ${plistPath}`);

  // Load the agent
  try {
    execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'pipe' });
    console.log(`[Install] Loaded launchd agent ${LABEL}`);
  } catch (err) {
    console.error('[Install] Failed to load launchd agent:', (err as Error).message);
    throw err;
  }
}

// ── Uninstall ────────────────────────────────────────────────────────

export function uninstallLaunchdAgent(): void {
  const plistPath = getPlistPath();

  // Unload
  if (existsSync(plistPath)) {
    try {
      execFileSync('launchctl', ['unload', '-w', plistPath], { stdio: 'pipe' });
    } catch {
      // May not be loaded
    }
    unlinkSync(plistPath);
    console.log(`[Uninstall] Removed ${plistPath}`);
  }

  console.log('[Uninstall] Launchd agent removed');
}

// ── Status ───────────────────────────────────────────────────────────

export function launchdStatus(): DaemonStatus {
  const installed = existsSync(getPlistPath());
  if (!installed) {
    return { installed: false, running: false, platform: 'macos' };
  }

  try {
    const output = execFileSync('launchctl', ['list', LABEL], { stdio: 'pipe' }).toString();
    // If the command succeeds, the agent is loaded. Check for PID in output.
    const running = !output.includes('"PID" = 0') && output.includes('PID');
    return { installed: true, running, platform: 'macos', serviceName: LABEL };
  } catch {
    // Not loaded
    return { installed: true, running: false, platform: 'macos', serviceName: LABEL };
  }
}

// ── Start / Stop ─────────────────────────────────────────────────────

export function startLaunchd(): void {
  const plistPath = getPlistPath();
  execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'pipe' });
  console.log(`[Service] Started ${LABEL}`);
}

export function stopLaunchd(): void {
  const plistPath = getPlistPath();
  execFileSync('launchctl', ['unload', plistPath], { stdio: 'pipe' });
  console.log(`[Service] Stopped ${LABEL}`);
}
