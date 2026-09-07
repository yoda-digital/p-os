import EmbeddedPostgres from 'embedded-postgres';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', '..', '.data', 'postgres');

let pg: EmbeddedPostgres | null = null;
let externalDb = false;

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => { resolve(false); });
    sock.setTimeout(500, () => { sock.destroy(); resolve(false); });
  });
}

export async function startEmbeddedPostgres(port = 5432): Promise<void> {
  if (pg || externalDb) return;

  // If PostgreSQL is already running on this port, just use it
  if (await isPortOpen(port)) {
    console.log(`[DB] PostgreSQL already running on port ${port} — connecting`);
    externalDb = true;
    return;
  }

  const alreadyInitialised = fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));
  pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'pos',
    password: 'pos',
    port,
    persistent: true,
  });
  if (!alreadyInitialised) {
    await pg.initialise();
  }
  await pg.start();
  if (!alreadyInitialised) {
    try {
      await pg.createDatabase('pos');
    } catch {
      // Database may already exist
    }
  }
  console.log(`[DB] PostgreSQL started on port ${port}`);
}

export async function stopEmbeddedPostgres(): Promise<void> {
  if (pg) {
    await pg.stop();
    pg = null;
  }
}

export function getConnectionString(port = 5432): string {
  return `postgresql://pos:pos@localhost:${port}/pos`;
}
