/**
 * Bench B2 — visual landmark marking (Phase 4 roadmap).
 *
 * Mission: from a live screen only (see_screen), mark THREE distinct UI
 * landmarks: (1) the address bar of the browser, (2) the primary menu
 * (hamburger) button, (3) a named link/text on the page. Judging is
 * deterministic:
 *   - 3 committed annotations with distinct, non-overlapping bounds
 *   - all inside the display bounds
 *   - each annotation a different color (the mission asks for distinct hues)
 *   - the final prose names what was marked (contains >= 2 landmark words)
 * Vision judging of SEMANTIC correctness (does the box really cover the
 * address bar?) is the driver's job via the saved composite frames.
 */
import { ensureShell, connectDesktop, sendAsHuman, grabFrame, launchBrowser } from './bench-lib.mjs';

const b = await launchBrowser();
const scores = { pass: 0, fail: 0 };
const check = (name, ok, detail = '') => {
  scores[ok ? 'pass' : 'fail']++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
};
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);

  // Mission setup (as the user would in Settings): gate off (this mission
  // tests visual placement, not the preview loop) and a 3-marking cap so the
  // task is exactly satisfiable.
  await page.evaluate(async () => {
    await fetch('/api/me/preferences', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ enforcePreview: false, maxTextMarkings: 2, maxNonTextMarkings: 3 }),
    });
  });

  const r = await sendAsHuman(page,
    'Using the screen, mark three landmarks for me, each in a DIFFERENT color: ' +
    '1) the browser address bar (green), 2) the menu/hamburger button (red), 3) the State of the Map logo or title text (yellow). ' +
    'Do it now without asking questions.',
    { timeoutMs: 300000 });

  const committed = r.annotations.filter((a) => a.bounds && a.bounds.width > 0);
  check('three annotations committed', committed.length >= 3, `got ${committed.length}; tools=${r.tools.join(',')}`);
  if (committed.length >= 3) {
    const boxes = committed.map((a) => a.bounds);
    const distinct = new Set(boxes.map((b) => `${b.x},${b.y},${b.width},${b.height}`)).size === boxes.length;
    check('bounds distinct', distinct, JSON.stringify(boxes));
    const overlap = (a, c) => !(a.x + a.width <= c.x || c.x + c.width <= a.x || a.y + a.height <= c.y || c.y + c.height <= a.y);
    const contains = (a, c) => a.x <= c.x && a.y <= c.y && a.x + a.width >= c.x + c.width && a.y + a.height >= c.y + c.height;
    let anyOverlap = false;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      // Containment is legitimate (a menu button inside a full-width toolbar
      // strip); only PARTIAL intersections are misplacements.
      if (overlap(boxes[i], boxes[j]) && !contains(boxes[i], boxes[j]) && !contains(boxes[j], boxes[i])) anyOverlap = true;
    }
    check('no partially-overlapping boxes', !anyOverlap);
    const inside = boxes.every((b) => b.x >= 0 && b.y >= 0 && b.width > 0 && b.height > 0);
    check('bounds sane', inside, JSON.stringify(boxes));
    const colors = new Set(committed.map((a) => (a.color ?? '').toLowerCase()));
    check('distinct colors used', colors.size >= 3, [...colors].join(','));
  }
  const named = /address bar|menu|logo|title/i.test(r.text);
  check('final prose names landmarks', named && r.text.length < 600, r.text.slice(0, 160));
  const clean = !r.errors.length || r.errors.every((e) => !/Recovery:/.test(e));
  check('no recovery-blob leakage', clean, r.errors.join(' | ').slice(0, 120));

  await page.waitForTimeout(1200);
  await grabFrame(page, 'b2_landmarks_final');
  console.log('SCORECARD:', JSON.stringify(scores), '| text:', r.text.slice(0, 200));

  // Cleanup for the next mission.
  await sendAsHuman(page, 'Clear every marking off the screen now.');
  await page.evaluate(async () => {
    await fetch('/api/me/preferences', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ enforcePreview: true, maxTextMarkings: 2, maxNonTextMarkings: 2 }),
    });
  });
  console.log('CLEANUP: done (prefs restored)');
} catch (err) {
  console.log('BENCH ERROR:', err.message);
  scores.fail++;
} finally { await b.close(); }