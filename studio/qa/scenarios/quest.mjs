// SCENARIO: hamster quest end-to-end now that Adrian lives INSIDE the pet shop — enter
// shop → talk Adrian → accept → collect 5 hamsters in town → return → quest complete.
// Run: node studio/qa/scenarios/quest.mjs
import { withGamePage } from '../harness.mjs';

const fails=[]; const log=(...a)=>console.log(...a);
await withGamePage(async (page, ctx) => {
  await page.evaluate(`(()=>{__startAuto&&__startAuto();game.wipe();game.start(true);})()`);
  await page.waitForTimeout(250);

  // advance the conversation (picking choice 0 when a menu opens) until it closes
  const chatToEnd=async(cap=20)=>{ for(let i=0;i<cap;i++){ const a=await page.evaluate(`game.dialogue().active`);
    if(!a && i>0) return true; await page.evaluate(`game.talk()`); await page.waitForTimeout(300); } return false; };

  // 1) enter shop, walk to the counter, accept the quest (choice 0 = "Of course I'll help!")
  await page.evaluate(`game.enter('petshop')`); await page.waitForTimeout(400);
  await page.evaluate(`(()=>{cameraQA.warp(1.6,-3.0);game.goTo(1.6,-6.6);})()`);
  await page.waitForTimeout(1500);
  const near=await page.evaluate(`game.dialogue().near`);
  if(near!=='Adrian') fails.push('cannot reach Adrian to start the quest (near='+near+')');
  await chatToEnd();
  await page.waitForTimeout(200);
  const dlgClosed=await page.evaluate(`!game.dialogue().active`);
  const started=await page.evaluate(`game.quests().some(q=>q.status==='active')`);
  if(!started) fails.push('quest did not start after accepting from Adrian');
  if(!dlgClosed) fails.push('dialogue did not close after accepting');
  log('quest started:',started,'dialogueClosed:',dlgClosed);

  // 2) exit to town, collect all 5 hamsters
  await page.evaluate(`(()=>{cameraQA.warp(-4.6,-5.2);game.useDoor();})()`);
  await page.waitForTimeout(1600);
  const inTown=await page.evaluate(`game.scene().cur`);
  if(inTown!=='town') fails.push('did not exit to town (got '+inTown+')');
  const hams=await page.evaluate(`game.state().collectibles.map(c=>({x:c.x,z:c.z}))`);
  for(const h of hams){ await page.evaluate(`(()=>{cameraQA.warp(${h.x},${h.z+2});game.goTo(${h.x},${h.z});})()`); await page.waitForTimeout(650); }
  await page.waitForTimeout(300);
  const collected=await page.evaluate(`game.state().collectibles.filter(c=>c.got).length`);
  if(collected<5) fails.push('did not collect all 5 hamsters (got '+collected+')');
  log('hamsters collected:',collected);
  const step=await page.evaluate(`(()=>{const q=game.quests().find(q=>q.id==='q_hamsters'); return q&&q.current?q.current.desc:JSON.stringify(q);})()`);
  log('current step after collecting:',step);

  // 3) return to the shop and hand them in → quest complete
  await page.evaluate(`(()=>{cameraQA.warp(-3,11.4);game.useDoor();})()`);
  await page.waitForTimeout(1600);
  await page.evaluate(`(()=>{cameraQA.warp(1.6,-3.0);game.goTo(1.6,-6.6);})()`);
  await page.waitForTimeout(1500);
  await chatToEnd();
  const done=await page.evaluate(`game.quests().some(q=>q.id==='q_hamsters'&&q.status==='done')`);
  if(!done) fails.push('quest did not complete after returning the hamsters to Adrian');
  log('quest done:',done);

  if(ctx.pageErrors.length) fails.push('page errors: '+ctx.pageErrors.join(' | '));
}, { start: false });

console.log(fails.length? '\n❌ QUEST QA FAILED:\n - '+fails.join('\n - ') : '\n✓ quest end-to-end QA clean');
process.exit(fails.length?1:0);
