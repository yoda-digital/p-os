/**
 * HTTP client for control plane API calls (spec section 3.3): every read
 * tool falls back to this after a local cache miss, and every write tool
 * uses it for immediate feedback after enqueueing to the local outbox.
 *
 * Authentication is the device identity established during pairing (spec
 * section 3.2) — no per-request tokens beyond the device's long-lived auth
 * token, read from local SQLite via `DeviceStore`.
 */
import { DeviceStore } from '../storage/device.js';

const DEFAULT_BASE_URL = 'http://localhost:4000';
const DEFAULT_TIMEOUT_MS = 8000;

/** Resolve the control plane base URL, trimmed of any trailing slash. */
function resolveBaseUrl(): string {
  const configured = process.env['CONTROL_PLANE_URL'] ?? DEFAULT_BASE_URL;
  return configured.replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const device = new DeviceStore().get();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (device?.auth_token) headers['authorization'] = `Bearer ${device.auth_token}`;
  if (device?.id) headers['x-device-id'] = device.id;
  if (device?.organization_id) headers['x-organization-id'] = device.organization_id;
  return headers;
}

/** Raised for any failed control plane request — network, timeout, or non-2xx. */
export class HttpClientError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HttpClientError';
    this.status = status;
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractErrorMessage(status: number, data: unknown): string {
  if (data && typeof data === 'object' && 'message' in (data as Record<string, unknown>)) {
    const message = (data as Record<string, unknown>)['message'];
    if (typeof message === 'string' && message) return message;
  }
  return `Control plane request failed with HTTP ${status}`;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${resolveBaseUrl()}${path}`, {
      method,
      headers: authHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await parseBody(res);
    if (!res.ok) {
      throw new HttpClientError(extractErrorMessage(res.status, data), res.status);
    }
    return data as T;
  } catch (err) {
    if (err instanceof HttpClientError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpClientError(`Control plane request timed out after ${timeoutMs}ms`);
    }
    throw new HttpClientError(
      err instanceof Error ? err.message : 'Unknown control plane error',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Minimal control plane HTTP client — GET for reads, POST for commands. */
export const httpClient = {
  get: <T>(path: string, timeoutMs?: number): Promise<T> => request<T>('GET', path, undefined, timeoutMs),
  post: <T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> =>
    request<T>('POST', path, body, timeoutMs),
};
