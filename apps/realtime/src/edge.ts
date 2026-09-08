import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import * as jose from 'jose';
import { getDb } from '@pos/db';

const JWT_SECRET = new TextEncoder().encode(
  process.env['JWT_SECRET'] ?? 'pos-dev-secret-change-in-production'
);

export interface DeviceTokenPayload {
  device_id: string;
  user_id: string;
  organization_id: string;
  type: 'device';
}

/**
 * Verifies a device auth token. This is a device-scoped JWT (type: 'device'),
 * distinct from the user-session tokens verified in ./auth.ts, but signed
 * with the same secret as the control plane API (see apps/api/src/routes/edge.ts).
 */
async function verifyDeviceToken(token: string): Promise<DeviceTokenPayload> {
  const { payload } = await jose.jwtVerify(token, JWT_SECRET);
  if (payload['type'] !== 'device') {
    throw new Error('Not a device token');
  }
  return {
    device_id: payload['device_id'] as string,
    user_id: payload['user_id'] as string,
    organization_id: payload['organization_id'] as string,
    type: 'device',
  };
}

interface ActiveSession {
  id?: string;
  case_id?: string;
  move_id?: string;
}

interface EdgeClient {
  ws: WebSocket;
  deviceId: string;
  userId: string;
  organizationId: string;
  activeSessions: ActiveSession[];
  lastEventAck: number;
}

// ── Client tracking ──────────────────────────────────────────────

const edgeClients = new Map<WebSocket, EdgeClient>();

export function getEdgeClientCount(): number {
  return edgeClients.size;
}

// ── WebSocket server for persistent edge (plugin/device) connections ──

export function createEdgeWebSocketServer(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Missing device token');
      return;
    }

    let payload: DeviceTokenPayload;
    try {
      payload = await verifyDeviceToken(token);
    } catch {
      ws.close(4003, 'Invalid or expired device token');
      return;
    }

    const sql = getDb();
    try {
      const [device] = await sql`SELECT id, status FROM devices WHERE id = ${payload.device_id}`;
      if (!device || device.status !== 'active') {
        ws.close(4004, 'Device not found or inactive');
        return;
      }
    } catch (err) {
      console.error('[Edge] Device lookup failed:', err);
      ws.close(1011, 'Internal error');
      return;
    }

    const client: EdgeClient = {
      ws,
      deviceId: payload.device_id,
      userId: payload.user_id,
      organizationId: payload.organization_id,
      activeSessions: [],
      lastEventAck: 0,
    };
    edgeClients.set(ws, client);

    await sql`
      INSERT INTO edge_connections (device_id, connected_at, last_heartbeat_at, active_sessions, last_event_ack)
      VALUES (${client.deviceId}, NOW(), NOW(), '[]', 0)
      ON CONFLICT (device_id) DO UPDATE SET
        connected_at = NOW(),
        last_heartbeat_at = NOW()
    `.catch((err) => console.error('[Edge] Failed to record connection:', err));

    await sql`UPDATE devices SET last_seen_at = NOW() WHERE id = ${client.deviceId}`.catch(() => {});

    ws.on('message', (raw) => {
      void handleMessage(client, raw);
    });

    ws.on('close', () => {
      edgeClients.delete(ws);
    });

    ws.on('error', () => {
      edgeClients.delete(ws);
    });

    ws.send(JSON.stringify({ type: 'connected', device_id: client.deviceId }));
  });

  return wss;
}

// ── Inbound message handling ─────────────────────────────────────

