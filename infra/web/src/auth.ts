/**
 * Auth client for the Overlay Companion MCP web UI.
 *
 * Talks to the management server's /auth/* and /api/settings endpoints. The
 * SPA calls these to decide whether to show the login view, the app, or the
 * settings forms. CSRF token is fetched from /auth/me and attached to mutating
 * requests.
 */

export interface CurrentUser {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  roles: string[];
  provider: string;
}

export interface AuthStatus {
  enabled: boolean;
  oidc: { configured: boolean; issuer: string | null };
  local: { enabled: boolean };
  signup: { allowed: boolean };
}

export interface SettingsBundle {
  auth?: Record<string, unknown>;
  connection?: Record<string, unknown>;
  wazuh?: Record<string, unknown>;
  general?: Record<string, unknown>;
}

let cachedCsrfToken = '';

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/auth/status');
  if (!res.ok) throw new Error(`auth status ${res.status}`);
  return res.json();
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const res = await fetch('/auth/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`auth/me ${res.status}`);
  const data = (await res.json()) as { user: CurrentUser; csrfToken: string };
  cachedCsrfToken = data.csrfToken;
  return data.user;
}

export function getCsrfToken(): string {
  return cachedCsrfToken;
}

export async function loginWithOidc(redirect = '/'): Promise<void> {
  window.location.href = `/auth/login?redirect=${encodeURIComponent(redirect)}`;
}

export async function loginLocal(username: string, password: string): Promise<CurrentUser> {
  const res = await fetch('/auth/local/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? 'Login failed');
  cachedCsrfToken = data.csrfToken;
  return data.user;
}

export async function registerLocal(username: string, password: string, email?: string): Promise<CurrentUser> {
  const res = await fetch('/auth/local/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? 'Registration failed');
  cachedCsrfToken = data.csrfToken;
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': cachedCsrfToken },
  });
  cachedCsrfToken = '';
}

export async function deleteAccount(): Promise<void> {
  const res = await fetch('/auth/delete-account', {
    method: 'POST',
    headers: { 'X-CSRF-Token': cachedCsrfToken },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message ?? 'Delete failed');
  }
  cachedCsrfToken = '';
}

export async function getSettings(): Promise<SettingsBundle> {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error(`settings ${res.status}`);
  return res.json();
}

export async function putSetting(category: string, key: string, value: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/settings/${category}/${key}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': cachedCsrfToken,
    },
    body: JSON.stringify(value),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error?.message ?? `Save failed (${res.status})`);
  }
}
