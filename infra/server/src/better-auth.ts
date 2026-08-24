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
import { twoFactor } from 'better-auth/plugins/two-factor';
import { passkey } from '@better-auth/passkey';
import { Surreal, ConnectionStatus } from 'surrealdb';
import { surrealdbAdapter } from './auth-db-adapter/surreal-adapter.js';
import { loadSurrealOptions } from './surreal-store.js';

// ---- SurrealDB connection (lazy; the app tolerates a DB that is down at
// boot, matching the existing SurrealDbStore behavior) ---------------------

let db: Surreal | null = null;
let connecting: Promise<Surreal> | null = null;

// A transient connect failure (e.g. container-DNS resolution on podman, or the
// DB restarting under us) must not turn a login/registration/session request
// into a 500. Retry the connect with backoff before giving up.
const CONNECT_RETRIES = 5;
const CONNECT_BASE_DELAY_MS = 300;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function ensureConnected(): Promise<Surreal> {
  if (db && db.status === ConnectionStatus.Connected) return db;
  if (connecting) return connecting;
  const opts = loadSurrealOptions();
  const url = opts.endpoint.replace(/^http/i, 'ws');
  const attempt = async (): Promise<Surreal> => {
    let lastErr: unknown = null;
    for (let i = 0; i < CONNECT_RETRIES; i++) {
      try {
        const c = db ?? (db = new Surreal());
        await c.connect(url, {
          namespace: opts.namespace,
          database: opts.database,
          auth: { username: opts.username, password: opts.password },
        });
        return c;
      } catch (err) {
        lastErr = err;
        if (i < CONNECT_RETRIES - 1) await sleep(CONNECT_BASE_DELAY_MS * (i + 1));
      }
    }
    throw lastErr;
  };
  connecting = attempt();
  try {
    return await connecting;
  } catch (err) {
    // Reset so a later request can retry the connection; the app tolerates a
    // DB that is down at boot.
    db = null;
    connecting = null;
    throw err;
  } finally {
    connecting = null;
  }
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
    // §7 "Sign-ups locked by default (admin opt-in)". For a self-hosted
    // single-operator app, registration is open unless the operator restricts
    // it — lock it down (e.g. disableSignUp: true, or an allowlist at the
    // reverse proxy) when the deployment requires admin-opt-in. The Playwright
    // suite and the SPA register the first account here.
    // §7: "Login is three separate POST requests" applies to TOTP flows; the
    // password remains its own credential in transit.
    minPasswordLength: 12,
  },
  // §7 Privacy: the user must be able to delete their own account. Better Auth
  // disables deleteUser by default; enable it and let it re-authenticate via
  // the password (server.ts adds the required TOTP check when 2FA is on).
  user: {
    deleteUser: {
      enabled: true,
    },
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
  plugins: [
    // §7: optional passkeys (WebAuthn / hardware keys) and optional TOTP 2FA.
    // Both are opt-in per account: a user adds a passkey or enables TOTP from
    // the Settings > Security UI; neither is forced at sign-up. Password +
    // passkey + TOTP can be combined (defense in depth for a self-hosted app).
    //
    // The passkey plugin is registered only when BETTER_AUTH_PASSKEY_RP_ID is
    // set: WebAuthn only functions when the deployment origin matches the RP
    // ID, so without it the plugin would advertise passkeys that fail in the
    // browser. /auth/status mirrors this (passkey.enabled = !!RP_ID).
    ...(process.env.BETTER_AUTH_PASSKEY_RP_ID
      ? [
          passkey({
            rpID: process.env.BETTER_AUTH_PASSKEY_RP_ID,
            rpName: 'Overlay Companion MCP',
            origin: process.env.BETTER_AUTH_URL || 'http://localhost:8080',
          }),
        ]
      : []),
    twoFactor({
      issuer: 'Overlay Companion MCP',
      otpOptions: { digits: 6, period: 30 },
      // Per-account lockout on failed second-factor verifications: 10
      // consecutive failures locks the account for 15 minutes (plugin
      // defaults). This caps TOTP brute-force even across rotated IPs, which
      // the per-IP totpLimiter alone cannot do.
      accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
    }),
  ],
});
