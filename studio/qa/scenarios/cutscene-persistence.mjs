// SCENARIO: cutscene PERSISTENCE invariants — the two bugs Christopher reported on the
// shipped pet-shop intro:
//   (1) "I can walk through the table after the cutscene" → the knocked-over remnant must be
//       a SOLID obstacle (a collider at its footprint), not walk-through decor.
//   (2) "every time I enter the room the cutscene happens" → a one-time cutscene must be
//       marked SEEN the MOMENT it starts (not just at the end), so an autosave / reload /
//       tab-hide mid-cutscene can never land Continue back in the scene with an empty
//       seen-set and re-arm it. Generalises to: a cutscene happens ONCE, full stop.
// Run: node studio/qa/scenarios/cutscene-persistence.mjs
import { withGamePage } from '../harness.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TX = -0.9, TZ = -3.1;   // cutsceneTable location (studio/specs/petshop.json)

const fails = [];
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails.push(m); };
// the table is impassable if the CENTRE of its collider ring sits within a collider's block
// radius (collider r 0.55 + PLAYER_R 0.42 = 0.97u) — i.e. a player there would be pushed out.
const tableInteriorBlocked = (cl) => { if (!cl.length) return false;
  const cx = cl.reduce((a,c)=>a+c.x,0)/cl.length, cz = cl.reduce((a,c)=>a+c.z,0)/cl.length;
  return cl.some(c => Math.hypot(c.x-cx, c.z-cz) < (0.55 + 0.42)); };

await withGamePage(async (page) => {
  await page.waitForFunction('window.__ready===true', { timeout: 15000 });
  const sc = () => page.evaluate('game.scene().cur');
  const cs = () => page.evaluate('game.cutscene()');
  const settle = async (want) => { for (let i=0;i<100;i++){ await sleep(50);
    if ((await page.evaluate('game.scene().nearPortal')) === want) return true; } return false; };
  const enterDoor = async (near) => { await settle(near); await page.evaluate('game.useDoor()'); };
  const transDone = async () => { for (let i=0;i<120;i++){ await sleep(80); if(!(await page.evaluate('game.scene().trans'))) return; } };
  const awaitActive = async () => { for (let i=0;i<160;i++){ await sleep(80); if (await page.evaluate('game.cutscene().active')) return true; } return false; };
  const driveToEnd = async () => { for(let g=0; g<400; g++){ if(!(await page.evaluate('game.cutscene().active'))) break; await page.evaluate('game.csNext()'); await sleep(110); } };

  // ---- PASS 1: normal completion → table is SOLID, no replay on re-entry ----
  await page.evaluate(`(()=>{game.wipe();game.start(true);})()`); await sleep(300);
  await page.evaluate(`cameraQA.warp(-3,12.0)`); await enterDoor('to_petshop'); await transDone();
  ok(await awaitActive(), 'pet-shop intro plays on first real-door entry');
  // FIX #2 — marked SEEN the instant it starts (mid-cutscene, before it ends)
  ok((await cs()).seen.includes('cs_petshop_intro'), 'cutscene marked SEEN at START (not only at end)');
  await driveToEnd();
  ok(!(await cs()).active, 'cutscene completed');

  // FIX #1 — the tipped table is a SOLID obstacle (collider at its footprint), room still reachable
  let cl = await page.evaluate(`window.__colliders(${TX},${TZ},2.2)`);
  ok(cl.length > 0, `tipped table is solid after the cutscene (${cl.length} colliders at its footprint)`);
  // the table INTERIOR is impassable: its collider-ring centre is within blocking range
  // (collider r 0.55 + PLAYER_R 0.42 = 0.97u), so the player can't stand on / walk through it.
  ok(tableInteriorBlocked(cl), 'table interior is impassable (player cannot stand on / pass through it)');
  let reach = await page.evaluate('cameraQA.reach()');
  ok(reach.unreachable.length === 0, 'table collider does not wall off the room (all reachable)');

  // re-entry → no replay + the remnant is rebuilt WITH its collider
  await page.evaluate(`cameraQA.warp(-4.6,-6.0)`); await enterDoor('to_town'); await transDone();
  await page.evaluate(`cameraQA.warp(-3,12.0)`); await enterDoor('to_petshop'); await transDone(); await sleep(300);
  let r = await cs();
  ok(!r.active && !r.pending, 'no replay on re-entry');
  cl = await page.evaluate(`window.__colliders(${TX},${TZ},2.2)`);
  ok(cl.length > 0 && tableInteriorBlocked(cl), `tipped table rebuilt + solid on re-entry (${cl.length} colliders)`);
  reach = await page.evaluate('cameraQA.reach()');
  ok(reach.unreachable.length === 0, 're-entry room still fully reachable');

  // ---- PASS 2: the REPORTED bug — autosave + reload MID-cutscene must not replay ----
  await page.evaluate(`(()=>{game.wipe();game.start(true);})()`); await sleep(300);
  await page.evaluate(`cameraQA.warp(-3,12.0)`); await enterDoor('to_petshop'); await transDone();
  ok(await awaitActive(), 'pass2: cutscene active again on a fresh game');
  await page.evaluate(`game.save&&game.save()`);   // the 10s-interval / tab-hide autosave fires mid-cutscene
  const blob = await page.evaluate(`(()=>{const k=Object.keys(localStorage).find(k=>k.includes('save'));return JSON.parse(localStorage.getItem(k));})()`);
  ok(Array.isArray(blob.cutscenes) && blob.cutscenes.includes('cs_petshop_intro'), 'autosave mid-cutscene records it as SEEN (scene=' + blob.scene + ')');
  await page.reload({ waitUntil: 'load' }); await page.waitForFunction('window.__ready===true', { timeout: 15000 });
  await page.evaluate(`window.game.start(false)`); await sleep(700);   // Continue
  r = await cs();
  ok(!r.active && !r.pending, 'reload mid-cutscene + Continue does NOT replay (scene ' + (await sc()) + ')');
  await sleep(400); r = await cs();
  ok(!r.active && !r.pending, 'still no replay after settling');
}, { label: 'cutscene-persistence' });

console.log(fails.length ? `\n✗ cutscene-persistence: ${fails.length} failure(s)` : '\n✓ cutscene-persistence QA clean (table solid + once-only across reload)');
process.exit(fails.length ? 1 : 0);
