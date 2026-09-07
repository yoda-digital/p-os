import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

const KANBAN_COLUMNS = ['BACKLOG', 'READY', 'ACTIVE', 'WAITING', 'NEEDS_INPUT', 'VERIFY', 'DONE'] as const;

export interface KanbanCard {
  move_id: string;
  column_id: string;
  position: number;
  title: string;
  class: string;
  priority: string;
  risk: string;
  deadline: string | null;
  execution: string;
  verification: string;
  attention: string;
  outcome: string;
  assigned_actor_ids: string[];
  dependencies: string[];
  evidence_count: number;
}

export interface KanbanColumn {
  id: string;
  label: string;
  cards: KanbanCard[];
}

export async function getCaseSummary(sql: Sql, caseId: string) {
  const [row] = await sql`SELECT * FROM projection_case_summary WHERE case_id = ${caseId}`;
  if (!row) {
    // Rebuild from canonical state
    const [c] = await sql`SELECT * FROM cases WHERE id = ${caseId}`;
    if (!c) return null;
    const moveCounts = await sql`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE execution = 'running') AS active,
        count(*) FILTER (WHERE outcome = 'satisfied') AS completed,
        count(*) FILTER (WHERE readiness = 'not_ready' AND execution = 'not_started') AS blocked
      FROM moves WHERE case_id = ${caseId}
    `;
    const evidenceCount = await sql`SELECT count(*) AS cnt FROM evidence WHERE case_id = ${caseId}`;
    const decisionCount = await sql`SELECT count(*) AS cnt FROM decisions WHERE case_id = ${caseId} AND state IN ('requested', 'in_review')`;
    return {
      case_id: caseId,
      organization_id: c.organization_id,
      title: c.title,
      lifecycle: c.lifecycle,
      total_moves: Number(moveCounts[0]?.total ?? 0),
      active_moves: Number(moveCounts[0]?.active ?? 0),
      completed_moves: Number(moveCounts[0]?.completed ?? 0),
      blocked_moves: Number(moveCounts[0]?.blocked ?? 0),
      total_evidence: Number(evidenceCount[0]?.cnt ?? 0),
      pending_decisions: Number(decisionCount[0]?.cnt ?? 0),
      attention_required: false,
      primary_risk: 'none',
    };
  }
  return row;
}

export async function getKanban(sql: Sql, caseId: string): Promise<KanbanColumn[]> {
  const kanbanRows = await sql`
    SELECT pk.move_id, pk.column_id, pk.position, pk.card_data,
           m.class, m.title, m.priority, m.risk, m.deadline, m.execution,
           m.verification, m.attention, m.outcome, m.assigned_actor_ids, m.dependencies
    FROM projection_kanban pk
    JOIN moves m ON m.id = pk.move_id
    WHERE pk.case_id = ${caseId}
    ORDER BY pk.column_id, pk.position
  `;

  // Get evidence counts per move
  const evidenceCounts = await sql`
    SELECT unnest(
      ARRAY(SELECT jsonb_array_elements_text(subject_refs) FROM evidence WHERE case_id = ${caseId})
    ) AS ref, count(*) AS cnt
    FROM evidence WHERE case_id = ${caseId}
    GROUP BY ref
  `.catch(() => []);

  const evidenceMap = new Map<string, number>();
  for (const ec of evidenceCounts) {
    evidenceMap.set(ec.ref as string, Number(ec.cnt));
  }

  const columns: KanbanColumn[] = KANBAN_COLUMNS.map((id) => ({
    id,
    label: id.replace('_', ' '),
    cards: [],
  }));

  const columnMap = new Map(columns.map((c) => [c.id, c]));

  for (const row of kanbanRows) {
    const col = columnMap.get(row.column_id as string);
    if (col) {
      col.cards.push({
        move_id: row.move_id as string,
        column_id: row.column_id as string,
        position: row.position as number,
        title: row.title as string,
        class: row.class as string,
        priority: row.priority as string,
        risk: row.risk as string,
        deadline: row.deadline as string | null,
        execution: row.execution as string,
        verification: row.verification as string,
        attention: row.attention as string,
        outcome: row.outcome as string,
        assigned_actor_ids: (row.assigned_actor_ids as string[]) ?? [],
        dependencies: (row.dependencies as string[]) ?? [],
        evidence_count: evidenceMap.get(row.move_id as string) ?? 0,
      });
    }
  }

  return columns;
}

export async function getAttentionQueue(sql: Sql, caseId: string) {
  return sql`
    SELECT * FROM projection_attention
    WHERE case_id = ${caseId} AND resolved = false
    ORDER BY
      CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      created_at ASC
  `;
}

