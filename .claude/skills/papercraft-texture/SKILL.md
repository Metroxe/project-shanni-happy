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

## Definition of "good" (the bar to hit)

- **Crisp** at gameplay distance (read it in `preview_screenshot`, not your assumption).
- **Seamless** — no tile lines when walking a round-trip past repeated surfaces.
- **Uniform density** — same grain scale on a tall thin tower and a long low wall.
- **On-aesthetic** — subtle, pastel, matte; adds paper tactility, not visual noise.
- **Cheap** — share one map set across many tinted materials; mipmaps + max anisotropy on.

## Verify (every time — do not assume)

1. Serve the worktree (`.claude/serve.sh`) and `preview_screenshot` a wall close-up and a
   wide shot.
2. Confirm crisp + uniform + seamless against the bar above; iterate density/contrast.
3. `smoke` green; re-run **`/zone-camera`** QA (0 fails) even though textures don't move
   geometry.

## Files

- `gen_paper.py` — procedural seamless paper (color/bump/normal), with a baked seam proof.
- `make_tileable.py` — make a Gemini/photo image seamlessly tileable + verify.
- `three-wiring.md` — the UV/density/anisotropy fix and drop-in code. **The important one.**
