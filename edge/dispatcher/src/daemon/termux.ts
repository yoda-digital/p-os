// Termux Daemon Installer — runit (termux-services) with nohup fallback
//
// Primary: termux-services (runit) — proper process supervision, auto-restart,
//          structured logging via svlogd. Installed with `pkg install termux-services`.
//
// Fallback: nohup + PID file + self-respawning wrapper — when termux-services
//           is not installed. Same approach as universal.ts but with Termux-specific
//           wake-lock hints and notification integration.
//
// Both strategies benefit from:
//   - termux-wake-lock (prevents Android from killing backgrounded Termux)
//   - termux-notification (persistent status notification, requires termux-api)

import {
  writeFileSync, mkdirSync, existsSync, unlinkSync,
  readFileSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import type { InstallOptions, DaemonStatus } from './install.js';
import { hasTermuxServices, hasTermuxApi } from './detect.js';

const SERVICE_NAME = 'pos-dispatcher';
const PREFIX = process.env['PREFIX'] ?? '/data/data/com.termux/files/usr';
const SHEBANG = `${PREFIX}/bin/sh`;

function getServiceDir(): string {
  return join(PREFIX, 'var', 'service', SERVICE_NAME);
}

function getLogDir(): string {
  return join(PREFIX, 'var', 'log', SERVICE_NAME);
}

function getPidFile(): string {
  return join(homedir(), '.pos', 'run', 'posd.pid');
}

function getWrapperPath(): string {
  return join(homedir(), '.pos', 'posd.sh');
}

// ── Environment Block ───────────────────────────────────────────────

function buildEnvLines(options: InstallOptions): string[] {
  const controlPlaneUrl = options.controlPlaneUrl ?? process.env['CONTROL_PLANE_URL'] ?? '';
  const lines: string[] = [
    'export NODE_ENV=production',
    'export POS_DAEMON_FOREGROUND=0',
  ];
  if (controlPlaneUrl) lines.push(`export CONTROL_PLANE_URL='${controlPlaneUrl}'`);
  if (options.deviceId) lines.push(`export DEVICE_ID='${options.deviceId}'`);
  if (options.deviceToken) lines.push(`export DEVICE_TOKEN='${options.deviceToken}'`);
  return lines;
}

// ── Runit Service Scripts ───────────────────────────────────────────

function generateRunScript(entryPath: string, options: InstallOptions): string {
  const nodePath = process.execPath;
  const envLines = buildEnvLines(options);

  // exec replaces the shell with node — runit can signal the actual process
  return `#!${SHEBANG}
exec 2>&1
${envLines.join('\n')}
exec ${nodePath} ${entryPath}
`;
}

function generateLogRunScript(): string {
  const logDir = getLogDir();
  return `#!${SHEBANG}
mkdir -p ${logDir}
exec svlogd -tt ${logDir}
`;
}

// ── Nohup Wrapper (fallback without termux-services) ────────────────

function generateWrapper(entryPath: string, options: InstallOptions): string {
  const nodePath = process.execPath;
  const dataDir = options.dataDir ?? join(homedir(), '.pos');
  const envLines = buildEnvLines(options);

  // Self-supervising wrapper with:
  // - Signal forwarding to child node process
  // - Crash detection with exponential backoff
  // - Gives up after 10 rapid failures (< 5s runtime each)
  return `#!${SHEBANG}
# POS Dispatcher — self-supervised wrapper for Termux
set -e

POS_HOME="${dataDir}"
PID_FILE="\$POS_HOME/run/posd.pid"
LOG_FILE="\$POS_HOME/log/posd.log"
NODE_BIN="${nodePath}"
ENTRY="${entryPath}"

mkdir -p "\$POS_HOME/run" "\$POS_HOME/log"
echo \$\$ > "\$PID_FILE"

NODE_PID=""
cleanup() {
  if [ -n "\$NODE_PID" ]; then
    kill -TERM "\$NODE_PID" 2>/dev/null || true
    wait "\$NODE_PID" 2>/dev/null || true
  fi
  rm -f "\$PID_FILE"
  exit 0
}
trap cleanup TERM INT HUP

${envLines.join('\n')}

CRASH_COUNT=0
while true; do
  START_TIME=\$(date +%s)
  "\$NODE_BIN" "\$ENTRY" >> "\$LOG_FILE" 2>&1 &
  NODE_PID=\$!
  wait \$NODE_PID 2>/dev/null || true
  NODE_PID=""
  END_TIME=\$(date +%s)
  RUNTIME=\$((END_TIME - START_TIME))

  if [ "\$RUNTIME" -lt 5 ]; then
    CRASH_COUNT=\$((CRASH_COUNT + 1))
    if [ "\$CRASH_COUNT" -ge 10 ]; then
      echo "[\$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Too many rapid crashes (\$CRASH_COUNT), stopping" >> "\$LOG_FILE"
      rm -f "\$PID_FILE"
      exit 1
    fi
    DELAY=\$((CRASH_COUNT * 2))
    echo "[\$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Rapid crash #\$CRASH_COUNT, waiting \${DELAY}s..." >> "\$LOG_FILE"
    sleep "\$DELAY"
  else
    CRASH_COUNT=0
    echo "[\$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Dispatcher exited, restarting in 5s..." >> "\$LOG_FILE"
    sleep 5
  fi
done
`;
}

// ── Install ──────────────────────────────────────────────────────────

export function installTermuxService(
  entryPath: string,
  logPath: string,
  options: InstallOptions,
): void {
  if (hasTermuxServices()) {
    installRunit(entryPath, options);
  } else {
    installNohup(entryPath, options);
  }

  printTermuxTips();
}

function installRunit(entryPath: string, options: InstallOptions): void {
  const serviceDir = getServiceDir();
  const logRunDir = join(serviceDir, 'log');

  // Create service directory structure
  mkdirSync(logRunDir, { recursive: true });

  // Write run script (must be executable — runit requires this)
  const runPath = join(serviceDir, 'run');
  writeFileSync(runPath, generateRunScript(entryPath, options), { mode: 0o755 });
  console.log(`[Install] Wrote ${runPath}`);

  // Write log/run script
  const logRunPath = join(logRunDir, 'run');
  writeFileSync(logRunPath, generateLogRunScript(), { mode: 0o755 });
  console.log(`[Install] Wrote ${logRunPath}`);

  // Create log output directory
  mkdirSync(getLogDir(), { recursive: true });

  // runit auto-discovers services in $PREFIX/var/service/ — no enable step needed.
  // But if sv-enable exists (some termux-services versions), use it for clarity.
  try {
    execFileSync('sv-enable', [SERVICE_NAME], { stdio: 'pipe' });
    console.log(`[Install] Enabled ${SERVICE_NAME} via sv-enable`);
  } catch {
    console.log(`[Install] Service registered at ${serviceDir} (auto-discovered by runit)`);
  }

  // Start the service
  try {
    execFileSync('sv', ['up', SERVICE_NAME], { stdio: 'pipe' });
    console.log(`[Install] Started ${SERVICE_NAME}`);
  } catch {
    console.warn('[Install] Could not start — try: sv up pos-dispatcher');
  }
}

function installNohup(entryPath: string, options: InstallOptions): void {
  const dataDir = options.dataDir ?? join(homedir(), '.pos');
  mkdirSync(join(dataDir, 'run'), { recursive: true });
  mkdirSync(join(dataDir, 'log'), { recursive: true });

  // Write self-supervising wrapper
  const wrapperPath = getWrapperPath();
  writeFileSync(wrapperPath, generateWrapper(entryPath, options), { mode: 0o755 });
  console.log(`[Install] Wrote ${wrapperPath}`);

  // Start immediately
  try {
    execSync(`nohup "${wrapperPath}" > /dev/null 2>&1 &`, { stdio: 'pipe', shell: `${SHEBANG}` });
    console.log('[Install] Started dispatcher via nohup');
  } catch {
    console.warn(`[Install] Could not auto-start — run: ${wrapperPath} &`);
  }
}

function printTermuxTips(): void {
  console.log('');
  console.log('┌─ Termux Tips ──────────────────────────────────────────────────┐');
  console.log('│                                                                │');
  console.log('│  Run termux-wake-lock to prevent Android from killing Termux   │');
  console.log('│  background processes. Without it, the daemon may stop when    │');
  console.log('│  you switch apps.                                              │');
  if (!hasTermuxServices()) {
    console.log('│                                                                │');
    console.log('│  For proper process supervision with auto-restart:             │');
    console.log('│    pkg install termux-services && pos-dispatcher install       │');
  }
  if (hasTermuxApi()) {
    console.log('│                                                                │');
    console.log('│  termux-api detected — persistent notification available.      │');
  } else {
    console.log('│                                                                │');
    console.log('│  Optional: pkg install termux-api for status notifications.    │');
  }
  console.log('│                                                                │');
  console.log('└────────────────────────────────────────────────────────────────┘');
}

// ── Uninstall ────────────────────────────────────────────────────────

export function uninstallTermuxService(): void {
  // Stop and remove runit service if present
  if (hasTermuxServices()) {
    try { execFileSync('sv', ['down', SERVICE_NAME], { stdio: 'pipe' }); } catch {}
    try { execFileSync('sv-disable', [SERVICE_NAME], { stdio: 'pipe' }); } catch {}

    const serviceDir = getServiceDir();
    if (existsSync(serviceDir)) {
      rmSync(serviceDir, { recursive: true });
      console.log(`[Uninstall] Removed ${serviceDir}`);
    }
  }

  // Clean up nohup wrapper and PID
  const pidFile = getPidFile();
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      if (pid > 0) process.kill(pid, 'SIGTERM');
      console.log(`[Uninstall] Stopped dispatcher (PID ${pid})`);
    } catch {}
    try { unlinkSync(pidFile); } catch {}
  }

  const wrapperPath = getWrapperPath();
  if (existsSync(wrapperPath)) {
    unlinkSync(wrapperPath);
    console.log(`[Uninstall] Removed ${wrapperPath}`);
  }

  // Remove notification
  if (hasTermuxApi()) {
    try { execFileSync('termux-notification-remove', ['pos-dispatcher'], { stdio: 'pipe' }); } catch {}
  }

  console.log('[Uninstall] Termux service removed');
}

