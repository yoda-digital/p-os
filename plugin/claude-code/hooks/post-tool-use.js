#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
const toolName = input.tool_name ?? '';
const toolInput = input.tool_input ?? {};
const toolOutput = input.tool_output ?? {};

// Telemetry: record tool use for process event generation
const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.pos');
const outboxDir = join(pluginDataDir, 'outbox');

try {
  if (!existsSync(outboxDir)) {
    mkdirSync(outboxDir, { recursive: true });
  }

  // Detect evidence-producing tool uses
  const evidenceCandidates = [];

  // Git commits produce evidence
  if (toolName === 'Bash' && typeof toolInput.command === 'string') {
    if (toolInput.command.includes('git commit')) {
      evidenceCandidates.push({
        type: 'git_commit',
        tool: toolName,
        timestamp: new Date().toISOString(),
      });
    }
    // Test runs produce evidence
    if (toolInput.command.match(/\b(vitest|jest|pytest|npm test|pnpm test)\b/)) {
      evidenceCandidates.push({
        type: 'test_run',
        tool: toolName,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // File writes are artifacts
  if (toolName === 'Write' || toolName === 'Edit') {
    evidenceCandidates.push({
      type: 'file_artifact',
      tool: toolName,
      path: toolInput.file_path ?? toolInput.path,
      timestamp: new Date().toISOString(),
    });
  }

  // Queue evidence candidates for async upload
  if (evidenceCandidates.length > 0) {
    const outboxFile = join(outboxDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    writeFileSync(outboxFile, JSON.stringify({
      type: 'evidence_candidates',
      candidates: evidenceCandidates,
      sessionId: input.session_id,
      timestamp: new Date().toISOString(),
    }));
  }
} catch {
  // Telemetry must never break Claude's workflow
}

process.stdout.write(JSON.stringify({}));
