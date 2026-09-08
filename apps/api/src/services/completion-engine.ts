/**
 * Completion engine — evaluates whether a move's completion contract is
 * satisfied based on actual evidence, decisions, and external state.
 *
 * Completion contracts define the objective criteria for a move to be
 * considered "done." Claude saying "done" is not enough — the contract
 * must be independently satisfied.
 *
 * Spec: §2.4 Completion Contracts, §2.5 Completion Engine
 */
import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompletionCondition {
  type: string;
  [key: string]: unknown;
}

export type CompletionContract =
  | { type: 'all'; conditions: CompletionCondition[] }
  | { type: 'any'; conditions: CompletionCondition[] }
  | { type: 'threshold'; count: number; conditions: CompletionCondition[] }
  | { type: 'approval'; approver_role: string }
  | { type: 'evidence'; evidence_type: string; scope?: Record<string, unknown> }
  | { type: 'external_state'; check: string }
  | { type: 'evidence_count'; minimum: number }
  | { type: 'all_evidence_valid' }
  | { type: 'attempt_succeeded' };

export interface CompletionResult {
  satisfied: boolean;
  missing: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a move's completion contract against actual evidence and decisions.
 * Returns whether the contract is satisfied and a list of missing conditions.
 */
export async function evaluateCompletion(
  sql: Sql,
  moveId: string,
): Promise<CompletionResult> {
  const [move] = await sql`
    SELECT id, case_id, completion_contract, outcome
    FROM moves WHERE id = ${moveId}
  `;
  if (!move) return { satisfied: false, missing: ['Move not found'] };
  if (move.outcome === 'satisfied') return { satisfied: true, missing: [] };

  const contract = move.completion_contract as CompletionContract | null;
  if (!contract) {
    // No contract means any completion is acceptable
    return { satisfied: true, missing: [] };
  }

  return evaluateContract(sql, moveId, move.case_id as string, contract);
}

// ---------------------------------------------------------------------------
// Recursive contract evaluation
// ---------------------------------------------------------------------------

async function evaluateContract(
  sql: Sql,
  moveId: string,
  caseId: string,
  contract: CompletionCondition,
): Promise<CompletionResult> {
  const type = contract['type'] as string;

  switch (type) {
    case 'all':
      return evaluateAll(sql, moveId, caseId, contract);

    case 'any':
      return evaluateAny(sql, moveId, caseId, contract);

    case 'threshold':
      return evaluateThreshold(sql, moveId, caseId, contract);

    case 'approval':
      return evaluateApproval(sql, moveId, caseId, contract);

    case 'evidence':
      return evaluateEvidence(sql, moveId, caseId, contract);

    case 'external_state':
      return evaluateExternalState(contract);

    case 'evidence_count':
      return evaluateEvidenceCount(sql, moveId, caseId, contract);

    case 'all_evidence_valid':
      return evaluateAllEvidenceValid(sql, moveId, caseId);

    case 'attempt_succeeded':
      return evaluateAttemptSucceeded(sql, moveId);

    default:
      return { satisfied: false, missing: [`Unknown contract type: ${type}`] };
  }
}

async function evaluateAll(
  sql: Sql,
  moveId: string,
  caseId: string,
  contract: CompletionCondition,
): Promise<CompletionResult> {
  const conditions = (contract['conditions'] as CompletionCondition[]) ?? [];
  if (conditions.length === 0) return { satisfied: false, missing: ['Empty "all" contract'] };

  const allMissing: string[] = [];
  for (const cond of conditions) {
    const result = await evaluateContract(sql, moveId, caseId, cond);
    if (!result.satisfied) allMissing.push(...result.missing);
  }
  return { satisfied: allMissing.length === 0, missing: allMissing };
}

async function evaluateAny(
  sql: Sql,
  moveId: string,
  caseId: string,
  contract: CompletionCondition,
): Promise<CompletionResult> {
  const conditions = (contract['conditions'] as CompletionCondition[]) ?? [];
  if (conditions.length === 0) return { satisfied: false, missing: ['Empty "any" contract'] };

  const allMissing: string[] = [];
  for (const cond of conditions) {
    const result = await evaluateContract(sql, moveId, caseId, cond);
    if (result.satisfied) return { satisfied: true, missing: [] };
    allMissing.push(...result.missing);
  }
  return { satisfied: false, missing: allMissing };
}

async function evaluateThreshold(
  sql: Sql,
  moveId: string,
  caseId: string,
  contract: CompletionCondition,
): Promise<CompletionResult> {
  const conditions = (contract['conditions'] as CompletionCondition[]) ?? [];
  const threshold = (contract['count'] as number) ?? 1;
  if (conditions.length === 0) return { satisfied: false, missing: ['Empty "threshold" contract'] };

  let satisfied = 0;
  const allMissing: string[] = [];
  for (const cond of conditions) {
    const result = await evaluateContract(sql, moveId, caseId, cond);
    if (result.satisfied) satisfied++;
    else allMissing.push(...result.missing);
  }
  return {
    satisfied: satisfied >= threshold,
    missing: satisfied >= threshold ? [] : [`${threshold - satisfied} more condition(s) needed`, ...allMissing],
  };
}

async function evaluateApproval(
  sql: Sql,
  moveId: string,
  caseId: string,
  contract: CompletionCondition,
): Promise<CompletionResult> {
  const approverRole = (contract['approver_role'] as string) ?? 'lead';

  // Check if there's a decision with state=decided that references this move
  const [approval] = await sql`
    SELECT d.id FROM decisions d
    WHERE d.case_id = ${caseId}
      AND d.state = 'decided'
      AND ${moveId} = ANY(d.blocking_move_ids)
    LIMIT 1
  `;

  if (approval) return { satisfied: true, missing: [] };
  return { satisfied: false, missing: [`Approval from '${approverRole}' role required`] };
}

async function evaluateEvidence(
  sql: Sql,
  moveId: string,
  caseId: string,
  contract: CompletionCondition,
): Promise<CompletionResult> {
  const evidenceType = (contract['evidence_type'] as string) ?? 'any';

  const [row] = await sql`
    SELECT COUNT(*)::int AS cnt FROM evidence
    WHERE case_id = ${caseId}
      AND validity = 'valid'
      AND subject_refs @> ${sql.json([{ id: moveId }])}
      AND (provenance->>'type' = ${evidenceType} OR ${evidenceType} = 'any')
  `;

  if ((row?.cnt ?? 0) > 0) return { satisfied: true, missing: [] };
  return { satisfied: false, missing: [`Evidence of type '${evidenceType}' required`] };
}

function evaluateExternalState(
  contract: CompletionCondition,
): CompletionResult {
  // External state checks would call out to an external service.
  // For now, we return unsatisfied with a descriptive message.
  const check = (contract['check'] as string) ?? 'unknown';
  return { satisfied: false, missing: [`External state check '${check}' not yet evaluated`] };
}

async function evaluateEvidenceCount(
  sql: Sql,
  moveId: string,
  caseId: string,
  contract: CompletionCondition,
): Promise<CompletionResult> {
  const minimum = (contract['minimum'] as number) ?? 1;
  const [row] = await sql`
    SELECT COUNT(*)::int AS cnt FROM evidence
    WHERE case_id = ${caseId}
      AND validity = 'valid'
      AND subject_refs @> ${sql.json([{ id: moveId }])}
  `;
  const count = row?.cnt ?? 0;
  if (count >= minimum) return { satisfied: true, missing: [] };
  return { satisfied: false, missing: [`Need ${minimum - count} more valid evidence item(s)`] };
}

async function evaluateAllEvidenceValid(
  sql: Sql,
  moveId: string,
  caseId: string,
): Promise<CompletionResult> {
  const [row] = await sql`
    SELECT COUNT(*) FILTER (WHERE validity != 'valid')::int AS invalid_count
    FROM evidence
    WHERE case_id = ${caseId}
      AND subject_refs @> ${sql.json([{ id: moveId }])}
  `;
  const invalid = row?.invalid_count ?? 0;
  if (invalid === 0) return { satisfied: true, missing: [] };
  return { satisfied: false, missing: [`${invalid} evidence item(s) are not valid`] };
}

async function evaluateAttemptSucceeded(
  sql: Sql,
  moveId: string,
): Promise<CompletionResult> {
  const [row] = await sql`
    SELECT COUNT(*)::int AS cnt FROM attempts
    WHERE move_id = ${moveId} AND state = 'succeeded'
  `;
  if ((row?.cnt ?? 0) > 0) return { satisfied: true, missing: [] };
  return { satisfied: false, missing: ['No successful attempt recorded'] };
}
