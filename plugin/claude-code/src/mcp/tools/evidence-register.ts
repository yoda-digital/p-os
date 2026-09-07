/**
 * process.evidence.register — register Evidence (test pass, commit, review,
 * ...) against a Case/Move/Attempt (spec section 3.1). Outbox-first, then
 * a direct HTTP call for immediate feedback.
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

export const evidenceRegisterInputShape = {
  case_id: z.string().optional().describe('Case id. Omit to use the session-bound case.'),
  move_id: z.string().optional().describe('Move id this evidence supports. Omit to use the session-bound move.'),
  attempt_id: z.string().optional().describe('Attempt id this evidence was produced by.'),
  type: z.string().min(1).describe('Evidence type (e.g. "test_run", "commit", "review", "artifact").'),
  description: z.string().optional().describe('Human-readable summary of the evidence.'),
  ref: z.string().optional().describe('Reference to the evidence source (URL, commit SHA, file path).'),
  data: z.record(z.string(), z.unknown()).optional().describe('Structured evidence payload (e.g. test results).'),
};

export type EvidenceRegisterInput = {
  case_id?: string;
  move_id?: string;
  attempt_id?: string;
  type: string;
  description?: string;
  ref?: string;
  data?: Record<string, unknown>;
};

export async function handleEvidenceRegister(args: EvidenceRegisterInput): Promise<ToolResult> {
  const active = resolveActiveBinding();
  const caseId = args.case_id ?? active.caseId;
  if (!caseId) return errorResult(NO_CASE_BOUND_MESSAGE);
  const moveId = args.move_id ?? active.moveId ?? undefined;
  const attemptId = args.attempt_id ?? active.attemptId ?? undefined;

  const payload = {
    caseId,
    moveId,
    attemptId,
    type: args.type,
    description: args.description,
    ref: args.ref,
    data: args.data,
  };

  new OutboxStore().enqueue('EvidenceRegistered', payload);

  try {
    const result = await httpClient.post('/api/v1/evidence', {
      case_id: caseId,
      move_id: moveId,
      attempt_id: attemptId,
      type: args.type,
      description: args.description,
      ref: args.ref,
      data: args.data,
    });
    return textResult(result);
  } catch (err) {
    const message = err instanceof HttpClientError ? err.message : String(err);
    return textResult(
      `Evidence (${args.type}) registered and queued for processing (control plane unreachable: ${message}).`,
    );
  }
}
