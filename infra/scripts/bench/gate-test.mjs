import { chromium } from 'playwright-core';
import { ensureShell, connectDesktop, sendAsHuman, grabFrame } from './bench-lib.mjs';
const b = await chromium.launch();
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);
  // Gate precondition: enable grounding for this user.
  await page.evaluate(async () => {
    const r = await fetch('/api/me/preferences', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ enforcePreview: true }),
    });
    if (!r.ok) throw new Error('failed to enable enforcePreview');
  });
  const spec = 'Call template_overlay with template "circle" and templateParams {"x":500,"y":400,"radius":40,"color":"#FF0000"} now.';
  const r1 = await sendAsHuman(page, spec);
  console.log('CALL1:', JSON.stringify({ tools: r1.tools, errors: r1.errors, results: r1.raw?.slice(0, 900), text: r1.text.slice(0, 180) }));
  const r2 = await sendAsHuman(page, spec);
  console.log('CALL2:', JSON.stringify({ tools: r2.tools, errors: r2.errors, text: r2.text.slice(0, 180) }));
  await page.waitForTimeout(1500);
  console.log('FRAME:', await grabFrame(page, 'gate_committed'));
} finally { await b.close(); }
