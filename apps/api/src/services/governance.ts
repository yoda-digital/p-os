/**
 * Governance Service — autonomy profiles, action authority matrix, budget controls.
 *
 * Integrates with the ABAC policy engine to check whether an AI action
 * is permitted under the current case's autonomy profile, and tracks
 * budget usage with threshold alerts.
 */

import type postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

// ── Types ───────────────────────────────────────────────────────

export type AutonomyLevel = 'supervised' | 'guided' | 'autonomous' | 'full_autonomous';

export interface AutonomyProfile {
  level: AutonomyLevel;
  auto_create_moves: boolean;
  auto_activate_moves: boolean;
  auto_approve_evidence: boolean;
  max_cost_per_attempt_usd: number;
  max_concurrent_attempts: number;
  require_human_approval_for: string[]; // action types that need approval
}

export interface ActionAuthorityEntry {
  action: string;
  required_roles: string[];
  risk_level?: string;
}

export interface BudgetStatus {
  case_id: string | null;
  organization_id: string;
  period_start: string;
  period_end: string;
  input_tokens: number;
  output_tokens: number;
  monetary_cost_usd: number;
  attempt_count: number;
  budget_limit_usd: number | null;
  alert_threshold_pct: number;
  usage_pct: number | null;
  alert_level: 'normal' | 'warning' | 'high' | 'critical' | 'exceeded';
}

export interface GovernanceCheckResult {
  allowed: boolean;
  reason: string;
  requires_approval: boolean;
  required_roles?: string[];
  autonomy_level?: AutonomyLevel;
  budget_alert?: string;
}

// ── Default Autonomy Profile ────────────────────────────────────

const DEFAULT_AUTONOMY: AutonomyProfile = {
  level: 'guided',
  auto_create_moves: false,
  auto_activate_moves: false,
  auto_approve_evidence: false,
  max_cost_per_attempt_usd: 5.0,
  max_concurrent_attempts: 3,
  require_human_approval_for: [
    'move.activate.high_risk',
    'decision.resolve',
    'evidence.invalidate',
    'steering.hard_stop',
    'budget.exceed_threshold',
  ],
};

// ── Default Authority Matrix ────────────────────────────────────

const DEFAULT_AUTHORITY_MATRIX: ActionAuthorityEntry[] = [
  { action: 'move.activate', required_roles: ['case_contributor', 'case_owner', 'org_admin'], risk_level: 'low' },
  { action: 'move.activate.high_risk', required_roles: ['case_owner', 'org_admin'] },
  { action: 'decision.resolve', required_roles: ['case_contributor', 'case_owner', 'org_admin'] },
  { action: 'evidence.invalidate', required_roles: ['case_contributor', 'case_owner'] },
  { action: 'steering.hard_stop', required_roles: ['case_owner', 'org_admin'] },
  { action: 'budget.exceed_threshold', required_roles: ['org_billing', 'org_owner', 'org_admin'] },
  { action: 'case.close', required_roles: ['case_owner', 'org_admin'] },
  { action: 'governance.override', required_roles: ['org_admin'] },
];

// ── Autonomy Profile ────────────────────────────────────────────

export async function getAutonomyProfile(sql: Sql, caseId: string): Promise<AutonomyProfile> {
  const [caseRow] = await sql`SELECT autonomy_profile FROM cases WHERE id = ${caseId}`;
  const stored = (caseRow?.autonomy_profile as Partial<AutonomyProfile>) ?? {};
  return { ...DEFAULT_AUTONOMY, ...stored };
}

export async function setAutonomyProfile(
  sql: Sql,
  caseId: string,
  profile: Partial<AutonomyProfile>
): Promise<AutonomyProfile> {
  const current = await getAutonomyProfile(sql, caseId);
  const merged = { ...current, ...profile };
  await sql`
    UPDATE cases
    SET autonomy_profile = ${sql.json(merged)}, revision = revision + 1
    WHERE id = ${caseId}
  `;
  return merged;
}

// ── Autonomy Check ──────────────────────────────────────────────

export async function checkAutonomy(
  sql: Sql,
  caseId: string,
  action: string,
  actorRoles: string[]
): Promise<GovernanceCheckResult> {
  const profile = await getAutonomyProfile(sql, caseId);

  // Check if action requires human approval under current autonomy level
  const requiresApproval = profile.require_human_approval_for.some(
    pattern => action === pattern || action.startsWith(pattern + '.')
  );

  // In supervised mode, everything requires approval
  if (profile.level === 'supervised' && !isHumanActor(actorRoles)) {
    return {
      allowed: false,
      reason: 'Case is in supervised mode — all AI actions require human approval',
      requires_approval: true,
      autonomy_level: profile.level,
    };
  }

  // In guided mode, specific actions require approval
  if (profile.level === 'guided' && requiresApproval && !isHumanActor(actorRoles)) {
    return {
      allowed: false,
      reason: `Action "${action}" requires human approval in guided autonomy mode`,
      requires_approval: true,
      autonomy_level: profile.level,
    };
  }

  // Check action authority matrix
  const authorityResult = await checkActionAuthority(sql, caseId, action, actorRoles);
  if (!authorityResult.allowed) {
    return authorityResult;
  }

  // Check budget
  const budgetResult = await checkBudget(sql, caseId);
  if (budgetResult) {
    return {
      allowed: false,
      reason: budgetResult,
      requires_approval: true,
      required_roles: ['org_billing', 'org_owner'],
      budget_alert: budgetResult,
    };
  }

  return {
    allowed: true,
    reason: `Action permitted under ${profile.level} autonomy`,
    requires_approval: false,
    autonomy_level: profile.level,
  };
}

