// SCENARIO: the pet-shop first-visit cutscene, end-to-end on the REAL entry path.
// Enter the shop through the door → the hamster-escape cutscene auto-plays → drive it to
// the end pressing Next → assert: input was locked, the quest started, the cutscene is
// marked seen, the table prop was torn down, the knock/scurry/squeak SFX fired, town
// hamsters appear AFTER (and were absent before), and re-entering does NOT replay it.
// Also captures a screenshot battery for the visual sweep.
//   node studio/qa/scenarios/cutscene.mjs
import { withGamePage } from '../harness.mjs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../out/qa/cutscene');
const fails = [];
const log = (...a) => console.log(...a);

await withGamePage(async (page, ctx) => {
  await mkdir(OUT, { recursive: true });
  const sleep = (ms) => page.waitForTimeout(ms);
  // spy on the SFX bus BEFORE play so we can prove the cutscene's sounds fired
  await page.evaluate(`(()=>{ window.__sfxLog=[]; const A=window.audio; const o=A.sfx.bind(A);
    A.sfx=(n,m)=>{ window.__sfxLog.push(n); return o(n,m); }; })()`);
  await page.evaluate(`(()=>{window.dispatchEvent(new Event('resize'));__startAuto&&__startAuto();game.wipe();game.start(true);})()`);
  await sleep(300);

  // ── PASS 1: deterministic stepped FILMSTRIP. Step the cutscene by a FIXED dt so the TWEENS
  // are sampled densely (looking only at beat start/end misses mid-animation weirdness), capture
  // the frames for the visual sweep, and assert the per-frame guards: no camera POP/teleport, no
  // camera clipping through geometry, the subject framed while a line shows, the escape reads, no
  // hamster shrink. This is the "go scene by scene, nothing weird during the animation" check.
  await rm(join(OUT,'film'),{recursive:true,force:true}); await mkdir(join(OUT,'film'),{recursive:true});
  await page.evaluate(`game.enter('petshop')`); await sleep(450);
  await page.evaluate(`game.playCutscene('cs_petshop_intro')`);
  await page.evaluate(`window.__stopAuto&&window.__stopAuto()`);
  { let i=0, saved=0;
    while (i<700){ const r=await page.evaluate(`window.__csStep(${1/30})`); if(!r.active) break;
      if (i%5===0 && saved<110){ await page.screenshot({path:join(OUT,'film','f_'+String(saved).padStart(3,'0')+'_b'+r.beat+'_'+(r.subject||'-')+'.png')}); saved++; } i++; }
    log('filmstrip: stepped', i, 'frames, saved', saved); }
  const film = await page.evaluate('window.__csReport()');
  log('filmstrip report:', JSON.stringify(film));
  if (film.maxJump > 2.5)      fails.push(`camera POP during a tween (maxJump ${film.maxJump} > 2.5 — a hard cut/teleport mid-animation)`);
  if (film.camBad > 0)         fails.push(`camera clipped through geometry (behind wall / outside room) in ${film.camBad} stepped frames`);
  if (film.clip > 0)           fails.push(`Shen walked THROUGH the standing table (impossible move) in ${film.clip} frames — she must BUMP it, not pass through`);
  if (film.shenOff > 2)        fails.push(`[stepped] camera framed Shen off-screen during ${film.shenOff} of her dialogue frames`);
  if (film.adrianOff > 2)      fails.push(`[stepped] camera framed Adrian off-screen during ${film.adrianOff} dialogue frames`);
  if (film.shenTiny > 1)       fails.push(`[stepped] Shen was a tiny dot in ${film.shenTiny} frames`);
  if (film.hamMax < 4)         fails.push(`[stepped] hamster escape never read: max ${film.hamMax} hamsters on-screen (want >=4)`);
  if (film.hamMinScale < 0.6)  fails.push(`[stepped] hamsters shrank while running (min scale ${film.hamMinScale})`);
  if (film.bystanderInCU > 3)  fails.push(`[stepped] the other character's head stacked into a solo close-up in ${film.bystanderInCU} frames (Adrian behind Shen / vice-versa)`);
  await page.evaluate(`window.__startAuto&&window.__startAuto()`);
  // reset for PASS 2 (real-time gameplay-integration path): fresh game + clean SFX log
  await page.evaluate(`(()=>{game.wipe();game.start(true);window.__sfxLog=[];})()`);
  await sleep(300);

  const settle = async (want) => { for (let i=0;i<80;i++){ await sleep(50);
    if ((await page.evaluate('game.scene().nearPortal')) === want) return true; } return false; };
  // step through a door and (optionally) wait for a first-visit cutscene to take over.
  const enterDoor = async (near) => { await settle(near); await page.evaluate('game.useDoor()'); };
  const awaitTransDone = async () => { for (let i=0;i<120;i++){ await sleep(80);
    const s=await page.evaluate('game.scene()'); if(!s.trans) return s; } return await page.evaluate('game.scene()'); };
  const awaitCutscene = async () => { for (let i=0;i<160;i++){ await sleep(80);
    if (await page.evaluate('game.cutscene().active')) return true;
    const s=await page.evaluate('game.scene()'); const cs=await page.evaluate('game.cutscene()');
    if (s.cur==='petshop' && !s.trans && cs.seen.includes('cs_petshop_intro')) return false; } return false; };

  // pre-cutscene: town has NO hamsters yet (gated on the quest)
  const pre = await page.evaluate('window.__cutscene()');
  if (pre.liveHamsters !== 0) fails.push('town had hamsters BEFORE the cutscene (' + pre.liveHamsters + ')');
  if (pre.questStarted) fails.push('quest already started before the cutscene');
  log('pre-cutscene town hamsters:', pre.liveHamsters, ' questStarted:', pre.questStarted);

  // walk to the pet-shop door and step through; the cutscene takes over after the transition
  await page.evaluate('cameraQA.warp(-3,12.0)');
  await enterDoor('to_petshop');
  const onStage = await awaitCutscene();
  if (!onStage) { fails.push('cutscene did NOT start on first pet-shop entry: ' + JSON.stringify(await page.evaluate('game.cutscene()'))); }
  else {
    if (!(await page.evaluate('document.body.classList.contains("cutscene")'))) fails.push('body.cutscene not set (controls/input not locked)');
    log('cutscene started:', JSON.stringify(await page.evaluate('game.cutscene()')));

    // drive to the end; press Next on dialogue lines, screenshot along the way, and run the
    // input-lock test during the FIRST dialogue hold (no beat is moving Shen then).
    let shot = 0, guard = 0, lockTested = false;
    while (guard++ < 320) {
      if (ctx.pageErrors.length) { fails.push('page error mid-cutscene: ' + ctx.pageErrors.join(' | ')); break; }
      const cs = await page.evaluate('game.cutscene()');
      if (!cs.active) break;
      if (guard % 3 === 1 && shot < 24) await page.screenshot({ path: join(OUT, 'cs_' + String(shot++).padStart(2,'0') + '.png') });
      const talking = await page.evaluate('game.dialogue().active');
      if (talking) {
        if (!lockTested) { lockTested = true;
          const p0 = await page.evaluate('({x:game.state().x,z:game.state().z})');
          await page.evaluate(`(()=>{ for(const k of ['ArrowRight','ArrowDown','d']) window.dispatchEvent(new KeyboardEvent('keydown',{key:k})); game.goTo(5,1); })()`);
          await sleep(450);
          await page.evaluate(`(()=>{ for(const k of ['ArrowRight','ArrowDown','d']) window.dispatchEvent(new KeyboardEvent('keyup',{key:k})); })()`);
          const drift = await page.evaluate(`(()=>{const s=game.state();return Math.hypot(s.x-(${p0.x}),s.z-(${p0.z}));})()`);
          if (drift > 0.3) fails.push('input NOT locked — Shen drifted ' + drift.toFixed(2) + 'u during a held dialogue line');
          log('input-lock drift (held line):', drift.toFixed(2));
        }
        await page.evaluate('game.csNext()'); await sleep(150);
      } else await sleep(130);
    }
    if (await page.evaluate('game.cutscene().active')) fails.push('cutscene never finished (stuck): ' + JSON.stringify(await page.evaluate('game.cutscene()')));
    log('cutscene driven to end in', guard, 'ticks;', shot, 'shots');

    // FRAMING TRACE — the "go scene by scene, nothing weird" guard (the recorded per-frame
    // subject framing across the WHOLE playback). Catches: camera on empty space, Shen a tiny
    // dot / absurdly huge, the hamster escape never reading, hamsters shrinking on the run.
    const rep = await page.evaluate('window.__csReport()');
    log('framing report:', JSON.stringify(rep));
    if (rep.shenOff > 2)   fails.push(`camera framed Shen off-screen during ${rep.shenOff} dialogue frames (zoom on empty space)`);
    if (rep.adrianOff > 2) fails.push(`camera framed Adrian off-screen during ${rep.adrianOff} dialogue frames`);
    if (rep.shenTiny > 1)  fails.push(`Shen was a tiny dot in ${rep.shenTiny} of her dialogue frames`);
    if (rep.shenHuge > 1)  fails.push(`Shen was absurdly large in ${rep.shenHuge} dialogue frames`);
    if (rep.hamMax < 3)    fails.push(`the hamster escape never read: only ${rep.hamMax} hamsters ever on-screen at once (want >=3)`);
    if (rep.hamMinScale < 0.6) fails.push(`hamsters SHRANK while running (min scale ${rep.hamMinScale}, expected ~1.0)`);
    if (rep.dlgFrames < 5) fails.push(`suspiciously few dialogue frames traced (${rep.dlgFrames}) — the trace may not be recording`);
  }

  // post: quest active, marked seen, table gone, controls back
  const post = await page.evaluate('window.__cutscene()');
  if (!post.questStarted) fails.push('q_hamsters did NOT start from the cutscene');
  if (!post.seen.includes('cs_petshop_intro')) fails.push('cutscene not recorded as seen: ' + JSON.stringify(post.seen));
  // the knocked-over table STAYS (Shen tipped it — it doesn't vanish); the live cutscene table is
  // converted to a persistent 'tipped_table' fixture, and the standing 'cs_table' is gone.
  const tbl = await page.evaluate(`(()=>{const f=window.__fixtures(); return {tipped:f.some(x=>String(x.label).indexOf('tipped_table')>=0), standing:f.some(x=>String(x.label).indexOf('cs_table')>=0)};})()`);
  if (!tbl.tipped) fails.push('the knocked-over table is GONE after the cutscene — it should REMAIN in the shop');
  if (tbl.standing) fails.push('the standing cutscene table is still present after the cutscene (should be tipped over)');
  // TEARDOWN: NO cutscene-SPAWNED prop (the hamsters — anything still tagged csProp) may outlive the
  // cutscene. The table is exempt (it was converted to a permanent fixture, not swept).
  const props = await page.evaluate('window.__csProps()');
  if (props.lingering && props.lingering.length) fails.push('cutscene props left in the room after it ended: ' + JSON.stringify(props.lingering));
  if (await page.evaluate('document.body.classList.contains("cutscene")')) fails.push('controls still hidden after the cutscene (body.cutscene stuck)');
  await sleep(400);
  await page.screenshot({ path: join(OUT, 'cs_after.png') });
  log('post questStarted:', post.questStarted, ' seen:', JSON.stringify(post.seen), ' tippedTable:', tbl.tipped, ' standingGone:', !tbl.standing);

  // SFX: the knock, the scurry, and the squeaks must have fired during the cutscene
  const sfxLog = await page.evaluate('window.__sfxLog');
  for (const need of ['knock', 'scurry', 'squeak'])
    if (!sfxLog.includes(need)) fails.push('cutscene SFX "' + need + '" never fired (log: ' + JSON.stringify([...new Set(sfxLog)]) + ')');
  log('sfx fired:', JSON.stringify([...new Set(sfxLog)]));

  // exit to town → the 5 hamsters now exist (they "escaped")
  await page.evaluate('cameraQA.warp(-4.6,-6.0)');
  await enterDoor('to_town');
  let s = await awaitTransDone();
  const townHams = await page.evaluate('window.__cutscene().liveHamsters');
  if (s.cur !== 'town') fails.push('did not return to town after the cutscene (got ' + s.cur + ')');
  if (townHams !== 5) fails.push('town hamsters did NOT appear after the cutscene (got ' + townHams + ', expected 5)');
  log('after-exit town scene:', s.cur, ' hamsters:', townHams);

  // re-enter the shop → the cutscene does NOT replay
  await page.evaluate('cameraQA.warp(-3,12.0)');
  await enterDoor('to_petshop');
  s = await awaitTransDone(); await sleep(300);
  const reentry = await page.evaluate('game.cutscene()');
  if (reentry.active || reentry.pending) fails.push('cutscene REPLAYED on re-entry (should be once-only): ' + JSON.stringify(reentry));
  // the knocked-over table is REBUILT on re-entry (it's a remnant of the shop now) + doesn't break the
  // interior 3D-overlap audit (it's a real fixture sitting cleanly on the floor)
  const reTbl = await page.evaluate(`window.__fixtures().some(x=>String(x.label).indexOf('tipped_table')>=0)`);
  if (!reTbl) fails.push('the knocked-over table is missing on re-entry (should be rebuilt as a remnant)');
  const reClips = await page.evaluate('window.__clips()');
  if (reClips.length) fails.push('tipped table interpenetrates other fixtures on re-entry: ' + JSON.stringify(reClips));
  log('re-entry scene:', s.cur, ' replay:', reentry.active, reentry.pending, ' tippedTable:', reTbl, ' clips:', reClips.length);

  if (ctx.pageErrors.length) fails.push('page errors: ' + ctx.pageErrors.join(' | '));
}, { start: false });

console.log(fails.length ? '\n❌ CUTSCENE QA FAILED:\n - ' + fails.join('\n - ') : '\n✓ pet-shop cutscene QA clean');
process.exit(fails.length ? 1 : 0);
