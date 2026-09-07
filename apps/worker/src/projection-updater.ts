import type { Sql } from '@pos/db';

/** Shape of an event row coming from the DB. */
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

export async function updateProjections(
  sql: Sql,
  event: EventRow
): Promise<void> {
  // Always add to timeline
  await upsertTimeline(sql, event);

  // Dispatch per event family
  const t = event.type;

  if (t.startsWith('Case'))       await refreshCaseSummary(sql, event);
  if (t.startsWith('Move'))       { await refreshKanban(sql, event); await refreshCaseSummary(sql, event); }
  if (t.startsWith('Attempt'))    { await refreshKanban(sql, event); await refreshCaseSummary(sql, event); }
  if (t.startsWith('Evidence'))   await refreshCaseSummary(sql, event);
  if (t.startsWith('Decision'))   await refreshCaseSummary(sql, event);
  if (t.startsWith('Attention'))  await refreshCaseSummary(sql, event);
  if (t.startsWith('Steering'))   await refreshKanban(sql, event);
}

// ── Timeline projection ─────────────────────────────────────────

async function upsertTimeline(sql: Sql, event: EventRow): Promise<void> {
  if (!event.case_id) return;

  const data = event.data ?? {};
  const moveId = (data['move_id'] as string) ?? null;
  const attemptId = (data['attempt_id'] as string) ?? null;
  const summary = buildTimelineSummary(event.type, data);

  await sql`
    INSERT INTO projection_timeline
      (event_id, case_id, occurred_at, type, actor_id, summary, details, move_id, attempt_id)
    VALUES
      (${event.id}, ${event.case_id}, ${event.occurred_at}, ${event.type},
       ${event.actor_id}, ${summary}, ${sql.json(data as any)}, ${moveId}, ${attemptId})
    ON CONFLICT (event_id) DO NOTHING
  `;
}

