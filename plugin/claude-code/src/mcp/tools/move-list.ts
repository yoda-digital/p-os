/**
 * process.move.list — list Moves for the current (or given) Case, with
 * state (spec section 3.1). Local cache first (`moves:<caseId>`).
 */
import { z } from 'zod';
import { httpClient, HttpClientError } from '../http-client.js';
import {
  errorResult,
  getCache,
  NO_CASE_BOUND_MESSAGE,
  resolveActiveBinding,
  setCache,
  textResult,
  type ToolResult,
} from '../shared.js';

export const moveListInputShape = {
  case_id: z.string().optional().describe('Case id. Omit to use the session-bound case.'),
  status: z.string().optional().describe('Filter by Move state (e.g. "active", "satisfied").'),
};

export type MoveListInput = { case_id?: string; status?: string };

export async function handleMoveList(args: MoveListInput): Promise<ToolResult> {
  const caseId = args.case_id ?? resolveActiveBinding().caseId;
  if (!caseId) return errorResult(NO_CASE_BOUND_MESSAGE);

  const cacheKey = `moves:${caseId}${args.status ? `:${args.status}` : ''}`;
  const cached = getCache<unknown>(cacheKey);
  if (cached) return textResult(cached);

  try {
    const params = new URLSearchParams({ case_id: caseId });
    if (args.status) params.set('status', args.status);
    const result = await httpClient.get(`/api/v1/moves?${params.toString()}`);
    setCache(cacheKey, result);
    return textResult(result);
  } catch (err) {
    const message = err instanceof HttpClientError ? err.message : String(err);
    return errorResult(
      `Moves for case ${caseId} are not cached locally and the control plane is unreachable: ${message}`,
    );
  }
}
