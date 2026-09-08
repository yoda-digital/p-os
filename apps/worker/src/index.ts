import { getDb } from '@pos/db';
import { updateProjections } from './projection-updater.js';
import { runControllers } from './controller-runner.js';

const POLL_INTERVAL = Number(process.env['WORKER_POLL_MS'] ?? 1000);

// Track the last outbox row we processed so we never replay
let lastProcessedId = 0;

// ── Outbox poller ────────────────────────────────────────────────

async function processOutbox(): Promise<void> {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT
        o.id          AS outbox_id,
        e.id          AS event_id,
        e.tenant_id,
        e.case_id,
        e.type,
        e.actor_id,
        e.occurred_at,
        e.recorded_at,
        e.causation_id,
        e.correlation_id,
        e.case_sequence,
        e.data
      FROM event_outbox o
      JOIN events e ON e.id = o.event_id
      WHERE o.id > ${lastProcessedId}
      ORDER BY o.id
      LIMIT 50
    `;

    for (const row of rows) {
      const event = {
        id: row.event_id as string,
        tenant_id: row.tenant_id as string,
        case_id: row.case_id as string | null,
        type: row.type as string,
        actor_id: row.actor_id as string | null,
        occurred_at: row.occurred_at as Date,
        recorded_at: row.recorded_at as Date,
        causation_id: row.causation_id as string | null,
        correlation_id: row.correlation_id as string | null,
        case_sequence: row.case_sequence != null ? Number(row.case_sequence) : null,
        data: (row.data ?? {}) as Record<string, unknown>,
      };

      try {
        await updateProjections(sql, event);
        await runControllers(sql, event);
      } catch (err) {
        console.error(`[Worker] Error processing event ${event.id} (${event.type}):`, err);
        // Continue to next event — don't block the pipeline
      }

      lastProcessedId = Number(row.outbox_id);
    }
  } catch (err) {
    console.error('[Worker] Outbox poll error:', err);
  }
}

// ── Full projection rebuild ──────────────────────────────────────

async function rebuildAllProjections(sql: ReturnType<typeof getDb>): Promise<void> {
  console.log('[Worker] Rebuilding case summaries...');

  await sql`
    INSERT INTO projection_case_summary
      (case_id, organization_id, title, lifecycle,
       total_moves, active_moves, completed_moves, blocked_moves,
       total_evidence, pending_decisions, attention_required,
       last_activity_at, updated_at)
    SELECT
      c.id, c.organization_id, c.title, c.lifecycle,
      COALESCE(m.total, 0),
      COALESCE(m.active, 0),
      COALESCE(m.completed, 0),
      COALESCE(m.blocked, 0),
      COALESCE(ev.total, 0),
      COALESCE(d.pending, 0),
      COALESCE(att.has_any, false),
      COALESCE(
        (SELECT MAX(occurred_at) FROM events WHERE case_id = c.id),
        c.created_at
      ),
      NOW()
    FROM cases c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int                                         AS total,
        COUNT(*) FILTER (WHERE execution = 'running')::int    AS active,
        COUNT(*) FILTER (WHERE outcome   = 'satisfied')::int  AS completed,
        COUNT(*) FILTER (WHERE readiness = 'not_ready')::int  AS blocked
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

  console.log('[Worker] Rebuilding kanban projections...');

  await sql`
    INSERT INTO projection_kanban
      (move_id, case_id, column_id, position, card_data, updated_at)
    SELECT
      m.id, m.case_id,
      CASE
        WHEN m.outcome IN ('satisfied','cancelled','superseded','abandoned','failed') THEN 'DONE'
        WHEN m.verification IN ('pending','running') THEN 'VERIFY'
        WHEN m.attention IN ('human_input','human_decision','human_approval','critical_intervention') THEN 'NEEDS_INPUT'
        WHEN m.execution IN ('paused','suspended') AND m.readiness = 'ready' THEN 'WAITING'
        WHEN m.execution IN ('running','starting','finishing') THEN 'ACTIVE'
        WHEN m.readiness = 'ready' AND m.execution = 'not_started' THEN 'READY'
        ELSE 'BACKLOG'
      END,
      ROW_NUMBER() OVER (
        PARTITION BY m.case_id
        ORDER BY
          CASE m.priority
            WHEN 'critical' THEN 0
            WHEN 'high'     THEN 1
            WHEN 'medium'   THEN 2
            WHEN 'low'      THEN 3
            ELSE 4
          END,
          m.created_at
      )::int,
      jsonb_build_object(
        'title',              m.title,
        'class',              m.class,
        'priority',           m.priority,
        'risk',               m.risk,
        'deadline',           m.deadline,
        'execution',          m.execution,
        'verification',       m.verification,
        'attention',          m.attention,
        'outcome',            m.outcome,
        'readiness',          m.readiness,
        'temporal',           m.temporal,
        'risk_level',         m.risk_level,
        'assigned_actor_ids', m.assigned_actor_ids,
        'dependencies',       m.dependencies,
        'objective',          m.objective
      ),
      NOW()
    FROM moves m
    ON CONFLICT (move_id) DO UPDATE SET
      column_id  = EXCLUDED.column_id,
      position   = EXCLUDED.position,
      card_data  = EXCLUDED.card_data,
      updated_at = NOW()
  `;

  console.log('[Worker] Projections rebuilt.');
}

