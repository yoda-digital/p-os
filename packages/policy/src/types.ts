// ABAC (Attribute-Based Access Control) types.

export interface AttributeCondition {
  attribute: string;
  operator: 'eq' | 'ne' | 'in' | 'not_in' | 'contains' | 'gte' | 'lte' | 'exists' | 'matches';
  value: unknown;
}

export interface Policy {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  subject: AttributeCondition[];
  actions: string[];
  resource: AttributeCondition[];
  environment: AttributeCondition[];
  effect: 'allow' | 'deny';
  priority: number;
  scope: 'system' | 'organization' | 'workspace' | 'case';
  active: boolean;
}

export interface ActorContext {
  user_id: string;
  email: string;
  organization_id: string;
  roles: string[];
  teams: string[];
  org_units: string[];
  case_grants: Map<string, string>; // case_id → role
  is_system_member: boolean;
}

export interface ResourceContext {
  type: string;
  id?: string;
  case_id?: string;
  workspace_id?: string;
  organization_id?: string;
  attributes: Record<string, unknown>;
}

export interface EnvironmentContext {
  timestamp: string;
  ip?: string;
  device_id?: string;
}

export interface AuthorizationRequest {
  actor: ActorContext;
  action: string;
  resource: ResourceContext;
  environment: EnvironmentContext;
}

export interface AuthorizationResult {
  allowed: boolean;
  matching_policy_id: string | null;
  reason: string;
}
