import type { Sql } from '@pos/db';

/** Minimal event row shape from the DB. */
interface EventRow {
  id: string;
  tenant_id: string;
  case_id: string | null;
  type: string;
  actor_id: string | null;
  occurred_at: Date;
  recorded_at: Date;
  causation_id: string | null;
  correlation_id: string | null;
  case_sequence: number | null;
  data: Record<string, unknown>;
}

// ── Public entry point ───────────────────────────────────────────

export async function runControllers(
  sql: Sql,
  event: EventRow
): Promise<void> {
  if (!event.case_id) return;

  const t = event.type;

  // Run relevant controllers based on event type
  if (t === 'MoveSatisfied' || t === 'MoveCancelled' || t === 'MoveSuperseded') {
    await dependencyController(sql, event);
  }

  if (t === 'EvidenceAttached' || t === 'EvidenceInvalidated') {
    await completionController(sql, event);
    await evidenceStalenessController(sql, event);
  }

  if (t === 'MoveCreated' || t === 'MoveActivated' || t === 'DecisionCreated') {
    await attentionController(sql, event);
  }

  if (t.startsWith('Move') || t.startsWith('Attempt')) {
    await deadlineController(sql, event);
    await riskController(sql, event);
  }

  if (t === 'AttemptSucceeded') {
    await completionController(sql, event);
  }

  if (t === 'AttemptFailed') {
    await riskController(sql, event);
  }

  // CommitCreated events (from plugin outbox) mark test/build evidence stale
  if (t === 'CommitCreated') {
    await commitStalenessController(sql, event);
  }

  // Attention priority recomputation on every event that changes case state
  if (
    t === 'MoveCreated' || t === 'MoveActivated' || t === 'MoveSatisfied' ||
    t === 'MoveCancelled' || t === 'DecisionCreated' || t === 'DecisionResolved' ||
    t === 'AttemptFailed' || t === 'AttemptSucceeded' ||
    t === 'EvidenceAttached' || t === 'EvidenceInvalidated' || t === 'EvidenceStale' ||
    t === 'AttentionRaised'
  ) {
    await attentionPriorityController(sql, event);
  }
}

// ── Dependency Controller ────────────────────────────────────────
// When a move reaches a terminal outcome, check if any moves that
// depend on it can now become ready.

