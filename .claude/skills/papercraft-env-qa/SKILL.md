---
name: papercraft-env-qa
description: >-
  Robust VISUAL QA for project-shanni-happy environments — capture a battery of
  screenshots (gameplay cameras + deliberate orbit/low/edge angles) and scrutinize
  them for visual inconsistencies that camera-QA can't catch: windows/props clipping
  the ground, stray outlines, overlaps, z-fighting, mis-oriented props, and the
  ABYSS (any sightline that hits the void). Use whenever you add/move/retexture
  buildings, props, surfaces, or terrain, or when the user says the world "looks
  off", has "clipping", "weird outlines", "overlaps", or "I can see off the edge".
  Pairs with /zone-camera (that proves Shen is VISIBLE; this proves the world LOOKS
  RIGHT). Run it before every deploy of an environment change.
---

# Papercraft environment visual QA

`/zone-camera` proves Shen is *visible* from everywhere. This skill proves the world
*looks right* from everywhere. They are different failures: a camera can frame Shen
perfectly while the frame is full of windows sunk into the road, a bush growing
through another bush, or the infinite void past the map edge.

## Cardinal rules (do not ship a build that violates these)

1. **Never the abyss.** At no reachable spot or camera angle may the player see off
   the edge of the world — no void, no horizon-with-no-city, no plateau drop-off into
   nothing. The city is always built *past* the playable edge. Where the player must
   be stopped, block them with a **believable in-world object** (a building, a
   construction barrier, a planter/hedge, a rail) and keep building the scene behind
   it. Open areas (a plaza) are **ringed by buildings** (Station-Square style), not
   fenced into emptiness. Far filler is the `buildBackdrop()` ring + fog.
2. **Stay on the locked look.** Flat, minimal, clean Paper-Mario papercraft. No
   clipping, no stray lines/artifacts, no clashing colours, calm negative space.

## Defect taxonomy — what to hunt in every shot

1. **ABYSS / VOID** — sightline to empty space / bare horizon / map-edge drop / gap in the surround.
2. **CLIPPING** — facade windows/doors sunk INTO or floating ABOVE the ground; props half-buried or floating; character clipping through a prop; buildings interpenetrating; stair rails clipping walls.
3. **Z-FIGHTING** — overlapping coplanar surfaces (road/plaza/sidewalk/path) showing a seam or shimmer.
4. **STRAY OUTLINES** — cream/white edge lines on rounded/small props (fountain, bushes, benches, awnings, lamps) that read as artifacts.
5. **OVERLAP** — props overlapping each other or poking into a building/wall.
6. **ORIENTATION** — a prop facing the wrong way (lamp head, bench, awning, a storefront facade/door not facing the street).
7. **SCALE / PLACEMENT** — mis-sized, floating, half-buried, or oddly placed.
8. **AESTHETIC** — clutter, clashing colour, anything off the calm clean pastel direction.

## Workflow (the robust loop)

1. **Serve + capture.** With the worktree server up (`.claude/serve.sh`), run the
   capture harness:
   ```sh
   node studio/qa_shots.mjs            # → studio/out/qa/*.png (+ index.json)
   ```
   It loads `game.html` headless at 1280×820 and shoots a fixed battery: every zone
   from its **gameplay camera** (`cameraQA.warp`) PLUS deliberate **freecam** angles
   (`window.__look` / `window.__freecam`) — a bird's-eye, an ABYSS-HUNT look outward
   at every map edge, flicker pairs, AND — critically — a **per-object close-up of
   EVERY placed prop and building** (driven by `window.__items()` → `studio/out/qa/props/`).
   **Rule: every single thing placed in a session gets its own screenshot and gets looked
   at.** Zone shots hide small per-object defects (a bench that reads as a sign, a prop
   facing the wrong way, one shrub clipping a wall); the per-object pass is what catches
   them. Add a viewpoint by editing the `GAMEPLAY`
   / `LOOKS` arrays in `qa_shots.mjs` (gameplay = `[name,x,z]`; look =
   `[name, tx,ty,tz, yawDeg,pitchDeg, dist]`). **When you add a new area/prop, add a
   shot for it** — especially a low outward angle to prove there's no void.

2. **Inspect — multi-agent sweep (the maximum-rigour default).** Fan out vision
   inspectors over the PNGs with the **Workflow** tool. Use the template
   `visual-qa.workflow.js` in this skill dir (edit the `DIR` constant to the absolute
   `studio/out/qa` path, then run via Workflow `{scriptPath: ...}`). It runs one
   inspector per zone group + three defect-class specialists that sweep ALL shots
   (abyss / clipping+zfight+outlines / orientation+overlap+scale), then a synthesis
   critic that dedups into one prioritized defect list and notes what's verified
   clean + what should be re-shot. Inspectors `Read` the image files (Read renders
   images), so pass absolute paths.
   - Lighter option: skip the fan-out and `Read` the shots yourself, but a single
     unfocused pass is exactly what misses these defects — prefer the sweep.

3. **Fix → re-capture → re-inspect** until the defect list is empty. Don't trust one
   clean pass; re-shoot after each fix (a fix can introduce a new clip/void).

## Movement & reachability QA (catch "invisible wall / can't get down the road")

Camera QA checks visibility of *reachable* cells — but a stray collider that walls off
a route silently **shrinks the reachable set** and stays green. And a prop/flower sitting
on the path can **freeze** the player (the 1.6s jump-for-joy on pickup) so it *feels*
blocked. So after any collider/world change, run the movement probes in the preview and
require them clean:

1. `cameraQA.reach([{name,x,z}…], 0.5)` — flood-fills from spawn at a FINE grid (real
   collider radii) and returns any **unreachable** landmarks. Pass every zone centre,
   each collectible, the NPC, and key waypoints. `unreachable` must be `[]`. (A blockage
   makes the far side unreachable — exactly what camera QA misses.)
