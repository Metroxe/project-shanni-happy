// Visual-QA screenshot harness for project-shanni-happy.
//
// Loads game.html headless and captures a fixed BATTERY of viewpoints to PNGs so
// they can be scrutinized (by you, or by a fan-out of vision agents) for visual
// inconsistencies the camera QA can't catch: windows/props clipping the ground,
// stray cream outlines, overlapping props, z-fighting, mis-oriented props, and —
// most important — the ABYSS (any sightline that hits the void instead of city).
//
// Two kinds of shot:
//   • gameplay  — the real zone camera at a warp position (window.cameraQA.warp).
//                 This is what the player actually sees.
//   • freecam   — an arbitrary orbit/low-angle look (window.__look / __freecam):
//                 deliberate edge-of-world and prop close-up angles that the fixed
//                 gameplay cameras never show, to hunt for void + clipping.
//
// Usage:  node studio/qa_shots.mjs [outDir]      (default outDir = studio/out/qa)
// Output: <outDir>/<name>.png  +  <outDir>/index.json (the shot list)
//
// See .claude/skills/papercraft-env-qa/SKILL.md for the inspection workflow.

import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));   // studio/
const ROOT = HERE;                                       // serve studio/ as the site root
const OUT = resolve(process.argv[2] || join(HERE, 'out', 'qa'));
const PORT = 8787;
const BASE = `http://localhost:${PORT}`;
const VW = 1280, VH = 820;

// ---- the viewpoint battery -------------------------------------------------
// gameplay: [name, x, z]  → cameraQA.warp(x,z) (the zone camera the player sees)
const GAMEPLAY = [
  ['plaza-spawn', -20, -41], ['plaza-west', -27, -50], ['plaza-east', -13, -50],
  ['plaza-north', -20, -57], ['plaza-fountain', -20, -46],
  ['vroad-top', -20, -33], ['vroad-mid', -20, -20], ['vroad-bottom', -20, -9],
  ['corner', -19, -3], ['corner-west', -23, -3],
  ['hroad-west', -8, -3], ['hroad-mid', 9, -3], ['hroad-east', 26, -3],
  ['stairs-top', 9.5, 2.5], ['stairs-mid', 9.5, 6], ['stairs-bottom', 9.5, 9.5],
  ['park-center', 0, 16], ['park-west', -26, 15], ['park-east', 27, 15],
  ['park-front', 0, 24], ['park-playground', -15, 17],
];
// freecam look: [name, tx,ty,tz, yawDeg, pitchDeg, dist]  → __look(tx..) places the
// camera `dist` from the TARGET in the yaw/pitch direction, looking AT the target.
// For abyss checks the TARGET is the outward map-edge point and the camera sits INSIDE
// the play space looking out toward it (yaw chooses which side the camera is on:
// 0=+z south, 90=+x east, 180=-z north, 270=-x west of the target). dist is POSITIVE.
const LOOKS = [
  ['birdseye', -5, 0, -20, 205, 33, 95],
  // ABYSS HUNT — camera inside, target on the edge, looking outward toward each edge:
  ['abyss-plaza-N', -20, 3, -63, 0, 5, 16],    // edge=N plaza, cam to its south → looks N
  ['abyss-plaza-W', -33, 3, -50, 90, 5, 16],   // edge=W plaza, cam to its east  → looks W
  ['abyss-plaza-E', -7, 3, -50, 270, 5, 16],   // edge=E plaza, cam to its west  → looks E
  ['abyss-vroad-W', -26, 3, -22, 90, 4, 14],   // vroad west edge, looking W
  ['abyss-hroad-E', 31, 3, -3, 270, 4, 22],    // hroad east end (barrier + city beyond), looking E
  ['abyss-park-E', 31, 2, 16, 270, 3, 26],     // park east edge, looking E
  ['abyss-park-W', -31, 2, 16, 90, 3, 26],     // park west edge, looking W
  ['abyss-park-S', 0, 2, 27, 180, 3, 20],      // park south edge, cam to its north → looks S
  // PROP / DETAIL close-ups (clipping, outlines, orientation):
  ['detail-fountain', -20, 1.2, -50, 150, 16, 7],
  ['detail-stairs', 9.5, 2.5, 6, 250, 16, 12],   // stairs from the side (rails clip?)
  ['detail-playground', -15, 1, 17, 160, 14, 10],
  ['detail-storefront', 5, 5.5, -10, 5, 6, 15],  // Corner Market south facade (windows/door on ground?)
  ['detail-lamp', -16.6, 2.5, -14, 110, 8, 6],   // a street lamp
  ['detail-corner-bld', -14, 5, -9, 200, 8, 16], // big building inside-corner base
];

