import { chromium } from 'playwright-core';
import { grabFrame } from './bench-lib.mjs';
const b = await chromium.launch();
const page = await (await b.newContext()).newPage();
await page.goto('http://localhost:8080/'); await page.waitForTimeout(800);
await page.evaluate(async () => { await fetch('/auth/local/login', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ username: 'demo@overlay.local', password: 'demo-password-1234' }) }); });
await page.reload(); await page.waitForTimeout(2500);
console.log('FRAME:', await grabFrame(page, 'after_clear'));
await b.close();
