/**
 * process.move.get — fetch one Move's details, state vector, dependencies
 * and evidence (spec section 3.1). Local cache first (`move:<id>`).
 */
import { z } from 'zod';
import { httpClient, HttpClientError } from '../http-client.js';
import { errorResult, getCache, setCache, textResult, type ToolResult } from '../shared.js';

export const moveGetInputShape = {
  move_id: z.string().min(1).describe('Move id to fetch.'),
};

export type MoveGetInput = { move_id: string };

export async function handleMoveGet(args: MoveGetInput): Promise<ToolResult> {
  const moveId = args.move_id;
  const cacheKey = `move:${moveId}`;
  const cached = getCache<unknown>(cacheKey);
  if (cached) return textResult(cached);

  try {
    const result = await httpClient.get(`/api/v1/moves/${encodeURIComponent(moveId)}`);
    setCache(cacheKey, result);
    return textResult(result);
  } catch (err) {
    const message = err instanceof HttpClientError ? err.message : String(err);
    return errorResult(`Move ${moveId} is not cached locally and the control plane is unreachable: ${message}`);
  }
}
