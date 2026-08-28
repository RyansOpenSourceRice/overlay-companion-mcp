import { chromium } from 'playwright-core';
import { ensureShell, connectDesktop, sendAsHuman, grabFrame } from './bench-lib.mjs';
const b = await chromium.launch();
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);
  const r = await sendAsHuman(page, 'Call template_overlay with template "circle" and templateParams {"x":326,"y":244,"radius":22,"color":"#FF0000"} exactly. Then report the bounds JSON verbatim.');
  console.log('TOOLS:', JSON.stringify(r.tools));
  console.log('ANN:', JSON.stringify(r.annotations));
  await page.waitForTimeout(1500);
  // Force a fresh composite through the see_screen trigger path.
  const before = Date.now();
  await sendAsHuman(page, 'Call see_screen now.');
  console.log('FRESH_LATENCY_MS:', Date.now() - before);
  console.log('FRAME:', await grabFrame(page, 'isolate_fresh'));
} finally { await b.close(); }
