/**
 * process.context.get — fetch the current Context Capsule, 11 sections
 * (spec sections 3.1, 7). Local cache first (`capsule:<caseId>`).
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

export const contextGetInputShape = {
  case_id: z.string().optional().describe('Case id. Omit to use the session-bound case.'),
};

export type ContextGetInput = { case_id?: string };

export async function handleContextGet(args: ContextGetInput): Promise<ToolResult> {
  const caseId = args.case_id ?? resolveActiveBinding().caseId;
  if (!caseId) return errorResult(NO_CASE_BOUND_MESSAGE);

  const cacheKey = `capsule:${caseId}`;
  const cached = getCache<unknown>(cacheKey);
  if (cached) return textResult(cached);

  try {
    const result = await httpClient.get(`/api/v1/context/${encodeURIComponent(caseId)}`);
    setCache(cacheKey, result);
    return textResult(result);
  } catch (err) {
    const message = err instanceof HttpClientError ? err.message : String(err);
    return errorResult(
      `No cached Context Capsule for case ${caseId} and the control plane is unreachable: ${message}`,
    );
  }
}
