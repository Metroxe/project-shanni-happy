// THE shared QA harness for project-shanni-happy. Every QA script — the deterministic
// audit, the screenshot battery, and every scenario probe (pet shop, quest, save, audio,
// loading zones…) — boots game.html the same way: a tiny static server over studio/ + a
// headless Chromium that waits for window.__ready. Before this module each script
// copy-pasted those ~20 lines AND picked its own PORT by hand (qa_petshop.mjs and
// qa_audit.mjs both grabbed 8788 → a collision the moment they ran together). Here it is
// ONCE, and the server binds port 0 so the OS hands out a free port — collisions are
// structurally impossible.
//
// Usage:
//   import { withGamePage } from './qa/harness.mjs';          // from studio/*.mjs
//   const result = await withGamePage(async (page, ctx) => {
//     // ctx.pageErrors is a live array of uncaught page errors; ctx.port the chosen port
//     return await page.evaluate('window.__overlaps()');
//   });
//
// Options: { viewport, start (call game.start(true) after ready, default true),
//            launchArgs (extra chromium flags, e.g. autoplay for audio probes) }.

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDIO = dirname(dirname(fileURLToPath(import.meta.url)));   // qa/ lives under studio/

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml', '.css':'text/css', '.ico':'image/x-icon', '.ogg':'audio/ogg', '.webp':'image/webp' };

function serveStudio() {
  return http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/game.html';
      const fp = normalize(join(STUDIO, p));
      if (!fp.startsWith(STUDIO)) { res.writeHead(403); return res.end('forbidden'); }
      if (!existsSync(fp) || !statSync(fp).isFile()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': TYPES[extname(fp)] || 'application/octet-stream' });
      res.end(await readFile(fp));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
}

export async function withGamePage(fn, opts = {}) {
  const { viewport = { width: 1280, height: 820 }, start = true, launchArgs = [] } = opts;
  const server = serveStudio();
  await new Promise(r => server.listen(0, r));     // port 0 → OS picks a free one (no collisions)
  const port = server.address().port;
  const base = `http://localhost:${port}`;
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', ...launchArgs] });
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto(`${base}/game.html`, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction('window.__ready === true || !!window.__err', { timeout: 45000 }).catch(() => {});
    if (start) {
      await page.evaluate(`(()=>{ window.dispatchEvent(new Event('resize')); game.start(true); })()`);
      await page.waitForTimeout(300);
    }
    return await fn(page, { pageErrors, port, base });
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
}
