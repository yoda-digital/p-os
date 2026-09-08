// Universal Daemon Installer — the Torvalds fallback
//
// Works on ANY POSIX system with Node.js. No init system required.
//
// Handles: proot-distro, Alpine (OpenRC), Void (runit), Artix (s6/dinit),
//          Devuan (sysvinit), containers, Chromebooks (Crostini w/o systemd),
//          iSH (iOS), FreeBSD, and anything else with /bin/sh + node.
//
// Strategy: Self-supervising shell wrapper with:
//   - nohup + PID file for daemonization
//   - Signal forwarding to child node process
//   - Crash detection with exponential backoff (gives up after 10 rapid failures)
//   - Shell profile auto-start (sources ~/.pos/env.sh on login)
//   - proot-distro detection with persistence warnings

import {
  writeFileSync, mkdirSync, existsSync, unlinkSync,
  readFileSync, appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import type { InstallOptions, DaemonStatus } from './install.js';
import { isProot } from './detect.js';

const PROFILE_MARKER = '# pos-dispatcher auto-start';

function getDataDir(options?: InstallOptions): string {
  return options?.dataDir ?? join(homedir(), '.pos');
}

function getPidFile(options?: InstallOptions): string {
  return join(getDataDir(options), 'run', 'posd.pid');
}

function getWrapperPath(options?: InstallOptions): string {
  return join(getDataDir(options), 'posd.sh');
}

function getEnvPath(options?: InstallOptions): string {
  return join(getDataDir(options), 'env.sh');
}

// ── Wrapper Generation ──────────────────────────────────────────────

function generateWrapper(entryPath: string, options: InstallOptions): string {
  const nodePath = process.execPath;
  const dataDir = getDataDir(options);
  const controlPlaneUrl = options.controlPlaneUrl ?? process.env['CONTROL_PLANE_URL'] ?? '';

  const envLines: string[] = [
    'export NODE_ENV=production',
    'export POS_DAEMON_FOREGROUND=0',
  ];
  if (controlPlaneUrl) envLines.push(`export CONTROL_PLANE_URL='${controlPlaneUrl}'`);
  if (options.deviceId) envLines.push(`export DEVICE_ID='${options.deviceId}'`);
  if (options.deviceToken) envLines.push(`export DEVICE_TOKEN='${options.deviceToken}'`);

  // Self-supervising wrapper with:
  // - Signal forwarding: SIGTERM/INT/HUP → child node process
  // - Crash backoff: rapid restarts (< 5s runtime) trigger increasing delays
  // - Crash limit: 10 rapid failures → daemon gives up (prevents CPU spin)
  // - Clean PID tracking: wrapper PID in file, child PID tracked for signal forwarding
  return `#!/bin/sh
# POS Dispatcher — self-supervised wrapper
# Works on any POSIX system with Node.js. No init system required.

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

function generateEnvScript(options?: InstallOptions): string {
  const wrapperPath = getWrapperPath(options);
  const pidFile = getPidFile(options);

  // Sourced from shell profile on login. Starts the daemon if not running.
  // Guard: checks PID file + kill -0 to avoid double-start.
  return `# POS Dispatcher auto-start — sourced from shell profile
${PROFILE_MARKER}
if [ -f "${wrapperPath}" ]; then
  if ! [ -f "${pidFile}" ] || ! kill -0 "\$(cat "${pidFile}" 2>/dev/null)" 2>/dev/null; then
    nohup "${wrapperPath}" > /dev/null 2>&1 &
    disown 2>/dev/null || true
  fi
fi
`;
}

// ── Shell Profile Management ────────────────────────────────────────

function getShellProfiles(): string[] {
  const home = homedir();
  return [
    join(home, '.bashrc'),
    join(home, '.zshrc'),
    join(home, '.profile'),
  ].filter(p => existsSync(p));
}

function addToProfiles(envPath: string): void {
  const sourceLine = `\n${PROFILE_MARKER}\n[ -f "${envPath}" ] && . "${envPath}"\n`;
  const profiles = getShellProfiles();

  if (profiles.length === 0) {
    // No profiles exist — create .profile
    const defaultProfile = join(homedir(), '.profile');
    writeFileSync(defaultProfile, sourceLine, 'utf-8');
    console.log(`[Install] Created ${defaultProfile} with auto-start`);
    return;
  }

  for (const profile of profiles) {
    const content = readFileSync(profile, 'utf-8');
    if (content.includes(PROFILE_MARKER)) {
      console.log(`[Install] ${profile} already has auto-start`);
      continue;
    }
    appendFileSync(profile, sourceLine, 'utf-8');
    console.log(`[Install] Added auto-start to ${profile}`);
  }
}

function removeFromProfiles(): void {
  const profiles = getShellProfiles();

  for (const profile of profiles) {
    const content = readFileSync(profile, 'utf-8');
    if (!content.includes(PROFILE_MARKER)) continue;

    // Remove the marker line and the source line after it
    const lines = content.split('\n');
    const cleaned: string[] = [];
    let skipNext = false;

    for (const line of lines) {
      if (line.trim() === PROFILE_MARKER) {
        skipNext = true;
        continue;
      }
      if (skipNext) {
        skipNext = false;
        continue;
      }
      cleaned.push(line);
    }

    writeFileSync(profile, cleaned.join('\n'), 'utf-8');
    console.log(`[Uninstall] Removed auto-start from ${profile}`);
  }
}

// ── Install ──────────────────────────────────────────────────────────

export function installUniversalDaemon(
  entryPath: string,
  _logPath: string,
  options: InstallOptions,
): void {
  const dataDir = getDataDir(options);
  mkdirSync(join(dataDir, 'run'), { recursive: true });
  mkdirSync(join(dataDir, 'log'), { recursive: true });

  // Write self-supervising wrapper
  const wrapperPath = getWrapperPath(options);
  writeFileSync(wrapperPath, generateWrapper(entryPath, options), { mode: 0o755 });
  console.log(`[Install] Wrote ${wrapperPath}`);

  // Write env.sh for shell profile auto-start
  const envPath = getEnvPath(options);
  writeFileSync(envPath, generateEnvScript(options), { mode: 0o644 });
  console.log(`[Install] Wrote ${envPath}`);

  // Add source line to active shell profiles
  addToProfiles(envPath);

  // Start immediately
  try {
    execSync(`nohup "${wrapperPath}" > /dev/null 2>&1 &`, { stdio: 'pipe', shell: '/bin/sh' });
    console.log('[Install] Started dispatcher');
  } catch {
    console.warn(`[Install] Could not auto-start — run: ${wrapperPath} &`);
  }

  // Platform-specific post-install hints
  if (isProot()) {
    printProotTips();
  } else {
    printUniversalTips(wrapperPath);
  }
}

function printProotTips(): void {
  console.log('');
  console.log('┌─ proot-distro detected ──────────────────────────────────────────┐');
  console.log('│                                                                   │');
  console.log('│  The daemon lives only while this proot session is open.          │');
  console.log('│  It auto-starts on each login via your shell profile.             │');
  console.log('│                                                                   │');
  console.log('│  For persistence, run in host Termux:                             │');
  console.log('│    termux-wake-lock                                               │');
  console.log('│                                                                   │');
  console.log('│  To keep proot alive when backgrounded:                           │');
  console.log('│    nohup proot-distro login <distro> -- sleep infinity &          │');
  console.log('│                                                                   │');
  console.log('└───────────────────────────────────────────────────────────────────┘');
}

function printUniversalTips(wrapperPath: string): void {
  console.log('');
  console.log('┌─ Self-supervised mode ────────────────────────────────────────────┐');
  console.log('│                                                                   │');
  console.log('│  No systemd/launchd detected — using nohup + PID supervision.    │');
  console.log('│  Daemon auto-starts on shell login and respawns on crash.         │');
  console.log('│                                                                   │');
  console.log('│  For boot-start without a login shell, add to crontab:            │');
  console.log(`│    @reboot ${wrapperPath}`);
  console.log('│                                                                   │');
  console.log('└───────────────────────────────────────────────────────────────────┘');
}

// ── Uninstall ────────────────────────────────────────────────────────

export function uninstallUniversalDaemon(): void {
  // Stop the daemon
  const pidFile = getPidFile();
  if (existsSync(pidFile)) {
    try {
      const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
      if (pid > 0) process.kill(pid, 'SIGTERM');
      console.log(`[Uninstall] Stopped dispatcher (PID ${pid})`);
    } catch {}
    try { unlinkSync(pidFile); } catch {}
  }

  // Remove wrapper
  const wrapperPath = getWrapperPath();
  if (existsSync(wrapperPath)) {
    unlinkSync(wrapperPath);
    console.log(`[Uninstall] Removed ${wrapperPath}`);
  }

  // Remove env.sh
  const envPath = getEnvPath();
  if (existsSync(envPath)) {
    unlinkSync(envPath);
    console.log(`[Uninstall] Removed ${envPath}`);
  }

  // Remove source lines from shell profiles
  removeFromProfiles();

  console.log('[Uninstall] Universal daemon removed');
}

// ── Status ───────────────────────────────────────────────────────────

export function universalStatus(): DaemonStatus {
  if (!existsSync(getWrapperPath())) {
    return { installed: false, running: false, platform: 'universal' };
  }

  const pidFile = getPidFile();
  if (!existsSync(pidFile)) {
    return { installed: true, running: false, platform: 'universal' };
  }

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    process.kill(pid, 0); // Signal 0 — check if process is alive
    return { installed: true, running: true, platform: 'universal', pid };
  } catch {
    // PID file exists but process is dead — stale PID
    return { installed: true, running: false, platform: 'universal' };
  }
}

// ── Start / Stop ─────────────────────────────────────────────────────

export function startUniversal(): void {
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
      // Stale PID file — clean up and proceed
      try { unlinkSync(pidFile); } catch {}
    }
  }

  execSync(`nohup "${wrapperPath}" > /dev/null 2>&1 &`, { stdio: 'pipe', shell: '/bin/sh' });
  console.log('[Service] Started dispatcher');
}

export function stopUniversal(): void {
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
