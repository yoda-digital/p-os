/**
 * External Interpretation Pipeline (SP6 §1.3)
 *
 * RawExternalEvent → Semantic Interpretation Proposal
 *   → Policy / Confidence Gate → Accepted Process Event OR Human Review Queue
 *
 * CRITICAL: External content is DATA, not commands.
 * The human review gate is non-negotiable for consequential actions.
 */

import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

// ── Types ────────────────────────────────────────────────────────────

export interface RawExternalEvent {
  integration_id: string;
  source_type: string; // github, email, slack, calendar, webhook
  event_type: string;  // e.g. 'pull_request.opened', 'email.received'
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface InterpretationProposal {
  /** What the external event maps to in process terms */
  process_event_type: string;
  /** e.g. 'MoveEvidence', 'DecisionInput', 'AttentionRaise' */
  target_type: 'evidence' | 'decision' | 'attention' | 'move_update' | 'event';
  /** The proposed process-level data */
  proposed_data: Record<string, unknown>;
  /** Interpretation confidence 0.0 - 1.0 */
  confidence: number;
  /** Risk assessment of auto-accepting this interpretation */
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  /** Human-readable explanation of the interpretation */
  explanation: string;
}

export interface PipelineResult {
  external_event_id: string;
  status: 'accepted' | 'review' | 'rejected';
  interpretation?: InterpretationProposal;
  process_event_id?: string;
  reason: string;
}

// ── Confidence / Policy Gate ────────────────────────────────────────

/** Thresholds for auto-acceptance by risk level */
const CONFIDENCE_THRESHOLDS: Record<string, number> = {
  low: 0.7,
  medium: 0.85,
  high: 0.95,
  critical: 1.1, // Never auto-accept critical — always human review
};

/** Actions that always require human review regardless of confidence */
const ALWAYS_REVIEW_ACTIONS = new Set([
  'decision',       // Never auto-close decisions
  'move_complete',  // Never auto-complete moves
  'budget_change',  // Never auto-modify budgets
  'access_change',  // Never auto-modify access
]);

// ── Pipeline Service ────────────────────────────────────────────────

export class ExternalPipeline {
  constructor(private sql: Sql) {}

  /**
   * Process a raw external event through the interpretation pipeline.
   */
  async process(raw: RawExternalEvent): Promise<PipelineResult> {
    // 1. Record the raw event
    const [externalEvent] = await this.sql`
      INSERT INTO external_events (integration_id, raw_payload, status)
      VALUES (${raw.integration_id}, ${this.sql.json(raw.payload)}, 'pending')
      RETURNING id
    `;
    const eventId = externalEvent.id as string;

    try {
      // 2. Interpret the event based on source type and event type
      const interpretation = this.interpret(raw);

      if (!interpretation) {
        // Unrecognized event — log and skip
        await this.sql`
          UPDATE external_events
          SET status = 'rejected',
              interpreted_as = ${this.sql.json({ reason: 'unrecognized_event_type' })}
          WHERE id = ${eventId}
        `;
        return {
          external_event_id: eventId,
          status: 'rejected',
          reason: `Unrecognized event type: ${raw.source_type}.${raw.event_type}`,
        };
      }

      // 3. Apply confidence / policy gate
      const gateResult = this.applyGate(interpretation);

      // 4. Update the external event record
      await this.sql`
        UPDATE external_events
        SET status = ${gateResult.status},
            interpreted_as = ${this.sql.json(interpretation)},
            confidence = ${interpretation.confidence}
        WHERE id = ${eventId}
      `;

      // 5. If accepted, create the process event
      if (gateResult.status === 'accepted') {
        const processEventId = await this.createProcessEvent(raw, interpretation);
        await this.sql`
          UPDATE external_events SET process_event_id = ${processEventId} WHERE id = ${eventId}
        `;

        return {
          external_event_id: eventId,
          status: 'accepted',
          interpretation,
          process_event_id: processEventId,
          reason: gateResult.reason,
        };
      }

      // 6. If review needed, the event stays in 'review' status for humans
      return {
        external_event_id: eventId,
        status: gateResult.status as 'review' | 'rejected',
        interpretation,
        reason: gateResult.reason,
      };
    } catch (err) {
      // Pipeline errors should not lose the raw event
      await this.sql`
        UPDATE external_events
        SET status = 'review',
            interpreted_as = ${this.sql.json({ error: String(err) })}
        WHERE id = ${eventId}
      `;

      return {
        external_event_id: eventId,
        status: 'review',
        reason: `Pipeline error: ${String(err)}`,
      };
    }
  }

