/**
 * Slack Integration (SP6 §1)
 *
 * - Outbound: send notifications, approval requests to Slack channels
 * - Inbound: slash commands for approvals (e.g., /pos approve <move-id>)
 * - Inbound: message events mentioning process entities
 */

import type postgres from 'postgres';
import { ExternalPipeline, type RawExternalEvent } from '../services/external-pipeline.js';

type Sql = ReturnType<typeof postgres>;

// ── Types ────────────────────────────────────────────────────────────

export interface SlackNotification {
  channel: string;
  text: string;
  blocks?: SlackBlock[];
  thread_ts?: string;
}

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string };
  elements?: unknown[];
  accessory?: unknown;
  [key: string]: unknown;
}

interface SlackCommandPayload {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name: string;
  response_url: string;
  trigger_id: string;
}

// ── Slack Integration Service ───────────────────────────────────────

export class SlackIntegration {
  private pipeline: ExternalPipeline;

  constructor(private sql: Sql) {
    this.pipeline = new ExternalPipeline(sql);
  }

  // ── Outbound: Send Notifications ────────────────────────────────

  /**
   * Send a semantic notification to a Slack channel.
   * Notification format follows SP6 §3.2: semantic, not mechanical.
   */
  async sendNotification(
    integrationId: string,
    notification: SlackNotification,
  ): Promise<{ ok: boolean; ts?: string; error?: string }> {
    const [integration] = await this.sql`
      SELECT credentials_encrypted, settings FROM integrations
      WHERE id = ${integrationId} AND type = 'slack'
    `;

    if (!integration?.credentials_encrypted) {
      return { ok: false, error: 'Slack integration not connected' };
    }

    const botToken = integration.credentials_encrypted as string;

    try {
      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: notification.channel,
          text: notification.text,
          blocks: notification.blocks,
          thread_ts: notification.thread_ts,
        }),
      });

      const data = (await response.json()) as { ok: boolean; ts?: string; error?: string };
      return data;
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /**
   * Send an approval request with interactive buttons.
   */
  async sendApprovalRequest(
    integrationId: string,
    channel: string,
    moveId: string,
    moveTitle: string,
    caseTitle: string,
    requiredBy?: string,
  ): Promise<{ ok: boolean; ts?: string; error?: string }> {
    return this.sendNotification(integrationId, {
      channel,
      text: `Decision required: ${moveTitle}`,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `Decision Required` },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${caseTitle}*\n${moveTitle}${requiredBy ? `\n_Required by: ${requiredBy}_` : ''}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve' },
              style: 'primary',
              action_id: `pos_approve_${moveId}`,
              value: moveId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Reject' },
              style: 'danger',
              action_id: `pos_reject_${moveId}`,
              value: moveId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'View in Process OS' },
              url: `${process.env['APP_URL'] ?? 'http://localhost:3000'}/cases`,
              action_id: `pos_view_${moveId}`,
            },
          ],
        },
      ],
    });
  }

  /**
   * Send a status update notification.
   */
  async sendStatusUpdate(
    integrationId: string,
    channel: string,
    title: string,
    message: string,
    level: 'info' | 'warning' | 'error' | 'success',
  ): Promise<void> {
    const emoji: Record<string, string> = {
      info: ':information_source:',
      warning: ':warning:',
      error: ':x:',
      success: ':white_check_mark:',
    };

    await this.sendNotification(integrationId, {
      channel,
      text: `${emoji[level]} ${title}: ${message}`,
    });
  }

  // ── Inbound: Slash Command Handler ────────────────────────────

  /**
   * Handle a Slack slash command (e.g., /pos approve <move-id>).
   */
  async handleSlashCommand(
    integrationId: string,
    payload: SlackCommandPayload,
  ): Promise<{ response_type: string; text: string }> {
    const parts = payload.text.trim().split(/\s+/);
    const action = parts[0]?.toLowerCase();
    const target = parts[1];

    const rawEvent: RawExternalEvent = {
      integration_id: integrationId,
      source_type: 'slack',
      event_type: 'slash_command',
      payload: payload as unknown as Record<string, unknown>,
    };
    await this.pipeline.process(rawEvent);

    switch (action) {
      case 'approve':
        if (!target) return { response_type: 'ephemeral', text: 'Usage: /pos approve <move-id>' };
        return { response_type: 'in_channel', text: `Approval request for move ${target} submitted. A human reviewer will confirm.` };

      case 'status':
        return { response_type: 'ephemeral', text: 'Checking process status...' };

      case 'attention':
        return { response_type: 'ephemeral', text: 'Fetching your attention queue...' };

      case 'help':
        return {
          response_type: 'ephemeral',
          text: [
            '*Process OS Slack Commands:*',
            '`/pos approve <move-id>` — Submit approval for a move',
            '`/pos status` — Check current process status',
            '`/pos attention` — View your attention queue',
            '`/pos help` — Show this help',
          ].join('\n'),
        };

      default:
        return {
          response_type: 'ephemeral',
          text: `Unknown command: "${action}". Type \`/pos help\` for available commands.`,
        };
    }
  }

  // ── Inbound: Message Events ───────────────────────────────────

  /**
   * Handle a Slack message event mentioning process entities.
   */
  async handleMessageEvent(
    integrationId: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    const rawEvent: RawExternalEvent = {
      integration_id: integrationId,
      source_type: 'slack',
      event_type: 'message',
      payload: event,
    };
    await this.pipeline.process(rawEvent);
  }
}
