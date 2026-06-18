---
name: papercraft-asset
description: Generate and render papercraft NPCs and environments for project-shanni-happy — chibi → transparent cutout → cream die-cut → SceneSpec → flat scene render → live Three.js preview. Use when adding a character, prop, or environment, or when the user asks to make/show game art.
---

# Papercraft asset pipeline

The locked look: flat, minimal, clean Paper-Mario papercraft. One static graphic per
NPC; all animation is the paper physically moving. NOT realistic/anime/noir. Keep
palettes pastel and low-contrast; props get a cream die-cut border to match Shen.

All tooling lives in `studio/` and uses the venv at `studio/.venv`. First run:
`python3 -m venv studio/.venv && studio/.venv/bin/pip install -r studio/requirements.txt`

## 1. New character cutout

1. Generate a standing chibi in Gemini/Imagen on a FLAT solid background (kawaii, the
   locked outfit; phrase prompts to avoid minor-safety filters — "petite young woman /
   chibi mascot doll"). Save into `studio/refs/`. The Gemini key comes from 1Password
   (`set -a; source ~/.secrets.env; set +a`) — never commit it.
2. Cut it out + add the die-cut border:
   `studio/.venv/bin/python studio/cutout.py studio/refs/<name>.png`
   → writes `studio/out/shen-cut.png` (transparent) + `studio/out/shen-paper.png`
   (cream border). Prints aspect + foot-baseline ratio — note these for placement.

## 2. Environment scene

A scene is a **SceneSpec** (pure data), rendered by `env_render.py`:
```
{ name, palette:{sky,ground,path,shadow},   # 6-digit hex, NO '#', pastel
  hills:[{color,xPct,widthPct,heightPct}],   # far, borderless
  clouds:[{xPct,yPct,scale}],
  props:[{type,xPct,scale,color?,color2?}],  # type: tree|bush|house|rock|flower
  shen:{xPct,scale} }                         # xPct 38-62, scale 0.85-1.0
```
- Render one spec:  `studio/.venv/bin/python studio/env_render.py spec.json out.png`
- Render demo:      `studio/.venv/bin/python studio/env_render.py --demo`
- Render WITHOUT Shen (for a Three.js backdrop): call `render(spec, out, draw_shen=False)`.
- To generate many distinct moods at once, run a Workflow design panel that returns
  SceneSpecs (schema-validated), save to `studio/specs/all.json`, then
  `studio/.venv/bin/python studio/env_sheet.py` builds a labeled contact sheet.

Props are 4–8, spread out, never crowding centre where Shen stands. Keep it calm.

## 3. Animate + preview live

The Three.js renderer (`studio/env-live.html`) uses an orthographic camera and a
deterministic `poseAt(t)` for the walk + jump-for-joy. The backdrop is the scene
rendered without Shen (`studio/out/env-bg.png`); Shen is a live animated billboard.

Serve and preview:
```
python3 -m http.server 8723 --directory studio   # or the `shen-refs` launch config
# http://localhost:8723/env-live.html
```
IMPORTANT: the Claude preview tab suspends `requestAnimationFrame`. Playback is driven
by a `setInterval` clock keyed off `performance.now()` (`__startAuto`). For deterministic
capture, call `__stopAuto()` then `__render(t)`.

## Showing the user

Inline `Read` of a single small PNG renders in the GUI; GIFs do NOT animate via Read,
and localhost URLs aren't reachable from the user's browser. To show motion live, use
the Claude preview pane pointed at the served HTML. The user often opens files directly.
