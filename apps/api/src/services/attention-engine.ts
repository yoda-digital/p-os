/**
 * Attention Engine — Computed priority queue with risk/deadline/authority ranking.
 *
 * Every Case-scoped item that needs human attention gets a computed priority score:
 *   score = w_risk * risk_factor
 *         + w_deadline * deadline_urgency
 *         + w_authority * authority_level
 *         + w_critical * is_critical_path
 *         + w_downstream * downstream_impact
 *
 * Weights are configurable per organization (stored in organizations.settings).
 */

import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

// ── Types ───────────────────────────────────────────────────────

export type AttentionLevel =
  | 'human_decision_required'
  | 'human_approval_required'
  | 'critical_intervention'
  | 'watch'
  | 'autonomous';

export type AttentionCategory =
  | 'decision'
  | 'approval'
  | 'intervention'
  | 'escalation'
  | 'deadline'
  | 'evidence_gap';

export interface AttentionWeights {
  w_risk: number;
  w_deadline: number;
  w_authority: number;
  w_critical: number;
  w_downstream: number;
}

export interface ComputedAttentionItem {
  id: string;
  case_id: string;
  move_id: string | null;
  decision_id: string | null;
  level: AttentionLevel;
  category: AttentionCategory;
  title: string;
  description: string;
  priority_score: number;
  required_authority: string[];
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution: string | null;
  // Original fields from projection_attention
  priority: string;
  reason: string;
  action_required: string | null;
  blocking_impact: number;
}

// ── Default Weights ─────────────────────────────────────────────

const DEFAULT_WEIGHTS: AttentionWeights = {
  w_risk: 0.30,
  w_deadline: 0.25,
  w_authority: 0.15,
  w_critical: 0.20,
  w_downstream: 0.10,
};

// ── Weight Loader ───────────────────────────────────────────────

async function loadWeights(sql: Sql, organizationId: string): Promise<AttentionWeights> {
  try {
    const [org] = await sql`
      SELECT settings FROM organizations WHERE id = ${organizationId}
    `;
    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const customWeights = settings['attention_weights'] as Partial<AttentionWeights> | undefined;
    if (customWeights) {
      return {
        w_risk: customWeights.w_risk ?? DEFAULT_WEIGHTS.w_risk,
        w_deadline: customWeights.w_deadline ?? DEFAULT_WEIGHTS.w_deadline,
        w_authority: customWeights.w_authority ?? DEFAULT_WEIGHTS.w_authority,
        w_critical: customWeights.w_critical ?? DEFAULT_WEIGHTS.w_critical,
        w_downstream: customWeights.w_downstream ?? DEFAULT_WEIGHTS.w_downstream,
      };
    }
  } catch {
    // Fall through to defaults
  }
  return DEFAULT_WEIGHTS;
}

// ── Score Computation Helpers ───────────────────────────────────

function computeRiskFactor(priority: string, moveRisk?: string): number {
  const priorityScores: Record<string, number> = { critical: 1.0, high: 0.75, medium: 0.5, low: 0.25 };
  const riskScores: Record<string, number> = { critical: 1.0, high: 0.75, medium: 0.5, low: 0.25, none: 0 };
  const ps = priorityScores[priority] ?? 0.25;
  const rs = riskScores[moveRisk ?? 'none'] ?? 0;
  return Math.max(ps, rs);
}

function computeDeadlineUrgency(deadline: Date | string | null): number {
  if (!deadline) return 0.1; // no deadline = low urgency
  const now = Date.now();
  const dl = new Date(deadline).getTime();
  const hoursLeft = (dl - now) / (1000 * 60 * 60);
  if (hoursLeft < 0) return 1.0; // overdue
  if (hoursLeft < 2) return 0.95;
  if (hoursLeft < 8) return 0.80;
  if (hoursLeft < 24) return 0.60;
  if (hoursLeft < 72) return 0.40;
  return 0.20;
}

