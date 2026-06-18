# Zone camera — reference

Companion to [SKILL.md](SKILL.md). Working implementation: `studio/test-scene.html` + `studio/specs/test-scene.json`.

## 1. Scene JSON schema

```jsonc
{
  "bounds": { "xmin":-28, "xmax":28, "zmin":-40, "zmax":6 },  // -> sim.setBounds(); fences the world
  "spawn":  { "x":0, "z":4 },
  "fog": [28, 64],

  // view-layer terrain ramps (sim.js never sees Y — it stays a pure 2D x/z + jump core)
  "ramps": [ { "id":"stairs", "axis":"z", "z0":-2, "z1":-22, "yLo":0, "yHi":4.0,
              "x0":-4, "x1":4, "treads":15, "color":"e7ded0" } ],
  "plateau": { "color":"dcd6cb" },

  // paper-box buildings; each ALSO emits a footprint collider chain
  "buildings": [ { "x":-6.5, "z":-8, "w":5, "d":28, "h":14, "color":"cbd6e2", "base":0 } ],

  // the cameras
  "zones": [
    { "id":"stairs",
      "center":[0,-13], "axisDeg":0,   // forward axis in XZ; 0 => (0,-1) "up the map" (−z)
      "halfLen":22, "halfWid":4.5,     // oriented-rect bounds for point-in-zone
      "height":3.4,                    // eye Y above local ground at the centerline point
      "back":8.5,                      // dolly distance behind the player along travel dir
      "side":0,                        // lateral nudge off the centerline (+ = axis-right)
      "lookAhead":2.0,                 // aim this far ahead of the player down the corridor
      "lookY":1.2,                     // aim height above local ground
      "fov":38, "pitchBias":-0.06,     // narrow fov compresses a stairwell; pitchBias = extra tilt (rad)
      "follow":5.5,                    // exp tracking rate (1/s) within the zone
      "blendIn":0.85 }                 // seconds to cross-blend when ENTERING this zone
  ],
  "collectibles": [ { "x":0, "z":-12 } ]
}
```

