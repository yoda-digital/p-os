// Process Edge Core — outbound-only WSS connection to the Control Plane
// Handles: event upload, steering delivery, command reception, offline queueing

import WebSocket from 'ws';

export interface EdgeConfig {
  serverUrl: string;
  deviceId: string;
  token: string;
  pluginVersion: string;
  claudeVersion: string;
  capabilities?: string[];
}

export interface EdgeEventHandler {
  onSteering?: (steering: SteeringMessage) => void;
  onStartMove?: (command: StartMoveMessage) => void;
  onStop?: (command: StopMessage) => void;
  onPolicyUpdate?: (policy: PolicyUpdateMessage) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export interface SteeringMessage {
  type: 'steering';
  caseId: string;
  moveId: string;
  attemptId: string;
  class: string;
  instruction: string;
  issuedBy: string;
  issuedAt: string;
}

export interface StartMoveMessage {
  type: 'start_move';
  caseId: string;
  moveId: string;
  executionPlan: Record<string, unknown>;
  contextCapsule: Record<string, unknown>;
}

export interface StopMessage {
  type: 'stop';
  caseId: string;
  moveId: string;
  attemptId: string;
  reason: string;
}

export interface PolicyUpdateMessage {
  type: 'policy_update';
  policyVersion: string;
  rules: Record<string, unknown>[];
  expiresAt: string;
}

export class ProcessEdge {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30_000;
  private eventQueue: unknown[] = [];
  private connected = false;
  private handlers: EdgeEventHandler;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private config: EdgeConfig,
    handlers: EdgeEventHandler = {},
  ) {
    this.handlers = handlers;
  }

  async connect(): Promise<void> {
    const params = new URLSearchParams({
      device: this.config.deviceId,
      plugin: this.config.pluginVersion,
      claude: this.config.claudeVersion,
      token: this.config.token,
    });

    if (this.config.capabilities) {
      params.set('capabilities', this.config.capabilities.join(','));
    }

    // The realtime server listens on /edge (no /v1/ prefix) at the WS port.
    // Nginx proxies /edge/ws to the realtime server with WebSocket upgrade.
    const url = `${this.config.serverUrl}/edge/ws?${params}`;

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: { Authorization: `Bearer ${this.config.token}` },
      });

      this.ws.on('open', () => {
        console.log('[Edge] Connected to control plane');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.flushQueue();
        this.handlers.onConnected?.();
        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleServerMessage(msg);
        } catch {
          // Malformed message — ignore
        }
      });

      this.ws.on('close', (code, reason) => {
        this.connected = false;
        this.stopHeartbeat();
        this.handlers.onDisconnected?.();
        console.log(`[Edge] Disconnected (${code}: ${reason.toString()})`);
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        console.error('[Edge] Connection error:', err.message);
        if (!this.connected) reject(err);
      });
    });
  }

  private handleServerMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'steering':
        this.handlers.onSteering?.(msg as unknown as SteeringMessage);
        this.ack(msg.type as string, msg.id as string);
        break;
      case 'start_move':
        this.handlers.onStartMove?.(msg as unknown as StartMoveMessage);
        this.ack(msg.type as string, msg.id as string);
        break;
      case 'stop':
        this.handlers.onStop?.(msg as unknown as StopMessage);
        this.ack(msg.type as string, msg.id as string);
        break;
      case 'policy_update':
        this.handlers.onPolicyUpdate?.(msg as unknown as PolicyUpdateMessage);
        this.ack(msg.type as string, msg.id as string);
        break;
      case 'pong':
        // Heartbeat response — connection is alive
        break;
      default:
        console.log('[Edge] Unknown message type:', msg.type);
    }
  }

  private ack(type: string, id: string): void {
    this.send({ type: 'ack', ref: id, refType: type, timestamp: new Date().toISOString() });
  }

  async sendEvent(event: unknown): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    } else {
      this.eventQueue.push(event);
    }
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private flushQueue(): void {
    while (this.eventQueue.length > 0 && this.connected) {
      const event = this.eventQueue.shift()!;
      this.ws?.send(JSON.stringify(event));
    }
    if (this.eventQueue.length > 0) {
      console.log(
        `[Edge] ${this.eventQueue.length} events still queued (offline)`,
      );
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.send({ type: 'ping', timestamp: new Date().toISOString() });
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;
    console.log(`[Edge] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        // Will retry on next close
      });
    }, delay);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get queuedEventCount(): number {
    return this.eventQueue.length;
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.reconnectAttempts = Infinity; // Prevent reconnect
    this.ws?.close(1000, 'Client disconnect');
    this.ws = null;
    this.connected = false;
  }
}
