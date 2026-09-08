/**
 * TaskCompleted hook handler (spec section 4.4).
 *
 * When a Claude task finishes:
 * 1. Fast exit if not paired / session not bound
 * 2. If bound to a Move with an Attempt → check completion contract
 * 3. Load move's completion_contract from local cache or HTTP
 * 4. Evaluate against known evidence (outbox + cache)
 * 5. If contract unsatisfied → block completion with missing list
 * 6. If satisfied → emit AttemptSucceeded
 */
import type { HookInput, HookResult } from './handler.js';
import { extractSessionId } from './handler.js';
import { DeviceStore } from '../storage/device.js';
import { SessionStore } from '../storage/sessions.js';
import { OutboxStore } from '../storage/outbox.js';
import { PolicyMirrorStore } from '../storage/policy-mirror.js';
import { getLocalDb } from '../storage/db.js';

// ---------------------------------------------------------------------------
// Completion contract types (mirror of server-side types)
// ---------------------------------------------------------------------------

interface CompletionContract {
  type: string;
  conditions?: CompletionContract[];
  count?: number;
  minimum?: number;
  approver_role?: string;
  evidence_type?: string;
  check?: string;
  [key: string]: unknown;
}

interface CompletionResult {
  satisfied: boolean;
  missing: string[];
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleTaskCompleted(input: HookInput): Promise<HookResult> {
  const deviceStore = new DeviceStore();
  if (!deviceStore.isPaired()) return {};

  const sessionId = extractSessionId(input);
  if (!sessionId) return {};

  const sessionStore = new SessionStore();
  const binding = sessionStore.get(sessionId);
  if (!binding?.case_id) return {};

  // Only enforce completion policy when bound to a Move/Attempt
  if (!binding.attempt_id) return {};

  const taskId = extractTaskId(input);

  // ── Load move's completion contract ────────────────────────────────────
  const contract = loadCompletionContract(binding.move_id ?? '');

  if (contract) {
    const result = evaluateLocalContract(contract, binding);
    if (!result.satisfied) {
      return {
        decision: 'block',
        reason: `Move completion blocked: missing required conditions — ${result.missing.join(', ')}`,
      };
    }
  }

  // ── Check legacy policy-based completion ───────────────────────────────
  const policyStore = new PolicyMirrorStore();
  const policies = policyStore.getActive();

  for (const policy of policies) {
    try {
      const data = JSON.parse(policy.policy_data) as Record<string, unknown>;
      if (data['type'] !== 'completion') continue;
      if (data['caseId'] !== binding.case_id && data['moveId'] !== binding.move_id) continue;

      const requiredEvidence = data['requiredEvidence'];
      if (!Array.isArray(requiredEvidence) || requiredEvidence.length === 0) continue;

      const outbox = new OutboxStore();
      const pending = outbox.getPending();
      const seen = new Set<string>();

      for (const event of pending) {
        try {
          const payload = JSON.parse(event.payload) as Record<string, unknown>;
          if (typeof payload['evidenceType'] === 'string') seen.add(payload['evidenceType']);
          if (typeof payload['type'] === 'string') seen.add(payload['type']);
          seen.add(event.event_type);
        } catch {
          /* skip malformed payload */
        }
      }

      const missing = (requiredEvidence as string[]).filter((r) => !seen.has(r));
      if (missing.length > 0) {
        return {
          decision: 'block',
          reason: `Move completion blocked: missing required evidence — ${missing.join(', ')}`,
        };
      }
    } catch {
      /* skip unreadable policy */
    }
  }

  // ── Completion allowed — emit success ───────────────────────────────────
  const outbox = new OutboxStore();
  outbox.enqueue('AttemptSucceeded', {
    sessionId,
    caseId: binding.case_id,
    moveId: binding.move_id,
    attemptId: binding.attempt_id,
    taskId,
  });

  return {};
}

// ---------------------------------------------------------------------------
// Local contract evaluation (runs in the plugin, no DB access)
// ---------------------------------------------------------------------------

function evaluateLocalContract(
  contract: CompletionContract,
  binding: { case_id: string; move_id?: string; attempt_id?: string },
): CompletionResult {
  const outbox = new OutboxStore();
  const pending = outbox.getPending();

  // Build a set of evidence types we've seen
  const evidenceTypes = new Set<string>();
  let hasSucceededAttempt = false;
  let hasTestRun = false;
  let hasCommit = false;

  for (const event of pending) {
    try {
      const payload = JSON.parse(event.payload) as Record<string, unknown>;
      if (typeof payload['evidenceType'] === 'string') evidenceTypes.add(payload['evidenceType']);
      if (typeof payload['type'] === 'string') evidenceTypes.add(payload['type']);
      evidenceTypes.add(event.event_type);

      if (event.event_type === 'AttemptSucceeded') hasSucceededAttempt = true;
      if (event.event_type === 'EvidenceDetected' && payload['evidenceType'] === 'test_run') hasTestRun = true;
      if (event.event_type === 'CommitCreated') hasCommit = true;
    } catch {
      /* skip */
    }
  }

  return evaluateContractRecursive(contract, {
    evidenceTypes,
    hasSucceededAttempt,
    hasTestRun,
    hasCommit,
    evidenceCount: pending.filter((e) => e.event_type === 'EvidenceDetected').length,
  });
}

interface EvidenceContext {
  evidenceTypes: Set<string>;
  hasSucceededAttempt: boolean;
  hasTestRun: boolean;
  hasCommit: boolean;
  evidenceCount: number;
}

function evaluateContractRecursive(
  contract: CompletionContract,
  ctx: EvidenceContext,
): CompletionResult {
  switch (contract.type) {
    case 'all': {
      const conditions = contract.conditions ?? [];
      const allMissing: string[] = [];
      for (const cond of conditions) {
        const r = evaluateContractRecursive(cond, ctx);
        if (!r.satisfied) allMissing.push(...r.missing);
      }
      return { satisfied: allMissing.length === 0, missing: allMissing };
    }

    case 'any': {
      const conditions = contract.conditions ?? [];
      const allMissing: string[] = [];
      for (const cond of conditions) {
        const r = evaluateContractRecursive(cond, ctx);
        if (r.satisfied) return { satisfied: true, missing: [] };
        allMissing.push(...r.missing);
      }
      return { satisfied: false, missing: allMissing };
    }

    case 'threshold': {
      const conditions = contract.conditions ?? [];
      const threshold = contract.count ?? 1;
      let satisfied = 0;
      const allMissing: string[] = [];
      for (const cond of conditions) {
        const r = evaluateContractRecursive(cond, ctx);
        if (r.satisfied) satisfied++;
        else allMissing.push(...r.missing);
      }
      return {
        satisfied: satisfied >= threshold,
        missing: satisfied >= threshold ? [] : allMissing,
      };
    }

    case 'evidence_count': {
      const minimum = contract.minimum ?? 1;
      if (ctx.evidenceCount >= minimum) return { satisfied: true, missing: [] };
      return { satisfied: false, missing: [`Need ${minimum - ctx.evidenceCount} more evidence item(s)`] };
    }

    case 'attempt_succeeded':
      return ctx.hasSucceededAttempt
        ? { satisfied: true, missing: [] }
        : { satisfied: false, missing: ['No successful attempt recorded'] };

    case 'evidence': {
      const eType = contract.evidence_type ?? 'any';
      if (eType === 'test_run') {
        return ctx.hasTestRun
          ? { satisfied: true, missing: [] }
          : { satisfied: false, missing: ['Test run evidence required'] };
      }
      if (ctx.evidenceTypes.has(eType) || eType === 'any') {
        return { satisfied: true, missing: [] };
      }
      return { satisfied: false, missing: [`Evidence of type '${eType}' required`] };
    }

    case 'approval':
      // Cannot evaluate approvals locally — assume unsatisfied
      return { satisfied: false, missing: [`Approval from '${contract.approver_role ?? 'lead'}' required`] };

    case 'external_state':
      return { satisfied: false, missing: [`External check '${contract.check ?? 'unknown'}' pending`] };

    default:
      return { satisfied: false, missing: [`Unknown contract type: ${contract.type}`] };
  }
}

// ---------------------------------------------------------------------------
// Load completion contract from local cache
// ---------------------------------------------------------------------------

function loadCompletionContract(moveId: string): CompletionContract | null {
  if (!moveId) return null;
  try {
    const db = getLocalDb();
    const row = db
      .prepare<[string], { value: string }>('SELECT value FROM process_cache WHERE key = ?')
      .get(`move:${moveId}:contract`);
    if (row?.value) {
      return JSON.parse(row.value) as CompletionContract;
    }
    // Also check the full move cache
    const moveRow = db
      .prepare<[string], { value: string }>('SELECT value FROM process_cache WHERE key = ?')
      .get(`move:${moveId}`);
    if (moveRow?.value) {
      const moveData = JSON.parse(moveRow.value) as Record<string, unknown>;
      if (moveData['completion_contract'] && typeof moveData['completion_contract'] === 'object') {
        return moveData['completion_contract'] as CompletionContract;
      }
    }
  } catch {
    // Cache miss or parse error — not fatal
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractTaskId(input: HookInput): string {
  if (typeof input['task_id'] === 'string') return input['task_id'];
  const task = input['task'];
  if (task && typeof task === 'object') {
    const id = (task as Record<string, unknown>)['id'];
    if (typeof id === 'string') return id;
  }
  return '';
}
