import type postgres from 'postgres';
import { appendEvents, type EventRecord } from './event-store.js';
import { createSteering, type SteeringClass } from './steering-service.js';

type Sql = ReturnType<typeof postgres>;

export interface Command {
  command_id: string;
  type: string;
  tenant_id: string;
  case_id?: string;
  actor_id: string;
  target_ref?: { id: string; type: string };
  expected_revision?: number;
  issued_at: string;
  expires_at?: string;
  idempotency_key?: string;
  payload: Record<string, unknown>;
}

export interface CommandResult {
  status: 'accepted' | 'rejected' | 'conflict' | 'deferred' | 'expired' | 'unauthorized' | 'unsupported';
  events?: EventRecord[];
  reason?: string;
  data?: Record<string, unknown>;
}

export class CommandProcessor {
  constructor(private sql: Sql) {}

  async process(command: Command): Promise<CommandResult> {
    // 1. Check expiration
    if (command.expires_at && new Date(command.expires_at) < new Date()) {
      return { status: 'expired', reason: 'Command has expired' };
    }

    // 2. Check idempotency
    if (command.idempotency_key) {
      const [existing] = await this.sql`
        SELECT id FROM events WHERE causation_id = ${command.command_id} LIMIT 1
      `;
      if (existing) {
        return { status: 'accepted', events: [], reason: 'Already processed (idempotent)' };
      }
    }

    // 3. Route to handler
    const handler = this.getHandler(command.type);
    if (!handler) {
      return { status: 'unsupported', reason: `Unknown command type: ${command.type}` };
    }

    try {
      return await handler.call(this, command);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { status: 'rejected', reason: message };
    }
  }

  private getHandler(type: string): ((cmd: Command) => Promise<CommandResult>) | null {
    const handlers: Record<string, (cmd: Command) => Promise<CommandResult>> = {
      // Case
      'Case.Create': this.handleCaseCreate,
      'Case.Update': this.handleCaseUpdate,
      'Case.Close': this.handleCaseClose,
      'Case.Reopen': this.handleCaseReopen,
      'Case.Archive': this.handleCaseArchive,
      'Case.Void': this.handleCaseVoid,
      // Entity
      'Entity.Create': this.handleEntityCreate,
      'Entity.Update': this.handleEntityUpdate,
      'Entity.Remove': this.handleEntityRemove,
      // Relation
      'Relation.Add': this.handleRelationAdd,
      'Relation.Remove': this.handleRelationRemove,
      'Relation.Update': this.handleRelationUpdate,
      // Assertion
      'Assertion.Create': this.handleAssertionCreate,
      'Assertion.Update': this.handleAssertionUpdate,
      'Assertion.Retract': this.handleAssertionRetract,
      // Intent
      'Intent.Create': this.handleIntentCreate,
      'Intent.Update': this.handleIntentUpdate,
      'Intent.Satisfy': this.handleIntentSatisfy,
      'Intent.Fail': this.handleIntentFail,
      'Intent.Abandon': this.handleIntentAbandon,
      // Rule
      'Rule.Create': this.handleRuleCreate,
      'Rule.Update': this.handleRuleUpdate,
      'Rule.Supersede': this.handleRuleSupersede,
      'Rule.Evaluate': this.handleRuleEvaluate,
      // Actor
      'Actor.Create': this.handleActorCreate,
      'Actor.Update': this.handleActorUpdate,
      // Resource
      'Resource.Create': this.handleResourceCreate,
      'Resource.Update': this.handleResourceUpdate,
      'Resource.Reserve': this.handleResourceReserve,
      'Resource.Release': this.handleResourceRelease,
      // Move
      'Move.Create': this.handleMoveCreate,
      'Move.Edit': this.handleMoveEdit,
      'Move.Activate': this.handleMoveActivate,
      'Move.Pause': this.handleMovePause,
      'Move.Resume': this.handleMoveResume,
      'Move.Cancel': this.handleMoveCancel,
      'Move.Supersede': this.handleMoveSupersede,
      'Move.ChangePriority': this.handleMoveChangePriority,
      'Move.ChangeDeadline': this.handleMoveChangeDeadline,
      'Move.Assign': this.handleMoveAssign,
      'Move.RequestReadiness': this.handleMoveRequestReadiness,
      'Move.RequestActivation': this.handleMoveRequestActivation,
      'Move.RequestSatisfaction': this.handleMoveRequestSatisfaction,
      // Attempt
      'Attempt.Start': this.handleAttemptStart,
      'Attempt.UpdateProgress': this.handleAttemptUpdateProgress,
      'Attempt.Steer': this.handleAttemptSteer,
      'Attempt.Pause': this.handleAttemptPause,
      'Attempt.Resume': this.handleAttemptResume,
      'Attempt.Cancel': this.handleAttemptCancel,
      'Attempt.Succeed': this.handleAttemptSucceed,
      'Attempt.Fail': this.handleAttemptFail,
      // Evidence
      'Evidence.Attach': this.handleEvidenceAttach,
      'Evidence.Invalidate': this.handleEvidenceInvalidate,
      'Evidence.Dispute': this.handleEvidenceDispute,
      // Decision
      'Decision.Create': this.handleDecisionCreate,
      'Decision.Update': this.handleDecisionUpdate,
      'Decision.Resolve': this.handleDecisionResolve,
      'Decision.Defer': this.handleDecisionDefer,
      'Decision.Supersede': this.handleDecisionSupersede,
    };
    return handlers[type] ?? null;
  }

