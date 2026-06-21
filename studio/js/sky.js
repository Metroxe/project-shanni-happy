// sky.js — warm day/night cycle for the papercraft game.
//
// One module owns the whole sky: a gradient skydome, an arcing sun + moon, drifting
// flat paper clouds, soft pastel stars, and the scene's two lights (directional +
// hemisphere). Everything is driven by a single day phase `p` in [0,1):
//   p = 0.00 sunrise · 0.25 noon · 0.50 sunset · 0.75 midnight  (cyclic).
//
// Aesthetic is the locked flat papercraft look: discs + clouds are billboards (no
// edge-on planes), colours stay in a warm pastel band, and **night is a soft indigo,
// never black** (QT). The cycle advances on a wall clock (independent of game pause),
// so the world keeps breathing on the title screen too.
//
// UI-agnostic like dialogue.js / quests.js — game.html calls:
//   Sky.build(scene, cfg)        // once, owns lights + sky meshes
//   Sky.update(dt, camera)       // every frame, before render
//   Sky.setTime(p) / getTime() / setDayLength(s)   // debug / tuning
//
// Robust by design: build + update are guarded, so a failure degrades to "plain
// daylight" rather than crashing the smoke test.

import * as THREE from 'three';

const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const smooth=t=>t<=0?0:t>=1?1:t*t*(3-2*t);
const smoothstep=(a,b,x)=>smooth((x-a)/(b-a||1e-6));
const lerp=(a,b,t)=>a+(b-a)*t;
// read a numeric arc-tuning knob from cfg.arc (set in build), else a default
const cfgN=(self,key,def)=>{const v=self._arc&&self._arc[key]; return (typeof v==='number')?v:def;};

// ---- day-phase palette keyframes (cyclic). Warm-biased; night = soft indigo. ----
// Each stop: sky zenith (top) + horizon (hor, also fog/background), directional light
// colour (dir), hemisphere sky/ground fill (hs/hg) + intensity (hi), cloud tint (ct) +
// opacity multiplier (co), and star opacity (st). Tuned live in the preview.
const STOPS=[
  {p:0.00, top:'#a7b2e6', hor:'#ffceaa', dir:'#ffcaa0', hs:'#ffe7d6', hg:'#d9cfc2', hi:1.55, ct:'#ffe2cc', co:1.00, st:0.00}, // sunrise
  {p:0.16, top:'#bcd2ef', hor:'#f4eddf', dir:'#fff0e0', hs:'#fffaf3', hg:'#dadde4', hi:2.00, ct:'#fffaf2', co:1.00, st:0.00}, // morning
  {p:0.28, top:'#c4def2', hor:'#f7f0e3', dir:'#fff4ea', hs:'#ffffff', hg:'#dcdee5', hi:2.10, ct:'#ffffff', co:1.00, st:0.00}, // noon
  {p:0.44, top:'#cabfe0', hor:'#ffcda3', dir:'#ffb27a', hs:'#ffe3d0', hg:'#d6c8bd', hi:1.70, ct:'#ffdbc0', co:1.00, st:0.00}, // golden
  {p:0.50, top:'#b79ec9', hor:'#ff9f7d', dir:'#ff8f63', hs:'#ffd1bc', hg:'#cab4ad', hi:1.40, ct:'#ffb59c', co:1.00, st:0.06}, // sunset
  {p:0.58, top:'#6b6ba1', hor:'#c98da6', dir:'#bb83a0', hs:'#bcaccb', hg:'#8f86a1', hi:1.05, ct:'#d4abbe', co:0.92, st:0.45}, // dusk
  {p:0.74, top:'#232a52', hor:'#4b507f', dir:'#aeb8ff', hs:'#3b4272', hg:'#2c2c46', hi:0.72, ct:'#9aa6d8', co:0.70, st:1.00}, // night
  {p:0.90, top:'#3a3f64', hor:'#7b7089', dir:'#cbb1c2', hs:'#5b5979', hg:'#46434f', hi:0.92, ct:'#b7aac2', co:0.84, st:0.55}, // pre-dawn
];
const SC=STOPS.map(s=>({p:s.p,
  top:new THREE.Color(s.top), hor:new THREE.Color(s.hor), dir:new THREE.Color(s.dir),
  hs:new THREE.Color(s.hs), hg:new THREE.Color(s.hg), ct:new THREE.Color(s.ct),
  hi:s.hi, co:s.co, st:s.st}));

