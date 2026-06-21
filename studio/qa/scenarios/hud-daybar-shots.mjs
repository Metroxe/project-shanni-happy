// CAPTURE: the Pikmin day/night bar across the cycle + desktop-vs-mobile HUD chrome.
// Saves to studio/out/qa/daybar/. Run: node studio/qa/scenarios/hud-daybar-shots.mjs
import { withGamePage } from '../harness.mjs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'out', 'qa', 'daybar');
mkdirSync(OUT, { recursive: true });

await withGamePage(async (page) => {
  await page.evaluate(`(()=>{ __startAuto&&__startAuto(); game.wipe(); game.start(true); })()`);
  await page.waitForTimeout(300);
  const shot = async (name) => { await page.screenshot({ path: join(OUT, name + '.png') }); console.log('shot', name); };
  // crop the top strip so the bar reads at full detail
  const barShot = async (name) => { await page.screenshot({ path: join(OUT, name + '.png'),
    clip: { x: 0, y: 0, width: 1280, height: 90 } }); console.log('bar', name); };

  // DESKTOP (default in headless): no on-screen buttons; bar = the only top chrome
  await page.evaluate(`window.__forceInputMode('desktop')`);
  await page.evaluate(`window.__forceTime(9)`);  await page.waitForTimeout(250); await barShot('bar-09h-morning');
  await page.evaluate(`window.__forceTime(14)`); await page.waitForTimeout(250); await barShot('bar-14h-midday');
  await page.evaluate(`window.__forceTime(20.5)`); await page.waitForTimeout(250); await barShot('bar-2030-near-switch');
  await page.evaluate(`window.__forceTime(23.5)`); await page.waitForTimeout(250); await barShot('bar-2330-night');
  await page.evaluate(`window.__forceTime(14)`); await page.waitForTimeout(250); await shot('desktop-full-no-buttons');

  // MOBILE: same bar + the on-screen d-pad / action / journal / fullscreen come back
  await page.evaluate(`window.__forceInputMode('touch')`); await page.waitForTimeout(150);
  await page.evaluate(`window.__forceTime(10)`); await page.waitForTimeout(250); await shot('mobile-full-with-buttons');

  console.log('saved to', OUT);
}, { start: false, launchArgs: ['--autoplay-policy=no-user-gesture-required'] });
