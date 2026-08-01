/**
 * Connections client for the Overlay Companion MCP web UI.
 *
 * Talks to the management server's /api/connections endpoints. Connections are
 * stored server-side in SurrealDB (metadata + Argon2id password hash). The
 * plaintext password is never stored or returned by the server; it lives only
 * transiently in sessionStorage, keyed by connection id, and is merged into
 * the connection object at connect time for the live VM handshake.
 */

import { getCsrfToken } from './auth';

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  username: string | null;
  password: string | null;
  ssl: boolean;
  description: string | null;
  createdAt: string | null;
  lastConnected: string | null;
}

interface ConnectionPayload {
  name: string;
  host: string;
  port: number;
  protocol: string;
  username?: string | null;
  ssl?: boolean;
  description?: string | null;
}

const PASSWORD_STORAGE_KEY = 'overlay-companion-connection-passwords'; // pragma: allowlist secret (storage key name, not a credential)

function csrfHeaders(): Record<string, string> {
  const token = getCsrfToken();
  return token ? { 'X-CSRF-Token': token } : {};
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/** Load the user's saved connections from the server. */
export async function listConnections(): Promise<Connection[]> {
  const res = await fetch('/api/connections');
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { connections: Connection[] };
  return data.connections ?? [];
}

/** Create a new connection. The password is hashed server-side; never stored in plaintext. */
export async function createConnection(input: ConnectionPayload & { password?: string }): Promise<Connection> {
  const res = await fetch('/api/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { connection: Connection };
  return data.connection;
}

/** Update an existing connection. Omit password to keep the stored hash. */
export async function updateConnection(id: string, input: ConnectionPayload & { password?: string }): Promise<Connection> {
  const res = await fetch(`/api/connections/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { connection: Connection };
  return data.connection;
}

/** Delete a saved connection. */
export async function deleteConnection(id: string): Promise<void> {
  const res = await fetch(`/api/connections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(await parseError(res));
  clearStoredPassword(id);
}

/** Record a successful connect; server writes the authoritative last_connected. */
export async function touchConnection(id: string): Promise<void> {
  const res = await fetch(`/api/connections/${encodeURIComponent(id)}/touch`, {
    method: 'POST',
    headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

/** Test a saved connection against its target. */
export async function testSavedConnection(id: string): Promise<{ success: boolean; message?: string }> {
  const res = await fetch(`/api/connections/${encodeURIComponent(id)}/test`, {
    method: 'POST',
    headers: csrfHeaders(),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

// ---- Transient password storage (sessionStorage, never server-side) ------

function readPasswordStore(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(PASSWORD_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writePasswordStore(store: Record<string, string>): void {
  try {
    sessionStorage.setItem(PASSWORD_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // sessionStorage unavailable; passwords simply won't survive navigation.
  }
}

/** Store a connection's plaintext password for the current tab session. */
export function storePassword(id: string, password: string): void {
  const store = readPasswordStore();
  if (password) store[id] = password;
  else delete store[id];
  writePasswordStore(store);
}

/** Retrieve a connection's transient plaintext password, if any. */
export function getStoredPassword(id: string): string | null {
  return readPasswordStore()[id] ?? null;
}

/** Remove a stored plaintext password. */
export function clearStoredPassword(id: string): void {
  const store = readPasswordStore();
  delete store[id];
  writePasswordStore(store);
}

/** Merge any stored plaintext password into a server-backed connection. */
export function withPassword(connection: Connection): Connection {
  const password = getStoredPassword(connection.id);
  if (password === null) return connection;
  return { ...connection, password };
}
