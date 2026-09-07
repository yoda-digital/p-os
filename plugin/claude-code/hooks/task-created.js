#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
const taskId = input.task_id ?? null;
const taskTitle = input.task_title ?? input.title ?? 'Untitled task';

// Record task creation as a process event for potential Move mapping
const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.pos');
const outboxDir = join(pluginDataDir, 'outbox');

try {
  if (!existsSync(outboxDir)) {
    mkdirSync(outboxDir, { recursive: true });
  }

  const event = {
    type: 'claude_task_created',
    taskId,
    taskTitle,
    sessionId: input.session_id ?? null,
    timestamp: new Date().toISOString(),
  };

  const outboxFile = join(outboxDir, `${Date.now()}-task-created-${Math.random().toString(36).slice(2, 8)}.json`);
  writeFileSync(outboxFile, JSON.stringify(event));
} catch {
  // Telemetry must never break Claude
}

// Track active tasks in session binding
const bindingFile = join(pluginDataDir, 'session-binding.json');
try {
  let binding = {};
  if (existsSync(bindingFile)) {
    binding = JSON.parse(readFileSync(bindingFile, 'utf-8'));
  }
  if (!binding.activeTasks) binding.activeTasks = [];
  binding.activeTasks.push({ taskId, title: taskTitle, createdAt: new Date().toISOString() });
  writeFileSync(bindingFile, JSON.stringify(binding, null, 2));
} catch {
  // Best effort
}

process.stdout.write(JSON.stringify({}));
