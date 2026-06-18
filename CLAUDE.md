# project-shanni-happy — working notes for Claude

A hands-free, voice-driven build of a small **flat papercraft** game. The user does
not hand-author art or code; everything is programmatic and driven through Claude Code.

## Locked art direction (do not drift)

Flat, minimal, **clean** Paper-Mario papercraft. NOT realistic, NOT anime, NOT noir
(noir was tried and dropped). "High fidelity" to this user = clean execution: no
clutter, no clashing colours, no stray lines/artifacts, calm negative space.

- One static graphic per NPC (chibi, generated in Gemini). The texture NEVER changes.
- ALL animation = the paper cutout physically moving: hop-walk (squash on contact,
  stretch in air, slight lean), jump-for-joy (crouch → launch → airborne apex with
  tilt-wiggle + pastel sparkles → fall → big squash → rebound), contact shadow that
  shrinks/fades with height. Personality is in the motion, not the texture.
- Character **Shen** = `studio/refs/shen-chibi-4.png` (pink bucket hat, round glasses,
  dark braids, dusty-rose jacket over gray tee, cream floral skirt).
- Environments use the same flat pastel paper set (flat bands, soft rounded hills,
  cream die-cut props, contact shadows). See the 6 mood specs in `studio/specs/all.json`.

## Renderers (two, by purpose)

- **PIL (`studio/env_render.py`)** — fast 2D iteration. `SceneSpec (data) -> PNG`.
  Used to explore environment concepts quickly. NOT the game engine.
- **Three.js (`studio/*.html`)** — the real renderer. Orthographic camera (flat
  papercraft → no perspective warp). `poseAt(t)` is a pure deterministic pose function.

### Three.js gotcha — preview playback

The Claude preview renders pages as a **background tab where `requestAnimationFrame`
is suspended** (frozen frame). Drive real-time playback with a `setInterval` clock
keyed off `performance.now()` instead (see `env-live.html` `__startAuto`). The shoot
scripts call `__stopAuto()` then `__render(t)` for deterministic capture.

## How to run

```sh
python3 -m venv studio/.venv && studio/.venv/bin/pip install -r studio/requirements.txt
python3 -m http.server 8723 --directory studio   # or the `shen-refs` launch config
```
Preview: `http://localhost:8723/env-live.html`. The asset pipeline is the
`papercraft-asset` skill (`.claude/skills/papercraft-asset/`).

## Conventions

- Python tooling lives in `studio/`, computes paths from `__file__` (repo-relative).
- Generated assets land in `studio/out/`. Keep the committed art (`shen-cut`,
  `shen-paper`, `env-bg`, concept sheets); intermediate frame dirs are git-ignored.
- Secrets: image gen uses the Gemini key from 1Password; **never commit keys**.
  `studio/.exec` is a machine-specific chrome path (git-ignored).

## Cameras — ALWAYS QA them (not optional)

Whenever you add, move, or tune a camera/zone, you MUST run the camera QA as part of
building it — it is part of "done", not a follow-up. Invoke the **`/zone-camera`** skill
(`.claude/skills/zone-camera/`) and enforce its cardinal rule:

> **Shen must be visible from every reachable spot and through every transition.**

Two design rules: **one fixed camera per zone** (never vary the angle by travel
direction — that flips the eye into a wall on reversal), and **contain the player** so
every reachable spot is inside a zone.

Workflow every time: author the camera → serve the worktree on localhost (never
`file://`) → in the preview run `cameraQA.static()`, `cameraQA.transition([a],[b])` for
cross-junction pairs, AND `cameraQA.path([...])` for **round-trips** (down a road and
back, up the stairs and back — reversals hit transitions a one-way sweep misses) →
`game.warp(x,z,true)` + screenshot any failure → fix → re-run until **0 failures**. A
camera change with unrun or failing QA is not finished. Reference + harness:
`studio/test-scene.html`.

## Status / next

- DONE: character cutout + die-cut; walk + jump-for-joy; 6 environment moods;
  pipeline migrated into the repo; **3D Paper-Mario game loop** (`studio/game.html`
  + `studio/js/sim.js`) — perspective follow-camera (Shen always centred),
  full-window responsive, 2D ground movement, depth-sorted billboard props
  (walk behind/in front), d-pad + keyboard, 6 collectible flowers; `/deploy` skill
  + GitHub Pages. **Live: https://metroxe.github.io/project-shanni-happy/**
- NEXT (ideas): NPCs with dialogue (via the papercraft-asset pipeline); more
  zones/goals; sound; idle polish. A `/done` skill was discussed but isn't needed
  yet (work happens directly on `main`, not in worktrees).
