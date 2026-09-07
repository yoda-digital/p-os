/**
 * process.case.search — search Cases by title/type/lifecycle (spec section 3.1).
 * Cached under a key derived from the normalized query, falls back to HTTP.
 */
import { z } from 'zod';
import { httpClient, HttpClientError } from '../http-client.js';
import { errorResult, getCache, setCache, textResult, type ToolResult } from '../shared.js';

export const caseSearchInputShape = {
  query: z.string().optional().describe('Free-text match against case title/description.'),
  type: z.string().optional().describe('Filter by case type (e.g. "feature", "incident").'),
  lifecycle: z.string().optional().describe('Filter by lifecycle state (e.g. "active", "closed").'),
  limit: z.number().int().positive().max(100).optional().describe('Max results (default 20).'),
};

export type CaseSearchInput = {
  query?: string;
  type?: string;
  lifecycle?: string;
  limit?: number;
};

function cacheKeyFor(args: CaseSearchInput): string {
  const parts = [args.query ?? '', args.type ?? '', args.lifecycle ?? '', String(args.limit ?? 20)];
  return `case-search:${parts.join('|')}`;
}

function buildQueryString(args: CaseSearchInput): string {
  const params = new URLSearchParams();
  if (args.query) params.set('query', args.query);
  if (args.type) params.set('type', args.type);
  if (args.lifecycle) params.set('lifecycle', args.lifecycle);
  params.set('limit', String(args.limit ?? 20));
  return params.toString();
}

export async function handleCaseSearch(args: CaseSearchInput): Promise<ToolResult> {
  const cacheKey = cacheKeyFor(args);
  const cached = getCache<unknown>(cacheKey);
  if (cached) return textResult(cached);

  try {
    const result = await httpClient.get(`/api/v1/cases?${buildQueryString(args)}`);
    setCache(cacheKey, result);
    return textResult(result);
  } catch (err) {
    const message = err instanceof HttpClientError ? err.message : String(err);
    return errorResult(`Case search has no cached result and the control plane is unreachable: ${message}`);
  }
}