// ── Status ───────────────────────────────────────────────────────────

export function termuxStatus(): DaemonStatus {
  // Check runit first
  if (hasTermuxServices()) {
    const serviceDir = getServiceDir();
    if (!existsSync(join(serviceDir, 'run'))) {
      return { installed: false, running: false, platform: 'termux' };
    }

    try {
      const output = execFileSync('sv', ['status', SERVICE_NAME], {
        stdio: 'pipe', encoding: 'utf-8',
      }) as unknown as string;
      const running = output.startsWith('run:');
      return { installed: true, running, platform: 'termux', serviceName: SERVICE_NAME };
    } catch {
      return { installed: true, running: false, platform: 'termux', serviceName: SERVICE_NAME };
    }
  }

  // Nohup fallback status
  if (!existsSync(getWrapperPath())) {
    return { installed: false, running: false, platform: 'termux' };
  }

  const pidFile = getPidFile();
  if (!existsSync(pidFile)) {
    return { installed: true, running: false, platform: 'termux' };
  }

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    process.kill(pid, 0); // Signal 0 — check if alive
    return { installed: true, running: true, platform: 'termux', pid };
  } catch {
    return { installed: true, running: false, platform: 'termux' };
  }
}

// ── Start / Stop ─────────────────────────────────────────────────────

