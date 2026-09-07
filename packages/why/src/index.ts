import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

export interface WhyQuestion {
  caseId: string;
  question: string;
  targetMoveId?: string;
  targetState?: string;
  atTime?: string;
}

export interface CausalNode {
  eventId: string;
  eventType: string;
  occurredAt: string;
  actorId: string | null;
  summary: string;
  causedBy: string | null;
  data: Record<string, unknown>;
}

export interface WhyExplanation {
  question: string;
  answer: string;
  causalChain: CausalNode[];
  deterministic: boolean;
}

export class WhyEngine {
  constructor(private sql: Sql) {}

  async explain(q: WhyQuestion): Promise<WhyExplanation> {
    const parsed = this.parseQuestion(q.question);

    switch (parsed.type) {
      case 'blocked':
        return this.explainBlocked(q.caseId, parsed.moveId ?? q.targetMoveId!);
      case 'not_ready':
        return this.explainNotReady(q.caseId, parsed.moveId ?? q.targetMoveId!);
      case 'active':
        return this.explainActive(q.caseId, parsed.moveId ?? q.targetMoveId!);
      case 'done':
        return this.explainDone(q.caseId, parsed.moveId ?? q.targetMoveId!);
      case 'failed':
        return this.explainFailed(q.caseId, parsed.moveId ?? q.targetMoveId!);
      case 'decision_required':
        return this.explainDecisionRequired(q.caseId, parsed.moveId ?? q.targetMoveId!);
      case 'stale_evidence':
        return this.explainStaleEvidence(q.caseId, parsed.evidenceId!);
      case 'attention_required':
        return this.explainAttentionRequired(q.caseId, parsed.moveId ?? q.targetMoveId!);
      case 'this_agent':
        return this.explainAgentAssignment(q.caseId, parsed.moveId ?? q.targetMoveId!);
      case 'changed':
        return this.explainChange(q.caseId, parsed.moveId ?? q.targetMoveId!, q.atTime);
      default:
        return this.explainGeneral(q.caseId, q.question, q.targetMoveId);
    }
  }

  private parseQuestion(question: string): { type: string; moveId?: string; evidenceId?: string } {
    const lower = question.toLowerCase();
    if (lower.includes('blocked')) return { type: 'blocked' };
    if (lower.includes('not ready') || lower.includes('not_ready')) return { type: 'not_ready' };
    if (lower.includes('active') || lower.includes('running')) return { type: 'active' };
    if (lower.includes('done') || lower.includes('satisfied') || lower.includes('complete')) return { type: 'done' };
    if (lower.includes('failed')) return { type: 'failed' };
    if (lower.includes('decision')) return { type: 'decision_required' };
    if (lower.includes('stale')) return { type: 'stale_evidence' };
    if (lower.includes('attention') || lower.includes('require')) return { type: 'attention_required' };
    if (lower.includes('agent') || lower.includes('assigned')) return { type: 'this_agent' };
    if (lower.includes('changed') || lower.includes('change')) return { type: 'changed' };
    return { type: 'general' };
  }

  private async explainBlocked(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];
    const reasons: string[] = [];

    if (move.dependencies && move.dependencies.length > 0) {
      const deps = await this.sql`
        SELECT id, title, outcome, execution FROM moves
        WHERE id = ANY(${move.dependencies}) AND outcome != 'satisfied'
      `;
      for (const dep of deps) {
        reasons.push(`Depends on "${dep.title}" which is ${dep.outcome} (${dep.execution})`);
        const [depEvent] = await this.sql`
          SELECT * FROM events
          WHERE case_id = ${caseId} AND type = 'RelationAdded'
          AND data->>'source_id' = ${moveId} AND data->>'target_id' = ${dep.id}
          ORDER BY recorded_at DESC LIMIT 1
        `;
        if (depEvent) {
          chain.push({
            eventId: depEvent.id,
            eventType: depEvent.type,
            occurredAt: depEvent.occurred_at,
            actorId: depEvent.actor_id,
            summary: `Dependency added: "${move.title}" depends on "${dep.title}"`,
            causedBy: depEvent.causation_id,
            data: depEvent.data as Record<string, unknown>,
          });
        }
      }
    }

    const blockingDecisions = await this.sql`
      SELECT * FROM decisions
      WHERE case_id = ${caseId} AND ${moveId} = ANY(blocking_move_ids)
      AND state NOT IN ('decided', 'cancelled')
    `;
    for (const d of blockingDecisions) {
      reasons.push(`Blocked by pending decision: "${d.question}"`);
    }

    const violatedRules = await this.sql`
      SELECT * FROM rules
      WHERE case_id = ${caseId} AND evaluation_status = 'violated'
    `;
    for (const r of violatedRules) {
      reasons.push(`Rule violated: "${r.statement}"`);
    }

    const answer = reasons.length > 0
      ? `Move "${move.title}" is blocked because: ${reasons.join('; ')}`
      : `Move "${move.title}" appears blocked but no specific cause found in dependencies, decisions, or rules.`;

