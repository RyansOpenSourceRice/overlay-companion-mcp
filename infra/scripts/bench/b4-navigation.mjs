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
import { ensureShell, connectDesktop, sendAsHuman, grabFrame, humanClick, xdotool, launchBrowser } from './bench-lib.mjs';

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
      method: 'PUT', headers: { 'content-type': 'application/json', }, credentials: 'include',
      body: JSON.stringify({ enforcePreview: false, maxTextMarkings: 2, maxNonTextMarkings: 3 }),
    });
  });

  // Hermetic start: a previous run's in-flight auto-continue turn can commit
  // markings after this browser opened. Clear the render layer FIRST, then
  // reset the VM browser to a neutral page — Firefox state persists in the
  // kasmvnc container across runs and contaminates the walkthrough.
  const overlayCount = () => page.evaluate(async () => {
    const r = await fetch('/api/overlays', { credentials: 'include' });
    const j = r.ok ? await r.json() : null;
    return j?.count ?? -1;
  });
  for (let i = 0; i < 3 && (await overlayCount()) !== 0; i++) {
    await sendAsHuman(page, 'Clear every marking off the screen now.');
    await new Promise((r) => setTimeout(r, 1500));
  }
  try {
    xdotool('key --clearmodifiers ctrl+l');
    await new Promise((r) => setTimeout(r, 400));
    xdotool('type --delay 40 "https://www.openstreetmap.org/#map=11/34.05/-118.24"');
    await new Promise((r) => setTimeout(r, 300));
    xdotool('key --clearmodifiers Return');
    await new Promise((r) => setTimeout(r, 5000));
  } catch (vmErr) {
    console.log('VM RESET SKIPPED:', vmErr.message.slice(0, 80));
  }

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
  check('final prose short + actionable', rGo.text.length > 0 && rGo.text.length < 1000, rGo.text.slice(0, 160));
  const clean = !rGo.errors.length || rGo.errors.every((e) => !/Recovery:/.test(e));
  check('no recovery-blob leakage', clean);

  // Phase 6: auto-continue — a mid-checklist pause must resume on VM
  // activity alone. This one drives the REAL panel (the state machine lives
  // in ChatPanel, not the fetch path).
  try {
    await page.click('#chat-toggle-btn');
    await page.waitForTimeout(600);
    const countBubbles = () => page.evaluate(() => document.querySelectorAll('.chat-msg--assistant').length);
    const before = await countBubbles();
    page.on('console', (m) => { const t = m.text(); if (t.includes('[chat]')) console.log('PANEL:', t.slice(0, 140)); });
    await page.fill('#chat-input', 'FIRST call set_task_plan with a fresh 3-step checklist for bookmarking this page (step 1 circle the star icon in the address bar, step 2 tell me what happens, step 3 point at the bookmarks menu), then STOP and wait for my go. Use step mode, one marking at a time.');
    await page.click('#chat-send');
    // Wait for the Go gate (plan mode) then approve via the real button.
    const goBtn = await page.waitForSelector('.chat-plan-go', { timeout: 150_000 });
    if (goBtn) {
      await goBtn.click();
    }
    // Wait for that turn to finish: bubbles stable AND thinking dots settled
    // (a quiet LLM wait keeps the bubble count flat mid-turn).
    let stable = 0, prev = await countBubbles();
    for (let i = 0; i < 90 && stable < 6; i++) {
      await page.waitForTimeout(2000);
      const busy = await page.evaluate(() =>
        document.querySelectorAll('.chat-thinking:not(.chat-thinking--settled)').length > 0);
      const now = await countBubbles();
      stable = (now === prev && !busy) ? stable + 1 : 0;
      prev = now;
    }
    const afterTurn = await countBubbles();
    // Real user activity as the mirror sees it: DOM events inside the VNC
    // iframe. (Playwright's page.mouse events do NOT cross the iframe
    // boundary in headless runs — verified HITS:0 — so dispatch in-page.)
    // Evidence of continuation: the auto-note renders, a continuation POST
    // leaves the page, and (provider health permitting) a new bubble lands.
    // The listener must attach BEFORE dispatch — the trigger fires instantly.
    // Model variance: the turn may end in a non-awaiting state (question,
    // checklist complete). Up to 2 attempts — nudge the checklist forward,
    // wait idle, dispatch activity, look for the auto-continue.
    let continuationPost = false;
    let note = false;
    let resumed = false;
    let dispatched = false;
    const onReq = (r) => { if (r.method() === 'POST' && r.url().includes('/api/chat')) continuationPost = true; };
    page.on('request', onReq);
    const dispatchActivity = () => page.evaluate(() => {
      const f = document.querySelector('#kasmvnc-container iframe') ?? document.querySelector('iframe');
      const doc = f?.contentDocument;
      if (!doc) return false;
      for (let i = 0; i < 5; i++) {
        doc.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 300 + i * 20, clientY: 300 }));
      }
      doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 400, clientY: 300, button: 0 }));
      doc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 400, clientY: 300, button: 0 }));
      return true;
    });
    for (let attempt = 0; attempt < 2 && !note; attempt++) {
      if (attempt > 0) {
        // Nudge the checklist forward, wait for the turn to settle, retry.
        await page.fill('#chat-input', 'Continue the checklist — mark the next step and tell me what to click.');
        await page.click('#chat-send');
        let st = 0, pv = await countBubbles();
        for (let i = 0; i < 45 && st < 6; i++) {
          await page.waitForTimeout(2000);
          const busy = await page.evaluate(() =>
            document.querySelectorAll('.chat-thinking:not(.chat-thinking--settled)').length > 0);
          const now = await countBubbles();
          st = (now === pv && !busy) ? st + 1 : 0;
          pv = now;
        }
      }
      continuationPost = false;
      dispatched = await page.evaluate(() => {
        const f = document.querySelector('#kasmvnc-container iframe') ?? document.querySelector('iframe');
        const doc = f?.contentDocument;
        if (!doc) return false;
        for (let i = 0; i < 5; i++) {
          doc.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 300 + i * 20, clientY: 300 }));
        }
        doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 400, clientY: 300, button: 0 }));
        doc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 400, clientY: 300, button: 0 }));
        return true;
      });
      note = await page.evaluate(() => document.querySelectorAll('.chat-msg--auto').length > 0);
      if (!note) continue;
      for (let i = 0; i < 75; i++) {
        await page.waitForTimeout(2000);
        if ((await countBubbles()) > afterTurn) { resumed = true; break; }
      }
      break;
    }
    page.off('request', onReq);
    // Provider hiccups (fetch failed/terminated) can kill the resumed turn
    // after it left the page — the trigger + continuation POST still prove it.
    check('auto-continue resumes on VM click (no typing)', (resumed || (note && continuationPost)),
      `goBtn=${!!goBtn} dispatched=${dispatched} note=${note} post=${continuationPost} bubbles ${before} -> ${afterTurn}${resumed ? ' -> resumed' : ''}`);
    // The resumed turn may still be streaming server-side. Wait for the
    // panel to go idle (no animated thinking dots) before cleanup, else the
    // zombie turn commits markings into the NEXT bench run.
    let idleStable = 0;
    for (let i = 0; i < 180 && idleStable < 3; i++) {
      await page.waitForTimeout(1000);
      const busy = await page.evaluate(() =>
        document.querySelectorAll('.chat-thinking:not(.chat-thinking--settled)').length > 0);
      idleStable = busy ? 0 : idleStable + 1;
    }
  } catch (autoErr) {
    check('auto-continue resumes on VM click (no typing)', false, autoErr.message.slice(0, 120));
  }

  await page.waitForTimeout(1200);
  await grabFrame(page, 'b4_navigation_final');
  console.log('SCORECARD:', JSON.stringify(scores), '| tools:', rGo.tools.join(','), '| text:', rGo.text.slice(0, 180));
} catch (err) {
  console.log('BENCH ERROR:', err.message);
  scores.fail++;
} finally {
  // OCR: cleanup must run even on failure — never leave prefs/markings behind.
  // Panel-driven auto-continue turns can finish server-side AFTER the browser
  // closes (client abort does not stop the stream) — wait, then verify the
  // render layer is actually empty, retrying the clear.
  try {
    // In-flight auto-continue turns can commit minutes later — wait for the
    // render layer to settle at zero before declaring victory.
    await new Promise((r) => setTimeout(r, 6000));
    const overlayCount = () => page.evaluate(async () => {
      const r = await fetch('/api/overlays', { credentials: 'include' });
      const j = r.ok ? await r.json() : null;
      return j?.count ?? -1;
    });
    for (let i = 0; i < 3 && (await overlayCount()) !== 0; i++) {
      await sendAsHuman(page, 'Clear every marking off the screen now.');
      await new Promise((r) => setTimeout(r, 2500));
    }
    await page.evaluate(async () => {
      await fetch('/api/me/preferences', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ enforcePreview: true, maxTextMarkings: 2, maxNonTextMarkings: 2, contextBudgetChars: 48000 }),
      });
    });
    console.log('CLEANUP: done (prefs restored, overlays:', await overlayCount(), ')');
  } catch (cleanupErr) {
    console.log('CLEANUP FAILED:', cleanupErr.message);
  }
  await b.close();
}