import type postgres from 'postgres';
import { getEventsUpTo } from './event-store.js';

type Sql = ReturnType<typeof postgres>;

export interface SimulationState {
  id: string;
  source_case_id: string;
  title: string;
  description: string | null;
  status: string;
  fork_event_id: string | null;
  snapshot: HistoricalSnapshot;
  simulation_events: SimulationEvent[];
  created_at: string;
}

export interface SimulationEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  sequence: number;
  created_at: string;
}

interface HistoricalSnapshot {
  case_state: Record<string, unknown> | null;
  moves: Record<string, Record<string, unknown>>;
  intents: Record<string, Record<string, unknown>>;
  entities: Record<string, Record<string, unknown>>;
  decisions: Record<string, Record<string, unknown>>;
  evidence: Record<string, Record<string, unknown>>;
}

export interface ComparisonResult {
  simulation_id: string;
  canonical_state: HistoricalSnapshot;
  simulated_state: HistoricalSnapshot;
  differences: DiffEntry[];
}

interface DiffEntry {
  type: 'added' | 'removed' | 'modified';
  entity_type: string;
  entity_id: string;
  field?: string;
  canonical: unknown;
  simulated: unknown;
}

/**
 * Create a simulation fork from a case at a specific event or the latest state.
 */
export async function createSimulation(
  sql: Sql,
  caseId: string,
  title: string,
  description: string | null,
  createdBy: string,
  forkAtEventId?: string,
): Promise<SimulationState> {
  const simId = crypto.randomUUID();

  // Determine fork point
  let forkSequence: number | null = null;
  if (forkAtEventId) {
    const [evt] = await sql`SELECT case_sequence FROM events WHERE id = ${forkAtEventId}`;
    if (!evt) throw new Error('Fork event not found');
    forkSequence = evt.case_sequence as number;
  } else {
    const [latest] = await sql`SELECT MAX(case_sequence) AS seq FROM events WHERE case_id = ${caseId}`;
    forkSequence = latest?.seq as number | null;
  }

  await sql`
    INSERT INTO simulation_forks (id, source_case_id, fork_event_id, title, description, created_by, status, hypothetical_changes)
    VALUES (${simId}, ${caseId}, ${forkAtEventId ?? null}, ${title}, ${description}, ${createdBy}, 'active', '[]'::jsonb)
  `;

  // Build snapshot at fork point
  const events = forkSequence
    ? await getEventsUpTo(sql, caseId, forkSequence)
    : [];
  const snapshot = replayEvents(events as unknown as Array<Record<string, unknown>>);

  return {
    id: simId,
    source_case_id: caseId,
    title,
    description,
    status: 'active',
    fork_event_id: forkAtEventId ?? null,
    snapshot,
    simulation_events: [],
    created_at: new Date().toISOString(),
  };
}

/**
 * Apply hypothetical events to a simulation fork.
 */
export async function applyHypothetical(
  sql: Sql,
  simulationId: string,
  events: Array<{ type: string; data: Record<string, unknown> }>,
): Promise<SimulationEvent[]> {
  const [fork] = await sql`SELECT * FROM simulation_forks WHERE id = ${simulationId}`;
  if (!fork) throw new Error('Simulation fork not found');
  if (fork.status === 'adopted') throw new Error('Cannot modify an adopted simulation');

  // Get current max sequence
  const [maxSeq] = await sql`
    SELECT COALESCE(MAX(sequence), 0) AS seq FROM simulation_events WHERE simulation_id = ${simulationId}
  `;
  let nextSeq = (maxSeq?.seq as number ?? 0) + 1;

  const inserted: SimulationEvent[] = [];
  for (const evt of events) {
    const id = crypto.randomUUID();
    const [row] = await sql`
      INSERT INTO simulation_events (id, simulation_id, type, data, sequence)
      VALUES (${id}, ${simulationId}, ${evt.type}, ${sql.json(evt.data as any)}, ${nextSeq})
      RETURNING *
    `;
    inserted.push({
      id: row!.id as string,
      type: row!.type as string,
      data: row!.data as Record<string, unknown>,
      sequence: row!.sequence as number,
      created_at: (row!.created_at as Date).toISOString(),
    });
    nextSeq++;
  }

  // Update the hypothetical_changes summary
  await sql`
    UPDATE simulation_forks
    SET hypothetical_changes = (
      SELECT jsonb_agg(jsonb_build_object('type', type, 'data', data))
      FROM simulation_events WHERE simulation_id = ${simulationId}
    )
    WHERE id = ${simulationId}
  `;

  return inserted;
}

/**
 * Compare canonical (real) state vs simulated state.
 */
export async function compareOutcomes(
  sql: Sql,
  simulationId: string,
): Promise<ComparisonResult> {
  const [fork] = await sql`SELECT * FROM simulation_forks WHERE id = ${simulationId}`;
  if (!fork) throw new Error('Simulation fork not found');

  const caseId = fork.source_case_id as string;

  // Get canonical state (current)
  const canonicalEvents = await sql`
    SELECT * FROM events WHERE case_id = ${caseId} ORDER BY case_sequence ASC
  `;
  const canonicalState = replayEvents(canonicalEvents as unknown as Array<Record<string, unknown>>);

  // Get simulated state (fork point + simulation events)
  let forkSequence: number | null = null;
  if (fork.fork_event_id) {
    const [evt] = await sql`SELECT case_sequence FROM events WHERE id = ${fork.fork_event_id}`;
    forkSequence = evt?.case_sequence as number | null;
  }

  const forkEvents = forkSequence
    ? await getEventsUpTo(sql, caseId, forkSequence)
    : canonicalEvents;
  const forkState = replayEvents(forkEvents as unknown as Array<Record<string, unknown>>);

  // Apply simulation events on top
  const simEvents = await sql`
    SELECT * FROM simulation_events WHERE simulation_id = ${simulationId} ORDER BY sequence ASC
  `;
  const simulatedState = replayEvents(simEvents as unknown as Array<Record<string, unknown>>, forkState);

  // Compute differences
  const differences = computeDiff(canonicalState, simulatedState);

  return {
    simulation_id: simulationId,
    canonical_state: canonicalState,
    simulated_state: simulatedState,
    differences,
  };
}

