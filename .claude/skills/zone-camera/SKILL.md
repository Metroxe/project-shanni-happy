---
name: zone-camera
description: Author and QA the zone/centerline cameras for the project-shanni-happy papercraft game (studio/*.html, Three.js). Enforces the cardinal rule — Shen is visible from EVERY reachable spot and through EVERY transition. Use when adding/placing/tuning a camera or zone, designing how the camera moves between areas, debugging a spot where the character is hidden/off-screen/clipped/under-the-camera, or when the user says "QA the cameras", "place a camera", "the camera can't see Shen", or "test the camera".
---

# Zone camera + QA

The game uses **authored zone cameras** (Resident-Evil-style, but smooth-blended and player-tracking), NOT a free follow-cam. Working reference: `studio/test-scene.html` + `studio/specs/test-scene.json`. Schema, camera math, and the copy-paste QA harness live in [REFERENCE.md](REFERENCE.md).

## The cardinal rule

> **Shen must be visible from every spot the player can reach, and through every camera transition.** No dead spots — not under the camera, not behind a building, not mid-swing.

A camera change is **not done until QA passes with 0 failures.** Author → QA → fix → re-QA.

## Camera model (one paragraph)

Each **zone** is an oriented rectangle (`center, axisDeg, halfLen, halfWid`) plus a camera recipe (`back` dolly, `height`, `lookAhead`, `lookY`, `fov`, `pitchBias`). Inside a zone the camera rides the corridor centerline, sits `back` behind the player along the travel axis, and looks down it. Crossing a boundary starts a **blend**: snapshot only the current **eye** (smooth, no wobble) but keep the look-**target tracking the LIVE player** (so she never drops off-screen mid-swing); ease over `blendIn` seconds + an exp damp. Controls are camera-relative (↑ = where the camera looks). Movement + collision stay in pure `js/sim.js`; terrain height and camera are view-layer only.

## Add / tune a camera — checklist

1. Add the zone to the scene JSON `zones[]` (schema in REFERENCE.md).
2. **ONE fixed camera per zone — no directional variants.** The camera angle depends only on the zone, never on travel direction. Descending a corridor keeps the same look-up angle; you just walk *toward* the camera. (A zone with two angles = a reversal swings the camera through a wall — the exact bug this caused.)
3. **Spatially exclusive at junctions:** the neutral/corridor zone owns the center so left↔right routes *through* it (camera pulls back to look up the street, then swings) — never swing straight across.
4. **Containment:** every reachable spot must lie inside some zone. Wall off anything unzoned (extend buildings, abut them, cap bounds). An unzoned reachable cell is a guaranteed dead spot.
5. Tune feel with `back`/`height`/`fov` (framing) and `blendIn` (swing speed).
6. **QA until 0 failures** (next section).

## QA workflow

Serve the worktree on localhost (never `file://`), open the page in the preview, wait for `window.__ready`, then run in `preview_eval`:

```js
cameraQA.static()                              // snap camera at EVERY reachable cell -> {cells, fails, byReason, sample}
cameraQA.transition([fromX,fromZ],[toX,toZ])   // walk A->B deterministically, checking visibility every blend frame
cameraQA.path([[x,z],[x,z],...])               // walk a multi-leg ROUND-TRIP continuously (reversals!)
```

- **static** flood-fills the reachable area (collision-aware) and reports every spot where Shen isn't visible: `off-screen` / `behind-camera` / `too-close` / `occluded`.
- **transition** manually steps the sim (the preview tab throttles `setInterval`, so wall-clock driving is unreliable) and checks visibility through the whole blend. Run the worst pairs: left↔right (through the junction), climb, road→start.
- **path** is the one people forget: drive **round-trips** (down a road and back, up the stairs and back down) in one continuous motion. Reversals exercise different transitions than a straight A→B and are where cameras dive behind walls. Always include them: e.g. `cameraQA.path([[0,-29],[-18,-29],[0,-29],[18,-29],[0,-29]])`.
- For each failure: `game.warp(x,z,true)` to the spot, `preview_screenshot`, see what's wrong, fix, re-run. Target = **0**.

Harness gotchas (keep them if you port it to game.html): `project()` needs a fresh `cam.matrixWorldInverse`; `warp(snap)` must call `applyCamera()`; the transition sweep must step the sim by hand. All three are in REFERENCE.md.

## Where to hunt for pain points

- **Reversal / round-trip** — walk down a corridor and come back, or up the stairs and back down. If a zone's camera depends on travel direction it swings through a wall on the turnaround. → one camera per zone; test with `cameraQA.path()`.
- **Under / very close to the camera** — near a zone's `back` point, or where two zones' eyes nearly coincide → `too-close`.
- **Mid-transition** — the swing passing over the subject → snapshot eye but track the live player; route left↔right through the neutral zone.
- **Occlusion** — a reachable spot with a wall between camera and Shen → abut buildings (no gaps), raycast check.
- **Unzoned reachable area** — flanks, start sides, corners, corridor/road ends → containment + tighter bounds.
- **Ends of corridors/roads** — can you walk past the last building into the void? → bounds + end walls or fog.

See REFERENCE.md "Case studies" for the two real failures this scene hit and how QA caught + fixed them.
