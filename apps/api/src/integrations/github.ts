/**
 * GitHub Integration (SP6 §1 — Task 2)
 *
 * Handles GitHub webhook events, maps them to process events:
 * - PR opened/merged/closed → Move evidence
 * - Commit pushed → CommitCreated evidence
 * - Review submitted → Decision evidence
 * - Issue opened/closed → Attention raise
 *
 * Also provides OAuth connection flow placeholder.
 */

import type postgres from 'postgres';
import { ExternalPipeline, type RawExternalEvent } from '../services/external-pipeline.js';

type Sql = ReturnType<typeof postgres>;

// ── Types ────────────────────────────────────────────────────────────

export interface GitHubWebhookPayload {
  action?: string;
  sender?: { login: string; id: number; avatar_url?: string };
  repository?: { full_name: string; html_url: string; id: number };
  organization?: { login: string; id: number };
  [key: string]: unknown;
}

export interface GitHubPRPayload extends GitHubWebhookPayload {
  pull_request: {
    number: number;
    title: string;
    body?: string;
    state: string;
    html_url: string;
    head: { ref: string; sha: string };
    base: { ref: string };
    user: { login: string };
    merged: boolean;
    merged_by?: { login: string };
    additions?: number;
    deletions?: number;
    changed_files?: number;
  };
}

export interface GitHubPushPayload extends GitHubWebhookPayload {
  ref: string;
  before: string;
  after: string;
  commits: Array<{
    id: string;
    message: string;
    author: { name: string; email: string };
    url: string;
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  pusher: { name: string; email: string };
  head_commit?: { id: string; message: string };
}

export interface GitHubReviewPayload extends GitHubWebhookPayload {
  review: {
    id: number;
    state: string; // approved, changes_requested, commented
    body?: string;
    user: { login: string };
    html_url: string;
  };
  pull_request: {
    number: number;
    title: string;
    html_url: string;
  };
}

export interface GitHubIssuePayload extends GitHubWebhookPayload {
  issue: {
    number: number;
    title: string;
    body?: string;
    state: string;
    html_url: string;
    user: { login: string };
    labels: Array<{ name: string; color: string }>;
  };
}

// ── GitHub Integration Service ──────────────────────────────────────

export class GitHubIntegration {
  private pipeline: ExternalPipeline;

  constructor(private sql: Sql) {
    this.pipeline = new ExternalPipeline(sql);
  }

  /**
   * Process a raw GitHub webhook event.
   * Called by the generic webhook handler after initial parsing.
   */
  async handleWebhook(
    integrationId: string,
    eventType: string,
    payload: GitHubWebhookPayload,
  ) {
    const rawEvent: RawExternalEvent = {
      integration_id: integrationId,
      source_type: 'github',
      event_type: eventType,
      payload: payload as Record<string, unknown>,
      metadata: {
        sender: payload.sender?.login,
        repository: payload.repository?.full_name,
      },
    };

    return this.pipeline.process(rawEvent);
  }

  /**
   * Map a GitHub PR event to process Move evidence.
   */
  mapPRToEvidence(payload: GitHubPRPayload): {
    evidence_type: string;
    data: Record<string, unknown>;
    suggested_move_search: string;
  } {
    const pr = payload.pull_request;
    const action = payload.action;

    let evidenceType = 'github.pr_updated';
    if (action === 'opened') evidenceType = 'github.pr_opened';
    else if (action === 'closed' && pr.merged) evidenceType = 'github.pr_merged';
    else if (action === 'closed' && !pr.merged) evidenceType = 'github.pr_closed';

    return {
      evidence_type: evidenceType,
      data: {
        pr_number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        merged: pr.merged,
        url: pr.html_url,
        author: pr.user.login,
        head_branch: pr.head.ref,
        base_branch: pr.base.ref,
        head_sha: pr.head.sha,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
        repository: payload.repository?.full_name,
        merged_by: pr.merged_by?.login,
      },
      // Use PR title/branch to search for matching moves
      suggested_move_search: `${pr.title} ${pr.head.ref}`,
    };
  }

  /**
   * Map a Git push event to CommitCreated evidence.
   */
  mapPushToEvidence(payload: GitHubPushPayload): {
    evidence_type: string;
    data: Record<string, unknown>;
  } {
    return {
      evidence_type: 'github.commits_pushed',
      data: {
        ref: payload.ref,
        before: payload.before,
        after: payload.after,
        commit_count: payload.commits.length,
        commits: payload.commits.map((c) => ({
          sha: c.id,
          message: c.message,
          author: c.author.name,
          url: c.url,
          files_changed: c.added.length + c.removed.length + c.modified.length,
        })),
        pusher: payload.pusher.name,
        repository: payload.repository?.full_name,
        head_commit_message: payload.head_commit?.message,
      },
    };
  }

