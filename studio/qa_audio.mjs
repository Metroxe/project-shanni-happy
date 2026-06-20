// Fresh-context audio QA: spies on the Sound module (window.audio) to prove that
// (1) the fish tanks emit the soft `bubble` SFX, NOT the fountain water ambient, and
// (2) background music is per-scene — the overworld track on the town, the shop track
// in the pet shop (switched on the scene change). Run: node studio/qa_audio.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url));
const PORT=8795, TYPES={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.ogg':'audio/ogg'};
const server=http.createServer(async(q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/game.html';const fp=normalize(join(HERE,p));if(!existsSync(fp)||!statSync(fp).isFile()){s.writeHead(404);return s.end();}s.writeHead(200,{'content-type':TYPES[extname(fp)]||'application/octet-stream'});s.end(await readFile(fp));});
await new Promise(r=>server.listen(PORT,r));
const browser=await chromium.launch({args:['--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
const fails=[];
try{
  const page=await browser.newPage({viewport:{width:1280,height:820}});
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(`http://localhost:${PORT}/game.html`,{waitUntil:'load'});
  await page.waitForFunction('window.__ready===true');
  // install spies on the Sound module (exposed as window.audio)
  await page.evaluate(`(()=>{ const A=window.audio; window.__spy={sfx:[],music:[],water:0};
    const sfx=A.sfx.bind(A); A.sfx=(n,m)=>{ window.__spy.sfx.push(n); return sfx(n,m); };
    const sm=A.startMusic.bind(A); A.startMusic=(u,a)=>{ window.__spy.music.push(u); return sm(u,a); };
    const sw=A.setWaterLevel.bind(A); A.setWaterLevel=(v)=>{ if(v>window.__spy.water)window.__spy.water=v; return sw(v); };
    A.resume(); })()`);

  // start the game (town), then enter the pet shop
  await page.evaluate(`(()=>{__startAuto&&__startAuto();game.wipe();game.start(true);})()`);
  await page.waitForTimeout(300);
  await page.evaluate(`game.enter('petshop')`);
  await page.waitForTimeout(400);

  // sit right at the back-tank shelf and sample long enough to clear the ambient's
  // randomised first-beat (0.6–3.1s) so the count is stable, not flaky.
  await page.evaluate(`(()=>{ window.__spy.sfx.length=0; window.__spy.water=0; cameraQA.warp(3,-5); })()`);
  await page.waitForTimeout(4500);
  const a=await page.evaluate('window.__spy');
  const bubbles=a.sfx.filter(s=>s==='bubble').length;
  if(bubbles<2) fails.push('expected soft tank bubbles near the tanks, got '+bubbles+' (sfx seen: '+[...new Set(a.sfx)].join(',')+')');
  if(a.water>0.001) fails.push('fish tanks are still driving the FOUNTAIN water ambient (level '+a.water.toFixed(3)+') — should be 0');
  console.log('tank ambient: bubbles='+bubbles+'  fountainWaterLevel='+a.water.toFixed(3));

  // music: town track on boot, shop track after entering the shop
  const music=a.music;
  const townTrack=music.find(u=>u&&u.includes('calm'));
  const shopTrack=music.find(u=>u&&u.includes('shop'));
  if(!townTrack) fails.push('overworld music track not requested on start (music calls: '+JSON.stringify(music)+')');
  if(!shopTrack) fails.push('pet-shop music track not requested on entering the shop (music calls: '+JSON.stringify(music)+')');
  console.log('music requests: '+JSON.stringify([...new Set(music)]));

  // The track ACTUALLY LOOPING must match the scene (not just be requested). Turn music
  // on in the shop → the shop track must be the one playing.
  await page.evaluate(`game.music(0.5)`);
  await page.waitForTimeout(1200);
  const shopNow=await page.evaluate('window.audio.musicTrack');
  if(!(shopNow&&shopNow.includes('shop'))) fails.push('pet shop is not PLAYING the shop track (playing: '+shopNow+')');
  console.log('shop now playing: '+shopNow);

  // walk back to town through the exit door (real input path; poll past the arrival cooldown)
  const doorTo=async(x,z,want)=>{ await page.evaluate(`cameraQA.warp(${x},${z})`);
    for(let i=0;i<60;i++){ await page.waitForTimeout(50); if(await page.evaluate('game.scene().nearPortal')) break; }
    await page.evaluate('game.talk()');
    for(let i=0;i<80;i++){ await page.waitForTimeout(50); if(await page.evaluate('game.scene().cur')===want && !await page.evaluate('game.scene().trans')) break; }
    await page.waitForTimeout(500); };
  await doorTo(-4.6,-6.9,'town');
  const townNow=await page.evaluate('window.audio.musicTrack');
  if(await page.evaluate('game.scene().cur')!=='town') fails.push('exit door did not return to town');
  if(!(townNow&&townNow.includes('calm'))) fails.push('overworld is NOT playing the overworld track after return (playing: '+townNow+') — the reported bug');
  console.log('back in town, now playing: '+townNow);
  // and back into the shop once more — must be the shop track again, not stuck on calm
  await doorTo(-3,11.4,'petshop');
  const shopAgain=await page.evaluate('window.audio.musicTrack');
  if(!(shopAgain&&shopAgain.includes('shop'))) fails.push('re-entering the shop did not switch back to the shop track (playing: '+shopAgain+')');
  console.log('shop again, now playing: '+shopAgain);

  if(errs.length) fails.push('page errors: '+errs.join(' | '));
}finally{ await browser.close(); await new Promise(r=>server.close(r)); }
console.log(fails.length? '\n❌ AUDIO QA FAILED:\n - '+fails.join('\n - ') : '\n✓ audio QA clean (tank bubbles, per-scene music)');
process.exit(fails.length?1:0);
