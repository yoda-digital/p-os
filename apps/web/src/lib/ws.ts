import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

type WSMessage = {
  type: string;
  case_id?: string;
  move_id?: string;
  data?: unknown;
  event?: {
    id?: string;
    caseId?: string;
    type?: string;
    [key: string]: unknown;
  };
};

let wsInstance: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;
const listeners = new Set<(msg: WSMessage) => void>();
let subscribedCaseId: string | null = null;

function getWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('pos_token');
  const params = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${proto}//${location.host}/ws${params}`;
}

function connect(): void {
  if (wsInstance?.readyState === WebSocket.OPEN || wsInstance?.readyState === WebSocket.CONNECTING) return;

  try {
    wsInstance = new WebSocket(getWsUrl());
  } catch {
    scheduleReconnect();
    return;
  }

  wsInstance.onopen = () => {
    console.log('[WS] Connected');
    reconnectAttempts = 0;
    // Re-subscribe to the active case after (re)connect
    if (subscribedCaseId && wsInstance?.readyState === WebSocket.OPEN) {
      wsInstance.send(JSON.stringify({ type: 'subscribe', caseId: subscribedCaseId }));
    }
  };

  wsInstance.onmessage = (event) => {
    try {
      const msg: WSMessage = JSON.parse(event.data);
      listeners.forEach((fn) => fn(msg));
    } catch {
      // ignore malformed messages
    }
  };

  wsInstance.onclose = () => {
    console.log('[WS] Disconnected');
    wsInstance = null;
    scheduleReconnect();
  };

  wsInstance.onerror = () => {
    wsInstance?.close();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

export function subscribe(fn: (msg: WSMessage) => void): () => void {
  listeners.add(fn);
  if (!wsInstance || wsInstance.readyState === WebSocket.CLOSED) connect();
  return () => {
    listeners.delete(fn);
  };
}

export function subscribeToCase(caseId: string | null): void {
  // Unsubscribe from previous case
  if (subscribedCaseId && wsInstance?.readyState === WebSocket.OPEN) {
    wsInstance.send(JSON.stringify({ type: 'unsubscribe', caseId: subscribedCaseId }));
  }
  subscribedCaseId = caseId;
  // Subscribe to new case
  if (caseId && wsInstance?.readyState === WebSocket.OPEN) {
    wsInstance.send(JSON.stringify({ type: 'subscribe', caseId }));
  }
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  subscribedCaseId = null;
  wsInstance?.close();
  wsInstance = null;
}

// Map server domain event types (e.g. "MoveCreated") to query invalidation keys
function mapEventType(serverType: string): string {
  const normalized = serverType.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
  // MoveCreated -> move_created, MoveActivated -> move_activated, etc.
  return normalized;
}

export function useRealtimeUpdates(caseId?: string): void {
  const queryClient = useQueryClient();
  const caseIdRef = useRef(caseId);
  caseIdRef.current = caseId;

  // Subscribe/unsubscribe to case when caseId changes
  useEffect(() => {
    subscribeToCase(caseId || null);
    return () => { subscribeToCase(null); };
  }, [caseId]);

  useEffect(() => {
    const unsub = subscribe((msg) => {
      const currentCaseId = caseIdRef.current;

      // Unwrap the 'event' envelope from the realtime server
      let eventType = msg.type;
      let eventCaseId = msg.case_id;
      if (msg.type === 'event' && msg.event) {
        eventType = mapEventType(msg.event.type || '');
        eventCaseId = eventCaseId || msg.event.caseId as string;
      }

      if (eventCaseId && currentCaseId && eventCaseId !== currentCaseId) return;

      switch (eventType) {
        case 'case_created':
        case 'case_updated':
        case 'case_closed':
        case 'case_reopened':
          queryClient.invalidateQueries({ queryKey: ['cases'] });
          if (eventCaseId) queryClient.invalidateQueries({ queryKey: ['case', eventCaseId] });
          break;
        case 'move_created':
        case 'move_edited':
        case 'move_activated':
        case 'move_paused':
        case 'move_resumed':
        case 'move_cancelled':
        case 'move_superseded':
        case 'move_updated':
          if (eventCaseId) {
            queryClient.invalidateQueries({ queryKey: ['moves', eventCaseId] });
            queryClient.invalidateQueries({ queryKey: ['kanban', eventCaseId] });
            queryClient.invalidateQueries({ queryKey: ['attention', eventCaseId] });
            queryClient.invalidateQueries({ queryKey: ['timeline', eventCaseId] });
          }
          break;
        case 'kanban_updated':
          if (eventCaseId) queryClient.invalidateQueries({ queryKey: ['kanban', eventCaseId] });
          break;
        case 'attention_updated':
          if (eventCaseId) queryClient.invalidateQueries({ queryKey: ['attention', eventCaseId] });
          break;
        case 'decision_created':
        case 'decision_updated':
        case 'decision_resolved':
          if (eventCaseId) queryClient.invalidateQueries({ queryKey: ['decisions', eventCaseId] });
          break;
        case 'evidence_attached':
        case 'evidence_invalidated':
        case 'evidence_updated':
          if (eventCaseId) queryClient.invalidateQueries({ queryKey: ['evidence', eventCaseId] });
          break;
        case 'timeline_updated':
          if (eventCaseId) queryClient.invalidateQueries({ queryKey: ['timeline', eventCaseId] });
          break;
        case 'attempt_started':
        case 'attempt_succeeded':
        case 'attempt_failed':
        case 'attempt_steered':
          if (eventCaseId) {
            queryClient.invalidateQueries({ queryKey: ['moves', eventCaseId] });
            queryClient.invalidateQueries({ queryKey: ['kanban', eventCaseId] });
          }
          break;
        default:
          // Catch-all: invalidate case and timeline for any unrecognized event
          if (eventCaseId) {
            queryClient.invalidateQueries({ queryKey: ['case', eventCaseId] });
            queryClient.invalidateQueries({ queryKey: ['timeline', eventCaseId] });
          }
          break;
      }
    });

    return unsub;
  }, [queryClient]);
}
