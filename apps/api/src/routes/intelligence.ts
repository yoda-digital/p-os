import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';

type Sql = ReturnType<typeof postgres>;

export function intelligenceRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  // GET /metrics — process metrics
  app.get('/metrics', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);

    // Compute metrics from event history
    const moveCounts = await sql`
      SELECT
        count(*) AS total_moves,
        count(*) FILTER (WHERE outcome = 'satisfied') AS completed,
        count(*) FILTER (WHERE outcome = 'failed') AS failed_moves,
        count(*) FILTER (WHERE execution = 'running') AS active
      FROM moves WHERE case_id = ${caseId}
    `;

    const attemptStats = await sql`
      SELECT
        count(*) AS total_attempts,
        count(*) FILTER (WHERE state = 'succeeded') AS succeeded,
        count(*) FILTER (WHERE state = 'failed') AS failed,
        avg(EXTRACT(EPOCH FROM (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL AND started_at IS NOT NULL) AS avg_duration_seconds
      FROM attempts WHERE case_id = ${caseId}
    `;

    // Cycle time: average time from move creation to satisfaction
    const cycleTimes = await sql`
      SELECT avg(EXTRACT(EPOCH FROM (
        (SELECT MIN(e.occurred_at) FROM events e WHERE e.case_id = ${caseId} AND e.type = 'MoveSatisfied' AND e.data->>'id' = m.id::text)
        - m.created_at
      ))) AS avg_cycle_seconds
      FROM moves m WHERE m.case_id = ${caseId} AND m.outcome = 'satisfied'
    `;

    // Waiting time: count events showing moves in waiting state
    const waitingMoves = await sql`
      SELECT count(*) AS cnt FROM moves WHERE case_id = ${caseId} AND execution = 'paused'
    `;

    // Rework: moves that went from VERIFY back to ACTIVE
    const reworkEvents = await sql`
      SELECT count(*) AS cnt FROM events
      WHERE case_id = ${caseId} AND type = 'MoveResumed'
    `;

    // Evidence gaps
    const evidenceGaps = await sql`
      SELECT count(*) AS cnt FROM moves
      WHERE case_id = ${caseId} AND completion_contract IS NOT NULL
      AND outcome != 'satisfied'
      AND id NOT IN (
        SELECT DISTINCT (jsonb_array_elements(subject_refs)->>'id')::uuid
        FROM evidence WHERE case_id = ${caseId} AND validity = 'valid'
      )
    `.catch(() => [{ cnt: 0 }]);

    // Steering frequency
    const steeringCount = await sql`
      SELECT count(*) AS cnt FROM steering_commands
      WHERE case_id = ${caseId}
    `;

    const metrics = {
      case_id: caseId,
      computed_at: new Date().toISOString(),
      total_moves: Number(moveCounts[0]?.total_moves ?? 0),
      completed_moves: Number(moveCounts[0]?.completed ?? 0),
      failed_moves: Number(moveCounts[0]?.failed_moves ?? 0),
      active_moves: Number(moveCounts[0]?.active ?? 0),
      total_attempts: Number(attemptStats[0]?.total_attempts ?? 0),
      succeeded_attempts: Number(attemptStats[0]?.succeeded ?? 0),
      failed_attempts: Number(attemptStats[0]?.failed ?? 0),
      avg_attempt_duration_seconds: Number(attemptStats[0]?.avg_duration_seconds ?? 0),
      avg_cycle_time_seconds: Number(cycleTimes[0]?.avg_cycle_seconds ?? 0),
      waiting_moves: Number(waitingMoves[0]?.cnt ?? 0),
      rework_count: Number(reworkEvents[0]?.cnt ?? 0),
      evidence_gaps: Number(evidenceGaps[0]?.cnt ?? 0),
      steering_frequency: Number(steeringCount[0]?.cnt ?? 0),
      completion_reliability: attemptStats[0]?.total_attempts
        ? Number(attemptStats[0]?.succeeded ?? 0) / Number(attemptStats[0]?.total_attempts)
        : null,
    };

    return c.json(metrics);
  });

  // GET /drift — drift report
  app.get('/drift', async (c) => {
    const caseId = c.req.query('caseId');
    if (!caseId) return c.json({ error: 'caseId required' }, 400);

    // Analyze event patterns for drift
    const deviations: Array<{ type: string; description: string; severity: string }> = [];

    // Check for repeated manual steps (same command type by same actor in short succession)
    const repeatedPatterns = await sql`
      SELECT type, actor_id, count(*) AS cnt
      FROM events WHERE case_id = ${caseId}
      GROUP BY type, actor_id
      HAVING count(*) > 5
      ORDER BY cnt DESC
    `;
    for (const p of repeatedPatterns) {
      deviations.push({
        type: 'repeated_pattern',
        description: `Event "${p.type}" occurred ${p.cnt} times by actor ${p.actor_id}`,
        severity: Number(p.cnt) > 10 ? 'high' : 'medium',
      });
    }

    // Check for rework hotspots
    const reworkMoves = await sql`
      SELECT m.id, m.title, count(e.id) AS resume_count
      FROM moves m
      JOIN events e ON e.case_id = m.case_id AND e.type = 'MoveResumed' AND e.data->>'id' = m.id::text
      WHERE m.case_id = ${caseId}
      GROUP BY m.id, m.title
      HAVING count(e.id) > 1
    `;
    for (const m of reworkMoves) {
      deviations.push({
        type: 'rework_hotspot',
        description: `Move "${m.title}" was resumed ${m.resume_count} times (potential rework loop)`,
        severity: Number(m.resume_count) > 3 ? 'high' : 'medium',
      });
    }

    // Check for approval bottlenecks (decisions pending too long)
    const staleDecisions = await sql`
      SELECT id, question, created_at FROM decisions
      WHERE case_id = ${caseId} AND state IN ('requested', 'in_review')
      AND created_at < NOW() - INTERVAL '24 hours'
    `;
    for (const d of staleDecisions) {
      deviations.push({
        type: 'approval_bottleneck',
        description: `Decision "${d.question}" pending since ${(d.created_at as Date).toISOString()}`,
        severity: 'high',
      });
    }

    // Check for hidden dependencies (moves that always execute after another)
    // Simplified detection
    const moveOrder = await sql`
      SELECT m1.title AS before_title, m2.title AS after_title
      FROM moves m1
      JOIN moves m2 ON m2.case_id = m1.case_id
        AND m2.created_at > m1.created_at
        AND m2.id != m1.id
      WHERE m1.case_id = ${caseId}
        AND m1.outcome = 'satisfied'
        AND m2.id NOT IN (SELECT unnest(m2.dependencies))
      LIMIT 5
    `.catch(() => []);

    return c.json({
      case_id: caseId,
      computed_at: new Date().toISOString(),
      deviation_count: deviations.length,
      deviations,
    });
  });

  return app;
}
