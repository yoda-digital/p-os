/**
 * SessionStart hook handler (spec §3.1, §4.2).
 *
 * On session start, handles ALL initiation_source values:
 *   - `new`     → Full capsule from edge or cache
 *   - `resume`  → Resume intelligence decides: as-is, delta, or full
 *   - `clear`   → Full capsule — MUST restore all constraints (safety gate)
 *   - `compact` → Load checkpoint, compare with PostCompact summary, fill gaps
 *   - `fork`    → Capsule with parent attempt context + fork point
 *
 * Returns { additionalContext, sessionTitle }.
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore, type SessionBinding } from '../storage/sessions.js';
import { getLocalDb } from '../storage/db.js';
import { loadCheckpoint, loadCheckpointByCase } from '../context/checkpoint.js';
import { decideResumeStrategy } from '../context/resume-intelligence.js';

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
  const initiationSource = (
    session?.['initiation_source'] ??
    session?.['type'] ??
    input['initiation_source'] ??
    'new'
  ) as string;

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

  // ── Route by initiation_source ──────────────────────────────────────────
  // Narrow to non-null for downstream — we checked binding.case_id above
  const safeBinding = {
    ...binding,
    case_id: binding.case_id!,
    move_id: binding.move_id ?? undefined,
    attempt_id: binding.attempt_id ?? undefined,
  };

  let sections: string[];
  switch (initiationSource) {
    case 'resume':
      sections = buildResumeContext(sessionId, safeBinding);
      break;

    case 'clear':
      // CRITICAL: clear MUST restore all constraints — this is a safety gate
      sections = buildFullContext(safeBinding, { forceFull: true, label: 'CLEAR RECOVERY' });
      break;

    case 'compact':
      sections = buildCompactRecoveryContext(sessionId, safeBinding);
      break;

    case 'fork':
      sections = buildForkContext(input, safeBinding);
      break;

    case 'new':
    default:
      sections = buildFullContext(safeBinding);
      break;
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

  const caseData = loadCaseFromCache(safeBinding.case_id);
  return {
    additionalContext: sections.join('\n'),
    sessionTitle: `Case: ${caseData?.title ?? safeBinding.case_id}`,
  };
}

/** Narrowed binding type after null-check on case_id. */
interface SafeBinding {
  case_id: string;
  move_id?: string;
  attempt_id?: string;
  workspace_path?: string | null;
  session_id?: string;
  bound_at?: string | null;
  status?: string;
}

// ---------------------------------------------------------------------------
// Context builders by initiation_source
// ---------------------------------------------------------------------------

function buildFullContext(
  binding: SafeBinding,
  opts?: { forceFull?: boolean; label?: string },
): string[] {
  const caseData = loadCaseFromCache(binding.case_id);
  const sections: string[] = [];
  const label = opts?.label ?? 'Process Context';

  sections.push(`# ${label} — ${caseData?.title ?? binding.case_id}`);
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

  // CONSTRAINTS — always include, especially critical for 'clear' recovery
  if (caseData?.constraints?.length) {
    sections.push('');
    sections.push('## CONSTRAINTS');
    for (const c of caseData.constraints) sections.push(`- ${c}`);
  }

  // ACTIVE STEERING
  if (caseData?.activeSteering?.length) {
    sections.push('');
    sections.push('## ACTIVE STEERING');
    for (const s of caseData.activeSteering) sections.push(`- [${s.class}] ${s.instruction}`);
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
    for (const d of caseData.doNotRepeat) sections.push(`- ${d}`);
  }

  return sections;
}

function buildResumeContext(
  sessionId: string,
  binding: SafeBinding,
): string[] {
  // Assess how long we've been away and how much happened
  const checkpoint = sessionId ? loadCheckpoint(sessionId) : null;
  const timeSinceCheckpoint = checkpoint
    ? (Date.now() - new Date(checkpoint.created_at).getTime()) / 1000
    : Infinity;

  // Get event count since checkpoint from cache (approximate)
  const eventsSince = estimateEventsSince(binding.case_id, checkpoint?.last_event_sequence);

  const decision = decideResumeStrategy(timeSinceCheckpoint, eventsSince);

  switch (decision.strategy) {
    case 'resume':
      // Short gap — just add a brief status update
      return [
        `# Resume — ${decision.reason}`,
        '',
        `Case: ${binding.case_id}`,
        binding.move_id ? `Move: ${binding.move_id}` : '',
        '',
        'Context should still be in memory. Continuing where you left off.',
      ].filter(Boolean);

    case 'resume_delta': {
      // Medium gap — include checkpoint state + delta
      const sections = buildFullContext(binding, { label: 'Resume + Delta' });
      if (checkpoint) {
        sections.push('');
        sections.push('## DELTA SINCE LAST INTERACTION');
        sections.push(`Time away: ${decision.reason}`);
        sections.push(`Events since: ${eventsSince}`);
      }
      return sections;
    }

    case 'fresh':
    default: {
      // Long gap — full rehydration
      const sections = buildFullContext(binding, { label: 'Full Rehydration (Resume)' });
      if (decision.recommendFresh) {
        sections.push('');
        sections.push('## RECOMMENDATION');
        sections.push('Consider starting a fresh session — significant time has passed since the last interaction.');
      }
      return sections;
    }
  }
}

