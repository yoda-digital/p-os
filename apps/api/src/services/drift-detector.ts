import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

export interface DriftAnomaly {
  type: 'repeated_manual_steps' | 'hidden_dependency' | 'loop_detected' | 'rework_hotspot' | 'approval_bottleneck';
  description: string;
  severity: 'low' | 'medium' | 'high';
  affected_move_ids: string[];
  recommendation: string;
  evidence: Record<string, unknown>;
}

export interface DriftReport {
  case_id: string;
  computed_at: string;
  anomaly_count: number;
  anomalies: DriftAnomaly[];
}

/**
 * Compare expected process (from pack) vs observed (from events).
 * Detect: repeated manual steps, hidden deps, loops, rework hotspots, approval bottlenecks.
 */
export async function detectDrift(sql: Sql, caseId: string): Promise<DriftReport> {
  const anomalies: DriftAnomaly[] = [];

  // 1. Repeated manual steps: same actor performing same event type > 3 times
  const repeatedPatterns = await sql`
    SELECT type, actor_id, count(*) AS cnt
    FROM events WHERE case_id = ${caseId} AND actor_id IS NOT NULL
    GROUP BY type, actor_id
    HAVING count(*) > 3
    ORDER BY cnt DESC
    LIMIT 10
  `;
  for (const p of repeatedPatterns) {
    anomalies.push({
      type: 'repeated_manual_steps',
      description: `Action "${p.type}" performed ${p.cnt} times by actor ${(p.actor_id as string).slice(0, 8)}...`,
      severity: Number(p.cnt) > 10 ? 'high' : Number(p.cnt) > 5 ? 'medium' : 'low',
      affected_move_ids: [],
      recommendation: `Consider automating "${p.type}" or creating a reusable pack step for this pattern.`,
      evidence: { event_type: p.type, actor_id: p.actor_id, count: p.cnt },
    });
  }

  // 2. Hidden dependencies: moves frequently blocked by the same other move (not declared as dependency)
  const frequentBlockers = await sql`
    SELECT
      m1.id AS blocked_id, m1.title AS blocked_title,
      m2.id AS blocker_id, m2.title AS blocker_title,
      count(*) AS block_count
    FROM events e1
    JOIN moves m1 ON m1.case_id = ${caseId} AND (e1.data->>'id' = m1.id::text OR e1.data->>'move_id' = m1.id::text)
    JOIN events e2 ON e2.case_id = ${caseId} AND e2.type = 'MoveSatisfied'
      AND e2.occurred_at < e1.occurred_at
      AND e2.occurred_at > e1.occurred_at - INTERVAL '1 hour'
    JOIN moves m2 ON m2.case_id = ${caseId} AND (e2.data->>'id' = m2.id::text OR e2.data->>'move_id' = m2.id::text)
    WHERE e1.type = 'MoveActivated'
      AND NOT (m2.id = ANY(COALESCE(m1.dependencies, '{}')))
    GROUP BY m1.id, m1.title, m2.id, m2.title
    HAVING count(*) >= 2
    LIMIT 5
  `.catch(() => []);

  for (const fb of frequentBlockers) {
    anomalies.push({
      type: 'hidden_dependency',
      description: `"${fb.blocked_title}" frequently activates after "${fb.blocker_title}" completes (${fb.block_count} times), but no formal dependency declared.`,
      severity: Number(fb.block_count) >= 3 ? 'high' : 'medium',
      affected_move_ids: [fb.blocked_id as string, fb.blocker_id as string],
      recommendation: `Consider adding "${fb.blocker_title}" as an explicit dependency of "${fb.blocked_title}".`,
      evidence: { blocked_id: fb.blocked_id, blocker_id: fb.blocker_id, count: fb.block_count },
    });
  }

  // 3. Loops: moves that entered the same state more than 2 times
  const loopMoves = await sql`
    SELECT data->>'id' AS move_id, type, count(*) AS state_entries
    FROM events
    WHERE case_id = ${caseId}
    AND type IN ('MoveActivated', 'MovePaused', 'MoveResumed')
    GROUP BY data->>'id', type
    HAVING count(*) > 2
    LIMIT 10
  `;
  for (const lm of loopMoves) {
    const [move] = await sql`SELECT title FROM moves WHERE id = ${lm.move_id}::uuid`.catch(() => [{ title: lm.move_id }]);
    anomalies.push({
      type: 'loop_detected',
      description: `Move "${move?.title ?? lm.move_id}" entered ${lm.type} state ${lm.state_entries} times (potential loop).`,
      severity: Number(lm.state_entries) > 4 ? 'high' : 'medium',
      affected_move_ids: [lm.move_id as string],
      recommendation: `Investigate why "${move?.title ?? lm.move_id}" keeps cycling through ${lm.type}. Check completion contracts and failure conditions.`,
      evidence: { move_id: lm.move_id, event_type: lm.type, count: lm.state_entries },
    });
  }

  // 4. Rework hotspots: moves with > 2 failed attempts
  const reworkMoves = await sql`
    SELECT m.id, m.title, count(a.id) AS failed_count
    FROM moves m
    JOIN attempts a ON a.move_id = m.id AND a.state = 'failed'
    WHERE m.case_id = ${caseId}
    GROUP BY m.id, m.title
    HAVING count(a.id) > 2
    ORDER BY count(a.id) DESC
    LIMIT 10
  `;
  for (const rm of reworkMoves) {
    anomalies.push({
      type: 'rework_hotspot',
      description: `Move "${rm.title}" has ${rm.failed_count} failed attempts.`,
      severity: Number(rm.failed_count) > 5 ? 'high' : 'medium',
      affected_move_ids: [rm.id as string],
      recommendation: `Review the task definition and strategy for "${rm.title}". Consider changing executor, model, or decomposing into smaller steps.`,
      evidence: { move_id: rm.id, failed_count: rm.failed_count },
    });
  }

  // 5. Approval bottlenecks: decisions pending > 24 hours
  const staleDecisions = await sql`
    SELECT d.id, d.question, d.created_at,
      EXTRACT(EPOCH FROM (NOW() - d.created_at)) AS age_seconds,
      COALESCE(array_agg(d2.id), '{}') AS blocking_move_ids
    FROM decisions d
    LEFT JOIN LATERAL unnest(d.blocking_move_ids) AS d2(id) ON true
    WHERE d.case_id = ${caseId} AND d.state IN ('requested', 'in_review')
    AND d.created_at < NOW() - INTERVAL '24 hours'
    GROUP BY d.id, d.question, d.created_at
    ORDER BY d.created_at ASC
    LIMIT 10
  `.catch(() => []);

  for (const sd of staleDecisions) {
    const hours = Math.round(Number(sd.age_seconds) / 3600);
    anomalies.push({
      type: 'approval_bottleneck',
      description: `Decision "${sd.question}" pending for ${hours} hours.`,
      severity: hours > 72 ? 'high' : 'medium',
      affected_move_ids: (sd.blocking_move_ids as string[]) ?? [],
      recommendation: `Escalate decision "${sd.question}" or delegate to someone with authority.`,
      evidence: { decision_id: sd.id, age_hours: hours, created_at: sd.created_at },
    });
  }

  return {
    case_id: caseId,
    computed_at: new Date().toISOString(),
    anomaly_count: anomalies.length,
    anomalies,
  };
}
