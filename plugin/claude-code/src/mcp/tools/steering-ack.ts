/**
 * process.steering.ack — acknowledge a steering command that was delivered
 * into this session (spec section 3.1). Marks the local steering queue
 * entry acknowledged immediately, enqueues the ack to the outbox, and
 * attempts a direct HTTP call for immediate feedback.
 */
import { z } from 'zod';
import { httpClient, HttpClientError } from '../http-client.js';
import { OutboxStore } from '../../storage/outbox.js';
import { SteeringQueueStore } from '../../storage/steering-queue.js';
import { errorResult, textResult, type ToolResult } from '../shared.js';

export const steeringAckInputShape = {
  steering_id: z.string().min(1).describe('Id of the steering command to acknowledge.'),
};

export type SteeringAckInput = { steering_id: string };

export async function handleSteeringAck(args: SteeringAckInput): Promise<ToolResult> {
  const steeringStore = new SteeringQueueStore();
  const pending = steeringStore.getPending();
  const message = pending.find((m) => m.id === args.steering_id);
  if (!message) {
    return errorResult(`No pending steering command with id ${args.steering_id} was found locally.`);
  }

  steeringStore.markAcknowledged(args.steering_id);

  new OutboxStore().enqueue('SteeringAcknowledged', {
    steeringId: args.steering_id,
    caseId: message.case_id,
    moveId: message.move_id,
  });

  try {
    const result = await httpClient.post(`/api/v1/steering/${encodeURIComponent(args.steering_id)}/ack`, {});
    return textResult(result);
  } catch (err) {
    const httpMessage = err instanceof HttpClientError ? err.message : String(err);
    return textResult(
      `Steering ${args.steering_id} acknowledged locally and queued for sync (control plane unreachable: ${httpMessage}).`,
    );
  }
}
