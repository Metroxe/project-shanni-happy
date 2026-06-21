// SCENARIO: save / loading-zone persistence. Progress (collected hamsters + quest) survives
// a scene swap and a reload; the save records which scene the player is in and reloads back
// into it; an OLD town-only save (no `scene` field, the shipped v3 format) still loads into
// town. Run: node studio/qa/scenarios/save.mjs
import { withGamePage } from '../harness.mjs';

const fails=[];
await withGamePage(async (page, ctx) => {
  const boot=async()=>{ await page.goto(`${ctx.base}/game.html`,{waitUntil:'load'});
    await page.waitForFunction('window.__ready===true||!!window.__err'); await page.waitForTimeout(250); };

  // 1) New game in town, collect 2 hamsters by walking over them. The town hamsters only
  // exist once the roundup quest is active (they "escape" in the pet-shop cutscene), so start
  // it directly + rebuild town (in real play the cutscene does this) before collecting.
  await page.evaluate(`(()=>{__startAuto&&__startAuto();game.wipe();game.start(true);})()`);
  await page.waitForTimeout(200);
  await page.evaluate(`game.startQuest('q_hamsters')`);
  await page.evaluate(`game.enter('town')`); await page.waitForTimeout(400);
  await page.evaluate(`(async()=>{ for(const [x,z] of [[-24,-46],[-2,-3]]){ cameraQA.warp(x,z+2); game.goTo(x,z); await new Promise(r=>setTimeout(r,700)); } })()`);
  await page.waitForTimeout(300);
  let got=await page.evaluate(`game.state().collectibles.filter(c=>c.got).length`);
  if(got<1) fails.push('collecting hamsters in town failed (got='+got+')');

  // 2) enter the pet shop, then save
  await page.evaluate(`game.enter('petshop')`); await page.waitForTimeout(400);
  await page.evaluate(`game.save()`);
  const savedRaw=await page.evaluate(`JSON.parse(localStorage.getItem('shanni-happy:save'))`);
  if(savedRaw.scene!=='petshop') fails.push('raw save scene='+savedRaw.scene);
  if(!(savedRaw.collected&&savedRaw.collected.length>=1)) fails.push('raw save lost collected: '+JSON.stringify(savedRaw.collected));
  console.log('after enter+save:',JSON.stringify({scene:savedRaw.scene,collected:savedRaw.collected,quests:savedRaw.quests}));

  // 3) reload → should boot INTO the pet shop with collected preserved
  await boot();
  const reScene=await page.evaluate(`game.scene().cur`);
  if(reScene!=='petshop') fails.push('reload did not boot into petshop (got '+reScene+')');
  await page.evaluate(`(()=>{__startAuto&&__startAuto();game.start(false);})()`);
  await page.waitForTimeout(200);
  const afterContinue=await page.evaluate(`(()=>{ const raw=JSON.parse(localStorage.getItem('shanni-happy:save')); return {scene:game.scene().cur, collected:raw.collected}; })()`);
  console.log('after reload+continue:',JSON.stringify(afterContinue));
  if(afterContinue.scene!=='petshop') fails.push('continue not in petshop');
  if(!(afterContinue.collected&&afterContinue.collected.length>=1)) fails.push('collected lost after reload: '+JSON.stringify(afterContinue.collected));

  // 4) OLD save compat: inject a v3 town-only save (no scene field) on a fresh, not-yet-started
  // page (so the prior page's pagehide-autosave can't clobber it), then reload into town.
  await boot();
  await page.evaluate(`localStorage.setItem('shanni-happy:save', JSON.stringify({v:3,build:'old',t:1,player:{x:-20,z:-20,facing:1},collected:['ham1'],quests:{},npcs:{}}))`);
  await boot();
  const oldScene=await page.evaluate(`game.scene().cur`);
  if(oldScene!=='town') fails.push('old v3 save did not load into town (got '+oldScene+')');
  await page.evaluate(`(()=>{__startAuto&&__startAuto();game.start(false);game.save();})()`);
  const oldRaw=await page.evaluate(`JSON.parse(localStorage.getItem('shanni-happy:save'))`);
  if(!(oldRaw.collected||[]).includes('ham1')) fails.push('old v3 save lost collected ham1: '+JSON.stringify(oldRaw.collected));
  console.log('old-save compat:',JSON.stringify({scene:oldScene,collected:oldRaw.collected,v:oldRaw.v}));

  if(ctx.pageErrors.length) fails.push('page errors: '+ctx.pageErrors.join(' | '));
}, { start: false });

console.log(fails.length? '\n❌ SAVE QA FAILED:\n - '+fails.join('\n - ') : '\n✓ save/persistence QA clean');
process.exit(fails.length?1:0);
