/**
 * Universal Process OS — Kernel
 *
 * The semantic heart that ties together all kernel packages.
 * Re-exports the complete kernel API surface.
 */

// Re-export all kernel components
export type { Sql } from '@pos/db';
export { getDb, closeDb, startEmbeddedPostgres, stopEmbeddedPostgres, getConnectionString, runMigrations } from '@pos/db';