async function dependencyController(
  sql: Sql,
  event: EventRow
): Promise<void> {
  const data = event.data ?? {};
  const satisfiedMoveId =
    (data['move_id'] as string) ?? (data['id'] as string);
  if (!satisfiedMoveId) return;

  // Find moves that list the satisfied move in their dependencies
  const dependents = await sql`
    SELECT id, dependencies, readiness
    FROM moves
    WHERE case_id = ${event.case_id}
      AND ${satisfiedMoveId} = ANY(dependencies)
      AND readiness = 'not_ready'
  `;

  for (const dep of dependents) {
    const deps = (dep.dependencies as string[]) ?? [];

    // Check if ALL dependencies are now satisfied
    if (deps.length === 0) continue;

    const unsatisfied = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM moves
      WHERE id = ANY(${deps})
        AND outcome != 'satisfied'
    `;

    const remaining = unsatisfied[0]?.cnt ?? 0;

    if (remaining === 0) {
      // All deps satisfied — mark this move as ready
      await sql`
        UPDATE moves
        SET readiness = 'ready', revision = revision + 1
        WHERE id = ${dep.id} AND readiness = 'not_ready'
      `;

      // Emit event
      const eventId = crypto.randomUUID();
      await sql`
        INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, causation_id, correlation_id, data)
        VALUES (
          ${eventId},
          ${event.tenant_id},
          ${event.case_id},
          'MoveUpdated',
          ${event.actor_id},
          NOW(),
          ${event.id},
          ${event.correlation_id},
          ${sql.json({ move_id: dep.id, field: 'readiness', old_value: 'not_ready', new_value: 'ready', reason: 'All dependencies satisfied' })}
        )
      `;

      await sql`
        INSERT INTO event_outbox (event_id) VALUES (${eventId})
      `;

      // Resolve related attention items
      await sql`
        UPDATE projection_attention
        SET resolved = true, resolved_at = NOW(), updated_at = NOW()
        WHERE move_id = ${dep.id}
          AND reason LIKE '%blocked%'
          AND NOT resolved
      `;
    }
  }
}

// ── Completion Controller ────────────────────────────────────────
// When evidence is attached or an attempt succeeds, check if the
// move's completion contract is now satisfied.

async function completionController(
  sql: Sql,
  event: EventRow
): Promise<void> {
  const data = event.data ?? {};
  const moveId = (data['move_id'] as string) ?? null;
  if (!moveId) return;

  const [move] = await sql`
    SELECT id, completion_contract, outcome, verification
    FROM moves
    WHERE id = ${moveId}
  `;
  if (!move) return;
  if (move.outcome === 'satisfied') return; // already done

  const contract = move.completion_contract as Record<string, unknown> | null;
  if (!contract) return;

  // Simple completion contract evaluation:
  // { type: 'evidence_count', minimum: N }
  // { type: 'all_evidence_valid' }
  // { type: 'attempt_succeeded' }
  // { type: 'all', conditions: [...] }
  // { type: 'any', conditions: [...] }

  const satisfied = await evaluateContract(sql, moveId, event.case_id!, contract);

  if (satisfied && move.verification !== 'passed') {
    // Mark verification as passed
    await sql`
      UPDATE moves
      SET verification = 'passed', revision = revision + 1
      WHERE id = ${moveId}
    `;

    const eventId = crypto.randomUUID();
    await sql`
      INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, causation_id, correlation_id, data)
      VALUES (
        ${eventId}, ${event.tenant_id}, ${event.case_id}, 'CompletionEvaluated',
        ${event.actor_id}, NOW(), ${event.id}, ${event.correlation_id},
        ${sql.json({ move_id: moveId, result: 'satisfied', contract } as any)}
      )
    `;
    await sql`INSERT INTO event_outbox (event_id) VALUES (${eventId})`;
  }
}

async function evaluateContract(
  sql: Sql,
  moveId: string,
  caseId: string,
  contract: Record<string, unknown>
): Promise<boolean> {
  const type = contract['type'] as string;

  switch (type) {
    case 'evidence_count': {
      const minimum = (contract['minimum'] as number) ?? 1;
      const [row] = await sql`
        SELECT COUNT(*)::int AS cnt
        FROM evidence
        WHERE case_id = ${caseId}
          AND validity = 'valid'
          AND subject_refs @> ${sql.json([{ id: moveId }])}
      `;
      return (row?.cnt ?? 0) >= minimum;
    }

    case 'all_evidence_valid': {
      const [row] = await sql`
        SELECT COUNT(*) FILTER (WHERE validity != 'valid')::int AS invalid_count
        FROM evidence
        WHERE case_id = ${caseId}
          AND subject_refs @> ${sql.json([{ id: moveId }])}
      `;
      return (row?.invalid_count ?? 0) === 0;
    }

    case 'attempt_succeeded': {
      const [row] = await sql`
        SELECT COUNT(*)::int AS cnt
        FROM attempts
        WHERE move_id = ${moveId} AND state = 'succeeded'
      `;
      return (row?.cnt ?? 0) > 0;
    }

    case 'all': {
      const conditions = (contract['conditions'] as Record<string, unknown>[]) ?? [];
      for (const cond of conditions) {
        if (!(await evaluateContract(sql, moveId, caseId, cond))) return false;
      }
      return conditions.length > 0;
    }

    case 'any': {
      const conditions = (contract['conditions'] as Record<string, unknown>[]) ?? [];
      for (const cond of conditions) {
        if (await evaluateContract(sql, moveId, caseId, cond)) return true;
      }
      return false;
    }

    default:
      // Unknown contract type — not satisfied
      return false;
  }
}

// ── Evidence Staleness Controller ────────────────────────────────
// When evidence is invalidated, check if any moves relying on it
// should return to verification.

async function evidenceStalenessController(
  sql: Sql,
  event: EventRow
): Promise<void> {
  if (event.type !== 'EvidenceInvalidated') return;

  const data = event.data ?? {};
  const evidenceId = (data['evidence_id'] as string) ?? (data['id'] as string);
  if (!evidenceId) return;

  // Find the evidence and its subject moves
  const [ev] = await sql`
    SELECT subject_refs FROM evidence WHERE id = ${evidenceId}
  `;
  if (!ev) return;

  const subjectRefs = (ev.subject_refs as Array<{ id: string }>) ?? [];
  for (const ref of subjectRefs) {
    const moveId = ref.id;
    if (!moveId) continue;

    // If the move was verified/satisfied, mark verification as stale
    const [move] = await sql`
      SELECT id, verification, outcome FROM moves WHERE id = ${moveId}
    `;
    if (!move) continue;

    if (move.verification === 'passed') {
      await sql`
        UPDATE moves
        SET verification = 'stale', revision = revision + 1
        WHERE id = ${moveId}
      `;

      const eventId = crypto.randomUUID();
      await sql`
        INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, causation_id, correlation_id, data)
        VALUES (
          ${eventId}, ${event.tenant_id}, ${event.case_id}, 'MoveUpdated',
          ${event.actor_id}, NOW(), ${event.id}, ${event.correlation_id},
          ${sql.json({ move_id: moveId, field: 'verification', old_value: 'passed', new_value: 'stale', reason: 'Evidence invalidated' })}
        )
      `;
      await sql`INSERT INTO event_outbox (event_id) VALUES (${eventId})`;

      // Raise attention
      await raiseAttention(sql, event, moveId, 'Evidence invalidated — re-verification needed', 'high');
    }
  }
}

// ── Attention Controller ─────────────────────────────────────────
// Raises attention items when human input is needed.

async function attentionController(
  sql: Sql,
  event: EventRow
): Promise<void> {
  const data = event.data ?? {};
  const moveId = (data['move_id'] as string) ?? (data['id'] as string) ?? null;

  if (event.type === 'DecisionCreated') {
    const decisionId = (data['decision_id'] as string) ?? (data['id'] as string);
    const question = (data['question'] as string) ?? 'Decision required';
    await raiseAttention(
      sql, event, moveId, `Decision required: ${question}`, 'high', decisionId
    );
    return;
  }

  if (!moveId) return;

  const [move] = await sql`
    SELECT id, attention, readiness, dependencies FROM moves WHERE id = ${moveId}
  `;
  if (!move) return;

  // If move has unmet dependencies, raise attention about blocked state
  if (move.readiness === 'not_ready') {
    const deps = (move.dependencies as string[]) ?? [];
    if (deps.length > 0) {
      const unsatisfied = await sql`
        SELECT COUNT(*)::int AS cnt
        FROM moves
        WHERE id = ANY(${deps}) AND outcome != 'satisfied'
      `;
      if ((unsatisfied[0]?.cnt ?? 0) > 0) {
        await raiseAttention(
          sql, event, moveId,
          `Move blocked by ${unsatisfied[0]?.cnt} unsatisfied dependencies`,
          'medium'
        );
      }
    }
  }

  // If move requires human attention
  if (['human_input', 'human_decision', 'human_approval', 'critical_intervention']
      .includes(move.attention as string)) {
    const priority = move.attention === 'critical_intervention' ? 'critical' : 'high';
    await raiseAttention(
      sql, event, moveId,
      `Move requires ${(move.attention as string).replace(/_/g, ' ')}`,
      priority
    );
  }
}

// ── Deadline Controller ──────────────────────────────────────────
// Checks for overdue or at-risk moves.

async function deadlineController(
  sql: Sql,
  event: EventRow
): Promise<void> {
  if (!event.case_id) return;

  // Check all moves with deadlines
  const overdue = await sql`
    UPDATE moves
    SET temporal = 'overdue', revision = revision + 1
    WHERE case_id = ${event.case_id}
      AND deadline IS NOT NULL
      AND deadline < NOW()
      AND temporal != 'overdue'
      AND outcome NOT IN ('satisfied', 'cancelled', 'superseded', 'abandoned', 'failed')
    RETURNING id, title
  `;

  for (const m of overdue) {
    await raiseAttention(
      sql, event, m.id as string,
      `Move overdue: ${m.title as string}`,
      'critical'
    );
  }

  // Mark at-risk (deadline within 24h)
  await sql`
    UPDATE moves
    SET temporal = 'at_risk', revision = revision + 1
    WHERE case_id = ${event.case_id}
      AND deadline IS NOT NULL
      AND deadline > NOW()
      AND deadline < NOW() + INTERVAL '24 hours'
      AND temporal NOT IN ('overdue', 'at_risk')
      AND outcome NOT IN ('satisfied', 'cancelled', 'superseded', 'abandoned', 'failed')
  `;
}

// ── Risk Controller ──────────────────────────────────────────────
// Reassesses risk when attempts fail or execution changes.

async function riskController(
  sql: Sql,
  event: EventRow
): Promise<void> {
  const data = event.data ?? {};
  const moveId = (data['move_id'] as string) ?? null;
  if (!moveId) return;

  if (event.type === 'AttemptFailed') {
    // Count failed attempts for this move
    const [row] = await sql`
      SELECT COUNT(*)::int AS fail_count
      FROM attempts
      WHERE move_id = ${moveId} AND state = 'failed'
    `;
    const failCount = row?.fail_count ?? 0;

    let newRisk: string;
    if (failCount >= 3) newRisk = 'critical';
    else if (failCount >= 2) newRisk = 'high';
    else newRisk = 'medium';

    await sql`
      UPDATE moves
      SET risk = ${newRisk}, risk_level = ${newRisk}, revision = revision + 1
      WHERE id = ${moveId}
        AND risk NOT IN ('critical')
    `;

    if (failCount >= 2) {
      await raiseAttention(
        sql, event, moveId,
        `Move has ${failCount} failed attempts — risk elevated to ${newRisk}`,
        failCount >= 3 ? 'critical' : 'high'
      );
    }
  }
}

// ── Commit Staleness Controller ─────────────────────────────────
// When a git commit happens, test/build evidence observed before the
// commit is now potentially stale (the code has changed).

async function commitStalenessController(
  sql: Sql,
  event: EventRow
): Promise<void> {
  if (!event.case_id) return;

  const data = event.data ?? {};
  const moveId = (data['move_id'] as string) ?? (data['moveId'] as string) ?? null;
  if (!moveId) return;

  // Find test_run evidence for this move that was observed before this commit
  const staleEvidence = await sql`
    SELECT e.id
    FROM evidence e
    WHERE e.case_id = ${event.case_id}
      AND e.validity = 'valid'
      AND e.subject_refs @> ${sql.json([{ id: moveId }])}
      AND (
        e.provenance->>'type' IN ('test_run', 'build_result')
        OR e.relation IN ('verifies')
      )
      AND e.observed_at < ${event.occurred_at}
  `;

  for (const ev of staleEvidence) {
    await sql`
      UPDATE evidence SET validity = 'stale', revision = revision + 1
      WHERE id = ${ev.id} AND validity = 'valid'
    `;

    const eventId = crypto.randomUUID();
    await sql`
      INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, causation_id, correlation_id, data)
      VALUES (
        ${eventId}, ${event.tenant_id}, ${event.case_id}, 'EvidenceStale',
        ${event.actor_id}, NOW(), ${event.id}, ${event.correlation_id},
        ${sql.json({ evidence_id: ev.id, reason: 'Code changed after evidence was observed (git commit)' })}
      )
    `;
    await sql`INSERT INTO event_outbox (event_id) VALUES (${eventId})`;
  }

  // If any evidence was invalidated, check if verification should be set to stale
  if (staleEvidence.length > 0) {
    const [move] = await sql`
      SELECT id, verification FROM moves WHERE id = ${moveId}
    `;
    if (move && move.verification === 'passed') {
      await sql`
        UPDATE moves SET verification = 'stale', revision = revision + 1
        WHERE id = ${moveId}
      `;
      await sql`
        UPDATE projection_kanban SET column_id = 'VERIFY', updated_at = NOW()
        WHERE move_id = ${moveId}
      `;

      await raiseAttention(
        sql, event, moveId,
        'Evidence invalidated by code change — re-verification needed', 'high'
      );
    }
  }
}

// ── Helper: raise attention item ─────────────────────────────────

async function raiseAttention(
  sql: Sql,
  event: EventRow,
  moveId: string | null,
  reason: string,
  priority: string,
  decisionId?: string
): Promise<void> {
  // Avoid duplicates: check if there's already an open attention item
  // with the same move and similar reason
  if (moveId) {
    const existing = await sql`
      SELECT id FROM projection_attention
      WHERE move_id = ${moveId}
        AND NOT resolved
        AND reason = ${reason}
      LIMIT 1
    `;
    if (existing.length > 0) return;
  }

  const attentionId = crypto.randomUUID();
  await sql`
    INSERT INTO projection_attention
      (id, case_id, move_id, decision_id, priority, reason,
       action_required, actor_ids, blocking_impact, resolved, created_at, updated_at)
    VALUES (
      ${attentionId},
      ${event.case_id},
      ${moveId},
      ${decisionId ?? null},
      ${priority},
      ${reason},
      ${reason},
      '{}',
      0,
      false,
      NOW(),
      NOW()
    )
  `;

  // Also emit an event
  const eventId = crypto.randomUUID();
  await sql`
    INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, causation_id, correlation_id, data)
    VALUES (
      ${eventId}, ${event.tenant_id}, ${event.case_id}, 'AttentionRaised',
      ${event.actor_id}, NOW(), ${event.id}, ${event.correlation_id},
      ${sql.json({ attention_id: attentionId, move_id: moveId, reason, priority })}
    )
  `;
  await sql`INSERT INTO event_outbox (event_id) VALUES (${eventId})`;
}

// ── Attention Priority Controller ───────────────────────────────
// Recomputes attention priority scores for the case whenever
// case state changes in a way that might shift priorities.

async function attentionPriorityController(
  sql: Sql,
  event: EventRow
): Promise<void> {
  if (!event.case_id) return;

  const caseId = event.case_id;

  // Count downstream dependents per move for blocking impact
  const downstreamCounts = await sql`
    SELECT unnest(dependencies) AS dep_id, COUNT(*)::int AS cnt
    FROM moves
    WHERE case_id = ${caseId}
      AND outcome NOT IN ('satisfied', 'cancelled', 'superseded', 'abandoned', 'failed')
    GROUP BY dep_id
  `;
  const downstreamMap = new Map<string, number>();
  for (const row of downstreamCounts) {
    downstreamMap.set(row.dep_id as string, row.cnt as number);
  }

  // Update blocking_impact for all unresolved attention items with a move_id
  const unresolvedItems = await sql`
    SELECT id, move_id FROM projection_attention
    WHERE case_id = ${caseId} AND resolved = false AND move_id IS NOT NULL
  `;

  for (const item of unresolvedItems) {
    const moveId = item.move_id as string;
    const impact = downstreamMap.get(moveId) ?? 0;
    await sql`
      UPDATE projection_attention
      SET blocking_impact = ${impact}, updated_at = NOW()
      WHERE id = ${item.id}
    `;
  }

  // Auto-resolve attention items for decisions that have been resolved
  await sql`
    UPDATE projection_attention pa
    SET resolved = true, resolved_at = NOW(), updated_at = NOW()
    WHERE pa.case_id = ${caseId}
      AND pa.resolved = false
      AND pa.decision_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM decisions d
        WHERE d.id = pa.decision_id AND d.state = 'decided'
      )
  `;

  // Auto-resolve attention items for moves that reached terminal state
  await sql`
    UPDATE projection_attention pa
    SET resolved = true, resolved_at = NOW(), updated_at = NOW()
    WHERE pa.case_id = ${caseId}
      AND pa.resolved = false
      AND pa.move_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM moves m
        WHERE m.id = pa.move_id
          AND m.outcome IN ('satisfied', 'cancelled', 'superseded', 'abandoned', 'failed')
      )
  `;

  // Escalation: if an item has been unresolved for > 24h, bump priority
  await sql`
    UPDATE projection_attention
    SET priority = 'critical', updated_at = NOW()
    WHERE case_id = ${caseId}
      AND resolved = false
      AND priority != 'critical'
      AND created_at < NOW() - INTERVAL '24 hours'
  `;
}
