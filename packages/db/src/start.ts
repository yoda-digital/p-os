import { startEmbeddedPostgres, getConnectionString } from './embedded.js';
import { runMigrations } from './migrate.js';
import { getDb, closeDb } from './client.js';
import { stopEmbeddedPostgres } from './embedded.js';

async function main() {
  console.log('[DB] Starting embedded PostgreSQL...');
  await startEmbeddedPostgres();

  const sql = getDb(getConnectionString());
  console.log('[DB] Running migrations...');
  await runMigrations(sql);

  console.log('[DB] Database ready.');

  // Keep process alive and handle clean shutdown
  process.on('SIGINT', async () => {
    console.log('\n[DB] Shutting down...');
    await closeDb();
    await stopEmbeddedPostgres();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[DB] Shutting down...');
    await closeDb();
    await stopEmbeddedPostgres();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[DB] Fatal error:', err);
  process.exit(1);
});
