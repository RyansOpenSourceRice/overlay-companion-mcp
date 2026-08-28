import { chromium } from 'playwright-core';
const b = await chromium.launch();
try {
  const page = await b.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE:', m.text().slice(0, 160)); });
  page.on('pageerror', (e) => console.log('PAGEERR:', String(e).slice(0, 200)));
  // Robust login: retry UI/api cycles until the app shell actually renders.
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
  console.log('SHELL:', JSON.stringify({ ready: await shellReady(), tries }));
  if (!(await shellReady())) process.exit(1);
  // Open the chat panel so #chat-input exists
  // Panel input may be rendered lazily; try toggle, then nav, then reload.
  // Real trusted click on the nav toggle.
  const btn = await page.$('#chat-toggle-btn');
  if (btn) { await btn.click({ force: true }); await page.waitForTimeout(1000); }
  let opened = await page.evaluate(() => !!document.getElementById('chat-input'));
  if (!opened) {
    const dbg = await page.evaluate(() => {
      const info = {};
      try { window.app?.setupEventListeners?.(); } catch (e) { info.err1 = String(e); }
      const t = document.getElementById('chat-toggle-btn');
      try { t.click(); } catch (e) { info.err2 = String(e); }
      info.hasMain = !!document.querySelector('main.main-content');
      info.mainKids = [...(document.querySelector('main.main-content')?.children ?? [])].map((k) => k.id || k.className).slice(0, 8);
      info.bodyCls = document.body.className;
      info.url = location.href;
      info.rootSnippet = (document.querySelector('#app, #root, body')?.innerHTML ?? '').replace(/\s+/g,' ').slice(0, 220);
      info.activePages = [...document.querySelectorAll('.page.active')].map((p) => p.id);
      return info;
    });
    console.log('DBG:', JSON.stringify(dbg));
    await page.waitForTimeout(600);
    opened = await page.evaluate(() => !!document.getElementById('chat-input'));
  }
  opened = await page.evaluate(() => !!document.getElementById('chat-input'));
  console.log('PANEL:', JSON.stringify({ opened }));
  if (!opened) process.exit(1);

  // Goal 1: Shift+Enter must insert a newline; Enter sends.
  const shiftResult = await page.evaluate(() => {
    const ta = document.getElementById('chat-input');
    ta.focus();
    ta.value = 'line one';
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    return {
      stillOnLineOne: ta.value === 'line one',
      isTextarea: ta.tagName === 'TEXTAREA',
      sendBtnVisible: !!document.getElementById('chat-send'),
    };
  });
  console.log('SHIFT-ENTER:', JSON.stringify(shiftResult));

  // Capture raw SSE the panel receives.
  await page.evaluate(() => {
    const orig = window.fetch;
    window.__chatRaw = '';
    window.fetch = async (...args) => {
      const res = await orig(...args);
      if (String(args[0]).includes('/api/chat')) {
        window.__chatReqBody = String((args[1] && args[1].body) ?? '');
        res.clone().text().then((t) => { window.__chatRaw = t; }).catch(() => {});
      }
      return res;
    };
  });

  // Goal 2/7: drive the REAL panel UI — type prompt, press Enter, wait for
  // markdown-rendered assistant bubble.
  await page.fill('#chat-input', 'Teach me the difference between **left click** and *right click*. Use bold and ==a highlight== and `code`.');
  await page.keyboard.press('Enter');
  let chatStatus = '';
  page.on('response', async (r) => {
    if (r.url().includes('/api/chat') && r.request().method() === 'POST') chatStatus = String(r.status());
  });
  await page.waitForTimeout(45000);
  const domCheck2 = await page.evaluate(() => ({
    bubbles: document.querySelectorAll('.chat-msg').length,
    lastBubbleHtml: (() => {
      const els = Array.from(document.querySelectorAll('.chat-msg'));
      const el = els[els.length - 1];
      return el ? el.innerHTML.replace(/\s+/g, ' ').slice(0, 260) : '(none)';
    })(),
    workingPillVisible: (() => {
      const p = document.querySelector('.chat-working');
      return !!p && p.style.display !== 'none';
    })(),
  }));
  console.log('CHAT:', JSON.stringify({ chatStatus, rawEvents: await page.evaluate(() => (window.__chatRaw || '').split('\n').filter((l) => l.startsWith('data:')).length), reqHead: await page.evaluate(() => (window.__chatReqBody || '').slice(0, 200)) }));
  console.log('DOM2:', JSON.stringify(domCheck2));

  const domCheck = await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll('.chat-msg--assistant'));
    const last = bubbles[bubbles.length - 1];
    if (!last) return { err: 'no bubble' };
    return {
      hasStrong: !!last.querySelector('strong'),
      hasEm: !!last.querySelector('em'),
      hasCode: !!last.querySelector('.md-code'),
      hasMark: !!last.querySelector('.md-mark'),
      boldText: (last.querySelector('strong') || {}).textContent || '',
      rawAsterisksLeft: /\*\*[^*]+\*\*/.test(last.textContent ?? ''),
      impactRowsGone: !document.querySelector('.chat-impact'),
    };
  });
} finally { await b.close(); }