**Axis convention** (matches `faceYaw`'s `atan2(dx,dz)`): `axisDeg=0` → forward `(0,-1)` (−z, up the map); `90` → `(1,0)` (east); `270` → `(-1,0)` (west). Axis-right = forward rotated +90° = `(-fz, fx)`.

**Zone design rules**
- **Spatially exclusive at junctions.** Give the neutral/corridor zone the center column; the side zones own only their arms. Then left↔right physically routes through the neutral zone (camera looks up the street, *then* swings) instead of whipping straight across the subject.
- **Cover every reachable cell.** Anything walkable but unzoned falls back to a far zone's rig → Shen off-screen. Contain the player instead (below).

## 2. Terrain + containment (why dead spots happen)

`groundHeight(x,z)` is a **view-layer** function (applied to Shen, her shadow, and the camera eye/target — sim stays 2D). It MUST agree with the built geometry or the character floats:

```js
function groundHeight(x,z){
  let y=0;
  for(const r of RAMPS){ if(r.axis!=='z')continue;
    if(z<=r.z1){ y=Math.max(y,r.yHi); continue; }   // plateau (north of ramp top): full height
    if(z>=r.z0) continue;                            // start area (south): base
    if(x<r.x0||x>r.x1) continue;                     // OFF-CORRIDOR flank: base  <-- gate or Shen floats
    const t=(z-r.z0)/(r.z1-r.z0);
    y=Math.max(y,r.yLo+(r.yHi-r.yLo)*smooth(t)); }
  return y;
}
```

Build matching geometry: a base ground plane (y0), solid step boxes over `x∈[x0,x1], z∈[z0,z1]`, and a raised plateau box for `z<=z1`. **Containment = the camera's safety net:** the reachable set (collision-aware flood fill) must equal the zoned set. Extend skyscrapers to wall the start, abut the road buildings (no gaps to slip behind), and cap `bounds` so the player can't reach unzoned/void terrain.

## 3. Camera per-frame (the important bit)

```js
function rigFor(zone,S){                        // ONE fixed camera per zone (no travel-direction sign)
  const {fx,fz}=zoneAxis(zone);
  const a=clamp(zoneLocal(zone,S.x,S.z).along,-zone.halfLen,zone.halfLen);  // player projected onto centerline (clamped)
  const cpx=zone.center[0]+fx*a, cpz=zone.center[1]+fz*a;                   // centerline point (no lateral term -> stable)
  const latx=-fz, latz=fx;                                                  // eye sits behind the zone AXIS, always
  return { pos:V3(cpx-fx*zone.back+latx*zone.side, groundHeight(cpx,cpz)+zone.height, cpz-fz*zone.back+latz*zone.side),
           tgt:V3(S.x+fx*zone.lookAhead, groundHeight(S.x,S.z)+zone.lookY, S.z+fz*zone.lookAhead),  // aims at the LIVE player
           fov:zone.fov, pitch:zone.pitchBias };
}

function cameraFrame(S,dt){
  const next=pickZone(S.x,S.z);
  if(activeZone && next!==activeZone){
    // snapshot the EYE only (smooth swing, no seam wobble); keep fromZone so the TARGET stays live
    blend={fromZone:activeZone, pos:CAMRIG.pos.clone(), fov:CAMRIG.fov, pitch:CAMRIG.pitch, t:0, dur:next.blendIn};
  }
  activeZone=next;
  let want;
  if(blend){
    blend.t+=dt; const u=easeInOutCubic(clamp(blend.t/blend.dur,0,1));
    const A=rigFor(blend.fromZone,S), B=rigFor(activeZone,S);
    want={ pos:blend.pos.clone().lerp(B.pos,u),   // EYE: snapshot -> new (no wobble on re-cross)
           tgt:A.tgt.clone().lerp(B.tgt,u),       // TARGET: live from-aim -> live new-aim (both ~the player => never off-screen)
           fov:lerp(blend.fov,B.fov,u), pitch:lerp(blend.pitch,B.pitch,u) };
    if(blend.t>=blend.dur) blend=null;
  } else want=rigFor(activeZone,S);
  const k=1-Math.exp(-activeZone.follow*Math.min(dt,0.05));   // frame-rate-independent damp
  CAMRIG.pos.lerp(want.pos,k); CAMRIG.tgt.lerp(want.tgt,k);
  CAMRIG.fov+=(want.fov-CAMRIG.fov)*k; CAMRIG.pitch+=(want.pitch-CAMRIG.pitch)*k;
  applyCamera();                               // cam.position/lookAt(target)/rotateX(pitch)/fov — see test-scene.html for guards
}
```

**Two invariants here:** (1) **one camera per zone** — `rigFor` takes no direction, so a corridor has a single angle and a reversal can't flip the eye onto the wrong side / into a wall (Case study C). (2) **blend = snapshot eye + live target** — freezing the *whole* rig lets a fast player outrun the aim → off-screen mid-blend (Case study A); snapshotting only the eye and lerping the two **live** targets keeps her centered the whole swing with no re-cross wobble.

**Controls are camera-relative** — map input to the live camera's ground-projected basis so ↑ = "into the screen" everywhere and it rotates smoothly as the camera blends:
```js
function camBasis(){ let fx=CAMRIG.tgt.x-CAMRIG.pos.x, fz=CAMRIG.tgt.z-CAMRIG.pos.z; const m=Math.hypot(fx,fz);
  if(m<1e-4){const a=zoneAxis(activeZone);fx=a.fx;fz=a.fz;} else {fx/=m;fz/=m;}
  return {fx,fz,rx:-fz,rz:fx}; }   // forward + screen-right
```

## 4. The QA harness (copy-paste)

Invariant: **Shen visible from every reachable spot and every transition.** Add this to the scene module (it needs `cam, S, SHEN_H, PLAYER_R, groundHeight, rigFor, cameraFrame, step, resolveInput, aiTarget, held`, the building meshes, and the collider list). `studio/test-scene.html` has it wired as `window.cameraQA` + `window.game.warp`.

```js
const _ray=new THREE.Raycaster();
function _reachable(step=1.0){                       // collision-aware flood fill from spawn
  const B=SCENE.bounds, seen=new Set(), out=[], key=(x,z)=>Math.round(x/step)+','+Math.round(z/step);
  const blocked=(x,z)=>{ if(x<=B.xmin||x>=B.xmax||z<=B.zmin||z>=B.zmax)return true;
    for(const c of SCENE_COLLIDERS){const dx=x-c.x,dz=z-c.z; if(dx*dx+dz*dz<(c.r+PLAYER_R)**2)return true;} return false; };
  const s=[[SCENE.spawn.x,SCENE.spawn.z]]; seen.add(key(s[0][0],s[0][1]));
  while(s.length){ const [x,z]=s.pop(); out.push([x,z]);
    for(const [dx,dz] of [[step,0],[-step,0],[0,step],[0,-step]]){ const nx=x+dx,nz=z+dz,k=key(nx,nz);
      if(seen.has(k)||blocked(nx,nz))continue; seen.add(k); s.push([nx,nz]); } }
  return out;
}
function shenVisible(opts={}){
  const minDist=opts.minDist??2.4;
  cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();  // GOTCHA: project() needs a fresh inverse; render() isn't called in QA
  const gy=groundHeight(S.x,S.z), chest=new THREE.Vector3(S.x,gy+SHEN_H*0.5,S.z);
  const c=chest.clone().project(cam);
  if(c.z>1) return {ok:false,why:'behind-camera'};
  if(Math.abs(c.x)>0.9||Math.abs(c.y)>0.9) return {ok:false,why:'off-screen'};      // body must be well inside frame
  if(new THREE.Vector3(S.x,gy+SHEN_H*0.95,S.z).project(cam).y>1.0) return {ok:false,why:'head-cut'};
  if(new THREE.Vector3(S.x,gy+0.1,S.z).project(cam).y<-1.0) return {ok:false,why:'feet-cut'};
  const dist=cam.position.distanceTo(chest);
  if(dist<minDist) return {ok:false,why:'too-close',dist:+dist.toFixed(2)};
  const dir=chest.clone().sub(cam.position), dlen=dir.length(); dir.normalize();
  _ray.set(cam.position,dir); _ray.far=dlen-0.4; _ray.near=0;
  if(_ray.intersectObjects(BUILDING_MESHES,false).length) return {ok:false,why:'occluded'};
  return {ok:true};
}
window.cameraQA={
  static:(step)=>{ const cells=_reachable(step), fails=[];
    for(const [x,z] of cells){ game.warp(x,z,true); const v=shenVisible(); if(!v.ok) fails.push({x:+x.toFixed(1),z:+z.toFixed(1),why:v.why}); }
    game.reset();
    return {cells:cells.length, fails:fails.length, byReason:fails.reduce((a,f)=>((a[f.why]=(a[f.why]||0)+1),a),{}), sample:fails.slice(0,30)}; },
  transition:(from,to,steps=700)=>{ game.warp(from[0],from[1],true);
    held.up=held.down=held.left=held.right=false; aiTarget={x:to[0],z:to[1]}; const fails=[]; let reached=false;
    for(let i=0;i<steps;i++){ S=step(S,resolveInput(),1/60); cameraFrame(S,1/60);   // step the sim BY HAND (preview throttles setInterval)
      const v=shenVisible(); if(!v.ok) fails.push({x:+S.x.toFixed(1),z:+S.z.toFixed(1),why:v.why});
      if(Math.hypot(S.x-to[0],S.z-to[1])<0.3){reached=true;break;} }
    aiTarget=null; game.reset();
    return {reached, fails:fails.length, sample:fails.slice(0,20)}; },
  path:(waypoints,steps=500)=>{ game.warp(waypoints[0][0],waypoints[0][1],true);   // multi-leg ROUND-TRIP, no reset between legs
    held.up=held.down=held.left=held.right=false; const fails=[];
    for(let w=1;w<waypoints.length;w++){ aiTarget={x:waypoints[w][0],z:waypoints[w][1]};
      for(let i=0;i<steps;i++){ S=step(S,resolveInput(),1/60); cameraFrame(S,1/60);
        const v=shenVisible(); if(!v.ok) fails.push({x:+S.x.toFixed(1),z:+S.z.toFixed(1),leg:w,why:v.why});
        if(Math.hypot(S.x-waypoints[w][0],S.z-waypoints[w][1])<0.3)break; } }
    aiTarget=null; game.reset();
    return {fails:fails.length, sample:fails.slice(0,20)}; },
};
```
And `game.warp(x,z,snap)` MUST call `applyCamera()` in the snap branch, or the sweep projects against a stale camera.

### Running it
1. `preview_start` the worktree localhost; navigate to the scene; poll `window.__ready` (the tab is slow — wait up to ~10s).
2. `cameraQA.static()` → fix until `fails:0`.
3. `cameraQA.transition(...)` for each adjacent pair AND the cross-junction pairs (left↔right, climb, road↔start) → fix until `0`.
4. **`cameraQA.path([...])` for round-trips** — down a road and back, up the stairs and back down, junction→left→junction→right. Reversals hit transitions a one-way sweep never sees. Don't skip this.
5. Eyeball it: `game.warp(failX,failZ,true)` then `preview_screenshot` for any failure before AND after the fix.

## 5. Fix patterns

| Symptom (QA `why`) | Fix |
|---|---|
| `off-screen` mid-transition | Snapshot **eye only**; keep the look-target on the live player (§3). Route left↔right through the neutral zone. |
| `off-screen` at rest, large area | **Containment** — wall the unzoned reachable region; an unzoned cell can't be framed. |
| `occluded` | Abut buildings (no gaps to walk behind); don't place a wall between a zone's eye and its road. |
| `too-close` | Raise `back`/`height`, or add camera-collision (raycast eye→player, pull the eye in / clamp the player away). |
| `behind-camera` / camera in a wall on reversal | A direction-dependent camera flipped the eye to the wrong side. **One fixed camera per zone** (drop the travel sign). |
| character floats / cliff | Gate `groundHeight` to the corridor x-extent and make the plateau underlie the whole road (§2). |

## 6. Case studies (real failures this scene hit)

**A. Left↔right transition lost Shen under/near the camera.** QA `transition([-16,-29],[16,-29])` flagged `off-screen` at x≈3–4.3. Cause: the blend snapshotted the whole rig, so the frozen aim lagged the fast player. Fix: snapshot eye only, lerp the two **live** targets → 0 fails. (This is the user's "it shouldn't go from left to right right away — look up the street first, then swing." Spatially-exclusive zones already route through the neutral pose; the framing fix made the swing keep her centered.)

**B. Walk behind a building at the road end — no transition, can't see Shen.** The static sweep reported 1603/1806 cells failing — the *reachable* area was far bigger than the *zoned* area (open flanks, start sides, gaps between buildings). Fix: containment — extend skyscrapers to wall the start, abut the road buildings, cap `bounds.zmax`. Reachable dropped to 485 cells, all passing.

**C. Walk left down a road, come back, walk right → camera dives behind a wall; and descending the stairs gave a "looking down" angle.** Both were one bug: a direction-dependent camera (`dirSign`) gave each zone TWO angles, and reversing flipped the eye to the other side — for the stairs that side is *inside the north buildings* (green-wall screenshot). A straight A→B sweep passed; `cameraQA.path([[0,-29],[-18,-29],[0,-29],[18,-29]])` and `transition([0,-30],[0,4])` (descend) caught it. Fix: **one fixed camera per zone** — `rigFor` lost its sign; the stairs always looks up, you walk toward the camera coming down. 0 fails.

Lessons baked into the harness: **flood-fill reachability first** (most "can't see Shen" bugs are uncontained spots, not camera math) and **always run round-trips** (`path`) — reversals are a different test than one-way crossings.