// interpolate the palette at phase p (cyclic), writing into reusable targets in `out`.
function samplePalette(p, out){
  p=((p%1)+1)%1;
  const n=SC.length; let hi=0;
  for(let k=0;k<n;k++){ if(SC[k].p>p){hi=k;break;} if(k===n-1)hi=0; }
  const lo=(hi-1+n)%n;
  let p0=SC[lo].p, p1=SC[hi].p; if(p1<=p0)p1+=1;
  let pp=p; if(pp<p0)pp+=1;
  const t=smooth((pp-p0)/(p1-p0||1e-6)), a=SC[lo], b=SC[hi];
  out.top.copy(a.top).lerp(b.top,t);
  out.hor.copy(a.hor).lerp(b.hor,t);
  out.dir.copy(a.dir).lerp(b.dir,t);
  out.hs.copy(a.hs).lerp(b.hs,t);
  out.hg.copy(a.hg).lerp(b.hg,t);
  out.ct.copy(a.ct).lerp(b.ct,t);
  out.hi=lerp(a.hi,b.hi,t); out.co=lerp(a.co,b.co,t); out.st=lerp(a.st,b.st,t);
  return out;
}

// ---- procedural canvas textures (soft, paper-edged; no asset files) ----
function canvasTex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;
  draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);
  t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;}

// a flat paper cloud: a cluster of soft white lobes with a flattened base + faint grain.
function cloudTex(seed){
  let s=seed*9301+49297; const rnd=()=>((s=(s*9301+49297)%233280)/233280);
  return canvasTex(256,140,(x,W,H)=>{
    const lobes=5+Math.floor(rnd()*3), baseY=H*0.70;
    for(let i=0;i<lobes;i++){
      const cx=W*(0.18+0.64*(i/(lobes-1))) + (rnd()-0.5)*22;
      const r =H*(0.30+rnd()*0.20);
      const cy=baseY - r*0.65 - rnd()*H*0.10;
      const g=x.createRadialGradient(cx,cy,0,cx,cy,r);
      g.addColorStop(0,'rgba(255,255,255,0.96)');
      g.addColorStop(0.6,'rgba(255,255,255,0.78)');
      g.addColorStop(1,'rgba(255,255,255,0)');
      x.fillStyle=g; x.beginPath(); x.arc(cx,cy,r,0,7); x.fill();
    }
    // soft flat underside
    const u=x.createLinearGradient(0,baseY-12,0,baseY+10);
    u.addColorStop(0,'rgba(255,255,255,0)'); u.addColorStop(1,'rgba(228,230,240,0)');
    x.fillStyle=u; x.fillRect(0,baseY-12,W,22);
    // whisper of paper grain
    const img=x.getImageData(0,0,W,H), d=img.data;
    for(let i=0;i<d.length;i+=4){ if(d[i+3]>10){const n=(rnd()-0.5)*10; d[i]=clamp(d[i]+n,0,255);d[i+1]=clamp(d[i+1]+n,0,255);d[i+2]=clamp(d[i+2]+n,0,255);} }
    x.putImageData(img,0,0);
  });
}
const sunTex=()=>canvasTex(256,256,(x,W,H)=>{const cx=W/2,cy=H/2;
  const g=x.createRadialGradient(cx,cy,0,cx,cy,W/2);
  g.addColorStop(0,'rgba(255,251,236,1)'); g.addColorStop(0.16,'rgba(255,243,214,1)');
  g.addColorStop(0.34,'rgba(255,222,170,0.55)'); g.addColorStop(0.62,'rgba(255,206,150,0.18)');
  g.addColorStop(1,'rgba(255,206,150,0)'); x.fillStyle=g; x.fillRect(0,0,W,H);});
const moonTex=()=>canvasTex(256,256,(x,W,H)=>{const cx=W/2,cy=H/2;
  const g=x.createRadialGradient(cx,cy,0,cx,cy,W/2);
  g.addColorStop(0,'rgba(247,249,255,1)'); g.addColorStop(0.20,'rgba(233,238,255,0.96)');
  g.addColorStop(0.40,'rgba(205,214,255,0.40)'); g.addColorStop(1,'rgba(205,214,255,0)');
  x.fillStyle=g; x.fillRect(0,0,W,H);
  // faint crescent: offset cool shadow nudges the disc toward a moon read
  const sh=x.createRadialGradient(cx+W*0.16,cy-H*0.08,0,cx+W*0.16,cy-H*0.08,W*0.30);
  sh.addColorStop(0,'rgba(196,206,240,0.30)'); sh.addColorStop(1,'rgba(196,206,240,0)');
  x.globalCompositeOperation='multiply'; x.fillStyle=sh;
  x.beginPath(); x.arc(cx,cy,W*0.22,0,7); x.fill();});
