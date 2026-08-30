/**
 * Bench B4 — guided navigation walkthrough (Phase 5).
 *
 * Scenario: the OSM directions session (the mission that failed live).
 * The assistant guides the human (bench driver) through opening a site and
 * walking a multi-step flow, ONE action at a time, with the Plan/Act
 * checklist and stepwise auto-clear. Deterministic gates:
 *   1. The model writes a plan (set_task_plan), commits NO markings, and
 *      WAITS for Go (plan mode is approval-gated server-side).
 *   2. With stepwise mode armed (the prompt explicitly asks for it), at most
 *      ONE marking stays on screen as steps advance — render-layer truth via
 *      /api/overlays.
 *   3. Every marking on the render layer fits the TRUE guest display
 *      (1024x768) — no phantom-1920 geometry (R23 regression gate).
 *   4. Final prose stays short (no full-tutorial re-dumping).
 *
 * Judging of SEMANTIC correctness (does the box cover the right control?)
 * is the driver's job via saved composite frames, as in b2/b3.
 */
import { ensureShell, connectDesktop, sendAsHuman, grabFrame, launchBrowser } from './bench-lib.mjs';

const TRUE_W = 1024, TRUE_H = 768; // this deployment's guest display

const overlayTruth = (page) => page.evaluate(async () => {
  const r = await fetch('/api/overlays', { credentials: 'include' });
  return r.ok ? r.json() : null;
});

const b = await launchBrowser();
const scores = { pass: 0, fail: 0 };
const check = (name, ok, detail = '') => {
  scores[ok ? 'pass' : 'fail']++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
};
let page = null;
try {
  page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);

  // Mission setup: gate off (tests placement, not the preview loop).
  await page.evaluate(async () => {
    await fetch('/api/me/preferences', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ enforcePreview: false, maxTextMarkings: 2, maxNonTextMarkings: 3 }),
    });
  });

  // Turn 1: plan first. The model must pause for Go and place NOTHING
  // (render-truth cross-check, not just model-reported annotations).
  const rPlan = await sendAsHuman(page,
    'Teach me to get walking directions between two places in Los Angeles on openstreetmap.org. ' +
    'FIRST call set_task_plan with the steps (write a fresh plan even if one already exists), then STOP and wait for my go. ' +
    'For each step, use step mode (one marking at a time).',
    { timeoutMs: 300000 });
  const truthPlan = await overlayTruth(page);
  check('plan written and paused for Go',
    rPlan.tools.includes('set_task_plan') && (truthPlan?.count ?? 0) === 0,
    `tools=${rPlan.tools.join(',')}, truthCount=${truthPlan?.count}`);

  // Approve (the Go button's own message).
  const rGo = await sendAsHuman(page, 'Go — proceed with the checklist.', { timeoutMs: 420000 });
  // Fluidity: the model assesses reality — if prior steps are already done
  // on screen it marks only the next action (>=1), never a fixed count.
  check('walkthrough produced markings', rGo.annotations.length >= 1,
    `got ${rGo.annotations.length}; tools=${rGo.tools.join(',')}`);

  // Display-truth gate from the RENDER LAYER: no marking may exceed the real
  // display (model-reported annotations can miss cross-turn commits).
  const truth = await overlayTruth(page);
  const renderMarks = (truth?.overlays ?? []).map((m) => ({
    x: Number(m.x ?? 0), y: Number(m.y ?? 0),
    width: Number(m.width ?? 0), height: Number(m.height ?? 0),
  }));
  const outOfBounds = renderMarks.filter((m) =>
    Number(m.x) + Number(m.width) > TRUE_W + 8 || Number(m.y) + Number(m.height) > TRUE_H + 8);
  check('no phantom-resolution markings', outOfBounds.length === 0,
    JSON.stringify(outOfBounds));

  // Stepwise invariant (render truth): at most ONE marking left standing.
  check('at most 1 marking on screen after walkthrough',
    typeof truth?.count === 'number' && truth.count <= 1,
    JSON.stringify({ count: truth?.count, non_text: truth?.non_text }));

  // Prose discipline: final answer short, names the current action.
  check('final prose short + actionable', rGo.text.length > 0 && rGo.text.length < 800, rGo.text.slice(0, 160));
  const clean = !rGo.errors.length || rGo.errors.every((e) => !/Recovery:/.test(e));
  check('no recovery-blob leakage', clean);

  await page.waitForTimeout(1200);
  await grabFrame(page, 'b4_navigation_final');
  console.log('SCORECARD:', JSON.stringify(scores), '| tools:', rGo.tools.join(','), '| text:', rGo.text.slice(0, 180));
} catch (err) {
  console.log('BENCH ERROR:', err.message);
  scores.fail++;
} finally {
  // OCR: cleanup must run even on failure — never leave prefs/markings behind.
  try {
    await sendAsHuman(page, 'Clear every marking off the screen now.');
    await page.evaluate(async () => {
      await fetch('/api/me/preferences', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ enforcePreview: true, maxTextMarkings: 2, maxNonTextMarkings: 2 }),
      });
    });
    console.log('CLEANUP: done (prefs restored)');
  } catch (cleanupErr) {
    console.log('CLEANUP FAILED:', cleanupErr.message);
  }
  await b.close();
}