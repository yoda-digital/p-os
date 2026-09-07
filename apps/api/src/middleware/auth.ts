import { type Context, type Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import * as jose from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env['JWT_SECRET'] ?? 'pos-dev-secret-change-in-production'
);

export interface AuthUser {
  user_id: string;
  email: string;
  organization_id: string;
  roles: string[];
  is_system: boolean;
  preferred_language: string;
  impersonated_by?: string;
}

type Variables = { user: AuthUser };

export const authenticateRequest = createMiddleware<{ Variables: Variables }>(
  async (c: Context, next: Next) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header', error_key: 'auth.missing_token' }, 401);
    }
    const token = header.slice(7);
    try {
      const { payload } = await jose.jwtVerify(token, JWT_SECRET);
      c.set('user', {
        user_id: payload['user_id'] as string,
        email: payload['email'] as string,
        organization_id: payload['organization_id'] as string,
        roles: (payload['roles'] as string[]) ?? ['org_member'],
        is_system: (payload['is_system'] as boolean) ?? false,
        preferred_language: (payload['preferred_language'] as string) ?? 'ro',
        impersonated_by: payload['impersonated_by'] as string | undefined,
      });
      await next();
    } catch {
      return c.json({ error: 'Invalid or expired token', error_key: 'auth.invalid_token' }, 401);
    }
  }
);

// Keep backward compat alias
export const authMiddleware = authenticateRequest;

export function getUser(c: Context): AuthUser {
  return c.get('user') as AuthUser;
}

export async function signJwt(payload: Record<string, unknown>): Promise<string> {
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}
