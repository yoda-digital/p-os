import * as jose from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env['JWT_SECRET'] ?? 'pos-dev-secret-change-in-production'
);

export interface TokenPayload {
  user_id: string;
  organization_id: string;
  roles: string[];
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const { payload } = await jose.jwtVerify(token, JWT_SECRET);
  return {
    user_id: payload['user_id'] as string,
    organization_id: payload['organization_id'] as string,
    roles: (payload['roles'] as string[]) ?? [],
  };
}
