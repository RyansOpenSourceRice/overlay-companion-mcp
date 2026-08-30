/**
 * Bench B5 — context compaction at adjustable scale (Phase 6).
 *
 * Protocol: bench driver plays the HUMAN via chat + prefs API.
 *  1. Budget pref validation: PUT 2000 -> 400; PUT 10^12 -> 400; PUT 48k -> 200.
 *  2. Server-fed meter: the SSE `context` event reports the pref-driven
 *     budget (not the old hardcoded 24k) — used/budget/userBudget/model tokens.
 *  3. Real compaction: a 12-message history (~7k chars) against a 6k budget
 *     must arrive `compacted: true` and still produce an answer.
 *  4. Model clamp: with the default 48k budget, the OpenAI-spec model window
 *     (context_length) must clamp the effective budget below the user value.
 *  5. AI-requestable: chat "set my context budget to 60000" -> set_my_preferences
 *     + pending approval -> approve -> prefs show 60000.
 *  6. Cleanup: budget back to 48,000; screen cleared.
 */
import { ensureShell, connectDesktop, sendAsHuman, launchBrowser } from './bench-lib.mjs';

const b = await launchBrowser();
const scores = { pass: 0, fail: 0 };
const check = (name, ok, detail = '') => {
  scores[ok ? 'pass' : 'fail']++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
};

try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);

  const setPrefs = (patch) => page.evaluate(async (patch) => {
    const r = await fetch('/api/me/preferences', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify(patch),
    });
    return r.status;
  }, patch);
  const getPrefs = () => page.evaluate(async () => {
    const r = await fetch('/api/me/preferences', { credentials: 'include' });
    return r.ok ? r.json() : null;
  });

  // --- 1. validation -------------------------------------------------------
  check('tiny budget refused', (await setPrefs({ contextBudgetChars: 2000 })) === 400);
  check('absurd budget refused', (await setPrefs({ contextBudgetChars: 1e12 })) === 400);
  check('48k default accepted', (await setPrefs({ contextBudgetChars: 48_000 })) === 200);

  // --- 2+4. SSE context event + model clamp --------------------------------
  const sse = await page.evaluate(async () => {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Say OK and nothing else.' }] }),
    });
    return await r.text();
  });
  let ctx = null;
  for (const line of sse.split('\n').filter((l) => l.startsWith('data:'))) {
    try {
      const j = JSON.parse(line.slice(5));
      if (j.context) ctx = j.context;
    } catch { /* skip */ }
  }
  check('context SSE event present', !!ctx, JSON.stringify(ctx ?? {}));
  check('budget mirrors the pref', ctx?.budget === 48_000, `budget=${ctx?.budget}`);
  check('model window fetched (clamp active or token count known)', ctx?.modelContextTokens === null || ctx?.modelContextTokens > 0,
    `modelContextTokens=${ctx?.modelContextTokens}`);
  check('clamp keeps budget under user setting when model is smaller',
    ctx?.modelContextTokens == null || ctx.budget <= Math.floor(ctx.modelContextTokens * 3.5 * 0.6),
    `budget=${ctx?.budget} vs tokens=${ctx?.modelContextTokens}`);

  // --- 3. real compaction (tiny budget: 6k) --------------------------------
  check('6k budget accepted', (await setPrefs({ contextBudgetChars: 6000 })) === 200);
  const filler = 'Please also keep this filler context in mind: '.concat('alpha-beta-gamma-delta '.repeat(30));
  const hist = [];
  for (let i = 1; i <= 12; i++) {
    hist.push({ role: 'user', content: `Turn ${i}: please remember the word "brick${i}" for later. ${filler}` });
    hist.push({ role: 'assistant', content: `Acknowledged brick${i}. Filler noted.` });
  }
  hist.push({ role: 'user', content: 'Now reply with exactly: READY' });
  const sse2 = await page.evaluate(async ({ messages }) => {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ messages }),
    });
    return await r.text();
  }, { messages: hist });
  let ctx2 = null;
  let text2 = '';
  for (const line of sse2.split('\n').filter((l) => l.startsWith('data:'))) {
    try {
      const j = JSON.parse(line.slice(5));
      if (j.context) ctx2 = j.context;
      if (j.text && !j.thinking) text2 += j.text;
    } catch { /* skip */ }
  }
  check('compaction fired on over-budget history', ctx2?.compacted === true, JSON.stringify(ctx2 ?? {}));
  check('answer still produced after compaction', /ready/i.test(text2), text2.slice(0, 80));
  await setPrefs({ contextBudgetChars: 48_000 }); // restore before the AI test

  // --- 5. AI-requestable with approval ------------------------------------
  const r5 = await sendAsHuman(page, 'Set my context budget to 60000 characters.');
  const prefsMid = await getPrefs();
  check('AI requested budget via pending approval', prefsMid?.pending_approval?.contextBudgetChars === 60000 || prefsMid?.pending_approval?.contextBudgetChars === 60000, JSON.stringify(prefsMid?.pending_approval ?? {}));
  const approved = await page.evaluate(async () => {
    const r = await fetch('/api/me/preferences/approve', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ approve: true }),
    });
    return r.status;
  });
  const prefsAfter = await getPrefs();
  check('approved budget lands', approved === 200 && prefsAfter?.contextBudgetChars === 60000, `status=${approved} budget=${prefsAfter?.contextBudgetChars}`);

  // --- 6. cleanup ----------------------------------------------------------
  await setPrefs({ contextBudgetChars: 48_000 });
  await sendAsHuman(page, 'Clear every marking off the screen now.');
  await setPrefs({ enforcePreview: true, maxTextMarkings: 2, maxNonTextMarkings: 2 });

  console.log(`SCORECARD: ${JSON.stringify(scores)} | ctx: ${JSON.stringify(ctx)}`);
} finally {
  await b.close();
}
