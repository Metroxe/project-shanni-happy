---
name: papercraft-asset
description: Generate and render papercraft NPCs and environments for project-shanni-happy — chibi → transparent cutout → cream die-cut → SceneSpec → flat scene render → live Three.js preview. Use when adding a character, prop, or environment, or when the user asks to make/show game art.
---

# Papercraft asset pipeline

The locked look: flat, minimal, clean Paper-Mario papercraft. One static graphic per
NPC; all animation is the paper physically moving. NOT realistic/anime/noir. Keep
palettes pastel and low-contrast; props get a cream die-cut border to match Shen.

**Foreground = model it, don't paint it.** Build foreground structure (a storefront's
sign, awning, window frames, door) as separate modeled paper pieces, not as one big
texture across a wall, and keep the kit small (no fussy mullions/brick/trim). Texture
carries only flat pastel grain; in-world signs go on their own die-cut board, never baked
into a wall. The how-to (decompose `facadeTex`, `makeFacade`/`makeSign`, uniform texel
density) lives in the **`papercraft-texture`** skill; QA it at real resolution per the
**`papercraft-env-qa`** gate.

All tooling lives in `studio/` and uses the venv at `studio/.venv`. First run:
`python3 -m venv studio/.venv && studio/.venv/bin/pip install -r studio/requirements.txt`

## 1. New character cutout

1. Generate a standing chibi on a FLAT solid background (kawaii mascot doll; full body,
   feet visible; phrase prompts to avoid minor-safety filters — "petite young woman" /
   "chibi mascot doll" / "adult man as a cute mascot doll"). Pass `shen-chibi-4.png` as a
   `--ref` so the new character matches Shen's exact style/line-weight/palette/mint-bg.
   Use `studio/gen_image.py` (writes into `studio/refs/`):
   ```sh
   set -a; source ~/.secrets.env; set +a   # OP_SERVICE_ACCOUNT_TOKEN
   export GEMINI_API_KEY="$(op item get s66drdsfeobdn5brqel5kvdtta \
       --vault Christopher-Macbook-CLI --fields label='API Key' --reveal)"
   studio/.venv/bin/python studio/gen_image.py -o studio/refs/<name>-1.png \
       -p "<prompt>" --ref studio/refs/shen-chibi-4.png --aspect 3:4
   ```
   Default model `gemini-3-pro-image`. Fan out a few variants (parallel calls to different
   `-o` paths) and pick the cleanest, buffest/cutest, feet-flat one. Never commit the key.
2. Cut it out + add the die-cut border (optional 2nd arg = output name, defaults `shen`):
   `studio/.venv/bin/python studio/cutout.py studio/refs/<name>-1.png <name>`
   → writes `studio/out/<name>-cut.png` (transparent) + `studio/out/<name>-paper.png`
   (cream border). Prints aspect + foot-baseline ratio — note these for placement.

   NOTE: a reference photo inside the macOS Photos library can't be read from bash (TCC
   blocks `cp`/`sips`/`qlmanage`). Ask the user to drag it into chat or export it to
   `studio/refs/`; then pass it as an extra `--ref` for a closer likeness.

### NPC + dialogue

Drop a new NPC into `studio/specs/world.json` under `npcs[]`:
`{name, tex:"out/<name>-paper.png", x, z, h, dialogue}`. The dialogue is a node graph
`{start, nodes:{id:{text, speaker?, next?, choices:[{label,next}]}}}` — `speaker` defaults
to the NPC name (use the player's name "Shen" for player lines); a node with `choices`
opens a menu, else `next` advances, else the line ends the conversation. The engine
(`studio/js/dialogue.js`) + `game.html` handle proximity, the box, and input.

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

## 4. Pose set — discrete swap animation (no tween)

For the rare character that needs to *change its drawing* (Chrees curling a dumbbell,
not just squashing), give it a SMALL set of pose images the engine **hard-swaps**
between — instant, Paper-Mario style, never a tween. The squash/hop/breathing transforms
keep running on whichever image is shown; the swap is just the picture.

1. Generate each pose with `gen_image.py`, passing the character's OWN existing image as
   an extra `--ref` (identity lock) and prompting ONLY the pose change. Keep the action
   from rising above the head (a curl, not an overhead press) — registration anchors on
   feet→crown. Flat mint background as usual. Fan out variants, pick the cleanest.
2. `cutout.py <src> <name>-<pose>` per pose → `out/<name>-<pose>-cut.png`.
3. `register_poses.py <name> <pose1> <pose2> …` — normalizes the cuts onto ONE shared
   canvas + foot baseline + body scale, re-adds the die-cut border, writes
   `out/<name>-<pose>-paper.png` + `out/<name>-poses.json`, and runs the geometry QA
   (canvas / baseline / scale / crown identical across poses). Non-zero exit on drift.
4. `qa_vision.py <name> <pose1> <pose2> …` — the AI check: Gemini confirms same character,
   same size, only the action region differs. Ship a pose set only when BOTH pass.
5. In `world.json` give the NPC `poses:{name:"out/<name>-<pose>-paper.png", …}` + a
   `rep:{seq:[…], beat:<sec>, sfxOn:<poseName>}` loop. The renderer (`game.html`) preloads
   the textures and hard-swaps `mesh.material.map` on the beat. Sound it — every
   interaction makes a sound; the curl's is the `lift` SFX in `audio.js`, played at
   **proximity volume** (`proxGain` in `game.html`) so it's only audible when the player
   is near, never across the whole map.

## Showing the user

Inline `Read` of a single small PNG renders in the GUI; GIFs do NOT animate via Read,
and localhost URLs aren't reachable from the user's browser. To show motion live, use
the Claude preview pane pointed at the served HTML. The user often opens files directly.

## After building/placing — run the QA gate (required)

A new asset, prop, building, or world layout is NOT done until it passes QA. Adding
geometry repeatedly introduces the same bugs: z-fighting from overlapping/extending
geometry, stray cream outlines, the abyss past the map edge, "invisible circle"
colliders that block paths, props clipping or placed where they don't belong. So after
any placement:
- run **`/zone-camera`** (Shen visible from everywhere + every transition → 0 fails), and
- run **`/papercraft-env-qa`** (the picture battery + geometric overlap/reachability audits
  + multi-agent sweep) until clean.
The full failure-mode checklist is in CLAUDE.md ("World/asset QA gate") and the
`/papercraft-env-qa` skill. Do not `/deploy` a world/asset change that hasn't passed it.