  private makeEvent(
    command: Command,
    eventType: string,
    data: Record<string, unknown>
  ): EventRecord {
    return {
      id: crypto.randomUUID(),
      tenant_id: command.tenant_id,
      case_id: command.case_id ?? null,
      type: eventType,
      actor_id: command.actor_id,
      occurred_at: new Date(),
      causation_id: command.command_id,
      correlation_id: command.command_id,
      data,
    };
  }

  private async checkRevision(table: string, id: string, expected?: number): Promise<void> {
    if (expected == null) return;
    const [row] = await this.sql`
      SELECT revision FROM ${this.sql(table)} WHERE id = ${id}
    `;
    if (!row) throw new Error(`${table} not found: ${id}`);
    if (Number(row.revision) !== expected) {
      throw new RevisionConflictError(
        `Revision conflict: expected ${expected}, got ${row.revision}`
      );
    }
  }

  // ─── CASE HANDLERS ───

  private async handleCaseCreate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const events = [
      this.makeEvent({ ...cmd, case_id: id }, 'CaseCreated', {
        id,
        title: p['title'],
        description: p['description'] ?? null,
        type: p['type'] ?? 'general',
        workspace_id: p['workspace_id'] ?? null,
        pack_refs: p['pack_refs'] ?? [],
        metadata: p['metadata'] ?? {},
      }),
    ];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO cases (id, organization_id, workspace_id, type, title, description, lifecycle, pack_refs, metadata, created_by, revision)
        VALUES (
          ${id}, ${cmd.tenant_id}, ${(p['workspace_id'] as string) ?? null},
          ${(p['type'] as string) ?? 'general'}, ${p['title'] as string},
          ${(p['description'] as string) ?? null}, 'open',
          ${this.sql.json((p['pack_refs'] as any) ?? [])},
          ${this.sql.json((p['metadata'] as any) ?? {})},
          ${cmd.actor_id}, 0
        )
      `;
      // Initialize kanban and summary projections
      await tx`
        INSERT INTO projection_case_summary (case_id, organization_id, title, lifecycle)
        VALUES (${id}, ${cmd.tenant_id}, ${p['title'] as string}, 'open')
      `;
    });

    return { status: 'accepted', events, data: { id } };
  }

  private async handleCaseUpdate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    await this.checkRevision('cases', id, cmd.expected_revision);

    const events = [this.makeEvent(cmd, 'CaseUpdated', { id, changes: p })];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      const fields: Record<string, unknown> = {};
      if (p['title']) fields['title'] = p['title'];
      if (p['description'] !== undefined) fields['description'] = p['description'];
      if (p['type']) fields['type'] = p['type'];
      if (p['metadata']) fields['metadata'] = p['metadata'];

      await tx`
        UPDATE cases SET
          title = COALESCE(${(p['title'] as string) ?? null}, title),
          description = COALESCE(${(p['description'] as string) ?? null}, description),
          type = COALESCE(${(p['type'] as string) ?? null}, type),
          revision = revision + 1,
          updated_at = NOW()
        WHERE id = ${id}
      `;
      await tx`
        UPDATE projection_case_summary SET
          title = COALESCE(${(p['title'] as string) ?? null}, title),
          updated_at = NOW()
        WHERE case_id = ${id}
      `;
    });

    return { status: 'accepted', events };
  }

  private async handleCaseClose(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    await this.checkRevision('cases', id, cmd.expected_revision);

    const [c] = await this.sql`SELECT lifecycle FROM cases WHERE id = ${id}`;
    if (!c) return { status: 'rejected', reason: 'Case not found' };
    if (c.lifecycle === 'closed') return { status: 'rejected', reason: 'Case already closed' };

    const events = [this.makeEvent(cmd, 'CaseClosed', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE cases SET lifecycle = 'closed', revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_case_summary SET lifecycle = 'closed', updated_at = NOW() WHERE case_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleCaseReopen(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'CaseReopened', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE cases SET lifecycle = 'open', revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_case_summary SET lifecycle = 'open', updated_at = NOW() WHERE case_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleCaseArchive(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'CaseArchived', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE cases SET lifecycle = 'archived', revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_case_summary SET lifecycle = 'archived', updated_at = NOW() WHERE case_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleCaseVoid(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'CaseVoided', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE cases SET lifecycle = 'void', revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_case_summary SET lifecycle = 'void', updated_at = NOW() WHERE case_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  // ─── ENTITY HANDLERS ───

  private async handleEntityCreate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const caseId = cmd.case_id!;
    const events = [this.makeEvent(cmd, 'EntityCreated', { id, case_id: caseId, ...p })];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO entities (id, case_id, type, title, description, properties, created_by, revision)
        VALUES (${id}, ${caseId}, ${p['type'] as string}, ${p['title'] as string},
                ${(p['description'] as string) ?? null},
                ${this.sql.json((p['properties'] as any) ?? {})},
                ${cmd.actor_id}, 0)
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleEntityUpdate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    await this.checkRevision('entities', id, cmd.expected_revision);
    const events = [this.makeEvent(cmd, 'EntityUpdated', { id, changes: p })];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE entities SET
          title = COALESCE(${(p['title'] as string) ?? null}, title),
          description = COALESCE(${(p['description'] as string) ?? null}, description),
          properties = COALESCE(${p['properties'] ? this.sql.json(p['properties'] as any) : null}, properties),
          revision = revision + 1
        WHERE id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  private async handleEntityRemove(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'EntityRemoved', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`DELETE FROM entities WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  // ─── RELATION HANDLERS ───

