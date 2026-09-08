import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';
import { getEventsUpTo, getEventsUpToTime } from '../services/event-store.js';
import { WhyEngine } from '@pos/why';

type Sql = ReturnType<typeof postgres>;

export function timeTravelRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);
  const whyEngine = new WhyEngine(sql);

  // GET /at-event — case state at event N
  app.get('/at-event', async (c) => {
    const caseId = c.req.query('caseId');
    const eventId = c.req.query('eventId');
    if (!caseId || !eventId) return c.json({ error: 'caseId and eventId required' }, 400);

    const [targetEvent] = await sql`SELECT case_sequence FROM events WHERE id = ${eventId}`;
    if (!targetEvent) return c.json({ error: 'Event not found' }, 404);

    const events = await getEventsUpTo(sql, caseId, targetEvent.case_sequence as number);
    const snapshot = replayEvents(events as unknown as Array<Record<string, unknown>>);

    return c.json({
      case_id: caseId,
      at_event: eventId,
      at_sequence: targetEvent.case_sequence,
      event_count: events.length,
      snapshot,
    });
  });

  // GET /at-time — case state at time T
  app.get('/at-time', async (c) => {
    const caseId = c.req.query('caseId');
    const timestamp = c.req.query('timestamp');
    if (!caseId || !timestamp) return c.json({ error: 'caseId and timestamp required' }, 400);

    const targetTime = new Date(timestamp);
    if (isNaN(targetTime.getTime())) return c.json({ error: 'Invalid timestamp' }, 400);

    const events = await getEventsUpToTime(sql, caseId, targetTime);
    const snapshot = replayEvents(events as unknown as Array<Record<string, unknown>>);

    return c.json({
      case_id: caseId,
      at_time: timestamp,
      event_count: events.length,
      snapshot,
    });
  });

  // GET /diff — compare state between two event sequences
  app.get('/diff', async (c) => {
    const caseId = c.req.query('caseId');
    const fromSeq = c.req.query('from');
    const toSeq = c.req.query('to');

    if (!caseId || !fromSeq || !toSeq) {
      return c.json({ error: 'caseId, from (sequence), and to (sequence) are required' }, 400);
    }

    const fromN = parseInt(fromSeq, 10);
    const toN = parseInt(toSeq, 10);
    if (isNaN(fromN) || isNaN(toN)) return c.json({ error: 'from and to must be integers' }, 400);

    const eventsBefore = await getEventsUpTo(sql, caseId, fromN);
    const eventsAfter = await getEventsUpTo(sql, caseId, toN);

    const snapshotBefore = replayEvents(eventsBefore as unknown as Array<Record<string, unknown>>);
    const snapshotAfter = replayEvents(eventsAfter as unknown as Array<Record<string, unknown>>);

    // Compute diff
    const changes = computeDiff(snapshotBefore, snapshotAfter);

    // Get the events between the two sequences
    const eventsBetween = await sql`
      SELECT * FROM events
      WHERE case_id = ${caseId}
      AND case_sequence > ${fromN} AND case_sequence <= ${toN}
      ORDER BY case_sequence ASC
    `;

    return c.json({
      case_id: caseId,
      from_sequence: fromN,
      to_sequence: toN,
      events_between: eventsBetween.length,
      changes,
      events: eventsBetween.map((e: Record<string, unknown>) => ({
        id: e.id,
        type: e.type,
        sequence: e.case_sequence,
        occurred_at: e.occurred_at,
        actor_id: e.actor_id,
        summary: summarizeEvent(e),
      })),
    });
  });

  // POST /historical-why — run WHY against state at a specific point in time
  app.post('/historical-why', async (c) => {
    const body = await c.req.json<{
      caseId: string;
      question: string;
      questionType?: string;
      moveId?: string;
      atSequence?: number;
      atTime?: string;
    }>();

    const { caseId, question, questionType, moveId, atSequence, atTime } = body;

    if (!caseId || !question) {
      return c.json({ error: 'caseId and question are required' }, 400);
    }

    if (!atSequence && !atTime) {
      return c.json({ error: 'Either atSequence or atTime is required for historical WHY' }, 400);
    }

    try {
      // Get events up to the specified point
      let events;
      if (atSequence != null) {
        events = await getEventsUpTo(sql, caseId, atSequence);
      } else {
        events = await getEventsUpToTime(sql, caseId, new Date(atTime!));
      }

      // Replay to get historical state
      const historicalState = replayEvents(events as unknown as Array<Record<string, unknown>>);

      // Run WHY engine against current DB but with time constraint
      const result = await whyEngine.explain({
        caseId,
        question,
        questionType: questionType as any,
        targetMoveId: moveId,
        atTime: atTime ?? events[events.length - 1]?.occurred_at?.toISOString(),
      });

      return c.json({
        historical: true,
        at_sequence: atSequence,
        at_time: atTime,
        event_count: events.length,
        state_summary: {
          moves: Object.keys(historicalState.moves).length,
          entities: Object.keys(historicalState.entities).length,
          decisions: Object.keys(historicalState.decisions).length,
          evidence: Object.keys(historicalState.evidence).length,
        },
        why_result: {
          question: result.question,
          question_type: result.questionType,
          explanation: result.answer,
          causal_chain: result.causalChain.map(node => ({
            id: node.eventId,
            type: node.eventType,
            description: node.summary,
            timestamp: node.occurredAt,
            actor_id: node.actorId,
            caused_by: node.causedBy,
          })),
          deterministic: result.deterministic,
        },
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Historical WHY failed' }, 500);
    }
  });

  return app;
}

// ---- Snapshot and Diff Types ----

interface HistoricalSnapshot {
  case_state: Record<string, unknown> | null;
  moves: Record<string, Record<string, unknown>>;
  intents: Record<string, Record<string, unknown>>;
  entities: Record<string, Record<string, unknown>>;
  decisions: Record<string, Record<string, unknown>>;
  evidence: Record<string, Record<string, unknown>>;
  event_count: number;
}

interface DiffChange {
  type: 'added' | 'removed' | 'modified';
  entity_type: string;
  entity_id: string;
  field?: string;
  before: unknown;
  after: unknown;
}

function replayEvents(events: Array<Record<string, unknown>>): HistoricalSnapshot {
  const snapshot: HistoricalSnapshot = {
    case_state: null,
    moves: {},
    intents: {},
    entities: {},
    decisions: {},
    evidence: {},
    event_count: events.length,
  };

  for (const evt of events) {
    const type = evt.type as string;
    const data = (evt.data ?? {}) as Record<string, unknown>;
    const id = (data['id'] ?? data['move_id'] ?? data['entity_id'] ?? data['decision_id'] ?? data['evidence_id']) as string;

    switch (type) {
      case 'CaseCreated':
        snapshot.case_state = { ...data, lifecycle: 'open', revision: 0 };
        break;
      case 'CaseUpdated':
        if (snapshot.case_state) {
          const changes = (data['changes'] ?? data) as Record<string, unknown>;
          Object.assign(snapshot.case_state, changes);
          snapshot.case_state['revision'] = (snapshot.case_state['revision'] as number ?? 0) + 1;
        }
        break;
      case 'CaseClosed':
        if (snapshot.case_state) snapshot.case_state['lifecycle'] = 'closed';
        break;
      case 'CaseReopened':
        if (snapshot.case_state) snapshot.case_state['lifecycle'] = 'open';
        break;
      case 'MoveCreated':
        if (id) snapshot.moves[id] = { ...data, execution: 'not_started', readiness: 'not_ready', outcome: 'unsatisfied', revision: 0 };
        break;
      case 'MoveActivated':
        if (id && snapshot.moves[id]) { snapshot.moves[id]!['execution'] = 'running'; snapshot.moves[id]!['readiness'] = 'ready'; }
        break;
      case 'MovePaused':
        if (id && snapshot.moves[id]) snapshot.moves[id]!['execution'] = 'paused';
        break;
      case 'MoveResumed':
        if (id && snapshot.moves[id]) snapshot.moves[id]!['execution'] = 'running';
        break;
      case 'MoveCancelled':
        if (id && snapshot.moves[id]) { snapshot.moves[id]!['execution'] = 'finished'; snapshot.moves[id]!['outcome'] = 'cancelled'; }
        break;
      case 'MoveSatisfied':
        if (id && snapshot.moves[id]) { snapshot.moves[id]!['execution'] = 'finished'; snapshot.moves[id]!['outcome'] = 'satisfied'; }
        break;
      case 'MoveUpdated':
        if (id && snapshot.moves[id]) Object.assign(snapshot.moves[id]!, data['changes'] ?? data);
        break;
      case 'IntentCreated':
        if (id) snapshot.intents[id] = { ...data, status: 'active', revision: 0 };
        break;
      case 'IntentSatisfied':
        if (id && snapshot.intents[id]) snapshot.intents[id]!['status'] = 'satisfied';
        break;
      case 'IntentFailed':
        if (id && snapshot.intents[id]) snapshot.intents[id]!['status'] = 'failed';
        break;
      case 'EntityCreated':
        if (id) snapshot.entities[id] = { ...data, revision: 0 };
        break;
      case 'EntityUpdated':
        if (id && snapshot.entities[id]) Object.assign(snapshot.entities[id]!, data['changes'] ?? data);
        break;
      case 'EntityRemoved':
        if (id) delete snapshot.entities[id];
        break;
      case 'DecisionCreated':
        if (id) snapshot.decisions[id] = { ...data, state: 'requested', revision: 0 };
        break;
      case 'DecisionResolved':
        if (id && snapshot.decisions[id]) { snapshot.decisions[id]!['state'] = 'decided'; Object.assign(snapshot.decisions[id]!, data); }
        break;
      case 'EvidenceAttached':
        if (id) snapshot.evidence[id] = { ...data, validity: 'valid', revision: 0 };
        break;
      case 'EvidenceInvalidated':
        if (id && snapshot.evidence[id]) snapshot.evidence[id]!['validity'] = 'stale';
        break;
    }
  }

  return snapshot;
}

function computeDiff(before: HistoricalSnapshot, after: HistoricalSnapshot): DiffChange[] {
  const changes: DiffChange[] = [];

  // Compare case state
  if (before.case_state && after.case_state) {
    for (const key of new Set([...Object.keys(before.case_state), ...Object.keys(after.case_state)])) {
      if (JSON.stringify(before.case_state[key]) !== JSON.stringify(after.case_state[key])) {
        changes.push({
          type: 'modified', entity_type: 'case', entity_id: 'case',
          field: key, before: before.case_state[key], after: after.case_state[key],
        });
      }
    }
  }

  // Compare collections
  const collections: Array<{ name: string; before: Record<string, Record<string, unknown>>; after: Record<string, Record<string, unknown>> }> = [
    { name: 'move', before: before.moves, after: after.moves },
    { name: 'intent', before: before.intents, after: after.intents },
    { name: 'entity', before: before.entities, after: after.entities },
    { name: 'decision', before: before.decisions, after: after.decisions },
    { name: 'evidence', before: before.evidence, after: after.evidence },
  ];

  for (const col of collections) {
    const allIds = new Set([...Object.keys(col.before), ...Object.keys(col.after)]);
    for (const id of allIds) {
      const b = col.before[id];
      const a = col.after[id];
      if (!b && a) {
        changes.push({ type: 'added', entity_type: col.name, entity_id: id, before: null, after: a });
      } else if (b && !a) {
        changes.push({ type: 'removed', entity_type: col.name, entity_id: id, before: b, after: null });
      } else if (b && a) {
        for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
          if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
            changes.push({
              type: 'modified', entity_type: col.name, entity_id: id,
              field: key, before: b[key], after: a[key],
            });
          }
        }
      }
    }
  }

  return changes;
}

function summarizeEvent(evt: Record<string, unknown>): string {
  const type = evt.type as string;
  const data = (evt.data ?? {}) as Record<string, unknown>;
  const title = (data['title'] as string) ?? '';
  return title ? `${type}: ${title}` : type;
}
