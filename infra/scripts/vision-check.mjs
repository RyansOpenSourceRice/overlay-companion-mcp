import { chromium } from 'playwright-core';
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
  // wait for boot-retry to land a frame
  await page.waitForTimeout(30000);

  const probe = await page.evaluate(() => {
    const disp = window.__ocDisplay;
    return { ocDisplay: disp ?? 'MISSING' };
  });
  console.log('OC:', JSON.stringify(probe));

  const reply = await page.evaluate(async () => {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Use see_screen now. Describe precisely what you see: any text, colors, windows, or map elements.' }] }),
    });
    return await r.text();
  });
  let text = ''; let tools = [];
  for (const l of reply.split('\n').filter((l) => l.startsWith('data:'))) {
    try {
      const j = JSON.parse(l.slice(5));
      if (j.tool) tools.push(j.tool + ':' + String(j.result).slice(0, 90));
      if (j.text && !j.thinking) text += j.text;
    } catch { /* skip */ }
  }
  console.log('TOOLS:', JSON.stringify(tools));
  console.log('TEXT:', text.replace(/\s+/g, ' ').trim().slice(0, 400));
} finally { await b.close(); }
