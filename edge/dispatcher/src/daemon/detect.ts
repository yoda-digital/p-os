// Platform Detection — detects the runtime platform including WSL
// Used by the daemon installer to generate the correct service configuration

import { readFileSync } from 'node:fs';

export type Platform = 'linux' | 'macos' | 'windows' | 'wsl';

/**
 * Detect the current platform, distinguishing WSL from native Linux.
 * WSL is detected by checking /proc/version for "microsoft" (case insensitive).
 */
export function detectPlatform(): Platform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';

  if (process.platform === 'linux') {
    try {
      const release = readFileSync('/proc/version', 'utf-8');
      if (release.toLowerCase().includes('microsoft')) return 'wsl';
    } catch {
      // Cannot read /proc/version — assume native Linux
    }
    return 'linux';
  }

  // Fallback for unknown platforms
  return 'linux';
}

/**
 * Get a human-readable name for the detected platform.
 */
export function platformName(platform: Platform): string {
  switch (platform) {
    case 'linux': return 'Linux (systemd)';
    case 'macos': return 'macOS (launchd)';
    case 'windows': return 'Windows (Task Scheduler)';
    case 'wsl': return 'WSL2 (systemd + Task Scheduler)';
  }
}

/**
 * Detect if systemd is available (needed for Linux and WSL).
 */
export function hasSystemd(): boolean {
  try {
    readFileSync('/run/systemd/system', 'utf-8');
    return true;
  } catch {
    // Some systems put the marker elsewhere
    try {
      const initSystem = readFileSync('/proc/1/comm', 'utf-8').trim();
      return initSystem === 'systemd';
    } catch {
      return false;
    }
  }
}

/**
 * Get the WSL distribution name (for wsl.exe -d <distro> commands).
 */
export function getWslDistroName(): string | null {
  const distro = process.env['WSL_DISTRO_NAME'];
  return distro ?? null;
}
