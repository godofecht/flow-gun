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
const gpuFlags = process.env.GARDEN_TEST_WEBGPU
  ? ['--enable-unsafe-webgpu', '--enable-dawn-features=allow_unsafe_apis',
     '--use-angle=swiftshader', '--enable-features=Vulkan'] : [];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', ...gpuFlags] });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (/WebGPU|GPU fallback|shader/i.test(message.text())) {
      console.log('Browser console: ' + message.text());
    }
  });
  page.on('requestfailed', request => errors.push(`${request.url()} ${request.failure()?.errorText}`));
  const address = process.env.GARDEN_TEST_URL || `http://127.0.0.1:${port}/`;
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (process.env.GARDEN_EXPECTED_SHA) {
    const servedRevision = await page.locator('meta[name="flow-commit"]').getAttribute('content').catch(() => null);
    if (servedRevision !== process.env.GARDEN_EXPECTED_SHA) {
      throw new Error(`Public site is stale: expected ${process.env.GARDEN_EXPECTED_SHA}, served ${servedRevision}`);
    }
  }
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
  const webgpu = await page.evaluate(() => {
    const w = document.querySelector('#garden-frame')?.contentWindow;
    return { offered: !!w?.navigator?.gpu, ready: !!w?.flowGardenGPU?.ready,
             frames: w?.flowGardenGPU?.frames ?? 0 };
  });
  if (process.env.GARDEN_TEST_WEBGPU) {
    const canUseGPU = await page.evaluate(async () => {
      const win = document.querySelector('#garden-frame')?.contentWindow;
      if (!win?.navigator?.gpu) return false;
      const adapter = await win.navigator.gpu.requestAdapter().catch(() => null);
      return !!adapter;
    });
    if (!canUseGPU) {
      console.log('SKIP: headless Chromium has no WebGPU adapter; software WASM fallback verified');
    } else {
      await page.waitForFunction(() => {
        const w = document.querySelector('#garden-frame')?.contentWindow;
        return w?.flowGardenGPU?.frames >= 3;
      }, undefined, { timeout: 20000 });
      console.log('PASS: live WASM garden sent real ecological state through Flow-generated WGSL/WebGPU');
    }
  } else {
    console.log('WebGPU capability: ' + JSON.stringify(webgpu) +
      '; software fallback remains available');
  }
  // Exercise the touch pad on the real WASM key array, including release.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  try {
    await mobile.goto(address, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await mobile.waitForFunction(() => {
      const w = document.querySelector('#garden-frame')?.contentWindow;
      return w?.flowGfx?.frames > 5 && w.flowGfx.canvas?.getBoundingClientRect().width > 80;
    }, undefined, { timeout: 45000 });
    await mobile.locator('#toggle-dimension').click();
    await mobile.waitForTimeout(100);
    const forward = mobile.locator('[data-hold-key="KeyW"]');
    await forward.dispatchEvent('pointerdown', { pointerId: 12, pointerType: 'touch', bubbles: true });
    const held = await mobile.evaluate(() => document.querySelector('#garden-frame').contentWindow.flowGfx.keys[13]);
    if (held !== 1) throw new Error('Touch move did not hold Flow key W');
    await forward.dispatchEvent('pointerup', { pointerId: 12, pointerType: 'touch', bubbles: true });
    const released = await mobile.evaluate(() => document.querySelector('#garden-frame').contentWindow.flowGfx.keys[13]);
    if (released !== 0) throw new Error('Touch move key remains stuck after release');
    const look = mobile.locator('[data-hold-key="ArrowRight"]');
    await look.dispatchEvent('pointerdown', { pointerId: 16, pointerType: 'touch', bubbles: true });
    const looking = await mobile.evaluate(() => document.querySelector('#garden-frame').contentWindow.flowGfx.keys[124]);
    if (looking !== 1) throw new Error('Mobile camera look control did not hold ArrowRight');
    await look.dispatchEvent('pointerup', { pointerId: 16, pointerType: 'touch', bubbles: true });
    const lookReleased = await mobile.evaluate(() => document.querySelector('#garden-frame').contentWindow.flowGfx.keys[124]);
    if (lookReleased !== 0) throw new Error('Camera look control stuck after finger release');
    if (await mobile.locator('#camera-state').textContent() !== 'ORBIT CAMERA') {
      throw new Error('Camera status did not reflect orbit view');
    }
    if (!(await mobile.locator('#mobile-center').isEnabled())) {
      throw new Error('Camera recenter not accessible on mobile');
    }
    await mobile.locator('#mobile-pause').click();
    if (await mobile.locator('#mobile-pause').getAttribute('aria-pressed') !== 'true') {
      throw new Error('Mobile pause control failed');
    }
    await mobile.locator('#mobile-pause').click();
    console.log('PASS: mobile WASM touch movement, key release and pause/resume');
    await mobile.screenshot({ path: '/tmp/flow-garden-mobile-smoke.png' });
  } finally { await mobile.close(); }
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
