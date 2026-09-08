/**
 * Adaptive View Compiler — semantic composition detection + view prioritization.
 *
 * Analyzes the contents of a Case (entity types, evidence, moves, decisions)
 * to determine which views are most relevant and returns them in priority order.
 *
 * Pack-specific view ordering takes precedence when a pack is referenced.
 */

import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

// ── Types ───────────────────────────────────────────────────────

export interface CompiledView {
  id: string;
  label: string;
  priority: number;
  reason: string;
}

// ── All Known Views ─────────────────────────────────────────────

const ALL_VIEWS: Record<string, string> = {
  kanban: 'Kanban',
  attention: 'Attention',
  timeline: 'Timeline',
  dependencies: 'Dependencies',
  evidence: 'Evidence',
  decisions: 'Decisions',
  compliance: 'Compliance',
  actors: 'Actors',
  resources: 'Resources',
  risk: 'Risk',
  why: 'Why',
  'time-travel': 'Time Travel',
  simulation: 'Simulation',
  intelligence: 'Intelligence',
};

// ── Default ordering (fallback) ─────────────────────────────────

const DEFAULT_ORDER = [
  'kanban', 'attention', 'timeline', 'dependencies', 'evidence',
  'decisions', 'compliance', 'actors', 'resources', 'risk',
  'why', 'time-travel', 'simulation', 'intelligence',
];

// ── Main Entry Point ────────────────────────────────────────────