function isHumanActor(roles: string[]): boolean {
  // Human actors have explicit roles; AI actors are typically 'agent' or 'system'
  return roles.some(r => !['agent', 'system', 'executor'].includes(r));
}

// ── Action Authority Matrix ─────────────────────────────────────

async function checkActionAuthority(
  sql: Sql,
  caseId: string,
  action: string,
  actorRoles: string[]
): Promise<GovernanceCheckResult> {
  // Load custom matrix from organization settings
  const [caseRow] = await sql`
    SELECT c.organization_id, o.settings
    FROM cases c
    JOIN organizations o ON o.id = c.organization_id
    WHERE c.id = ${caseId}
  `;

  let matrix = DEFAULT_AUTHORITY_MATRIX;
  const customMatrix = (caseRow?.settings as Record<string, unknown>)?.['action_authority_matrix'] as ActionAuthorityEntry[] | undefined;
  if (customMatrix && Array.isArray(customMatrix)) {
    matrix = [...customMatrix, ...DEFAULT_AUTHORITY_MATRIX];
  }

  // Find matching authority entry (most specific first)
  const entry = matrix.find(e => e.action === action)
    ?? matrix.find(e => action.startsWith(e.action + '.'))
    ?? matrix.find(e => action.startsWith(e.action));

  if (!entry) {
    // No authority entry means action is permitted
    return { allowed: true, reason: 'No authority restriction for this action', requires_approval: false };
  }

  // Check if actor has required role
  const hasRole = entry.required_roles.some(r => actorRoles.includes(r));
  if (!hasRole) {
    return {
      allowed: false,
      reason: `Action "${action}" requires one of: ${entry.required_roles.join(', ')}`,
      requires_approval: true,
      required_roles: entry.required_roles,
    };
  }

  return { allowed: true, reason: 'Actor has required authority', requires_approval: false };
}

// ── Budget Controls ─────────────────────────────────────────────

async function checkBudget(sql: Sql, caseId: string): Promise<string | null> {
  const [budget] = await sql`
    SELECT monetary_cost_usd, budget_limit_usd, alert_threshold_pct
    FROM budget_tracking
    WHERE case_id = ${caseId}
      AND period_start <= NOW()
      AND period_end >= NOW()
    ORDER BY period_start DESC
    LIMIT 1
  `;

  if (!budget || !budget.budget_limit_usd) return null;

  const cost = Number(budget.monetary_cost_usd ?? 0);
  const limit = Number(budget.budget_limit_usd);
  const pct = (cost / limit) * 100;

  if (pct >= 100) {
    return `Budget exceeded: $${cost.toFixed(2)} / $${limit.toFixed(2)} (${pct.toFixed(0)}%)`;
  }

  return null;
}

export async function getBudgetStatus(sql: Sql, caseId: string): Promise<BudgetStatus | null> {
  const [budget] = await sql`
    SELECT * FROM budget_tracking
    WHERE case_id = ${caseId}
      AND period_start <= NOW()
      AND period_end >= NOW()
    ORDER BY period_start DESC
    LIMIT 1
  `;

  if (!budget) return null;

  const cost = Number(budget.monetary_cost_usd ?? 0);
  const limit = budget.budget_limit_usd ? Number(budget.budget_limit_usd) : null;
  const pct = limit ? (cost / limit) * 100 : null;

  let alertLevel: BudgetStatus['alert_level'] = 'normal';
  if (pct != null) {
    if (pct >= 100) alertLevel = 'exceeded';
    else if (pct >= 90) alertLevel = 'critical';
    else if (pct >= 75) alertLevel = 'high';
    else if (pct >= 50) alertLevel = 'warning';
  }

  return {
    case_id: budget.case_id as string | null,
    organization_id: budget.organization_id as string,
    period_start: (budget.period_start as Date).toISOString(),
    period_end: (budget.period_end as Date).toISOString(),
    input_tokens: Number(budget.input_tokens ?? 0),
    output_tokens: Number(budget.output_tokens ?? 0),
    monetary_cost_usd: cost,
    attempt_count: Number(budget.attempt_count ?? 0),
    budget_limit_usd: limit,
    alert_threshold_pct: Number(budget.alert_threshold_pct ?? 75),
    usage_pct: pct != null ? Math.round(pct * 10) / 10 : null,
    alert_level: alertLevel,
  };
}

