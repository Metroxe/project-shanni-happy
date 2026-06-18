// Headless smoke test for the papercraft game.
// Serves the assembled static site, loads game.html in headless Chromium, and
// asserts the game actually boots (window.__ready) with no uncaught JS errors
// (window.__err / pageerror), then exercises a few sim/render paths. Exit 1 on
// any failure — this is the `smoke` check that gates every PR into main.
//
// Usage: node test/smoke.mjs [siteDir]   (default siteDir = _site)

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] || '_site');
const PORT = 8799;
const BASE = `http://localhost:${PORT}`;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css',
  '.ico': 'image/x-icon', '.webp': 'image/webp',
};

// --- tiny static file server (no deps) -------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/game.html';
    const fp = normalize(join(ROOT, p));
    if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
    if (!existsSync(fp) || !statSync(fp).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' });
    res.end(await readFile(fp));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
await new Promise(r => server.listen(PORT, r));

const fail = [];
const consoleErrors = [];
const pageErrors = [];

// SwiftShader lets WebGL work on headless CI runners with no GPU.
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto(`${BASE}/game.html`, { waitUntil: 'load', timeout: 45000 });

  // wait until the game signals ready OR records a fatal build error
  await page.waitForFunction('window.__ready === true || !!window.__err', { timeout: 45000 })
    .catch(() => {});

  const ready = await page.evaluate('!!window.__ready');
  const jsErr = await page.evaluate('window.__err || null');
  if (!ready) fail.push('window.__ready never became true (game did not boot)');
  if (jsErr) fail.push('window.__err set during build: ' + jsErr);

  // exercise the shared input path so a runtime error in step()/draw() surfaces
  if (ready) {
    await page.evaluate(`(async () => {
      const g = window.game; if (!g) throw new Error('window.game missing');
      g.setMove(1, 0); await new Promise(r => setTimeout(r, 120));
      g.jump();        await new Promise(r => setTimeout(r, 120));
      g.joy();         await new Promise(r => setTimeout(r, 120));
      g.stop();
    })()`);
    const jsErr2 = await page.evaluate('window.__err || null');
    if (jsErr2 && !jsErr) fail.push('window.__err set during interaction: ' + jsErr2);
  }
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}

// pageerror = uncaught exceptions; always fatal. console errors are logged but
// not fatal on their own (e.g. a favicon 404) unless the game also failed to boot.
if (pageErrors.length) fail.push('uncaught page errors:\n  ' + pageErrors.join('\n  '));

if (consoleErrors.length) {
  console.log('console errors (non-fatal):\n  ' + consoleErrors.join('\n  '));
}

if (fail.length) {
  console.error('\nSMOKE TEST FAILED:\n- ' + fail.join('\n- '));
  process.exit(1);
}
console.log('SMOKE TEST PASSED — game booted and ran with no fatal errors.');
