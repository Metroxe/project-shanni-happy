// SCENARIO: the Day/Night world states end-to-end. Proves (1) state derivation + shop
// gating + music selection at forced clock hours, (2) a CLOSED shop at night yields a
// "closed" toast + `locked` sfx and does NOT change scene, and (3) a NATURAL clock
// crossing of 21:00 plays the concealing curtain (overlay fades up, `dusk` sfx, music
// crossfades to the night track, overlay fades back out, state ends NIGHT). Spies on
// window.audio so it works headless. Run:
//   node studio/qa/scenarios/day-night.mjs
import { withGamePage } from '../harness.mjs';

const fails = [];
await withGamePage(async (page, ctx) => {
  // spy on the Sound module before play begins
  await page.evaluate(`(()=>{ const A=window.audio; window.__spy={sfx:[],music:[]};
    const sfx=A.sfx.bind(A); A.sfx=(n,m)=>{ window.__spy.sfx.push(n); return sfx(n,m); };
    const sm=A.startMusic.bind(A); A.startMusic=(u,a)=>{ window.__spy.music.push(u); return sm(u,a); };
    A.resume(); })()`);
  await page.evaluate(`(()=>{ __startAuto&&__startAuto(); game.wipe(); game.start(true); })()`);
  await page.waitForTimeout(300);
  const op = `(()=>{ const e=document.getElementById('daynight'); return e?(+e.style.opacity||0):0; })()`;

  // --- 1) DAY (noon): shops open, day overworld track ---
  let st = await page.evaluate(`(()=>{ window.__forceTime(12); return window.__dnState(); })()`);
  if (st.state !== 'DAY') fails.push('noon should be DAY, got ' + st.state);
  for (const id of ['to_petshop', 'to_gym']) { const p = st.portals.find(p => p.id === id);
    if (p && !p.open) fails.push(id + ' is closed at noon'); }
  if (!/calm\.ogg$/.test(st.track)) fails.push('day overworld track = ' + st.track);

  // --- 2) NIGHT (23:00): shops closed, night track selected ---
  st = await page.evaluate(`(()=>{ window.__forceTime(23); return window.__dnState(); })()`);
  if (st.state !== 'NIGHT') fails.push('23:00 should be NIGHT, got ' + st.state);
  for (const id of ['to_petshop', 'to_gym']) { const p = st.portals.find(p => p.id === id);
    if (p && p.open) fails.push(id + ' is OPEN at night (should be closed)'); }
  if (!/night\.ogg$/.test(st.track)) fails.push('night overworld track = ' + st.track);
  console.log('state/gating: noon=DAY shops-open, 23:00=NIGHT shops-closed, track→' + st.track);

  // --- 3) closed-door interaction at night: "closed" toast + `locked` sfx, NO scene change ---
  await page.evaluate(`(()=>{ window.__spy.sfx.length=0; cameraQA.warp(-15.8,-20); })()`);  // at the pet-shop door
  let near = null;
  for (let i = 0; i < 60; i++) { await page.waitForTimeout(50);
    near = await page.evaluate('game.scene().nearPortal'); if (near === 'to_petshop') break; }
  if (near !== 'to_petshop') fails.push('did not reach the pet-shop door (nearPortal=' + near + ')');
  await page.evaluate('game.talk()');
  // the action fires on the NEXT frame → poll for the toast rather than a single timed read
  let after = { cur: 'town', toast: '', on: false };
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(50);
    after = await page.evaluate(`(()=>{ const t=document.getElementById('qtoast');
      return { cur:game.scene().cur, toast:t&&t.textContent||'', on:!!(t&&t.classList.contains('on')) }; })()`);
    if (after.on && /clos/i.test(after.toast)) break; }
  const sfx3 = await page.evaluate('window.__spy.sfx');
  if (after.cur !== 'town') fails.push('a CLOSED pet shop still let the player in (scene=' + after.cur + ')');
  if (!sfx3.includes('locked')) fails.push('closed door did not fire the `locked` sfx (sfx: ' + sfx3.join(',') + ')');
  if (!(after.on && /clos/i.test(after.toast))) fails.push('no "closed" message shown (toast=' + JSON.stringify(after.toast) + ', on=' + after.on + ')');
  console.log('closed-door @night: scene stayed ' + after.cur + ', toast=' + JSON.stringify(after.toast) + ', locked=' + sfx3.includes('locked'));

  // --- 4) NATURAL crossing of 21:00 → concealing curtain + state swap + music switch ---
  await page.evaluate(`(()=>{ window.__forceTime(12); window.__spy.sfx.length=0; window.__spy.music.length=0;
    game.dayLength(60); window.sky.setTime(0.622); })()`);   // ~20:55 DAY → will cross 21:00 (phase 0.625)
  let sawCurtain = false, sawDusk = false, done = false;
  for (let i = 0; i < 45 && !done; i++) { await page.waitForTimeout(100);
    const s = await page.evaluate(`(()=>({ op:${op}, dn:window.__dnState() }))()`);
    if (s.op > 0.05 || s.dn.curtain) sawCurtain = true;
    if ((await page.evaluate('window.__spy.sfx')).includes('dusk')) sawDusk = true;
    if (sawCurtain && s.dn.state === 'NIGHT' && !s.dn.curtain) done = true;
  }
  if (!sawCurtain) fails.push('no transition curtain played when the clock crossed 21:00');
  if (!sawDusk) fails.push('`dusk` transition sfx not fired at the day→night curtain');
  const endState = await page.evaluate('window.__dnState().state');
  if (endState !== 'NIGHT') fails.push('after the curtain state=' + endState + ', expected NIGHT');
  const musicCalls = await page.evaluate('window.__spy.music');
  if (!musicCalls.find(u => /night\.ogg$/.test(u))) fails.push('night track not requested during the curtain (music: ' + JSON.stringify(musicCalls) + ')');
  const ovEnd = await page.evaluate(op);
  if (ovEnd > 0.05) fails.push('curtain overlay did not fade back out (opacity ' + ovEnd + ')');
  console.log('natural curtain: played=' + sawCurtain + ' dusk=' + sawDusk + ' endState=' + endState + ' overlayOut=' + (ovEnd <= 0.05));

  if (ctx.pageErrors.length) fails.push('page errors: ' + ctx.pageErrors.join(' | '));
}, { start: false, launchArgs: ['--autoplay-policy=no-user-gesture-required'] });

console.log(fails.length ? '\n❌ DAY/NIGHT QA FAILED:\n - ' + fails.join('\n - ')
                         : '\n✓ day/night QA clean (state gating · closed-door message · natural curtain + music swap)');
process.exit(fails.length ? 1 : 0);