function computeAuthorityLevel(isDecision: boolean, hasBlockingMoves: boolean): number {
  if (isDecision) return 0.90;
  if (hasBlockingMoves) return 0.70;
  return 0.30;
}

function computeCriticalPath(dependencies: string[], isCriticalPath: boolean): number {
  if (isCriticalPath) return 1.0;
  if (dependencies.length > 0) return 0.50;
  return 0.10;
}

function computeDownstreamImpact(blockingImpact: number): number {
  if (blockingImpact >= 5) return 1.0;
  if (blockingImpact >= 3) return 0.75;
  if (blockingImpact >= 1) return 0.50;
  return 0.10;
}

function classifyLevel(item: {
  priority: string;
  decision_id: string | null;
  reason: string;
  action_required: string | null;
}): AttentionLevel {
  if (item.decision_id) return 'human_decision_required';
  const reason = (item.reason ?? '').toLowerCase();
  if (reason.includes('critical') || item.priority === 'critical') return 'critical_intervention';
  if (reason.includes('approval') || reason.includes('budget')) return 'human_approval_required';
  if (item.priority === 'low') return 'watch';
  return 'human_approval_required';
}

function classifyCategory(item: {
  decision_id: string | null;
  reason: string;
}): AttentionCategory {
  if (item.decision_id) return 'decision';
  const reason = (item.reason ?? '').toLowerCase();
  if (reason.includes('overdue') || reason.includes('deadline')) return 'deadline';
  if (reason.includes('evidence') || reason.includes('stale')) return 'evidence_gap';
  if (reason.includes('escalat')) return 'escalation';
  if (reason.includes('approval') || reason.includes('budget')) return 'approval';
  if (reason.includes('critical') || reason.includes('failed')) return 'intervention';
  return 'approval';
}

// ── Main Entry Point ────────────────────────────────────────────

export async function computeAttention(
  sql: Sql,
  caseId: string
): Promise<ComputedAttentionItem[]> {
  // Load attention items
  const items = await sql`
    SELECT pa.*, m.risk AS move_risk, m.deadline AS move_deadline,
           m.dependencies AS move_dependencies, m.risk_level AS move_risk_level,
           d.blocking_move_ids AS decision_blocking_moves
    FROM projection_attention pa
    LEFT JOIN moves m ON m.id = pa.move_id
    LEFT JOIN decisions d ON d.id = pa.decision_id
    WHERE pa.case_id = ${caseId}
      AND pa.resolved = false
  `;

  if (items.length === 0) return [];

  // Load organization weights
  const [caseRow] = await sql`SELECT organization_id FROM cases WHERE id = ${caseId}`;
  const orgId = caseRow?.organization_id as string;
  const weights = await loadWeights(sql, orgId);

  // Count downstream impact per move
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

  // Detect critical path moves (moves on the longest dependency chain)
  const criticalPathMoveIds = await detectCriticalPath(sql, caseId);

  // Compute scores
  const computed: ComputedAttentionItem[] = items.map((item) => {
    const moveId = item.move_id as string | null;
    const priority = item.priority as string;
    const moveRisk = item.move_risk as string | undefined;
    const moveDeadline = item.move_deadline as Date | null;
    const moveDeps = (item.move_dependencies as string[]) ?? [];
    const decisionBlockingMoves = (item.decision_blocking_moves as string[]) ?? [];
    const blockingImpact = Number(item.blocking_impact ?? 0);
    const isCriticalPath = moveId ? criticalPathMoveIds.has(moveId) : false;
    const downstreamCount = moveId ? (downstreamMap.get(moveId) ?? 0) : 0;

    const riskFactor = computeRiskFactor(priority, moveRisk);
    const deadlineUrgency = computeDeadlineUrgency(moveDeadline);
    const authorityLevel = computeAuthorityLevel(!!item.decision_id, decisionBlockingMoves.length > 0);
    const criticalPath = computeCriticalPath(moveDeps, isCriticalPath);
    const downstream = computeDownstreamImpact(Math.max(blockingImpact, downstreamCount));

    const score =
      weights.w_risk * riskFactor +
      weights.w_deadline * deadlineUrgency +
      weights.w_authority * authorityLevel +
      weights.w_critical * criticalPath +
      weights.w_downstream * downstream;

    const level = classifyLevel(item as any);
    const category = classifyCategory(item as any);

    return {
      id: item.id as string,
      case_id: item.case_id as string,
      move_id: moveId,
      decision_id: item.decision_id as string | null,
      level,
      category,
      title: (item.reason as string) ?? 'Attention required',
      description: (item.action_required as string) ?? '',
      priority_score: Math.round(score * 1000) / 1000,
      required_authority: [],
      created_at: (item.created_at as Date).toISOString(),
      resolved_at: null,
      resolved_by: null,
      resolution: null,
      // Original fields
      priority,
      reason: item.reason as string,
      action_required: item.action_required as string | null,
      blocking_impact: blockingImpact,
    };
  });

  // Sort by priority_score descending
  computed.sort((a, b) => b.priority_score - a.priority_score);

  return computed;
}

