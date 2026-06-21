// SCENARIO: closing a shop on the player. Proves (1) a pre-close heads-up toast fires ~20:45
// ("The shops close at 9 p.m."), and (2) if you're INSIDE a day-only shop (the gym) when the
// 21:00 curtain hits, you're ejected to town in front of its door with a "closed" message —
// not stranded inside a closed shop. Run: node studio/qa/scenarios/day-night-eject.mjs
import { withGamePage } from '../harness.mjs';

const fails = [];
await withGamePage(async (page, ctx) => {
  await page.evaluate(`(()=>{ __startAuto&&__startAuto(); game.wipe(); game.start(true); window.__forceTime(12); })()`);
  await page.waitForTimeout(300);
  const toastNow = `(()=>{ const e=document.getElementById('qtoast'); return e&&e.classList.contains('on')?e.textContent:''; })()`;

  // --- 1) pre-close heads-up in town: ~20:42 → speed the clock → expect the 9pm warning ---
  await page.evaluate(`(()=>{ window.__forceTime(19); game.dayLength(60); window.sky.setTime(((20.7-6)/24)); })()`); // ~20:42, DAY
  let warned = '';
  for (let i = 0; i < 45; i++) { await page.waitForTimeout(100);
    const t = await page.evaluate(toastNow);
    if (/9 p\.m\./i.test(t)) { warned = t; break; }
    if (await page.evaluate('window.__dnState().state') === 'NIGHT') break; }   // stop at the curtain
  if (!warned) fails.push('no pre-close "shops close at 9 p.m." warning before 21:00');
  else console.log('pre-close warning: ' + JSON.stringify(warned));

  // --- 2) go INTO the gym (daytime), then let 21:00 cross while inside → eject to the door ---
  await page.evaluate(`(()=>{ window.__forceTime(12); game.enter('gym','from_town'); })()`);
  await page.waitForTimeout(450);
  if (await page.evaluate('game.scene().cur') !== 'gym') fails.push('could not enter the gym for the eject test');

  await page.evaluate(`(()=>{ window.__forceTime(12); game.dayLength(60); window.sky.setTime(0.622); })()`); // 20:55, inside gym
  let ejected = false;
  for (let i = 0; i < 70; i++) { await page.waitForTimeout(100);
    const s = await page.evaluate(`(()=>({ cur:game.scene().cur, state:window.__dnState().state, curtain:window.__dnState().curtain }))()`);
    if (s.cur === 'town' && s.state === 'NIGHT' && !s.curtain) { ejected = true; break; } }
  if (!ejected) { fails.push('was NOT ejected to town when the gym closed at night'); }
  else {
    const pos = await page.evaluate('game.state()');
    const atDoor = Math.hypot(pos.x - 8.2, pos.z - (-8.2)) < 2.5;     // the from_gym spawn, in front of the door
    if (!atDoor) fails.push(`ejected but not in front of the gym door (at ${pos.x},${pos.z}, expected ~8.2,-8.2)`);
    // the eject "closed" message (distinct from the earlier warning) should appear
    let ejectMsg = '';
    for (let j = 0; j < 12; j++) { await page.waitForTimeout(120);
      const t = await page.evaluate(toastNow); if (/shut|closed/i.test(t)) { ejectMsg = t; break; } }
    if (!ejectMsg) fails.push('no "closed for the night" message shown after the eject');
    // the gym door should be the nearest portal now — and reading closed
    const np = await page.evaluate('game.scene().nearPortal');
    const gymP = (await page.evaluate('window.__dnState()')).portals.find(p => p.id === 'to_gym');
    if (np !== 'to_gym') fails.push('not standing at the gym door after eject (nearPortal=' + np + ')');
    if (gymP && gymP.open) fails.push('gym reads OPEN right after being kicked out at night');
    console.log('eject: town atDoor=' + atDoor + ' nearPortal=' + np + ' msg=' + JSON.stringify(ejectMsg));
  }

  if (ctx.pageErrors.length) fails.push('page errors: ' + ctx.pageErrors.join(' | '));
}, { start: false, launchArgs: ['--autoplay-policy=no-user-gesture-required'] });

console.log(fails.length ? '\n❌ DAY/NIGHT EJECT QA FAILED:\n - ' + fails.join('\n - ')
                         : '\n✓ day/night eject QA clean (pre-close warning · kicked out of a closing shop to its door)');
process.exit(fails.length ? 1 : 0);
