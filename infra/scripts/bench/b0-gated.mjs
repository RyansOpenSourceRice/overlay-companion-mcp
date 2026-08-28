/** B0-gated: welcome-close mission under the preview gate, with miss measurement. */
import { chromium } from 'playwright-core';
import { ensureShell, connectDesktop, sendAsHuman, grabFrame, xdotool } from './bench-lib.mjs';

const TRUE_X = 326, TRUE_Y = 244; // the ✕ center in guest space

const b = await chromium.launch();
const score = { mission: 'B0-gated', previewBlocks: 0, commits: 0, missPx: null, popupClosed: null, failures: [] };
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  // The gated mission owns its precondition: enable grounding explicitly.
  await page.evaluate(async () => {
    const r = await fetch('/api/me/preferences', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ enforcePreview: true }),
    });
    if (!r.ok) throw new Error('failed to enable enforcePreview');
  });
  await connectDesktop(page);

  // fresh state
  await sendAsHuman(page, 'Remove every overlay so I start clean.');
  await page.waitForTimeout(1200);

  const s1 = await sendAsHuman(page,
    'Annotate exactly where I should click to close the "Welcome to OpenStreetMap" message. One marking.');
  score.previewBlocks = (s1.raw ?? []).filter((r) => r.result.includes('preview_pending')).length;
  score.commits = (s1.raw ?? []).filter((r) => r.result.includes('overlay_id')).length;
  if (s1.annotations.length === 0) { score.failures.push('no annotation committed'); }
  else {
    const a = s1.annotations[s1.annotations.length - 1].bounds;
    const frame = await grabFrame(page, 'b0g_before_click');
    await grabFrame(page, 'b0g_before_click');
    const { execSync } = await import('node:child_process');
    const { writeFileSync } = await import('node:fs');
    writeFileSync('/tmp/bench/miss.py', `
from PIL import Image
import math, json
a = json.loads('''${JSON.stringify(a)}''')
img = Image.open('/tmp/bench/b0g_before_click.png').convert('RGB')
sx, sy = img.width/1024, img.height/768
x0,y0 = int((a['x']-8)*sx), int((a['y']-8)*sy)
x1,y1 = int((a['x']+a['width']+8)*sx), int((a['y']+a['height']+8)*sy)
xs=ys=n=0
for xx in range(max(0,x0), min(img.width,x1)):
    for yy in range(max(0,y0), min(img.height,y1)):
        r,g,bl = img.getpixel((xx,yy))
        if r>170 and g<80 and bl<80:
            xs+=xx; ys+=yy; n+=1
if n:
    cx, cy = xs/n/sx, ys/n/sy
    print(round(math.hypot(cx-${TRUE_X}, cy-${TRUE_Y}),1))
else:
    print(-1)
`);
    try {
      score.missPx = parseFloat(execSync('python3 /tmp/bench/miss.py', { encoding: 'utf8' }).trim());
    } catch { score.failures.push('miss measurement failed'); }
    // human clicks the ANNOTATED center (not the true one)
    const cx = Math.round(a.x + a.width / 2), cy = Math.round(a.y + a.height / 2);
    xdotool(`mousemove ${cx} ${cy} click 1`);
    await page.waitForTimeout(3500);
    await grabFrame(page, 'b0g_after_click');
  }

  // Verify popup state via the assistant's own eyes (deterministic-enough judge assist)
  const s2 = await sendAsHuman(page, 'Look at the screen now: is the welcome message panel still visible? Answer yes or no, then remove your marking.');
  const t = s2.text.toLowerCase();
  score.popupClosed = !(t.startsWith('yes') || t.includes('still visible') || t.includes(' still open'));
  await page.waitForTimeout(1000);
  console.log('SCORECARD:', JSON.stringify({ ...score, raw: s1.raw }, null, 1));
} finally { await b.close(); }
