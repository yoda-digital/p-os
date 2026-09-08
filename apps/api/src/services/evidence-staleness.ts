/**
 * Evidence staleness detection and causal propagation.
 *
 * Periodically checks `fresh_until` timestamps on evidence records and marks
 * expired ones as stale. When evidence supporting a move's verification is
 * now stale, the move's verification is set to 'stale' and the kanban card
 * moves back to the VERIFY column.
 *
 * Spec: §2.2 Staleness Triggers, §2.3 Staleness Propagation
 */
import type postgres from 'postgres';
import { appendEvents, type EventRecord } from './event-store.js';

type Sql = ReturnType<typeof postgres>;

// ---------------------------------------------------------------------------
// Check staleness — mark expired evidence as stale
// ---------------------------------------------------------------------------

export interface StalenessCheckResult {
  staleCount: number;
  staleIds: string[];
}

/**
 * Check all evidence with `fresh_until` timestamps. If the timestamp has
 * passed and the evidence is still 'valid', mark it as 'stale' and emit
 * an EvidenceStale event.
 */
export async function checkStaleness(
  sql: Sql,
  caseId: string,
): Promise<StalenessCheckResult> {
  // Find evidence that has expired but is still marked valid
  const expired = await sql`
    SELECT e.id, e.case_id, c.organization_id AS tenant_id
    FROM evidence e
    JOIN cases c ON c.id = e.case_id
    WHERE e.case_id = ${caseId}
      AND e.fresh_until IS NOT NULL
      AND e.fresh_until < NOW()
      AND e.validity = 'valid'
  `;

  if (expired.length === 0) return { staleCount: 0, staleIds: [] };

  const staleIds: string[] = [];

  for (const ev of expired) {
    await sql`
      UPDATE evidence SET validity = 'stale', revision = revision + 1
      WHERE id = ${ev.id} AND validity = 'valid'
    `;

    const eventId = crypto.randomUUID();
    await appendEvents(sql, [{
      id: eventId,
      tenant_id: ev.tenant_id as string,
      case_id: ev.case_id as string,
      type: 'EvidenceStale',
      actor_id: null,
      occurred_at: new Date(),
      causation_id: eventId,
      correlation_id: eventId,
      data: {
        evidence_id: ev.id,
        reason: 'fresh_until expired',
      },
    }]);

    staleIds.push(ev.id as string);
  }

  return { staleCount: staleIds.length, staleIds };
}

// ---------------------------------------------------------------------------
// Propagate staleness — cascade to moves and kanban
// ---------------------------------------------------------------------------

export interface PropagationResult {
  movesAffected: string[];
}

/**
 * If evidence supporting a move's verification is now stale, set the move's
 * verification to 'stale', move the kanban card to VERIFY, and emit a
 * MoveVerificationInvalidated event.
 *
 * Causal chain (spec §2.3):
 *   1. Evidence A -> stale
 *   2. Assertion B referencing A -> confidence recalculated
 *   3. Move C -> if verification was 'passed' and depended on now-stale evidence,
 *      C re-enters VERIFY column
 */
