/**
 * Main hook dispatcher — reads JSON from stdin, routes by event name to the
 * correct handler, writes JSON response to stdout.
 *
 * Usage:
 *   - Direct:  node dist/hooks/handler.js session-start
 *   - Via shim: import { handle } from '../dist/hooks/handler.js'; await handle('session-start');
 */
import { fileURLToPath } from 'node:url';

import { handleSessionStart } from './session-start.js';
import { handleTaskCreated } from './task-created.js';
import { handleTaskCompleted } from './task-completed.js';
import { handlePreToolUse } from './pre-tool-use.js';
import { handlePostToolUse } from './post-tool-use.js';
import { handleStop } from './stop.js';
import { handleSessionEnd } from './session-end.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Loose input type — every hook event is a JSON object with varying fields. */
export type HookInput = Record<string, unknown>;

/** Loose result type — each handler returns its own subset of fields. */
export type HookResult = Record<string, unknown>;

/** Handler function signature shared by all hook handlers. */
export type HookHandler = (input: HookInput) => Promise<HookResult>;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Extract the session id from a hook input, supporting both flat
 * (`session_id`) and nested (`session.id`) shapes.
 */
export function extractSessionId(input: HookInput): string {
  if (typeof input['session_id'] === 'string') return input['session_id'];
  const session = input['session'];
  if (session && typeof session === 'object' && 'id' in session) {
    const id = (session as Record<string, unknown>)['id'];
    if (typeof id === 'string') return id;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Routing table
// ---------------------------------------------------------------------------

const handlers: Record<string, HookHandler> = {
  'session-start': handleSessionStart,
  'task-created': handleTaskCreated,
  'task-completed': handleTaskCompleted,
  'pre-tool-use': handlePreToolUse,
  'post-tool-use': handlePostToolUse,
  'stop': handleStop,
  'session-end': handleSessionEnd,
};

// ---------------------------------------------------------------------------
// stdin reader
// ---------------------------------------------------------------------------

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.resume();
  });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Read stdin, route to the handler for `eventName`, write the result to
 * stdout. On any error the handler returns `{}` so hooks never break Claude.
 */
export async function handle(eventName: string): Promise<void> {
  try {
    const raw = await readStdin();
    const input: HookInput = raw.trim() ? (JSON.parse(raw) as HookInput) : {};
    const handler = handlers[eventName];
    const result = handler ? await handler(input) : {};
    process.stdout.write(JSON.stringify(result));
  } catch {
    // Hooks must never crash Claude — swallow everything and return empty.
    process.stdout.write(JSON.stringify({}));
  }
}

// ---------------------------------------------------------------------------
// Auto-invoke when run directly (not imported by a shim)
// ---------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const eventName = process.argv[2] ?? 'unknown';
  handle(eventName).catch(() => {
    process.stdout.write(JSON.stringify({}));
  });
}