function buildTimelineSummary(
  type: string,
  data: Record<string, unknown>
): string {
  const title = (data['title'] as string) ?? '';
  switch (type) {
    case 'CaseCreated':           return `Case created: ${title}`;
    case 'CaseUpdated':           return `Case updated`;
    case 'CaseClosed':            return `Case closed`;
    case 'CaseReopened':          return `Case reopened`;
    case 'CaseArchived':          return `Case archived`;
    case 'CaseVoided':            return `Case voided`;
    case 'MoveCreated':           return `Move created: ${title}`;
    case 'MoveUpdated':           return `Move updated: ${title}`;
    case 'MoveActivated':         return `Move activated: ${title}`;
    case 'MovePaused':            return `Move paused: ${title}`;
    case 'MoveResumed':           return `Move resumed: ${title}`;
    case 'MoveCancelled':         return `Move cancelled: ${title}`;
    case 'MoveSuperseded':        return `Move superseded: ${title}`;
    case 'MoveSatisfied':         return `Move satisfied: ${title}`;
    case 'MoveFailed':            return `Move failed: ${title}`;
    case 'MoveAbandoned':         return `Move abandoned: ${title}`;
    case 'AttemptStarted':        return `Attempt started`;
    case 'AttemptSucceeded':      return `Attempt succeeded`;
    case 'AttemptFailed':         return `Attempt failed: ${(data['failure_reason'] as string) ?? ''}`;
    case 'AttemptCancelled':      return `Attempt cancelled`;
    case 'AttemptPaused':         return `Attempt paused`;
    case 'AttemptResumed':        return `Attempt resumed`;
    case 'AttemptSteered':        return `Attempt steered`;
    case 'AttemptProgressUpdated':return `Attempt progress updated`;
    case 'AttemptInterrupted':    return `Attempt interrupted`;
    case 'AttemptTimedOut':       return `Attempt timed out`;
    case 'AttemptLost':           return `Attempt lost`;
    case 'EvidenceAttached':      return `Evidence attached`;
    case 'EvidenceInvalidated':   return `Evidence invalidated`;
    case 'EvidenceDisputed':      return `Evidence disputed`;
    case 'DecisionCreated':       return `Decision requested: ${(data['question'] as string) ?? ''}`;
    case 'DecisionResolved':      return `Decision resolved`;
    case 'DecisionDeferred':      return `Decision deferred`;
    case 'DecisionUpdated':       return `Decision updated`;
    case 'DecisionSuperseded':    return `Decision superseded`;
    case 'SteeringIssued':        return `Steering issued: ${(data['class'] as string) ?? ''}`;
    case 'SteeringDelivered':     return `Steering delivered`;
    case 'SteeringAcknowledged':  return `Steering acknowledged`;
    case 'SteeringApplied':       return `Steering applied`;
    case 'EntityCreated':         return `Entity created: ${title}`;
    case 'EntityUpdated':         return `Entity updated: ${title}`;
    case 'EntityRemoved':         return `Entity removed`;
    case 'RelationAdded':         return `Relation added: ${(data['type'] as string) ?? ''}`;
    case 'RelationRemoved':       return `Relation removed`;
    case 'RelationUpdated':       return `Relation updated`;
    case 'AssertionCreated':      return `Assertion created`;
    case 'AssertionUpdated':      return `Assertion updated`;
    case 'AssertionRetracted':    return `Assertion retracted`;
    case 'IntentCreated':         return `Intent created: ${(data['statement'] as string) ?? ''}`;
    case 'IntentUpdated':         return `Intent updated`;
    case 'IntentSatisfied':       return `Intent satisfied`;
    case 'IntentFailed':          return `Intent failed`;
    case 'IntentAbandoned':       return `Intent abandoned`;
    case 'RuleCreated':           return `Rule created`;
    case 'RuleUpdated':           return `Rule updated`;
    case 'RuleSuperseded':        return `Rule superseded`;
    case 'RuleEvaluated':         return `Rule evaluated: ${(data['evaluation_status'] as string) ?? ''}`;
    case 'ResourceCreated':       return `Resource created: ${(data['name'] as string) ?? ''}`;
    case 'ResourceUpdated':       return `Resource updated`;
    case 'ResourceReserved':      return `Resource reserved`;
    case 'ResourceReleased':      return `Resource released`;
    case 'CompletionEvaluated':   return `Completion evaluated`;
    case 'PolicyEvaluated':       return `Policy evaluated`;
    case 'AttentionRaised':       return `Attention raised: ${(data['reason'] as string) ?? ''}`;
    case 'AttentionResolved':     return `Attention resolved`;
    case 'ExternalEventObserved': return `External event observed`;
    default:                      return type;
  }
}

// ── Kanban projection ────────────────────────────────────────────

async function refreshKanban(sql: Sql, event: EventRow): Promise<void> {
  if (!event.case_id) return;

  // Determine which move(s) to refresh
  const data = event.data ?? {};
  const moveId = (data['move_id'] as string) ?? (data['id'] as string) ?? null;

  if (moveId) {
    await refreshSingleKanbanCard(sql, moveId, event.case_id);
  } else {
    // Refresh all moves for the case (fallback)
    await refreshAllKanbanCards(sql, event.case_id);
  }
}

async function refreshSingleKanbanCard(
  sql: Sql,
  moveId: string,
  caseId: string
): Promise<void> {
  const [m] = await sql`
    SELECT * FROM moves WHERE id = ${moveId}
  `;
  if (!m) return;

  const columnId = deriveColumn(m);

  await sql`
    INSERT INTO projection_kanban (move_id, case_id, column_id, position, card_data, updated_at)
    VALUES (
      ${m.id}, ${caseId}, ${columnId}, 0,
      ${sql.json(buildCardData(m) as any)},
      NOW()
    )
    ON CONFLICT (move_id) DO UPDATE SET
      column_id  = EXCLUDED.column_id,
      card_data  = EXCLUDED.card_data,
      updated_at = NOW()
  `;
}

async function refreshAllKanbanCards(sql: Sql, caseId: string): Promise<void> {
  const moves = await sql`SELECT * FROM moves WHERE case_id = ${caseId}`;
  for (const m of moves) {
    const columnId = deriveColumn(m);
    await sql`
      INSERT INTO projection_kanban (move_id, case_id, column_id, position, card_data, updated_at)
      VALUES (${m.id}, ${caseId}, ${columnId}, 0, ${sql.json(buildCardData(m) as any)}, NOW())
      ON CONFLICT (move_id) DO UPDATE SET
        column_id  = EXCLUDED.column_id,
        card_data  = EXCLUDED.card_data,
        updated_at = NOW()
    `;
  }
}

