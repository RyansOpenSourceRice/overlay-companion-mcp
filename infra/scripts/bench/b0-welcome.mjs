/**
 * Mission B0 — golden path: close the OpenStreetMap welcome message.
 *
 * The bench driver is the human: it clicks ONLY where the assistant's
 * annotation directs. Scorecard records annotation coordinates, click target,
 * and frame evidence for driver-side visual judging.
 */
import { chromium } from 'playwright-core';
import { ensureShell, connectDesktop, sendAsHuman, grabFrame, humanClick } from './bench-lib.mjs';

const b = await chromium.launch();
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);

  // 0. Baseline frame for the driver to inspect (is the welcome popup up?).
  console.log('BASELINE:', await grabFrame(page, 'b0_start'));

  // 1. Ask the assistant as the human would.
  const step1 = await sendAsHuman(page,
    'Teach me how to close the welcome to OpenStreetMap message. Annotate exactly where I should click — one marking only.');
  console.log('STEP1:', JSON.stringify({
    annotations: step1.annotations,
    tools: step1.tools,
    errors: step1.errors,
    text: step1.text.slice(0, 220),
  }, null, 1));

  // 2. The human clicks where told (first annotation center).
  if (step1.annotations.length > 0) {
    const a = step1.annotations[0].bounds;
    const cx = a.x + a.width / 2;
    const cy = a.y + a.height / 2;
    console.log('HUMAN-CLICK:', JSON.stringify({ x: cx, y: cy }));
    humanClick(cx, cy);
    await page.waitForTimeout(2500);
  }

  // 3. Post-click frame for judging.
  console.log('AFTER:', await grabFrame(page, 'b0_after'));

  const step2 = step1.annotations.length > 0
    ? await sendAsHuman(page, 'I clicked where you marked. Did it close? If yes, clean up your marking so the screen is clear.')
    : null;
  if (step2) console.log('STEP2:', JSON.stringify({ text: step2.text.slice(0, 220), tools: step2.tools, errors: step2.errors }));
} finally { await b.close(); }