export async function getTimeline(
  sql: Sql,
  caseId: string,
  options: { limit?: number; offset?: number } = {}
) {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  // Build timeline from events
  const events = await sql`
    SELECT id, type, actor_id, occurred_at, data, case_sequence
    FROM events
    WHERE case_id = ${caseId}
    ORDER BY case_sequence DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return events.map((e) => ({
    event_id: e.id,
    case_id: caseId,
    occurred_at: e.occurred_at,
    type: e.type,
    actor_id: e.actor_id,
    summary: formatEventSummary(e.type as string, e.data as Record<string, unknown>),
    details: e.data,
    sequence: e.case_sequence,
  }));
}

function formatEventSummary(type: string, data: Record<string, unknown>): string {
  const title = (data['title'] as string) ?? '';
  switch (type) {
    case 'CaseCreated': return `Case created: ${title}`;
    case 'CaseUpdated': return `Case updated`;
    case 'CaseClosed': return `Case closed`;
    case 'CaseReopened': return `Case reopened`;
    case 'MoveCreated': return `Move created: ${title}`;
    case 'MoveActivated': return `Move activated`;
    case 'MovePaused': return `Move paused: ${(data['reason'] as string) ?? ''}`;
    case 'MoveResumed': return `Move resumed`;
    case 'MoveCancelled': return `Move cancelled`;
    case 'MoveSatisfied': return `Move satisfied`;
    case 'AttemptStarted': return `Attempt started`;
    case 'AttemptSucceeded': return `Attempt succeeded`;
    case 'AttemptFailed': return `Attempt failed: ${(data['reason'] as string) ?? ''}`;
    case 'AttemptSteered': return `Steering issued: ${(data['class'] as string) ?? ''}`;
    case 'EvidenceAttached': return `Evidence attached`;
    case 'EvidenceInvalidated': return `Evidence invalidated`;
    case 'DecisionCreated': return `Decision requested: ${(data['question'] as string) ?? ''}`;
    case 'DecisionResolved': return `Decision resolved`;
    case 'IntentCreated': return `Intent created: ${(data['statement'] as string) ?? ''}`;
    case 'RuleCreated': return `Rule created: ${(data['statement'] as string) ?? ''}`;
    case 'EntityCreated': return `Entity created: ${title}`;
    case 'RelationAdded': return `Relation added: ${(data['type'] as string) ?? ''}`;
    default: return type.replace(/([A-Z])/g, ' $1').trim();
  }
}

export async function getDependencyGraph(sql: Sql, caseId: string) {
  const moves = await sql`
    SELECT id, title, class, execution, outcome, dependencies, readiness
    FROM moves WHERE case_id = ${caseId}
  `;

  const nodes = moves.map((m) => ({
    id: m.id,
    title: m.title,
    class: m.class,
    execution: m.execution,
    outcome: m.outcome,
    readiness: m.readiness,
  }));

  const edges: Array<{ from: string; to: string; type: string }> = [];
  for (const m of moves) {
    const deps = (m.dependencies as string[]) ?? [];
    for (const dep of deps) {
      edges.push({ from: dep as string, to: m.id as string, type: 'DEPENDS_ON' });
    }
  }

  // Also include explicit relations
  const rels = await sql`
    SELECT source_ref, target_ref, type FROM relations
    WHERE case_id = ${caseId} AND type IN ('DEPENDS_ON', 'BLOCKS', 'REQUIRES')
  `;
  for (const r of rels) {
    const src = r.source_ref as { id: string };
    const tgt = r.target_ref as { id: string };
    edges.push({ from: src.id, to: tgt.id, type: r.type as string });
  }

  return { nodes, edges };
}

export async function getEvidenceStatus(sql: Sql, caseId: string) {
  return sql`
    SELECT * FROM evidence WHERE case_id = ${caseId} ORDER BY created_at DESC
  `;
}

export async function getRuleCompliance(sql: Sql, caseId: string) {
  return sql`
    SELECT * FROM rules WHERE case_id = ${caseId} ORDER BY type, created_at
  `;
}

export async function getDecisionQueue(sql: Sql, caseId: string) {
  return sql`
    SELECT * FROM decisions WHERE case_id = ${caseId}
    ORDER BY
      CASE state WHEN 'requested' THEN 0 WHEN 'in_review' THEN 1 WHEN 'deferred' THEN 2 ELSE 3 END,
      created_at ASC
  `;
}

export async function getExecutorStatus(sql: Sql, caseId: string) {
  return sql`
    SELECT a.executor_id, act.display_name, act.class,
           count(*) FILTER (WHERE a.state = 'running') AS active_attempts,
           count(*) FILTER (WHERE a.state = 'succeeded') AS succeeded,
           count(*) FILTER (WHERE a.state = 'failed') AS failed
    FROM attempts a
    LEFT JOIN actors act ON act.id = a.executor_id
    WHERE a.case_id = ${caseId}
    GROUP BY a.executor_id, act.display_name, act.class
  `;
}

export async function getCostSummary(sql: Sql, caseId: string) {
  const costs = await sql`
    SELECT
      count(*) AS total_attempts,
      count(*) FILTER (WHERE state = 'succeeded') AS succeeded,
      count(*) FILTER (WHERE state = 'failed') AS failed,
      sum((cost->>'monetary')::numeric) FILTER (WHERE cost IS NOT NULL AND cost->>'monetary' IS NOT NULL) AS total_cost,
      sum((usage->>'input_tokens')::bigint) FILTER (WHERE usage IS NOT NULL) AS total_input_tokens,
      sum((usage->>'output_tokens')::bigint) FILTER (WHERE usage IS NOT NULL) AS total_output_tokens
    FROM attempts WHERE case_id = ${caseId}
  `;
  return costs[0] ?? {};
}

export async function getContextStatus(sql: Sql, caseId: string) {
  const [capsule] = await sql`
    SELECT * FROM context_capsules WHERE case_id = ${caseId}
    ORDER BY generated_at DESC LIMIT 1
  `;
  return capsule ?? null;
}
