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

## Status / next

- DONE: character cutout + die-cut, walk + jump-for-joy, 6 environment moods, live
  Three.js prototype (`env-live.html`), pipeline migrated out of `/tmp` into the repo.
- NEXT: promote baked backdrop props to individual 3D billboards (parallax /
  walk-behind); build the deterministic game loop (input → Shen movement); add
  `/done` (worktree cleanup) and `/deploy` (GitHub Action release) skills; web deploy.