// ── Periodic maintenance ─────────────────────────────────────────

async function periodicMaintenance(): Promise<void> {
  const sql = getDb();
  try {
    // Check deadlines globally
    const overdue = await sql`
      UPDATE moves
      SET temporal = 'overdue', revision = revision + 1
      WHERE deadline IS NOT NULL
        AND deadline < NOW()
        AND temporal != 'overdue'
        AND outcome NOT IN ('satisfied','cancelled','superseded','abandoned','failed')
      RETURNING id, case_id, title
    `;

    for (const m of overdue) {
      const attId = crypto.randomUUID();
      await sql`
        INSERT INTO projection_attention
          (id, case_id, move_id, priority, reason, action_required,
           actor_ids, blocking_impact, resolved, created_at, updated_at)
        VALUES (
          ${attId}, ${m.case_id}, ${m.id}, 'critical',
          ${'Move overdue: ' + (m.title as string)},
          'Review and take action on overdue move',
          '{}', 0, false, NOW(), NOW()
        )
        ON CONFLICT DO NOTHING
      `;
    }

    // Mark at-risk (within 24h)
    await sql`
      UPDATE moves
      SET temporal = 'at_risk', revision = revision + 1
      WHERE deadline IS NOT NULL
        AND deadline > NOW()
        AND deadline < NOW() + INTERVAL '24 hours'
        AND temporal NOT IN ('overdue','at_risk')
        AND outcome NOT IN ('satisfied','cancelled','superseded','abandoned','failed')
    `;

    // Clean up old processed outbox entries (keep 7 days)
    await sql`
      DELETE FROM event_outbox
      WHERE processed_at IS NOT NULL
        AND processed_at < NOW() - INTERVAL '7 days'
    `;
  } catch (err) {
    console.error('[Worker] Maintenance error:', err);
  }
}

// ── Evidence staleness controller (spec §2.6) ───────────────────
// Runs every 30 seconds: checks fresh_until timestamps on evidence,
// marks expired ones stale, and propagates to dependent moves.

