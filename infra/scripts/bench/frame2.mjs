import { chromium } from 'playwright-core';
import { ensureShell, connectDesktop, grabFrame } from './bench-lib.mjs';
const b = await chromium.launch();
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);
  await page.waitForTimeout(3000);
  console.log('FRAME:', await grabFrame(page, 'after_clear'));
} finally { await b.close(); }
