import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

export interface SearchQuery {
  q?: string;
  type?: string;
  caseId?: string;
  lifecycle?: string;
  priority?: string;
  actorId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  description: string | null;
  case_id: string | null;
  relevance: number;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface SearchResponse {
  query: SearchQuery;
  results: SearchResult[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Universal search across all entity types.
 * Searches: cases, moves, decisions, evidence, entities, assertions, intents, rules, events.
 * Uses ILIKE text matching + optional type/case filters.
 */
export async function universalSearch(sql: Sql, query: SearchQuery): Promise<SearchResponse> {
  const { q, type, caseId, lifecycle, priority, actorId, dateFrom, dateTo } = query;
  const limit = Math.min(query.limit ?? 50, 200);
  const offset = query.offset ?? 0;

  const results: SearchResult[] = [];
  const typesToSearch = type ? [type] : ['case', 'move', 'decision', 'evidence', 'entity', 'assertion', 'intent', 'rule'];

  const textPattern = q ? `%${q}%` : null;

  for (const searchType of typesToSearch) {
    const typeResults = await searchByType(sql, searchType, {
      textPattern,
      caseId,
      lifecycle,
      priority,
      actorId,
      dateFrom,
      dateTo,
      limit: limit + 1, // fetch one extra to detect if there are more
    });
    results.push(...typeResults);
  }

  // Sort by relevance (exact matches first, then recency)
  results.sort((a, b) => {
    if (a.relevance !== b.relevance) return b.relevance - a.relevance;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const paginated = results.slice(offset, offset + limit);

  return {
    query,
    results: paginated,
    total: results.length,
    limit,
    offset,
  };
}

async function searchByType(
  sql: Sql,
  type: string,
  opts: {
    textPattern: string | null;
    caseId?: string;
    lifecycle?: string;
    priority?: string;
    actorId?: string;
    dateFrom?: string;
    dateTo?: string;
    limit: number;
  },
): Promise<SearchResult[]> {
  const { textPattern, caseId, limit } = opts;

  switch (type) {
    case 'case':
      return searchCases(sql, textPattern, caseId, opts.lifecycle, limit);
    case 'move':
      return searchMoves(sql, textPattern, caseId, opts.priority, limit);
    case 'decision':
      return searchDecisions(sql, textPattern, caseId, limit);
    case 'evidence':
      return searchEvidence(sql, textPattern, caseId, limit);
    case 'entity':
      return searchEntities(sql, textPattern, caseId, limit);
    case 'assertion':
      return searchAssertions(sql, textPattern, caseId, limit);
    case 'intent':
      return searchIntents(sql, textPattern, caseId, limit);
    case 'rule':
      return searchRules(sql, textPattern, caseId, limit);
    default:
      return [];
  }
}

async function searchCases(sql: Sql, pattern: string | null, caseId: string | undefined, lifecycle: string | undefined, limit: number): Promise<SearchResult[]> {
  const rows = pattern
    ? await sql`
        SELECT id, title, description, lifecycle, created_at FROM cases
        WHERE (title ILIKE ${pattern} OR description ILIKE ${pattern})
        ${caseId ? sql`AND id = ${caseId}` : sql``}
        ${lifecycle ? sql`AND lifecycle = ${lifecycle}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT id, title, description, lifecycle, created_at FROM cases
        WHERE 1=1
        ${caseId ? sql`AND id = ${caseId}` : sql``}
        ${lifecycle ? sql`AND lifecycle = ${lifecycle}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `;

  return rows.map((r) => ({
    id: r.id as string,
    type: 'case',
    title: r.title as string,
    description: r.description as string | null,
    case_id: r.id as string,
    relevance: computeRelevance(pattern, r.title as string, r.description as string | null),
    created_at: (r.created_at as Date).toISOString(),
    metadata: { lifecycle: r.lifecycle },
  }));
}

async function searchMoves(sql: Sql, pattern: string | null, caseId: string | undefined, priority: string | undefined, limit: number): Promise<SearchResult[]> {
  const rows = pattern
    ? await sql`
        SELECT id, case_id, title, objective, readiness, execution, outcome, priority, created_at FROM moves
        WHERE (title ILIKE ${pattern} OR objective ILIKE ${pattern})
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ${priority ? sql`AND priority = ${priority}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT id, case_id, title, objective, readiness, execution, outcome, priority, created_at FROM moves
        WHERE 1=1
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ${priority ? sql`AND priority = ${priority}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `;

  return rows.map((r) => ({
    id: r.id as string,
    type: 'move',
    title: r.title as string,
    description: r.objective as string | null,
    case_id: r.case_id as string,
    relevance: computeRelevance(pattern, r.title as string, r.objective as string | null),
    created_at: (r.created_at as Date).toISOString(),
    metadata: { readiness: r.readiness, execution: r.execution, outcome: r.outcome, priority: r.priority },
  }));
}

async function searchDecisions(sql: Sql, pattern: string | null, caseId: string | undefined, limit: number): Promise<SearchResult[]> {
  const rows = pattern
    ? await sql`
        SELECT id, case_id, question, state, created_at FROM decisions
        WHERE question ILIKE ${pattern}
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT id, case_id, question, state, created_at FROM decisions
        WHERE 1=1
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `;

  return rows.map((r) => ({
    id: r.id as string,
    type: 'decision',
    title: r.question as string,
    description: null,
    case_id: r.case_id as string,
    relevance: computeRelevance(pattern, r.question as string, null),
    created_at: (r.created_at as Date).toISOString(),
    metadata: { state: r.state },
  }));
}

async function searchEvidence(sql: Sql, pattern: string | null, caseId: string | undefined, limit: number): Promise<SearchResult[]> {
  const rows = pattern
    ? await sql`
        SELECT id, case_id, relation, validity, source_ref, created_at FROM evidence
        WHERE (relation ILIKE ${pattern} OR source_ref::text ILIKE ${pattern})
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT id, case_id, relation, validity, source_ref, created_at FROM evidence
        WHERE 1=1
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `;

  return rows.map((r) => ({
    id: r.id as string,
    type: 'evidence',
    title: `${r.relation}: ${((r.source_ref as Record<string, unknown>)?.label as string || r.relation as string).slice(0, 80)}`,
    description: null,
    case_id: r.case_id as string,
    relevance: computeRelevance(pattern, r.relation as string, null),
    created_at: (r.created_at as Date).toISOString(),
    metadata: { validity: r.validity, evidence_type: r.relation },
  }));
}

async function searchEntities(sql: Sql, pattern: string | null, caseId: string | undefined, limit: number): Promise<SearchResult[]> {
  const rows = pattern
    ? await sql`
        SELECT id, case_id, type, title, description, created_at FROM entities
        WHERE (title ILIKE ${pattern} OR description ILIKE ${pattern} OR type ILIKE ${pattern})
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT id, case_id, type, title, description, created_at FROM entities
        WHERE 1=1
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `;

  return rows.map((r) => ({
    id: r.id as string,
    type: 'entity',
    title: r.title as string,
    description: r.description as string | null,
    case_id: r.case_id as string,
    relevance: computeRelevance(pattern, r.title as string, r.description as string | null),
    created_at: (r.created_at as Date).toISOString(),
    metadata: { entity_type: r.type },
  }));
}

async function searchAssertions(sql: Sql, pattern: string | null, caseId: string | undefined, limit: number): Promise<SearchResult[]> {
  const rows = pattern
    ? await sql`
        SELECT id, case_id, predicate, modality, status, confidence, created_at FROM assertions
        WHERE predicate ILIKE ${pattern}
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT id, case_id, predicate, modality, status, confidence, created_at FROM assertions
        WHERE 1=1
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `;

  return rows.map((r) => ({
    id: r.id as string,
    type: 'assertion',
    title: r.predicate as string,
    description: null,
    case_id: r.case_id as string,
    relevance: computeRelevance(pattern, r.predicate as string, null),
    created_at: (r.created_at as Date).toISOString(),
    metadata: { modality: r.modality, status: r.status, confidence: r.confidence },
  }));
}

async function searchIntents(sql: Sql, pattern: string | null, caseId: string | undefined, limit: number): Promise<SearchResult[]> {
  const rows = pattern
    ? await sql`
        SELECT id, case_id, class, statement, status, created_at FROM intents
        WHERE statement ILIKE ${pattern}
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT id, case_id, class, statement, status, created_at FROM intents
        WHERE 1=1
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `;

  return rows.map((r) => ({
    id: r.id as string,
    type: 'intent',
    title: r.statement as string,
    description: null,
    case_id: r.case_id as string,
    relevance: computeRelevance(pattern, r.statement as string, null),
    created_at: (r.created_at as Date).toISOString(),
    metadata: { class: r.class, status: r.status },
  }));
}

async function searchRules(sql: Sql, pattern: string | null, caseId: string | undefined, limit: number): Promise<SearchResult[]> {
  const rows = pattern
    ? await sql`
        SELECT id, case_id, type, statement, evaluation_status, created_at FROM rules
        WHERE statement ILIKE ${pattern}
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `
    : await sql`
        SELECT id, case_id, type, statement, evaluation_status, created_at FROM rules
        WHERE 1=1
        ${caseId ? sql`AND case_id = ${caseId}` : sql``}
        ORDER BY created_at DESC LIMIT ${limit}
      `;

  return rows.map((r) => ({
    id: r.id as string,
    type: 'rule',
    title: r.statement as string,
    description: null,
    case_id: r.case_id as string,
    relevance: computeRelevance(pattern, r.statement as string, null),
    created_at: (r.created_at as Date).toISOString(),
    metadata: { rule_type: r.type, evaluation_status: r.evaluation_status },
  }));
}

/**
 * Graph traversal search: find all entities connected to a source entity via relations.
 */
export async function graphSearch(sql: Sql, sourceId: string, maxDepth: number = 3): Promise<SearchResult[]> {
  const rows = await sql`
    WITH RECURSIVE graph AS (
      SELECT
        r.target_ref->>'id' AS id,
        r.target_ref->>'type' AS type,
        r.type AS relation_type,
        1 AS depth
      FROM relations r
      WHERE r.source_ref->>'id' = ${sourceId}

      UNION ALL

      SELECT
        r.target_ref->>'id',
        r.target_ref->>'type',
        r.type,
        g.depth + 1
      FROM relations r
      JOIN graph g ON r.source_ref->>'id' = g.id
      WHERE g.depth < ${maxDepth}
    )
    SELECT DISTINCT id, type, relation_type, depth FROM graph
    ORDER BY depth ASC
    LIMIT 100
  `;

  return rows.map((r) => ({
    id: r.id as string,
    type: r.type as string,
    title: `${r.type} (via ${r.relation_type})`,
    description: null,
    case_id: null,
    relevance: (maxDepth - (r.depth as number) + 1) / maxDepth,
    created_at: new Date().toISOString(),
    metadata: { relation_type: r.relation_type, depth: r.depth },
  }));
}

function computeRelevance(pattern: string | null, title: string, description: string | null): number {
  if (!pattern) return 0.5;
  const search = pattern.replace(/%/g, '').toLowerCase();
  const titleLower = (title || '').toLowerCase();
  const descLower = (description || '').toLowerCase();

  // Exact title match
  if (titleLower === search) return 1.0;
  // Title starts with search
  if (titleLower.startsWith(search)) return 0.9;
  // Title contains search
  if (titleLower.includes(search)) return 0.8;
  // Description contains search
  if (descLower.includes(search)) return 0.6;
  // Partial match via ILIKE (already filtered by SQL)
  return 0.4;
}
