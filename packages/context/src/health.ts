// Context health assessment — derives ContextHealth metrics from canonical DB state for an
// in-flight working session, plus a pure policy mapping health → recommended Context Action.
//
// A "session" is anchored to the Attempt driving the current work (an Attempt already
// carries `usage`, `cost` and `steering_history` — the closest canonical analog to an
// agentic working session in this schema). If `sessionId` doesn't match an Attempt (e.g. a
// case is being inspected with no bound execution), health falls back to case-wide signals
// plus a recent-activity window.
//
// See docs/specs_design.md §110 (Context Health) and §111 (Context Actions).

import type postgres from 'postgres';
import type { ContextAction, ContextHealth } from './index.js';

type Sql = ReturnType<typeof postgres>;

/** Baseline context-window budget used to normalize raw token counts into a 0-1 pressure ratio. */
const CONTEXT_WINDOW_TOKENS = 200_000;
/** Average event payload size (bytes) above which tool output is considered increasingly bloated. */
const BLOAT_BYTES_PER_EVENT = 4_000;
/** How far back to look for session activity when no Attempt row anchors the session. */
const FALLBACK_WINDOW_MS = 60 * 60 * 1000;
const PHASE_SHIFT_EVENT_TYPES = ['case.closed', 'case.reopened', 'case.archived', 'case.voided'];

export async function assessHealth(sql: Sql, sessionId: string, caseId: string): Promise<ContextHealth> {
  const [attempt] = await sql`SELECT * FROM attempts WHERE id = ${sessionId} AND case_id = ${caseId}`;

  const windowStart: Date = attempt
    ? new Date((attempt.started_at ?? attempt.created_at) as string)
    : new Date(Date.now() - FALLBACK_WINDOW_MS);

  const [pivotRow] = attempt
    ? await sql`SELECT COUNT(*)::int AS count FROM steering_commands WHERE attempt_id = ${attempt.id}`
    : await sql`
        SELECT COUNT(*)::int AS count FROM steering_commands
        WHERE case_id = ${caseId} AND issued_at >= ${windowStart}
      `;
  const pivotCount = Number(pivotRow?.count ?? 0);

  const usage = (attempt?.usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    cache_tokens?: number;
  };
  const totalTokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_tokens ?? 0);
  const tokenPressure = Math.min(totalTokens / CONTEXT_WINDOW_TOKENS, 1);

  // Resuming re-primes the model's cache with everything read so far — approximate that
  // cost with the monetary cost the executor already recorded for this attempt, if any.
  const cost = (attempt?.cost ?? {}) as { monetary_cost?: number };
  const resumeCacheCost = Number(cost.monetary_cost ?? 0);

  const [evidenceStats] = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE validity = 'stale')::int AS stale,
      COUNT(*) FILTER (WHERE validity = 'disputed')::int AS disputed
    FROM evidence WHERE case_id = ${caseId}
  `;
  const evidenceTotal = Number(evidenceStats?.total ?? 0);
  const staleAssumptionDensity = evidenceTotal > 0 ? Number(evidenceStats?.stale) / evidenceTotal : 0;
  const contradictionDensity = evidenceTotal > 0 ? Number(evidenceStats?.disputed) / evidenceTotal : 0;

  const [moveStats] = await sql`
    SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE outcome = 'satisfied')::int AS satisfied
    FROM moves WHERE case_id = ${caseId}
  `;
  const moveTotal = Number(moveStats?.total ?? 0);
  const remainingExpectedWork = moveTotal > 0 ? 1 - Number(moveStats?.satisfied) / moveTotal : 0;

  const [eventStats] = await sql`
    SELECT COUNT(*)::int AS count, COALESCE(SUM(LENGTH(data::text)), 0)::int AS bytes
    FROM events WHERE case_id = ${caseId} AND occurred_at >= ${windowStart}
  `;
  const eventCount = Number(eventStats?.count ?? 0);
  const avgEventBytes = eventCount > 0 ? Number(eventStats?.bytes) / eventCount : 0;
  const toolOutputBloat = Math.min(avgEventBytes / BLOAT_BYTES_PER_EVENT, 1);

  // Relevance: of the events in this session's window, how many are actually about the
  // move this session is working on vs. case-wide noise from unrelated concurrent work.
  let relevanceDensity = 1;
  if (attempt?.move_id) {
    const [relevance] = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE data ->> 'move_id' = ${attempt.move_id})::int AS relevant
      FROM events WHERE case_id = ${caseId} AND occurred_at >= ${windowStart}
    `;
    const total = Number(relevance?.total ?? 0);
    relevanceDensity = total > 0 ? Number(relevance?.relevant) / total : 1;
  }

  const [phaseRow] = await sql`
    SELECT COUNT(*)::int AS count FROM events
    WHERE case_id = ${caseId} AND occurred_at >= ${windowStart} AND type = ANY(${PHASE_SHIFT_EVENT_TYPES})
  `;
  const phaseShift = Number(phaseRow?.count ?? 0) > 0;

  return {
    tokenPressure,
    relevanceDensity,
    staleAssumptionDensity,
    contradictionDensity,
    toolOutputBloat,
    phaseShift,
    pivotCount,
    remainingExpectedWork,
    resumeCacheCost,
  };
}

/**
 * Pure threshold policy mapping Context Health to a recommended Context Action (spec §111).
 * No single dimension is sufficient on its own — several independent signals are checked.
 */
export function recommendContextAction(
  health: ContextHealth,
  resume: { secondsSinceLastResponse?: number; promptCacheLikelyExpired?: boolean } = {},
): ContextAction {
  if (health.tokenPressure > 0.85) return 'ROTATE_FRESH';
  if (health.staleAssumptionDensity > 0.5 || health.contradictionDensity > 0.3) return 'ROTATE_FRESH';
  if (health.tokenPressure > 0.7) return 'COMPACT_RECOMMENDED';
  if (health.pivotCount > 3) return 'FORK';
  if (
    resume.secondsSinceLastResponse != null &&
    resume.secondsSinceLastResponse > 3600 &&
    resume.promptCacheLikelyExpired
  ) {
    return 'ROTATE_FRESH';
  }
  return 'CONTINUE';
}
