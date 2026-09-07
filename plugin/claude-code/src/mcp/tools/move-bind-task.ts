/**
 * process.move.bind_task — map a Claude native task to an Attempt on a
 * Move (spec section 3.1). Creates the local session-attempt binding
 * immediately, enqueues `AttemptStarted` to the outbox, and attempts a
 * direct HTTP call to start the Attempt on the control plane.
 */
import { z } from 'zod';
import { httpClient, HttpClientError } from '../http-client.js';
import { OutboxStore } from '../../storage/outbox.js';
import { SessionStore } from '../../storage/sessions.js';
import {
  errorResult,
  resolveActiveBinding,
  textResult,
  type ToolResult,
} from '../shared.js';

export const moveBindTaskInputShape = {
  task_id: z.string().min(1).describe("Claude's native task id to bind."),
  move_id: z.string().min(1).describe('Move id the task attempts to satisfy.'),
};

export type MoveBindTaskInput = { task_id: string; move_id: string };

interface StartAttemptResponse {
  id?: string;
  attempt_id?: string;
}

export async function handleMoveBindTask(args: MoveBindTaskInput): Promise<ToolResult> {
  const binding = resolveActiveBinding();
  if (!binding.sessionId || !binding.caseId) {
    return errorResult(
      'No active session is bound to a case — cannot bind a task to an Attempt. ' +
        'Run /process:connect and bind a case first.',
    );
  }

  const outbox = new OutboxStore();
  let attemptId = `attempt-${Date.now()}`;

  try {
    const result = await httpClient.post<StartAttemptResponse>('/api/v1/attempts', {
      case_id: binding.caseId,
      move_id: args.move_id,
      task_id: args.task_id,
      session_id: binding.sessionId,
    });
    attemptId = result.id ?? result.attempt_id ?? attemptId;
  } catch {
    // Control plane unreachable — proceed with a locally-generated attempt
    // id; the outbox event will reconcile it once the edge connection drains.
  }

  new SessionStore().bind({
    sessionId: binding.sessionId,
    caseId: binding.caseId,
    moveId: args.move_id,
    attemptId,
    workspacePath: binding.workspacePath,
  });

  outbox.enqueue('AttemptStarted', {
    attemptId,
    sessionId: binding.sessionId,
    caseId: binding.caseId,
    moveId: args.move_id,
    taskId: args.task_id,
    matchConfidence: 1,
  });

  return textResult({ attemptId, moveId: args.move_id, taskId: args.task_id, caseId: binding.caseId });
}
