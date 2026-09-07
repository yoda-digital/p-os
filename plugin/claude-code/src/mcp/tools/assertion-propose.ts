/**
 * process.assertion.propose — propose a factual assertion about an entity
 * in the current Case (spec section 3.1). Outbox-first, then a direct HTTP
 * call for immediate feedback.
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

export const assertionProposeInputShape = {
  case_id: z.string().optional().describe('Case id. Omit to use the session-bound case.'),
  subject: z.string().min(1).describe('Entity or ref the assertion is about.'),
  predicate: z.string().min(1).describe('The claim being made about the subject.'),
  object: z.string().optional().describe('Value/target of the predicate, if applicable.'),
  modality: z
    .enum(['asserted', 'believed', 'disputed', 'verified'])
    .optional()
    .describe('Confidence modality (default "asserted").'),
  source: z.string().optional().describe('Where this assertion comes from (evidence ref, human, tool).'),
};

export type AssertionProposeInput = {
  case_id?: string;
  subject: string;
  predicate: string;
  object?: string;
  modality?: string;
  source?: string;
};

export async function handleAssertionPropose(args: AssertionProposeInput): Promise<ToolResult> {
  const caseId = args.case_id ?? resolveActiveBinding().caseId;
  if (!caseId) return errorResult(NO_CASE_BOUND_MESSAGE);

  const payload = {
    caseId,
    subject: args.subject,
    predicate: args.predicate,
    object: args.object,
    modality: args.modality ?? 'asserted',
    source: args.source,
  };

  new OutboxStore().enqueue('AssertionProposed', payload);

  try {
    const result = await httpClient.post('/api/v1/assertions', {
      case_id: caseId,
      subject: args.subject,
      predicate: args.predicate,
      object: args.object,
      modality: args.modality ?? 'asserted',
      source: args.source,
    });
    return textResult(result);
  } catch (err) {
    const message = err instanceof HttpClientError ? err.message : String(err);
    return textResult(`Assertion proposed and queued for processing (control plane unreachable: ${message}).`);
  }
}
