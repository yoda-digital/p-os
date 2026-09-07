#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
const stopReason = input.stop_reason ?? 'unknown';

// Load session binding to check completion requirements
const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.pos');
const bindingFile = join(pluginDataDir, 'session-binding.json');

let binding = null;
try {
  if (existsSync(bindingFile)) {
    binding = JSON.parse(readFileSync(bindingFile, 'utf-8'));
  }
} catch {
  // No binding
}

const result = {};

// If this session is bound to a move with a completion contract,
// check whether we should block stop for missing evidence
if (binding?.currentMove?.completionContract && stopReason === 'end_turn') {
  const contract = binding.currentMove.completionContract;

  // Check if we have local evidence of completion
  const evidenceDir = join(pluginDataDir, 'outbox');
  let evidenceCount = 0;
  try {
    if (existsSync(evidenceDir)) {
      const { readdirSync } = await import('node:fs');
      evidenceCount = readdirSync(evidenceDir).filter(f => f.endsWith('.json')).length;
    }
  } catch {
    // Can't check — allow stop
  }

  // If contract requires evidence and we have none, warn but allow
  // (Claude caps consecutive blocks at 8, so we can't infinitely block)
  if (contract.requireEvidence && evidenceCount === 0) {
    result.additionalContext = `⚠️ [Process OS] Move "${binding.currentMove.title}" has a completion contract requiring evidence, but no evidence has been produced in this session. Consider registering evidence before completing.`;
  }
}

process.stdout.write(JSON.stringify(result));
