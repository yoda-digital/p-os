import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { getDb } from '@pos/db';
import { verifyToken, type TokenPayload } from './auth.js';
import {
  createEdgeWebSocketServer,
  dispatchPendingSteering,
  edgeHeartbeatSweep,
  getEdgeClientCount,
} from './edge.js';

// ── Client tracking ──────────────────────────────────────────────

interface Client {
  ws: WebSocket;
  userId: string;
  organizationId: string;
  subscribedCases: Set<string>;
}

const clients = new Map<WebSocket, Client>();

// ── HTTP server + WSS ────────────────────────────────────────────

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', clients: clients.size, edgeClients: getEdgeClientCount() }));
});

// Browser/UI clients (subscribe to case events) and Process Edge (device/plugin)
// clients are two separate WebSocket servers sharing one HTTP server. Both run in
// `noServer` mode; the `upgrade` handler below routes by path.
const wss = new WebSocketServer({ noServer: true });
const edgeWss = createEdgeWebSocketServer();

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (pathname === '/edge' || pathname.startsWith('/edge/')) {
    edgeWss.handleUpgrade(req, socket, head, (ws) => {
      edgeWss.emit('connection', ws, req);
    });
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  }
});

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    ws.close(4001, 'Missing token');
    return;
  }

  let payload: TokenPayload;
  try {
    payload = await verifyToken(token);
  } catch {
    ws.close(4003, 'Invalid token');
    return;
  }

  const client: Client = {
    ws,
    userId: payload.user_id,
    organizationId: payload.organization_id,
    subscribedCases: new Set(),
  };
  clients.set(ws, client);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as {
        type: string;
        caseId?: string;
      };

      switch (msg.type) {
        case 'subscribe':
          if (msg.caseId) {
            client.subscribedCases.add(msg.caseId);
            ws.send(
              JSON.stringify({ type: 'subscribed', caseId: msg.caseId })
            );
          }
          break;

        case 'unsubscribe':
          if (msg.caseId) {
            client.subscribedCases.delete(msg.caseId);
            ws.send(
              JSON.stringify({ type: 'unsubscribed', caseId: msg.caseId })
            );
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });

  ws.send(JSON.stringify({ type: 'connected', userId: payload.user_id }));
});

// ── Outbox poller → broadcast ────────────────────────────────────

let lastProcessedId = 0;

async function pollAndBroadcast(): Promise<void> {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT
        o.id        AS outbox_id,
        o.event_id,
        e.case_id,
        e.type,
        e.data,
        e.actor_id,
        e.occurred_at,
        e.case_sequence
      FROM event_outbox o
      JOIN events e ON e.id = o.event_id
      WHERE o.id > ${lastProcessedId}
        AND o.processed_at IS NULL
      ORDER BY o.id
      LIMIT 100
    `;

    for (const row of rows) {
      const caseId = row.case_id as string;

      const message = JSON.stringify({
        type: 'event',
        event: {
          id: row.event_id,
          caseId,
          type: row.type,
          data: row.data,
          actorId: row.actor_id,
          occurredAt: row.occurred_at,
          caseSequence: Number(row.case_sequence),
        },
      });

      // Fan-out to every client subscribed to this case
      for (const [, client] of clients) {
        if (
          client.subscribedCases.has(caseId) &&
          client.ws.readyState === WebSocket.OPEN
        ) {
          client.ws.send(message);
        }
      }

      // Mark processed (individual — keeps partial progress on crash)
      await sql`
        UPDATE event_outbox
        SET processed_at = NOW()
        WHERE id = ${row.outbox_id}
      `;
      lastProcessedId = Number(row.outbox_id);
    }
  } catch (err) {
    console.error('[Realtime] Poll error:', err);
  }
}

// Seed lastProcessedId from DB so we don't replay old events on restart
async function seedLastProcessedId(): Promise<void> {
  const sql = getDb();
  try {
    const [row] = await sql`
      SELECT COALESCE(MAX(id), 0) AS max_id
      FROM event_outbox
      WHERE processed_at IS NOT NULL
    `;
    lastProcessedId = Number(row?.max_id ?? 0);
  } catch {
    // table might not exist yet — leave at 0
  }
}

// ── Heartbeat — clean up dead connections ─────────────────────────

function heartbeat(): void {
  for (const [ws, client] of clients) {
    if (ws.readyState !== WebSocket.OPEN) {
      clients.delete(ws);
      continue;
    }
    try {
      ws.ping();
    } catch {
      clients.delete(ws);
      client.ws.terminate();
    }
  }
}

// ── Boot ──────────────────────────────────────────────────────────

const PORT = Number(process.env['REALTIME_PORT'] ?? 4001);

async function main(): Promise<void> {
  await seedLastProcessedId();
  console.log(
    `[Realtime] Seeded lastProcessedId = ${lastProcessedId}`
  );

  const pollTimer = setInterval(pollAndBroadcast, 500);
  const heartbeatTimer = setInterval(heartbeat, 30_000);
  const edgeHeartbeatTimer = setInterval(edgeHeartbeatSweep, 30_000);
  const steeringTimer = setInterval(() => {
    void dispatchPendingSteering();
  }, 1000);

  server.listen(PORT, () => {
    console.log(`[Realtime] WebSocket server on ws://localhost:${PORT} (browser: /, edge: /edge)`);
  });

  const shutdown = () => {
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    clearInterval(edgeHeartbeatTimer);
    clearInterval(steeringTimer);
    wss.close();
    edgeWss.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[Realtime] Fatal:', err);
  process.exit(1);
});
