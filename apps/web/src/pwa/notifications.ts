/**
 * Web Push Notification Support (SP6 §3.2)
 *
 * Semantic notification formatting:
 *   GOOD: "Release blocked. Security approval is now critical."
 *   BAD:  "Task #417 changed status."
 *
 * Notification payload includes: attention level, case title, action required, deadline.
 */

import { api } from '../lib/api';

// ── Registration ────────────────────────────────────────────────────

/**
 * Register for push notifications.
 * Returns the subscription ID from the server, or null if not supported/denied.
 */
export async function registerPushNotifications(): Promise<string | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Notifications] Push notifications not supported');
    return null;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.log('[Notifications] Permission denied');
      return null;
    }

    const registration = await navigator.serviceWorker.ready;

    // Check for existing subscription
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      // Create new subscription
      // In production: fetch VAPID public key from server
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
        ?? 'BPlaceholderVapidPublicKeyForDevelopment000000000000000000000000000000000000000=';

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    // Send subscription to server
    const result = await api.subscribePush({
      endpoint: subscription.endpoint,
      keys: {
        p256dh: arrayBufferToBase64(subscription.getKey('p256dh')!),
        auth: arrayBufferToBase64(subscription.getKey('auth')!),
      },
    });

    console.log('[Notifications] Registered push subscription');
    return result.id;
  } catch (err) {
    console.error('[Notifications] Registration failed:', err);
    return null;
  }
}

/**
 * Unregister from push notifications.
 */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await subscription.unsubscribe();
    }

    console.log('[Notifications] Unregistered push subscription');
  } catch (err) {
    console.error('[Notifications] Unregistration failed:', err);
  }
}

/**
 * Check if push notifications are currently enabled.
 */
export async function isPushEnabled(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

/**
 * Check if push notifications are supported in this browser.
 */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// ── Semantic Notification Formatting ────────────────────────────────

export interface SemanticNotification {
  case_title: string;
  case_id: string;
  move_id?: string;
  decision_id?: string;
  attention_level: 'critical' | 'high' | 'medium' | 'low';
  action_type: 'approve' | 'decide' | 'review' | 'steer' | 'blocked' | 'completed' | 'deadline';
  subject: string;
  context?: string;
  deadline?: string;
  waiting_count?: number;
}

/**
 * Format a semantic notification message.
 *
 * SP6 §3.2: "Release blocked. Security approval is now critical."
 * NOT: "Task #417 changed status."
 */
export function formatNotification(n: SemanticNotification): {
  title: string;
  body: string;
  tag: string;
  actions: Array<{ action: string; title: string }>;
  data: Record<string, unknown>;
} {
  let title: string;
  let body: string;
  const actions: Array<{ action: string; title: string }> = [];

  switch (n.action_type) {
    case 'approve':
      title = `Approval needed`;
      body = `${n.subject}${n.deadline ? `. Due ${formatDeadline(n.deadline)}` : ''}`;
      actions.push({ action: 'approve', title: 'Review' });
      break;

    case 'decide':
      title = `Decision required`;
      body = `${n.subject}${n.waiting_count ? `. ${n.waiting_count} team members waiting.` : ''}`;
      actions.push({ action: 'view', title: 'Decide' });
      break;

    case 'blocked':
      title = `${n.case_title} blocked`;
      body = `${n.subject}${n.attention_level === 'critical' ? ' — this is now critical.' : '.'}`;
      actions.push({ action: 'view', title: 'Unblock' });
      break;

    case 'deadline':
      title = `Deadline approaching`;
      body = `${n.subject} — ${formatDeadline(n.deadline!)}`;
      actions.push({ action: 'view', title: 'View' });
      break;

    case 'completed':
      title = `Completed`;
      body = n.subject;
      break;

    case 'review':
      title = `Review needed`;
      body = `${n.subject} in ${n.case_title}`;
      actions.push({ action: 'view', title: 'Review' });
      break;

    case 'steer':
      title = `Steering update`;
      body = `${n.subject} — ${n.context ?? 'new direction received'}`;
      break;

    default:
      title = n.case_title;
      body = n.subject;
  }

  // Always add a "View" action
  if (!actions.some((a) => a.action === 'view')) {
    actions.push({ action: 'view', title: 'View' });
  }

  return {
    title,
    body,
    tag: `pos-${n.case_id}-${n.action_type}`,
    actions,
    data: {
      case_id: n.case_id,
      move_id: n.move_id,
      decision_id: n.decision_id,
      priority: n.attention_level,
      view_url: n.move_id
        ? `/cases/${n.case_id}/kanban`
        : `/cases/${n.case_id}`,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatDeadline(isoDate: string): string {
  const deadline = new Date(isoDate);
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 0) return 'overdue';
  if (diffHours < 1) return 'in less than an hour';
  if (diffHours < 24) return `in ${diffHours} hours`;
  const diffDays = Math.floor(diffHours / 24);
  return `in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
