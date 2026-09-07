import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

export interface EventRecord {
  id: string;
  tenant_id: string;
  case_id: string | null;
  type: string;
  actor_id: string | null;
  occurred_at: Date;
  recorded_at?: Date;
  causation_id: string | null;
  correlation_id: string | null;
  case_sequence?: number;
  data: Record<string, unknown>;
}

/**
 * Append events to the ledger. If `sql` is already a transaction context
 * (e.g. from a CommandProcessor handler), it is used directly — no nested begin.
 */
export async function appendEvents(
  sql: Sql,
  events: EventRecord[]
): Promise<EventRecord[]> {
  if (events.length === 0) return [];

  const results: EventRecord[] = [];

  for (const evt of events) {
    let caseSeq: number | null = null;

    if (evt.case_id) {
      const [seqRow] = await sql`
        INSERT INTO case_sequences (case_id, next_sequence)
        VALUES (${evt.case_id}, 2)
        ON CONFLICT (case_id) DO UPDATE SET next_sequence = case_sequences.next_sequence + 1
        RETURNING next_sequence - 1 AS seq
      `;
      caseSeq = seqRow?.seq ?? 1;
    }

    const [inserted] = await sql`
      INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, recorded_at, causation_id, correlation_id, case_sequence, data)
      VALUES (
        ${evt.id},
        ${evt.tenant_id},
        ${evt.case_id},
        ${evt.type},
        ${evt.actor_id},
        ${evt.occurred_at},
        NOW(),
        ${evt.causation_id},
        ${evt.correlation_id},
        ${caseSeq},
        ${sql.json(evt.data as any)}
      )
      RETURNING *
    `;

    await sql`
      INSERT INTO event_outbox (event_id) VALUES (${evt.id})
    `;

    results.push(inserted as unknown as EventRecord);
  }

  return results;
}

/**
 * Append events within a new standalone transaction (for callers not already in one).
 */
export async function appendEventsTransactional(
  sql: Sql,
  events: EventRecord[]
): Promise<EventRecord[]> {
  if (events.length === 0) return [];
  let results: EventRecord[] = [];
  await sql.begin(async (tx) => {
    results = await appendEvents(tx as unknown as Sql, events);
  });
  return results;
}

export async function getEventsByCaseId(
  sql: Sql,
  caseId: string,
  afterSequence?: number,
  limit = 1000
): Promise<EventRecord[]> {
  if (afterSequence != null) {
    return sql`
      SELECT * FROM events
      WHERE case_id = ${caseId} AND case_sequence > ${afterSequence}
      ORDER BY case_sequence ASC
      LIMIT ${limit}
    ` as unknown as EventRecord[];
  }
  return sql`
    SELECT * FROM events
    WHERE case_id = ${caseId}
    ORDER BY case_sequence ASC
    LIMIT ${limit}
  ` as unknown as EventRecord[];
}

export async function getEventById(
  sql: Sql,
  eventId: string
): Promise<EventRecord | null> {
  const [row] = await sql`SELECT * FROM events WHERE id = ${eventId}`;
  return (row as unknown as EventRecord) ?? null;
}

export async function getEventsByCorrelation(
  sql: Sql,
  correlationId: string
): Promise<EventRecord[]> {
  return sql`
    SELECT * FROM events
    WHERE correlation_id = ${correlationId}
    ORDER BY recorded_at ASC
  ` as unknown as EventRecord[];
}

export async function getEventsByType(
  sql: Sql,
  caseId: string,
  type: string
): Promise<EventRecord[]> {
  return sql`
    SELECT * FROM events
    WHERE case_id = ${caseId} AND type = ${type}
    ORDER BY case_sequence ASC
  ` as unknown as EventRecord[];
}

export async function getEventsUpTo(
  sql: Sql,
  caseId: string,
  upToSequence: number
): Promise<EventRecord[]> {
  return sql`
    SELECT * FROM events
    WHERE case_id = ${caseId} AND case_sequence <= ${upToSequence}
    ORDER BY case_sequence ASC
  ` as unknown as EventRecord[];
}

export async function getEventsUpToTime(
  sql: Sql,
  caseId: string,
  upToTime: Date
): Promise<EventRecord[]> {
  return sql`
    SELECT * FROM events
    WHERE case_id = ${caseId} AND occurred_at <= ${upToTime}
    ORDER BY case_sequence ASC
  ` as unknown as EventRecord[];
}
