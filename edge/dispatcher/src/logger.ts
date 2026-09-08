// Dispatcher Logger — file-based logging with rotation
// Logs to ${dataDir}/dispatcher.log with 5 MB rotation

import { createWriteStream, statSync, renameSync, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';

// ── Constants ────────────────────────────────────────────────────────

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const CHECK_INTERVAL_MS = 60_000; // Check size every 60s

// ── Logger ───────────────────────────────────────────────────────────

export class FileLogger {
  private stream: WriteStream | null = null;
  private rotateTimer: ReturnType<typeof setInterval> | null = null;
  private originalStdoutWrite: typeof process.stdout.write;
  private originalStderrWrite: typeof process.stderr.write;

  constructor(private logPath: string) {
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    this.originalStderrWrite = process.stderr.write.bind(process.stderr);
  }

  /**
   * Start logging. Creates the log directory if needed, opens the file stream,
   * and redirects stdout/stderr to the file (while also writing to original streams).
   */
  start(): void {
    // Ensure directory exists
    const dir = dirname(this.logPath);
    mkdirSync(dir, { recursive: true });

    this.openStream();
    this.interceptConsole();

    // Periodic size check for rotation
    this.rotateTimer = setInterval(() => {
      this.checkRotation();
    }, CHECK_INTERVAL_MS);
  }

  /** Stop logging, restore console, close stream. */
  stop(): void {
    if (this.rotateTimer) {
      clearInterval(this.rotateTimer);
      this.rotateTimer = null;
    }

    this.restoreConsole();
    this.stream?.end();
    this.stream = null;
  }

  /** Write a line directly to the log file. */
  write(message: string): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    this.stream?.write(line);
  }

  // ── Internal ────────────────────────────────────────────────────

  private openStream(): void {
    this.stream?.end();
    this.stream = createWriteStream(this.logPath, { flags: 'a' });
    this.stream.on('error', (err) => {
      this.originalStderrWrite(`[Logger] Write error: ${err.message}\n`);
    });
  }

  private checkRotation(): void {
    try {
      const stats = statSync(this.logPath);
      if (stats.size > MAX_LOG_SIZE) {
        this.rotate();
      }
    } catch {
      // File may not exist yet — that is fine
    }
  }

  private rotate(): void {
    this.stream?.end();
    this.stream = null;

    try {
      renameSync(this.logPath, `${this.logPath}.1`);
    } catch {
      // Rotation rename failed — log will just keep growing until next check
    }

    this.openStream();
    this.write('Log rotated');
  }

  private interceptConsole(): void {
    const self = this;

    // Intercept stdout — use the same overload signature Node declares
    process.stdout.write = function (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
      callback?: (err?: Error | null) => void,
    ): boolean {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      self.stream?.write(text);
      // Also write to original stdout for dev mode visibility
      if (process.env['POS_DAEMON_FOREGROUND'] === '1') {
        if (typeof encodingOrCallback === 'function') {
          return self.originalStdoutWrite(chunk, encodingOrCallback);
        }
        return self.originalStdoutWrite(chunk, encodingOrCallback, callback);
      }
      return true;
    };

    // Intercept stderr
    process.stderr.write = function (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
      callback?: (err?: Error | null) => void,
    ): boolean {
      const text = typeof chunk === 'string' ? chunk : chunk.toString();
      self.stream?.write(text);
      if (process.env['POS_DAEMON_FOREGROUND'] === '1') {
        if (typeof encodingOrCallback === 'function') {
          return self.originalStderrWrite(chunk, encodingOrCallback);
        }
        return self.originalStderrWrite(chunk, encodingOrCallback, callback);
      }
      return true;
    };
  }

  private restoreConsole(): void {
    process.stdout.write = this.originalStdoutWrite;
    process.stderr.write = this.originalStderrWrite;
  }
}
