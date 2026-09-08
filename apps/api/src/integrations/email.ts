/**
 * Email Integration (SP6 §1)
 *
 * - Inbound: parse emails received via webhook (e.g., SendGrid, Mailgun inbound parse)
 * - Outbound: send notification emails, approval requests, digests
 */

import type postgres from 'postgres';
import { ExternalPipeline, type RawExternalEvent } from '../services/external-pipeline.js';

type Sql = ReturnType<typeof postgres>;

// ── Types ────────────────────────────────────────────────────────────

export interface InboundEmail {
  from: string;
  to: string;
  subject: string;
  body_text?: string;
  body_html?: string;
  attachments?: Array<{ filename: string; content_type: string; size: number }>;
  headers?: Record<string, string>;
  received_at?: string;
}

export interface OutboundEmail {
  to: string[];
  cc?: string[];
  subject: string;
  body_text: string;
  body_html?: string;
  reply_to?: string;
}

// ── Email Integration Service ───────────────────────────────────────

export class EmailIntegration {
  private pipeline: ExternalPipeline;

  constructor(private sql: Sql) {
    this.pipeline = new ExternalPipeline(sql);
  }

  // ── Inbound: Email Parsing ────────────────────────────────────

  /**
   * Process an inbound email received via webhook.
   * Emails are always routed to human review — never auto-accepted.
   */
  async handleInboundEmail(
    integrationId: string,
    email: InboundEmail,
  ): Promise<{ event_id: string; status: string }> {
    const rawEvent: RawExternalEvent = {
      integration_id: integrationId,
      source_type: 'email',
      event_type: 'email.received',
      payload: {
        from: email.from,
        to: email.to,
        subject: email.subject,
        body: email.body_text?.slice(0, 2000), // Truncate for storage
        attachment_count: email.attachments?.length ?? 0,
        received_at: email.received_at ?? new Date().toISOString(),
      },
    };

    const result = await this.pipeline.process(rawEvent);
    return {
      event_id: result.external_event_id,
      status: result.status,
    };
  }

  // ── Outbound: Send Notifications ──────────────────────────────

  /**
   * Send a notification email.
   * In production: use configured SMTP or email service provider.
   */
  async sendNotification(
    integrationId: string,
    email: OutboundEmail,
  ): Promise<{ success: boolean; message_id?: string; error?: string }> {
    const [integration] = await this.sql`
      SELECT credentials_encrypted, settings FROM integrations
      WHERE id = ${integrationId} AND type = 'email'
    `;

    if (!integration?.credentials_encrypted) {
      return { success: false, error: 'Email integration not connected' };
    }

    // In production, this would use the configured email provider
    // (SMTP via nodemailer, SendGrid API, Mailgun API, etc.)
    console.log(`[Email] Would send to ${email.to.join(', ')}: ${email.subject}`);

    return {
      success: true,
      message_id: crypto.randomUUID(),
    };
  }

  /**
   * Send a semantic approval request email.
   * Follows SP6 §3.2 notification format.
   */
  async sendApprovalRequest(
    integrationId: string,
    to: string[],
    moveTitle: string,
    caseTitle: string,
    approvalUrl: string,
    deadline?: string,
  ): Promise<void> {
    const deadlineText = deadline
      ? `\n\nDeadline: ${new Date(deadline).toLocaleString()}`
      : '';

    await this.sendNotification(integrationId, {
      to,
      subject: `Decision required: ${moveTitle}`,
      body_text: [
        `Decision required in "${caseTitle}"`,
        '',
        moveTitle,
        deadlineText,
        '',
        `Review and decide: ${approvalUrl}`,
        '',
        '-- Process OS',
      ].join('\n'),
      body_html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a2e;">Decision Required</h2>
          <p style="color: #666;">In case: <strong>${caseTitle}</strong></p>
          <div style="background: #f8f9fa; border-left: 4px solid #10b981; padding: 16px; margin: 16px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 16px; color: #1a1a2e;">${moveTitle}</p>
            ${deadline ? `<p style="margin: 8px 0 0; font-size: 14px; color: #ef4444;">Deadline: ${new Date(deadline).toLocaleString()}</p>` : ''}
          </div>
          <a href="${approvalUrl}" style="display: inline-block; background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Review & Decide
          </a>
        </div>
      `,
    });
  }

  /**
   * Send a digest email summarizing pending attention items.
   */
  async sendDigest(
    integrationId: string,
    to: string[],
    items: Array<{ title: string; priority: string; action: string; url: string }>,
  ): Promise<void> {
    if (items.length === 0) return;

    const itemsList = items
      .map((i) => `- [${i.priority.toUpperCase()}] ${i.title}: ${i.action}`)
      .join('\n');

    await this.sendNotification(integrationId, {
      to,
      subject: `Process OS: ${items.length} items need your attention`,
      body_text: [
        `You have ${items.length} items requiring attention:`,
        '',
        itemsList,
        '',
        '-- Process OS',
      ].join('\n'),
    });
  }
}