// ── Critical Path Detection ─────────────────────────────────────

async function detectCriticalPath(sql: Sql, caseId: string): Promise<Set<string>> {
  const moves = await sql`
    SELECT id, dependencies
    FROM moves
    WHERE case_id = ${caseId}
      AND outcome NOT IN ('satisfied', 'cancelled', 'superseded', 'abandoned', 'failed')
  `;

  // Build adjacency (dependency → dependents)
  const depGraph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const allIds = new Set<string>();

  for (const m of moves) {
    const id = m.id as string;
    allIds.add(id);
    const deps = (m.dependencies as string[]) ?? [];
    inDegree.set(id, deps.length);
    for (const dep of deps) {
      const existing = depGraph.get(dep) ?? [];
      existing.push(id);
      depGraph.set(dep, existing);
    }
  }

  // Find longest path (critical path) using topological sort + dynamic programming
  const longestPath = new Map<string, number>();
  const predecessor = new Map<string, string | null>();
  const queue: string[] = [];

  for (const id of allIds) {
    const deg = inDegree.get(id) ?? 0;
    if (deg === 0) {
      queue.push(id);
      longestPath.set(id, 1);
      predecessor.set(id, null);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLen = longestPath.get(current) ?? 1;
    const dependents = depGraph.get(current) ?? [];

    for (const next of dependents) {
      if (!allIds.has(next)) continue;
      const nextLen = longestPath.get(next) ?? 0;
      if (currentLen + 1 > nextLen) {
        longestPath.set(next, currentLen + 1);
        predecessor.set(next, current);
      }
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  // Find the endpoint of the longest path
  let maxLen = 0;
  let endNode: string | null = null;
  for (const [id, len] of longestPath) {
    if (len > maxLen) { maxLen = len; endNode = id; }
  }

  // Trace back to build the critical path
  const criticalPath = new Set<string>();
  let node = endNode;
  while (node) {
    criticalPath.add(node);
    node = predecessor.get(node) ?? null;
  }

  return criticalPath;
}

// ── Periodic Attention Recompute (for worker) ───────────────────

export async function recomputeAllAttentionScores(sql: Sql): Promise<void> {
  const cases = await sql`
    SELECT DISTINCT case_id FROM projection_attention WHERE resolved = false
  `;

  for (const row of cases) {
    const caseId = row.case_id as string;
    try {
      const computed = await computeAttention(sql, caseId);

      // Update priority scores in projection_attention
      for (const item of computed) {
        await sql`
          UPDATE projection_attention
          SET blocking_impact = ${item.blocking_impact},
              priority = ${item.priority_score >= 0.7 ? 'critical' : item.priority_score >= 0.5 ? 'high' : item.priority_score >= 0.3 ? 'medium' : 'low'},
              updated_at = NOW()
          WHERE id = ${item.id}
        `;
      }
    } catch (err) {
      console.error(`[AttentionEngine] Failed to recompute for case ${caseId}:`, err);
    }
  }
}
