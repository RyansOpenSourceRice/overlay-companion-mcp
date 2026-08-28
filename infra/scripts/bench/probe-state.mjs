import { chromium } from 'playwright-core';
import { ensureShell, connectDesktop } from './bench-lib.mjs';
const b = await chromium.launch();
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);
  const st = await page.evaluate(() => {
    const app = window.app;
    const canvas = document.getElementById('overlay-canvas');
    let painted = -1;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      painted = 0;
      for (let i = 3; i < img.length; i += 4) if (img[i] > 0) painted++;
    }
    return {
      remoteOverlays: app?.chatPanel ? 'n/a' : undefined,
      canvasPaintedPx: painted,
      canvasSize: canvas ? canvas.width + 'x' + canvas.height : null,
    };
  });
  console.log('PAGE:', JSON.stringify(st));
  const r = await page.evaluate(async () => {
    const ctrl = new AbortController();
    const sse = await fetch('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Call list_overlays and reply with only the raw count value.' }] }),
    }).then((x) => x.text());
    return sse;
  });
  console.log('CHAT_REPLY:', r.replace(/\s+/g, ' ').match(/count[^0-9]*([0-9]+)/)?.[1] ?? '?');
} finally { await b.close(); }
