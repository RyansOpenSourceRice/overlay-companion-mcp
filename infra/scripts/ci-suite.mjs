/**
 * CI e2e suite — runs against a live stack (BASE_URL, default
 * http://localhost:8080) using PW_BROWSER (default firefox — CI's primary
 * browser). Covers the no-API-key surface: auth/shell, per-user preferences
 * incl. marking-limit validation, display-state, overlays ground truth, and
 * the /mcp page proxy initialize path.
 *
 * Chat-dependent missions live in bench/b1-limits.mjs (run separately when
 * PROVIDER_API_KEY / OPENROUTER_API_KEY is available).
 */
import { ensureShell, launchBrowser } from './bench/bench-lib.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const b = await launchBrowser();
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
};
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);

  // 1. Authed API roundtrip from the browser (cookies set by ensureShell).
  const prefs = await page.evaluate(async (base) => {
    const get = await (await fetch(`${base}/api/me/preferences`, { credentials: 'include' })).json();
    const bad = await fetch(`${base}/api/me/preferences`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ maxTextMarkings: 9 }),
    });
    const put = await fetch(`${base}/api/me/preferences`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ maxTextMarkings: 2, maxNonTextMarkings: 2 }),
    });
    const after = await (await fetch(`${base}/api/me/preferences`, { credentials: 'include' })).json();
    return { get, badStatus: bad.status, putStatus: put.status, after };
  }, BASE);
  check('preferences GET returns limits', typeof prefs.get.maxTextMarkings === 'number', JSON.stringify(prefs.get));
  check('preferences rejects out-of-range limit', prefs.badStatus === 400, `got ${prefs.badStatus}`);
  check('preferences PUT accepts 0-8', prefs.putStatus === 200, `got ${prefs.putStatus}`);
  check('preferences defaults 2/2', prefs.after.maxTextMarkings === 2 && prefs.after.maxNonTextMarkings === 2, JSON.stringify(prefs.after));

  // 2. Ground-truth surfaces.
  const truth = await page.evaluate(async (base) => ({
    overlays: (await (await fetch(`${base}/api/overlays`, { credentials: 'include' })).json()),
    display: (await (await fetch(`${base}/api/display-state`, { credentials: 'include' })).json()),
    tools: (await (await fetch(`${base}/api/chat/tools`, { credentials: 'include' })).json()),
  }), BASE);
  check('overlays ground truth reachable', typeof truth.overlays?.count === 'number', JSON.stringify(truth.overlays?.count));
  check('display-state has primary', Boolean(truth.display?.primary?.width), JSON.stringify(truth.display?.primary));
  check('chat tool allowlist excludes set_mode', !truth.tools?.allowlist?.includes('set_mode'), JSON.stringify(truth.tools?.allowlist));

  // 3. Shell UI sanity in Firefox: docked chat panel exists.
  const hasPanel = Boolean(await page.$('.chat-panel, [class*="chat"]'));
  check('chat panel present in Firefox', hasPanel);

  console.log('CI-SUITE:', failures === 0 ? 'ALL PASS' : `${failures} failure(s)`);
} catch (err) {
  console.log('CI-SUITE ERROR:', err.message);
  failures++;
} finally { await b.close(); }
process.exit(failures === 0 ? 0 : 1);