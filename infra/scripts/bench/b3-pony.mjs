/**
 * Bench B3 — Blender low-poly pony (roadmap capstone). SCAFFOLD.
 *
 * Protocol (locked): the bench driver plays the HUMAN. Mouse clicks happen
 * ONLY at annotation-directed coordinates (xdotool inside the kasmvnc
 * container). Typing is human-commonsense driven by the assistant's prose.
 * The driver (a vision model / the overseeing agent) judges each step from
 * saved composite frames; semantic judging cannot be automated.
 *
 * Mission outline:
 *   S0  Prereqs: blender present in the kasmvnc container (else instruct how
 *       to install; the bench aborts with clear guidance rather than failing
 *       opaquely).
 *   S1  Assistant annotates the Blender icon / app menu to launch it; driver
 *       clicks the marked spot.
 *   S2  Driver waits for the Blender window; assistant marks File > Add >
 *       Mesh > Monkey (or a low-poly base primitive) via nested menu
 *       annotation; driver clicks.
 *   S3  Edit-mode steps: assistant marks the mode-toggle and one transform
 *       control; driver clicks; judge from frames.
 *   S4  Final: composite frame saved as b3_pony_final.png for vision judging.
 *
 * Each step is sendAsHuman-driven; the driver clicks ONLY at returned
 * annotation centers. Steps pause for driver inspection — run this mission
 * supervised (it is intentionally not a CI gate).
 */
import { execSync } from 'node:child_process';
import { ensureShell, connectDesktop, sendAsHuman, grabFrame, humanClick, launchBrowser } from './bench-lib.mjs';

const hasBlender = () => {
  try {
    execSync('podman exec overlay-companion-kasmvnc sh -lc "command -v blender"', { encoding: 'utf8' });
    return true;
  } catch { return false; }
};

const b = await launchBrowser();
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);

  if (!hasBlender()) {
    console.log('B3 PREREQ MISSING: blender is not installed in the kasmvnc container.');
    console.log('Install with: podman exec overlay-companion-kasmvnc sh -lc "apt-get update && apt-get install -y blender"');
    console.log('Then rerun this mission. (B3 is a supervised mission — not a CI gate.)');
    process.exit(2);
  }

  // S1: launch Blender via an annotated desktop icon.
  const s1 = await sendAsHuman(page, 'Find the Blender application on the desktop or app menu and mark its icon so I can open it.', { timeoutMs: 240000 });
  const a1 = s1.annotations.at(-1);
  if (!a1) { console.log('B3 S1 FAIL: no annotation for the Blender icon'); process.exit(1); }
  humanClick(a1.bounds.x + a1.bounds.width / 2, a1.bounds.y + a1.bounds.height / 2);
  await page.waitForTimeout(15000); // Blender cold start

  // S2..S4 are driver-in-the-loop steps; frames are saved for judging.
  for (const step of [
    'Blender should be open now. Mark the Add menu at the top of the Blender window so I can add a mesh.',
    'I opened the Add menu. Mark the Monkey primitive (or the mesh primitive submenu entry) so I can click it.',
    'Now mark the Edit Mode toggle so I can start shaping the pony.',
  ]) {
    const r = await sendAsHuman(page, step, { timeoutMs: 240000 });
    const a = r.annotations.at(-1);
    if (!a) { console.log(`B3 step failed (no annotation): ${step}`); process.exit(1); }
    humanClick(a.bounds.x + a.bounds.width / 2, a.bounds.y + a.bounds.height / 2);
    await page.waitForTimeout(2500);
    console.log('B3 step done:', step.slice(0, 60), '| frame judged by driver');
  }
  await grabFrame(page, 'b3_pony_final');
  console.log('B3 scaffold complete — final frame saved for vision judging.');
} finally { await b.close(); }