/**
 * Better Auth server instance (Ryan's preferences §7: Better Auth is the
 * default for a built web project's in-app authentication).
 *
 * Backed by libSQL (Turso) via a Kysely instance over the `@libsql/client`
 * engine. Better Auth owns user/session/account/verification/twoFactor tables
 * through its own migrations (run at boot via ctx.runMigrations). External MCP
 * clients and the C# MCP server stay out of it and validate only what they must.
 *
 * GUI-first config (§9): env vars are bootstrap defaults; the web Settings UI
 * remains the source of truth for provider keys.
 */

import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { passkey } from '@better-auth/passkey';
import { Kysely } from 'kysely';
import { createClient } from '@libsql/client';
import { LibSqlDialect } from './libsql-dialect.js';
import { loadLibSqlOptions } from './libsql-store.js';

// ---- libSQL (embedded by default; Turso Cloud / libsql-server are the same
// client with a different URL + optional auth token) -----------------------

export function createKysely(): Kysely<unknown> {
  const opts = loadLibSqlOptions();
  const client = createClient({
    url: opts.url,
    authToken: opts.authToken ? opts.authToken : undefined,
  });
  return new Kysely<unknown>({ dialect: new LibSqlDialect(client) });
}

const kysely = createKysely();

// ---- Better Auth ---------------------------------------------------------

export const auth = betterAuth({
  appName: 'Overlay Companion MCP',
  secret: process.env.BETTER_AUTH_SECRET || process.env.SESSION_SECRET || 'dev-only-change-me', // pragma: allowlist secret (dev default)
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:8080',
  basePath: '/api/auth',
  // The `{ db, type }` shorthand lets Better Auth resolve the Kysely instance,
  // which is also what its migration runner needs to create the schema.
  database: { db: kysely, type: 'sqlite' },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 12,
  },
  // §7 Privacy: the user must be able to delete their own account. Better Auth
  // disables deleteUser by default; enable it.
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
    // §7: optional passkeys (WebAuthn) + TOTP. Passkeys only function when the
    // deployment origin matches the RP ID; register the plugin only then.
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
      accountLockout: { enabled: true, maxFailedAttempts: 10, durationSeconds: 900 },
    }),
  ],
});

/**
 * Apply the Better Auth schema (idempotent) on first use. The embedded libSQL
 * file is always "connected" once created, so unlike the old SurrealDB adapter
 * there is no transient connect state to retry.
 */
let migrated = false;
let migrating: Promise<void> | null = null;

export async function ensureBetterAuthReady(): Promise<void> {
  if (migrated) return;
  if (migrating) return migrating;
  migrating = (async () => {
    const ctx = await auth.$context;
    // runMigrations is safe to call repeatedly; it diffs the live schema.
    await ctx.runMigrations();
    migrated = true;
  })();
  return migrating;
}