async function handleMessage(client: EdgeClient, raw: unknown): Promise<void> {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse((raw as Buffer | string).toString());
  } catch {
    return; // ignore malformed messages
  }

  const sql = getDb();
  const type = msg['type'] as string | undefined;

  switch (type) {
    // Handshake payload sent right after connecting (see spec §5.1)
    case 'handshake': {
      const sessions = Array.isArray(msg['active_sessions']) ? (msg['active_sessions'] as ActiveSession[]) : [];
      client.activeSessions = sessions;
      client.lastEventAck = Number(msg['last_event_ack'] ?? 0);

      await sql`
        UPDATE devices SET
          plugin_version = COALESCE(${(msg['plugin_version'] as string) ?? null}, plugin_version),
          claude_version = COALESCE(${(msg['claude_version'] as string) ?? null}, claude_version),
          capabilities = COALESCE(${msg['capabilities'] ? sql.json(msg['capabilities'] as any) : null}, capabilities),
          last_seen_at = NOW()
        WHERE id = ${client.deviceId}
      `.catch((err) => console.error('[Edge] handshake device update failed:', err));

      await sql`
        UPDATE edge_connections SET
          active_sessions = ${sql.json(sessions as any)},
          last_event_ack = ${client.lastEventAck},
          last_heartbeat_at = NOW()
        WHERE device_id = ${client.deviceId}
      `.catch((err) => console.error('[Edge] handshake connection update failed:', err));

      client.ws.send(JSON.stringify({ type: 'handshake_ack', last_event_ack: client.lastEventAck }));
      break;
    }

    // Heartbeat keep-alive
    case 'heartbeat':
    case 'ping': {
      await sql`
        UPDATE edge_connections SET last_heartbeat_at = NOW() WHERE device_id = ${client.deviceId}
      `.catch(() => {});
      client.ws.send(JSON.stringify({ type: type === 'ping' ? 'pong' : 'heartbeat_ack' }));
      break;
    }

    // Session binding changed on the device (new/closed Claude session)
    case 'session_update': {
      const sessions = Array.isArray(msg['active_sessions']) ? (msg['active_sessions'] as ActiveSession[]) : [];
      client.activeSessions = sessions;
      await sql`
        UPDATE edge_connections SET active_sessions = ${sql.json(sessions as any)}, last_heartbeat_at = NOW()
        WHERE device_id = ${client.deviceId}
      `.catch((err) => console.error('[Edge] session_update failed:', err));
      break;
    }

    // Device acknowledges receipt of an event / steering command
    case 'ack': {
      const lastEventAck = msg['last_event_ack'];
      if (lastEventAck != null) {
        client.lastEventAck = Number(lastEventAck);
        await sql`
          UPDATE edge_connections SET last_event_ack = ${client.lastEventAck} WHERE device_id = ${client.deviceId}
        `.catch(() => {});
      }
      const steeringId = msg['steering_id'] as string | undefined;
      if (steeringId) {
        await transitionSteeringState(sql, steeringId, 'acknowledged', 'SteeringAcknowledged').catch((err) =>
          console.error('[Edge] steering ack failed:', err)
        );
      }
      break;
    }

    // Session lifecycle events from the dispatcher
    case 'session_started':
    case 'session_ended':
    case 'session_stopped':
    case 'session_start_failed': {
      const moveId = msg['moveId'] as string | undefined;
      const caseId = msg['caseId'] as string | undefined;
      const claudeJobId = msg['claudeJobId'] ?? msg['sessionId'];

      if (moveId && caseId) {
        // Update attempt record with claude_job_id and working directory
        if (type === 'session_started' && claudeJobId) {
          await sql`
            UPDATE attempts SET
              claude_job_id = ${claudeJobId as string},
              working_directory = ${(msg['workingDirectory'] ?? null) as string | null},
              worktree_path = ${(msg['worktreePath'] ?? null) as string | null},
              model_used = ${(msg['model'] ?? null) as string | null},
              state = 'running',
              started_at = COALESCE(started_at, NOW())
            WHERE move_id = ${moveId} AND state IN ('queued', 'starting')
          `.catch((err) => console.error('[Edge] Failed to update attempt for session_started:', err));
        }

        if (type === 'session_ended' || type === 'session_stopped') {
          await sql`
            UPDATE attempts SET state = 'finished', ended_at = NOW()
            WHERE move_id = ${moveId} AND state IN ('running', 'starting')
          `.catch((err) => console.error('[Edge] Failed to update attempt for session end:', err));
        }

        if (type === 'session_start_failed') {
          await sql`
            UPDATE attempts SET state = 'failed', ended_at = NOW(),
              failure_reason = ${(msg['error'] ?? 'Session launch failed') as string}
            WHERE move_id = ${moveId} AND state IN ('queued', 'starting')
          `.catch((err) => console.error('[Edge] Failed to update attempt for session failure:', err));
        }
      }
      break;
    }

    // Session reconciliation report from dispatcher restart
    case 'session_reconciliation':
    case 'active_sessions_report': {
      // Update edge_connections with active sessions
      const sessions = msg['sessions'] ?? msg['activeSessions'];
      if (Array.isArray(sessions)) {
        client.activeSessions = sessions.map((s: any) => ({
          id: s.sessionId ?? s.jobId,
          case_id: s.caseId ?? s.case_id,
          move_id: s.moveId ?? s.move_id,
        }));
        await sql`
          UPDATE edge_connections SET active_sessions = ${sql.json(client.activeSessions as any)}, last_heartbeat_at = NOW()
          WHERE device_id = ${client.deviceId}
        `.catch(() => {});
      }
      break;
    }

    default:
      // Unknown message type — ignore
      break;
  }
}