const starTex=()=>canvasTex(32,32,(x,W,H)=>{const g=x.createRadialGradient(16,16,0,16,16,16);
  g.addColorStop(0,'rgba(255,255,255,1)'); g.addColorStop(0.4,'rgba(255,255,255,0.6)');
  g.addColorStop(1,'rgba(255,255,255,0)'); x.fillStyle=g; x.fillRect(0,0,W,H);});

// ---- gradient skydome shader (vertical wash, top<->horizon) ----
const DOME_VERT=`varying vec3 vDir; void main(){ vDir=normalize(position);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const DOME_FRAG=`uniform vec3 top; uniform vec3 hor; varying vec3 vDir;
  void main(){ float t=smoothstep(0.0,0.55,vDir.y); gl_FragColor=vec4(mix(hor,top,t),1.0);}`;

export const Sky = {
  ready:false, phase:0, dayLength:1440, group:null, dome:null, sun:null, moon:null,
  stars:null, clouds:[], dir:null, hemi:null, _scene:null, _broke:false, _arc:null,
  interior:false, _interiorBg:new THREE.Color('#e7d9c2'),
  // cast-shadow quality (graphics menu drives it; see setShadowQuality / setShadowBounds)
  _shadowLevel:'high', _shadowHalf:55, _fixedTgt:new THREE.Vector3(0,0,-19),
  _pal:{top:new THREE.Color(),hor:new THREE.Color(),dir:new THREE.Color(),
        hs:new THREE.Color(),hg:new THREE.Color(),ct:new THREE.Color(),hi:2,co:1,st:0},
  _tmpDir:new THREE.Vector3(), _tmpDir2:new THREE.Vector3(), _tmpTgt:new THREE.Vector3(), _bg:new THREE.Color(),

  build(scene, cfg={}){
    try{
      this._scene=scene;
      this.dayLength=cfg.dayLength||1440;   // 24-min day; matches world.json so a stale/missing config can't run fast
      this.phase=((cfg.startPhase??0.16)%1+1)%1;
      this._arc=cfg.arc||{};          // {spread,depth,elev} tuning for the sun/moon path
      const DOME_R=cfg.domeR||250, DISC_R=cfg.discR||200, STAR_R=cfg.starR||232;

      // group follows the camera in xz so the sky is "infinite" (no parallax, never reachable)
      const g=new THREE.Group(); g.frustumCulled=false; scene.add(g); this.group=g;

      // gradient dome (always furthest: no depth, drawn first)
      const dm=new THREE.Mesh(new THREE.SphereGeometry(DOME_R,32,16),
        new THREE.ShaderMaterial({uniforms:{top:{value:new THREE.Color('#c4def2')},hor:{value:new THREE.Color('#f7f0e3')}},
          vertexShader:DOME_VERT, fragmentShader:DOME_FRAG, side:THREE.BackSide,
          depthWrite:false, depthTest:false, fog:false}));
      dm.frustumCulled=false; dm.renderOrder=-100; g.add(dm); this.dome=dm;
      scene.background=new THREE.Color('#f7f0e3');
      scene.fog=new THREE.Fog(new THREE.Color('#f7f0e3'), (cfg.fog&&cfg.fog[0])||28, (cfg.fog&&cfg.fog[1])||64);

      // stars: sparse points on the upper dome (fade in at night)
      const SN=cfg.stars||90, pos=new Float32Array(SN*3); let si=0; let rs=12345;
      const rnd=()=>((rs=(rs*9301+49297)%233280)/233280);
      for(let i=0;i<SN;i++){ const u=rnd(), el=0.15+rnd()*0.8, az=u*Math.PI*2;
        const y=el, r=Math.sqrt(1-y*y); pos[si++]=Math.cos(az)*r*STAR_R; pos[si++]=y*STAR_R; pos[si++]=Math.sin(az)*r*STAR_R; }
      const sg=new THREE.BufferGeometry(); sg.setAttribute('position',new THREE.BufferAttribute(pos,3));
      this.stars=new THREE.Points(sg,new THREE.PointsMaterial({map:starTex(),size:3.4,sizeAttenuation:true,
        transparent:true,opacity:0,depthWrite:false,depthTest:true,fog:false,blending:THREE.AdditiveBlending}));
      this.stars.frustumCulled=false; this.stars.renderOrder=-90; g.add(this.stars);

      // sun + moon discs (billboards, soft glow)
      // depthTest:true so buildings occlude the disc when it's behind them (no bleed-through);
      // depthWrite:false + renderOrder keeps it from interfering with the transparent sort.
      const disc=(tex,size,ro)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(size,size),
        new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,depthTest:true,fog:false,
          opacity:1,blending:THREE.AdditiveBlending})); m.frustumCulled=false; m.renderOrder=ro; g.add(m); return m;};
      this.sun =disc(sunTex(),  cfg.sunSize||46, -80);
      this.moon=disc(moonTex(), cfg.moonSize||34, -80);
      this._DISC_R=DISC_R;

      // sparse paper clouds, drifting + wrapping in the group's local frame
      const CC=cfg.clouds?.count ?? 6;
      const RAD=cfg.clouds?.radius ?? [60,128];
      const YB =cfg.clouds?.y ?? [30,46];
      const SCALE=cfg.clouds?.scale ?? [10,20];
      this._cloudCfg={wind:cfg.clouds?.wind ?? 1.1, opacity:cfg.clouds?.opacity ?? 0.9, halfX:cfg.clouds?.halfX ?? 150};
      const texes=[cloudTex(1),cloudTex(2),cloudTex(3)];
      for(let i=0;i<CC;i++){
        const r=lerp(RAD[0],RAD[1],rnd()), ang=rnd()*Math.PI*2;
        const sc=lerp(SCALE[0],SCALE[1],rnd());
        const tex=texes[i%texes.length];
        const m=new THREE.Mesh(new THREE.PlaneGeometry(sc,sc*0.52),
          new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,fog:false,opacity:this._cloudCfg.opacity}));
        m.frustumCulled=false;
        // local position: spread across a wide X band at radius r, drifting along +X
        const lx=lerp(-this._cloudCfg.halfX,this._cloudCfg.halfX,rnd());
        const lz=-Math.abs(r)*lerp(0.5,1,rnd()) * (rnd()<0.5?1:0.85);
        m.position.set(lx, lerp(YB[0],YB[1],rnd()), lz);
        m.userData={baseY:m.position.y, bobA:0.6+rnd()*0.9, bobS:0.10+rnd()*0.14, bobP:rnd()*7,
          spd:this._cloudCfg.wind*(0.6+rnd()*0.8)};
        g.add(m); this.clouds.push(m);
      }

      // lights — directional (sun/moon) + hemisphere fill. Sky owns + drives them.
      // Soft VSM shadows: setShadowQuality sets the map size + blur radius; setShadowBounds
      // fits the FIXED (non-following → no flicker) frustum to the scene. VSM is forgiving on
      // acne, so a tiny bias + modest normalBias avoids self-shadow + peter-panning.
      const dir=new THREE.DirectionalLight(0xfff4ea, 2.0);
      // normalBias stays SMALL: a big one peter-pans the shadow off its caster (small props
      // lose their shadow). These values keep PCF acne away without detaching contact shadows.
      dir.castShadow=true; dir.shadow.bias=-0.0005; dir.shadow.normalBias=0.02;
      dir.target.position.copy(this._fixedTgt); scene.add(dir.target); scene.add(dir); this.dir=dir;
      this.setShadowBounds(this._fixedTgt.x, this._fixedTgt.z, this._shadowHalf);  // default frustum
      this.setShadowQuality(this._shadowLevel);                                    // map size + blur
      const hemi=new THREE.HemisphereLight(0xffffff,0xd9dde6,2.0); scene.add(hemi); this.hemi=hemi;

      this.ready=true;
      this._apply(0);                 // paint the initial time of day
    }catch(e){
      this._broke=true; console.warn('Sky.build failed, falling back to plain daylight:',e);
      // safety net so the scene is never black + smoke stays green
      if(!this.hemi){scene.add(new THREE.HemisphereLight(0xffffff,0xd9dde6,2.0));
        const d=new THREE.DirectionalLight(0xfff4ea,2.0); d.position.set(10,20,12); d.castShadow=true;
        d.shadow.mapSize.set(2048,2048); d.shadow.bias=-0.0004;
        const s=d.shadow.camera; s.left=-40;s.right=40;s.top=40;s.bottom=-40;s.near=1;s.far=100; scene.add(d);}
      scene.background=new THREE.Color('#e7edf2'); scene.fog=new THREE.Fog(new THREE.Color('#e7edf2'),28,64);
    }
  },

  // advance the clock + repaint everything for the current camera
  update(dt, cam){
    if(!this.ready||this._broke)return;
    try{
      this.phase=((this.phase + dt/Math.max(this.dayLength,1))%1+1)%1;
      // follow the camera in xz (sky stays centred on the player; no parallax)
      if(cam){ this.group.position.set(cam.position.x,0,cam.position.z);
        if(this.sun){this.sun.quaternion.copy(cam.quaternion);}
        if(this.moon){this.moon.quaternion.copy(cam.quaternion);} }
      this._apply(dt, cam);
    }catch(e){ if(!this._broke){this._broke=true; console.warn('Sky.update error (frozen):',e);} }
  },

  // Interior mode: hide the whole outdoor sky (dome/sun/moon/stars/clouds all live
  // under this.group) and swap to a warm, even indoor light + solid background, so
  // a walled room never shows day/night sky through a gap. The day phase keeps
  // advancing underneath (the clock stays right); _apply early-returns so it can't
  // repaint outdoor colours over the interior. Reversible: setInterior(false)
  // re-shows the sky and repaints the current time of day.
  setInterior(on, cfg={}){
    this.interior=!!on;
    if(this.group) this.group.visible=!on;
    // ⚠️ Colour values may arrive with OR without a leading '#'. THREE.Color silently
    // parses a bare 'e7d9c2' as WHITE (not the intended tan) — exactly how an interior
    // background went pitch-white. Normalise EVERY colour through C() before use.
    const C=v=>{ v=v||''; return v[0]==='#'?v:'#'+v; };
    if(this._broke){                                  // fallback path: just set bg/fog
      if(this._scene){ const c=new THREE.Color(C(cfg.bg||'e7d9c2'));
        this._scene.background=c; if(this._scene.fog)this._scene.fog.color.copy(c); }
      return this.interior;
    }
    if(on){
      this._interiorBg=new THREE.Color(C(cfg.bg||'e7d9c2'));
      if(this._scene){ this._scene.background=this._interiorBg;
        if(this._scene.fog){ this._scene.fog.color.copy(this._interiorBg);
          this._scene.fog.near=cfg.fogNear??16; this._scene.fog.far=cfg.fogFar??70; } }
      if(this.hemi){ this.hemi.color.set(C(cfg.hemiSky||'fff1dc'));
        this.hemi.groundColor.set(C(cfg.hemiGround||'d8c4a8')); this.hemi.intensity=cfg.hemiI??2.3; }
      if(this.dir){ this.dir.color.set(C(cfg.dirColor||'ffe7c4')); this.dir.intensity=cfg.dirI??0.55;
        const dp=cfg.dirPos||[5,16,8]; this.dir.position.set(dp[0],dp[1],dp[2]);
        if(this.dir.target){ this.dir.target.position.set(0,0,0); } }
    } else {
      this._apply(0);                                 // repaint the outdoor time of day
    }
    return this.interior;
  },

  // ---- cast-shadow quality (driven by the graphics menu) --------------------
  // Softness comes from PCSS (js/pcss.js patches the shadow shader) — contact-hardening, the
  // accurate look. `radius` here only matters if that patch ever fails (the plain-PCF fallback).
  // The frustum is FIXED to the scene's extent (setShadowBounds), world-locked — NOT following
  // the player. A moving frustum is what made the shadows crawl / flicker under the bushes; a
  // fixed one can't shimmer (and PCSS's per-pixel sample pattern is uv-seeded → also stable).
  // Quality only trades map RESOLUTION (cleaner vs lighter). 'off' stops the sun casting
  // (billboard contact ovals still ground the characters). mapSize changes never recompile shaders.
  SHADOW_Q:{ off:{cast:false}, low:{cast:true,map:2048,radius:3,blur:8},
             high:{cast:true,map:4096,radius:4,blur:12} },
  setShadowQuality(level){
    if(!this.SHADOW_Q[level]) level='high';
    this._shadowLevel=level; const q=this.SHADOW_Q[level];
    if(!this.dir) return level;                         // re-applied at end of build()
    this.dir.castShadow=!!q.cast;
    if(q.cast){
      this.dir.shadow.radius=q.radius;                  // PCF filter radius (soft edge)
      this.dir.shadow.blurSamples=q.blur;               // (VSM-only; harmless under PCF)
      if(this.dir.shadow.mapSize.width!==q.map){
        this.dir.shadow.mapSize.set(q.map,q.map);
        if(this.dir.shadow.map){ this.dir.shadow.map.dispose(); this.dir.shadow.map=null; } // rebuild at new res
      }
    }
    return level;
  },
  // Fit the FIXED sun-shadow frustum to a scene's reachable extent + centre (called by
  // buildScene per scene). Concentrating the map's texels on just what the player can reach
  // keeps the soft shadow clean WITHOUT a moving frustum — so it never crawls/flickers.
  setShadowBounds(cx, cz, half){
    this._shadowHalf=half; this._fixedTgt.set(cx,0,cz);
    if(!this.dir) return;
    this.dir.target.position.set(cx,0,cz);
    const sc=this.dir.shadow.camera;
    sc.left=-half; sc.right=half; sc.top=half; sc.bottom=-half;
    // Tight near/far around the light's actual distance keeps the packed-depth precision high so
    // PCSS's blocker search resolves the occluder→receiver gap cleanly. The outdoor sun sits ~100
    // units out (_apply); an interior's lamp is set ~20 out (setInterior). Bracket each.
    if(this.interior){ sc.near=2; sc.far=48; }
    else { sc.near=40; sc.far=100+half+25; }
    sc.updateProjectionMatrix();
  },

  _apply(dt, cam){
    // interior mode owns the lights/bg/fog (set in setInterior); just hold the
    // background/fog colour each frame (FX can swap scene.background) and bail.
    if(this.interior){
      if(this._scene){ this._scene.background=this._interiorBg;
        if(this._scene.fog)this._scene.fog.color.copy(this._interiorBg); }
      return;
    }
    const P=samplePalette(this.phase, this._pal);
    // dome + fog + background
    if(this.dome){ this.dome.material.uniforms.top.value.copy(P.top); this.dome.material.uniforms.hor.value.copy(P.hor); }
    // reassign (don't copy-into): the FX post-processing lens may swap scene.background
    // for a texture when a preset is active — we always reset it to our time-of-day colour.
    if(this._scene){ this._scene.background=this._bg.copy(P.hor); if(this._scene.fog)this._scene.fog.color.copy(P.hor); }
    // hemisphere fill
    // The near-white sky fill at full strength over-brightens up-facing floors so light
    // surfaces clip to white (the "light bleeding under the walls": albedo×light > 1, no tone
    // mapping in the default FX-off render). Trim the ambient fill so light floors stay below
    // the clip; the strong directional sun keeps the scene light + airy (walls stay sunlit).
    if(this.hemi){ this.hemi.color.copy(P.hs); this.hemi.groundColor.copy(P.hg); this.hemi.intensity=P.hi*0.6; }

    // sun + moon arc — STYLIZED for a flat papercraft game in a walled scene. Rather than
    // a realistic overhead arc (which spends the day above this low, slightly-downward
    // camera's frame), the bodies travel LOW across the front (-z) sky band the hero camera
    // looks at: rising at the left of the gap, cresting centre-front at a gentle peak, and
    // setting at the right — so you actually watch the sun cross the sky all day, then the
    // moon does the same across the night. Day = p in [0,0.5], night = [0.5,1].
    // East–west sweep with a gentle peak: the open sky here is DOWN THE ROADS (±x), so the
    // bodies rise in the east (+x road end), crest low and slightly toward the viewer (-z),
    // and set in the west (-x road end) — visible along the roads and across the skyline.
    const SPREAD=cfgN(this,'spread',1.0), DEPTH=cfgN(this,'depth',0.5), ELEV=cfgN(this,'elev',0.5);
    const sunUp=this.phase<0.5;
    const u=clamp(this.phase/0.5,0,1);                 // 0..1 across the day
    const v=clamp((this.phase-0.5)/0.5,0,1);           // 0..1 across the night
    const sy=ELEV*Math.sin(Math.PI*u), my=ELEV*Math.sin(Math.PI*v);   // gentle rise/set
    const sd=this._tmpDir.set(Math.cos(Math.PI*u)*SPREAD, sy, -DEPTH).normalize();
    const md=this._tmpDir2.set(Math.cos(Math.PI*v)*SPREAD, my, -DEPTH).normalize();

    // place discs; fade in/out at the horizon, and hide the body that's "off duty"
    const R=this._DISC_R;
    if(this.sun){ this.sun.position.set(sd.x*R,sd.y*R,sd.z*R);
      this.sun.material.opacity=sunUp?smoothstep(-0.01,0.08,sy):0; this.sun.visible=this.sun.material.opacity>0.01; }
    if(this.moon){ this.moon.position.set(md.x*R,md.y*R,md.z*R);
      this.moon.material.opacity=!sunUp?smoothstep(-0.01,0.08,my)*0.95:0; this.moon.visible=this.moon.material.opacity>0.01; }
    if(this.stars){ const tw=cam?0.78+0.22*Math.sin(this.phase*900):1; this.stars.material.opacity=P.st*tw; this.stars.visible=P.st>0.02; }

    // directional light follows whichever body is up; intensity fades to ~0 at the horizon
    // so the sun->moon hand-off at dawn/dusk is invisible (both near 0 there).
    if(this.dir){
      const elev=sunUp?sy:my, bdir=sunUp?sd:md, max=sunUp?2.2:0.55;
      this.dir.color.copy(P.dir);
      this.dir.intensity=max*smoothstep(0.0,ELEV*0.72,elev);
      // keep the shadow direction up off the horizon so raking shadows stay bounded
      const ey=Math.max(bdir.y,0.34);
      const t=this._tmpTgt.copy(this.dir.target.position);
      this.dir.position.set(t.x+bdir.x*100, t.y+ey*100, t.z+bdir.z*100);
    }

    // drift + bob the clouds; fade at the X edges so the wrap never pops
    if(dt!==undefined){
      const halfX=this._cloudCfg.halfX, base=this._cloudCfg.opacity*P.co;
      for(const c of this.clouds){
        c.position.x += c.userData.spd*dt;
        if(c.position.x> halfX) c.position.x -= 2*halfX;
        if(c.position.x<-halfX) c.position.x += 2*halfX;
        c.position.y = c.userData.baseY + Math.sin((this.phase*this.dayLength)*c.userData.bobS + c.userData.bobP)*c.userData.bobA;
        // yaw to face the camera (group already follows the camera, so face the origin)
        c.rotation.y=Math.atan2(-c.position.x, -c.position.z);
        const edge=smoothstep(0,0.18,1-Math.abs(c.position.x)/halfX);   // 0 at the wrap seam
        c.material.color.copy(P.ct); c.material.opacity=base*edge;
        c.visible=c.material.opacity>0.01;
      }
    }
  },

  // map the day phase to a wall-clock reading (sunrise = 06:00, so noon=12:00,
  // sunset=18:00, midnight=00:00). Returns 12h + 24h forms and hand angles for a face.
  clock(){
    const t=(this.phase*24+6)%24;
    const h24=Math.floor(t), m=Math.floor((t-h24)*60);
    let h12=h24%12; if(h12===0)h12=12;
    return { h24, m, h12, ampm:h24<12?'AM':'PM', isDay:this.phase<0.5,
      hhmm:h12+':'+String(m).padStart(2,'0'),
      hourDeg:((h24%12)+m/60)*30, minDeg:m*6 };
  },
  setTime(p){ this.phase=((p%1)+1)%1; if(this.ready)this._apply(0); return this.getTime(); },
  getTime(){ const labels=[[0.05,'dawn'],[0.20,'morning'],[0.34,'noon'],[0.46,'afternoon'],[0.52,'sunset'],[0.66,'dusk'],[0.92,'night'],[1.01,'pre-dawn']];
    let l='night'; for(const[a,n]of labels){ if(this.phase<a){l=n;break;} }
    return {phase:+this.phase.toFixed(3), label:l, dayLength:this.dayLength}; },
  setDayLength(s){ this.dayLength=Math.max(8,+s||1440); return this.dayLength; },
};
