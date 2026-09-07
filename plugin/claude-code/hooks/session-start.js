#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
const sessionType = input.session?.type ?? 'new';
const cwd = input.cwd ?? process.cwd();

// Attempt to read local cache for case binding
const pluginDataDir = process.env.CLAUDE_PLUGIN_DATA ?? join(homedir(), '.pos');
const bindingFile = join(pluginDataDir, 'session-binding.json');

let caseBinding = null;
try {
  if (existsSync(bindingFile)) {
    caseBinding = JSON.parse(readFileSync(bindingFile, 'utf-8'));
  }
} catch {
  // No binding — first run or cleared
}

// Build context sections
const sections = [];

sections.push(`[Universal Process OS] Session: ${sessionType}`);

if (caseBinding) {
  sections.push(`Active Case: "${caseBinding.title}" (${caseBinding.caseId})`);
  if (caseBinding.currentMove) {
    sections.push(`Current Move: "${caseBinding.currentMove.title}" — ${caseBinding.currentMove.execution}`);
  }
  if (caseBinding.constraints?.length > 0) {
    sections.push(`Constraints: ${caseBinding.constraints.join('; ')}`);
  }
  if (caseBinding.doNotRepeat?.length > 0) {
    sections.push(`Failed approaches (do NOT repeat): ${caseBinding.doNotRepeat.join('; ')}`);
  }
} else {
  sections.push('No active case binding. Use process MCP tools to discover or create a case.');
}

sections.push('Process MCP tools available: process.case.get, process.move.propose, process.evidence.register, process.why.explain');

// For resume/compact/fork, include delta information
if (sessionType === 'resume' || sessionType === 'compact' || sessionType === 'fork') {
  if (caseBinding?.delta) {
    sections.push(`Delta since last session: ${caseBinding.delta}`);
  }
}

const result = {
  additionalContext: sections.join('\n'),
};

process.stdout.write(JSON.stringify(result));