2. `cameraQA.walk([fromX,fromZ],[toX,toZ])` — drives the CONTINUOUS player (real
   `step()`/collision) along a STRAIGHT segment. Returns `reached`, `stuckAt` (a true
   collider block — investigate it), and `joyFreezes` (spots where a pickup locked
   movement on the path). `stuckAt` must be null and `joyFreezes` empty on every main
   corridor. (Straight-line only — it can't turn corners; probe each leg of an L, or use
   `cameraQA.path` waypoints for the camera side.)
3. `window.__colliders(x,z,rad)` — list solid colliders near a point to identify the
   offending circle directly (it reports each `{x,z,r}`).
4. `window.__overlaps()` — **footprint-overlap audit**: returns every pair of building /
   stair footprints that intersect. This is the deterministic detector for **z-fighting
   flicker** (overlapping coplanar walls fight for depth → shimmer when the camera moves)
   AND **clipping** (e.g. a shop intersecting the stairs). Must return `[]`. `qa_shots.mjs`
   runs this + `reach` automatically and prints `✓ geometry audit clean` or the offenders.
5. **Flicker pairs** — `qa_shots.mjs` shoots `flick_*_a`/`flick_*_b`: the same view at a
   hair-different camera angle. z-fighting flips its winner between the two frames, so a
   pair that differs anywhere but the tiny shift = flicker. (Best caught by `__overlaps`,
   but the pair confirms visually.) A single still can't show flicker — that's why this exists.

**Two real bugs this caught (don't reintroduce):**
- **Coarse box colliders.** A box footprint must become a TIGHT perimeter ring of small
  (~0.55) circles (`pushBoxColliders`). The old `r = 0.5·min(w,d)` made **r=2** circles
  for a depth-4 building that bulged ~2u past the corners INTO the road — an invisible
  wall. Small overlapping perimeter circles hug the footprint (≤r bulge) and still seal.
- **Pickups on the path.** A collectible (or any pickup that triggers the joy freeze)
  placed dead-centre on a corridor forces a 1.6s movement lock every pass — reads as
  "blocked". Keep collectibles OFF the forced centre-line (sidewalk/edge), so grabbing
  them is a choice. `cameraQA.walk(...).joyFreezes` flags any that aren't.

## Known root causes (fix at the source, in `studio/game.html`)

- **Windows/facade in the ground** → a building's `base` must equal the LOCAL ground
  height (`groundHeight(bd.x,bd.z)`), and the facade panel must span `base..top`
  (height `h`), not `0..top`. On the raised upper level that's a 4.5-unit sink if wrong.
- **Stray cream outlines** → `M(geo,col,flat,edge)` adds a cream `EdgesGeometry` when
  `edge=true`. Keep edges only on big flat die-cut shapes (building masses); pass
  `edge=false` for rounded/curved/small props (spheres, cylinders, awnings, benches,
  rings, surfaces, stairs).
- **Z-fighting on the ground** → give each surface kind a DISTINCT `y` epsilon
  (`SURF_EPS` map) so overlapping road/plaza/sidewalk never share a plane; a `lift`
  field nudges one L-leg of road above the other at a junction.
- **Lamp facing the wrong way** → make orientation-independent props symmetric (lamp =
  post + globe ON TOP, no side arm). Otherwise drive a per-prop `rot` in `world.json`.
- **Clip through a prop (slide, climber)** → a prop maker returns a `cols:[{dx,dz,r}]`
  list so its solid parts each get a collider (not one centre circle the player walks through).
- **Rails clipping walls** → keep stair banisters INBOARD of the corridor (x0+margin / x1−margin).
- **Abyss** → `buildBackdrop()` rings the map with filler buildings beyond the bounds
  (extra pad on the side a camera dollies toward, so backdrop never sits between the
  camera and the play space); plaza is ringed by real buildings; roads end in
  buildings or a `barrier` prop with city visible beyond.
- **Z-fight squares / darker patch on a park-edge building wall.** A building box must
  NOT extend below its `base` (`bottom = base`, no downward extension). The old `base-3`
  extension pushed park-edge shop boxes down INTO the sunken-park retaining wall (same
  z-plane) → coplanar walls fighting for depth = mottled off-colour squares + a darker
  band. `__overlaps()` only checks *horizontal* footprints, so it misses this *vertical*
  overlap — the fix is structural (never extend a box below its ground).
- **Props that don't belong / overlap.** Bushes scattered on a roadway read as wrong —
  streets get lamps + street TREES (tree-lined), not loose bushes; keep park-style
  greenery in the park. Space benches/trees/bushes apart (≥~3u) so they don't visually
  interpenetrate, and keep benches off the dead-centre of corridors. The `placement` lens
  in the sweep + a careful look at each `cam_*` shot catches these.
- **A camera dollying INTO a building** (occlusion that only shows in motion) → that
  building sits where the zone camera's `back` puts it; move the building out of the
  camera's dolly path or shrink `back`. Use the `byOcc` field that `cameraQA.path`
  now reports (it names the occluding building) to find the culprit instead of guessing.

## Debug hooks (added to game.html for QA)

- `window.cameraQA.warp(x,z)` — snap the gameplay camera to a spot.
- `window.cameraQA.static() / .path([...]) / .transition([a],[b])` — Shen-visibility QA;
  `.path`/`.transition` report `byOcc` = which building occluded, per zone.
- `window.__freecam(px,py,pz, tx,ty,tz)` — free look (stops the auto loop, renders one frame).
- `window.__look(tx,ty,tz, yawDeg,pitchDeg, dist)` — orbit a target at an angle+distance.