  /**
   * Review a pending external event — accept or reject it with human authority.
   */
  async review(
    eventId: string,
    decision: 'accepted' | 'rejected',
    reviewerId: string,
    overrideData?: Record<string, unknown>,
  ): Promise<PipelineResult> {
    const [event] = await this.sql`
      SELECT * FROM external_events WHERE id = ${eventId} AND status IN ('pending', 'review')
    `;
    if (!event) {
      return { external_event_id: eventId, status: 'rejected', reason: 'Event not found or already processed' };
    }

    await this.sql`
      UPDATE external_events
      SET status = ${decision}, reviewed_by = ${reviewerId}
      WHERE id = ${eventId}
    `;

    if (decision === 'accepted') {
      const interpretation = (event.interpreted_as ?? {}) as InterpretationProposal;
      if (overrideData) {
        Object.assign(interpretation.proposed_data ?? {}, overrideData);
      }

      const raw: RawExternalEvent = {
        integration_id: event.integration_id as string,
        source_type: (event.raw_payload as Record<string, unknown>)?.source_type as string ?? 'unknown',
        event_type: (event.raw_payload as Record<string, unknown>)?.event_type as string ?? 'unknown',
        payload: event.raw_payload as Record<string, unknown>,
      };

      const processEventId = await this.createProcessEvent(raw, interpretation);
      await this.sql`
        UPDATE external_events SET process_event_id = ${processEventId} WHERE id = ${eventId}
      `;

      return {
        external_event_id: eventId,
        status: 'accepted',
        interpretation,
        process_event_id: processEventId,
        reason: `Accepted by human reviewer ${reviewerId}`,
      };
    }

    return {
      external_event_id: eventId,
      status: 'rejected',
      reason: `Rejected by human reviewer ${reviewerId}`,
    };
  }

  /**
   * List external events pending review.
   */
  async listPendingReview(integrationId?: string, limit = 50): Promise<unknown[]> {
    if (integrationId) {
      return this.sql`
        SELECT e.*, i.name AS integration_name, i.type AS integration_type
        FROM external_events e
        JOIN integrations i ON i.id = e.integration_id
        WHERE e.status IN ('pending', 'review')
          AND e.integration_id = ${integrationId}
        ORDER BY e.created_at DESC
        LIMIT ${limit}
      `;
    }
    return this.sql`
      SELECT e.*, i.name AS integration_name, i.type AS integration_type
      FROM external_events e
      JOIN integrations i ON i.id = e.integration_id
      WHERE e.status IN ('pending', 'review')
      ORDER BY e.created_at DESC
      LIMIT ${limit}
    `;
  }

  // ── Interpretation Logic ──────────────────────────────────────────

  private interpret(raw: RawExternalEvent): InterpretationProposal | null {
    const key = `${raw.source_type}.${raw.event_type}`;

    // GitHub events
    if (raw.source_type === 'github') return this.interpretGitHub(raw);
    if (raw.source_type === 'email') return this.interpretEmail(raw);
    if (raw.source_type === 'slack') return this.interpretSlack(raw);
    if (raw.source_type === 'calendar') return this.interpretCalendar(raw);

    // Generic webhook — low confidence, always review
    if (raw.source_type === 'webhook') {
      return {
        process_event_type: 'ExternalWebhookReceived',
        target_type: 'event',
        proposed_data: { source: 'webhook', payload: raw.payload },
        confidence: 0.3,
        risk_level: 'medium',
        explanation: `Generic webhook received: ${raw.event_type}`,
      };
    }

    return null;
  }

  private interpretGitHub(raw: RawExternalEvent): InterpretationProposal | null {
    const p = raw.payload;

    switch (raw.event_type) {
      case 'pull_request.opened':
      case 'pull_request.merged':
      case 'pull_request.closed':
        return {
          process_event_type: 'PRStateChanged',
          target_type: 'evidence',
          proposed_data: {
            pr_number: p.number,
            pr_title: p.title,
            pr_state: raw.event_type.split('.')[1],
            pr_url: p.html_url ?? p.url,
            author: (p.user as Record<string, unknown>)?.login,
            repository: (p.repository as Record<string, unknown>)?.full_name,
          },
          confidence: 0.9,
          risk_level: 'low',
          explanation: `GitHub PR #${p.number} ${raw.event_type.split('.')[1]}: ${p.title}`,
        };

      case 'push':
        return {
          process_event_type: 'CommitCreated',
          target_type: 'evidence',
          proposed_data: {
            ref: p.ref,
            commits: p.commits,
            pusher: (p.pusher as Record<string, unknown>)?.name,
            repository: (p.repository as Record<string, unknown>)?.full_name,
          },
          confidence: 0.95,
          risk_level: 'low',
          explanation: `Push to ${p.ref} with ${Array.isArray(p.commits) ? p.commits.length : '?'} commits`,
        };

      case 'pull_request_review.submitted':
        return {
          process_event_type: 'ReviewSubmitted',
          target_type: 'decision',
          proposed_data: {
            review_state: (p.review as Record<string, unknown>)?.state,
            reviewer: ((p.review as Record<string, unknown>)?.user as Record<string, unknown>)?.login,
            pr_number: (p.pull_request as Record<string, unknown>)?.number,
            body: (p.review as Record<string, unknown>)?.body,
          },
          confidence: 0.85,
          risk_level: 'medium',
          explanation: `Code review submitted on PR #${(p.pull_request as Record<string, unknown>)?.number}`,
        };

      case 'issues.opened':
      case 'issues.closed':
        return {
          process_event_type: 'IssueStateChanged',
          target_type: 'attention',
          proposed_data: {
            issue_number: (p.issue as Record<string, unknown>)?.number,
            issue_title: (p.issue as Record<string, unknown>)?.title,
            issue_state: raw.event_type.split('.')[1],
            labels: (p.issue as Record<string, unknown>)?.labels,
          },
          confidence: 0.85,
          risk_level: 'low',
          explanation: `Issue #${(p.issue as Record<string, unknown>)?.number} ${raw.event_type.split('.')[1]}`,
        };

      default:
        return null;
    }
  }

