/** Persistent mirror page: keeps frames flowing at 1s cadence while human acts. */
import { chromium } from 'playwright-core';
import { ensureShell, connectDesktop } from './bench-lib.mjs';
const b = await chromium.launch();
try {
  const page = await (await b.newContext()).newPage();
  await page.goto('http://localhost:8080/');
  await page.evaluate(() => localStorage.setItem('oc.mirrorCadence', '1000'));
  await ensureShell(page);
  await connectDesktop(page);
  page.on('console', (m) => { if (m.text().includes('[mirror]')) console.log('MLOG:', m.text().slice(0, 120)); });
  console.log('WATCHING');
  await page.waitForTimeout(1000 * 60 * 30); // stay alive; killed externally
} finally { await b.close(); }
