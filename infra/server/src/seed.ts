/**
 * Demo seed (§demo): provisions a ready-to-use demo account with a working VM.
 *
 * Enabled only when SEED_DEMO=true. Idempotent: if the demo user already
 * exists it is reused, and a connection is created only when the user has none,
 * so re-boots never duplicate or overwrite the user's own saved computers.
 *
 * The demo user is created through Better Auth (signUpEmail) so it carries a
 * real credential + session just like a normal sign-up. The seeded VM points at
 * the KasmVNC desktop named by the KASMVNC_ALLOWLIST_JSON target id, which the
 * management server proxies under /vnc/<targetId>.
 */

import { auth } from './better-auth.js';
import { LibSqlStore } from './libsql-store.js';

export async function seedDemo(store: LibSqlStore): Promise<void> {
  if (process.env.SEED_DEMO !== 'true') return;

  const email = process.env.DEMO_EMAIL || 'demo@overlay.local';
  const password = process.env.DEMO_PASSWORD || 'demo-password-1234';

  try {
    const ctx = await auth.$context;
    let record = await ctx.internalAdapter.findUserByEmail(email.toLowerCase());
    if (!record?.user) {
      await auth.api.signUpEmail({
        body: { name: 'Demo User', email, password },
      });
      record = await ctx.internalAdapter.findUserByEmail(email.toLowerCase());
    }
    if (!record?.user) {
      console.warn('[seed] demo user could not be created; skipping demo VM.');
      return;
    }

    const userId = record.user.id;
    const existing = await store.listConnections(userId);
    if (existing.length > 0) return; // user already has computers

    const targetId = process.env.DEMO_TARGET_ID || 'sample';
    const port = parseInt(process.env.DEMO_TARGET_PORT || '6901', 10) || 6901;
    const ssl = process.env.DEMO_TARGET_SSL !== 'false';
    await store.upsertConnection(userId, {
      name: 'Demo Desktop',
      host: targetId, // kasmvnc: host is the allowlist target id, proxied under /vnc/<id>
      port,
      protocol: 'kasmvnc',
      ssl,
      description: 'A live Linux desktop you control right now.',
    });
    console.log(`[seed] demo account ${email} provisioned with a VM (target ${targetId}).`);
  } catch (err) {
    // Seeding is best-effort; never block boot on it.
    console.warn('[seed] demo seeding failed:', (err as Error).message);
  }
}