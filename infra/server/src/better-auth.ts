/**
 * Better Auth server instance (Ryan's preferences §7: Better Auth is the
 * default for a built web project's in-app authentication, replacing the
 * hand-rolled OIDC/Argon2id auth).
 *
 * Backed by SurrealDB via the surreal-better-auth adapter. Better Auth owns
 * sessions, email/password, passkeys/WebAuthn, TOTP, RBAC, and social OAuth;
 * the Go/C# MCP backend stays out of it and validates only what it must.
 *
 * GUI-first config (§9): env vars are bootstrap defaults; the web Settings UI
 * remains the source of truth for provider keys.
 */

import { betterAuth } from 'better-auth';
import { Surreal, ConnectionStatus } from 'surrealdb';
import { surrealdbAdapter } from 'surreal-better-auth';

// ---- SurrealDB connection (lazy; the app tolerates a DB that is down at
// boot, matching the existing SurrealDbStore behavior) ---------------------

let db: Surreal | null = null;

export async function ensureConnected(): Promise<Surreal> {
  if (db && db.status === ConnectionStatus.Connected) return db;
  const url = process.env.SURREALDB_URL || 'ws://localhost:8000';
  const namespace = process.env.SURREALDB_NAMESPACE || 'overlay';
  const database = process.env.SURREALDB_DATABASE || 'companion';
  const username = process.env.SURREALDB_USERNAME || 'root';
  const password = process.env.SURREALDB_PASSWORD || 'root';
  if (!db) db = new Surreal();
  await db.connect(url, {
    namespace,
    database,
    auth: { username, password },
  });
  return db;
}

function getDb(): Surreal {
  return db ?? (db = new Surreal());
}

// ---- Better Auth ---------------------------------------------------------

export const auth = betterAuth({
  appName: 'Overlay Companion MCP',
  secret: process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET || 'dev-only-change-me', // pragma: allowlist secret (dev default)
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:8080',
  basePath: '/api/auth',
  database: surrealdbAdapter(getDb(), { usePlural: true }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    // §7: "Login is three separate POST requests" applies to TOTP flows; the
    // password remains its own credential in transit. Better Auth enforces the
    // three-step secret isolation for 2FA; here we keep password-only local.
    minPasswordLength: 12,
  },
  session: {
    expiresIn: 7 * 24 * 60 * 60, // 7 days
    updateAge: 24 * 60 * 60, // refresh the session cookie once per day
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // Sign-ups locked by default (§7): an admin opts in by configuring providers
  // / a public signup in the Settings UI. When unset, allow them for the
  // first bootstrap user only.
  emailVerification: {
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
  },
});
