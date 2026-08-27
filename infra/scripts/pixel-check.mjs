// R9 pixel check: connect to the demo desktop like a user, then sample the
// overlay canvas to prove chat-drawn annotations actually render.
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:8080';
const b = await chromium.launch();
try {
  const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(1200);
  if (await page.$('#email, input[type=email]')) {
    await page.fill('#email, input[type=email]', 'demo@overlay.local');
    await page.fill('input[type=password]', 'demo-password-1234');
    await page.click('button[type=submit]');
    await page.waitForTimeout(2000);
  }
  // Ensure an authenticated session for the connections API.
  await page.evaluate(async () => {
    await fetch('/auth/local/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: 'demo@overlay.local', password: 'demo-password-1234' }),
    });
  });
  await page.reload();
  await page.waitForTimeout(4000);
  const connId = await page.evaluate(async () => {
    const r = await fetch('/api/connections', { credentials: 'include' });
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data.connections ?? []);
    return list[0]?.id ?? null;
  });
  if (!connId) { console.error('no connections'); process.exit(1); }
  await page.evaluate((id) => window.app?.connectToVM?.(id), connId);
  await page.waitForTimeout(8000);
  const check = await page.evaluate(() => {
    const canvas = document.getElementById('overlay-canvas');
    if (!canvas || !canvas.width) return { visible: false, reason: 'no canvas' };
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let yellow = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i] > 180 && img.data[i + 1] > 180 && img.data[i + 2] < 120) yellow++;
    }
    return { visible: yellow > 50, yellowPixels: yellow };
  });
  console.log(JSON.stringify(check));
  process.exit(check.visible ? 0 : 1);
} finally {
  await b.close();
}
