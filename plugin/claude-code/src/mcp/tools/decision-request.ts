/**
 * process.decision.request — request a human decision on the current Case
 * (spec section 3.1). Outbox-first, then a direct HTTP call for immediate
 * feedback.
 */
import { z } from 'zod';
import { httpClient, HttpClientError } from '../http-client.js';
import { OutboxStore } from '../../storage/outbox.js';
import {
  errorResult,
  NO_CASE_BOUND_MESSAGE,
  resolveActiveBinding,
  textResult,
  type ToolResult,
} from '../shared.js';

export const decisionRequestInputShape = {
  case_id: z.string().optional().describe('Case id. Omit to use the session-bound case.'),
  move_id: z.string().optional().describe('Move id this decision blocks, if any.'),
  question: z.string().min(1).describe('The question a human needs to decide.'),
  options: z.array(z.string()).optional().describe('Candidate options to choose from.'),
  urgency: z.enum(['low', 'normal', 'high', 'blocking']).optional().describe('How urgent this decision is.'),
};

export type DecisionRequestInput = {
  case_id?: string;
  move_id?: string;
  question: string;
  options?: string[];
  urgency?: string;
};

export async function handleDecisionRequest(args: DecisionRequestInput): Promise<ToolResult> {
  const active = resolveActiveBinding();
  const caseId = args.case_id ?? active.caseId;
  if (!caseId) return errorResult(NO_CASE_BOUND_MESSAGE);
  const moveId = args.move_id ?? active.moveId ?? undefined;

  const payload = {
    caseId,
    moveId,
    question: args.question,
    options: args.options,
    urgency: args.urgency ?? 'normal',
  };

  new OutboxStore().enqueue('DecisionRequested', payload);

  try {
    const result = await httpClient.post('/api/v1/decisions', {
      case_id: caseId,
      move_id: moveId,
      question: args.question,
      options: args.options,
      urgency: args.urgency ?? 'normal',
    });
    return textResult(result);
  } catch (err) {
    const message = err instanceof HttpClientError ? err.message : String(err);
    return textResult(
      `Decision request queued for processing (control plane unreachable: ${message}). A human will be notified once it syncs.`,
    );
  }
}
