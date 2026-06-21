// CAPTURE: day vs night look + the transition curtain, for the visual sweep. Saves into
// studio/out/qa/daynight/. Run: node studio/qa/scenarios/day-night-shots.mjs
import { withGamePage } from '../harness.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'out', 'qa', 'daynight');
mkdirSync(OUT, { recursive: true });

await withGamePage(async (page) => {
  await page.evaluate(`(()=>{ __startAuto&&__startAuto(); game.wipe(); game.start(true); })()`);
  await page.waitForTimeout(300);
  const shot = async (name) => { await page.screenshot({ path: join(OUT, name + '.png') }); console.log('shot', name); };

  // a good vantage on the main road / shopfronts
  const vantage = `(()=>{ cameraQA.warp(-15.8,-24); })()`;

  // DAY
  await page.evaluate(`window.__forceTime(12)`); await page.evaluate(vantage); await page.waitForTimeout(700);
  await shot('01-town-day');

  // NIGHT (indigo sky, stars, moon, lamps; the pet-shop door should read "closed")
  await page.evaluate(`window.__forceTime(23)`); await page.waitForTimeout(700);
  await shot('02-town-night');
  // walk up to the closed pet-shop door so the prompt shows
  await page.evaluate(`cameraQA.warp(-15.8,-20)`);
  for (let i = 0; i < 50; i++) { await page.waitForTimeout(50); if (await page.evaluate(`game.scene().nearPortal`)) break; }
  await page.waitForTimeout(300);
  await shot('03-petshop-closed-prompt');

  // TRANSITION CURTAIN (day→night): capture a couple of frames mid-animation
  await page.evaluate(`(()=>{ window.__forceTime(12); cameraQA.warp(-15.8,-24); })()`);
  await page.waitForTimeout(300);
  await page.evaluate(`window.__triggerDayNight('NIGHT')`);
  await page.waitForTimeout(180); await shot('04-curtain-early');     // cover rising, sun descending
  await page.waitForTimeout(220); await shot('05-curtain-mid');       // full cover, sun/moon mid-arc + label
  // let it finish, confirm night
  await page.waitForTimeout(1400); await shot('06-after-curtain-night');

  console.log('saved to', OUT);
}, { start: false, launchArgs: ['--autoplay-policy=no-user-gesture-required'] });
