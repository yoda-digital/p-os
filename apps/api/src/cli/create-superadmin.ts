#!/usr/bin/env tsx
/**
 * CLI command to create or promote a user to superadmin.
 *
 * Usage:
 *   npx tsx apps/api/src/cli/create-superadmin.ts <email> <password>
 *
 * If the user already exists, grants system org membership without changing the password.
 * If the user does not exist, creates them with the given credentials.
 */
import { getDb } from '@pos/db';
import { scryptSync, randomBytes } from 'node:crypto';

const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000000';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error('Usage: npx tsx apps/api/src/cli/create-superadmin.ts <email> <password>');
    process.exit(1);
  }

  const sql = getDb();

  // Check if user exists
  let [user] = await sql`SELECT id FROM users WHERE email = ${email}`;

  if (!user) {
    const userId = crypto.randomUUID();
    const passwordHash = hashPassword(password);
    await sql`
      INSERT INTO users (id, email, display_name, password_hash, status)
      VALUES (${userId}, ${email}, 'Superadmin', ${passwordHash}, 'active')
    `;
    user = { id: userId };
    console.log(`Created user ${email} (${userId})`);
  } else {
    console.log(`User ${email} already exists (${user.id})`);
  }

  // Check if already superadmin
  const [existing] = await sql`
    SELECT 1 FROM memberships WHERE user_id = ${user.id} AND organization_id = ${SYSTEM_ORG_ID}
  `;

  if (existing) {
    console.log(`User ${email} is already a superadmin`);
  } else {
    await sql`
      INSERT INTO memberships (user_id, organization_id, role, status)
      VALUES (${user.id}, ${SYSTEM_ORG_ID}, 'superadmin', 'active')
    `;
    console.log(`Granted superadmin role to ${email}`);
  }

  await sql.end();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
