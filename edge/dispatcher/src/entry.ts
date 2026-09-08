#!/usr/bin/env node
// Dispatcher Daemon Entry Point
// The "something" that starts Claude when no terminal is open.
//
// Lifecycle:
// 1. Load config from env / SQLite sidecar / config file
// 2. Start file logger with rotation
// 3. Create ProcessDispatcher and connect to control plane via WSS
// 4. Start HTTP health server on port 4002
// 5. Handle SIGTERM/SIGINT for graceful shutdown
//
// Run directly:    node entry.js
// Run via tsx:     npx tsx edge/dispatcher/src/entry.ts
// Install daemon:  npx tsx edge/dispatcher/src/cli/index.ts install

import { createServer, type Server } from 'node:http';
import { mkdirSync } from 'node:fs';
import { loadConfig, type LoadedConfig } from './config.js';
import { FileLogger } from './logger.js';
import { ProcessDispatcher } from './index.js';

// ── Health Server ────────────────────────────────────────────────────

function createHealthServer(
  dispatcher: ProcessDispatcher,
  config: LoadedConfig,
): Server {
  const server = createServer((req, res) => {
    // Only respond to /health
    if (req.url === '/health' && req.method === 'GET') {
      const body = JSON.stringify({
        status: 'running',
        connected: dispatcher.isConnected,
        sessions: dispatcher.sessionCount,
        mockMode: dispatcher.isMockMode,
        uptime: Math.floor(process.uptime()),
        configSource: config.source,
        deviceId: config.deviceId,
        pid: process.pid,
        timestamp: new Date().toISOString(),
      });

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(body);
      return;
    }

    // Liveness probe — minimal response
    if (req.url === '/livez') {
      res.writeHead(200);
      res.end('ok');
      return;
    }

    // Readiness probe — checks WSS connection
    if (req.url === '/readyz') {
      if (dispatcher.isConnected) {
        res.writeHead(200);
        res.end('ok');
      } else {
        res.writeHead(503);
        res.end('not connected');
      }
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  return server;
}

// ── CLI Retry Check ──────────────────────────────────────────────────

let cliRetryTimer: ReturnType<typeof setInterval> | null = null;

/**
 * If Claude CLI is not available on startup, periodically recheck.
 * Once found, the dispatcher can be restarted to pick it up.
 */
function startCliRetryCheck(dispatcher: ProcessDispatcher): void {
  if (!dispatcher.isMockMode) return; // CLI is already available

  const CLI_RETRY_INTERVAL_MS = 5 * 60_000; // Every 5 minutes

  cliRetryTimer = setInterval(() => {
    // The dispatcher checks CLI on start() — we log the hint
    console.log('[Daemon] Claude CLI still not detected. Install with: npm install -g @anthropic-ai/claude-code');
  }, CLI_RETRY_INTERVAL_MS);
}

function stopCliRetryCheck(): void {
  if (cliRetryTimer) {
    clearInterval(cliRetryTimer);
    cliRetryTimer = null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Load config
  const config = loadConfig();

  // 2. Ensure data directory exists
  mkdirSync(config.dataDir, { recursive: true });

  // 3. Start file logger
  const logger = new FileLogger(config.logPath);
  logger.start();

  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Process OS — Dispatcher Daemon         ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`[Daemon] PID: ${process.pid}`);
  console.log(`[Daemon] Config source: ${config.source}`);
  console.log(`[Daemon] Device ID: ${config.deviceId}`);
  console.log(`[Daemon] Control plane: ${config.serverUrl}`);
  console.log(`[Daemon] Data dir: ${config.dataDir}`);
  console.log(`[Daemon] Log file: ${config.logPath}`);

  // 4. Create and start the dispatcher
  const dispatcher = new ProcessDispatcher(config);
  await dispatcher.start();

  // 5. Start CLI retry check if in mock mode
  startCliRetryCheck(dispatcher);

  // 6. Start health server
  const healthServer = createHealthServer(dispatcher, config);

  await new Promise<void>((resolve, reject) => {
    healthServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[Daemon] Port ${config.healthPort} already in use. Another dispatcher may be running.`);
        reject(err);
      } else {
        console.error('[Daemon] Health server error:', err.message);
        reject(err);
      }
    });

    healthServer.listen(config.healthPort, '127.0.0.1', () => {
      console.log(`[Daemon] Health server listening on http://127.0.0.1:${config.healthPort}/health`);
      resolve();
    });
  });

  console.log('[Daemon] Ready — listening for commands from control plane.');

  // 7. Graceful shutdown
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n[Daemon] Received ${signal} — shutting down...`);

    stopCliRetryCheck();

    // Close health server (stop accepting new connections)
    healthServer.close();

    // Stop the dispatcher (stops sessions, disconnects WSS)
    try {
      await dispatcher.stop();
    } catch (err) {
      console.error('[Daemon] Error during dispatcher shutdown:', (err as Error).message);
    }

    // Stop logger last
    logger.write(`Shutdown complete (${signal})`);
    logger.stop();

    process.exit(0);
  }

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  // Handle uncaught errors — log and continue (daemon must survive)
  process.on('uncaughtException', (err) => {
    console.error('[Daemon] Uncaught exception:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[Daemon] Unhandled rejection:', reason);
  });
}

// ── Entry ────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('[Daemon] Fatal error during startup:', err);
  process.exit(1);
});
