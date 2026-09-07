#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
const taskId = input.task_id ?? null;
const taskTitle = input.task_title ?? input.title ?? 'Untitled task';
const taskResult = input.result ?? 'completed';

const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.pos');
const outboxDir = join(pluginDataDir, 'outbox');
const bindingFile = join(pluginDataDir, 'session-binding.json');

// Check local completion policy — can we block this task from completing?
let binding = null;
try {
  if (existsSync(bindingFile)) {
    binding = JSON.parse(readFileSync(bindingFile, 'utf-8'));
  }
} catch {
  // No binding
}

const result = {};

// If this task is mapped to a Move, check local completion policy
if (binding?.taskMoveMapping?.[taskId]) {
  const moveInfo = binding.taskMoveMapping[taskId];

  // Load local policy cache
  const policyFile = join(pluginDataDir, 'policy-cache.json');
  let policy = null;
  try {
    if (existsSync(policyFile)) {
      policy = JSON.parse(readFileSync(policyFile, 'utf-8'));
    }
  } catch {
    // No policy
  }

  // Check if completion requires specific evidence
  if (moveInfo.completionContract?.requireTests) {
    // Check if we saw test evidence in outbox
    let hasTestEvidence = false;
    try {
      if (existsSync(outboxDir)) {
        const files = (await import('node:fs')).readdirSync(outboxDir);
        for (const f of files) {
          try {
            const data = JSON.parse(readFileSync(join(outboxDir, f), 'utf-8'));
            if (data.candidates?.some((c) => c.type === 'test_run')) {
              hasTestEvidence = true;
              break;
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // Can't check, allow completion
      hasTestEvidence = true;
    }

    if (!hasTestEvidence) {
      // Block completion — missing test evidence
      result.decision = 'block';
      result.reason = `Move "${moveInfo.title}" requires test evidence before completion. Run tests first.`;
    }
  }
}

// Record task completion event
try {
  if (!existsSync(outboxDir)) {
    mkdirSync(outboxDir, { recursive: true });
  }

  const event = {
    type: 'claude_task_completed',
    taskId,
    taskTitle,
    taskResult,
    blocked: result.decision === 'block',
    sessionId: input.session_id ?? null,
    timestamp: new Date().toISOString(),
  };

  const outboxFile = join(outboxDir, `${Date.now()}-task-completed-${Math.random().toString(36).slice(2, 8)}.json`);
  writeFileSync(outboxFile, JSON.stringify(event));
} catch {
  // Telemetry must never break Claude
}

// Remove from active tasks
try {
  if (binding?.activeTasks) {
    binding.activeTasks = binding.activeTasks.filter((t) => t.taskId !== taskId);
    writeFileSync(bindingFile, JSON.stringify(binding, null, 2));
  }
} catch {
  // Best effort
}

process.stdout.write(JSON.stringify(result));
