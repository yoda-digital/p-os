import { startEmbeddedPostgres, getConnectionString, getDb, runMigrations, closeDb, stopEmbeddedPostgres } from '@pos/db';

async function main() {
  await startEmbeddedPostgres();
  const sql = getDb(getConnectionString());
  await runMigrations(sql);
  console.log('[Migrate] Migrations complete');
  await closeDb();
  await stopEmbeddedPostgres();
  process.exit(0);
}

main().catch((err) => {
  console.error('[Migrate] Error:', err);
  process.exit(1);
});
