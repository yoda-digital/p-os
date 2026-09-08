import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

export interface ProcessMetricsResult {
  case_id: string;
  computed_at: string;
  cycle_time_seconds: number | null;
  waiting_time_seconds: number | null;
  rework_count: number;
  failed_attempts: number;
  human_attention_time_seconds: number | null;
  evidence_gaps: number;
  completion_reliability: number | null;
  cost_usd: number | null;
  executor_performance: Record<string, { total: number; succeeded: number; failed: number; avg_duration_seconds: number | null }>;
  context_rotations: number;
  steering_frequency: number;
  // Derived
  total_moves: number;
  completed_moves: number;
  active_moves: number;
  failed_moves: number;
  total_attempts: number;
  succeeded_attempts: number;
}

/**
 * Compute the 11 process metrics for a case from event history and current state.
 */
export async function computeProcessMetrics(sql: Sql, caseId: string): Promise<ProcessMetricsResult> {
  // 1. Basic move counts
  const [moveCounts] = await sql`
    SELECT
      count(*) AS total_moves,
      count(*) FILTER (WHERE outcome = 'satisfied') AS completed,
      count(*) FILTER (WHERE outcome = 'failed') AS failed_moves,
      count(*) FILTER (WHERE execution = 'running') AS active
    FROM moves WHERE case_id = ${caseId}
  `;

  // 2. Attempt statistics
  const [attemptStats] = await sql`
    SELECT
      count(*) AS total_attempts,
      count(*) FILTER (WHERE state = 'succeeded') AS succeeded,
      count(*) FILTER (WHERE state = 'failed') AS failed,
      avg(EXTRACT(EPOCH FROM (ended_at - started_at)))
        FILTER (WHERE ended_at IS NOT NULL AND started_at IS NOT NULL) AS avg_duration_seconds
    FROM attempts WHERE case_id = ${caseId}
  `;

  // 3. Cycle time: average time from move creation to satisfaction
  const [cycleTimes] = await sql`
    SELECT avg(EXTRACT(EPOCH FROM (
      (SELECT MIN(e.occurred_at) FROM events e
       WHERE e.case_id = ${caseId} AND e.type = 'MoveSatisfied'
       AND (e.data->>'id' = m.id::text OR e.data->>'move_id' = m.id::text))
      - m.created_at
    ))) AS avg_cycle_seconds
    FROM moves m WHERE m.case_id = ${caseId} AND m.outcome = 'satisfied'
  `;

  // 4. Waiting time: time moves spent paused
  const [waitingTime] = await sql`
    SELECT avg(EXTRACT(EPOCH FROM (
      COALESCE(
        (SELECT MIN(e2.occurred_at) FROM events e2
         WHERE e2.case_id = ${caseId} AND e2.type = 'MoveResumed'
         AND (e2.data->>'id' = e1.data->>'id' OR e2.data->>'move_id' = e1.data->>'id')
         AND e2.occurred_at > e1.occurred_at),
        NOW()
      ) - e1.occurred_at
    ))) AS avg_wait_seconds
    FROM events e1
    WHERE e1.case_id = ${caseId} AND e1.type = 'MovePaused'
  `.catch(() => [{ avg_wait_seconds: null }]);

  // 5. Rework count: moves that re-entered active after verify/satisfaction
  const [reworkCount] = await sql`
    SELECT count(DISTINCT e.data->>'id') AS cnt
    FROM events e
    WHERE e.case_id = ${caseId} AND e.type = 'MoveResumed'
  `;

  // 6. Failed attempts ratio
  const totalAttempts = Number(attemptStats?.total_attempts ?? 0);
  const failedAttempts = Number(attemptStats?.failed ?? 0);

  // 7. Human attention time: time between attention item creation and resolution
  const [attentionTime] = await sql`
    SELECT avg(EXTRACT(EPOCH FROM (
      COALESCE(resolved_at, NOW()) - created_at
    ))) AS avg_attention_seconds
    FROM projection_attention
    WHERE case_id = ${caseId}
  `.catch(() => [{ avg_attention_seconds: null }]);

  // 8. Evidence gaps: moves with completion contracts lacking valid evidence
  const [evidenceGaps] = await sql`
    SELECT count(*) AS cnt FROM moves
    WHERE case_id = ${caseId} AND completion_contract IS NOT NULL
    AND outcome != 'satisfied'
    AND id NOT IN (
      SELECT DISTINCT (jsonb_array_elements(subject_refs)->>'id')::uuid
      FROM evidence WHERE case_id = ${caseId} AND validity = 'valid'
    )
  `.catch(() => [{ cnt: 0 }]);

  // 9. Completion reliability: first-attempt success rate
  const [firstAttemptSuccess] = await sql`
    SELECT
      count(*) FILTER (WHERE state = 'succeeded' AND attempt_number = 1) AS first_success,
      count(*) FILTER (WHERE state = 'succeeded') AS total_success
    FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY move_id ORDER BY created_at) AS attempt_number
      FROM attempts WHERE case_id = ${caseId}
    ) sub
  `.catch(() => [{ first_success: 0, total_success: 0 }]);
  const totalSuccess = Number(firstAttemptSuccess?.total_success ?? 0);
  const firstSuccess = Number(firstAttemptSuccess?.first_success ?? 0);
  const completionReliability = totalSuccess > 0 ? firstSuccess / totalSuccess : null;

  // 10. Cost: total monetary cost from attempts
  const [costResult] = await sql`
    SELECT COALESCE(SUM((cost->>'amount')::numeric), 0) AS total_cost
    FROM attempts WHERE case_id = ${caseId} AND cost IS NOT NULL AND cost->>'amount' IS NOT NULL
  `.catch(() => [{ total_cost: 0 }]);

  // 11. Executor performance: success rate per executor/model
  const executorRows = await sql`
    SELECT
      COALESCE(executor_id::text, 'unknown') AS executor,
      COALESCE(model, 'default') AS model,
      count(*) AS total,
      count(*) FILTER (WHERE state = 'succeeded') AS succeeded,
      count(*) FILTER (WHERE state = 'failed') AS failed,
      avg(EXTRACT(EPOCH FROM (ended_at - started_at)))
        FILTER (WHERE ended_at IS NOT NULL AND started_at IS NOT NULL) AS avg_duration
    FROM attempts WHERE case_id = ${caseId}
    GROUP BY executor_id, model
  `;
  const executorPerformance: ProcessMetricsResult['executor_performance'] = {};
  for (const row of executorRows) {
    const key = `${row.executor}/${row.model}`;
    executorPerformance[key] = {
      total: Number(row.total),
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
      avg_duration_seconds: row.avg_duration != null ? Number(row.avg_duration) : null,
    };
  }

  // Context rotations: count distinct correlation_ids (each represents a session)
  const [contextRotations] = await sql`
    SELECT count(DISTINCT correlation_id) AS cnt
    FROM events WHERE case_id = ${caseId} AND correlation_id IS NOT NULL
  `;

  // Steering frequency
  const [steeringCount] = await sql`
    SELECT count(*) AS cnt FROM steering_commands WHERE case_id = ${caseId}
  `;

  return {
    case_id: caseId,
    computed_at: new Date().toISOString(),
    cycle_time_seconds: cycleTimes?.avg_cycle_seconds != null ? Number(cycleTimes.avg_cycle_seconds) : null,
    waiting_time_seconds: waitingTime?.avg_wait_seconds != null ? Number(waitingTime.avg_wait_seconds) : null,
    rework_count: Number(reworkCount?.cnt ?? 0),
    failed_attempts: failedAttempts,
    human_attention_time_seconds: attentionTime?.avg_attention_seconds != null ? Number(attentionTime.avg_attention_seconds) : null,
    evidence_gaps: Number(evidenceGaps?.cnt ?? 0),
    completion_reliability: completionReliability,
    cost_usd: Number(costResult?.total_cost ?? 0),
    executor_performance: executorPerformance,
    context_rotations: Number(contextRotations?.cnt ?? 0),
    steering_frequency: Number(steeringCount?.cnt ?? 0),
    total_moves: Number(moveCounts?.total_moves ?? 0),
    completed_moves: Number(moveCounts?.completed ?? 0),
    active_moves: Number(moveCounts?.active ?? 0),
    failed_moves: Number(moveCounts?.failed_moves ?? 0),
    total_attempts: totalAttempts,
    succeeded_attempts: Number(attemptStats?.succeeded ?? 0),
  };
}
