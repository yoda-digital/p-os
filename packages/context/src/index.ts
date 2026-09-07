// Context Orchestrator — manages session context health and generates Context Capsules.
//
// The generation/assessment logic lives in capsule-generator.ts (11-section Context Capsule,
// built from canonical DB state) and health.ts (DB-derived Context Health + recommended
// action). This file holds the shared types plus a thin class wrapper that binds a `Sql`
// connection to those functions, for callers that prefer an instance API
// (e.g. apps/api/src/routes/edge.ts).

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

// The nine Context Health dimensions from docs/specs_design.md §110 — no single dimension
// (e.g. raw token percentage) is a sufficient signal on its own.
export interface ContextHealth {
  tokenPressure: number;
  relevanceDensity: number;
  staleAssumptionDensity: number;
  contradictionDensity: number;
  toolOutputBloat: number;
  phaseShift: boolean;
  pivotCount: number;
  remainingExpectedWork: number;
  resumeCacheCost: number;
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

import { generateCapsule } from './capsule-generator.js';
import { assessHealth, recommendContextAction } from './health.js';

export { generateCapsule } from './capsule-generator.js';
export { assessHealth, recommendContextAction } from './health.js';

export class ContextOrchestrator {
  constructor(private sql: Sql) {}

  /** Builds the 11-section Context Capsule for a case (optionally scoped to a bound move). */
  async generateCapsule(caseId: string, moveId?: string, lastEventAck?: number): Promise<ContextCapsule> {
    return generateCapsule(this.sql, caseId, moveId, lastEventAck);
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

  /** Assesses Context Health for a session (identified by its driving Attempt id) from canonical DB state. */
  async assessHealth(
    sessionId: string,
    caseId: string,
  ): Promise<{ health: ContextHealth; recommendedAction: ContextAction }> {
    const health = await assessHealth(this.sql, sessionId, caseId);
    return { health, recommendedAction: recommendContextAction(health) };
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