export async function propagateStaleness(
  sql: Sql,
  caseId: string,
): Promise<PropagationResult> {
  const movesAffected: string[] = [];

  // Find moves whose verification is 'passed' but have stale evidence
  const affectedMoves = await sql`
    SELECT DISTINCT m.id AS move_id, m.verification, c.organization_id AS tenant_id
    FROM moves m
    JOIN evidence e ON e.case_id = m.case_id
      AND e.subject_refs @> jsonb_build_array(jsonb_build_object('id', m.id))
    JOIN cases c ON c.id = m.case_id
    WHERE m.case_id = ${caseId}
      AND m.verification = 'passed'
      AND e.validity = 'stale'
  `;

  for (const row of affectedMoves) {
    const moveId = row.move_id as string;
    const tenantId = row.tenant_id as string;

    // Set verification to stale
    await sql`
      UPDATE moves SET verification = 'stale', revision = revision + 1
      WHERE id = ${moveId} AND verification = 'passed'
    `;

    // Move kanban card back to VERIFY
    await sql`
      UPDATE projection_kanban SET column_id = 'VERIFY', updated_at = NOW()
      WHERE move_id = ${moveId} AND column_id != 'VERIFY'
    `;

    // Emit MoveVerificationInvalidated event
    const eventId = crypto.randomUUID();
    await appendEvents(sql, [{
      id: eventId,
      tenant_id: tenantId,
      case_id: caseId,
      type: 'MoveVerificationInvalidated',
      actor_id: null,
      occurred_at: new Date(),
      causation_id: eventId,
      correlation_id: eventId,
      data: {
        move_id: moveId,
        reason: 'Supporting evidence became stale',
        old_verification: 'passed',
        new_verification: 'stale',
      },
    }]);

    // Raise attention item
    const attentionId = crypto.randomUUID();
    await sql`
      INSERT INTO projection_attention
        (id, case_id, move_id, priority, reason, action_required,
         actor_ids, blocking_impact, resolved, created_at, updated_at)
      VALUES (
        ${attentionId}, ${caseId}, ${moveId}, 'high',
        'Evidence staleness — re-verification needed',
        'Review and re-verify move evidence',
        '{}', 0, false, NOW(), NOW()
      )
      ON CONFLICT DO NOTHING
    `;

    // Recalculate assertion confidence for assertions referencing stale evidence
    await recalculateAssertionConfidence(sql, caseId, moveId);

    movesAffected.push(moveId);
  }

  return { movesAffected };
}

// ---------------------------------------------------------------------------
// Assertion confidence recalculation
// ---------------------------------------------------------------------------

async function recalculateAssertionConfidence(
  sql: Sql,
  caseId: string,
  moveId: string,
): Promise<void> {
  // Find assertions that reference this move and have evidence_refs
  const assertions = await sql`
    SELECT id, evidence_refs, confidence FROM assertions
    WHERE case_id = ${caseId}
      AND status = 'active'
      AND subject_ref @> ${sql.json({ id: moveId })}
  `;

  for (const assertion of assertions) {
    const evidenceRefs = (assertion.evidence_refs as string[]) ?? [];
    if (evidenceRefs.length === 0) continue;

    // Count valid vs stale/invalid evidence
    const evidenceStatus = await sql`
      SELECT
        COUNT(*) FILTER (WHERE validity = 'valid')::int AS valid_count,
        COUNT(*)::int AS total_count
      FROM evidence
      WHERE id = ANY(${evidenceRefs})
    `;

    const validCount = evidenceStatus[0]?.valid_count ?? 0;
    const totalCount = evidenceStatus[0]?.total_count ?? 0;

    if (totalCount === 0) continue;

    // Recalculate confidence as ratio of valid evidence
    const newConfidence = Math.round((validCount / totalCount) * 100) / 100;

    if (newConfidence !== assertion.confidence) {
      await sql`
        UPDATE assertions SET confidence = ${newConfidence}, revision = revision + 1
        WHERE id = ${assertion.id}
      `;
    }
  }
}

// ---------------------------------------------------------------------------
// All-in-one check (called by the worker controller)
// ---------------------------------------------------------------------------

/**
 * Run both staleness check and propagation for all open cases.
 * This is the entry point called by the worker's evidence staleness controller.
 */
export async function runStalenessCheck(sql: Sql): Promise<void> {
  // Find all open cases with evidence that might be stale
  const cases = await sql`
    SELECT DISTINCT e.case_id
    FROM evidence e
    JOIN cases c ON c.id = e.case_id
    WHERE c.lifecycle = 'open'
      AND e.fresh_until IS NOT NULL
      AND e.fresh_until < NOW()
      AND e.validity = 'valid'
  `;

  for (const row of cases) {
    const caseId = row.case_id as string;
    await sql.begin(async (tx) => {
      const txSql = tx as unknown as Sql;
      await checkStaleness(txSql, caseId);
      await propagateStaleness(txSql, caseId);
    });
  }
}