export async function trackBudgetUsage(
  sql: Sql,
  caseId: string,
  organizationId: string,
  usage: { input_tokens?: number; output_tokens?: number; cost_usd?: number }
): Promise<void> {
  // Upsert for current month
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  await sql`
    INSERT INTO budget_tracking (id, case_id, organization_id, period_start, period_end,
                                 input_tokens, output_tokens, monetary_cost_usd, attempt_count)
    VALUES (
      gen_random_uuid(), ${caseId}, ${organizationId},
      ${periodStart.toISOString()}, ${periodEnd.toISOString()},
      ${usage.input_tokens ?? 0}, ${usage.output_tokens ?? 0},
      ${usage.cost_usd ?? 0}, 1
    )
    ON CONFLICT (case_id, organization_id, period_start) DO UPDATE SET
      input_tokens = budget_tracking.input_tokens + EXCLUDED.input_tokens,
      output_tokens = budget_tracking.output_tokens + EXCLUDED.output_tokens,
      monetary_cost_usd = budget_tracking.monetary_cost_usd + EXCLUDED.monetary_cost_usd,
      attempt_count = budget_tracking.attempt_count + 1,
      updated_at = NOW()
  `.catch(async () => {
    // Fallback if no unique constraint on (case_id, organization_id, period_start)
    const [existing] = await sql`
      SELECT id FROM budget_tracking
      WHERE case_id = ${caseId} AND organization_id = ${organizationId}
        AND period_start = ${periodStart.toISOString()}
    `;
    if (existing) {
      await sql`
        UPDATE budget_tracking
        SET input_tokens = input_tokens + ${usage.input_tokens ?? 0},
            output_tokens = output_tokens + ${usage.output_tokens ?? 0},
            monetary_cost_usd = monetary_cost_usd + ${usage.cost_usd ?? 0},
            attempt_count = attempt_count + 1,
            updated_at = NOW()
        WHERE id = ${existing.id}
      `;
    } else {
      await sql`
        INSERT INTO budget_tracking (id, case_id, organization_id, period_start, period_end,
                                     input_tokens, output_tokens, monetary_cost_usd, attempt_count)
        VALUES (gen_random_uuid(), ${caseId}, ${organizationId},
                ${periodStart.toISOString()}, ${periodEnd.toISOString()},
                ${usage.input_tokens ?? 0}, ${usage.output_tokens ?? 0},
                ${usage.cost_usd ?? 0}, 1)
      `;
    }
  });
}

// ── Governance Override Recording ────────────────────────────────

export async function recordGovernanceOverride(
  sql: Sql,
  params: {
    case_id: string | null;
    organization_id: string;
    actor_id: string;
    action: string;
    original_recommendation: string | null;
    actual_decision: string;
    justification: string;
    override_type?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO governance_overrides
      (id, case_id, organization_id, actor_id, action,
       original_recommendation, actual_decision, justification,
       override_type, metadata)
    VALUES (
      ${id}, ${params.case_id}, ${params.organization_id}, ${params.actor_id},
      ${params.action}, ${params.original_recommendation}, ${params.actual_decision},
      ${params.justification}, ${params.override_type ?? 'policy'},
      ${sql.json(params.metadata ?? {})}
    )
  `;

  // Emit governance event
  if (params.case_id) {
    const eventId = crypto.randomUUID();
    await sql`
      INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, data)
      VALUES (${eventId}, ${params.organization_id}, ${params.case_id},
              'GovernanceOverride', ${params.actor_id}, NOW(),
              ${sql.json({
                override_id: id,
                action: params.action,
                override_type: params.override_type ?? 'policy',
                justification: params.justification,
              })})
    `;
    await sql`INSERT INTO event_outbox (event_id) VALUES (${eventId})`;
  }

  return id;
}

// ── Governance API Helpers ───────────────────────────────────────

export async function getGovernanceOverrides(
  sql: Sql,
  params: { case_id?: string; organization_id?: string; limit?: number; offset?: number }
): Promise<unknown[]> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  if (params.case_id) {
    return sql`
      SELECT go.*, u.display_name AS actor_name, u.email AS actor_email
      FROM governance_overrides go
      JOIN users u ON u.id = go.actor_id
      WHERE go.case_id = ${params.case_id}
      ORDER BY go.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  if (params.organization_id) {
    return sql`
      SELECT go.*, u.display_name AS actor_name, u.email AS actor_email
      FROM governance_overrides go
      JOIN users u ON u.id = go.actor_id
      WHERE go.organization_id = ${params.organization_id}
      ORDER BY go.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return [];
}