export function startTermux(): void {
  if (hasTermuxServices()) {
    execFileSync('sv', ['up', SERVICE_NAME], { stdio: 'pipe' });
    console.log(`[Service] Started ${SERVICE_NAME} (runit)`);
    return;
  }

  const wrapperPath = getWrapperPath();
  if (!existsSync(wrapperPath)) {
    throw new Error('Not installed — run: pos-dispatcher install');
  }

  // Check if already running
  const pidFile = getPidFile();
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      process.kill(pid, 0);
      console.log(`[Service] Already running (PID ${pid})`);
      return;
    } catch {
      try { unlinkSync(pidFile); } catch {}
    }
  }

  execSync(`nohup "${wrapperPath}" > /dev/null 2>&1 &`, { stdio: 'pipe', shell: `${SHEBANG}` });
  console.log('[Service] Started dispatcher (nohup)');
}

export function stopTermux(): void {
  if (hasTermuxServices()) {
    try {
      execFileSync('sv', ['down', SERVICE_NAME], { stdio: 'pipe' });
      console.log(`[Service] Stopped ${SERVICE_NAME} (runit)`);
      return;
    } catch {}
  }

  const pidFile = getPidFile();
  if (!existsSync(pidFile)) {
    console.warn('[Service] Not running (no PID file)');
    return;
  }

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    process.kill(pid, 'SIGTERM');
    console.log(`[Service] Stopped dispatcher (PID ${pid})`);
  } catch {
    console.warn('[Service] Could not stop — process may already be dead');
    try { unlinkSync(pidFile); } catch {}
  }
}
