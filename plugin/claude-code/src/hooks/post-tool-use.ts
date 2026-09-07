/**
 * PostToolUse hook handler (spec section 4.6).
 *
 * After every tool invocation, detect evidence artifacts and enqueue them
 * to the local outbox for async upload:
 *   - Bash with `git commit` → CommitCreated
 *   - Bash with test commands → EvidenceDetected (test_run)
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

    if (cmd.includes('git commit')) {
      outbox.enqueue('CommitCreated', { ...base, command: cmd, type: 'git_commit' });
    }

    if (TEST_CMD_RE.test(cmd)) {
      outbox.enqueue('EvidenceDetected', {
        ...base,
        evidenceType: 'test_run',
        command: cmd,
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
