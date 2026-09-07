/**
 * process.move.propose — propose a new Move on the current Case (spec
 * section 3.1). Enqueues to the local outbox first (so the proposal is
 * durable even if offline), then attempts a direct HTTP call for
 * immediate feedback.
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

export const movePropseInputShape = {
  case_id: z.string().optional().describe('Case id. Omit to use the session-bound case.'),
  title: z.string().min(1).describe('Short Move title.'),
  objective: z.string().optional().describe('What this Move should achieve.'),
  move_class: z.string().optional().describe('Move class (e.g. "task", "spike", "fix").'),
  priority: z.string().optional().describe('Priority hint (e.g. "low", "normal", "high").'),
  risk: z.string().optional().describe('Risk hint (e.g. "low", "medium", "high").'),
};

export type MoveProposeInput = {
  case_id?: string;
  title: string;
  objective?: string;
  move_class?: string;
  priority?: string;
  risk?: string;
};

export async function handleMovePropose(args: MoveProposeInput): Promise<ToolResult> {
  const caseId = args.case_id ?? resolveActiveBinding().caseId;
  if (!caseId) return errorResult(NO_CASE_BOUND_MESSAGE);

  const payload = {
    caseId,
    title: args.title,
    objective: args.objective,
    moveClass: args.move_class,
    priority: args.priority,
    risk: args.risk,
  };

  new OutboxStore().enqueue('MoveProposed', payload);

  try {
    const result = await httpClient.post('/api/v1/moves', {
      case_id: caseId,
      title: args.title,
      objective: args.objective,
      move_class: args.move_class,
      priority: args.priority,
      risk: args.risk,
    });
    return textResult(result);
  } catch (err) {
    const message = err instanceof HttpClientError ? err.message : String(err);
    return textResult(
      `Move "${args.title}" proposed and queued for processing (control plane unreachable: ${message}).`,
    );
  }
}
