/**
 * process.case.get — fetch the current bound Case (spec section 3.1).
 * Local cache first (`case:<id>`), falls back to the control plane.
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

export const caseGetInputShape = {
  case_id: z
    .string()
    .optional()
    .describe('Case id to fetch. Omit to use the case bound to the active session.'),
};

export type CaseGetInput = { case_id?: string };

export async function handleCaseGet(args: CaseGetInput): Promise<ToolResult> {
  const caseId = args.case_id ?? resolveActiveBinding().caseId;
  if (!caseId) return errorResult(NO_CASE_BOUND_MESSAGE);

  const cacheKey = `case:${caseId}`;
  const cached = getCache<unknown>(cacheKey);
  if (cached) return textResult(cached);

  try {
    const result = await httpClient.get(`/api/v1/cases/${encodeURIComponent(caseId)}`);
    setCache(cacheKey, result);
    return textResult(result);
  } catch (err) {
    const message = err instanceof HttpClientError ? err.message : String(err);
    return errorResult(`Case ${caseId} is not cached locally and the control plane is unreachable: ${message}`);
  }
}
