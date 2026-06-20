// SCENARIO: pet-shop loading zone. Enters the shop and checks camera visibility from every
// reachable cell, the 3D clip audit, Adrian reachable+talkable across the counter, the
// town↔shop round-trip via the real Talk key, and captures the screenshot battery for the
// visual sweep. Uses the shared withGamePage harness (free port). Run:
//   node studio/qa/scenarios/petshop.mjs
import { withGamePage } from '../harness.mjs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../out/qa/petshop');
const fails = [];

await withGamePage(async (page, ctx) => {
  await mkdir(OUT, { recursive: true });
  await page.evaluate(`(()=>{window.dispatchEvent(new Event('resize'));__startAuto&&__startAuto();game.wipe();game.start(true);})()`);
  await page.waitForTimeout(300);

  // TOWN side: Shen visible everywhere + a round-trip path down to the new park door
  const townStat=await page.evaluate('cameraQA.static(1.0)');
  if(townStat.fails) fails.push(`town camera static fails=${townStat.fails} ${JSON.stringify(townStat.byReason)}`);
  const townDescend=await page.evaluate(`cameraQA.path([[-20,-20],[8,-3],[9.5,2.5],[9.5,9.5],[0,16]])`);
  const townDoor=await page.evaluate(`cameraQA.path([[0,16],[-3,12.0],[-3,11.4],[0,16]])`);
  if(townDescend.fails) fails.push(`town descent fails=${townDescend.fails} ${JSON.stringify(townDescend.byOcc)}`);
  if(townDoor.fails) fails.push(`town door-approach fails=${townDoor.fails} ${JSON.stringify(townDoor.byOcc)}`);
  console.log(`town static:${townStat.fails}/${townStat.cells}  descent:${townDescend.fails}  door-approach:${townDoor.fails}`);
  await page.evaluate(`cameraQA.warp(-3,12.7)`); await page.waitForTimeout(220);
  await page.screenshot({path:join(OUT,'town_door.png')});

  await page.evaluate(`game.enter('petshop')`);
  await page.waitForTimeout(400);
  const scene=await page.evaluate('game.scene()');
  if(scene.cur!=='petshop') fails.push('did not enter petshop: '+JSON.stringify(scene));

  // 0) clip audit + a per-fixture close-up of EVERY fixture (the "every single thing" pass)
  const clips=await page.evaluate('window.__clips()');
  if(clips.length) fails.push('interior CLIPS (fixtures interpenetrating):\n   '+clips.map(c=>`${c.a} × ${c.b} (pen ${c.penetration})`).join('\n   '));
  console.log(`clip audit: ${clips.length} interpenetrations`);
  const fixtures=await page.evaluate('window.__fixtures()');
  await rm(join(OUT,'fx'),{recursive:true,force:true});
  await mkdir(join(OUT,'fx'),{recursive:true});
  for(const f of fixtures){ const dist=Math.max(3.5,f.size*1.5+2.5);
    await page.evaluate(`window.__look(${f.x},${f.y},${f.z},20,10,${dist})`);
    await page.waitForTimeout(130);
    await page.screenshot({path:join(OUT,'fx',f.label+'.png')}); }
  console.log(`  ✓ ${fixtures.length} per-fixture close-ups → ${join(OUT,'fx')}`);
  await page.evaluate(`__startAuto&&__startAuto()`);
  await page.waitForTimeout(200);

  // 1) camera visibility from every reachable cell
  const stat=await page.evaluate('cameraQA.static(0.5)');
  if(stat.fails) fails.push(`camera static fails=${stat.fails} ${JSON.stringify(stat.byReason)}`);
  console.log(`camera static: ${stat.fails} fails / ${stat.cells} cells`);

  // 2) round-trip path visibility (door → counter → birdcage → door)
  const path=await page.evaluate(`cameraQA.path([[-4.6,-5.9],[1.5,-3.5],[4.5,-2.5],[-4.6,-6.2],[-2,-3]])`);
  if(path.fails) fails.push(`camera path fails=${path.fails} ${JSON.stringify(path.byOcc)}`);
  console.log(`camera path: ${path.fails} fails`);

  // 3) walk up to the counter and confirm Adrian is talkable, then talk
  const talk=await page.evaluate(`(async()=>{ cameraQA.warp(1.6,-3.0); game.goTo(1.6,-6.6);
    await new Promise(r=>setTimeout(r,1600)); const near=game.dialogue().near; const s=game.state();
    game.talk(); await new Promise(r=>setTimeout(r,250)); const d=game.dialogue();
    return {stoppedAt:{x:+s.x.toFixed(2),z:+s.z.toFixed(2)}, near, talkActive:d.active}; })()`);
  if(talk.near!=='Adrian') fails.push('Adrian not in talk range from the counter (near='+talk.near+', stopped '+JSON.stringify(talk.stoppedAt)+')');
  if(!talk.talkActive) fails.push('talking to Adrian did not open dialogue');
  console.log('talk:',JSON.stringify(talk));
  await page.evaluate(`(async()=>{ cameraQA.warp(-1,-2); await new Promise(r=>setTimeout(r,120));
    for(let i=0;i<30 && game.dialogue().active;i++){ game.talk(); await new Promise(r=>setTimeout(r,110)); } })()`);
  await page.waitForTimeout(300);

  // 4) full round-trip via the REAL input path (game.talk() == pressing E/Talk near a door)
  const rt=await page.evaluate(`(async()=>{
    const settle=async(want)=>{ for(let i=0;i<50;i++){ await new Promise(r=>setTimeout(r,50));
      const s=game.scene(); if(s.nearPortal===want) return s.nearPortal; } return game.scene().nearPortal; };
    cameraQA.warp(-4.6,-6.0);
    const nearExit=await settle('to_town');
    const dbg=nearExit!=='to_town'?{dlg:game.dialogue().active, sc:game.scene(), pos:{x:+game.state().x.toFixed(2),z:+game.state().z.toFixed(2)}}:null;
    game.talk(); await new Promise(r=>setTimeout(r,1700)); const a=game.scene().cur;
    game.goTo(-3,11.4); await new Promise(r=>setTimeout(r,2600));
    const nearTown=await settle('to_petshop');
    game.talk(); await new Promise(r=>setTimeout(r,1700)); const b=game.scene().cur;
    return {nearExit, afterExit:a, nearTown, afterReenter:b, dbg}; })()`);
  if(rt.nearExit!=='to_town') fails.push('exit door not detected as nearPortal from inside (got '+rt.nearExit+')');
  if(rt.afterExit!=='town') fails.push('pressing Talk at the exit door did not return to town: '+rt.afterExit);
  if(rt.afterReenter!=='petshop') fails.push('pressing Talk at the town door did not re-enter the pet shop: '+rt.afterReenter);
  console.log('round-trip (input path):',JSON.stringify(rt));

  // shots
  for(const [name,x,z] of [['spawn',-4.6,-5.9],['counter',1.6,-4.0],['birdcage',4.6,-2.2],['back',-2,-1],
      ['rcorner',5.6,-1.0],['lcorner',-5.6,-1.0],['front',0,1.2],['frontL',-5.6,1.0],['frontR',5.6,1.0]]){
    await page.evaluate(`(()=>{__startAuto&&__startAuto();game.scene().cur==='petshop'||game.enter('petshop');cameraQA.warp(${x},${z});})()`);
    await page.waitForTimeout(220);
    await page.screenshot({path:join(OUT,'shop_'+name+'.png')});
  }
  for(const [name,tx,ty,tz,yaw,pitch,dist] of [
    ['abyss-back',2.5,2.4,-7.9,0,6,9],['abyss-left',-6.6,2,-3,90,4,11],['abyss-right',6.6,2,-3,270,4,11],['over-top',0,3,-1,0,30,14],
    ['birdcage',5.2,1.8,-1.4,205,8,4.5],['back-sign',1.2,4.05,-8.0,0,0,5.5],['exitdoor',-4.6,1.5,-7.9,0,5,5.5],
    ['tanks-back',2.5,1.8,-7.85,0,1,6],['tanks-left',-6.0,1.4,-4.4,90,3,4.5]]){
    await page.evaluate(`window.__look(${tx},${ty},${tz},${yaw},${pitch},${dist})`);
    await page.waitForTimeout(160);
    await page.screenshot({path:join(OUT,'look_'+name+'.png')});
  }
  await page.evaluate(`(()=>{__startAuto&&__startAuto();game.scene().cur==='petshop'||game.enter('petshop');cameraQA.warp(-4.6,-5.2);})()`);
  await page.waitForTimeout(250);
  await page.evaluate(`game.useDoor()`);
  await page.waitForTimeout(380);
  await page.screenshot({path:join(OUT,'transition_mid.png')});
  await page.waitForTimeout(1400);

  if(ctx.pageErrors.length) fails.push('page errors: '+ctx.pageErrors.join(' | '));
}, { start: false });

console.log(fails.length? '\n❌ PETSHOP QA FAILED:\n - '+fails.join('\n - ') : '\n✓ petshop QA clean');
process.exit(fails.length?1:0);
