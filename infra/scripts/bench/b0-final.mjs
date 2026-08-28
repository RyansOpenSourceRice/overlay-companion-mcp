/**
 * Mission B0 (final) — golden path, fully self-contained:
 *   1. clean any leftovers
 *   2. assistant annotates the Firefox icon -> human clicks it
 *   3. human-commonsense typing: focus address bar, open openstreetmap.org
 *   4. assistant annotates the welcome-popup close button -> human clicks it
 *   5. judge: popup gone (frame evidence saved per milestone)
 *
 * The human ONLY clicks at annotation-provided coordinates.
 */
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { ensureShell, connectDesktop, sendAsHuman, grabFrame, xdotool } from './bench-lib.mjs';

const b = await chromium.launch();
const score = { mission: 'B0-welcome', steps: [], failures: [] };
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);

  // ---- Step 1: clean slate -------------------------------------------------
  const s1 = await sendAsHuman(page, 'Old markings may be on screen. Remove every overlay so I start clean, then confirm.');
  score.steps.push({ step: 'clean', tools: s1.tools, errors: s1.errors });
  await page.waitForTimeout(1500);

  // ---- Step 2: open the browser via annotation -----------------------------
  const s2 = await sendAsHuman(page, 'Annotate exactly where I should click to launch Firefox. One marking.');
  const a2 = s2.annotations[0];
  if (!a2) { score.failures.push('step2: no annotation for Firefox icon'); }
  else {
    const cx = Math.round(a2.bounds.x + a2.bounds.width / 2);
    const cy = Math.round(a2.bounds.y + a2.bounds.height / 2);
    score.steps.push({ step: 'firefox-annotation', bounds: a2.bounds, clicked: [cx, cy] });
    xdotool(`mousemove ${cx} ${cy} click --repeat 2 --delay 150 1`);
    await page.waitForTimeout(9000);
    await grabFrame(page, 'b0_browser');
  }

  // ---- Step 3: human-commonsense typing to reach OpenStreetMap -------------
  xdotool('key --delay 80 ctrl+l');
  xdotool('type --delay 40 "https://www.openstreetmap.org"');
  xdotool('key Return');
  await page.waitForTimeout(12000);

  // ---- Step 4: welcome-popup close annotation ------------------------------
  const s4 = await sendAsHuman(page,
    'The map page should be open now. Look at your screen, then annotate exactly where I should click to close the welcome message. One marking.');
  const a4 = s4.annotations[0];
  if (!a4) { score.failures.push('step4: no annotation for welcome close'); }
  else {
    const cx = Math.round(a4.bounds.x + a4.bounds.width / 2);
    const cy = Math.round(a4.bounds.y + a4.bounds.height / 2);
    score.steps.push({ step: 'welcome-annotation', bounds: a4.bounds, clicked: [cx, cy], prose: s4.text.slice(0, 160) });
    await grabFrame(page, 'b0_before_click');
    xdotool(`mousemove ${cx} ${cy} click 1`);
    await page.waitForTimeout(3500);
    await grabFrame(page, 'b0_after_click');
  }

  // ---- Step 5: cleanup + confirm -------------------------------------------
  const s5 = await sendAsHuman(page, 'Done. Remove your marking and confirm the overlay list is empty.');
  score.steps.push({ step: 'cleanup', tools: s5.tools, errors: s5.errors, text: s5.text.slice(0, 140) });

  console.log('SCORECARD:', JSON.stringify(score, null, 1));
  console.log('FRAMES: /tmp/bench/b0_browser.png b0_before_click.png b0_after_click.png');
} finally { await b.close(); }