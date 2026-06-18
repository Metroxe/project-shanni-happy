import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const DIR = dirname(fileURLToPath(import.meta.url));
const EXEC = readFileSync(DIR + '/.exec', 'utf8').trim();

// args: outSubdir  times="t1,t2,..."  OR  fps=NN dur=SS
const outdir = process.argv[2] || 'paper';
let times = [];
const a = Object.fromEntries(process.argv.slice(3).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
if(a.times) times = a.times.split(',').map(Number);
else { const fps=Number(a.fps||20), dur=Number(a.dur||5.0); const n=Math.round(fps*dur);
       for(let i=0;i<=n;i++) times.push(+(i/fps).toFixed(3)); }

mkdirSync(`${DIR}/out/${outdir}`,{recursive:true});
const browser=await chromium.launch({executablePath:EXEC,headless:true,
  args:['--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--use-gl=angle','--no-sandbox','--allow-file-access-from-files']});
const ctx=await browser.newContext({viewport:{width:960,height:720},deviceScaleFactor:1});
const page=await ctx.newPage();
page.on('pageerror',e=>console.log('  pageerror:',e.message.slice(0,200)));
page.on('console',m=>{const t=m.text(); if(/error|fail|warn/i.test(t)) console.log('  console:',t.slice(0,160));});
await page.goto('file://'+DIR+'/paper-shen.html',{waitUntil:'load',timeout:30000});
await page.waitForFunction('window.__ready===true',{timeout:20000});
await page.evaluate(()=>window.__stopAuto && window.__stopAuto());
let idx=0;
for(const t of times){
  await page.evaluate(tt=>window.__render(tt), t);
  await page.waitForTimeout(20);
  const name=`${outdir}/f${String(idx).padStart(3,'0')}.png`;
  await page.screenshot({path:`${DIR}/out/${name}`});
  idx++;
}
console.log(`shot ${idx} frames -> out/${outdir}/`);
await browser.close();