// ── Steering state machine (mirrors apps/api/src/services/steering-service.ts) ──
//
// apps/realtime cannot depend on apps/api (they are separate deployable services —
// see each package's package.json), so the transition + event-emission contract is
// duplicated here in miniature rather than imported.

const STEERING_STATE_ORDER = [
  'issued',
  'delivered_to_edge',
  'delivered_to_executor',
  'acknowledged',
  'applied',
] as const;
type SteeringState = (typeof STEERING_STATE_ORDER)[number];

async function appendCaseEvent(
  sql: ReturnType<typeof getDb>,
  params: { tenantId: string; caseId: string; type: string; data: Record<string, unknown> }
): Promise<void> {
  const eventId = crypto.randomUUID();
  const [seqRow] = await sql`
    INSERT INTO case_sequences (case_id, next_sequence)
    VALUES (${params.caseId}, 2)
    ON CONFLICT (case_id) DO UPDATE SET next_sequence = case_sequences.next_sequence + 1
    RETURNING next_sequence - 1 AS seq
  `;
  const [inserted] = await sql`
    INSERT INTO events (id, tenant_id, case_id, type, actor_id, occurred_at, recorded_at, causation_id, correlation_id, case_sequence, data)
    VALUES (${eventId}, ${params.tenantId}, ${params.caseId}, ${params.type}, NULL, NOW(), NOW(), ${eventId}, ${eventId}, ${seqRow?.seq ?? 1}, ${sql.json(params.data as any)})
    RETURNING id
  `;
  if (inserted) {
    await sql`INSERT INTO event_outbox (event_id) VALUES (${eventId})`;
  }
}

/**
 * Advance a `steering_commands` row to `newState`, rejecting regressions and no-ops, and emit
 * the matching `Steering*` lifecycle event (spec §1.3 — every transition is observable, so the
 * Composer UI's real-time state feed is always honest). Returns `false` if the row does not
 * exist or the transition would not move the state forward.
 */
