/**
 * SessionStart hook handler (spec section 4.2).
 *
 * On session start:
 * 1. Load device identity — if not paired, nudge toward /process:connect
 * 2. Detect workspace → look up Case binding in local cache
 * 3. If Case found → generate a simplified Context Capsule (full in Task 6)
 * 4. Return { additionalContext, sessionTitle }
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore } from '../storage/sessions.js';
import type { SessionBinding } from '../storage/sessions.js';
import { getLocalDb } from '../storage/db.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleSessionStart(input: HookInput): Promise<HookResult> {
  const deviceStore = new DeviceStore();

  // ── Fast path: not paired ───────────────────────────────────────────────
  if (!deviceStore.isPaired()) {
    return {
      additionalContext:
        '[Universal Process OS] Not paired. Run /process:connect to pair this device with Process OS.',
    };
  }

  // ── Extract event fields ────────────────────────────────────────────────
  const sessionId = extractSessionId(input);
  const session = input['session'] as Record<string, unknown> | undefined;
  const cwd = (session?.['cwd'] ?? input['cwd'] ?? process.cwd()) as string;
  const sessionType = (session?.['type'] ?? session?.['initiation_source'] ?? 'new') as string;

  const sessionStore = new SessionStore();

  // ── Look up existing binding (by session id, then by workspace path) ───
  let binding: SessionBinding | null = sessionId ? sessionStore.get(sessionId) : null;

  if (!binding) {
    const db = getLocalDb();
    const row = db
      .prepare<[string], SessionBinding>(
        "SELECT * FROM session_bindings WHERE workspace_path = ? AND status = 'active' ORDER BY bound_at DESC LIMIT 1",
      )
      .get(cwd);
    if (row) binding = row;
  }

  // ── No Case binding → suggest discovery ─────────────────────────────────
  if (!binding?.case_id) {
    return {
      additionalContext: [
        '[Universal Process OS] Device paired. No active case binding for this workspace.',
        `Workspace: ${cwd}`,
        'Use process MCP tools to discover or create a case for this project.',
        'Available: process.case.get, process.case.search, process.move.propose, process.evidence.register',
      ].join('\n'),
    };
  }

  // ── Load cached case data ───────────────────────────────────────────────
  const caseData = loadCaseFromCache(binding.case_id);

  // ── Build simplified Context Capsule ────────────────────────────────────
  const sections: string[] = [];

  sections.push(`# Process Context — ${caseData?.title ?? binding.case_id}`);
  sections.push('');

  // IDENTITY
  sections.push('## IDENTITY');
  sections.push(`Case: ${binding.case_id}${caseData?.title ? ` — ${caseData.title}` : ''}`);
  if (binding.move_id) {
    sections.push(
      `Move: ${binding.move_id}${caseData?.currentMove ? ` — ${caseData.currentMove}` : ''}`,
    );
  }
  if (binding.attempt_id) {
    sections.push(`Attempt: ${binding.attempt_id}`);
  }

  // INTENT
  if (caseData?.intent) {
    sections.push('');
    sections.push('## INTENT');
    sections.push(caseData.intent);
  }

  // CONSTRAINTS
  if (caseData?.constraints?.length) {
    sections.push('');
    sections.push('## CONSTRAINTS');
    for (const c of caseData.constraints) sections.push(c);
  }

  // PROGRESS
  if (caseData?.progress) {
    sections.push('');
    sections.push('## PROGRESS');
    sections.push(caseData.progress);
  }

  // DO NOT REPEAT
  if (caseData?.doNotRepeat?.length) {
    sections.push('');
    sections.push('## DO NOT REPEAT');
    for (const d of caseData.doNotRepeat) sections.push(d);
  }

  // DELTA (for resume / compact / fork)
  if (
    (sessionType === 'resume' || sessionType === 'compact' || sessionType === 'fork') &&
    caseData?.delta
  ) {
    sections.push('');
    sections.push('## DELTA');
    sections.push(caseData.delta);
  }

  sections.push('');
  sections.push(
    'Process MCP tools available: process.case.get, process.move.propose, process.evidence.register, process.why.explain',
  );

  // ── Bind this session (upsert) ──────────────────────────────────────────
  if (sessionId) {
    sessionStore.bind({
      sessionId,
      caseId: binding.case_id,
      moveId: binding.move_id,
      attemptId: binding.attempt_id,
      workspacePath: cwd,
    });
  }

  return {
    additionalContext: sections.join('\n'),
    sessionTitle: `Case: ${caseData?.title ?? binding.case_id}`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CachedCaseData {
  title?: string;
  currentMove?: string;
  intent?: string;
  constraints?: string[];
  progress?: string;
  doNotRepeat?: string[];
  delta?: string;
}

function loadCaseFromCache(caseId: string): CachedCaseData | null {
  try {
    const db = getLocalDb();
    const row = db
      .prepare<[string], { value: string }>('SELECT value FROM process_cache WHERE key = ?')
      .get(`case:${caseId}`);
    if (row?.value) {
      return JSON.parse(row.value) as CachedCaseData;
    }
  } catch {
    // Cache miss or JSON parse error — not fatal
  }
  return null;
}
