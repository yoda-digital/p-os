// Policy and Authorization Kernel

export interface PolicyRule {
  id?: string;
  action: string;
  resource: string;
  effect: 'allow' | 'deny';
  priority?: number;
  conditions?: Record<string, unknown>;
  description?: string;
}

export interface AuthorizationRequest {
  actorId: string;
  action: string;
  resource: string;
  caseId?: string;
  context?: Record<string, unknown>;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  policyId?: string;
  matchedRule?: PolicyRule;
}

import type postgres from 'postgres';
type Sql = ReturnType<typeof postgres>;

export class PolicyEngine {
  private rules: PolicyRule[] = [];

  constructor(private sql?: Sql) {}

  async loadPolicies(): Promise<void> {
    if (!this.sql) return;
    const dbRules = await this.sql`
      SELECT * FROM rules WHERE type = 'Policy' AND evaluation_status != 'not_applicable'
    `;
    for (const r of dbRules) {
      this.rules.push({
        id: r.id as string,
        action: '*',
        resource: '*',
        effect: (r.evaluation_status as string) === 'violated' ? 'deny' : 'allow',
        description: r.statement as string,
      });
    }
  }

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  removeRule(id: string): void {
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  evaluate(request: AuthorizationRequest): AuthorizationResult {
    // Sort rules: deny first, then by priority (higher first)
    const sorted = [...this.rules].sort((a, b) => {
      if (a.effect !== b.effect) return a.effect === 'deny' ? -1 : 1;
      return (b.priority ?? 0) - (a.priority ?? 0);
    });

    // Check deny rules first
    for (const rule of sorted) {
      if (rule.effect === 'deny' && this.matches(rule, request)) {
        return {
          allowed: false,
          reason: rule.description ?? `Denied by policy: ${rule.action} on ${rule.resource}`,
          policyId: rule.id,
          matchedRule: rule,
        };
      }
    }

    // Check allow rules
    for (const rule of sorted) {
      if (rule.effect === 'allow' && this.matches(rule, request)) {
        return {
          allowed: true,
          policyId: rule.id,
          matchedRule: rule,
        };
      }
    }

    // Default: allow in dev mode
    return { allowed: true, reason: 'Default allow (no matching policy)' };
  }

  evaluateBatch(
    requests: AuthorizationRequest[],
  ): Map<string, AuthorizationResult> {
    const results = new Map<string, AuthorizationResult>();
    for (const req of requests) {
      const key = `${req.actorId}:${req.action}:${req.resource}`;
      results.set(key, this.evaluate(req));
    }
    return results;
  }

  private matches(rule: PolicyRule, request: AuthorizationRequest): boolean {
    if (rule.action !== '*' && rule.action !== request.action) return false;
    if (rule.resource !== '*' && rule.resource !== request.resource) return false;

    // Check conditions if present
    if (rule.conditions && request.context) {
      for (const [key, value] of Object.entries(rule.conditions)) {
        if (request.context[key] !== value) return false;
      }
    }

    return true;
  }

  listRules(): PolicyRule[] {
    return [...this.rules];
  }
}

// Autonomy levels per action
export type AutonomyLevel =
  | 'observe'
  | 'suggest'
  | 'operate'
  | 'autonomous'
  | 'high_autonomy';

export interface AutonomyPolicy {
  moveCreate: AutonomyLevel;
  moveActivate: AutonomyLevel;
  moveCancel: AutonomyLevel;
  evidenceAccept: AutonomyLevel;
  decisionMake: AutonomyLevel;
  financialCommitment: AutonomyLevel;
  externalCommunication: AutonomyLevel;
  policyOverride: AutonomyLevel;
  sessionRotation: AutonomyLevel;
  processReplan: AutonomyLevel;
}

export const defaultAutonomyPolicy: AutonomyPolicy = {
  moveCreate: 'suggest',
  moveActivate: 'operate',
  moveCancel: 'suggest',
  evidenceAccept: 'operate',
  decisionMake: 'suggest',
  financialCommitment: 'observe',
  externalCommunication: 'suggest',
  policyOverride: 'observe',
  sessionRotation: 'suggest',
  processReplan: 'suggest',
};

export function canActAutonomously(
  policy: AutonomyPolicy,
  action: keyof AutonomyPolicy,
): boolean {
  const level = policy[action];
  return level === 'operate' || level === 'autonomous' || level === 'high_autonomy';
}

export function requiresHumanApproval(
  policy: AutonomyPolicy,
  action: keyof AutonomyPolicy,
): boolean {
  const level = policy[action];
  return level === 'observe' || level === 'suggest';
}

// AI Proposal system
export interface AIProposal {
  id: string;
  proposedCommands: Array<{ type: string; payload: Record<string, unknown> }>;
  confidence: number;
  evidenceRefs: string[];
  rationale: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  requiredApproval: AutonomyLevel;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  proposedBy: string;
  proposedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export function shouldAutoAccept(
  proposal: AIProposal,
  policy: AutonomyPolicy,
): boolean {
  if (proposal.risk === 'critical') return false;
  if (proposal.risk === 'high' && proposal.confidence < 0.9) return false;

  // Check relevant action autonomy
  const actionKey = proposal.proposedCommands[0]?.type;
  if (!actionKey) return false;

  // Map command types to autonomy keys
  const actionMap: Record<string, keyof AutonomyPolicy> = {
    'Move.Create': 'moveCreate',
    'Move.Activate': 'moveActivate',
    'Move.Cancel': 'moveCancel',
    'Evidence.Attach': 'evidenceAccept',
    'Decision.Resolve': 'decisionMake',
  };

  const autonomyKey = actionMap[actionKey];
  if (!autonomyKey) return false;

  return canActAutonomously(policy, autonomyKey) && proposal.confidence >= 0.8;
}
