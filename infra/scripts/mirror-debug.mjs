import { chromium } from 'playwright';
const b = await chromium.launch();
try {
  const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('http://localhost:8080/');
  await page.waitForTimeout(1500);
  if (await page.$('#email, input[type=email]')) {
    await page.fill('#email, input[type=email]', 'demo@overlay.local');
    await page.fill('input[type=password]', 'demo-password-1234');
    await page.click('button[type=submit]');
    await page.waitForTimeout(2000);
  }
  await page.evaluate(async () => {
    await fetch('/auth/local/login', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ username: 'demo@overlay.local', password: 'demo-password-1234' }),
    });
  });
  await page.reload();
  await page.waitForTimeout(3500);
  const connId = await page.evaluate(async () => {
    const r = await fetch('/api/connections', { credentials: 'include' });
    const d = await r.json();
    const list = Array.isArray(d) ? d : d.connections ?? [];
    return list[0]?.id ?? null;
  });
  await page.evaluate((id) => window.app?.connectToVM?.(id), connId);
  await page.waitForTimeout(12000);

  const report = await page.evaluate(() => {
    const ifr = document.querySelector('#kasmvnc-container iframe');
    const doc = ifr?.contentDocument;
    const out = { sameOrigin: !!doc, canvases: [] };
    if (!doc) return out;
    out.sameOrigin = true;
    for (const c of doc.querySelectorAll('canvas')) {
      let nonBlack = -1;
      try {
        const ctx = c.getContext('2d');
        if (ctx && c.width > 0 && c.height > 0) {
          // sample sparse grid to avoid huge read cost
          nonBlack = 0;
          const stepX = Math.max(1, Math.floor(c.width / 40));
          const stepY = Math.max(1, Math.floor(c.height / 40));
          for (let x = 0; x < c.width; x += stepX) {
            for (let y = 0; y < c.height; y += stepY) {
              const px = ctx.getImageData(x, y, 1, 1).data;
              if (px[3] > 0 && (px[0] > 12 || px[1] > 12 || px[2] > 12)) nonBlack++;
            }
          }
        }
      } catch (e) { nonBlack = 'ERR:' + String(e).slice(0, 40); }
      out.canvases.push({
        w: c.width, h: c.height,
        cls: c.className || '(none)',
        id: c.id || '',
        visibleW: c.getBoundingClientRect().width,
        parentCls: c.parentElement?.className?.slice(0, 60),
        nonBlackSampled: nonBlack,
      });
    }
    out.divsWithBg = [...doc.querySelectorAll('div')].filter((d) => getComputedStyle(d).backgroundImage !== 'none').length;
    return out;
  });
  console.log(JSON.stringify(report, null, 1));
} finally { await b.close(); }