  private interpretEmail(raw: RawExternalEvent): InterpretationProposal | null {
    const p = raw.payload;
    // Email interpretation always goes to review — never auto-accept
    return {
      process_event_type: 'EmailReceived',
      target_type: 'event',
      proposed_data: {
        from: p.from,
        subject: p.subject,
        body_preview: typeof p.body === 'string' ? p.body.slice(0, 500) : undefined,
        received_at: p.received_at ?? new Date().toISOString(),
      },
      confidence: 0.4, // Always low — email intent is ambiguous
      risk_level: 'high',
      explanation: `Email from ${p.from}: "${p.subject}"`,
    };
  }

  private interpretSlack(raw: RawExternalEvent): InterpretationProposal | null {
    const p = raw.payload;

    if (raw.event_type === 'slash_command') {
      return {
        process_event_type: 'SlackCommand',
        target_type: 'event',
        proposed_data: {
          command: p.command,
          text: p.text,
          user_id: p.user_id,
          channel_id: p.channel_id,
        },
        confidence: 0.8,
        risk_level: 'medium',
        explanation: `Slack command: ${p.command} ${p.text}`,
      };
    }

    if (raw.event_type === 'message') {
      return {
        process_event_type: 'SlackMessage',
        target_type: 'event',
        proposed_data: {
          text: p.text,
          user: p.user,
          channel: p.channel,
          ts: p.ts,
        },
        confidence: 0.3, // Messages are ambiguous
        risk_level: 'medium',
        explanation: `Slack message in ${p.channel}`,
      };
    }

    return null;
  }

  private interpretCalendar(raw: RawExternalEvent): InterpretationProposal | null {
    const p = raw.payload;

    return {
      process_event_type: 'CalendarEventChanged',
      target_type: 'attention',
      proposed_data: {
        event_id: p.event_id,
        title: p.title,
        start: p.start,
        end: p.end,
        change_type: raw.event_type,
      },
      confidence: 0.75,
      risk_level: 'low',
      explanation: `Calendar event ${raw.event_type}: "${p.title}"`,
    };
  }

  // ── Gate Logic ────────────────────────────────────────────────────

  private applyGate(interpretation: InterpretationProposal): { status: string; reason: string } {
    // Check if the target action always requires human review
    if (ALWAYS_REVIEW_ACTIONS.has(interpretation.target_type)) {
      return {
        status: 'review',
        reason: `Action type "${interpretation.target_type}" always requires human review`,
      };
    }

    const threshold = CONFIDENCE_THRESHOLDS[interpretation.risk_level] ?? 0.9;

    if (interpretation.confidence >= threshold) {
      return {
        status: 'accepted',
        reason: `Confidence ${interpretation.confidence.toFixed(2)} >= threshold ${threshold} for risk "${interpretation.risk_level}"`,
      };
    }

    return {
      status: 'review',
      reason: `Confidence ${interpretation.confidence.toFixed(2)} < threshold ${threshold} for risk "${interpretation.risk_level}" — needs human review`,
    };
  }

  // ── Process Event Creation ────────────────────────────────────────

  private async createProcessEvent(
    raw: RawExternalEvent,
    interpretation: InterpretationProposal,
  ): Promise<string> {
    // Get the organization from the integration
    const [integration] = await this.sql`
      SELECT organization_id FROM integrations WHERE id = ${raw.integration_id}
    `;
    const orgId = integration?.organization_id as string ?? '00000000-0000-0000-0000-000000000000';

    const eventId = crypto.randomUUID();
    await this.sql`
      INSERT INTO events (
        id, tenant_id, case_id, type, actor_id, occurred_at, recorded_at,
        causation_id, correlation_id, case_sequence, data
      ) VALUES (
        ${eventId},
        ${orgId},
        ${(interpretation.proposed_data.case_id as string) ?? null},
        ${interpretation.process_event_type},
        ${'system:external-pipeline'},
        NOW(), NOW(),
        ${eventId}, ${eventId}, 0,
        ${this.sql.json({
          source: raw.source_type,
          event_type: raw.event_type,
          integration_id: raw.integration_id,
          interpretation: interpretation.proposed_data,
          confidence: interpretation.confidence,
        })}
      )
    `;

    return eventId;
  }
}
