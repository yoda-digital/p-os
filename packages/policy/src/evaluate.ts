import type { AttributeCondition, Policy, AuthorizationRequest, AuthorizationResult } from './types.js';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function evaluateCondition(condition: AttributeCondition, context: Record<string, unknown>): boolean {
  const actual = getNestedValue(context, condition.attribute);
  const expected = condition.value;

  switch (condition.operator) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'in':
      return Array.isArray(expected) && expected.includes(actual);
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual);
    case 'contains': {
      if (Array.isArray(actual)) return actual.includes(expected);
      if (typeof actual === 'string') return actual.includes(String(expected));
      return false;
    }
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'exists':
      return actual !== undefined && actual !== null;
    case 'matches': {
      if (typeof actual !== 'string' || typeof expected !== 'string') return false;
      return new RegExp(expected).test(actual);
    }
    default:
      return false;
  }
}

function evaluateConditions(conditions: AttributeCondition[], context: Record<string, unknown>): boolean {
  if (conditions.length === 0) return true; // no conditions = matches all
  return conditions.every((c) => evaluateCondition(c, context));
}

function actionMatches(policyActions: string[], requestedAction: string): boolean {
  return policyActions.some((pa) => pa === '*' || pa === requestedAction);
}

// Resolves special placeholder values (e.g. '__actor_org__') against the
// requesting actor before conditions are evaluated against the resource.
function resolveSpecialValues(conditions: AttributeCondition[], actor: Record<string, unknown>): AttributeCondition[] {
  return conditions.map((c) => {
    if (c.value === '__actor_org__') {
      return { ...c, value: actor['organization_id'] };
    }
    return c;
  });
}

export function evaluate(policies: Policy[], request: AuthorizationRequest): AuthorizationResult {
  const actorAsRecord = request.actor as unknown as Record<string, unknown>;
  const actorCtx = { actor: actorAsRecord };
  const resourceCtx = { resource: request.resource as unknown as Record<string, unknown> };
  const envCtx = { environment: request.environment as unknown as Record<string, unknown> };

  // Sort active policies by priority, highest first.
  const sorted = [...policies].filter((p) => p.active).sort((a, b) => b.priority - a.priority);

  // System-scoped deny policies with positive priority always win, regardless
  // of where they land in the overall priority ordering — check them first.
  const systemDenies = sorted.filter((p) => p.scope === 'system' && p.effect === 'deny' && p.priority > 0);
  for (const policy of systemDenies) {
    if (
      actionMatches(policy.actions, request.action) &&
      evaluateConditions(policy.subject, actorCtx) &&
      evaluateConditions(resolveSpecialValues(policy.resource, actorAsRecord), resourceCtx) &&
      evaluateConditions(policy.environment, envCtx)
    ) {
      return { allowed: false, matching_policy_id: policy.id, reason: `Denied by system policy: ${policy.name}` };
    }
  }

  // Evaluate all policies by priority order; first full match wins.
  for (const policy of sorted) {
    if (!actionMatches(policy.actions, request.action)) continue;
    if (!evaluateConditions(policy.subject, actorCtx)) continue;
    if (!evaluateConditions(resolveSpecialValues(policy.resource, actorAsRecord), resourceCtx)) continue;
    if (!evaluateConditions(policy.environment, envCtx)) continue;

    return {
      allowed: policy.effect === 'allow',
      matching_policy_id: policy.id,
      reason: `${policy.effect === 'allow' ? 'Allowed' : 'Denied'} by policy: ${policy.name}`,
    };
  }

  // Default deny — no policy matched.
  return { allowed: false, matching_policy_id: null, reason: 'No matching policy — default deny' };
}
