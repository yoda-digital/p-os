import { type Context, type Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import type postgres from 'postgres';
import { evaluate, loadActorContext, type Policy, type ResourceContext } from '@pos/policy';
import { getUser } from './auth.js';

type Sql = ReturnType<typeof postgres>;
type ResourceLoader = (c: Context, sql: Sql) => Promise<ResourceContext>;

// Cache policies for 60 seconds
let policyCache: { policies: Policy[]; expires: number } | null = null;
const POLICY_CACHE_TTL = 60_000;

async function loadPolicies(sql: Sql): Promise<Policy[]> {
  if (policyCache && policyCache.expires > Date.now()) return policyCache.policies;

  const rows = await sql`SELECT * FROM policies WHERE active = true ORDER BY priority DESC`;
  const policies = rows.map((r) => ({
    id: r.id as string,
    organization_id: r.organization_id as string | null,
    name: r.name as string,
    description: r.description as string | null,
    subject: r.subject as Policy['subject'],
    actions: r.actions as string[],
    resource: r.resource as Policy['resource'],
    environment: r.environment as Policy['environment'],
    effect: r.effect as 'allow' | 'deny',
    priority: r.priority as number,
    scope: r.scope as 'system' | 'organization' | 'workspace' | 'case',
    active: true,
  }));

  policyCache = { policies, expires: Date.now() + POLICY_CACHE_TTL };
  return policies;
}

export function invalidatePolicyCache(): void {
  policyCache = null;
}

export function createAuthorizer(sql: Sql) {
  return function authorize(action: string, resourceLoader?: ResourceLoader) {
    return createMiddleware(async (c: Context, next: Next) => {
      const user = getUser(c);

      const actorCtx = await loadActorContext(sql, user.user_id, user.organization_id);
      const policies = await loadPolicies(sql);

      const resource: ResourceContext = resourceLoader
        ? await resourceLoader(c, sql)
        : { type: 'api', organization_id: user.organization_id, attributes: {} };

      const result = evaluate(policies, {
        actor: actorCtx,
        action,
        resource,
        environment: {
          timestamp: new Date().toISOString(),
          ip: c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip'),
        },
      });

      if (!result.allowed) {
        return c.json(
          {
            error: 'Forbidden',
            error_key: 'auth.forbidden',
            reason: result.reason,
            policy_id: result.matching_policy_id,
          },
          403
        );
      }

      await next();
    });
  };
}
