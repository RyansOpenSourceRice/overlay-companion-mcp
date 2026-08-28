/**
 * Bench step-runner: send ONE human message, print the assistant's
 * annotations + prose, save a frame. The driver decides clicks between runs.
 *   node bench/step.mjs "message to assistant"
 */
import { chromium } from 'playwright-core';
import { ensureShell, connectDesktop, sendAsHuman, grabFrame, xdotool } from './bench-lib.mjs';

const msg = process.argv[2];
if (!msg) { console.error('usage: node step.mjs "message"'); process.exit(2); }

const b = await chromium.launch();
try {
  const page = await (await b.newContext()).newPage();
  await ensureShell(page);
  await connectDesktop(page);
  const r = await sendAsHuman(page, msg);
  console.log(JSON.stringify({
    annotations: r.annotations,
    tools: r.tools,
    errors: r.errors,
    text: r.text.slice(0, 400),
  }, null, 1));
  console.log('FRAME:', await grabFrame(page, 'last_step'));
} finally { await b.close(); }