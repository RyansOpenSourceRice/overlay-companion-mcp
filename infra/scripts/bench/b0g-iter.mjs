/** Gated iteration: human reports the miss; model must see -> fix -> verify. */
import { chromium } from 'playwright-core';
import { ensureShell, connectDesktop, sendAsHuman, grabFrame, xdotool } from './bench-lib.mjs';
const b = await chromium.launch();
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);
  const s1 = await sendAsHuman(page,
    'I clicked your marking but the welcome panel did not close. Look at the screen, find the small ✕ close button on the welcome panel, adjust your marking to sit exactly on that ✕, and tell me when ready.');
  console.log('TOOLS:', JSON.stringify(s1.tools));
  console.log('BLOCKS:', (s1.raw ?? []).filter((r) => r.result.includes('preview_pending')).length,
              'COMMITS:', (s1.raw ?? []).filter((r) => r.result.includes('overlay_id')).length);
  console.log('TEXT:', s1.text.slice(0, 250));
  await page.waitForTimeout(1200);
  console.log('FRAME:', await grabFrame(page, 'b0g_iter'));
} finally { await b.close(); }
