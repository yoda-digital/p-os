import { Hono } from 'hono';
import type postgres from 'postgres';
import { authMiddleware } from '../middleware/auth.js';
import { getEventsUpTo, getEventsUpToTime } from '../services/event-store.js';

type Sql = ReturnType<typeof postgres>;

export function timeTravelRoutes(sql: Sql) {
  const app = new Hono();
  app.use('*', authMiddleware);

  // GET /at-event — case state at event N
  app.get('/at-event', async (c) => {
    const caseId = c.req.query('caseId');
    const eventId = c.req.query('eventId');
    if (!caseId || !eventId) return c.json({ error: 'caseId and eventId required' }, 400);

    // Find the sequence number of the target event
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

  return app;
}

interface HistoricalSnapshot {
  case_state: Record<string, unknown> | null;
  moves: Record<string, Record<string, unknown>>;
  intents: Record<string, Record<string, unknown>>;
  entities: Record<string, Record<string, unknown>>;
  decisions: Record<string, Record<string, unknown>>;
  evidence: Record<string, Record<string, unknown>>;
  event_count: number;
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
    const id = data['id'] as string;

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
        snapshot.moves[id] = { ...data, execution: 'not_started', readiness: 'not_ready', outcome: 'unsatisfied', revision: 0 };
        break;
      case 'MoveActivated':
        if (snapshot.moves[id]) { snapshot.moves[id]!['execution'] = 'running'; snapshot.moves[id]!['readiness'] = 'ready'; }
        break;
      case 'MovePaused':
        if (snapshot.moves[id]) snapshot.moves[id]!['execution'] = 'paused';
        break;
      case 'MoveResumed':
        if (snapshot.moves[id]) snapshot.moves[id]!['execution'] = 'running';
        break;
      case 'MoveCancelled':
        if (snapshot.moves[id]) { snapshot.moves[id]!['execution'] = 'finished'; snapshot.moves[id]!['outcome'] = 'cancelled'; }
        break;
      case 'MoveUpdated':
        if (snapshot.moves[id]) Object.assign(snapshot.moves[id]!, data['changes'] ?? data);
        break;
      case 'IntentCreated':
        snapshot.intents[id] = { ...data, status: 'active', revision: 0 };
        break;
      case 'IntentSatisfied':
        if (snapshot.intents[id]) snapshot.intents[id]!['status'] = 'satisfied';
        break;
      case 'IntentFailed':
        if (snapshot.intents[id]) snapshot.intents[id]!['status'] = 'failed';
        break;
      case 'EntityCreated':
        snapshot.entities[id] = { ...data, revision: 0 };
        break;
      case 'EntityUpdated':
        if (snapshot.entities[id]) Object.assign(snapshot.entities[id]!, data['changes'] ?? data);
        break;
      case 'EntityRemoved':
        delete snapshot.entities[id];
        break;
      case 'DecisionCreated':
        snapshot.decisions[id] = { ...data, state: 'requested', revision: 0 };
        break;
      case 'DecisionResolved':
        if (snapshot.decisions[id]) { snapshot.decisions[id]!['state'] = 'decided'; Object.assign(snapshot.decisions[id]!, data); }
        break;
      case 'EvidenceAttached':
        snapshot.evidence[id] = { ...data, validity: 'valid', revision: 0 };
        break;
      case 'EvidenceInvalidated':
        if (snapshot.evidence[id]) snapshot.evidence[id]!['validity'] = 'stale';
        break;
    }
  }

  return snapshot;
}
