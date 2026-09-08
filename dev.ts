#!/usr/bin/env tsx
/**
 * Universal Process OS — Dev Orchestrator
 * Starts all services for local development:
 * 1. Embedded PostgreSQL
 * 2. Database migrations
 * 3. API server (port 4000)
 * 4. WebSocket realtime gateway (port 4001)
 * 5. Background worker
 * 6. Web UI (port 3000, via Vite)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const processes: ChildProcess[] = [];

function startProcess(name: string, command: string, args: string[], cwd?: string): ChildProcess {
  console.log(`\x1b[36m[${name}]\x1b[0m Starting: ${command} ${args.join(' ')}`);
  const proc = spawn(command, args, {
    cwd: cwd ?? process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  proc.stdout?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      console.log(`\x1b[36m[${name}]\x1b[0m ${line}`);
    }
  });

  proc.stderr?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      console.log(`\x1b[33m[${name}]\x1b[0m ${line}`);
    }
  });

  proc.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(`\x1b[31m[${name}]\x1b[0m Exited with code ${code}`);
    }
  });

  processes.push(proc);
  return proc;
}

async function main() {
  console.log('\x1b[35m');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     Universal Process OS — Dev Mode      ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('\x1b[0m');

  // Step 1: Start embedded PostgreSQL and run migrations
  console.log('\x1b[32m→ Starting PostgreSQL...\x1b[0m');
  const dbProc = startProcess('DB', 'npx', ['tsx', 'packages/db/src/start.ts']);

  // Wait for DB to be ready
  await setTimeout(5000);
  console.log('\x1b[32m→ Database ready.\x1b[0m');

  // Step 2: Start API server
  console.log('\x1b[32m→ Starting API server...\x1b[0m');
  startProcess('API', 'npx', ['tsx', 'watch', 'apps/api/src/index.ts']);
  await setTimeout(2000);

  // Step 3: Start realtime gateway
  console.log('\x1b[32m→ Starting WebSocket gateway...\x1b[0m');
  startProcess('WS', 'npx', ['tsx', 'watch', 'apps/realtime/src/index.ts']);
  await setTimeout(1000);

  // Step 4: Start background worker
  console.log('\x1b[32m→ Starting background worker...\x1b[0m');
  startProcess('WORKER', 'npx', ['tsx', 'watch', 'apps/worker/src/index.ts']);
  await setTimeout(1000);

  // Step 4.5: Start dispatcher (optional, for testing execution flow)
  if (process.env['START_DISPATCHER'] !== '0') {
    console.log('\x1b[32m→ Starting dispatcher...\x1b[0m');
    startProcess('DISPATCH', 'npx', ['tsx', 'edge/dispatcher/src/entry.ts']);
    await setTimeout(1000);
  }

  // Step 5: Start web UI
  console.log('\x1b[32m→ Starting web UI...\x1b[0m');
  startProcess('WEB', 'npx', ['vite', '--port', '3000'], 'apps/web');

  console.log('\x1b[35m');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  All services started!                   ║');
  console.log('║                                          ║');
  console.log('║  Web UI:    http://localhost:3000         ║');
  console.log('║  API:       http://localhost:4000         ║');
  console.log('║  WebSocket: ws://localhost:4001           ║');
  console.log('║  Dispatcher: http://localhost:4002/health ║');
  console.log('║                                          ║');
  console.log('║  Press Ctrl+C to stop all services       ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('\x1b[0m');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\x1b[33m→ Shutting down all services...\x1b[0m');
  for (const proc of processes) {
    proc.kill('SIGTERM');
  }
  setTimeout(2000).then(() => {
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  for (const proc of processes) {
    proc.kill('SIGTERM');
  }
  process.exit(0);
});

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