function deriveColumn(m: Record<string, unknown>): string {
  if (m.outcome === 'satisfied')                                         return 'DONE';
  if (m.outcome === 'cancelled' || m.outcome === 'superseded' ||
      m.outcome === 'abandoned' || m.outcome === 'failed')               return 'DONE';
  if (m.verification === 'pending' || m.verification === 'running')      return 'VERIFY';
  if (['human_input', 'human_decision', 'human_approval',
       'critical_intervention'].includes(m.attention as string))         return 'NEEDS_INPUT';
  if ((m.execution === 'paused' || m.execution === 'suspended') &&
      m.readiness === 'ready')                                           return 'WAITING';
  if (m.execution === 'running' || m.execution === 'starting' ||
      m.execution === 'finishing')                                       return 'ACTIVE';
  if (m.readiness === 'ready' && m.execution === 'not_started')          return 'READY';
  return 'BACKLOG';
}

function buildCardData(m: Record<string, unknown>): Record<string, unknown> {
  return {
    title: m.title,
    class: m.class,
    priority: m.priority,
    risk: m.risk,
    deadline: m.deadline,
    execution: m.execution,
    verification: m.verification,
    attention: m.attention,
    outcome: m.outcome,
    readiness: m.readiness,
    temporal: m.temporal,
    risk_level: m.risk_level,
    assigned_actor_ids: m.assigned_actor_ids,
    dependencies: m.dependencies,
    objective: m.objective,
  };
}

// ── Case summary projection ─────────────────────────────────────

async function refreshCaseSummary(sql: Sql, event: EventRow): Promise<void> {
  const caseId = event.case_id;
  if (!caseId) return;

  await sql`
    INSERT INTO projection_case_summary
      (case_id, organization_id, title, lifecycle,
       total_moves, active_moves, completed_moves, blocked_moves,
       total_evidence, pending_decisions, attention_required,
       last_activity_at, updated_at)
    SELECT
      c.id,
      c.organization_id,
      c.title,
      c.lifecycle,
      COALESCE(m.total, 0),
      COALESCE(m.active, 0),
      COALESCE(m.completed, 0),
      COALESCE(m.blocked, 0),
      COALESCE(ev.total, 0),
      COALESCE(d.pending, 0),
      COALESCE(att.has_any, false),
      ${event.occurred_at},
      NOW()
    FROM cases c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int                                          AS total,
        COUNT(*) FILTER (WHERE execution = 'running')::int     AS active,
        COUNT(*) FILTER (WHERE outcome   = 'satisfied')::int   AS completed,
        COUNT(*) FILTER (WHERE readiness = 'not_ready')::int   AS blocked
      FROM moves WHERE case_id = c.id
    ) m ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS total FROM evidence WHERE case_id = c.id
    ) ev ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (
        WHERE state IN ('draft','requested','in_review')
      )::int AS pending
      FROM decisions WHERE case_id = c.id
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT EXISTS(
        SELECT 1 FROM projection_attention
        WHERE case_id = c.id AND NOT resolved
      ) AS has_any
    ) att ON true
    WHERE c.id = ${caseId}
    ON CONFLICT (case_id) DO UPDATE SET
      title              = EXCLUDED.title,
      lifecycle          = EXCLUDED.lifecycle,
      total_moves        = EXCLUDED.total_moves,
      active_moves       = EXCLUDED.active_moves,
      completed_moves    = EXCLUDED.completed_moves,
      blocked_moves      = EXCLUDED.blocked_moves,
      total_evidence     = EXCLUDED.total_evidence,
      pending_decisions  = EXCLUDED.pending_decisions,
      attention_required = EXCLUDED.attention_required,
      last_activity_at   = EXCLUDED.last_activity_at,
      updated_at         = NOW()
  `;
}
