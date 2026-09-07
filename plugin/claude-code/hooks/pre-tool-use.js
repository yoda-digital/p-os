#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
const toolName = input.tool_name ?? '';
const toolInput = input.tool_input ?? {};

// Load local policy cache
const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.pos');
const policyFile = join(pluginDataDir, 'policy-cache.json');

let policy = null;
try {
  if (existsSync(policyFile)) {
    policy = JSON.parse(readFileSync(policyFile, 'utf-8'));
  }
} catch {
  // No policy cache — allow all
}

// Check for pending steering commands
const steeringFile = join(pluginDataDir, 'pending-steering.json');
let pendingSteering = null;
try {
  if (existsSync(steeringFile)) {
    const steeringData = JSON.parse(readFileSync(steeringFile, 'utf-8'));
    if (steeringData.commands?.length > 0) {
      pendingSteering = steeringData.commands;
    }
  }
} catch {
  // No pending steering
}

const result = {};

// If there's pending steering, inject it as additional context at this safe point
if (pendingSteering && pendingSteering.length > 0) {
  const steeringMessages = pendingSteering.map((s) => {
    switch (s.class) {
      case 'constraint':
        return `⚠️ NEW CONSTRAINT: ${s.instruction}`;
      case 'advisory':
        return `💡 ADVISORY: ${s.instruction}`;
      case 'redirect':
        return `🔄 REDIRECT: ${s.instruction}`;
      case 'pause':
        return `⏸️ PAUSE REQUESTED: ${s.instruction}`;
      case 'hard_stop':
        return `🛑 HARD STOP: ${s.instruction}`;
      default:
        return `📋 STEERING: ${s.instruction}`;
    }
  });

  result.additionalContext = `[Process OS Steering Delivered]\n${steeringMessages.join('\n')}`;

  // Clear pending steering after delivery
  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(steeringFile, JSON.stringify({ commands: [], deliveredAt: new Date().toISOString() }));
  } catch {
    // Best effort clear
  }
}

// Policy enforcement — check if this tool is allowed by local policy
if (policy?.prohibitedTools?.includes(toolName)) {
  result.decision = 'block';
  result.message = `Tool "${toolName}" is prohibited by process policy: ${policy.prohibitedReason ?? 'No reason given'}`;
}

process.stdout.write(JSON.stringify(result));