    return { question: `WHY is "${move.title}" blocked?`, answer, causalChain: chain, deterministic: true };
  }

  private async explainNotReady(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const reasons: string[] = [];
    const chain: CausalNode[] = [];

    if (move.preconditions && Array.isArray(move.preconditions)) {
      for (const pre of move.preconditions as unknown[]) {
        reasons.push(`Precondition not met: ${JSON.stringify(pre)}`);
      }
    }

    if (move.dependencies?.length > 0) {
      const unsatisfied = await this.sql`
        SELECT title, outcome FROM moves WHERE id = ANY(${move.dependencies}) AND outcome != 'satisfied'
      `;
      for (const dep of unsatisfied) {
        reasons.push(`Dependency "${dep.title}" not yet satisfied (${dep.outcome})`);
      }
    }

    const answer = reasons.length > 0
      ? `Move "${move.title}" is not ready because: ${reasons.join('; ')}`
      : `Move "${move.title}" has no explicit blockers — it may need manual activation.`;

    return { question: `WHY is "${move.title}" not ready?`, answer, causalChain: chain, deterministic: true };
  }

  private async explainActive(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const [activationEvent] = await this.sql`
      SELECT * FROM events WHERE case_id = ${caseId} AND type = 'MoveActivated'
      AND data->>'move_id' = ${moveId}
      ORDER BY recorded_at DESC LIMIT 1
    `;

    const chain: CausalNode[] = [];
    if (activationEvent) {
      chain.push({
        eventId: activationEvent.id,
        eventType: activationEvent.type,
        occurredAt: activationEvent.occurred_at,
        actorId: activationEvent.actor_id,
        summary: `Move activated by ${activationEvent.actor_id}`,
        causedBy: activationEvent.causation_id,
        data: activationEvent.data as Record<string, unknown>,
      });

      if (activationEvent.causation_id) {
        const [causingEvent] = await this.sql`
          SELECT * FROM events WHERE id = ${activationEvent.causation_id}::uuid
        `;
        if (causingEvent) {
          chain.push({
            eventId: causingEvent.id,
            eventType: causingEvent.type,
            occurredAt: causingEvent.occurred_at,
            actorId: causingEvent.actor_id,
            summary: `Caused by ${causingEvent.type}`,
            causedBy: causingEvent.causation_id,
            data: causingEvent.data as Record<string, unknown>,
          });
        }
      }
    }

    return {
      question: `WHY is "${move.title}" active?`,
      answer: activationEvent
        ? `Move "${move.title}" was activated at ${activationEvent.occurred_at} by actor ${activationEvent.actor_id}`
        : `Move "${move.title}" is in execution state "${move.execution}" but no activation event found.`,
      causalChain: chain,
      deterministic: true,
    };
  }

  private async explainDone(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const [satisfyEvent] = await this.sql`
      SELECT * FROM events WHERE case_id = ${caseId} AND type = 'MoveSatisfied'
      AND data->>'move_id' = ${moveId}
      ORDER BY recorded_at DESC LIMIT 1
    `;

    const evidence = await this.sql`
      SELECT * FROM evidence WHERE case_id = ${caseId}
      AND subject_refs @> ${JSON.stringify([{ id: moveId }])}::jsonb
    `;

    const chain: CausalNode[] = [];
    if (satisfyEvent) {
      chain.push({
        eventId: satisfyEvent.id,
        eventType: satisfyEvent.type,
        occurredAt: satisfyEvent.occurred_at,
        actorId: satisfyEvent.actor_id,
        summary: 'Move satisfied',
        causedBy: satisfyEvent.causation_id,
        data: satisfyEvent.data as Record<string, unknown>,
      });
    }

    return {
      question: `WHY is "${move.title}" done?`,
      answer: `Move "${move.title}" was satisfied${satisfyEvent ? ` at ${satisfyEvent.occurred_at}` : ''}. ${evidence.length} evidence items support completion.`,
      causalChain: chain,
      deterministic: true,
    };
  }

  private async explainFailed(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const failedAttempts = await this.sql`
      SELECT * FROM attempts WHERE move_id = ${moveId} AND state = 'failed' ORDER BY ended_at DESC
    `;

    const reasons = failedAttempts.map((a: Record<string, unknown>) => (a.failure_reason as string) || 'Unknown failure').join('; ');

    return {
      question: `WHY did "${move.title}" fail?`,
      answer: `Move "${move.title}" has ${failedAttempts.length} failed attempt(s). Reasons: ${reasons || 'No failure reasons recorded.'}`,
      causalChain: [],
      deterministic: true,
    };
  }

  private async explainDecisionRequired(caseId: string, moveId: string): Promise<WhyExplanation> {
    const decisions = await this.sql`
      SELECT * FROM decisions WHERE case_id = ${caseId} AND ${moveId} = ANY(blocking_move_ids) AND state NOT IN ('decided', 'cancelled')
    `;

    return {
      question: 'WHY is a decision required?',
      answer: decisions.length > 0
        ? `${decisions.length} pending decision(s) block this move: ${decisions.map((d: Record<string, unknown>) => `"${d.question}" (${d.state})`).join('; ')}`
        : 'No pending decisions found blocking this move.',
      causalChain: [],
      deterministic: true,
    };
  }

  private async explainStaleEvidence(caseId: string, evidenceId: string): Promise<WhyExplanation> {
    const [ev] = await this.sql`SELECT * FROM evidence WHERE id = ${evidenceId}`;
    if (!ev) throw new Error(`Evidence ${evidenceId} not found`);

    const [invalidationEvent] = await this.sql`
      SELECT * FROM events WHERE case_id = ${caseId} AND type = 'EvidenceInvalidated'
      AND data->>'evidence_id' = ${evidenceId}
      ORDER BY recorded_at DESC LIMIT 1
    `;

    return {
      question: 'WHY is evidence stale?',
      answer: invalidationEvent
        ? `Evidence was invalidated at ${invalidationEvent.occurred_at}: ${JSON.stringify(invalidationEvent.data)}`
        : ev.fresh_until && new Date(ev.fresh_until as string) < new Date()
          ? `Evidence expired at ${ev.fresh_until}`
          : `Evidence validity is "${ev.validity}"`,
      causalChain: invalidationEvent ? [{
        eventId: invalidationEvent.id,
        eventType: invalidationEvent.type,
        occurredAt: invalidationEvent.occurred_at,
        actorId: invalidationEvent.actor_id,
        summary: 'Evidence invalidated',
        causedBy: invalidationEvent.causation_id,
        data: invalidationEvent.data as Record<string, unknown>,
      }] : [],
      deterministic: true,
    };
  }

  private async explainAttentionRequired(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const attentionItems = await this.sql`
      SELECT * FROM projection_attention WHERE case_id = ${caseId} AND move_id = ${moveId} AND NOT resolved
    `;

    return {
      question: `WHY does "${move.title}" require attention?`,
      answer: `Attention state is "${move.attention}". ${attentionItems.length} attention item(s): ${attentionItems.map((a: Record<string, unknown>) => a.reason).join('; ')}`,
      causalChain: [],
      deterministic: true,
    };
  }

  private async explainAgentAssignment(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const actors = move.assigned_actor_ids?.length > 0
      ? await this.sql`SELECT * FROM actors WHERE id = ANY(${move.assigned_actor_ids})`
      : [];

    return {
      question: 'WHY is this agent assigned?',
      answer: actors.length > 0
        ? `Assigned to: ${actors.map((a: Record<string, unknown>) => `${a.display_name} (${a.class})`).join(', ')}. Required capabilities: ${JSON.stringify(move.required_capabilities)}`
        : 'No agents currently assigned.',
      causalChain: [],
      deterministic: true,
    };
  }

  private async explainChange(caseId: string, moveId: string, atTime?: string): Promise<WhyExplanation> {
    const events = atTime
      ? await this.sql`
          SELECT * FROM events WHERE case_id = ${caseId}
          AND (data->>'move_id' = ${moveId} OR data->>'target_id' = ${moveId})
          AND occurred_at <= ${atTime}
          ORDER BY recorded_at DESC LIMIT 10
        `
      : await this.sql`
          SELECT * FROM events WHERE case_id = ${caseId}
          AND (data->>'move_id' = ${moveId} OR data->>'target_id' = ${moveId})
          ORDER BY recorded_at DESC LIMIT 10
        `;

    return {
      question: 'WHY did this change?',
      answer: events.length > 0
        ? `Last ${events.length} events affecting this move: ${events.map((e: Record<string, unknown>) => `${e.type} at ${e.occurred_at}`).join('; ')}`
        : 'No change events found.',
      causalChain: events.map((e: Record<string, unknown>) => ({
        eventId: e.id as string,
        eventType: e.type as string,
        occurredAt: e.occurred_at as string,
        actorId: e.actor_id as string | null,
        summary: e.type as string,
        causedBy: e.causation_id as string | null,
        data: e.data as Record<string, unknown>,
      })),
      deterministic: true,
    };
  }

  private async explainGeneral(caseId: string, question: string, moveId?: string): Promise<WhyExplanation> {
    const events = moveId
      ? await this.sql`
          SELECT * FROM events WHERE case_id = ${caseId}
          AND (data->>'move_id' = ${moveId} OR data->>'target_id' = ${moveId})
          ORDER BY recorded_at DESC LIMIT 20
        `
      : await this.sql`
          SELECT * FROM events WHERE case_id = ${caseId}
          ORDER BY recorded_at DESC LIMIT 20
        `;

    return {
      question,
      answer: `Found ${events.length} relevant events for this case.`,
      causalChain: events.map((e: Record<string, unknown>) => ({
        eventId: e.id as string,
        eventType: e.type as string,
        occurredAt: e.occurred_at as string,
        actorId: e.actor_id as string | null,
        summary: e.type as string,
        causedBy: e.causation_id as string | null,
        data: e.data as Record<string, unknown>,
      })),
      deterministic: false,
    };
  }
}

export default WhyEngine;
