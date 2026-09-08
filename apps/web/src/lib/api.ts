const BASE = '/api';

function getToken(): string | null {
  try {
    return localStorage.getItem('pos_token');
  } catch {
    return null;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body: any = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || body.message || res.statusText, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Process Edge routes (device pairing, event ingestion, ...) live outside
// /api/v1 on the API server (spec section 10.1) — a separate base path,
// proxied by vite under /edge in dev (see vite.config.ts).
const EDGE_BASE = '/edge/v1';

async function edgeRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${EDGE_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body: any = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || body.message || res.statusText, body);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ===== AUTH =====
export interface AuthResponse { token: string; user: User; }
export interface Membership { organization_id: string; role: string; organization_name: string; }
export interface User {
  id: string; email: string; display_name: string; organization_id?: string;
  preferred_language?: string; timezone?: string; avatar_url?: string; status?: string;
  memberships?: Membership[]; is_system?: boolean;
}
export interface UpdateProfileInput { preferred_language?: string; timezone?: string; display_name?: string; avatar_url?: string; }
export interface SwitchOrgResponse { token: string; organization: { id: string; name: string; role: string }; }
export interface PairConfirmResponse { device_id: string; auth_token: string; user_id: string; organization_id: string; }

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<AuthResponse>('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, display_name: string) =>
    request<AuthResponse>('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password, display_name }) }),
  getProfile: () => request<User>('/v1/auth/profile'),
  updateProfile: (data: UpdateProfileInput) =>
    request<User>('/v1/auth/profile', { method: 'PATCH', body: JSON.stringify(data) }),
  switchOrg: (organizationId: string) =>
    request<SwitchOrgResponse>('/v1/auth/switch-org', { method: 'POST', body: JSON.stringify({ organization_id: organizationId }) }),

  // Device pairing (spec section 8) — the authenticated web-side half of the
  // pairing flow: the plugin registers the code (POST /edge/v1/pair) and
  // polls for confirmation; this call is what a signed-in user makes from
  // the /pair page to confirm it.
  confirmPairing: (code: string) =>
    edgeRequest<PairConfirmResponse>('/pair/confirm', { method: 'POST', body: JSON.stringify({ code }) }),

  // Cases
  listCases: () => request<Case[]>('/v1/cases'),
  getCase: (id: string) => request<Case>(`/v1/cases/${id}`),
  createCase: (data: CreateCaseInput) =>
    request<Case>('/v1/cases', { method: 'POST', body: JSON.stringify(data) }),
  updateCase: (id: string, data: Partial<CreateCaseInput>) =>
    request<Case>(`/v1/cases/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  closeCase: (id: string) =>
    request<void>(`/v1/cases/${id}/close`, { method: 'POST' }),
  getCaseViews: (id: string) =>
    request<{ views: CompiledView[] }>(`/v1/cases/${id}/views`),

  // Moves — API uses /v1/moves?caseId=xxx for list, /v1/moves/:id for single
  listMoves: (caseId: string) => request<Move[]>(`/v1/moves?caseId=${caseId}`),
  getMove: (id: string) => request<Move>(`/v1/moves/${id}`),
  createMove: (caseId: string, data: CreateMoveInput) =>
    request<Move>('/v1/moves', { method: 'POST', body: JSON.stringify({ ...data, case_id: caseId }) }),
  updateMove: (id: string, data: Partial<CreateMoveInput>) =>
    request<Move>(`/v1/moves/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  activateMove: (id: string, caseId?: string) =>
    request<Move>(`/v1/moves/${id}/activate`, { method: 'POST', body: JSON.stringify({ case_id: caseId }) }),
  pauseMove: (id: string) =>
    request<void>(`/v1/moves/${id}/pause`, { method: 'POST' }),
  resumeMove: (id: string) =>
    request<void>(`/v1/moves/${id}/resume`, { method: 'POST' }),
  cancelMove: (id: string) =>
    request<void>(`/v1/moves/${id}/cancel`, { method: 'POST' }),
  satisfyMove: (id: string) =>
    request<void>(`/v1/moves/${id}/satisfy`, { method: 'POST' }),

  // Kanban — API uses /v1/kanban/:caseId
  getKanban: (caseId: string) => request<KanbanProjection>(`/v1/kanban/${caseId}`),
  moveCard: (moveId: string, fromColumn: string, toColumn: string, position: number) =>
    request<void>('/v1/kanban/move-card', { method: 'POST', body: JSON.stringify({ move_id: moveId, from_column: fromColumn, to_column: toColumn, position }) }),

  // Decisions — API uses /v1/decisions?caseId=xxx
  listDecisions: (caseId: string) => request<Decision[]>(`/v1/decisions?caseId=${caseId}`),
  getDecision: (id: string) => request<Decision & { linked_evidence?: unknown[] }>(`/v1/decisions/${id}`),
  createDecision: (caseId: string, data: CreateDecisionInput) =>
    request<Decision>('/v1/decisions', { method: 'POST', body: JSON.stringify({ ...data, case_id: caseId }) }),
  updateDecision: (id: string, data: Partial<UpdateDecisionInput>) =>
    request<Decision>(`/v1/decisions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  recommendDecision: (id: string) =>
    request<Decision>(`/v1/decisions/${id}/recommend`, { method: 'POST' }),
  resolveDecision: (id: string, selected_option: unknown, rationale: string) =>
    request<void>(`/v1/decisions/${id}/resolve`, { method: 'POST', body: JSON.stringify({ selected_option, rationale }) }),

  // Evidence — API uses /v1/evidence?caseId=xxx
  listEvidence: (caseId: string) => request<Evidence[]>(`/v1/evidence?caseId=${caseId}`),
  attachEvidence: (caseId: string, data: CreateEvidenceInput) =>
    request<Evidence>('/v1/evidence', { method: 'POST', body: JSON.stringify({ ...data, case_id: caseId }) }),

  // Intents — API uses /v1/intents?caseId=xxx
  listIntents: (caseId: string) => request<Intent[]>(`/v1/intents?caseId=${caseId}`),
  createIntent: (caseId: string, data: CreateIntentInput) =>
    request<Intent>('/v1/intents', { method: 'POST', body: JSON.stringify({ ...data, case_id: caseId }) }),

  // Entities — API uses /v1/entities?caseId=xxx
  listEntities: (caseId: string) => request<Entity[]>(`/v1/entities?caseId=${caseId}`),
  createEntity: (caseId: string, data: CreateEntityInput) =>
    request<Entity>('/v1/entities', { method: 'POST', body: JSON.stringify({ ...data, case_id: caseId }) }),

  // Relations — API uses /v1/relations?caseId=xxx
  listRelations: (caseId: string) => request<Relation[]>(`/v1/relations?caseId=${caseId}`),
  addRelation: (caseId: string, data: CreateRelationInput) =>
    request<Relation>('/v1/relations', { method: 'POST', body: JSON.stringify({ ...data, case_id: caseId }) }),

  // Rules — API uses /v1/rules?caseId=xxx
  listRules: (caseId: string) => request<Rule[]>(`/v1/rules?caseId=${caseId}`),
  createRule: (caseId: string, data: CreateRuleInput) =>
    request<Rule>('/v1/rules', { method: 'POST', body: JSON.stringify({ ...data, case_id: caseId }) }),

  // Actors
  listActors: () => request<Actor[]>('/v1/actors'),

  // Assertions — API uses query param pattern
  listAssertions: (caseId: string) => request<Assertion[]>(`/v1/entities?caseId=${caseId}&type=assertion`),
  createAssertion: (caseId: string, data: CreateAssertionInput) =>
    request<Assertion>('/v1/commands', { method: 'POST', body: JSON.stringify({ type: 'Assertion.Create', payload: { ...data, case_id: caseId } }) }),

  // Attention — API uses /v1/attention?caseId=xxx
  getAttention: (caseId: string) => request<AttentionItem[]>(`/v1/attention?caseId=${caseId}`),

  // Timeline — API uses /v1/timeline?caseId=xxx
  getTimeline: (caseId: string) => request<TimelineEntry[]>(`/v1/timeline?caseId=${caseId}`),

  // WHY — API uses POST /v1/why
  explainWhy: (caseId: string, question: string, moveId?: string) =>
    request<WhyExplanation>('/v1/why', { method: 'POST', body: JSON.stringify({ caseId, question, moveId }) }),

  // Steering
  sendSteering: (caseId: string, moveId: string, data: CreateSteeringInput) =>
    request<SendSteeringResult>('/v1/steering', { method: 'POST', body: JSON.stringify({ ...data, case_id: caseId, move_id: moveId }) }),
  getSteeringHistory: (params: { attemptId?: string; moveId?: string }) => {
    const qs = params.attemptId ? `attemptId=${params.attemptId}` : `moveId=${params.moveId}`;
    return request<SteeringCommand[]>(`/v1/steering?${qs}`);
  },
  getInstructionVersions: (attemptId: string) =>
    request<InstructionVersion[]>(`/v1/steering/versions/${attemptId}`),

  // Time Travel — API uses /v1/time-travel?caseId=xxx
  getCaseAtEvent: (caseId: string, eventId: string) =>
    request<CaseSnapshot>(`/v1/time-travel?caseId=${caseId}&eventId=${eventId}`),
  getCaseAtTime: (caseId: string, timestamp: string) =>
    request<CaseSnapshot>(`/v1/time-travel?caseId=${caseId}&timestamp=${timestamp}`),

  // Simulation — API uses /v1/simulation?caseId=xxx
  createSimulation: (caseId: string, data: CreateSimulationInput) =>
    request<SimulationFork>('/v1/simulation', { method: 'POST', body: JSON.stringify({ ...data, case_id: caseId }) }),
  listSimulations: (caseId: string) => request<SimulationFork[]>(`/v1/simulation?caseId=${caseId}`),

  // Search — API uses /v1/search?q=...&type=...
  search: (queryString: string) => request<SearchResponse>(`/v1/search?${queryString}`),
  graphSearch: (sourceId: string, maxDepth?: number) =>
    request<{ source_id: string; max_depth: number; results: SearchResultItem[] }>(`/v1/search/graph?sourceId=${sourceId}${maxDepth ? `&maxDepth=${maxDepth}` : ''}`),

  // Process Intelligence — API uses /v1/intelligence?caseId=xxx
  getMetrics: (caseId: string) => request<ProcessMetrics>(`/v1/intelligence/metrics?caseId=${caseId}`),
  getDriftReport: (caseId: string) => request<DriftReport>(`/v1/intelligence/drift?caseId=${caseId}`),

  // Process Packs
  listPacks: () => request<ProcessPack[]>('/v1/packs'),

  // Governance (SP4)
  getAutonomyProfile: (caseId: string) => request<AutonomyProfile>(`/v1/governance/autonomy?caseId=${caseId}`),
  updateAutonomyProfile: (caseId: string, data: Partial<AutonomyProfile>) =>
    request<AutonomyProfile>('/v1/governance/autonomy', { method: 'PATCH', body: JSON.stringify({ ...data, case_id: caseId }) }),
  checkGovernance: (caseId: string, action: string, actorRoles?: string[]) =>
    request<GovernanceCheckResult>('/v1/governance/check', { method: 'POST', body: JSON.stringify({ case_id: caseId, action, actor_roles: actorRoles }) }),
  getBudgetStatus: (caseId: string) => request<BudgetStatusResult>(`/v1/governance/budget?caseId=${caseId}`),
  recordGovernanceOverride: (data: GovernanceOverrideInput) =>
    request<{ id: string; status: string }>('/v1/governance/override', { method: 'POST', body: JSON.stringify(data) }),
  listGovernanceOverrides: (params: { caseId?: string; organizationId?: string; limit?: number }) =>
    request<GovernanceOverride[]>(`/v1/governance/overrides${toQueryString(params)}`),

  // Execution (SP3)
  executeMove: (moveId: string) =>
    request<ExecutionTriggerResult>(`/v1/moves/${moveId}/execute`, { method: 'POST' }),
  getExecutionStatus: (moveId: string) =>
    request<ExecutionStatus>(`/v1/moves/${moveId}/execution`),
  stopExecution: (moveId: string) =>
    request<{ status: string; attempt_id: string }>(`/v1/moves/${moveId}/stop`, { method: 'POST' }),
  getAttemptLogs: (attemptId: string) =>
    request<AttemptLogs>(`/v1/attempts/${attemptId}/logs`),

  // Attempts
  listAttempts: (moveId: string) => request<Attempt[]>(`/v1/moves/${moveId}/attempts`),

  // Resources — API uses /v1/resources?caseId=xxx
  listResources: (caseId: string) => request<Resource[]>(`/v1/resources?caseId=${caseId}`),

  // ===== Admin (system org only) =====
  listAdminOrgs: () => request<AdminOrganization[]>('/v1/admin/organizations'),
  createAdminOrg: (data: CreateOrgInput) =>
    request<AdminOrganization>('/v1/admin/organizations', { method: 'POST', body: JSON.stringify(data) }),
  updateAdminOrg: (id: string, data: UpdateOrgInput) =>
    request<AdminOrganization>(`/v1/admin/organizations/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  listAdminUsers: (params: AdminUserListParams = {}) =>
    request<AdminUserListResult>(`/v1/admin/users${toQueryString(params)}`),
  updateAdminUser: (id: string, data: UpdateAdminUserInput) =>
    request<AdminUser>(`/v1/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  impersonateUser: (id: string) =>
    request<ImpersonateResponse>(`/v1/admin/impersonate/${id}`, { method: 'POST' }),
  endImpersonation: () =>
    request<EndImpersonationResponse>('/v1/admin/impersonate/end', { method: 'POST' }),
  getAdminHealth: () => request<AdminHealth>('/v1/admin/health'),

  // ===== Audit =====
  listAudit: (params: AuditListParams = {}) =>
    request<AuditListResult>(`/v1/audit${toQueryString(params)}`),

  // ===== Teams =====
  listTeams: () => request<Team[]>('/v1/teams'),
  createTeam: (data: CreateTeamInput) =>
    request<Team>('/v1/teams', { method: 'POST', body: JSON.stringify(data) }),
  updateTeam: (id: string, data: UpdateTeamInput) =>
    request<Team>(`/v1/teams/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  addTeamMember: (teamId: string, userId: string, role?: string) =>
    request<void>(`/v1/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify({ user_id: userId, role }) }),
  removeTeamMember: (teamId: string, userId: string) =>
    request<void>(`/v1/teams/${teamId}/members/${userId}`, { method: 'DELETE' }),
  assignTeamToCase: (caseId: string, teamId: string, role?: string) =>
    request<void>(`/v1/cases/${caseId}/teams`, { method: 'POST', body: JSON.stringify({ team_id: teamId, role }) }),

  // ===== Org Members =====
  listMembers: () => request<OrgMember[]>('/v1/members'),
  updateMember: (id: string, role: string) =>
    request<void>(`/v1/members/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeMember: (id: string) => request<void>(`/v1/members/${id}`, { method: 'DELETE' }),

  // ===== Invitations =====
  listInvitations: (status?: string) =>
    request<Invitation[]>(`/v1/invitations${status ? `?status=${status}` : ''}`),
  createInvitation: (data: CreateInvitationInput) =>
    request<Invitation>('/v1/invitations', { method: 'POST', body: JSON.stringify(data) }),
  revokeInvitation: (id: string) =>
    request<{ status: string }>(`/v1/invitations/${id}/revoke`, { method: 'POST' }),
  acceptInvitation: (token: string) =>
    request<{ status: string; organization_id: string }>(`/v1/invitations/${token}/accept`, { method: 'POST' }),

  // ===== ABAC Policies =====
  listPolicies: () => request<Policy[]>('/v1/policies'),
  createPolicy: (data: CreatePolicyInput) =>
    request<Policy>('/v1/policies', { method: 'POST', body: JSON.stringify(data) }),
  updatePolicy: (id: string, data: UpdatePolicyInput) =>
    request<Policy>(`/v1/policies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePolicy: (id: string) => request<void>(`/v1/policies/${id}`, { method: 'DELETE' }),

  // ===== Organizational Units =====
  listOrgUnits: () => request<OrgUnit[]>('/v1/org-units'),
  createOrgUnit: (data: CreateOrgUnitInput) =>
    request<OrgUnit>('/v1/org-units', { method: 'POST', body: JSON.stringify(data) }),
  updateOrgUnit: (id: string, data: UpdateOrgUnitInput) =>
    request<OrgUnit>(`/v1/org-units/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
};

function toQueryString<P extends object>(params: P): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

// ===== Types =====
export interface Case {
  id: string; organization_id: string; workspace_id?: string; type: string;
  title: string; description?: string; lifecycle: string;
  primary_intent_ids: string[]; owner_actor_ids: string[];
  pack_refs: unknown[]; project_refs: unknown[]; metadata: Record<string, unknown>;
  created_at: string; created_by?: string; revision: number;
}
export interface CreateCaseInput { title: string; description?: string; type?: string; workspace_id?: string; intent_statement?: string; }

export interface Move {
  id: string; case_id: string; class: string; title: string; objective?: string;
  intent_refs: string[]; parent_move_id?: string;
  preconditions: unknown[]; postconditions: unknown[]; completion_contract?: unknown;
  required_capabilities: unknown[]; required_authority: unknown[];
  constraints: unknown[]; dependencies: string[];
  priority: string; risk: string; deadline?: string;
  execution_policy?: unknown; assigned_actor_ids: string[];
  readiness: string; execution: string; verification: string;
  attention: string; risk_level: string; temporal: string; outcome: string;
  created_at: string; created_by?: string; revision: number;
}
export interface CreateMoveInput {
  title: string; class?: string; objective?: string; priority?: string;
  risk?: string; deadline?: string; dependencies?: string[];
  assigned_actor_ids?: string[]; constraints?: string[]; intent_refs?: string[];
}

export interface KanbanProjection {
  columns: KanbanColumnData[];
}
export interface KanbanColumnData {
  id: string;
  label: string;
  cards: KanbanCard[];
}
export interface KanbanCard {
  move_id: string; title: string; class: string; executor?: string;
  execution?: string; execution_state?: string; risk: string; deadline?: string;
  verification: string; evidence_count?: number;
  evidence_progress?: { done: number; total: number };
  dependencies?: string[] | { blocked_by: number }; attention: string;
  current_activity?: string; priority: string; position: number;
  outcome?: string; assigned_actor_ids?: string[];
  column_id?: string;
}

export interface Decision {
  id: string; case_id: string; question: string; context?: string;
  options: { id: string; label: string; description?: string; evidence_refs?: string[]; risks?: string[]; tradeoffs?: string[] }[];
  evidence_refs: string[]; risk_refs: unknown[];
  recommended_option?: unknown; recommendation_confidence?: number;
  recommendation_rationale?: string; required_authority?: unknown;
  state: string; selected_option?: unknown; rationale?: string;
  decided_by?: string; decided_at?: string; blocking_move_ids: string[];
  created_at: string; created_by?: string; revision: number;
}
export interface CreateDecisionInput { question: string; context?: string; options?: { label: string; description?: string }[]; blocking_move_ids?: string[]; }
export interface UpdateDecisionInput { question?: string; context?: string; options?: Decision['options']; evidence_refs?: string[]; state?: string; required_authority?: unknown; }

export interface Evidence {
  id: string; case_id: string; subject_refs: { id: string; type: string }[];
  relation: string; artifact_ref?: unknown; source_ref?: unknown;
  scope?: unknown; provenance?: unknown; observed_at?: string;
  fresh_until?: string; confidence: number;
  validity: string; created_at: string; created_by?: string; revision: number;
}
export interface CreateEvidenceInput { subject_refs: { id: string; type: string }[]; relation: string; scope?: unknown; confidence?: number; }

export interface Intent {
  id: string; case_id: string; class: string; statement: string;
  priority: string; owner_refs: unknown[]; success_contract?: unknown;
  status: string; created_at: string; revision: number;
}
export interface CreateIntentInput { class: string; statement: string; priority?: string; }

export interface Entity { id: string; case_id: string; type: string; title: string; description?: string; properties: Record<string, unknown>; created_at: string; revision: number; }
export interface CreateEntityInput { type: string; title: string; description?: string; properties?: Record<string, unknown>; }

export interface Relation { id: string; case_id: string; source_ref: { id: string; type: string }; target_ref: { id: string; type: string }; type: string; qualifier?: string; confidence: number; created_at: string; revision: number; }
export interface CreateRelationInput { source_ref: { id: string; type: string }; target_ref: { id: string; type: string }; type: string; qualifier?: string; }

export interface Rule { id: string; case_id: string; type: string; statement: string; authority_ref?: unknown; evaluation_status: string; created_at: string; revision: number; }
export interface CreateRuleInput { type: string; statement: string; }

export interface Assertion { id: string; case_id: string; subject_ref: unknown; predicate: string; value?: unknown; modality: string; confidence: number; status: string; created_at: string; revision: number; }
export interface CreateAssertionInput { subject_ref: unknown; predicate: string; value?: unknown; modality?: string; confidence?: number; }

export interface Actor { id: string; organization_id: string; class: string; display_name: string; roles: unknown[]; capabilities: unknown[]; created_at: string; revision: number; }

export interface AttentionItem { id: string; case_id: string; move_id?: string; decision_id?: string; priority: string; reason: string; action_required?: string; actor_ids: string[]; deadline?: string; blocking_impact: number; resolved: boolean; created_at: string; }

export interface TimelineEntry { event_id: string; case_id: string; occurred_at: string; type: string; actor_id?: string; summary: string; details: Record<string, unknown>; move_id?: string; attempt_id?: string; }

export interface WhyExplanation { question: string; causal_chain: { id: string; type: string; description: string; timestamp: string; }[]; explanation: string; }

export interface CaseSnapshot { case: Case; moves: Move[]; timestamp: string; event_id: string; }

export interface SimulationFork { id: string; source_case_id: string; fork_event_id?: string; title: string; description?: string; hypothetical_changes: unknown[]; created_at: string; }
export interface CreateSimulationInput { title: string; description?: string; hypothetical_changes: unknown[]; fork_event_id?: string; }

export interface SearchResultItem { id: string; type: string; title: string; description: string | null; case_id: string | null; relevance: number; created_at: string; metadata: Record<string, unknown>; }
export interface SearchResponse { query: Record<string, unknown>; results: SearchResultItem[]; total: number; limit: number; offset: number; }

export interface ProcessMetrics { cycle_time?: string; waiting_time?: string; rework_count: number; failed_attempts: number; human_attention_time?: string; evidence_gaps: number; completion_reliability?: number; cost?: unknown; executor_performance: Record<string, unknown>; context_rotations: number; steering_frequency: number; }

export interface DriftReport { expected_process: unknown; observed_process: unknown; deviations: { type: string; description: string; evidence?: unknown; severity: string }[]; }

export interface ProcessPack { id: string; name: string; version: string; domain: string; created_at: string; }

// ===== Governance (SP4) =====
export type AutonomyLevel = 'supervised' | 'guided' | 'autonomous' | 'full_autonomous';
export interface AutonomyProfile {
  level: AutonomyLevel; auto_create_moves: boolean; auto_activate_moves: boolean;
  auto_approve_evidence: boolean; max_cost_per_attempt_usd: number;
  max_concurrent_attempts: number; require_human_approval_for: string[];
}
export interface GovernanceCheckResult { allowed: boolean; reason: string; requires_approval: boolean; required_roles?: string[]; autonomy_level?: AutonomyLevel; budget_alert?: string; }
export interface BudgetStatusResult { case_id?: string; organization_id?: string; monetary_cost_usd?: number; budget_limit_usd?: number | null; usage_pct?: number | null; alert_level: string; message?: string; }
export interface GovernanceOverrideInput { case_id?: string; organization_id?: string; action: string; original_recommendation?: string; actual_decision: string; justification: string; override_type?: string; metadata?: Record<string, unknown>; }
export interface GovernanceOverride { id: string; case_id?: string; actor_id: string; actor_name?: string; action: string; original_recommendation?: string; actual_decision: string; justification: string; override_type: string; created_at: string; }

// ===== Adaptive Views (SP4) =====
export interface CompiledView { id: string; label: string; priority: number; reason: string; }

export interface Attempt { id: string; case_id: string; move_id: string; executor_id?: string; strategy: string; state: string; model?: string; effort?: string; started_at?: string; ended_at?: string; cost?: unknown; usage?: unknown; failure_reason?: string; steering_history: unknown[]; created_at: string; revision: number; }

export interface Resource { id: string; case_id: string; type: string; name: string; capacity?: unknown; available?: unknown; reserved?: unknown; cost_per_unit?: unknown; consumable: boolean; created_at: string; revision: number; }

export interface CreateSteeringInput { class: string; instruction: string; attempt_id?: string; }

export type SteeringClass = 'advisory' | 'constraint' | 'redirect' | 'pause' | 'hard_stop' | 'fork' | 'reassign';
export type SteeringState = 'issued' | 'delivered_to_edge' | 'delivered_to_executor' | 'acknowledged' | 'applied';

export interface SteeringCommand {
  id: string;
  case_id: string;
  move_id: string;
  attempt_id: string | null;
  class: SteeringClass;
  instruction: string;
  state: SteeringState;
  issued_by: string | null;
  issued_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
  applied_at: string | null;
}

export interface SendSteeringResult { status: string; steering_id: string; state: SteeringState; }

export interface InstructionVersion {
  id: string;
  attempt_id: string;
  version: number;
  instructions: string;
  steering_id: string | null;
  created_at: string;
}

// ===== Admin =====
export interface AdminOrganization {
  id: string; name: string; slug: string; status: string; is_system?: boolean;
  settings: Record<string, unknown>; max_users?: number | null; max_cases?: number | null;
  created_at: string; user_count: number; case_count: number;
}
export interface CreateOrgInput { name: string; slug?: string; settings?: Record<string, unknown>; }
export interface UpdateOrgInput { name?: string; status?: string; settings?: Record<string, unknown>; }

export interface AdminUserMembership { organization_id: string; role: string; org_name: string; }
export interface AdminUser {
  id: string; email: string; display_name: string; status: string;
  last_login_at?: string; login_count: number; created_at: string;
  memberships: AdminUserMembership[] | null;
}
export interface AdminUserListParams { search?: string; status?: string; limit?: number; offset?: number; }
export interface AdminUserListResult { users: AdminUser[]; limit: number; offset: number; }
export interface UpdateAdminUserInput { status?: string; display_name?: string; roles?: string[]; }

export interface ImpersonateResponse { token: string; impersonating: { user_id: string; email: string; display_name: string; organization_id: string }; }
export interface EndImpersonationResponse { token?: string; status?: string; user?: { user_id: string; email: string; display_name: string } }

export interface AdminHealth {
  users: { total_users: number; active_users: number; daily_active: number; weekly_active: number; monthly_active: number };
  organizations: { total_organizations: number };
  cases: { total_cases: number; active_cases: number };
  events: { total_events: number };
  audit: { total_audit_entries: number; audit_entries_24h: number };
  tables: { table_name: string; total_size: string; row_count: number }[];
  timestamp: string;
}

// ===== Audit =====
export interface AuditEntry {
  id: string; organization_id?: string; actor_id: string; actor_email: string;
  action: string; resource_type: string; resource_id?: string;
  details: Record<string, unknown>; ip_address?: string; user_agent?: string;
  impersonated_by?: string; created_at: string;
}
export interface AuditListParams {
  action?: string; resource_type?: string; resource_id?: string; actor_id?: string;
  from?: string; to?: string; limit?: number; offset?: number;
}
export interface AuditListResult { entries: AuditEntry[]; limit: number; offset: number; }

// ===== Teams =====
export interface Team {
  id: string; organization_id: string; name: string; description?: string;
  status: string; default_case_role: string; policies: Record<string, unknown>;
  created_at: string; member_count: number;
}
export interface CreateTeamInput { name: string; description?: string; default_case_role?: string; }
export interface UpdateTeamInput { name?: string; description?: string; status?: string; default_case_role?: string; policies?: Record<string, unknown>; }

// ===== Org Members =====
export interface MemberTeam { team_id: string; role: string; team_name: string; }
export interface OrgMember {
  id: string; email: string; display_name: string; avatar_url?: string; status: string;
  last_login_at?: string; role: string; joined_at: string; teams: MemberTeam[] | null;
}

// ===== Invitations =====
export interface Invitation {
  id: string; organization_id: string; email: string; role: string;
  team_id?: string; workspace_id?: string; token?: string; status: string;
  message?: string; invited_by: string; invited_by_name?: string; invited_by_email?: string;
  expires_at: string; accepted_at?: string; accepted_by?: string; created_at: string;
}
export interface CreateInvitationInput { email: string; role?: string; team_id?: string; workspace_id?: string; message?: string; }

// ===== ABAC Policies =====
export interface AttributeCondition { attribute: string; operator: string; value: unknown; }
export interface Policy {
  id: string; organization_id: string | null; name: string; description?: string;
  subject: AttributeCondition[]; actions: string[]; resource: AttributeCondition[];
  environment: AttributeCondition[]; effect: 'allow' | 'deny'; priority: number;
  scope: string; active: boolean; created_by: string; created_at: string; updated_at: string;
}
export interface CreatePolicyInput {
  name: string; description?: string; subject: AttributeCondition[]; actions: string[];
  resource: AttributeCondition[]; environment?: AttributeCondition[]; effect: 'allow' | 'deny';
  priority?: number; scope?: string;
}
export type UpdatePolicyInput = Partial<CreatePolicyInput> & { active?: boolean };

// ===== Organizational Units =====
export interface OrgUnit {
  id: string; organization_id: string; parent_id?: string | null; name: string;
  description?: string; metadata: Record<string, unknown>; created_at: string; updated_at: string;
  member_count: number; child_count: number;
}
export interface CreateOrgUnitInput { name: string; parent_id?: string; description?: string; metadata?: Record<string, unknown>; }
export interface UpdateOrgUnitInput { name?: string; parent_id?: string | null; description?: string; metadata?: Record<string, unknown>; }

// ===== Execution (SP3) =====
export interface ExecutionTriggerResult {
  status: string;
  attempt_id: string;
  plan: ExecutionPlanSummary;
  device_id?: string;
  message?: string;
}

export interface ExecutionPlanSummary {
  moveId: string;
  executor: string;
  strategy: string;
  session_policy: string;
  model_policy: string;
  effort_policy: string;
  isolation: string;
  parallelism: number;
  verification_strategy: string;
  budget?: { max_tokens?: number; max_cost_usd?: number; max_duration_seconds?: number };
  model_hint?: string;
  why: string;
}

export interface ExecutionStatus {
  move_id: string;
  execution_state: string;
  current_attempt: {
    id: string;
    state: string;
    strategy: string;
    model?: string;
    effort?: string;
    claude_job_id?: string;
    started_at?: string;
    why?: string;
  } | null;
  attempts: {
    id: string;
    state: string;
    strategy: string;
    model?: string;
    started_at?: string;
    ended_at?: string;
    failure_reason?: string;
  }[];
  total_attempts: number;
}

export interface AttemptLogs {
  attempt_id: string;
  move_id: string;
  move_title: string;
  state: string;
  strategy: string;
  model?: string;
  claude_job_id?: string;
  started_at?: string;
  ended_at?: string;
  failure_reason?: string;
  execution_plan?: ExecutionPlanSummary;
  events: { id: string; type: string; occurred_at: string; data: Record<string, unknown> }[];
  steering: { id: string; class: string; instruction: string; state: string; issued_at: string; delivered_at?: string }[];
}
