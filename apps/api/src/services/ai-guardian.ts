import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

export type GuardianAlertType =
  | 'scope_drift'
  | 'policy_breach'
  | 'stale_evidence'
  | 'deadline_risk'
  | 'unauthorized_work'
  | 'duplicate_effort'
  | 'agent_loop';

export interface GuardianAlert {
  type: GuardianAlertType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  affected_move_ids: string[];
  recommended_action: string;
  evidence: Record<string, unknown>;
}

export interface GuardianReport {
  case_id: string;
  checked_at: string;
  alert_count: number;
  alerts: GuardianAlert[];
}

/**
 * AI Process Guardian: monitor for scope drift, policy breach, stale evidence,
 * deadline risk, unauthorized work, duplicate effort, and agent loops.
 * Creates Attention items for detected issues.
 */
export async function runGuardianCheck(sql: Sql, caseId: string): Promise<GuardianReport> {
  const alerts: GuardianAlert[] = [];

  // 1. Scope drift: new moves that don't connect to any intent
  const unlinkedMoves = await sql`
    SELECT m.id, m.title FROM moves m
    WHERE m.case_id = ${caseId}
    AND m.created_at > NOW() - INTERVAL '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM relations r
      WHERE r.source_ref->>'id' = m.id::text AND r.type = 'IMPLEMENTS'
    )
    AND NOT EXISTS (
      SELECT 1 FROM relations r
      WHERE r.target_ref->>'id' = m.id::text AND r.type IN ('IMPLEMENTS', 'DECOMPOSES')
    )
    LIMIT 5
  `.catch(() => []);

  for (const m of unlinkedMoves) {
    alerts.push({
      type: 'scope_drift',
      severity: 'medium',
      description: `Move "${m.title}" was created recently but is not linked to any intent or parent move. Possible scope drift.`,
      affected_move_ids: [m.id as string],
      recommended_action: 'Link this move to an intent or verify it is within scope.',
      evidence: { move_id: m.id, title: m.title },
    });
  }

  // 2. Policy breach: actions without authority
  const [autonomy] = await sql`
    SELECT * FROM autonomy_profiles WHERE case_id = ${caseId}
  `.catch(() => [undefined]);

  if (autonomy && autonomy.level === 'supervised') {
    // In supervised mode, check for auto-created moves (system actor without human approval)
    const autoMoves = await sql`
      SELECT e.* FROM events e
      WHERE e.case_id = ${caseId} AND e.type = 'MoveCreated'
      AND e.actor_id IS NULL
      AND e.occurred_at > NOW() - INTERVAL '1 hour'
      LIMIT 5
    `;
    for (const e of autoMoves) {
      const data = e.data as Record<string, unknown>;
      alerts.push({
        type: 'policy_breach',
        severity: 'high',
        description: `Move created without actor in supervised mode: "${data['title'] ?? 'unknown'}".`,
        affected_move_ids: [(data['id'] ?? e.id) as string],
        recommended_action: 'Review and approve or reject this auto-created move.',
        evidence: { event_id: e.id, data },
      });
    }
  }

  // 3. Stale evidence on critical paths
  const staleEvidence = await sql`
    SELECT e.id, e.type, e.description, e.fresh_until, e.validity,
      array_agg(DISTINCT (ref->>'id')) AS move_ids
    FROM evidence e
    CROSS JOIN LATERAL jsonb_array_elements(e.subject_refs) AS ref
    WHERE e.case_id = ${caseId}
    AND (
      (e.fresh_until IS NOT NULL AND e.fresh_until < NOW())
      OR e.validity = 'stale'
    )
    GROUP BY e.id, e.type, e.description, e.fresh_until, e.validity
    LIMIT 10
  `.catch(() => []);

  for (const se of staleEvidence) {
    alerts.push({
      type: 'stale_evidence',
      severity: 'medium',
      description: `Evidence "${se.type}: ${(se.description as string || '').slice(0, 60)}" is stale${se.fresh_until ? ` (expired ${se.fresh_until})` : ''}.`,
      affected_move_ids: (se.move_ids as string[]) ?? [],
      recommended_action: 'Refresh or re-collect this evidence to maintain process integrity.',
      evidence: { evidence_id: se.id, validity: se.validity, fresh_until: se.fresh_until },
    });
  }

  // 4. Deadline risk: moves with deadlines within 24 hours
  const atRiskMoves = await sql`
    SELECT id, title, deadline FROM moves
    WHERE case_id = ${caseId}
    AND deadline IS NOT NULL
    AND deadline < NOW() + INTERVAL '24 hours'
    AND outcome NOT IN ('satisfied', 'cancelled')
    LIMIT 10
  `.catch(() => []);

  for (const m of atRiskMoves) {
    const isPast = new Date(m.deadline as string) < new Date();
    alerts.push({
      type: 'deadline_risk',
      severity: isPast ? 'critical' : 'high',
      description: `Move "${m.title}" deadline ${isPast ? 'has passed' : 'is within 24 hours'}: ${m.deadline}.`,
      affected_move_ids: [m.id as string],
      recommended_action: isPast ? 'Escalate immediately -- deadline missed.' : 'Prioritize this move to meet the deadline.',
      evidence: { move_id: m.id, deadline: m.deadline, overdue: isPast },
    });
  }

  // 5. Duplicate effort: multiple active attempts on the same move
  const duplicateAttempts = await sql`
    SELECT move_id, count(*) AS active_count
    FROM attempts
    WHERE case_id = ${caseId} AND state IN ('running', 'pending')
    GROUP BY move_id
    HAVING count(*) > 1
    LIMIT 5
  `;
  for (const da of duplicateAttempts) {
    const [move] = await sql`SELECT title FROM moves WHERE id = ${da.move_id}`.catch(() => [{ title: 'unknown' }]);
    alerts.push({
      type: 'duplicate_effort',
      severity: 'medium',
      description: `Move "${move?.title}" has ${da.active_count} concurrent active attempts. This wastes resources.`,
      affected_move_ids: [da.move_id as string],
      recommended_action: 'Cancel redundant attempts and keep only the most promising one.',
      evidence: { move_id: da.move_id, active_attempts: da.active_count },
    });
  }

  // 6. Agent loops: repeated tool failures in recent events
  const toolFailures = await sql`
    SELECT data->>'move_id' AS move_id, count(*) AS failure_count
    FROM events
    WHERE case_id = ${caseId}
    AND type IN ('AttemptFailed', 'SteeringIssued')
    AND occurred_at > NOW() - INTERVAL '1 hour'
    AND data->>'move_id' IS NOT NULL
    GROUP BY data->>'move_id'
    HAVING count(*) > 3
    LIMIT 5
  `.catch(() => []);

  for (const tf of toolFailures) {
    const [move] = await sql`SELECT title FROM moves WHERE id = ${tf.move_id}::uuid`.catch(() => [{ title: 'unknown' }]);
    alerts.push({
      type: 'agent_loop',
      severity: 'high',
      description: `Move "${move?.title}" has ${tf.failure_count} failures in the last hour. Agent may be stuck in a loop.`,
      affected_move_ids: [tf.move_id as string],
      recommended_action: 'Pause this move, review the failure pattern, and consider a different strategy or human intervention.',
      evidence: { move_id: tf.move_id, failure_count: tf.failure_count },
    });
  }

  // Create attention items for high/critical alerts
  for (const alert of alerts.filter(a => a.severity === 'high' || a.severity === 'critical')) {
    const moveId = alert.affected_move_ids[0];
    if (moveId) {
      await sql`
        INSERT INTO projection_attention (id, case_id, move_id, priority, reason, action_required, blocking_impact)
        VALUES (
          gen_random_uuid(), ${caseId}, ${moveId}::uuid,
          ${alert.severity === 'critical' ? 'critical' : 'high'},
          ${`[Guardian] ${alert.description}`},
          ${alert.recommended_action},
          ${alert.severity === 'critical' ? 10 : 5}
        )
        ON CONFLICT DO NOTHING
      `.catch(() => {}); // gracefully handle if table schema differs
    }
  }

  return {
    case_id: caseId,
    checked_at: new Date().toISOString(),
    alert_count: alerts.length,
    alerts,
  };
}
