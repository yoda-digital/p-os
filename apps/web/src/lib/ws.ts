import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

type WSMessage = {
  type: string;
  case_id?: string;
  move_id?: string;
  data?: unknown;
};

let wsInstance: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;
const listeners = new Set<(msg: WSMessage) => void>();

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

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  wsInstance?.close();
  wsInstance = null;
}

export function useRealtimeUpdates(caseId?: string): void {
  const queryClient = useQueryClient();
  const caseIdRef = useRef(caseId);
  caseIdRef.current = caseId;

  useEffect(() => {
    const unsub = subscribe((msg) => {
      const currentCaseId = caseIdRef.current;

      if (msg.case_id && currentCaseId && msg.case_id !== currentCaseId) return;

      switch (msg.type) {
        case 'case_updated':
          queryClient.invalidateQueries({ queryKey: ['cases'] });
          if (msg.case_id) queryClient.invalidateQueries({ queryKey: ['case', msg.case_id] });
          break;
        case 'move_updated':
        case 'move_created':
          if (msg.case_id) {
            queryClient.invalidateQueries({ queryKey: ['moves', msg.case_id] });
            queryClient.invalidateQueries({ queryKey: ['kanban', msg.case_id] });
          }
          break;
        case 'kanban_updated':
          if (msg.case_id) queryClient.invalidateQueries({ queryKey: ['kanban', msg.case_id] });
          break;
        case 'attention_updated':
          if (msg.case_id) queryClient.invalidateQueries({ queryKey: ['attention', msg.case_id] });
          break;
        case 'decision_updated':
          if (msg.case_id) queryClient.invalidateQueries({ queryKey: ['decisions', msg.case_id] });
          break;
        case 'evidence_updated':
          if (msg.case_id) queryClient.invalidateQueries({ queryKey: ['evidence', msg.case_id] });
          break;
        case 'timeline_updated':
          if (msg.case_id) queryClient.invalidateQueries({ queryKey: ['timeline', msg.case_id] });
          break;
        default:
          if (msg.case_id) {
            queryClient.invalidateQueries({ queryKey: ['case', msg.case_id] });
          }
          break;
      }
    });

    return unsub;
  }, [queryClient]);
}
