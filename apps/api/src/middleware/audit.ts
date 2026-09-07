import type postgres from 'postgres';
import type { Context } from 'hono';
import { getUser } from './auth.js';

type Sql = ReturnType<typeof postgres>;

export interface AuditEntry {
  action: string;
  resource_type: string;
  resource_id?: string;
  details?: Record<string, unknown>;
}

export async function auditLog(sql: Sql, c: Context, entry: AuditEntry): Promise<void> {
  const user = getUser(c);
  try {
    await sql`
      INSERT INTO audit_log (organization_id, actor_id, actor_email, action, resource_type, resource_id, details, ip_address, user_agent, impersonated_by)
      VALUES (
        ${user.organization_id},
        ${user.user_id},
        ${user.email},
        ${entry.action},
        ${entry.resource_type},
        ${entry.resource_id ?? null},
        ${sql.json((entry.details ?? {}) as any)},
        ${c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? null},
        ${c.req.header('user-agent') ?? null},
        ${user.impersonated_by ?? null}
      )
    `;
  } catch (err) {
    console.error('[Audit] Failed to log:', err);
    // Never fail the request because of audit logging
  }
}
