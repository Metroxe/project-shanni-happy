// Capture a battery of GYM-interior screenshots to studio/out/qa/gym/ for visual review.
//   node studio/qa/scenarios/gym-shots.mjs
import { withGamePage } from '../harness.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../out/qa/gym');
await mkdir(OUT, { recursive: true });

// gameplay [name,x,z] → the real zone camera; freecam [name,...__look args] → orbit/close-up
const GAMEPLAY = [
  ['enter', 0, -7.8], ['center', 0, -3.5], ['front', -1, 1.5],
  ['cardio', -6, -7], ['freeweights', 5, -3], ['by-chrees', 1.8, -1.6],
  ['left-back', -8, -8.2], ['right-front', 8, 1.6], ['desk', 6, -8.2],
];
const FREECAM = [
  ['cu-treadmill', -8, 0.7, -9.1, -28, 16, 4.2],
  ['cu-desk', 6.2, 1.0, -9.4, 18, 14, 5.0],
  ['cu-squatrack', -1.6, 1.1, -5.4, 22, 12, 5.2],
  ['cu-benches', 4.9, 0.7, -3.1, 26, 14, 5.6],
  ['cu-dumbbells', 8.4, 0.8, -3.4, -42, 14, 4.6],
  ['cu-chrees', 1.8, 1.2, 0.6, 10, 8, 4.2],
  ['cu-cooler', 3.1, 0.8, -9.9, 16, 12, 3.0],
  ['backwall', 0, 9, -11, 0, 9, 25],
  ['corner-left', -9.2, 2.2, -10, -34, 10, 9],
  ['corner-right', 9.2, 2.2, -10, 34, 10, 9],
  ['floor-front-edge', 0, 1.5, 3, 0, -4, 12],
];

await withGamePage(async (page) => {
  await page.evaluate(`(async()=>{ game.wipe(); game.start(true); await game.enter('gym','from_town'); })()`);
  await page.waitForTimeout(500);
  for (const [name, x, z] of GAMEPLAY) {
    await page.evaluate(`(()=>{ __startAuto&&__startAuto(); cameraQA.warp(${x},${z}); })()`);
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(OUT, `gp_${name}.png`) });
  }
  for (const [name, ...a] of FREECAM) {
    await page.evaluate(`window.__look(${a.join(',')})`);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT, `fc_${name}.png`) });
  }
  console.log(`captured ${GAMEPLAY.length + FREECAM.length} gym shots → ${OUT}`);
}, { start: false });