export async function compileViews(
  sql: Sql,
  caseId: string
): Promise<CompiledView[]> {
  // 1. Gather case composition data
  const [composition] = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM entities WHERE case_id = ${caseId} AND type LIKE '%.claim') AS claim_count,
      (SELECT COUNT(*)::int FROM evidence WHERE case_id = ${caseId}) AS evidence_count,
      (SELECT COUNT(*)::int FROM entities WHERE case_id = ${caseId} AND type LIKE '%.requirement') AS requirement_count,
      (SELECT COUNT(*)::int FROM moves WHERE case_id = ${caseId}
        AND execution = 'running' AND dependencies != '{}') AS parallel_move_count,
      (SELECT COUNT(*)::int FROM decisions WHERE case_id = ${caseId}
        AND state IN ('draft', 'requested', 'in_review')) AS pending_decision_count,
      (SELECT COUNT(*)::int FROM projection_attention WHERE case_id = ${caseId}
        AND resolved = false) AS attention_count,
      (SELECT COUNT(*)::int FROM moves WHERE case_id = ${caseId}) AS total_moves,
      (SELECT COUNT(*)::int FROM moves WHERE case_id = ${caseId}
        AND risk IN ('high', 'critical')) AS high_risk_count,
      (SELECT COUNT(*)::int FROM relations WHERE case_id = ${caseId}) AS relation_count,
      (SELECT COUNT(*)::int FROM entities WHERE case_id = ${caseId}
        AND type LIKE '%.stakeholder') AS stakeholder_count,
      (SELECT COUNT(*)::int FROM resources WHERE case_id = ${caseId}) AS resource_count,
      (SELECT COUNT(*)::int FROM entities WHERE case_id = ${caseId}
        AND type LIKE '%.hypothesis') AS hypothesis_count
  `;

  const counts = {
    claims: Number(composition?.claim_count ?? 0),
    evidence: Number(composition?.evidence_count ?? 0),
    requirements: Number(composition?.requirement_count ?? 0),
    parallelMoves: Number(composition?.parallel_move_count ?? 0),
    pendingDecisions: Number(composition?.pending_decision_count ?? 0),
    attention: Number(composition?.attention_count ?? 0),
    totalMoves: Number(composition?.total_moves ?? 0),
    highRisk: Number(composition?.high_risk_count ?? 0),
    relations: Number(composition?.relation_count ?? 0),
    stakeholders: Number(composition?.stakeholder_count ?? 0),
    resources: Number(composition?.resource_count ?? 0),
    hypotheses: Number(composition?.hypothesis_count ?? 0),
  };

  // 2. Check if case has pack references
  const [caseRow] = await sql`SELECT pack_refs FROM cases WHERE id = ${caseId}`;
  const packRefs = (caseRow?.pack_refs as Array<{ pack_id?: string; domain?: string }>) ?? [];

  // 3. If pack has view_priority, use it as base
  let packViewOrder: string[] | null = null;
  if (packRefs.length > 0) {
    const packDomain = packRefs[0]?.domain;
    const packId = packRefs[0]?.pack_id;

    if (packId || packDomain) {
      const [pack] = packId
        ? await sql`SELECT views FROM process_packs WHERE id = ${packId}`
        : await sql`SELECT views FROM process_packs WHERE domain = ${packDomain!} LIMIT 1`;

      if (pack?.views && Array.isArray(pack.views)) {
        packViewOrder = pack.views as string[];
      }
    }
  }

  // 4. Compute priorities using heuristic rules
  const scores = new Map<string, { score: number; reason: string }>();

  // Initialize with default scores
  for (const [idx, viewId] of DEFAULT_ORDER.entries()) {
    scores.set(viewId, { score: DEFAULT_ORDER.length - idx, reason: 'default ordering' });
  }

  // Apply pack-specific ordering (highest priority)
  if (packViewOrder) {
    for (const [idx, viewId] of packViewOrder.entries()) {
      const existing = scores.get(viewId);
      const packScore = 100 + (packViewOrder.length - idx) * 10;
      scores.set(viewId, { score: packScore, reason: `pack priority #${idx + 1}` });
    }
  }

  // Apply semantic composition heuristics
  applyHeuristic(scores, 'evidence', counts.claims >= 3 && counts.evidence >= 3, 80, 'many claims + evidence');
  applyHeuristic(scores, 'compliance', counts.requirements >= 3, 80, 'many requirements');
  applyHeuristic(scores, 'kanban', counts.parallelMoves >= 3, 80, 'parallel moves in progress');
  applyHeuristic(scores, 'decisions', counts.pendingDecisions >= 2, 85, 'multiple decisions pending');
  applyHeuristic(scores, 'attention', counts.attention >= 3, 90, 'multiple items need attention');
  applyHeuristic(scores, 'risk', counts.highRisk >= 2, 75, 'high-risk moves detected');
  applyHeuristic(scores, 'dependencies', counts.relations >= 5, 70, 'complex dependency graph');
  applyHeuristic(scores, 'actors', counts.stakeholders >= 3, 65, 'multiple stakeholders');
  applyHeuristic(scores, 'resources', counts.resources >= 2, 65, 'resources being tracked');

  // Special: if few moves, timeline is more useful than kanban
  if (counts.totalMoves <= 3) {
    applyHeuristic(scores, 'timeline', true, 75, 'few moves — timeline provides better overview');
  }

  // Attention always first if there are urgent items
  if (counts.attention > 0) {
    applyHeuristic(scores, 'attention', true, 95, 'unresolved attention items');
  }

  // 5. Sort and return
  const compiled: CompiledView[] = [];
  for (const [viewId, { score, reason }] of scores) {
    const label = ALL_VIEWS[viewId] ?? viewId;
    compiled.push({ id: viewId, label, priority: score, reason });
  }

  compiled.sort((a, b) => b.priority - a.priority);

  return compiled;
}

function applyHeuristic(
  scores: Map<string, { score: number; reason: string }>,
  viewId: string,
  condition: boolean,
  score: number,
  reason: string
): void {
  if (!condition) return;
  const existing = scores.get(viewId);
  if (!existing || score > existing.score) {
    scores.set(viewId, { score, reason });
  }
}

// ── API Route Helper ────────────────────────────────────────────

export async function getCompiledViewsForCase(sql: Sql, caseId: string): Promise<CompiledView[]> {
  return compileViews(sql, caseId);
}
