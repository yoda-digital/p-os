// Context Orchestrator — manages session context health and generates Context Capsules

export interface ContextCapsule {
  capsuleId: string;
  caseId: string;
  caseRevision: number;
  moveId?: string;
  moveRevision?: number;
  attemptId?: string;
  generatedAt: string;
  generatorVersion: string;
  sections: {
    identity: string;
    intent: string;
    reality: string;
    decisions: string;
    constraints: string;
    progress: string;
    dependencies: string;
    evidence: string;
    delta: string;
    next: string;
    doNotRepeat: string;
  };
  includedObjectRefs: string[];
  tokenEstimate: number;
}

export interface ContextHealth {
  tokenPressure: number;
  relevanceDensity: number;
  staleAssumptionDensity: number;
  toolOutputBloat: number;
  phaseShift: boolean;
  pivotCount: number;
  remainingExpectedWork: number;
}

export type ContextAction =
  | 'CONTINUE'
  | 'COMPACT_RECOMMENDED'
  | 'ROTATE_FRESH'
  | 'RESUME'
  | 'FORK'
  | 'OFFLOAD_SUBAGENT'
  | 'OFFLOAD_WORKFLOW';

import type postgres from 'postgres';
type Sql = ReturnType<typeof postgres>;

export class ContextOrchestrator {
  constructor(private sql: Sql) {}

  async generateCapsule(
    caseId: string,
    moveId?: string,
    attemptId?: string,
  ): Promise<ContextCapsule> {
    const [caseData] = await this.sql`SELECT * FROM cases WHERE id = ${caseId}`;
    if (!caseData) throw new Error(`Case ${caseId} not found`);

    const intents =
      await this.sql`SELECT * FROM intents WHERE case_id = ${caseId} AND status = 'active'`;

    const move = moveId
      ? (await this.sql`SELECT * FROM moves WHERE id = ${moveId}`)[0]
      : null;

    const decisions =
      await this.sql`SELECT * FROM decisions WHERE case_id = ${caseId} AND state IN ('requested', 'in_review')`;

    const rules =
      await this.sql`SELECT * FROM rules WHERE case_id = ${caseId} AND evaluation_status NOT IN ('satisfied', 'not_applicable')`;

    const recentEvents = await this.sql`
      SELECT type, occurred_at, data FROM events
      WHERE case_id = ${caseId}
      ORDER BY case_sequence DESC LIMIT 10
    `;

    const evidence =
      await this.sql`SELECT * FROM evidence WHERE case_id = ${caseId} AND validity = 'valid'`;

    const dependencies = moveId
      ? await this.sql`
      SELECT m.title, m.outcome FROM moves m
      WHERE m.id = ANY(SELECT unnest(dependencies) FROM moves WHERE id = ${moveId})
    `
      : [];

    const completedMoves = await this.sql`
      SELECT title, outcome FROM moves WHERE case_id = ${caseId} AND outcome = 'satisfied' LIMIT 20
    `;

    const failedAttempts = await this.sql`
      SELECT a.failure_reason, m.title FROM attempts a JOIN moves m ON m.id = a.move_id
      WHERE a.case_id = ${caseId} AND a.state = 'failed' LIMIT 10
    `;

    const capsule: ContextCapsule = {
      capsuleId: crypto.randomUUID(),
      caseId,
      caseRevision: Number(caseData.revision),
      moveId: moveId ?? undefined,
      moveRevision: move ? Number(move.revision) : undefined,
      attemptId,
      generatedAt: new Date().toISOString(),
      generatorVersion: '0.1.0',
      sections: {
        identity: `Case: "${caseData.title}" (${caseData.lifecycle}). Type: ${caseData.type}. Organization: ${caseData.organization_id}.`,
        intent:
          intents
            .map(
              (i: Record<string, unknown>) =>
                `[${i.class}] ${i.statement} (${i.priority}, ${i.status})`,
            )
            .join('\n') || 'No active intents.',
        reality: move
          ? `Current Move: "${move.title}" (${move.class}). Execution: ${move.execution}. Outcome: ${move.outcome}. Readiness: ${move.readiness}.`
          : 'No active move.',
        decisions:
          decisions
            .map(
              (d: Record<string, unknown>) =>
                `PENDING: ${d.question} (${d.state})`,
            )
            .join('\n') || 'No pending decisions.',
        constraints:
          rules
            .map(
              (r: Record<string, unknown>) =>
                `[${r.type}] ${r.statement} — ${r.evaluation_status}`,
            )
            .join('\n') || 'No active constraints.',
        progress: `${completedMoves.length} moves completed. ${completedMoves.map((m: Record<string, unknown>) => m.title).join(', ') || 'None yet.'}`,
        dependencies:
          dependencies
            .map(
              (d: Record<string, unknown>) => `"${d.title}": ${d.outcome}`,
            )
            .join('\n') || 'No dependencies.',
        evidence: `${evidence.length} valid evidence items.`,
        delta:
          recentEvents
            .map(
              (e: Record<string, unknown>) =>
                `${e.type} at ${e.occurred_at}`,
            )
            .join('\n') || 'No recent events.',
        next: move
          ? `Continue work on "${move.title}": ${move.objective || move.title}`
          : 'No current assignment.',
        doNotRepeat:
          failedAttempts
            .map(
              (a: Record<string, unknown>) =>
                `Failed: "${a.title}" — ${a.failure_reason || 'unknown reason'}`,
            )
            .join('\n') || 'No failed approaches.',
      },
      includedObjectRefs: [caseId, ...(moveId ? [moveId] : [])],
      tokenEstimate: 0,
    };

    const fullText = Object.values(capsule.sections).join('\n');
    capsule.tokenEstimate = Math.ceil(fullText.length / 4);

    await this.sql`
      INSERT INTO context_capsules (id, case_id, case_revision, move_id, move_revision, attempt_id, generated_at, generator_version, sections, included_object_refs, token_estimate)
      VALUES (${capsule.capsuleId}, ${caseId}, ${capsule.caseRevision}, ${capsule.moveId ?? null}, ${capsule.moveRevision ?? null}, ${capsule.attemptId ?? null}, ${capsule.generatedAt}, ${capsule.generatorVersion}, ${JSON.stringify(capsule.sections)}, ${JSON.stringify(capsule.includedObjectRefs)}, ${capsule.tokenEstimate})
    `;

    return capsule;
  }

