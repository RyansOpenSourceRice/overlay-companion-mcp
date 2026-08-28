import { chromium } from 'playwright-core';
const b = await chromium.launch();
try {
  const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
  // Robust shell-ready loop (login-wipe hardening)
  const shellReady = async () => !!(await page.$('main.main-content'));
  let tries = 0;
  while (!(await shellReady()) && tries < 4) {
    tries++;
    await page.goto('http://localhost:8080/');
    await page.waitForTimeout(1200);
    if (await page.$('#email, input[type=email]')) {
      await page.fill('#email, input[type=email]', 'demo@overlay.local');
      await page.fill('input[type=password]', 'demo-password-1234');
      await page.click('button[type=submit]');
      await page.waitForTimeout(2200);
    } else {
      await page.evaluate(async () => {
        await fetch('/auth/local/login', {
          method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ username: 'demo@overlay.local', password: 'demo-password-1234' }),
        });
      });
      await page.reload();
      await page.waitForTimeout(1800);
    }
  }
  if (!(await shellReady())) { console.log('SHELL_FAIL'); process.exit(1); }

  // Open desktop so mirror + overlay canvas exist
  const connId = await page.evaluate(async () => {
    const r = await fetch('/api/connections', { credentials: 'include' });
    const d = await r.json();
    const list = Array.isArray(d) ? d : d.connections ?? [];
    return list[0]?.id ?? null;
  });
  await page.evaluate((id) => window.app?.connectToVM?.(id), connId);
  await page.waitForTimeout(20000); // generous KasmVNC client boot
  for (let i = 0; i < 3; i++) {
    const state = await page.evaluate(() => {
      const ifr = document.querySelector('#kasmvnc-container iframe');
      const doc = ifr?.contentDocument ?? null;
      return {
        src: ifr?.src?.slice(0, 60) ?? null,
        readyState: doc?.readyState ?? null,
        canvasCount: doc ? doc.querySelectorAll('canvas').length : -1,
        title: doc?.title?.slice(0, 40) ?? null,
      };
    });
    console.log('STATE' + i + ':', JSON.stringify(state));
    if (state.canvasCount > 0) break;
    await page.waitForTimeout(6000);
  }
  const probe = await page.evaluate(() => {
    const ifr = document.querySelector('#kasmvnc-container iframe');
    const doc = ifr?.contentDocument ?? null;
    const canvases = doc ? Array.from(doc.querySelectorAll('canvas')).map((c) => ({
      w: c.width, h: c.height,
      vw: Math.round(c.getBoundingClientRect().width),
    })) : [];
    return { iframe: !!ifr, sameOrigin: !!doc, canvases, ocDisplay: window.__ocDisplay ?? 'MISSING' };
  });
  console.log('PROBE:', JSON.stringify(probe));

  // Draw one overlay through the real chat pipeline
  await page.evaluate(async () => {
    await fetch('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Draw one yellow circle at x=460 y=350 width=140 height=140 on the screen right now.' }] }),
    });
  });
  await page.waitForTimeout(3000);

  // A1 assertion: the SERVER-side latest mirror frame must contain the overlay.
  const frameCheck = await page.evaluate(async () => {
    const r = await fetch('/api/screen-mirror/latest', { credentials: 'include' });
    if (!r.ok) return { err: 'no frame', status: r.status };
    const f = await r.json();
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = f.dataUrl; });
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let yellow = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 180 && data[i + 1] > 180 && data[i + 2] < 120) yellow++;
    }
    return { frameAgeMs: f.ageMs, frameSize: `${img.width}x${img.height}`, yellowPixelsInMirror: yellow, compositeWorks: yellow > 30 };
  });
  console.log('A1-COMPOSITE:', JSON.stringify(frameCheck));
  const a1Pass = frameCheck.compositeWorks === true;

  // A4 assertion: see_screen must return a fresh (<3s) capture.
  const before = Date.now();
  const sse = await page.evaluate(async () => {
    const r = await fetch('/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Use see_screen and tell me the capturedSecondsAgo value only.' }] }),
    });
    return await r.text();
  });
  let toolResult = '';
  for (const l of sse.split('\n').filter((l) => l.startsWith('data:'))) {
    try {
      const j = JSON.parse(l.slice(5));
      if (j.tool === 'see_screen') toolResult = String(j.result);
    } catch { /* skip */ }
  }
  const ageMatch = toolResult.match(/capturedSecondsAgo\\?":(\d+)/);
  const age = ageMatch ? Number(ageMatch[1]) : 99;
  console.log('A4-FRESH:', JSON.stringify({
    latencyMs: Date.now() - before,
    capturedSecondsAgo: ageMatch ? Number(ageMatch[1]) : null,
    fresh: ageMatch !== null && age <= 3,
  }));
  process.exit(a1Pass && ageMatch && Number(ageMatch[1]) <= 3 ? 0 : 1);
} finally { await b.close(); }