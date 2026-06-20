// SCENARIO: contextual audio. Spies on the Sound module (window.audio) to prove the fish
// tanks emit the soft `bubble` SFX (NOT the fountain water ambient), and that music is
// per-scene — the actually-PLAYING track follows the scene (overworld track in town, shop
// track in the shop), switching on the door and never stuck. Run:
//   node studio/qa/scenarios/audio.mjs
import { withGamePage } from '../harness.mjs';

const fails = [];
await withGamePage(async (page, ctx) => {
  // install spies on the Sound module (exposed as window.audio) BEFORE the game starts
  await page.evaluate(`(()=>{ const A=window.audio; window.__spy={sfx:[],music:[],water:0};
    const sfx=A.sfx.bind(A); A.sfx=(n,m)=>{ window.__spy.sfx.push(n); return sfx(n,m); };
    const sm=A.startMusic.bind(A); A.startMusic=(u,a)=>{ window.__spy.music.push(u); return sm(u,a); };
    const sw=A.setWaterLevel.bind(A); A.setWaterLevel=(v)=>{ if(v>window.__spy.water)window.__spy.water=v; return sw(v); };
    A.resume(); })()`);
  await page.evaluate(`(()=>{__startAuto&&__startAuto();game.wipe();game.start(true);})()`);
  await page.waitForTimeout(300);
  await page.evaluate(`game.enter('petshop')`);
  await page.waitForTimeout(400);

  // sit at the back-tank shelf, sample long enough to clear the ambient's randomised first beat
  await page.evaluate(`(()=>{ window.__spy.sfx.length=0; window.__spy.water=0; cameraQA.warp(3,-5); })()`);
  await page.waitForTimeout(4500);
  const a=await page.evaluate('window.__spy');
  const bubbles=a.sfx.filter(s=>s==='bubble').length;
  if(bubbles<2) fails.push('expected soft tank bubbles near the tanks, got '+bubbles+' (sfx seen: '+[...new Set(a.sfx)].join(',')+')');
  if(a.water>0.001) fails.push('fish tanks are still driving the FOUNTAIN water ambient (level '+a.water.toFixed(3)+') — should be 0');
  console.log('tank ambient: bubbles='+bubbles+'  fountainWaterLevel='+a.water.toFixed(3));

  const music=a.music;
  if(!music.find(u=>u&&u.includes('calm'))) fails.push('overworld music track not requested on start (music calls: '+JSON.stringify(music)+')');
  if(!music.find(u=>u&&u.includes('shop'))) fails.push('pet-shop music track not requested on entering the shop (music calls: '+JSON.stringify(music)+')');
  console.log('music requests: '+JSON.stringify([...new Set(music)]));

  // The track ACTUALLY LOOPING must match the scene. Turn music on in the shop → shop track plays.
  await page.evaluate(`game.music(0.5)`);
  await page.waitForTimeout(1200);
  const shopNow=await page.evaluate('window.audio.musicTrack');
  if(!(shopNow&&shopNow.includes('shop'))) fails.push('pet shop is not PLAYING the shop track (playing: '+shopNow+')');
  console.log('shop now playing: '+shopNow);

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
  await doorTo(-3,11.4,'petshop');
  const shopAgain=await page.evaluate('window.audio.musicTrack');
  if(!(shopAgain&&shopAgain.includes('shop'))) fails.push('re-entering the shop did not switch back to the shop track (playing: '+shopAgain+')');
  console.log('shop again, now playing: '+shopAgain);

  // ---- GYM: shared calm-indoor loop + a proximity-gated free-weight `clink` ambient +
  // Chrees' curl-rep `lift` (no silent room, the right sound from the right spot). ----
  await page.evaluate(`game.enter('gym','from_town')`);
  await page.waitForTimeout(600);
  const gymTrack=await page.evaluate('window.audio.musicTrack');
  if(!(gymTrack&&gymTrack.includes('shop'))) fails.push('gym is not playing the shared indoor loop (playing: '+gymTrack+')');
  console.log('gym now playing: '+gymTrack);
  // weight clinks near the dumbbell rack (a gym room sound, NOT silent, NOT the fountain)
  await page.evaluate(`(()=>{ window.__spy.sfx.length=0; window.__spy.water=0; cameraQA.warp(8.0,-3.4); })()`);
  await page.waitForTimeout(9500);
  const ga=await page.evaluate('window.__spy');
  const clinks=ga.sfx.filter(s=>s==='clink').length;
  if(clinks<1) fails.push('expected weight clinks near the gym dumbbell rack, got '+clinks+' (sfx: '+[...new Set(ga.sfx)].join(',')+')');
  if(ga.water>0.001) fails.push('gym is driving the FOUNTAIN water ambient ('+ga.water.toFixed(3)+') — should be 0');
  console.log('gym free-weight ambient: clinks='+clinks+'  fountainWaterLevel='+ga.water.toFixed(3));
  // Chrees works out here: his curl pose-loop fires the proximity `lift` near him
  await page.evaluate(`(()=>{ window.__spy.sfx.length=0; cameraQA.warp(1.8,2.4); })()`);
  await page.waitForTimeout(3500);
  const lifts=(await page.evaluate('window.__spy.sfx')).filter(s=>s==='lift').length;
  if(lifts<2) fails.push("Chrees' curl lifts not firing near him in the gym, got "+lifts);
  console.log('Chrees lifts near him: '+lifts);

  if(ctx.pageErrors.length) fails.push('page errors: '+ctx.pageErrors.join(' | '));
}, { start: false, launchArgs: ['--autoplay-policy=no-user-gesture-required'] });

console.log(fails.length? '\n❌ AUDIO QA FAILED:\n - '+fails.join('\n - ') : '\n✓ audio QA clean (tank bubbles, per-scene music)');
process.exit(fails.length?1:0);
