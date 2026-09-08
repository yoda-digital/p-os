// Platform Detection — detects the runtime environment
// Cascade: macOS → Windows → Termux → WSL → Linux (systemd) → Universal fallback
//
// The universal fallback means we NEVER say "unsupported platform".
// If it has /bin/sh and node, it works.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export type Platform = 'linux' | 'macos' | 'windows' | 'wsl' | 'termux' | 'universal';

/**
 * Detect the current platform with full cascade.
 *
 * Order matters:
 * 1. macOS (darwin) — launchd
 * 2. Windows (win32) — Task Scheduler
 * 3. Termux native (Android, $PREFIX points to Termux) — termux-services or nohup
 * 4. WSL2 (/proc/version contains "microsoft") — systemd + Windows keep-alive
 * 5. Linux with systemd — systemd user service
 * 6. Universal fallback — nohup + PID file (proot-distro, Alpine, Void, containers, *BSD)
 */
export function detectPlatform(): Platform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';

  if (process.platform === 'linux') {
    // Termux native — must come before WSL (Termux can't run in WSL, but check order matters)
    if (isTermux()) return 'termux';

    // WSL2
    try {
      const release = readFileSync('/proc/version', 'utf-8');
      if (release.toLowerCase().includes('microsoft')) return 'wsl';
    } catch {
      // Cannot read /proc/version — not WSL
    }

    // Linux with systemd
    if (hasSystemd()) return 'linux';

    // Everything else: proot-distro, Alpine (OpenRC), Void (runit), containers, etc.
    return 'universal';
  }

  // FreeBSD, OpenBSD, SunOS, anything exotic — universal fallback
  return 'universal';
}

/**
 * Human-readable platform name for CLI output.
 */
export function platformName(platform: Platform): string {
  switch (platform) {
    case 'linux': return 'Linux (systemd)';
    case 'macos': return 'macOS (launchd)';
    case 'windows': return 'Windows (Task Scheduler)';
    case 'wsl': return 'WSL2 (systemd + Task Scheduler)';
    case 'termux': return `Termux${hasTermuxServices() ? ' (termux-services)' : ' (self-supervised)'}`;
    case 'universal': return isProot()
      ? 'proot-distro (self-supervised)'
      : 'Linux (self-supervised)';
  }
}

// ── Environment Probes ──────────────────────────────────────────────

/**
 * Detect if running inside native Termux on Android.
 * Checks $PREFIX (Termux sets this to /data/data/com.termux/files/usr)
 * and $TERMUX_VERSION (set in newer Termux builds).
 */
export function isTermux(): boolean {
  const prefix = process.env['PREFIX'] ?? '';
  if (prefix.startsWith('/data/data/com.termux')) return true;
  if (process.env['TERMUX_VERSION']) return true;
  return false;
}

/**
 * Detect if running inside a proot environment.
 * Covers proot-distro on Termux and standalone proot usage.
 */
export function isProot(): boolean {
  // Explicit proot marker — proot itself sets this
  if (process.env['PROOT_TMP_DIR']) return true;
  // Android kernel but not native Termux → likely proot-distro
  if (isAndroidKernel() && !isTermux()) return true;
  return false;
}

/**
 * Detect if the kernel is Android-based (used for proot detection).
 */
function isAndroidKernel(): boolean {
  try {
    const version = readFileSync('/proc/version', 'utf-8');
    return version.toLowerCase().includes('android');
  } catch {
    return false;
  }
}

/**
 * Detect if systemd is the init system.
 */
export function hasSystemd(): boolean {
  // Check for systemd runtime directory (most reliable)
  if (existsSync('/run/systemd/system')) return true;
  try {
    const initSystem = readFileSync('/proc/1/comm', 'utf-8').trim();
    return initSystem === 'systemd';
  } catch {
    return false;
  }
}

/**
 * Detect if termux-services (runit supervision) is available.
 */
export function hasTermuxServices(): boolean {
  try {
    execFileSync('which', ['sv'], { stdio: 'pipe' });
    const prefix = process.env['PREFIX'] ?? '/data/data/com.termux/files/usr';
    return existsSync(`${prefix}/var/service`);
  } catch {
    return false;
  }
}

/**
 * Detect if termux-api tools are installed (for notifications).
 */
export function hasTermuxApi(): boolean {
  try {
    execFileSync('which', ['termux-notification'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the WSL distribution name (for wsl.exe -d <distro> commands).
 */
export function getWslDistroName(): string | null {
  return process.env['WSL_DISTRO_NAME'] ?? null;
}
