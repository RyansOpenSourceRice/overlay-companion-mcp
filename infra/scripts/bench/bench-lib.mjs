/**
 * VLA fidelity bench — shared helpers.
 *
 * Protocol: the bench driver plays the HUMAN. Mouse clicks happen ONLY at
 * annotation-directed coordinates (xdotool inside the kasmvnc container).
 * Typing is human-commonsense, driven by the assistant's prose. Judging is
 * deterministic where pixels allow; the driver (a vision model) inspects
 * saved frames otherwise.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

export const BASE = 'http://localhost:8080';
mkdirSync('/tmp/bench', { recursive: true });

export function xdotool(args) {
  return execSync(`podman exec overlay-companion-kasmvnc xdotool ${args}`, { encoding: 'utf8' }).trim();
}

/** Guest-resolution click. Annotations are authored in guest coords (xdotool space). */
export function humanClick(x, y, button = 1) {
  xdotool(`mousemove ${Math.round(x)} ${Math.round(y)} click ${button}`);
}

export async function ensureShell(page) {
  const ready = async () => !!(await page.$('main.main-content'));
  let tries = 0;
  while (!(await ready()) && tries < 4) {
    tries++;
    await page.goto(`${BASE}/`);
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
  if (!(await ready())) throw new Error('app shell never rendered');
}

export async function connectDesktop(page) {
  const connId = await page.evaluate(async () => {
    const r = await fetch('/api/connections', { credentials: 'include' });
    const d = await r.json();
    const list = Array.isArray(d) ? d : d.connections ?? [];
    return list[0]?.id ?? null;
  });
  if (!connId) throw new Error('no connections seeded');
  await page.evaluate((id) => window.app?.connectToVM?.(id), connId);
  // Wait until the server holds at least one mirror frame.
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate(async () => {
      const r = await fetch('/api/screen-mirror/latest', { credentials: 'include' });
      return r.ok;
    });
    if (ok) return;
    await page.waitForTimeout(1500);
  }
  throw new Error('mirror produced no frames');
}

/** Send a user message through the app; returns {text, annotations[], tools[]}. */
export async function sendAsHuman(page, message, { timeoutMs = 120000 } = {}) {
  const sse = await page.evaluate(async ({ message, timeoutMs }) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ messages: [{ role: 'user', content: message }] }),
        signal: ctrl.signal,
      });
      return await r.text();
    } finally { clearTimeout(t); }
  }, { message, timeoutMs });

  const out = { text: '', annotations: [], tools: [], errors: [] };
  for (const line of sse.split('\n').filter((l) => l.startsWith('data:'))) {
    let j;
    try { j = JSON.parse(line.slice(5)); } catch { continue; }
    if (j.error) out.errors.push(String(j.error).slice(0, 200));
    if (j.tool) {
      const rawR = typeof j.result === 'string' ? j.result : JSON.stringify(j.result ?? '');
      const isError = rawR.includes('isError\":true') || rawR.includes('error');
      out.tools.push(j.tool + (isError ? '(!)' : ''));
    }
    if (j.text && !j.thinking) out.text += j.text;
    // Annotation coordinates: bounds out of draw/template results.
    if (j.tool && ['draw_overlay', 'template_overlay'].includes(j.tool)) {
      const raw = typeof j.result === 'string' ? j.result : JSON.stringify(j.result ?? '');
      try {
        const inner = JSON.parse(raw);
        const payload = typeof inner.content?.[0]?.text === 'string' ? JSON.parse(inner.content[0].text) : inner;
        const b = payload.bounds ?? null;
        if (b) out.annotations.push({ tool: j.tool, bounds: b, color: payload.color ?? null, overlay_id: payload.overlay_id ?? null });
      } catch { /* unparseable tool result */ }
    }
  }
  out.text = out.text.replace(/\s+/g, ' ').trim();
  return out;
}

/** Save the newest server-side mirror frame (composite: desktop + overlays). */
export async function grabFrame(page, name) {
  // Force a fresh composite capture — interval uploads throttle on idle
  // headless pages, so /latest alone can serve a minutes-old frame.
  await page.evaluate(() => window.__ocMirror?.captureNow?.()).catch(() => {});
  await page.waitForTimeout(900);
  const dataUrl = await page.evaluate(async () => {
    const r = await fetch('/api/screen-mirror/latest', { credentials: 'include' });
    if (!r.ok) return 'ERR:' + r.status;
    const j = await r.json();
    return j.ageMs > 5000 ? 'ERR:stale_' + j.ageMs : (j.dataUrl ?? 'ERR:no_dataurl');
  });
  if (!dataUrl || dataUrl.startsWith('ERR:')) {
    console.log('GRABFAIL:', dataUrl);
    return null;
  }
  const path = `/tmp/bench/${name}.png`;
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return path;
}