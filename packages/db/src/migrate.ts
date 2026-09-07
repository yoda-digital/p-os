import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export async function runMigrations(sql: Sql): Promise<void> {
  // Ensure the _migrations tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Read all .sql files from the migrations directory, sorted by name
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    // Check if this migration was already applied
    const applied = await sql`
      SELECT 1 FROM _migrations WHERE name = ${file}
    `;

    if (applied.length > 0) {
      console.log(`[DB] Migration ${file} already applied, skipping`);
      continue;
    }

    // Read and execute the migration SQL
    const filePath = path.join(MIGRATIONS_DIR, file);
    const migrationSql = fs.readFileSync(filePath, 'utf-8');

    console.log(`[DB] Applying migration ${file}...`);

    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSql);
      await tx`
        INSERT INTO _migrations (name) VALUES (${file})
      `;
    });

    console.log(`[DB] Migration ${file} applied successfully`);
  }

  console.log('[DB] All migrations applied');
}
