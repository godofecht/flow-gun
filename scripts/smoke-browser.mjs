// Browser integration regression for the actual Flow WebAssembly renderer.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve(process.env.GARDEN_DIST || 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(bytes);
  } catch (error) { res.writeHead(404).end(String(error)); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('requestfailed', request => errors.push(`${request.url()} ${request.failure()?.errorText}`));
  const address = process.env.GARDEN_TEST_URL || `http://127.0.0.1:${port}/`;
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => {
    const win = document.querySelector('#garden-frame')?.contentWindow;
    return win?.flowGfx?.frames > 8 && win.flowGfx.canvas?.getBoundingClientRect().width > 300;
  }, undefined, { timeout: 45000 });
  const before = await page.evaluate(() => {
    const win = document.querySelector('#garden-frame').contentWindow;
    const c = win.flowGfx.canvas, rect = c.getBoundingClientRect();
    const image = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const colors = new Set();
    for (let i = 0; i < image.length; i += 124) colors.add(`${image[i]},${image[i+1]},${image[i+2]}`);
    return { frame: win.flowGfx.frames, width: rect.width, height: rect.height, colors: colors.size };
  });
  if (before.colors < 20) throw new Error(`Frame is visually blank: ${JSON.stringify(before)}`);
  await page.waitForTimeout(850);
  const after = await page.evaluate(() => document.querySelector('#garden-frame').contentWindow.flowGfx.frames);
  if (after <= before.frame + 4) throw new Error(`Not rendering live: ${before.frame} -> ${after}`);
  await page.locator('#toggle-dimension').click();
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => {
    const win = document.querySelector('#garden-frame').contentWindow;
    return { frame: win.flowGfx?.frames, canvas: win.flowGfx?.canvas?.getBoundingClientRect().width, view: document.querySelector('#toggle-dimension').getAttribute('aria-pressed') };
  });
  if (state.view !== 'true' || state.frame <= after) throw new Error(`3D toggle failed: ${JSON.stringify(state)}`);
  await page.screenshot({ path: '/tmp/flow-garden-browser-smoke.png' });
  console.log(`PASS: live Flow WebAssembly, ${before.colors} colors, ${before.width}x${before.height} visible canvas, ${before.frame} -> ${after} frames, 3D view ${state.view}`);
  if (errors.length) throw new Error(`Browser exceptions: ${errors.join('; ')}`);
} catch (error) {
  const issue = await page?.evaluate(() => {
    const win = document.querySelector('#garden-frame')?.contentWindow;
    return { status: document.querySelector('#garden-runtime')?.textContent, embeddedStatus: win?.document?.querySelector('#status')?.textContent, embeddedLog: win?.document?.querySelector('#out')?.textContent?.slice(-3000), canvasWidth: win?.flowGfx?.canvas?.getBoundingClientRect()?.width, frames: win?.flowGfx?.frames };
  }).catch(() => 'cannot inspect iframe');
  console.error('Browser runtime diagnostics:', issue, error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}
