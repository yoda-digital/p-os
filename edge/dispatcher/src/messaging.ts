// Cross-Session Messaging — message relay between sessions
// Spec reference: SP3 §4 (Cross-Session Messaging)
//
// Uses native `SendMessage` where available (capability-probed).
// Mirrors meaningful messages into Process Events.
// Fallback: handoff via Process Events when messaging unavailable.

import { ProcessEdge } from '@pos/edge-core';
import { SessionTracker, type TrackedSession } from './session-tracker.js';

// ── Types ────────────────────────────────────────────────────────────

export interface CrossSessionMessage {
  /** Sender session job ID */
  fromSessionId: string;
  /** Target session job ID (or move ID to find the session) */
  toSessionId?: string;
  toMoveId?: string;
  /** Message content */
  content: string;
  /** Message type */
  type: 'handoff' | 'result' | 'progress' | 'request' | 'steering';
  /** Optional structured data */
  data?: Record<string, unknown>;
  /** Timestamp */
  timestamp: string;
}

export interface MessageDeliveryResult {
  delivered: boolean;
  method: 'send_message' | 'process_event' | 'queued';
  messageId: string;
  reason?: string;
}

// ── Messaging Service ────────────────────────────────────────────────

export class CrossSessionMessaging {
  private messageQueue: CrossSessionMessage[] = [];
  private capabilities: {
    crossSessionMessaging: boolean;
    sendMessage: boolean;
  } = {
    crossSessionMessaging: false,
    sendMessage: false,
  };

  constructor(
    private tracker: SessionTracker,
    private edge: ProcessEdge,
  ) {}

  /**
   * Update capability probing result.
   * Called when the device reports its capabilities on connect/handshake.
   */
  updateCapabilities(caps: Record<string, boolean>): void {
    this.capabilities = {
      crossSessionMessaging: caps['cross_session_messaging'] ?? false,
      sendMessage: caps['send_message'] ?? false,
    };
  }

  /**
   * Send a message from one session to another.
   *
   * If cross_session_messaging is available, uses native SendMessage.
   * Otherwise, falls back to relaying via Process Events.
   */
  async send(message: CrossSessionMessage): Promise<MessageDeliveryResult> {
    const messageId = crypto.randomUUID();

    // Resolve target session
    let targetSession: TrackedSession | undefined;
    if (message.toSessionId) {
      targetSession = this.tracker.get(message.toSessionId);
    } else if (message.toMoveId) {
      targetSession = this.tracker.findByMove(message.toMoveId);
    }

    // Mirror every message into Process Events regardless of delivery method
    await this.mirrorToProcessEvent(messageId, message);

    // Try native cross-session messaging
    if (this.capabilities.crossSessionMessaging && targetSession) {
      try {
        await this.sendNative(targetSession, message);
        return {
          delivered: true,
          method: 'send_message',
          messageId,
        };
      } catch (err) {
        console.warn(
          `[Messaging] Native send failed, falling back to process event:`,
          (err as Error).message,
        );
      }
    }

    // Fallback: handoff via Process Events
    if (targetSession) {
      return {
        delivered: true,
        method: 'process_event',
        messageId,
        reason: this.capabilities.crossSessionMessaging
          ? 'Native send failed, delivered via process event'
          : 'Cross-session messaging not available, delivered via process event',
      };
    }

    // No target found — queue for later
    this.messageQueue.push(message);
    return {
      delivered: false,
      method: 'queued',
      messageId,
      reason: 'Target session not found, message queued',
    };
  }

  /**
   * Attempt to deliver queued messages.
   * Called periodically or when a new session comes online.
   */
  async flushQueue(): Promise<number> {
    if (this.messageQueue.length === 0) return 0;

    let delivered = 0;
    const remaining: CrossSessionMessage[] = [];

    for (const msg of this.messageQueue) {
      const result = await this.send(msg);
      if (result.delivered) {
        delivered++;
      } else {
        remaining.push(msg);
      }
    }

    this.messageQueue = remaining;
    return delivered;
  }

  /** Get the count of queued (undelivered) messages. */
  get queuedCount(): number {
    return this.messageQueue.length;
  }

  // ── Internal ────────────────────────────────────────────────────

  /**
   * Send via native SendMessage (when cross_session_messaging is available).
   * The dispatcher invokes `claude send-message <targetId> <content>`.
   */
  private async sendNative(
    target: TrackedSession,
    message: CrossSessionMessage,
  ): Promise<void> {
    // In production, this would use the CLI:
    // execFile('claude', ['send-message', target.jobId, message.content])
    //
    // For now, we relay through the edge as a session_message event
    // which the plugin's hook can pick up and inject.
    await this.edge.sendEvent({
      type: 'session_message',
      fromSessionId: message.fromSessionId,
      toSessionId: target.jobId,
      toMoveId: target.moveId,
      content: message.content,
      messageType: message.type,
      data: message.data,
      timestamp: message.timestamp,
    });
  }

  /**
   * Mirror a message into the Process Event stream.
   * Every cross-session message becomes a CaseEvent so the control plane
   * has a complete audit trail.
   */
  private async mirrorToProcessEvent(
    messageId: string,
    message: CrossSessionMessage,
  ): Promise<void> {
    const fromSession = this.tracker.get(message.fromSessionId);
    const caseId = fromSession?.caseId;

    if (!caseId) return; // Cannot mirror without a case context

    await this.edge.sendEvent({
      type: 'cross_session_message',
      messageId,
      caseId,
      fromSessionId: message.fromSessionId,
      fromMoveId: fromSession?.moveId,
      toSessionId: message.toSessionId,
      toMoveId: message.toMoveId,
      content: message.content,
      messageType: message.type,
      data: message.data,
      timestamp: message.timestamp,
    });
  }
}