  /**
   * Map a code review to Decision evidence.
   */
  mapReviewToDecisionEvidence(payload: GitHubReviewPayload): {
    evidence_type: string;
    data: Record<string, unknown>;
    decision_input: {
      reviewer: string;
      state: string;
      weight: number;
    };
  } {
    const review = payload.review;
    const stateWeights: Record<string, number> = {
      approved: 1.0,
      changes_requested: -0.5,
      commented: 0.1,
    };

    return {
      evidence_type: 'github.review_submitted',
      data: {
        review_id: review.id,
        state: review.state,
        body: review.body,
        reviewer: review.user.login,
        pr_number: payload.pull_request.number,
        pr_title: payload.pull_request.title,
        pr_url: payload.pull_request.html_url,
        review_url: review.html_url,
        repository: payload.repository?.full_name,
      },
      decision_input: {
        reviewer: review.user.login,
        state: review.state,
        weight: stateWeights[review.state] ?? 0,
      },
    };
  }

  /**
   * Map an issue event to Attention raise.
   */
  mapIssueToAttention(payload: GitHubIssuePayload): {
    attention_priority: string;
    data: Record<string, unknown>;
  } {
    const issue = payload.issue;
    const hasBugLabel = issue.labels.some((l) => l.name.toLowerCase().includes('bug'));
    const hasUrgentLabel = issue.labels.some((l) =>
      ['urgent', 'critical', 'p0', 'p1'].includes(l.name.toLowerCase()),
    );

    let priority = 'medium';
    if (hasUrgentLabel) priority = 'critical';
    else if (hasBugLabel) priority = 'high';

    return {
      attention_priority: priority,
      data: {
        issue_number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        url: issue.html_url,
        author: issue.user.login,
        labels: issue.labels.map((l) => l.name),
        repository: payload.repository?.full_name,
        action: payload.action,
      },
    };
  }

  // ── OAuth Connection Flow (placeholder) ───────────────────────────

  /**
   * Generate OAuth authorization URL for GitHub App installation.
   */
  getAuthorizationUrl(integrationId: string, redirectUri: string): string {
    const clientId = process.env['GITHUB_CLIENT_ID'] ?? 'placeholder';
    const state = Buffer.from(JSON.stringify({ integration_id: integrationId })).toString('base64url');
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=repo,read:org`;
  }

  /**
   * Exchange OAuth code for access token and store in integration credentials.
   */
  async handleOAuthCallback(
    integrationId: string,
    code: string,
  ): Promise<{ success: boolean; message: string }> {
    // In production: exchange code for token via GitHub API
    // POST https://github.com/login/oauth/access_token
    // Store the token encrypted in integration credentials

    const clientId = process.env['GITHUB_CLIENT_ID'];
    const clientSecret = process.env['GITHUB_CLIENT_SECRET'];

    if (!clientId || !clientSecret) {
      // Store placeholder for development
      await this.sql`
        UPDATE integrations
        SET credentials_encrypted = ${'placeholder:' + code},
            settings = settings || ${this.sql.json({ oauth_connected: false, connection_status: 'pending_credentials' })}
        WHERE id = ${integrationId}
      `;
      return { success: false, message: 'GitHub OAuth credentials not configured (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)' };
    }

    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });

      const data = (await response.json()) as { access_token?: string; error?: string };

      if (data.error || !data.access_token) {
        return { success: false, message: `GitHub OAuth error: ${data.error ?? 'no access token'}` };
      }

      // Store encrypted token (in production, use proper encryption)
      await this.sql`
        UPDATE integrations
        SET credentials_encrypted = ${data.access_token},
            settings = settings || ${this.sql.json({ oauth_connected: true, connection_status: 'connected' })}
        WHERE id = ${integrationId}
      `;

      return { success: true, message: 'GitHub connected successfully' };
    } catch (err) {
      return { success: false, message: `OAuth exchange failed: ${String(err)}` };
    }
  }

  /**
   * Disconnect GitHub integration — clear stored credentials.
   */
  async disconnect(integrationId: string): Promise<void> {
    await this.sql`
      UPDATE integrations
      SET credentials_encrypted = NULL,
          settings = settings || ${this.sql.json({ oauth_connected: false, connection_status: 'disconnected' })}
      WHERE id = ${integrationId}
    `;
  }

  /**
   * Check connection status.
   */
  async getConnectionStatus(integrationId: string): Promise<{
    connected: boolean;
    status: string;
    repositories?: string[];
  }> {
    const [integration] = await this.sql`
      SELECT credentials_encrypted, settings FROM integrations WHERE id = ${integrationId}
    `;

    if (!integration || !integration.credentials_encrypted) {
      return { connected: false, status: 'not_connected' };
    }

    const settings = integration.settings as Record<string, unknown>;
    return {
      connected: settings.oauth_connected === true,
      status: (settings.connection_status as string) ?? 'unknown',
      repositories: (settings.repositories as string[]) ?? [],
    };
  }
}
