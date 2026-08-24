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
  twoFactorEnabled?: boolean;
}

export interface AuthStatus {
  enabled: boolean;
  oidc: { configured: boolean; issuer: string | null };
  local: { enabled: boolean };
  signup: { allowed: boolean };
  passkey?: { enabled: boolean };
  totp?: { enabled: boolean };
}

export interface SettingsBundle {
  auth?: Record<string, unknown>;
  connection?: Record<string, unknown>;
  wazuh?: Record<string, unknown>;
  general?: Record<string, unknown>;
  provider?: Record<string, unknown>;
  audio?: Record<string, unknown>;
  tls?: Record<string, unknown>;
  openfga?: Record<string, unknown>;
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

export interface LoginResult {
  user?: CurrentUser;
  twoFactor?: { required: boolean; methods: string[] };
}

interface LoginResponse extends LoginResult {
  error?: { message?: string };
}

// Shared POST + defensive-parse helper for the two-step local auth flow. The
// endpoints sit behind rate limiters that may return non-JSON bodies, so the
// parse is guarded.
async function postAuth<T>(url: string, body: Record<string, unknown>): Promise<{ res: Response; data: T }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { res, data };
}

export async function loginLocal(email: string, password: string): Promise<LoginResult> {
  // Go through the rate-limited /auth/local/login adapter so the two-factor
  // contract ({ twoFactor: { required, methods } }) is consistent and the
  // password step is not bypassing the limiter.
  const { res, data } = await postAuth<LoginResponse>('/auth/local/login', { username: email, password });
  if (data?.twoFactor?.required) {
    if (!res.ok) throw new Error(data?.error?.message ?? 'Login failed');
    return { twoFactor: { required: true, methods: data.twoFactor.methods ?? ['totp'] } };
  }
  return { user: requireAuthUser(res, data, 'Login failed') };
}

export async function verifyLocalTotp(code: string): Promise<CurrentUser> {
  const { res, data } = await postAuth<LoginResponse>('/auth/local/verify-totp', { code });
  return requireAuthUser(res, data, 'Verification failed');
}

// Shared success-check for the auth endpoints: throws if the request was not
// OK or the response lacks a user, preferring the server's (sanitized) message.
function requireAuthUser(res: Response, data: LoginResponse, fallback: string): CurrentUser {
  if (!res.ok || !data?.user) throw new Error(data?.error?.message ?? fallback);
  return data.user;
}

export async function registerLocal(name: string, email: string, password: string): Promise<CurrentUser> {
  const res = await fetch('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  });
  const data = await res.json();
  if (!res.ok || !data?.user) throw new Error(data?.message ?? 'Registration failed');
  return data.user;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/sign-out', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  cachedCsrfToken = '';
}

export async function deleteAccount(password: string, totpCode?: string): Promise<void> {
  const res = await fetch('/auth/delete-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': cachedCsrfToken,
    },
    body: JSON.stringify({ password, totpCode: totpCode ?? undefined }),
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