  async getLatestCapsule(caseId: string): Promise<ContextCapsule | null> {
    const [row] = await this.sql`
      SELECT * FROM context_capsules WHERE case_id = ${caseId} ORDER BY generated_at DESC LIMIT 1
    `;
    if (!row) return null;
    return {
      capsuleId: row.id,
      caseId: row.case_id,
      caseRevision: Number(row.case_revision),
      moveId: row.move_id ?? undefined,
      moveRevision: row.move_revision ? Number(row.move_revision) : undefined,
      attemptId: row.attempt_id ?? undefined,
      generatedAt: row.generated_at,
      generatorVersion: row.generator_version,
      sections: row.sections,
      includedObjectRefs: row.included_object_refs,
      tokenEstimate: row.token_estimate,
    };
  }

  assessHealth(metrics: {
    contextTokens?: number;
    pivotCount?: number;
    remainingWork?: number;
    secondsSinceLastResponse?: number;
    promptCacheLikelyExpired?: boolean;
  }): { health: ContextHealth; recommendedAction: ContextAction } {
    const health: ContextHealth = {
      tokenPressure: metrics.contextTokens ? metrics.contextTokens / 200_000 : 0,
      relevanceDensity: 0.7,
      staleAssumptionDensity: metrics.pivotCount
        ? Math.min(metrics.pivotCount * 0.1, 1)
        : 0,
      toolOutputBloat: 0.3,
      phaseShift: false,
      pivotCount: metrics.pivotCount ?? 0,
      remainingExpectedWork: metrics.remainingWork ?? 5,
    };

    let action: ContextAction = 'CONTINUE';

    if (health.tokenPressure > 0.85) {
      action = 'ROTATE_FRESH';
    } else if (health.tokenPressure > 0.7) {
      action = 'COMPACT_RECOMMENDED';
    } else if (health.staleAssumptionDensity > 0.5) {
      action = 'ROTATE_FRESH';
    } else if (health.pivotCount > 3) {
      action = 'FORK';
    } else if (
      metrics.secondsSinceLastResponse &&
      metrics.secondsSinceLastResponse > 3600 &&
      metrics.promptCacheLikelyExpired
    ) {
      action = 'ROTATE_FRESH';
    }

    return { health, recommendedAction: action };
  }

  decideSessionStrategy(metrics: {
    secondsSinceLastResponse?: number;
    contextTokens?: number;
    promptCacheLikelyExpired?: boolean;
    estimatedCacheWriteUsd?: number;
  }): 'resume' | 'resume_with_delta' | 'fork' | 'fresh' {
    if (!metrics.secondsSinceLastResponse || metrics.secondsSinceLastResponse < 300) {
      return 'resume';
    }

    if (
      metrics.promptCacheLikelyExpired &&
      metrics.contextTokens &&
      metrics.contextTokens > 100_000
    ) {
      return 'fresh';
    }

    if (
      metrics.secondsSinceLastResponse > 1800 &&
      metrics.contextTokens &&
      metrics.contextTokens > 50_000
    ) {
      return 'fork';
    }

    return 'resume_with_delta';
  }
}