function buildCompactRecoveryContext(
  sessionId: string,
  binding: SafeBinding,
): string[] {
  // Load checkpoint saved by PreCompact
  const checkpoint = sessionId ? loadCheckpoint(sessionId) : null;

  if (!checkpoint) {
    // No checkpoint available — fall back to full context
    return buildFullContext(binding, { label: 'Compact Recovery (no checkpoint)' });
  }

  const sections: string[] = [];
  sections.push(`# Compact Recovery — restoring critical state`);
  sections.push('');

  // IDENTITY
  sections.push('## IDENTITY');
  sections.push(`Case: ${checkpoint.case_id}`);
  if (checkpoint.move_id) sections.push(`Move: ${checkpoint.move_id}`);
  if (checkpoint.attempt_id) sections.push(`Attempt: ${checkpoint.attempt_id}`);

  // OBJECTIVE
  if (checkpoint.objective) {
    sections.push('');
    sections.push('## OBJECTIVE');
    sections.push(checkpoint.objective);
  }

  // CONSTRAINTS — critical to restore after compaction
  if (checkpoint.constraints.length > 0) {
    sections.push('');
    sections.push('## CONSTRAINTS (restored from checkpoint)');
    for (const c of checkpoint.constraints) sections.push(`- ${c}`);
  }

  // ACTIVE STEERING — must survive compaction
  if (checkpoint.active_steering.length > 0) {
    sections.push('');
    sections.push('## ACTIVE STEERING (restored from checkpoint)');
    for (const s of checkpoint.active_steering) {
      sections.push(`- [${s.class}] ${s.instruction} (${s.state})`);
    }
  }

  // FAILED APPROACHES — must survive compaction
  if (checkpoint.failed_approaches.length > 0) {
    sections.push('');
    sections.push('## DO NOT REPEAT (restored from checkpoint)');
    for (const f of checkpoint.failed_approaches) sections.push(`- ${f}`);
  }

  // UNSATISFIED DEPENDENCIES
  if (checkpoint.unsatisfied_dependencies.length > 0) {
    sections.push('');
    sections.push('## UNSATISFIED DEPENDENCIES');
    for (const d of checkpoint.unsatisfied_dependencies) sections.push(`- ${d}`);
  }

  // COMPLETION STATE
  if (checkpoint.completion_state) {
    sections.push('');
    sections.push('## COMPLETION STATE');
    sections.push(checkpoint.completion_state);
  }

  return sections;
}

function buildForkContext(
  input: HookInput,
  binding: SafeBinding,
): string[] {
  // Fork includes parent attempt context + divergence point
  const parentAttemptId = (input['parent_attempt_id'] as string) ??
    (input['fork_from'] as string) ?? null;

  // Try to load parent's checkpoint
  const parentCheckpoint = loadCheckpointByCase(binding.case_id);

  const sections = buildFullContext(binding, { label: 'Fork Context' });

  sections.push('');
  sections.push('## FORK INFORMATION');
  if (parentAttemptId) {
    sections.push(`Forked from attempt: ${parentAttemptId}`);
  }
  sections.push('This is a parallel attempt — explore a different approach than the parent.');

  // Include parent's failed approaches so we don't repeat them
  if (parentCheckpoint?.failed_approaches?.length) {
    sections.push('');
    sections.push('## PARENT ATTEMPT FAILURES (DO NOT REPEAT)');
    for (const f of parentCheckpoint.failed_approaches) sections.push(`- ${f}`);
  }

  // Include parent's constraints — forks inherit constraints
  if (parentCheckpoint?.constraints?.length) {
    sections.push('');
    sections.push('## INHERITED CONSTRAINTS');
    for (const c of parentCheckpoint.constraints) sections.push(`- ${c}`);
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CachedCaseData {
  title?: string;
  currentMove?: string;
  intent?: string;
  constraints?: string[];
  activeSteering?: Array<{ class: string; instruction: string }>;
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

function estimateEventsSince(caseId: string, lastSequence?: number): number {
  if (!lastSequence) return 0;
  try {
    const db = getLocalDb();
    // Check if we have a cached event count
    const row = db
      .prepare<[string], { value: string }>('SELECT value FROM process_cache WHERE key = ?')
      .get(`case:${caseId}:last_sequence`);
    if (row?.value) {
      const currentSeq = parseInt(row.value, 10);
      return Math.max(0, currentSeq - lastSequence);
    }
  } catch {
    /* cache miss */
  }
  return 0;
}
