---
name: papercraft-texture
description: Generate crisp, seamless, on-aesthetic surface textures for project-shanni-happy (paper grain, walls, ground, props) and wire them into the Three.js scene so they are NOT blurry or stretched. Use when textures look blurry/low-res/stretched/tiled, when adding a material to a building/ground/prop, or when the user asks to improve the look/fidelity of the world surfaces.
---

# Papercraft surface textures

Locked look (do not drift): flat, minimal, **clean** Paper-Mario papercraft — pastel,
low-contrast, calm. Texture here adds **tactility, not clutter**: you should feel the
paper, never notice a pattern. If a texture reads as "busy," it's wrong for this game.

This skill does two things the in-engine `paperTex()` does not:
1. **Bakes crisp, seamless, high-res tiles** (vs a 256px canvas) — color + bump + normal.
2. **Wires them with uniform texel density** so nothing stretches or blurs (the real bug).

## The diagnosis (why it looks bad now)

`studio/game.html` `paperTex()` = 256px canvas, every `paperMat()` uses a fixed
`repeat 1.6×1.6`, and `BoxGeometry` UVs are 0..1 per face. A 28m×14m framing wall then
smears 1.6 tiles of a 256px image across it (blurry) and stretches the grain ~2×
horizontally (density differs per face). **Both are fixed below.** Full detail +
drop-in code: **[three-wiring.md](three-wiring.md)** — read it before touching materials.

## Model foreground detail, do not paint it

Before reaching for a texture, decide **model vs paint**. **Foreground** = any surface the
player can stand within ~12u of (here that is nearly everything inside the bounds: every
building on the plaza / street / park, and every prop). For foreground, any feature that is
a distinct **plane or volume with a readable edge** at gameplay distance (sign board,
awning lip, window frame + recessed pane, door, ledge) becomes its **own thin papercraft
box or plane**, offset off the wall by 0.02..0.08u (the `addFacade` `off=0.05` pattern), so
it stays sharp on its own geometry and never depends on texel density. **Texture only** the
flat wall grain, the distant `buildBackdrop()` ring, and surfaces under fog. One-line test:
**if you can NAME it (a sign, a window, a door) model it; if you can only FEEL it (grain,
mottle) texture it.**

Concretely, replace the baked `facadeTex` canvas in `addFacade` with a
`makeFacade(bd,base,top,dir)` group built like `makeBush`/`makeTree` (a group of `M()`
primitives): a plain **wall box** on the shared paper map at uniform density
(`worldUV(...,0.18)`), a separate **sign board** (see the in-world text section below), the
**awning box** (already there, at `base+h*0.80`, `off=0.05`), each upper window as a small
recessed **pane box** (window colour) inside a slightly larger **frame box** (trim colour)
placed with the existing `facadeTex` `cols2`/`rows` math inset ~0.04, and a **door box** on
the middle bay. Each piece is `M(geo,'#'+hex,false,false)` so it samples the one shared
paper grain and carries **no** stray cream edge (`edge=false`).

**Keep the kit SMALL** (sign, awning, window frames, door): do NOT model mullions, brick
courses, trim moulding, or per-window variation, or the calm flat front turns fussy.
Texture stays the default for flat grain; model only **nameable structure**. And prefer
**small shared tiles tinted per mesh** over a big bespoke per-item texture: one
`loadPaper()` set, `worldUV` everywhere (`DENSITY` 0.18 reps/m, about 185 texels/metre on
every foreground face), with a single large/unique texture reserved for the **backdrop
only**, never a foreground item.

> Performance: decomposing 12+ facades into wall + sign + awning + a window-frame row + door
> (× up to 2 faces) raises draw-call + collider count. If `smoke` or frame rate regresses,
> merge each building's static facade geometry (`BufferGeometryUtils.mergeGeometries`) and
> keep colliders on the wall box only.

## Path 1 — procedural paper (default; perfectly tileable)

Best for the base paper surface (walls, ground, plateau, stairs). Periodic-by-construction
so there is **no seam, ever**. Tunable grain.

```sh
studio/.venv/bin/python .claude/skills/papercraft-texture/gen_paper.py \
    --out studio/out/textures/paper --size 1024 --seed 7
# tuning: --mottle (broad cloud) --fiber (directional streaks) --grain (fine tooth)
#         --contrast (overall strength; keep LOW for this aesthetic, ~0.10–0.16)
#         --tint <hex> only if you want a baked colour (usually leave neutral, tint in JS)
```
Writes `<out>_color.png`, `_bump.png`, `_normal.png` and prints a numeric seam proof.
Commit the chosen set under `studio/out/textures/` (small PNGs; keep like the other
committed art). Then wire per [three-wiring.md](three-wiring.md).

**Make a few seeds, pick the calmest.** Verify by tiling 2×2 and eyeballing the joins
(or trust the printed seam metric).

## Path 2 — Gemini surface (for richer/patterned materials)

For a specific material (woven-paper roof, corrugated card, painted plaster, fabric awning)
use image-gen, then **force it tileable** + verify. Get the key via the **`gemini-key`**
skill (sets `GEMINI_API_KEY`), then:

