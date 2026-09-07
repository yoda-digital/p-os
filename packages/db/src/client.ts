import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | null = null;

export function getDb(connectionString?: string): ReturnType<typeof postgres> {
  if (!sql) {
    const connStr = connectionString ?? process.env['DATABASE_URL'] ?? 'postgresql://pos:pos@localhost:5432/pos';
    sql = postgres(connStr, {
      max: 20,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
      transform: { undefined: null },
    });
  }
  return sql;
}

export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
  }
}

export type Sql = ReturnType<typeof postgres>;
