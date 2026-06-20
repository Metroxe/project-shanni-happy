// Fresh-context interior QA probe for the pet shop loading zone. Loads game.html
// headless (no module cache), enters the pet shop, and checks: camera visibility
// from every reachable cell, that Shen can reach + talk to Adrian across the counter,
// the town→petshop→town round trip, and captures screenshots. Run: node studio/qa_petshop.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(join(HERE, 'out', 'qa', 'petshop'));
const PORT = 8788, BASE = `http://localhost:${PORT}`;
const TYPES = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json',
  '.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.css':'text/css','.ico':'image/x-icon','.ogg':'audio/ogg','.webp':'image/webp' };
const server = http.createServer(async (req,res)=>{ try{ let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/game.html';
  const fp=normalize(join(HERE,p)); if(!fp.startsWith(HERE)){res.writeHead(403);return res.end();}
  if(!existsSync(fp)||!statSync(fp).isFile()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'content-type':TYPES[extname(fp)]||'application/octet-stream'}); res.end(await readFile(fp)); }
  catch(e){res.writeHead(500);res.end(String(e));} });
await new Promise(r=>server.listen(PORT,r));
await mkdir(OUT,{recursive:true});

const browser = await chromium.launch({ args:['--enable-unsafe-swiftshader'] });
const fails=[];
try{
  const page=await browser.newPage({viewport:{width:1280,height:820}});
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(`${BASE}/game.html`,{waitUntil:'load',timeout:45000});
  await page.waitForFunction('window.__ready===true||!!window.__err',{timeout:45000}).catch(()=>{});
  await page.evaluate(`(()=>{window.dispatchEvent(new Event('resize'));__startAuto&&__startAuto();game.wipe();game.start(true);})()`);
  await page.waitForTimeout(300);

  // TOWN side: Shen visible everywhere + a round-trip path down to the new park door
  const townStat=await page.evaluate('cameraQA.static(1.0)');
  if(townStat.fails) fails.push(`town camera static fails=${townStat.fails} ${JSON.stringify(townStat.byReason)}`);
  // realistic routes: descend the stairs into the park, then approach the door from
  // the park interior (and back). Each leg starts from a settled camera.
  const townDescend=await page.evaluate(`cameraQA.path([[-20,-20],[8,-3],[9.5,2.5],[9.5,9.5],[0,16]])`);
  const townDoor=await page.evaluate(`cameraQA.path([[0,16],[-3,12.0],[-3,11.4],[0,16]])`);
  if(townDescend.fails) fails.push(`town descent fails=${townDescend.fails} ${JSON.stringify(townDescend.byOcc)}`);
  if(townDoor.fails) fails.push(`town door-approach fails=${townDoor.fails} ${JSON.stringify(townDoor.byOcc)}`);
  console.log(`town static:${townStat.fails}/${townStat.cells}  descent:${townDescend.fails}  door-approach:${townDoor.fails}`);
  // shot of the town pet-shop door
  await page.evaluate(`cameraQA.warp(-3,12.7)`); await page.waitForTimeout(220);
  await page.screenshot({path:join(OUT,'town_door.png')});

  await page.evaluate(`game.enter('petshop')`);
  await page.waitForTimeout(400);

  const scene=await page.evaluate('game.scene()');
  if(scene.cur!=='petshop') fails.push('did not enter petshop: '+JSON.stringify(scene));

  // 0) GEOMETRIC CLIP AUDIT — no interior fixture may pass through another (shelf through
  // a tank, door sunk into a wall, shelf buried in a wall...). Must be []. Then a per-object
  // close-up of EVERY fixture so each gets looked at (the "every single thing" pass).
  const clips=await page.evaluate('window.__clips()');
  if(clips.length) fails.push('interior CLIPS (fixtures interpenetrating):\n   '+clips.map(c=>`${c.a} × ${c.b} (pen ${c.penetration})`).join('\n   '));
  console.log(`clip audit: ${clips.length} interpenetrations`);
  const fixtures=await page.evaluate('window.__fixtures()');
  await rm(join(OUT,'fx'),{recursive:true,force:true});   // labels are position-named — clear stale shots
  await mkdir(join(OUT,'fx'),{recursive:true});
  for(const f of fixtures){ const dist=Math.max(3.5,f.size*1.5+2.5);
    await page.evaluate(`window.__look(${f.x},${f.y},${f.z},20,10,${dist})`);
    await page.waitForTimeout(130);
    await page.screenshot({path:join(OUT,'fx',f.label+'.png')}); }
  console.log(`  ✓ ${fixtures.length} per-fixture close-ups → ${join(OUT,'fx')}`);
  await page.evaluate(`__startAuto&&__startAuto()`);   // __look stopped the loop — resume for the live tests below
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
  // close the dialogue so it can't gate the door round-trip below (a door won't fire
  // mid-conversation). Step AWAY from Adrian first so a stray advance can't re-open it.
  await page.evaluate(`(async()=>{ cameraQA.warp(-1,-2); await new Promise(r=>setTimeout(r,120));
    for(let i=0;i<30 && game.dialogue().active;i++){ game.talk(); await new Promise(r=>setTimeout(r,110)); } })()`);
  await page.waitForTimeout(300);

  // 4) full round-trip via the REAL input path (game.talk() == pressing E/Talk near a
  // door → nearPortal → startPortal), not the useDoor shortcut. Confirms the door fires
  // off the contextual action the same way the player triggers it.
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
  // detail + abyss looks. NB camera sits on the named side OF the target: yaw 0 = camera
  // SOUTH(+z) of target → looks NORTH(-z) (toward the back wall) from INSIDE the room.
  for(const [name,tx,ty,tz,yaw,pitch,dist] of [
    ['abyss-back',2.5,2.4,-7.9,0,6,9],['abyss-left',-6.6,2,-3,90,4,11],['abyss-right',6.6,2,-3,270,4,11],['over-top',0,3,-1,0,30,14],
    ['birdcage',5.2,1.8,-1.4,205,8,4.5],['back-sign',1.2,4.05,-8.0,0,0,5.5],['exitdoor',-4.6,1.5,-7.9,0,5,5.5],
    ['tanks-back',2.5,1.8,-7.85,0,1,6],['tanks-left',-6.0,1.4,-4.4,90,3,4.5]]){
    await page.evaluate(`window.__look(${tx},${ty},${tz},${yaw},${pitch},${dist})`);
    await page.waitForTimeout(160);
    await page.screenshot({path:join(OUT,'look_'+name+'.png')});
  }
  // mid-transition fade frame (catch Shen stepping into the door under the cream wipe)
  await page.evaluate(`(()=>{__startAuto&&__startAuto();game.scene().cur==='petshop'||game.enter('petshop');cameraQA.warp(-4.6,-5.2);})()`);
  await page.waitForTimeout(250);
  await page.evaluate(`game.useDoor()`);
  await page.waitForTimeout(380);
  await page.screenshot({path:join(OUT,'transition_mid.png')});
  await page.waitForTimeout(1400);
  if(errs.length) fails.push('page errors: '+errs.join(' | '));
}finally{ await browser.close(); await new Promise(r=>server.close(r)); }
console.log(fails.length? '\n❌ PETSHOP QA FAILED:\n - '+fails.join('\n - ') : '\n✓ petshop QA clean');
process.exit(fails.length?1:0);