  private async handleRelationAdd(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const events = [this.makeEvent(cmd, 'RelationAdded', { id, ...p })];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO relations (id, case_id, source_ref, target_ref, type, qualifier, confidence, effective_from, effective_until, source_refs, created_by, revision)
        VALUES (${id}, ${cmd.case_id!},
                ${this.sql.json(p['source_ref'] as any)}, ${this.sql.json(p['target_ref'] as any)},
                ${p['type'] as string}, ${(p['qualifier'] as string) ?? null},
                ${(p['confidence'] as number) ?? 1.0},
                ${(p['effective_from'] as string) ?? null}, ${(p['effective_until'] as string) ?? null},
                ${this.sql.json((p['source_refs'] as any) ?? [])},
                ${cmd.actor_id}, 0)
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleRelationRemove(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'RelationRemoved', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`DELETE FROM relations WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleRelationUpdate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    await this.checkRevision('relations', id, cmd.expected_revision);
    const events = [this.makeEvent(cmd, 'RelationUpdated', { id, changes: p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE relations SET
          qualifier = COALESCE(${(p['qualifier'] as string) ?? null}, qualifier),
          confidence = COALESCE(${(p['confidence'] as number) ?? null}, confidence),
          revision = revision + 1
        WHERE id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  // ─── ASSERTION HANDLERS ───

  private async handleAssertionCreate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const events = [this.makeEvent(cmd, 'AssertionCreated', { id, ...p })];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO assertions (id, case_id, subject_ref, predicate, value, modality, source_refs, evidence_refs, confidence, status, created_by, revision)
        VALUES (${id}, ${cmd.case_id!},
                ${this.sql.json(p['subject_ref'] as any)}, ${p['predicate'] as string},
                ${p['value'] ? this.sql.json(p['value'] as any) : null},
                ${(p['modality'] as string) ?? 'claimed'},
                ${this.sql.json((p['source_refs'] as any) ?? [])},
                ${(p['evidence_refs'] as string[]) ?? []},
                ${(p['confidence'] as number) ?? 0.5},
                'active', ${cmd.actor_id}, 0)
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleAssertionUpdate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    await this.checkRevision('assertions', id, cmd.expected_revision);
    const events = [this.makeEvent(cmd, 'AssertionUpdated', { id, changes: p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE assertions SET
          predicate = COALESCE(${(p['predicate'] as string) ?? null}, predicate),
          value = COALESCE(${p['value'] ? this.sql.json(p['value'] as any) : null}, value),
          modality = COALESCE(${(p['modality'] as string) ?? null}, modality),
          confidence = COALESCE(${(p['confidence'] as number) ?? null}, confidence),
          revision = revision + 1
        WHERE id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  private async handleAssertionRetract(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'AssertionRetracted', { id, reason: cmd.payload['reason'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE assertions SET status = 'retracted', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  // ─── INTENT HANDLERS ───

  private async handleIntentCreate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const events = [this.makeEvent(cmd, 'IntentCreated', { id, ...p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO intents (id, case_id, class, statement, priority, owner_refs, success_contract, stop_contract, failure_contract, status, constraints, dependencies, created_by, revision)
        VALUES (${id}, ${cmd.case_id!}, ${p['class'] as string}, ${p['statement'] as string},
                ${(p['priority'] as string) ?? 'medium'},
                ${this.sql.json((p['owner_refs'] as any) ?? [])},
                ${p['success_contract'] ? this.sql.json(p['success_contract'] as any) : null},
                ${p['stop_contract'] ? this.sql.json(p['stop_contract'] as any) : null},
                ${p['failure_contract'] ? this.sql.json(p['failure_contract'] as any) : null},
                'active',
                ${this.sql.json((p['constraints'] as any) ?? [])},
                ${this.sql.json((p['dependencies'] as any) ?? [])},
                ${cmd.actor_id}, 0)
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleIntentUpdate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    await this.checkRevision('intents', id, cmd.expected_revision);
    const events = [this.makeEvent(cmd, 'IntentUpdated', { id, changes: p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE intents SET
          statement = COALESCE(${(p['statement'] as string) ?? null}, statement),
          priority = COALESCE(${(p['priority'] as string) ?? null}, priority),
          revision = revision + 1
        WHERE id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  private async handleIntentSatisfy(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'IntentSatisfied', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE intents SET status = 'satisfied', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleIntentFail(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'IntentFailed', { id, reason: cmd.payload['reason'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE intents SET status = 'failed', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleIntentAbandon(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'IntentAbandoned', { id, reason: cmd.payload['reason'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE intents SET status = 'abandoned', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  // ─── RULE HANDLERS ───

  private async handleRuleCreate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const events = [this.makeEvent(cmd, 'RuleCreated', { id, ...p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO rules (id, case_id, type, statement, authority_ref, applicability, predicate, effective_from, effective_until, evaluation_status, created_by, revision)
        VALUES (${id}, ${cmd.case_id!}, ${p['type'] as string}, ${p['statement'] as string},
                ${p['authority_ref'] ? this.sql.json(p['authority_ref'] as any) : null},
                ${p['applicability'] ? this.sql.json(p['applicability'] as any) : null},
                ${p['predicate'] ? this.sql.json(p['predicate'] as any) : null},
                ${(p['effective_from'] as string) ?? null}, ${(p['effective_until'] as string) ?? null},
                'unknown', ${cmd.actor_id}, 0)
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleRuleUpdate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    await this.checkRevision('rules', id, cmd.expected_revision);
    const events = [this.makeEvent(cmd, 'RuleUpdated', { id, changes: p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE rules SET
          statement = COALESCE(${(p['statement'] as string) ?? null}, statement),
          evaluation_status = COALESCE(${(p['evaluation_status'] as string) ?? null}, evaluation_status),
          revision = revision + 1
        WHERE id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  private async handleRuleSupersede(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const newRuleId = cmd.payload['new_rule_id'] as string;
    const events = [this.makeEvent(cmd, 'RuleSuperseded', { id, superseded_by: newRuleId })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE rules SET supersedes = ${newRuleId}, revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleRuleEvaluate(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const status = cmd.payload['evaluation_status'] as string;
    const events = [this.makeEvent(cmd, 'RuleEvaluated', { id, evaluation_status: status })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE rules SET evaluation_status = ${status}, revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  // ─── ACTOR HANDLERS ───

  private async handleActorCreate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const events = [this.makeEvent(cmd, 'ActorCreated', { id, ...p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO actors (id, organization_id, class, identity_ref, display_name, roles, capabilities, authority_grants, created_by, revision)
        VALUES (${id}, ${cmd.tenant_id}, ${p['class'] as string},
                ${p['identity_ref'] ? this.sql.json(p['identity_ref'] as any) : null},
                ${p['display_name'] as string},
                ${this.sql.json((p['roles'] as any) ?? [])},
                ${this.sql.json((p['capabilities'] as any) ?? [])},
                ${this.sql.json((p['authority_grants'] as any) ?? [])},
                ${cmd.actor_id}, 0)
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleActorUpdate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    await this.checkRevision('actors', id, cmd.expected_revision);
    const events = [this.makeEvent(cmd, 'ActorUpdated', { id, changes: p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE actors SET
          display_name = COALESCE(${(p['display_name'] as string) ?? null}, display_name),
          roles = COALESCE(${p['roles'] ? this.sql.json(p['roles'] as any) : null}, roles),
          capabilities = COALESCE(${p['capabilities'] ? this.sql.json(p['capabilities'] as any) : null}, capabilities),
          revision = revision + 1
        WHERE id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  // ─── RESOURCE HANDLERS ───

  private async handleResourceCreate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const events = [this.makeEvent(cmd, 'ResourceCreated', { id, ...p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO resources (id, case_id, type, name, capacity, available, reserved, cost_per_unit, location, consumable, created_by, revision)
        VALUES (${id}, ${cmd.case_id!}, ${p['type'] as string}, ${p['name'] as string},
                ${p['capacity'] ? this.sql.json(p['capacity'] as any) : null},
                ${p['available'] ? this.sql.json(p['available'] as any) : null},
                ${p['reserved'] ? this.sql.json(p['reserved'] as any) : null},
                ${p['cost_per_unit'] ? this.sql.json(p['cost_per_unit'] as any) : null},
                ${(p['location'] as string) ?? null}, ${(p['consumable'] as boolean) ?? false},
                ${cmd.actor_id}, 0)
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleResourceUpdate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    await this.checkRevision('resources', id, cmd.expected_revision);
    const events = [this.makeEvent(cmd, 'ResourceUpdated', { id, changes: p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE resources SET name = COALESCE(${(p['name'] as string) ?? null}, name), revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleResourceReserve(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'ResourceReserved', { id, reservation: cmd.payload['reservation'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE resources SET
          reserved = COALESCE(${cmd.payload['reservation'] ? this.sql.json(cmd.payload['reservation'] as any) : null}, reserved),
          revision = revision + 1
        WHERE id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  private async handleResourceRelease(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'ResourceReleased', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE resources SET reserved = '{}', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  // ─── MOVE HANDLERS ───

  private async handleMoveCreate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const caseId = cmd.case_id!;
    const events = [this.makeEvent(cmd, 'MoveCreated', { id, case_id: caseId, ...p })];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO moves (id, case_id, class, title, objective, intent_refs, parent_move_id,
                           preconditions, postconditions, completion_contract, required_capabilities,
                           required_authority, constraints, dependencies, priority, risk, deadline,
                           execution_policy, assigned_actor_ids, readiness, execution, verification,
                           attention, risk_level, temporal, outcome, created_by, revision)
        VALUES (${id}, ${caseId}, ${(p['class'] as string) ?? 'ACT'}, ${p['title'] as string},
                ${(p['objective'] as string) ?? null},
                ${(p['intent_refs'] as string[]) ?? []},
                ${(p['parent_move_id'] as string) ?? null},
                ${this.sql.json((p['preconditions'] as any) ?? [])},
                ${this.sql.json((p['postconditions'] as any) ?? [])},
                ${p['completion_contract'] ? this.sql.json(p['completion_contract'] as any) : null},
                ${this.sql.json((p['required_capabilities'] as any) ?? [])},
                ${this.sql.json((p['required_authority'] as any) ?? [])},
                ${this.sql.json((p['constraints'] as any) ?? [])},
                ${(p['dependencies'] as string[]) ?? []},
                ${(p['priority'] as string) ?? 'medium'}, ${(p['risk'] as string) ?? 'none'},
                ${(p['deadline'] as string) ?? null},
                ${p['execution_policy'] ? this.sql.json(p['execution_policy'] as any) : null},
                ${(p['assigned_actor_ids'] as string[]) ?? []},
                'not_ready', 'not_started', 'not_required', 'autonomous', 'none', 'on_track', 'unsatisfied',
                ${cmd.actor_id}, 0)
      `;
      // Add to kanban projection
      const column = 'BACKLOG';
      const [maxPos] = await tx`SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM projection_kanban WHERE case_id = ${caseId} AND column_id = ${column}`;
      await tx`
        INSERT INTO projection_kanban (move_id, case_id, column_id, position, card_data)
        VALUES (${id}, ${caseId}, ${column}, ${maxPos?.pos ?? 0},
                ${this.sql.json({ title: p['title'], class: p['class'] ?? 'ACT', priority: p['priority'] ?? 'medium', risk: p['risk'] ?? 'none' } as any)})
      `;
      // Update case summary
      await tx`
        UPDATE projection_case_summary SET
          total_moves = total_moves + 1,
          last_activity_at = NOW(),
          updated_at = NOW()
        WHERE case_id = ${caseId}
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleMoveEdit(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    await this.checkRevision('moves', id, cmd.expected_revision);
    const events = [this.makeEvent(cmd, 'MoveUpdated', { id, changes: p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE moves SET
          title = COALESCE(${(p['title'] as string) ?? null}, title),
          objective = COALESCE(${(p['objective'] as string) ?? null}, objective),
          priority = COALESCE(${(p['priority'] as string) ?? null}, priority),
          risk = COALESCE(${(p['risk'] as string) ?? null}, risk),
          revision = revision + 1
        WHERE id = ${id}
      `;
      if (p['title'] || p['priority'] || p['risk']) {
        await tx`
          UPDATE projection_kanban SET
            card_data = card_data ||
              ${this.sql.json({
                ...(p['title'] ? { title: p['title'] } : {}),
                ...(p['priority'] ? { priority: p['priority'] } : {}),
                ...(p['risk'] ? { risk: p['risk'] } : {}),
              } as any)},
            updated_at = NOW()
          WHERE move_id = ${id}
        `;
      }
    });
    return { status: 'accepted', events };
  }

  private async handleMoveActivate(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const [move] = await this.sql`SELECT execution, case_id FROM moves WHERE id = ${id}`;
    if (!move) return { status: 'rejected', reason: 'Move not found' };
    if (move.execution === 'running') return { status: 'rejected', reason: 'Move is already running' };

    const events = [this.makeEvent(cmd, 'MoveActivated', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE moves SET readiness = 'ready', execution = 'running', revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_kanban SET column_id = 'ACTIVE', updated_at = NOW() WHERE move_id = ${id}`;
      await tx`
        UPDATE projection_case_summary SET
          active_moves = (SELECT count(*) FROM moves WHERE case_id = ${move.case_id} AND execution = 'running'),
          last_activity_at = NOW(), updated_at = NOW()
        WHERE case_id = ${move.case_id}
      `;
    });
    return { status: 'accepted', events };
  }

  private async handleMovePause(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const reason = (cmd.payload['reason'] as string) ?? 'paused';
    const events = [this.makeEvent(cmd, 'MovePaused', { id, reason })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE moves SET execution = 'paused', revision = revision + 1 WHERE id = ${id}`;
      const col = reason === 'waiting' ? 'WAITING' : 'BACKLOG';
      await tx`UPDATE projection_kanban SET column_id = ${col}, updated_at = NOW() WHERE move_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleMoveResume(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'MoveResumed', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE moves SET execution = 'running', revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_kanban SET column_id = 'ACTIVE', updated_at = NOW() WHERE move_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleMoveCancel(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'MoveCancelled', { id, reason: cmd.payload['reason'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE moves SET execution = 'finished', outcome = 'cancelled', revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_kanban SET column_id = 'DONE', updated_at = NOW() WHERE move_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleMoveSupersede(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'MoveSuperseded', { id, superseded_by: cmd.payload['superseded_by'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE moves SET execution = 'finished', outcome = 'superseded', revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_kanban SET column_id = 'DONE', updated_at = NOW() WHERE move_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleMoveChangePriority(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const priority = cmd.payload['priority'] as string;
    const events = [this.makeEvent(cmd, 'MoveUpdated', { id, changes: { priority } })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE moves SET priority = ${priority}, revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_kanban SET card_data = card_data || ${this.sql.json({ priority })}, updated_at = NOW() WHERE move_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleMoveChangeDeadline(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const deadline = cmd.payload['deadline'] as string;
    const events = [this.makeEvent(cmd, 'MoveUpdated', { id, changes: { deadline } })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE moves SET deadline = ${deadline}, revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_kanban SET card_data = card_data || ${this.sql.json({ deadline })}, updated_at = NOW() WHERE move_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleMoveAssign(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const actorIds = cmd.payload['actor_ids'] as string[];
    const events = [this.makeEvent(cmd, 'MoveUpdated', { id, changes: { assigned_actor_ids: actorIds } })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE moves SET assigned_actor_ids = ${actorIds}, revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleMoveRequestReadiness(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    // Check dependencies
    const [move] = await this.sql`SELECT dependencies, case_id FROM moves WHERE id = ${id}`;
    if (!move) return { status: 'rejected', reason: 'Move not found' };

    const deps = (move.dependencies as string[]) ?? [];
    if (deps.length > 0) {
      const blockers = await this.sql`
        SELECT id, outcome FROM moves WHERE id = ANY(${deps}) AND outcome != 'satisfied'
      `;
      if (blockers.length > 0) {
        return { status: 'rejected', reason: `Blocked by ${blockers.length} unsatisfied dependencies` };
      }
    }

    const events = [this.makeEvent(cmd, 'MoveUpdated', { id, changes: { readiness: 'ready' } })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE moves SET readiness = 'ready', revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_kanban SET column_id = 'READY', updated_at = NOW() WHERE move_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleMoveRequestActivation(cmd: Command): Promise<CommandResult> {
    return this.handleMoveActivate(cmd);
  }

  private async handleMoveRequestSatisfaction(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'MoveUpdated', { id, changes: { verification: 'pending' } })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE moves SET verification = 'pending', revision = revision + 1 WHERE id = ${id}`;
      await tx`UPDATE projection_kanban SET column_id = 'VERIFY', updated_at = NOW() WHERE move_id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  // ─── ATTEMPT HANDLERS ───

  private async handleAttemptStart(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const moveId = p['move_id'] as string;
    const caseId = cmd.case_id!;
    const events = [this.makeEvent(cmd, 'AttemptStarted', { id, move_id: moveId, ...p })];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO attempts (id, case_id, move_id, executor_id, strategy, state, runtime_refs, model, effort, started_at, created_by, revision)
        VALUES (${id}, ${caseId}, ${moveId}, ${(p['executor_id'] as string) ?? null},
                ${(p['strategy'] as string) ?? 'same_session'}, 'running',
                ${this.sql.json((p['runtime_refs'] as any) ?? {})},
                ${(p['model'] as string) ?? null}, ${(p['effort'] as string) ?? null},
                NOW(), ${cmd.actor_id}, 0)
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleAttemptUpdateProgress(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'AttemptProgressUpdated', { id, progress: cmd.payload['progress'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      // Progress is event-only, no aggregate field update needed beyond revision
      await tx`UPDATE attempts SET revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleAttemptSteer(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    // attempt_id is optional: a steering command may target a move before any
    // attempt has started (it is then delivered to whichever attempt starts next).
    // Read it from the payload only — target_ref.id may fall back to the move id
    // when no attempt is bound yet, and must never be mistaken for an attempt id.
    const attemptId = (p['attempt_id'] as string | undefined) || null;

    let created: Awaited<ReturnType<typeof createSteering>> | undefined;
    await this.sql.begin(async (tx) => {
      created = await createSteering(tx as unknown as Sql, {
        case_id: cmd.case_id!,
        move_id: p['move_id'] as string,
        attempt_id: attemptId,
        class: p['class'] as SteeringClass,
        instruction: p['instruction'] as string,
        tenant_id: cmd.tenant_id,
        actor_id: cmd.actor_id,
        causation_id: cmd.command_id,
      });
    });

    return {
      status: 'accepted',
      events: [],
      data: { steering_id: created!.id, state: created!.state },
    };
  }

  private async handleAttemptPause(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'AttemptPaused', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE attempts SET state = 'paused', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleAttemptResume(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'AttemptResumed', { id })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE attempts SET state = 'running', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleAttemptCancel(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'AttemptCancelled', { id, reason: cmd.payload['reason'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE attempts SET state = 'cancelled', ended_at = NOW(), revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleAttemptSucceed(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'AttemptSucceeded', { id, produced_artifacts: cmd.payload['produced_artifacts'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE attempts SET state = 'succeeded', ended_at = NOW(),
          produced_artifacts = COALESCE(${cmd.payload['produced_artifacts'] ? this.sql.json(cmd.payload['produced_artifacts'] as any) : null}, produced_artifacts),
          cost = COALESCE(${cmd.payload['cost'] ? this.sql.json(cmd.payload['cost'] as any) : null}, cost),
          usage = COALESCE(${cmd.payload['usage'] ? this.sql.json(cmd.payload['usage'] as any) : null}, usage),
          revision = revision + 1
        WHERE id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  private async handleAttemptFail(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'AttemptFailed', { id, reason: cmd.payload['reason'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE attempts SET state = 'failed', ended_at = NOW(),
          failure_reason = ${(cmd.payload['reason'] as string) ?? null},
          revision = revision + 1
        WHERE id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  // ─── EVIDENCE HANDLERS ───

  private async handleEvidenceAttach(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const events = [this.makeEvent(cmd, 'EvidenceAttached', { id, ...p })];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO evidence (id, case_id, subject_refs, relation, artifact_ref, source_ref, scope, provenance, observed_at, fresh_until, confidence, validity, created_by, revision)
        VALUES (${id}, ${cmd.case_id!},
                ${this.sql.json((p['subject_refs'] as any) ?? [])},
                ${p['relation'] as string},
                ${p['artifact_ref'] ? this.sql.json(p['artifact_ref'] as any) : null},
                ${p['source_ref'] ? this.sql.json(p['source_ref'] as any) : null},
                ${p['scope'] ? this.sql.json(p['scope'] as any) : null},
                ${p['provenance'] ? this.sql.json(p['provenance'] as any) : null},
                ${(p['observed_at'] as string) ?? null},
                ${(p['fresh_until'] as string) ?? null},
                ${(p['confidence'] as number) ?? 1.0}, 'valid',
                ${cmd.actor_id}, 0)
      `;
      await tx`
        UPDATE projection_case_summary SET total_evidence = total_evidence + 1, last_activity_at = NOW(), updated_at = NOW()
        WHERE case_id = ${cmd.case_id!}
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleEvidenceInvalidate(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'EvidenceInvalidated', { id, reason: cmd.payload['reason'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE evidence SET validity = 'stale', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleEvidenceDispute(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'EvidenceDisputed', { id, reason: cmd.payload['reason'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE evidence SET validity = 'disputed', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  // ─── DECISION HANDLERS ───

  private async handleDecisionCreate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = (p['id'] as string) || crypto.randomUUID();
    const events = [this.makeEvent(cmd, 'DecisionCreated', { id, ...p })];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        INSERT INTO decisions (id, case_id, question, context, options, evidence_refs, risk_refs, recommended_option, recommendation_confidence, recommendation_rationale, required_authority, state, blocking_move_ids, created_by, revision)
        VALUES (${id}, ${cmd.case_id!}, ${p['question'] as string},
                ${(p['context'] as string) ?? null},
                ${this.sql.json((p['options'] as any) ?? [])},
                ${(p['evidence_refs'] as string[]) ?? []},
                ${this.sql.json((p['risk_refs'] as any) ?? [])},
                ${p['recommended_option'] ? this.sql.json(p['recommended_option'] as any) : null},
                ${(p['recommendation_confidence'] as number) ?? null},
                ${(p['recommendation_rationale'] as string) ?? null},
                ${p['required_authority'] ? this.sql.json(p['required_authority'] as any) : null},
                'requested',
                ${(p['blocking_move_ids'] as string[]) ?? []},
                ${cmd.actor_id}, 0)
      `;
      await tx`
        UPDATE projection_case_summary SET pending_decisions = pending_decisions + 1, last_activity_at = NOW(), updated_at = NOW()
        WHERE case_id = ${cmd.case_id!}
      `;
      // Create attention item for the decision
      await tx`
        INSERT INTO projection_attention (id, case_id, decision_id, priority, reason, action_required, created_at)
        VALUES (${crypto.randomUUID()}, ${cmd.case_id!}, ${id}, 'high',
                ${`Decision required: ${p['question'] as string}`}, 'Review and decide', NOW())
      `;
    });
    return { status: 'accepted', events, data: { id } };
  }

  private async handleDecisionUpdate(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    await this.checkRevision('decisions', id, cmd.expected_revision);
    const events = [this.makeEvent(cmd, 'DecisionUpdated', { id, changes: p })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE decisions SET
          question = COALESCE(${(p['question'] as string) ?? null}, question),
          options = COALESCE(${p['options'] ? this.sql.json(p['options'] as any) : null}, options),
          revision = revision + 1
        WHERE id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  private async handleDecisionResolve(cmd: Command): Promise<CommandResult> {
    const p = cmd.payload;
    const id = cmd.target_ref?.id ?? (p['id'] as string);
    const events = [this.makeEvent(cmd, 'DecisionResolved', { id, selected_option: p['selected_option'], rationale: p['rationale'] })];

    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`
        UPDATE decisions SET state = 'decided',
          selected_option = ${p['selected_option'] ? this.sql.json(p['selected_option'] as any) : null},
          rationale = ${(p['rationale'] as string) ?? null},
          decided_by = ${cmd.actor_id}, decided_at = NOW(),
          revision = revision + 1
        WHERE id = ${id}
      `;
      await tx`
        UPDATE projection_case_summary SET pending_decisions = GREATEST(pending_decisions - 1, 0), updated_at = NOW()
        WHERE case_id = ${cmd.case_id!}
      `;
      await tx`
        UPDATE projection_attention SET resolved = true, resolved_at = NOW()
        WHERE decision_id = ${id}
      `;
    });
    return { status: 'accepted', events };
  }

  private async handleDecisionDefer(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'DecisionDeferred', { id, reason: cmd.payload['reason'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE decisions SET state = 'deferred', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }

  private async handleDecisionSupersede(cmd: Command): Promise<CommandResult> {
    const id = cmd.target_ref?.id ?? (cmd.payload['id'] as string);
    const events = [this.makeEvent(cmd, 'DecisionSuperseded', { id, superseded_by: cmd.payload['superseded_by'] })];
    await this.sql.begin(async (tx) => {
      await appendEvents(tx as unknown as Sql, events);
      await tx`UPDATE decisions SET state = 'superseded', revision = revision + 1 WHERE id = ${id}`;
    });
    return { status: 'accepted', events };
  }
}

class RevisionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevisionConflictError';
  }
}

export { RevisionConflictError };
