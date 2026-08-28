import { chromium } from 'playwright-core';
import { ensureShell, connectDesktop } from './bench-lib.mjs';
const b = await chromium.launch();
try {
  const page = await (await b.newContext()).newPage();
  await page.goto('http://localhost:8080/');
  await page.evaluate(() => localStorage.setItem('oc.mirrorCadence', '1000'));
  await ensureShell(page);
  await connectDesktop(page);
  console.log('CONNECTED');
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(4000);
    const st = await page.evaluate(() => {
      const m = window.__ocMirror;
      return m ? { cad: String(m.cadence), ...m.uploadStats, vis: document.visibilityState } : 'NO_HOOK';
    });
    console.log('STATS:', JSON.stringify(st));
  }
} finally { await b.close(); }
