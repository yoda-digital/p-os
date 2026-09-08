import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

export type WhyQuestionType =
  | 'blocked'
  | 'not_ready'
  | 'active'
  | 'done'
  | 'failed'
  | 'this_agent'
  | 'this_model'
  | 'this_task'
  | 'changed'
  | 'requires_me';

export interface WhyQuestion {
  caseId: string;
  question: string;
  questionType?: WhyQuestionType;
  targetMoveId?: string;
  targetId?: string;
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
  questionType: WhyQuestionType | 'general';
  answer: string;
  causalChain: CausalNode[];
  deterministic: boolean;
}

export class WhyEngine {
  constructor(private sql: Sql) {}

  async explain(q: WhyQuestion): Promise<WhyExplanation> {
    const parsed = q.questionType
      ? { type: q.questionType }
      : this.parseQuestion(q.question);
    const moveId = q.targetMoveId ?? q.targetId;

    switch (parsed.type) {
      case 'blocked':
        return this.explainBlocked(q.caseId, moveId!);
      case 'not_ready':
        return this.explainNotReady(q.caseId, moveId!);
      case 'active':
        return this.explainActive(q.caseId, moveId!);
      case 'done':
        return this.explainDone(q.caseId, moveId!);
      case 'failed':
        return this.explainFailed(q.caseId, moveId!);
      case 'this_agent':
        return this.explainThisAgent(q.caseId, moveId!);
      case 'this_model':
        return this.explainThisModel(q.caseId, moveId!);
      case 'this_task':
        return this.explainThisTask(q.caseId, moveId!);
      case 'changed':
        return this.explainChanged(q.caseId, moveId!, q.atTime);
      case 'requires_me':
        return this.explainRequiresMe(q.caseId, moveId!);
      default:
        return this.explainGeneral(q.caseId, q.question, moveId);
    }
  }

  private parseQuestion(question: string): { type: WhyQuestionType | 'general' } {
    const lower = question.toLowerCase();
    if (lower.includes('blocked')) return { type: 'blocked' };
    if (lower.includes('not ready') || lower.includes('not_ready')) return { type: 'not_ready' };
    if (lower.includes('active') || lower.includes('running')) return { type: 'active' };
    if (lower.includes('done') || lower.includes('satisfied') || lower.includes('complete')) return { type: 'done' };
    if (lower.includes('failed') || lower.includes('fail')) return { type: 'failed' };
    if (lower.includes('this agent') || lower.includes('assigned') || lower.includes('this_agent')) return { type: 'this_agent' };
    if (lower.includes('this model') || lower.includes('model choice') || lower.includes('this_model')) return { type: 'this_model' };
    if (lower.includes('this task') || lower.includes('this_task') || lower.includes('decompos')) return { type: 'this_task' };
    if (lower.includes('changed') || lower.includes('change') || lower.includes('differ')) return { type: 'changed' };
    if (lower.includes('require') || lower.includes('attention') || lower.includes('requires_me') || lower.includes('my involvement')) return { type: 'requires_me' };
    return { type: 'general' };
  }

  // ---- 1. WHY blocked? ----
  private async explainBlocked(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];
    const reasons: string[] = [];

    // Check unsatisfied dependencies
    if (move.dependencies && (move.dependencies as string[]).length > 0) {
      const deps = await this.sql`
        SELECT id, title, outcome, execution FROM moves
        WHERE id = ANY(${move.dependencies as string[]}) AND outcome != 'satisfied'
      `;
      for (const dep of deps) {
        reasons.push(`Depends on "${dep.title}" which is ${dep.outcome} (${dep.execution})`);
        const [depEvent] = await this.sql`
          SELECT * FROM events
          WHERE case_id = ${caseId} AND type = 'RelationAdded'
          AND data->>'source_id' = ${moveId} AND data->>'target_id' = ${dep.id as string}
          ORDER BY recorded_at DESC LIMIT 1
        `;
        if (depEvent) {
          chain.push(this.toNode(depEvent, `Dependency added: "${move.title}" depends on "${dep.title}"`));
        }
      }
    }