async function evidenceStalenessLoop(): Promise<void> {
  const sql = getDb();
  try {
    // 1. Find all open cases with evidence that might be stale
    const cases = await sql`
      SELECT DISTINCT e.case_id
      FROM evidence e
      JOIN cases c ON c.id = e.case_id
      WHERE c.lifecycle = 'open'
        AND e.fresh_until IS NOT NULL
        AND e.fresh_until < NOW()
        AND e.validity = 'valid'
    `;

    for (const row of cases) {
      const caseId = row.case_id as string;
      await sql.begin(async (tx) => {
        // Mark expired evidence as stale
        const expired = await tx`
          SELECT e.id, e.case_id, c.organization_id AS tenant_id
          FROM evidence e
          JOIN cases c ON c.id = e.case_id
          WHERE e.case_id = ${caseId}
            AND e.fresh_until IS NOT NULL
            AND e.fresh_until < NOW()
            AND e.validity = 'valid'
        `;

        for (const ev of expired) {
          await tx`
            UPDATE evidence SET validity = 'stale', revision = revision + 1
            WHERE id = ${ev.id} AND validity = 'valid'
          `;

          const eventId = crypto.randomUUID();
          await tx`
            INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, causation_id, correlation_id, data)
            VALUES (${eventId}, ${ev.tenant_id}, ${ev.case_id}, 'EvidenceStale', NULL, NOW(),
                    ${eventId}, ${eventId},
                    ${tx.json({ evidence_id: ev.id, reason: 'fresh_until expired' })})
          `;
          await tx`INSERT INTO event_outbox (event_id) VALUES (${eventId})`;
        }

        // Propagate: if evidence supporting a move's verification is now stale,
        // set move verification to 'stale' and move to VERIFY column
        const affectedMoves = await tx`
          SELECT DISTINCT m.id AS move_id, c.organization_id AS tenant_id
          FROM moves m
          JOIN evidence e ON e.case_id = m.case_id
            AND e.subject_refs @> jsonb_build_array(jsonb_build_object('id', m.id))
          JOIN cases c ON c.id = m.case_id
          WHERE m.case_id = ${caseId}
            AND m.verification = 'passed'
            AND e.validity = 'stale'
        `;

        for (const m of affectedMoves) {
          await tx`
            UPDATE moves SET verification = 'stale', revision = revision + 1
            WHERE id = ${m.move_id} AND verification = 'passed'
          `;
          await tx`
            UPDATE projection_kanban SET column_id = 'VERIFY', updated_at = NOW()
            WHERE move_id = ${m.move_id} AND column_id != 'VERIFY'
          `;

          const eventId = crypto.randomUUID();
          await tx`
            INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, causation_id, correlation_id, data)
            VALUES (${eventId}, ${m.tenant_id}, ${caseId}, 'MoveVerificationInvalidated', NULL, NOW(),
                    ${eventId}, ${eventId},
                    ${tx.json({ move_id: m.move_id, reason: 'Supporting evidence became stale' })})
          `;
          await tx`INSERT INTO event_outbox (event_id) VALUES (${eventId})`;

          // Raise attention
          const attId = crypto.randomUUID();
          await tx`
            INSERT INTO projection_attention
              (id, case_id, move_id, priority, reason, action_required,
               actor_ids, blocking_impact, resolved, created_at, updated_at)
            VALUES (${attId}, ${caseId}, ${m.move_id}, 'high',
                    'Evidence staleness — re-verification needed',
                    'Review and re-verify move evidence',
                    '{}', 0, false, NOW(), NOW())
          `;
        }
      });
    }
  } catch (err) {
    console.error('[Worker] Evidence staleness check error:', err);
  }
}

// ── Boot ─────────────────────────────────────────────────────────

async function seedLastProcessedId(): Promise<void> {
  const sql = getDb();
  try {
    const [row] = await sql`
      SELECT COALESCE(MAX(id), 0)::int AS max_id FROM event_outbox
    `;
    lastProcessedId = row?.max_id ?? 0;
  } catch {
    // Table may not exist yet on first run
  }
}

async function main(): Promise<void> {
  const sql = getDb();

  console.log('[Worker] Starting background worker...');

  await seedLastProcessedId();
  console.log(`[Worker] Seeded lastProcessedId = ${lastProcessedId}`);

  console.log('[Worker] Building initial projections...');
  await rebuildAllProjections(sql);

  // Fast poll for event processing
  const pollTimer = setInterval(processOutbox, POLL_INTERVAL);

  // Slow maintenance (deadlines, cleanup) every 60s
  const maintenanceTimer = setInterval(periodicMaintenance, 60_000);

  // Evidence staleness check every 30s (spec §2.6)
  const stalenessTimer = setInterval(evidenceStalenessLoop, 30_000);

  console.log(`[Worker] Polling every ${POLL_INTERVAL}ms for events...`);

  const shutdown = () => {
    console.log('[Worker] Shutting down...');
    clearInterval(pollTimer);
    clearInterval(maintenanceTimer);
    clearInterval(stalenessTimer);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Worker] Fatal:', err);
  process.exit(1);
});
