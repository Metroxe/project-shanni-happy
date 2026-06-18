# project-shanni-happy

A small, hand-built game with a **flat papercraft** look — every character is one
static Paper-Mario-style cutout, and all animation is the paper *physically* moving
(hops, squash/stretch, jump-for-joy). Built hands-free through Claude Code.

The character is **Shen** (pink bucket hat, round glasses, dark braids, dusty-rose
jacket, cream floral skirt).

## Layout

```
studio/                 asset + scene studio (tooling, art, web prototype)
  cutout.py             chibi -> transparent cutout + cream die-cut paper border
  env_render.py         SceneSpec (data) -> flat papercraft scene PNG  (pure PIL)
  env_sheet.py          render all SceneSpecs into a labeled contact sheet
  shoot_paper.mjs       Playwright headless frame capture (gif/mp4 export)
  strip.py              assemble captured frames into labeled filmstrips
  paper-shen.html       Three.js: Shen cutout + walk + jump-for-joy (deterministic)
  env-live.html         Three.js: a scene backdrop + animated Shen (the prototype)
  refs/                 chibi candidates (chosen: shen-chibi-4)
  specs/all.json        the 6 environment "mood" SceneSpecs
  out/                  generated assets (shen-cut, shen-paper, env-bg, concepts)
.claude/
  skills/papercraft-asset/   the repeatable asset pipeline, as a skill
  launch.json                preview server (python http.server on :8723)
```

## Quickstart

```sh
# one-time: python deps for the renderer
python3 -m venv studio/.venv
studio/.venv/bin/pip install -r studio/requirements.txt

# render the demo scene
studio/.venv/bin/python studio/env_render.py --demo

# serve the studio and open the live prototype
python3 -m http.server 8723 --directory studio
#  -> http://localhost:8723/env-live.html   (animated)
#  -> http://localhost:8723/paper-shen.html (character only)
```

## Art direction (locked)

Flat, minimal, clean papercraft — **not** realistic/anime/noir. "High fidelity"
means clean execution: no clutter, no clashing colours, balanced composition.
One static graphic per NPC; personality lives in the paper's motion. See
`.claude/skills/papercraft-asset/SKILL.md` and the project memory note
`art-direction-papercraft`.

## Notes

- Image generation (chibi/refs) uses the Gemini API key from 1Password — **never
  committed**. `studio/.exec` (chrome path for Playwright) is machine-specific and
  git-ignored.
- The renderer is deterministic: `(SceneSpec) -> image` and `poseAt(t) -> pose`,
  which keeps the door open for a deterministic game sim.
