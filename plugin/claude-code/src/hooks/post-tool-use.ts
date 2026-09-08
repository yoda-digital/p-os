/**
 * PostToolUse hook handler (spec section 4.6).
 *
 * After every tool invocation, detect evidence artifacts and enqueue them
 * to the local outbox for async upload:
 *   - Bash with `git commit` → CommitCreated (marks prior test/build evidence stale)
 *   - Bash with test commands → EvidenceDetected (test_run) with pass/fail from exit code
 *   - Write / Edit           → FileModified
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore } from '../storage/sessions.js';
import { OutboxStore } from '../storage/outbox.js';

/** Pattern matching common test runner invocations. */
const TEST_CMD_RE =
  /\b(vitest|jest|pytest|npm\s+test|pnpm\s+test|yarn\s+test|cargo\s+test|go\s+test|make\s+test|dotnet\s+test)\b/;

/** Pattern matching build commands. */
const BUILD_CMD_RE =
  /\b(npm\s+run\s+build|pnpm\s+build|yarn\s+build|cargo\s+build|go\s+build|make\s+build|tsc|webpack|vite\s+build|turbo\s+build)\b/;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handlePostToolUse(input: HookInput): Promise<HookResult> {
  const deviceStore = new DeviceStore();
  if (!deviceStore.isPaired()) return {};

  const sessionId = extractSessionId(input);
  if (!sessionId) return {};

  const sessionStore = new SessionStore();
  const binding = sessionStore.get(sessionId);
  if (!binding?.case_id) return {};

  const toolName = extractToolName(input);
  const toolInput = extractToolInput(input);
  const toolOutput = extractToolOutput(input);
  const exitCode = extractExitCode(input);

  const outbox = new OutboxStore();
  const base = {
    sessionId,
    caseId: binding.case_id,
    moveId: binding.move_id,
    attemptId: binding.attempt_id,
  };

  // ── Bash evidence detection ─────────────────────────────────────────────
  if (toolName === 'Bash' && typeof toolInput['command'] === 'string') {
    const cmd = toolInput['command'];

    // Detect git commit → CommitCreated
    // This signals that code has changed and prior test/build evidence may be stale
    if (cmd.includes('git commit')) {
      outbox.enqueue('CommitCreated', {
        ...base,
        command: cmd,
        type: 'git_commit',
        // Extract commit hash from output if available
        commitHash: extractCommitHash(toolOutput),
      });
    }

    // Detect test runs → EvidenceDetected with pass/fail
    if (TEST_CMD_RE.test(cmd)) {
      const passed = exitCode === 0;
      outbox.enqueue('EvidenceDetected', {
        ...base,
        evidenceType: 'test_run',
        command: cmd,
        result: passed ? 'pass' : 'fail',
        exitCode,
        // Register as evidence with validity based on result
        confidence: passed ? 1.0 : 0.0,
        relation: passed ? 'verifies' : 'contradicts',
      });
    }

    // Detect build commands → EvidenceDetected with pass/fail
    if (BUILD_CMD_RE.test(cmd)) {
      const passed = exitCode === 0;
      outbox.enqueue('EvidenceDetected', {
        ...base,
        evidenceType: 'build_result',
        command: cmd,
        result: passed ? 'pass' : 'fail',
        exitCode,
        confidence: passed ? 1.0 : 0.0,
        relation: passed ? 'verifies' : 'contradicts',
      });
    }
  }

  // ── File write / edit evidence ──────────────────────────────────────────
  if (toolName === 'Write' || toolName === 'Edit') {
    const filePath = toolInput['file_path'] ?? toolInput['path'];
    outbox.enqueue('FileModified', {
      ...base,
      filePath,
      tool: toolName,
    });
  }

  return {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractToolName(input: HookInput): string {
  if (typeof input['tool_name'] === 'string') return input['tool_name'];
  const tool = input['tool'];
  if (tool && typeof tool === 'object') {
    const name = (tool as Record<string, unknown>)['name'];
    if (typeof name === 'string') return name;
  }
  return '';
}

function extractToolInput(input: HookInput): Record<string, unknown> {
  if (input['tool_input'] && typeof input['tool_input'] === 'object') {
    return input['tool_input'] as Record<string, unknown>;
  }
  const tool = input['tool'];
  if (tool && typeof tool === 'object') {
    const ti = (tool as Record<string, unknown>)['input'];
    if (ti && typeof ti === 'object') return ti as Record<string, unknown>;
  }
  return {};
}

function extractToolOutput(input: HookInput): string {
  if (typeof input['tool_output'] === 'string') return input['tool_output'];
  if (typeof input['output'] === 'string') return input['output'];
  const tool = input['tool'];
  if (tool && typeof tool === 'object') {
    const out = (tool as Record<string, unknown>)['output'];
    if (typeof out === 'string') return out;
  }
  return '';
}

function extractExitCode(input: HookInput): number | null {
  // Claude Code provides exit_code for Bash tool results
  if (typeof input['exit_code'] === 'number') return input['exit_code'];
  const tool = input['tool'];
  if (tool && typeof tool === 'object') {
    const code = (tool as Record<string, unknown>)['exit_code'];
    if (typeof code === 'number') return code;
  }
  // Infer from tool_output if it contains error markers
  return null;
}

/**
 * Try to extract a commit hash from git commit output.
 * Common patterns: "[main abc1234] commit message" or "abc1234 commit message"
 */
function extractCommitHash(output: string): string | null {
  if (!output) return null;
  const match = output.match(/\[[\w/-]+\s+([0-9a-f]{7,40})\]/);
  if (match) return match[1]!;
  const match2 = output.match(/^([0-9a-f]{7,40})\s/m);
  return match2?.[1] ?? null;
}