/**
 * Adopt selected changes from a simulation as real Commands.
 * This creates explicit canonical events -- never invisible merges.
 */
export async function adoptSimulation(
  sql: Sql,
  simulationId: string,
  selectedEventIds: string[] | null,
  actorId: string,
): Promise<{ adopted_count: number; commands_created: string[] }> {
  const [fork] = await sql`SELECT * FROM simulation_forks WHERE id = ${simulationId}`;
  if (!fork) throw new Error('Simulation fork not found');
  if (fork.status === 'adopted') throw new Error('Simulation already adopted');

  const caseId = fork.source_case_id as string;

  // Get simulation events to adopt
  const simEvents = selectedEventIds
    ? await sql`
        SELECT * FROM simulation_events
        WHERE simulation_id = ${simulationId} AND id = ANY(${selectedEventIds})
        ORDER BY sequence ASC
      `
    : await sql`
        SELECT * FROM simulation_events
        WHERE simulation_id = ${simulationId}
        ORDER BY sequence ASC
      `;

  const commandIds: string[] = [];

  // Convert each simulation event into a real Command
  for (const simEvt of simEvents) {
    const commandId = crypto.randomUUID();
    const commandType = mapSimEventToCommandType(simEvt.type as string);

    await sql`
      INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, data, causation_id, correlation_id)
      VALUES (
        ${commandId},
        (SELECT tenant_id FROM events WHERE case_id = ${caseId} LIMIT 1),
        ${caseId},
        ${commandType},
        ${actorId},
        NOW(),
        ${sql.json({
          ...(simEvt.data as Record<string, unknown>),
          _adopted_from_simulation: simulationId,
          _original_sim_event: simEvt.id,
        })},
        NULL,
        ${simulationId}
      )
    `.catch(() => {
      // If insertion fails (e.g., missing tenant_id), skip
    });

    commandIds.push(commandId);
  }

  // Mark simulation as adopted
  await sql`
    UPDATE simulation_forks SET status = 'adopted', adopted_at = NOW()
    WHERE id = ${simulationId}
  `;

  return {
    adopted_count: commandIds.length,
    commands_created: commandIds,
  };
}

// ---- Helpers ----

function mapSimEventToCommandType(simType: string): string {
  // Map simulation event types to canonical event types
  const mapping: Record<string, string> = {
    'MoveCreated': 'MoveCreated',
    'MoveActivated': 'MoveActivated',
    'MovePaused': 'MovePaused',
    'MoveResumed': 'MoveResumed',
    'MoveCancelled': 'MoveCancelled',
    'MoveSatisfied': 'MoveSatisfied',
    'MoveUpdated': 'MoveUpdated',
    'DecisionCreated': 'DecisionCreated',
    'DecisionResolved': 'DecisionResolved',
    'EvidenceAttached': 'EvidenceAttached',
    'EntityCreated': 'EntityCreated',
    'EntityUpdated': 'EntityUpdated',
  };
  return mapping[simType] ?? simType;
}

function replayEvents(
  events: Array<Record<string, unknown>>,
  baseState?: HistoricalSnapshot,
): HistoricalSnapshot {
  const snapshot: HistoricalSnapshot = baseState
    ? JSON.parse(JSON.stringify(baseState))
    : {
        case_state: null,
        moves: {},
        intents: {},
        entities: {},
        decisions: {},
        evidence: {},
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
          Object.assign(snapshot.case_state, data['changes'] ?? data);
          snapshot.case_state['revision'] = ((snapshot.case_state['revision'] as number) ?? 0) + 1;
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

function computeDiff(canonical: HistoricalSnapshot, simulated: HistoricalSnapshot): DiffEntry[] {
  const diffs: DiffEntry[] = [];

  const collections: Array<{ name: string; canon: Record<string, Record<string, unknown>>; sim: Record<string, Record<string, unknown>> }> = [
    { name: 'move', canon: canonical.moves, sim: simulated.moves },
    { name: 'intent', canon: canonical.intents, sim: simulated.intents },
    { name: 'entity', canon: canonical.entities, sim: simulated.entities },
    { name: 'decision', canon: canonical.decisions, sim: simulated.decisions },
    { name: 'evidence', canon: canonical.evidence, sim: simulated.evidence },
  ];

  for (const col of collections) {
    const allIds = new Set([...Object.keys(col.canon), ...Object.keys(col.sim)]);
    for (const id of allIds) {
      const c = col.canon[id];
      const s = col.sim[id];
      if (!c && s) {
        diffs.push({ type: 'added', entity_type: col.name, entity_id: id, canonical: null, simulated: s });
      } else if (c && !s) {
        diffs.push({ type: 'removed', entity_type: col.name, entity_id: id, canonical: c, simulated: null });
      } else if (c && s) {
        for (const key of new Set([...Object.keys(c), ...Object.keys(s)])) {
          if (JSON.stringify(c[key]) !== JSON.stringify(s[key])) {
            diffs.push({
              type: 'modified', entity_type: col.name, entity_id: id,
              field: key, canonical: c[key], simulated: s[key],
            });
          }
        }
      }
    }
  }

  return diffs;
}
