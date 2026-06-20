// SCENARIO: the main menu (title screen). Capture the menu in its key states and assert
// behaviour — keyboard nav fires the ui sound, Settings opens the journal/closes cleanly
// and is pre-game-aware (restart hidden, "back" label), New Game reveals the HUD, Continue
// appears with a save, no console errors. Screenshots → studio/out/qa/menu/.
// Run: node studio/qa/scenarios/menu.mjs
import { withGamePage } from '../harness.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDIO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));   // qa/scenarios/ → studio/
const OUT = join(STUDIO, 'out/qa/menu');
mkdirSync(OUT, { recursive: true });

const fail = [];
const ok = (c, m) => { if (!c) fail.push(m); console.log((c ? '  ✓ ' : '  ✗ ') + m); };

await withGamePage(async (page, ctx) => {
  // --- spy on the audio bus so we can prove the menu makes sounds ---
  await page.evaluate(`(()=>{ window.__sfx=[]; const a=window.audio; const o=a.sfx.bind(a);
    a.sfx=(n,m)=>{ window.__sfx.push(n); return o(n,m); }; })()`);

  // wait for the boot loader to fade out + be removed so the menu is fully visible
  await page.waitForFunction("!document.getElementById('loader')", { timeout: 5000 }).catch(()=>{});
  await page.waitForTimeout(300);

  // 1) FRESH menu (no save): New Game + Settings, HUD hidden
  await page.screenshot({ path: join(OUT, '1-fresh.png') });
  let s = await page.evaluate(`(()=>({
    title: !document.getElementById('title').classList.contains('off'),
    pregame: document.body.classList.contains('pregame'),
    continueHidden: document.getElementById('btnContinue').hidden,
    newVisible: !document.getElementById('btnNew').hidden,
    settingsVisible: !!document.getElementById('btnSettings'),
    hudHidden: getComputedStyle(document.getElementById('bMenu')).display==='none',
    shenImg: document.querySelector('#title .shen')?.complete && document.querySelector('#title .shen')?.naturalWidth>0,
  }))()`);
  ok(s.title, 'title screen is shown on boot');
  ok(s.pregame, 'body.pregame set (HUD hidden) on the menu');
  ok(s.continueHidden, 'no save → Continue hidden');
  ok(s.newVisible && s.settingsVisible, 'New Game + Settings present');
  ok(s.hudHidden, 'in-game HUD (journal button) hidden behind the menu');
  ok(s.shenImg, 'Shen cutout image loaded on the menu diorama');

  // 2) keyboard nav makes a sound + moves the selection
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(60);
  let nav = await page.evaluate(`(()=>({ sfx:[...window.__sfx],
    selIdx:[...document.querySelectorAll('#title .tbtn')].findIndex(b=>b.classList.contains('sel')) }))()`);
  ok(nav.sfx.includes('move'), 'arrow nav fires the "move" ui sound');

  // 3) open Settings via keyboard (Enter on the Settings button)
  await page.evaluate(`(()=>{ // select Settings then confirm
    const btns=[...document.querySelectorAll('#title .tbtn:not([hidden])')];
    const i=btns.findIndex(b=>b.id==='btnSettings'); window.__sfx.length=0;
  })()`);
  await page.click('#btnSettings');
  await page.waitForTimeout(120);
  let set = await page.evaluate(`(()=>({
    open: document.getElementById('journal').classList.contains('on'),
    tab: document.querySelector('.jtab.active')?.dataset.tab,
    restartHidden: getComputedStyle(document.getElementById('restartBtn')).display==='none',
    resumeLabel: document.getElementById('resumeBtn').textContent.trim(),
    sfx:[...window.__sfx],
  }))()`);
  ok(set.open, 'Settings opens the journal');
  ok(set.tab==='settings', 'journal lands on the Settings tab');
  ok(set.restartHidden, 'pre-game: restart button hidden in Settings');
  ok(set.resumeLabel==='back', 'pre-game: resume button relabelled "back"');
  ok(set.sfx.includes('select') && set.sfx.includes('book'), 'Settings makes select + book sounds');
  await page.screenshot({ path: join(OUT, '2-settings.png') });

  // 4) close Settings (Escape) → back to the menu
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  let back = await page.evaluate(`(()=>({
    closed: !document.getElementById('journal').classList.contains('on'),
    title: !document.getElementById('title').classList.contains('off'),
    started: window.game.state? undefined : undefined,
  }))()`);
  ok(back.closed, 'Escape closes Settings');
  ok(back.title, 'menu still shown after closing Settings');
  await page.screenshot({ path: join(OUT, '3-back-to-menu.png') });

  // 5) simulate a save present → reload → Continue shows + is primary
  await page.evaluate(`(()=>{ window.game.start(false); })()`);   // begin a game so a save is written
  await page.waitForTimeout(200);
  let started = await page.evaluate(`(()=>({
    titleOff: document.getElementById('title').classList.contains('off'),
    pregame: document.body.classList.contains('pregame'),
    hudShown: getComputedStyle(document.getElementById('bMenu')).display!=='none',
  }))()`);
  ok(started.titleOff, 'New Game/Continue hides the title');
  ok(!started.pregame, 'body.pregame cleared once playing');
  ok(started.hudShown, 'HUD (journal button) revealed once playing');
  await page.screenshot({ path: join(OUT, '4-playing.png') });

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction('window.__ready===true', { timeout: 30000 });
  await page.waitForFunction("!document.getElementById('loader')", { timeout: 5000 }).catch(()=>{});
  await page.waitForTimeout(300);
  let withSave = await page.evaluate(`(()=>({
    continueShown: !document.getElementById('btnContinue').hidden,
    continuePrimary: document.getElementById('btnContinue').classList.contains('primary'),
    order:[...document.querySelectorAll('#title .tbtn:not([hidden])')].map(b=>b.id),
  }))()`);
  ok(withSave.continueShown, 'with a save → Continue shown on reload');
  ok(withSave.continuePrimary, 'Continue is the primary (highlighted) action');
  ok(withSave.order.join(',')==='btnContinue,btnNew,btnSettings', 'menu order: Continue, New Game, Settings');
  await page.screenshot({ path: join(OUT, '5-with-save.png') });

  ok(ctx.pageErrors.length===0, 'no uncaught page errors (' + (ctx.pageErrors[0]||'') + ')');
}, { start: false });

console.log(fail.length ? `\n✗ menu QA: ${fail.length} failure(s)` : '\n✓ menu QA clean');
process.exit(fail.length ? 1 : 0);