    // Check pending decisions
    const blockingDecisions = await this.sql`
      SELECT * FROM decisions
      WHERE case_id = ${caseId} AND ${moveId} = ANY(blocking_move_ids)
      AND state NOT IN ('decided', 'cancelled')
    `;
    for (const d of blockingDecisions) {
      reasons.push(`Blocked by pending decision: "${d.question}" (${d.state})`);
      chain.push({
        eventId: d.id as string,
        eventType: 'DecisionPending',
        occurredAt: (d.created_at as Date).toISOString(),
        actorId: d.created_by as string | null,
        summary: `Pending decision: "${d.question}"`,
        causedBy: null,
        data: { decision_id: d.id, state: d.state },
      });
    }

    // Check violated rules
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

    return { question: `WHY is "${move.title}" blocked?`, questionType: 'blocked', answer, causalChain: chain, deterministic: true };
  }

  // ---- 2. WHY not_ready? ----
  private async explainNotReady(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];
    const reasons: string[] = [];

    // Check preconditions
    if (move.preconditions && Array.isArray(move.preconditions)) {
      for (const pre of move.preconditions as unknown[]) {
        reasons.push(`Precondition not met: ${JSON.stringify(pre)}`);
      }
    }

    // Check unsatisfied dependencies
    if (move.dependencies && (move.dependencies as string[]).length > 0) {
      const unsatisfied = await this.sql`
        SELECT id, title, outcome FROM moves WHERE id = ANY(${move.dependencies as string[]}) AND outcome != 'satisfied'
      `;
      for (const dep of unsatisfied) {
        reasons.push(`Dependency "${dep.title}" not yet satisfied (${dep.outcome})`);
        const events = await this.sql`
          SELECT * FROM events WHERE case_id = ${caseId} AND data->>'move_id' = ${dep.id as string}
          ORDER BY recorded_at DESC LIMIT 1
        `;
        if (events.length > 0) {
          chain.push(this.toNode(events[0]!, `Dependency "${dep.title}" last event: ${events[0]!.type}`));
        }
      }
    }

    // Check pending decisions blocking readiness
    const blockingDecisions = await this.sql`
      SELECT * FROM decisions
      WHERE case_id = ${caseId} AND ${moveId} = ANY(blocking_move_ids) AND state NOT IN ('decided', 'cancelled')
    `;
    for (const d of blockingDecisions) {
      reasons.push(`Decision "${d.question}" must be resolved first`);
    }

    const answer = reasons.length > 0
      ? `Move "${move.title}" is not ready because: ${reasons.join('; ')}`
      : `Move "${move.title}" has no explicit blockers -- it may need manual activation.`;

    return { question: `WHY is "${move.title}" not ready?`, questionType: 'not_ready', answer, causalChain: chain, deterministic: true };
  }

  // ---- 3. WHY active? ----
  private async explainActive(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];

    // Find activation event
    const [activationEvent] = await this.sql`
      SELECT * FROM events WHERE case_id = ${caseId} AND type = 'MoveActivated'
      AND (data->>'move_id' = ${moveId} OR data->>'id' = ${moveId})
      ORDER BY recorded_at DESC LIMIT 1
    `;

    if (activationEvent) {
      chain.push(this.toNode(activationEvent, `Move activated by ${activationEvent.actor_id ?? 'system'}`));

      // Trace causation chain up
      if (activationEvent.causation_id) {
        const causalEvents = await this.traceCausation(activationEvent.causation_id as string, 5);
        chain.push(...causalEvents);
      }
    }

    // Find the attempt that started it
    const [activeAttempt] = await this.sql`
      SELECT * FROM attempts WHERE move_id = ${moveId} AND state IN ('running', 'pending')
      ORDER BY started_at DESC LIMIT 1
    `;

    if (activeAttempt) {
      chain.push({
        eventId: activeAttempt.id as string,
        eventType: 'AttemptStarted',
        occurredAt: (activeAttempt.started_at as Date ?? activeAttempt.created_at as Date).toISOString(),
        actorId: activeAttempt.executor_id as string | null,
        summary: `Attempt started with strategy "${activeAttempt.strategy}", model: ${activeAttempt.model ?? 'default'}`,
        causedBy: null,
        data: { attempt_id: activeAttempt.id, strategy: activeAttempt.strategy, model: activeAttempt.model },
      });
    }

    return {
      question: `WHY is "${move.title}" active?`,
      questionType: 'active',
      answer: activationEvent
        ? `Move "${move.title}" was activated at ${(activationEvent.occurred_at as Date).toISOString()} by ${activationEvent.actor_id ?? 'system'}.${activeAttempt ? ` Current attempt uses strategy "${activeAttempt.strategy}".` : ''}`
        : `Move "${move.title}" is in execution state "${move.execution}" but no activation event found.`,
      causalChain: chain,
      deterministic: true,
    };
  }

  // ---- 4. WHY done? ----
  private async explainDone(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];

    // Find satisfaction event
    const [satisfyEvent] = await this.sql`
      SELECT * FROM events WHERE case_id = ${caseId} AND type = 'MoveSatisfied'
      AND (data->>'move_id' = ${moveId} OR data->>'id' = ${moveId})
      ORDER BY recorded_at DESC LIMIT 1
    `;

    if (satisfyEvent) {
      chain.push(this.toNode(satisfyEvent, 'Move satisfied'));
    }

    // Find supporting evidence
    const evidence = await this.sql`
      SELECT * FROM evidence WHERE case_id = ${caseId} AND validity = 'valid'
    `;
    const relevantEvidence = evidence.filter((e: Record<string, unknown>) => {
      const refs = e.subject_refs as Array<{ id: string }> | null;
      return refs?.some(r => r.id === moveId);
    });

    for (const ev of relevantEvidence) {
      chain.push({
        eventId: ev.id as string,
        eventType: 'EvidenceSupporting',
        occurredAt: (ev.created_at as Date).toISOString(),
        actorId: ev.created_by as string | null,
        summary: `Evidence: ${ev.type} - ${(ev.description as string || '').slice(0, 100)}`,
        causedBy: null,
        data: { evidence_id: ev.id, type: ev.type, validity: ev.validity },
      });
    }

    // Find the successful attempt
    const [successAttempt] = await this.sql`
      SELECT * FROM attempts WHERE move_id = ${moveId} AND state = 'succeeded'
      ORDER BY ended_at DESC LIMIT 1
    `;

    return {
      question: `WHY is "${move.title}" done?`,
      questionType: 'done',
      answer: `Move "${move.title}" was satisfied${satisfyEvent ? ` at ${(satisfyEvent.occurred_at as Date).toISOString()}` : ''}. ${relevantEvidence.length} evidence item(s) support completion.${successAttempt ? ` Succeeded via strategy "${successAttempt.strategy}".` : ''}`,
      causalChain: chain,
      deterministic: true,
    };
  }

  // ---- 5. WHY failed? ----
  private async explainFailed(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];

    // Get all failed attempts with details
    const failedAttempts = await this.sql`
      SELECT * FROM attempts WHERE move_id = ${moveId} AND state = 'failed'
      ORDER BY ended_at DESC
    `;

    for (const att of failedAttempts) {
      chain.push({
        eventId: att.id as string,
        eventType: 'AttemptFailed',
        occurredAt: (att.ended_at as Date ?? att.created_at as Date).toISOString(),
        actorId: att.executor_id as string | null,
        summary: `Attempt failed: ${att.failure_reason ?? 'No reason recorded'}. Strategy: "${att.strategy}", model: ${att.model ?? 'default'}`,
        causedBy: null,
        data: { attempt_id: att.id, strategy: att.strategy, model: att.model, failure_reason: att.failure_reason },
      });
    }

    // Check if there is a pattern in failures
    const strategies = failedAttempts.map((a: Record<string, unknown>) => a.strategy);
    const uniqueStrategies = [...new Set(strategies)];
    const failureReasons = failedAttempts.map((a: Record<string, unknown>) => a.failure_reason).filter(Boolean);

    const answer = failedAttempts.length > 0
      ? `Move "${move.title}" has ${failedAttempts.length} failed attempt(s). Strategies tried: ${uniqueStrategies.join(', ')}. Failure reasons: ${failureReasons.join('; ') || 'No reasons recorded.'}`
      : `Move "${move.title}" outcome is "${move.outcome}" but no failed attempts recorded.`;

    return { question: `WHY did "${move.title}" fail?`, questionType: 'failed', answer, causalChain: chain, deterministic: true };
  }

  // ---- 6. WHY this_agent? ----
  private async explainThisAgent(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];

    // Get assigned actors
    const assignedIds = (move.assigned_actor_ids as string[]) ?? [];
    const actors = assignedIds.length > 0
      ? await this.sql`SELECT * FROM actors WHERE id = ANY(${assignedIds})`
      : [];

    // Find assignment events
    const assignEvents = await this.sql`
      SELECT * FROM events WHERE case_id = ${caseId}
      AND type IN ('MoveAssigned', 'MoveUpdated', 'AttemptCreated')
      AND (data->>'move_id' = ${moveId} OR data->>'id' = ${moveId})
      ORDER BY recorded_at ASC
    `;

    for (const evt of assignEvents) {
      chain.push(this.toNode(evt, `${evt.type}: ${this.summarizeData(evt.data as Record<string, unknown>)}`));
    }

    // Get the latest attempt to see executor
    const [latestAttempt] = await this.sql`
      SELECT * FROM attempts WHERE move_id = ${moveId} ORDER BY created_at DESC LIMIT 1
    `;

    const requiredCaps = (move.required_capabilities as unknown[]) ?? [];
    const actorDescriptions = actors.map((a: Record<string, unknown>) =>
      `${a.display_name} (${a.class}, capabilities: ${JSON.stringify(a.capabilities)})`
    ).join('; ');

    return {
      question: `WHY is this agent assigned to "${move.title}"?`,
      questionType: 'this_agent',
      answer: actors.length > 0
        ? `Assigned to: ${actorDescriptions}. Required capabilities: ${JSON.stringify(requiredCaps)}.${latestAttempt ? ` Latest attempt executor: ${latestAttempt.executor_id ?? 'unassigned'}.` : ''}`
        : `No agents currently assigned to "${move.title}". Required capabilities: ${JSON.stringify(requiredCaps)}.`,
      causalChain: chain,
      deterministic: true,
    };
  }

  // ---- 7. WHY this_model? ----
  private async explainThisModel(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];

    // Get attempts to see model choices
    const attempts = await this.sql`
      SELECT * FROM attempts WHERE move_id = ${moveId} ORDER BY created_at DESC LIMIT 10
    `;

    for (const att of attempts) {
      chain.push({
        eventId: att.id as string,
        eventType: 'AttemptModelChoice',
        occurredAt: (att.created_at as Date).toISOString(),
        actorId: att.executor_id as string | null,
        summary: `Attempt: model=${att.model ?? 'default'}, strategy="${att.strategy}", effort=${att.effort ?? 'default'}, state=${att.state}`,
        causedBy: null,
        data: { attempt_id: att.id, model: att.model, strategy: att.strategy, effort: att.effort, state: att.state },
      });
    }

    // Check if there's a governance autonomy profile that constrains model choice
    const [autonomy] = await this.sql`
      SELECT * FROM autonomy_profiles WHERE case_id = ${caseId}
    `.catch(() => [undefined]);

    const latestModel = attempts.length > 0 ? (attempts[0]!.model ?? 'default') : 'none';
    const modelHistory = attempts.map((a: Record<string, unknown>) => a.model ?? 'default');
    const uniqueModels = [...new Set(modelHistory)];

    return {
      question: `WHY was this model chosen for "${move.title}"?`,
      questionType: 'this_model',
      answer: `Current model: ${latestModel}. Models used across ${attempts.length} attempt(s): ${uniqueModels.join(', ')}.${autonomy ? ` Autonomy level: ${autonomy.level}.` : ''} Model selection is based on strategy, effort level, and executor capabilities.`,
      causalChain: chain,
      deterministic: true,
    };
  }

  // ---- 8. WHY this_task? (Intent -> Move decomposition chain) ----
  private async explainThisTask(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];

    // Find the creation event
    const [createEvent] = await this.sql`
      SELECT * FROM events WHERE case_id = ${caseId} AND type = 'MoveCreated'
      AND (data->>'id' = ${moveId} OR data->>'move_id' = ${moveId})
      ORDER BY recorded_at ASC LIMIT 1
    `;

    if (createEvent) {
      chain.push(this.toNode(createEvent, `Move "${move.title}" created`));

      // Trace causation to find the intent or command that spawned it
      if (createEvent.causation_id) {
        const causalEvents = await this.traceCausation(createEvent.causation_id as string, 10);
        chain.push(...causalEvents);
      }
    }

    // Find the intents this move is related to
    const intents = await this.sql`
      SELECT i.* FROM intents i
      JOIN relations r ON r.target_ref->>'id' = i.id::text
      WHERE r.source_ref->>'id' = ${moveId} AND r.type = 'IMPLEMENTS'
      AND i.case_id = ${caseId}
    `.catch(() => [] as Record<string, unknown>[]);

    for (const intent of intents) {
      chain.push({
        eventId: intent.id as string,
        eventType: 'IntentSource',
        occurredAt: (intent.created_at as Date).toISOString(),
        actorId: null,
        summary: `Implements intent: "${intent.statement}" (${intent.class})`,
        causedBy: null,
        data: { intent_id: intent.id, class: intent.class, statement: intent.statement },
      });
    }

    // Check parent move (if this is a sub-move)
    if (move.parent_move_id) {
      const [parent] = await this.sql`SELECT id, title FROM moves WHERE id = ${move.parent_move_id}`;
      if (parent) {
        chain.push({
          eventId: parent.id as string,
          eventType: 'ParentMove',
          occurredAt: new Date().toISOString(),
          actorId: null,
          summary: `Sub-move of "${parent.title}"`,
          causedBy: null,
          data: { parent_move_id: parent.id, parent_title: parent.title },
        });
      }
    }

    return {
      question: `WHY does this task "${move.title}" exist?`,
      questionType: 'this_task',
      answer: `Move "${move.title}" was created${createEvent ? ` at ${(createEvent.occurred_at as Date).toISOString()}` : ''}.${intents.length > 0 ? ` Implements ${intents.length} intent(s): ${intents.map((i: Record<string, unknown>) => `"${i.statement}"`).join(', ')}.` : ''}${move.parent_move_id ? ' It is a sub-move decomposed from a parent task.' : ''}`,
      causalChain: chain,
      deterministic: true,
    };
  }

  // ---- 9. WHY changed? ----
  private async explainChanged(caseId: string, moveId: string, atTime?: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];

    // Get events affecting this move
    const events = atTime
      ? await this.sql`
          SELECT * FROM events WHERE case_id = ${caseId}
          AND (data->>'move_id' = ${moveId} OR data->>'id' = ${moveId} OR data->>'target_id' = ${moveId})
          AND occurred_at <= ${atTime}
          ORDER BY recorded_at DESC LIMIT 20
        `
      : await this.sql`
          SELECT * FROM events WHERE case_id = ${caseId}
          AND (data->>'move_id' = ${moveId} OR data->>'id' = ${moveId} OR data->>'target_id' = ${moveId})
          ORDER BY recorded_at DESC LIMIT 20
        `;

    for (const evt of events) {
      chain.push(this.toNode(evt, `${evt.type}: ${this.summarizeData(evt.data as Record<string, unknown>)}`));
    }

    // Also get steering commands that affected this move
    const steeringCommands = await this.sql`
      SELECT * FROM steering_commands WHERE move_id = ${moveId} AND case_id = ${caseId}
      ORDER BY issued_at DESC LIMIT 5
    `;

    for (const sc of steeringCommands) {
      chain.push({
        eventId: sc.id as string,
        eventType: 'SteeringApplied',
        occurredAt: (sc.issued_at as Date).toISOString(),
        actorId: sc.issued_by as string | null,
        summary: `Steering: ${sc.class} - "${(sc.instruction as string).slice(0, 100)}"`,
        causedBy: null,
        data: { steering_id: sc.id, class: sc.class, state: sc.state },
      });
    }

    return {
      question: `WHY did "${move.title}" change?`,
      questionType: 'changed',
      answer: events.length > 0
        ? `${events.length} event(s) affected "${move.title}". Most recent: ${events[0]!.type} at ${(events[0]!.occurred_at as Date).toISOString()}.${steeringCommands.length > 0 ? ` ${steeringCommands.length} steering command(s) applied.` : ''}`
        : 'No change events found.',
      causalChain: chain,
      deterministic: true,
    };
  }

  // ---- 10. WHY requires_me? ----
  private async explainRequiresMe(caseId: string, moveId: string): Promise<WhyExplanation> {
    const [move] = await this.sql`SELECT * FROM moves WHERE id = ${moveId} AND case_id = ${caseId}`;
    if (!move) throw new Error(`Move ${moveId} not found`);

    const chain: CausalNode[] = [];
    const reasons: string[] = [];

    // Check attention items
    const attentionItems = await this.sql`
      SELECT * FROM projection_attention WHERE case_id = ${caseId} AND move_id = ${moveId} AND NOT resolved
    `;
    for (const att of attentionItems) {
      reasons.push(`Attention item: ${att.reason} (priority: ${att.priority})`);
      chain.push({
        eventId: att.id as string,
        eventType: 'AttentionRequired',
        occurredAt: (att.created_at as Date).toISOString(),
        actorId: null,
        summary: `Attention: ${att.reason}`,
        causedBy: null,
        data: { attention_id: att.id, priority: att.priority, reason: att.reason },
      });
    }

    // Check pending decisions that require human input
    const pendingDecisions = await this.sql`
      SELECT * FROM decisions WHERE case_id = ${caseId} AND ${moveId} = ANY(blocking_move_ids)
      AND state IN ('requested', 'in_review')
    `;
    for (const d of pendingDecisions) {
      reasons.push(`Decision required: "${d.question}"`);
    }

    // Check governance: does the autonomy level require human approval?
    const [autonomy] = await this.sql`
      SELECT * FROM autonomy_profiles WHERE case_id = ${caseId}
    `.catch(() => [undefined]);

    if (autonomy) {
      const requiresApproval = (autonomy.require_human_approval_for as string[]) ?? [];
      if (requiresApproval.length > 0) {
        reasons.push(`Governance requires human approval for: ${requiresApproval.join(', ')}`);
      }
      if (autonomy.level === 'supervised') {
        reasons.push('Case is in supervised autonomy mode -- human oversight required for all actions');
      }
    }

    // Check if move attention state is set
    if (move.attention && move.attention !== 'none') {
      reasons.push(`Move attention state: ${move.attention}`);
    }

    const answer = reasons.length > 0
      ? `"${move.title}" requires your involvement because: ${reasons.join('; ')}`
      : `"${move.title}" does not currently have explicit human-required flags. It may be handled autonomously.`;

    return {
      question: `WHY does "${move.title}" require me?`,
      questionType: 'requires_me',
      answer,
      causalChain: chain,
      deterministic: true,
    };
  }

  // ---- General fallback ----
  private async explainGeneral(caseId: string, question: string, moveId?: string): Promise<WhyExplanation> {
    const events = moveId
      ? await this.sql`
          SELECT * FROM events WHERE case_id = ${caseId}
          AND (data->>'move_id' = ${moveId} OR data->>'id' = ${moveId} OR data->>'target_id' = ${moveId})
          ORDER BY recorded_at DESC LIMIT 20
        `
      : await this.sql`
          SELECT * FROM events WHERE case_id = ${caseId}
          ORDER BY recorded_at DESC LIMIT 20
        `;

    return {
      question,
      questionType: 'general',
      answer: `Found ${events.length} relevant events for this case.`,
      causalChain: events.map((e: Record<string, unknown>) => this.toNode(e, e.type as string)),
      deterministic: false,
    };
  }

  // ---- Helpers ----

  private toNode(evt: Record<string, unknown>, summary: string): CausalNode {
    return {
      eventId: evt.id as string,
      eventType: evt.type as string,
      occurredAt: evt.occurred_at instanceof Date ? evt.occurred_at.toISOString() : (evt.occurred_at as string),
      actorId: evt.actor_id as string | null,
      summary,
      causedBy: evt.causation_id as string | null,
      data: (evt.data ?? {}) as Record<string, unknown>,
    };
  }

  private async traceCausation(causationId: string, maxDepth: number): Promise<CausalNode[]> {
    const chain: CausalNode[] = [];
    let currentId: string | null = causationId;
    let depth = 0;

    while (currentId && depth < maxDepth) {
      const [evt] = await this.sql`SELECT * FROM events WHERE id = ${currentId}::uuid`.catch(() => [undefined]);
      if (!evt) break;
      chain.push(this.toNode(evt, `Caused by ${evt.type}`));
      currentId = evt.causation_id as string | null;
      depth++;
    }

    return chain;
  }

  private summarizeData(data: Record<string, unknown>): string {
    const keys = Object.keys(data).filter(k => !['id', 'case_id', 'move_id'].includes(k));
    if (keys.length === 0) return '';
    const parts = keys.slice(0, 3).map(k => {
      const v = data[k];
      if (typeof v === 'string') return `${k}="${v.slice(0, 50)}"`;
      return `${k}=${JSON.stringify(v)}`;
    });
    return parts.join(', ');
  }
}

export default WhyEngine;