```sh
studio/.venv/bin/python studio/gen_image.py -o studio/refs/tex-roof-1.png --aspect 1:1 \
    -p "flat lay of a single sheet of <material>, soft even studio light, pastel, matte,
        no objects, no shadows, fills frame, tileable seamless texture, top-down"
studio/.venv/bin/python .claude/skills/papercraft-texture/make_tileable.py \
    studio/refs/tex-roof-1.png studio/out/textures/roof_color.png --feather 48
```
`make_tileable.py` prints PASS/FAIL on the seam metric — if FAIL, raise `--feather` or
regenerate (don't ship a visible seam, same rule as the music loop). Image-gen has no
bump/normal; derive a bump from luminance or pair it with the procedural normal.

## In-world text: a dedicated sign board, not baked into the wall

**Never** bake sign text into the wall-spanning facade texture. The old `facadeTex`
`fillText(f.sign,…)` at ~48px/metre stretches and smears the words across the 28m face.
**Default strategy:** render each sign string into its **own** canvas sized to the sign's
**world span** at ~**220 px/metre × `devicePixelRatio`** (cap canvas width at ~2048px),
mounted on a **separate thin board box** floating ~0.05u off the wall over the old sign band.
A separate cut-paper sign reads *more* papercraft than text embedded in plaster, and it
decouples text sharpness from wall resolution.

Add `makeSign(text, boardW, boardH, {bg,fg,font})` beside `makeBush`/`makeTree`: a thin
board box plus a front-face `CanvasTexture` sized
`cw = Math.min(2048, Math.ceil(boardW*220*devicePixelRatio))`,
`ch = Math.ceil(boardH*220*devicePixelRatio)`; fill the sign-bg, then `fillText` centred at
font ~`ch*0.5` px, baseline middle, **shrink-to-fit with margins** so a narrow shopfront
does not overflow and a wide one keeps negative space; `CanvasTexture` with
`colorSpace=SRGBColorSpace`, `anisotropy=renderer.capabilities.getMaxAnisotropy()`, mipmaps
on. `makeFacade()` builds it from `f.sign`, sized to `faceLen` on the sign band
(~`base+h*0.90`, over the old sign strip, between the awning and the face top). The
`world.json` `f.sign` strings are unchanged, so no data migration.

**Why a board (not MSDF, not letters):** only ~12 short fixed strings and the camera never
gets nose-close, so one crisp board per sign is sharp at gameplay distance with zero new
shader plumbing. Upgrade to **MSDF** (a distance-field glyph atlas, e.g. `troika-three-text`)
only if a sign must stay razor-sharp at extreme zoom or scale dynamically; reserve **modeled
cut-paper letters** for one or two hero signs. A deliberate die-cut cream rim is allowed
**only** on the sign board; if it ever reads as the stray-outline artifact the env-QA skill
fights, fall back to `edge=false`.

## Definition of "good" (the bar to hit)

- **Crisp** at gameplay distance (read it in `preview_screenshot`, not your assumption).
- **Seamless** — no tile lines when walking a round-trip past repeated surfaces.
- **Uniform density** — same grain scale on a tall thin tower and a long low wall.
- **On-aesthetic** — subtle, pastel, matte; adds paper tactility, not visual noise.
- **Cheap** — share one map set across many tinted materials; mipmaps + max anisotropy on.
- **Modeled-first in the foreground**: structure (signs, windows, awnings, doors) is
  separate paper geometry, not painted into one facade texture; texture carries only flat grain.
- **Small shared tiles over big bespoke ones**: one tinted map set for all foreground boxes;
  large or unique textures only in the unreachable backdrop.
- **Blends with neighbours**: an adjacent surface shares the tile set, matches
  texels-per-metre and grain scale, aligns UV phase in world space, and keeps tints in the
  pastel family (no clashing abutment).

## Verify (every time — do not assume)

1. Serve the worktree (`.claude/serve.sh`) and `preview_screenshot` a wall close-up and a
   wide shot.
2. Confirm crisp + uniform + seamless against the bar above; iterate density/contrast.
3. **Texture-at-resolution**: screenshot every changed surface at the **closest** gameplay
   distance the player can reach it (not just a wide shot), and each sign **straight-on**;
   confirm crisp + uniform density + seamless + blends with neighbours + legible text.
   The deterministic **`texture-density`** check now guards this automatically: `game.html`
   exposes `window.__textureDensity()` → `{lowDensity:[{label,texelsPerMetre}]}` (faces well
   below `DENSITY×1024`≈184 t/m), and `studio/qa/checks/texture-density.mjs` fails the audit if
   `lowDensity` is non-empty. So **`node studio/qa_audit.mjs` must stay green** — but it's not a
   substitute for the screenshots above (a crisp face can still clash or read wrong).
4. `node studio/qa_audit.mjs` green (boot + camera + geometry + texture-density); re-run
   **`/zone-camera`** QA (0 fails) even though textures don't move geometry.

## Files

- `gen_paper.py` — procedural seamless paper (color/bump/normal), with a baked seam proof.
- `make_tileable.py` — make a Gemini/photo image seamlessly tileable + verify.
- `three-wiring.md` — the UV/density/anisotropy fix and drop-in code. **The important one.**