const TYPES = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.svg':'image/svg+xml', '.css':'text/css', '.ico':'image/x-icon', '.ogg':'audio/ogg', '.webp':'image/webp' };

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
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const shots = [];
try {
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${BASE}/game.html`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction('window.__ready === true || !!window.__err', { timeout: 45000 }).catch(() => {});
  await page.evaluate(`(()=>{ window.dispatchEvent(new Event('resize')); game.start(true); })()`);
  await page.waitForTimeout(400);

  const snap = async (name) => {
    await page.waitForTimeout(180);
    const file = join(OUT, name + '.png');
    await page.screenshot({ path: file });
    shots.push({ name, file });
    process.stdout.write('  ✓ ' + name + '\n');
  };

  // gameplay-camera shots (auto loop renders the zone camera each frame)
  for (const [name, x, z] of GAMEPLAY) {
    await page.evaluate(`(()=>{ if(window.__startAuto)__startAuto(); cameraQA.warp(${x},${z}); })()`);
    await snap('cam_' + name);
  }
  // freecam look shots (one rendered frame each)
  for (const [name, tx, ty, tz, yaw, pitch, dist] of LOOKS) {
    await page.evaluate(`window.__look(${tx},${ty},${tz},${yaw},${pitch},${dist})`);
    await snap('look_' + name);
  }

  // FLICKER PAIRS — two frames at a hair-different camera angle. z-fighting regions
  // flip their winner between frames; comparing _a vs _b reveals flicker a single
  // still can't show. Inspect each pair side-by-side.
  const FLICKER = [
    ['park', 0, 4, 16, 0, 8, 30], ['plaza', -20, 5, -50, 0, 10, 26], ['hroad', 8, 5, -3, 270, 6, 30],
  ];
  for (const [name, tx, ty, tz, yaw, pitch, dist] of FLICKER) {
    await page.evaluate(`window.__look(${tx},${ty},${tz},${yaw},${pitch},${dist})`); await snap('flick_' + name + '_a');
    await page.evaluate(`window.__look(${tx},${ty},${tz},${yaw + 0.6},${pitch},${dist})`); await snap('flick_' + name + '_b');
  }

  // PER-OBJECT CLOSE-UPS — screenshot EVERY placed prop + building individually, from a
  // 3/4 angle, so each thing gets looked at (clipping / orientation / floating / "what is
  // this?" reads that zone shots miss). This is the "check every single thing" pass.
  const items = await page.evaluate('window.__items()');
  await mkdir(join(OUT, 'props'), { recursive: true });
  const itemShots = [];
  // Buildings: frame the FACADE FACE HEAD-ON at eye level, with the camera OUTSIDE the footprint
  // (NOT a far/high rooftop shot — that hid every facade defect). Target the face centre at mid
  // height; FACE_N offsets the target onto the face, FACE_YAW puts the camera square in front.
  const FACE_N = { '-z': [0, -1], '+z': [0, 1], '-x': [-1, 0], '+x': [1, 0] };
  const FACE_YAW = { '-z': 180, '+z': 0, '-x': 270, '+x': 90 };
  for (const it of items) {
    let tx, ty, tz, yaw, pitch, dist;
    if (it.kind === 'building' && it.face && FACE_N[it.face]) {
      const [nx, nz] = FACE_N[it.face];
      const along = (it.face === '-x' || it.face === '+x') ? it.w : it.d;   // half-depth along the normal
      const faceLen = (it.face === '-x' || it.face === '+x') ? it.d : it.w;
      tx = it.x + nx * along / 2; tz = it.z + nz * along / 2; ty = it.y + it.h * 0.5;
      yaw = FACE_YAW[it.face]; pitch = 5; dist = Math.max(faceLen, it.h) * 1.15 + 4;
    } else {
      tx = it.x; tz = it.z; ty = it.y + 1.4;
      yaw = (it.face && FACE_YAW[it.face] != null) ? FACE_YAW[it.face] : 37;
      pitch = 12; dist = Math.max(5, it.size * 1.4 + 3.5);
    }
    await page.evaluate(`window.__look(${tx}, ${ty}, ${tz}, ${yaw}, ${pitch}, ${dist})`);
    await page.waitForTimeout(140);
    const file = join(OUT, 'props', it.label + '.png');
    await page.screenshot({ path: file });
    itemShots.push({ label: it.label, kind: it.kind, x: it.x, z: it.z, file });
  }
  console.log(`  ✓ ${itemShots.length} per-object close-ups → ${join(OUT, 'props')}`);

  // GEOMETRIC AUDITS — these need no screenshot and must be empty/clean:
  const overlaps = await page.evaluate('window.__overlaps()');   // footprint overlaps → z-fight + clipping
  const reach = await page.evaluate(`window.cameraQA.reach([
    {name:'plaza',x:-20,z:-44},{name:'vroad',x:-20,z:-20},{name:'corner',x:-19,z:-3},
    {name:'hroad',x:9,z:-3},{name:'hroadE',x:26,z:-3},{name:'stairsBot',x:9.5,z:11},
    {name:'park',x:0,z:16},{name:'parkW',x:-26,z:15},{name:'parkE',x:26,z:15}], 0.5)`);
  if (overlaps.length) console.log('⚠️  FOOTPRINT OVERLAPS (fix — z-fight/clip):\n  ' + overlaps.map(o => `${o.a} × ${o.b} (${o.overlapX}×${o.overlapZ})`).join('\n  '));
  if (reach.unreachable.length) console.log('⚠️  UNREACHABLE landmarks:\n  ' + reach.unreachable.map(t => t.name).join(', '));

  await writeFile(join(OUT, 'index.json'), JSON.stringify({ at: Date.now(), viewport: [VW, VH], shots, itemShots, overlaps, unreachable: reach.unreachable, pageErrors: errs }, null, 2));
  if (errs.length) console.log('PAGE ERRORS:\n  ' + errs.join('\n  '));
  console.log(overlaps.length || reach.unreachable.length ? '\n❌ GEOMETRY AUDIT FOUND ISSUES (see above)' : '\n✓ geometry audit clean (no overlaps, all reachable)');
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
console.log(`\nCaptured ${shots.length} QA shots → ${OUT}`);
