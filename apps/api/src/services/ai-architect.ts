import type postgres from 'postgres';
import { computeProcessMetrics } from './process-metrics.js';
import { detectDrift } from './drift-detector.js';

type Sql = ReturnType<typeof postgres>;

export interface ProcessInsight {
  type: 'parallelize' | 'add_verification' | 'remove_step' | 'change_executor' | 'modify_pack' | 'add_evidence' | 'reduce_rework';
  recommendation: string;
  confidence: number;
  affected_move_ids: string[];
  estimated_impact: string;
  source: 'architect';
}

export interface ArchitectAnalysis {
  case_id: string;
  analyzed_at: string;
  insights: ProcessInsight[];
}

/**
 * AI Process Architect: analyze metrics + drift to propose process improvements.
 * Pure analysis -- proposes but never autonomously mutates.
 */
export async function analyzeProcess(sql: Sql, caseId: string): Promise<ArchitectAnalysis> {
  const metrics = await computeProcessMetrics(sql, caseId);
  const drift = await detectDrift(sql, caseId);
  const insights: ProcessInsight[] = [];

  // 1. Detect parallelization opportunities
  // Find sequential moves that have no dependency between them
  const sequentialMoves = await sql`
    SELECT m1.id AS first_id, m1.title AS first_title,
           m2.id AS second_id, m2.title AS second_title
    FROM moves m1
    JOIN moves m2 ON m2.case_id = m1.case_id AND m2.created_at > m1.created_at
    WHERE m1.case_id = ${caseId}
    AND m1.outcome = 'satisfied'
    AND m2.outcome = 'satisfied'
    AND NOT (m1.id = ANY(COALESCE(m2.dependencies, '{}')))
    AND NOT (m2.id = ANY(COALESCE(m1.dependencies, '{}')))
    AND m2.created_at - m1.created_at < INTERVAL '1 hour'
    LIMIT 5
  `.catch(() => []);

  for (const pair of sequentialMoves) {
    insights.push({
      type: 'parallelize',
      recommendation: `"${pair.first_title}" and "${pair.second_title}" have no dependency between them but ran sequentially. Consider running them in parallel.`,
      confidence: 0.7,
      affected_move_ids: [pair.first_id as string, pair.second_id as string],
      estimated_impact: 'Could reduce cycle time by overlapping these steps.',
      source: 'architect',
    });
  }

  // 2. Missing verification steps
  const movesWithoutEvidence = await sql`
    SELECT m.id, m.title FROM moves m
    WHERE m.case_id = ${caseId}
    AND m.outcome = 'satisfied'
    AND m.completion_contract IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM evidence e
      WHERE e.case_id = ${caseId} AND e.validity = 'valid'
      AND e.subject_refs::text LIKE '%' || m.id::text || '%'
    )
    LIMIT 5
  `.catch(() => []);

  for (const m of movesWithoutEvidence) {
    insights.push({
      type: 'add_verification',
      recommendation: `"${m.title}" was marked satisfied but has no valid evidence attached. Add verification evidence.`,
      confidence: 0.8,
      affected_move_ids: [m.id as string],
      estimated_impact: 'Ensures completion contracts are properly verified, improving reliability.',
      source: 'architect',
    });
  }

  // 3. High rework suggestions
  for (const anomaly of drift.anomalies.filter(a => a.type === 'rework_hotspot')) {
    insights.push({
      type: 'reduce_rework',
      recommendation: anomaly.recommendation,
      confidence: 0.75,
      affected_move_ids: anomaly.affected_move_ids,
      estimated_impact: `Reducing failed attempts would improve completion reliability (currently ${metrics.completion_reliability ? (metrics.completion_reliability * 100).toFixed(0) : '?'}%).`,
      source: 'architect',
    });
  }

  // 4. Executor performance issues
  for (const [key, perf] of Object.entries(metrics.executor_performance)) {
    if (perf.total >= 3 && perf.failed / perf.total > 0.5) {
      insights.push({
        type: 'change_executor',
        recommendation: `Executor "${key}" has a ${((perf.failed / perf.total) * 100).toFixed(0)}% failure rate (${perf.failed}/${perf.total}). Consider using a different executor or model.`,
        confidence: 0.85,
        affected_move_ids: [],
        estimated_impact: 'Switching to a more capable executor/model could reduce failure rate significantly.',
        source: 'architect',
      });
    }
  }

  // 5. Evidence gaps
  if (metrics.evidence_gaps > 0) {
    insights.push({
      type: 'add_evidence',
      recommendation: `${metrics.evidence_gaps} move(s) have completion contracts but lack evidence. These gaps reduce process integrity.`,
      confidence: 0.9,
      affected_move_ids: [],
      estimated_impact: 'Closing evidence gaps ensures process outcomes are provable.',
      source: 'architect',
    });
  }

  // Store insights in process_insights table
  for (const insight of insights) {
    await sql`
      INSERT INTO process_insights (case_id, type, source, recommendation, confidence, affected_move_ids, estimated_impact)
      VALUES (${caseId}, ${insight.type}, ${insight.source}, ${insight.recommendation},
              ${insight.confidence}, ${insight.affected_move_ids}, ${insight.estimated_impact})
    `.catch(() => {}); // table may not exist yet if migration hasn't run
  }

  return {
    case_id: caseId,
    analyzed_at: new Date().toISOString(),
    insights,
  };
}