async function transitionSteeringState(
  sql: ReturnType<typeof getDb>,
  steeringId: string,
  newState: SteeringState,
  eventType: string,
  extraData: Record<string, unknown> = {}
): Promise<boolean> {
  const [current] = await sql`
    SELECT sc.*, c.organization_id AS tenant_id
    FROM steering_commands sc
    JOIN cases c ON c.id = sc.case_id
    WHERE sc.id = ${steeringId}
  `;
  if (!current) return false;

  const currentIdx = STEERING_STATE_ORDER.indexOf(current['state'] as SteeringState);
  const nextIdx = STEERING_STATE_ORDER.indexOf(newState);
  if (nextIdx <= currentIdx) return false; // no-op or regression — never overwrite forward progress

  const isDeliveryState = newState === 'delivered_to_edge' || newState === 'delivered_to_executor';
  const isAcknowledged = newState === 'acknowledged';
  const isApplied = newState === 'applied';

  await sql`
    UPDATE steering_commands SET
      state = ${newState},
      delivered_at = CASE WHEN ${isDeliveryState} AND delivered_at IS NULL THEN NOW() ELSE delivered_at END,
      acknowledged_at = CASE WHEN ${isAcknowledged} AND acknowledged_at IS NULL THEN NOW() ELSE acknowledged_at END,
      applied_at = CASE WHEN ${isApplied} AND applied_at IS NULL THEN NOW() ELSE applied_at END
    WHERE id = ${steeringId}
  `;

  await appendCaseEvent(sql, {
    tenantId: current['tenant_id'] as string,
    caseId: current['case_id'] as string,
    type: eventType,
    data: {
      steering_id: steeringId,
      move_id: current['move_id'],
      attempt_id: current['attempt_id'],
      state: newState,
      ...extraData,
    },
  });

  return true;
}

// ── Execution dispatch — push StartMove / Stop commands to bound devices ──

export async function dispatchPendingCommands(): Promise<void> {
  if (edgeClients.size === 0) return;
  const sql = getDb();

  try {
    const pending = await sql`
      SELECT * FROM edge_commands
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 50
    `.catch(() => [] as any[]);

    if (pending.length === 0) return;

    for (const cmd of pending) {
      const payload = cmd.payload as Record<string, unknown>;
      const deviceId = cmd.device_id as string;
      const cmdType = cmd.type as string;
      let delivered = false;

      for (const [, client] of edgeClients) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;
        if (client.deviceId !== deviceId) continue;

        client.ws.send(JSON.stringify({
          type: cmdType,
          id: cmd.id,
          ...payload,
        }));
        delivered = true;
        break;
      }

      if (delivered) {
        await sql`
          UPDATE edge_commands SET status = 'delivered', delivered_at = NOW()
          WHERE id = ${cmd.id as string}
        `.catch((err: unknown) => console.error('[Edge] Failed to mark command delivered:', err));
      }
    }
  } catch (err) {
    console.error('[Edge] Command dispatch error:', err);
  }
}

// ── Steering dispatch — push pending steering commands to bound devices ──

export async function dispatchPendingSteering(): Promise<void> {
  if (edgeClients.size === 0) return;
  const sql = getDb();

  try {
    const pending = await sql`
      SELECT * FROM steering_commands WHERE state = 'issued' ORDER BY issued_at ASC LIMIT 100
    `;
    if (pending.length === 0) return;

    for (const cmd of pending) {
      const moveId = cmd.move_id as string;
      const caseId = cmd.case_id as string;
      let delivered = false;

      for (const [, client] of edgeClients) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;
        const matches = client.activeSessions.some(
          (s) => (s.move_id && s.move_id === moveId) || (s.case_id && s.case_id === caseId)
        );
        if (!matches) continue;

        client.ws.send(
          JSON.stringify({
            type: 'steering',
            steering: {
              id: cmd.id,
              case_id: caseId,
              move_id: moveId,
              attempt_id: cmd.attempt_id,
              class: cmd.class,
              instruction: cmd.instruction,
              issued_at: cmd.issued_at,
            },
          })
        );
        delivered = true;
      }

      if (delivered) {
        await transitionSteeringState(sql, cmd.id as string, 'delivered_to_edge', 'SteeringDelivered', {
          target: 'edge',
        }).catch((err) => console.error('[Edge] Failed to mark steering delivered:', err));
      }
    }
  } catch (err) {
    console.error('[Edge] Steering dispatch error:', err);
  }
}

// ── Heartbeat sweep — drop dead sockets ───────────────────────────

export function edgeHeartbeatSweep(): void {
  for (const [ws, client] of edgeClients) {
    if (ws.readyState !== WebSocket.OPEN) {
      edgeClients.delete(ws);
      continue;
    }
    try {
      ws.ping();
    } catch {
      edgeClients.delete(ws);
      client.ws.terminate();
    }
  }
}
