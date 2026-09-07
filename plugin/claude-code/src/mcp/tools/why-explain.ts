/**
 * process.why.explain — ask WHY about any process state: return the causal
 * chain of events/decisions/rules that produced it (spec section 3.1).
 * Local cache first (`why:<ref>`), falls back to a control-plane query.
 */
import { z } from 'zod';
import { httpClient, HttpClientError } from '../http-client.js';
import { errorResult, getCache, setCache, textResult, type ToolResult } from '../shared.js';

export const whyExplainInputShape = {
  ref: z
    .string()
    .min(1)
    .describe('Semantic ref to explain — a case, move, decision, assertion, or rule id.'),
  question: z
    .string()
    .optional()
    .describe('Optional specific question, e.g. "why is this blocked?".'),
};

export type WhyExplainInput = { ref: string; question?: string };

export async function handleWhyExplain(args: WhyExplainInput): Promise<ToolResult> {
  const cacheKey = `why:${args.ref}${args.question ? `:${args.question}` : ''}`;
  const cached = getCache<unknown>(cacheKey);
  if (cached) return textResult(cached);

  try {
    const result = await httpClient.post('/api/v1/why', { ref: args.ref, question: args.question });
    setCache(cacheKey, result);
    return textResult(result);
  } catch (err) {
    const message = err instanceof HttpClientError ? err.message : String(err);
    return errorResult(`No cached explanation for ${args.ref} and the control plane is unreachable: ${message}`);
  }
}
