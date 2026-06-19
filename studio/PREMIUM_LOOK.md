# Premium look overhaul — working brief

**Status: planning artifact. Nothing here is locked-in look yet — this is the menu +
method a future session works through with Christopher until the game looks premium.**

Read this top-to-bottom before doing visual work. It captures the goal, every concern
raised, the hard constraints, what was already tried, and an A–Z of directions with how
to do each in *this* stack. Pair it with the **`papercraft-texture`** skill (textures)
and **`zone-camera`** skill (camera QA).

---

## 1. The goal

The game currently "feels very plain and very web-ish." Make it feel **premium** — a
*handmade papercraft diorama*, not a WebGL demo. Premium here ≠ realistic, ≠ heavier,
≠ darker. Premium = **clean execution, designed palette, tactile paper surfaces, crafted
UI, calm depth.** Light and airy, never moody.

## 2. Hard constraints (do NOT drift — from CLAUDE.md)

- Flat, minimal, **clean** Paper-Mario papercraft. NOT realistic, NOT anime, NOT noir.
- One static graphic per NPC; **all animation is the paper physically moving** (texture
  never changes). Personality lives in motion + sound, not in louder visuals.
- Calm negative space, no clutter, no clashing colours, no stray lines/artifacts.
- Everything programmatic / no hand-authoring (procedural or gen-pipeline).
- Every interaction makes a sound (ships its SFX in the same change).
- Cameras: one fixed camera per zone; Shen visible from every reachable spot + transition;
  **run `/zone-camera` QA to 0 fails** for any camera-affecting change.
- Deploy is PR-gated (`smoke` must pass); never push `main`. Judge `SAVE_VERSION` per the
  CLAUDE.md bump rules before deploying.

## 3. What was already tried this session (so you don't repeat it)

- Built **`studio/js/fx.js`** — an `EffectComposer` post-processing stack with presets
  `off | minimal | diorama | full`, wired in `game.html` behind `window.__fx('<preset>')`,
  driven from the existing `setInterval` frame, degrades to plain render if it fails
  (smoke stays green). Resize-aware.
- **`diorama`** (gentle tonemap-grade + gradient sky + tilt-shift DoF + soft bloom) is the
  **accepted finishing lens** — keep it as the *final 10%*. Toggle live to A/B.
- **Lesson — the dark bug:** the first grade used a Reinhard tonemap + vignette + warm/cool
  multiplies → it *darkened* a bright pastel scene (cinematic = wrong direction). Fixed to
  luminance-preserving + slightly brighter/airier. **Rule: grade this game lighter, not
  moodier.**
- **`full` (SSAO/GTAO) is parked:** screen-space AO treats the transparent paper billboards
  as solid → dark halo boxes around Shen. Not shippable without a depth-prepass that
  excludes the cutouts, for marginal gain. Prefer **baked AO into textures** instead (item F).
- **Key insight:** a post-process is a *lens on top*; it can't fix that the scene is
  flat-colour boxes with blurry textures and a web UI. **The premium win is in the bones,
  not the lens.** That's what the A–Z below targets.

## 4. The web-ish culprits (what to actually fix)

1. **Flat untextured colour blocks** — the big framing "walls" are buildings rendered as
   plain pastel boxes → #1 "WebGL demo" tell.
2. **Blurry + stretched textures** — `paperTex()` is 256px at a fixed `repeat 1.6×1.6` on
   `BoxGeometry` 0..1 UVs, so big faces smear and stretch (see `papercraft-texture` skill).
3. **Characters read as stickers** — unlit billboards with no rim/grounding float on the floor.
4. **Palette clashes** — e.g. the blue + purple framing walls; no designed harmony.
5. **The UI is literally a web UI** — the hint bar, d-pad, hop/journal buttons = default
   browser chrome, a big fraction of the frame.
6. **Hard primitive geometry** — sharp box corners read as untextured 3D, not cut paper.

---

## 5. A–Z of directions

Each: *what it is · how in this stack · payoff/risk.* Letters are a menu, not an order —
see §7 for a suggested sequence. A/B every one on localhost (§6).

### Surfaces & materials
- **A. Crisp seamless paper on every surface** — bake tiles with the `papercraft-texture`
  skill, apply to walls/ground/plateau/stairs. *Foundational; fixes culprit 1+2.*
- **B. World-space / triplanar UVs** — uniform texels-per-metre so nothing stretches
  (skill → `three-wiring.md`). *Part of A; do together.*
- **C. Cel / toon banding** — `MeshToonMaterial` + a 2–3 step gradient map quantises light
  into flat bands → printed-paper, "designed" look. *Strong stylistic lever; low risk, on-aesthetic.*
- **D. Fully matte** — roughness ~1, zero spec/sheen anywhere (no plastic). *Cheap; safe.*
- **E. Consistent die-cut edges + fold lines** — extend the cream `EdgesGeometry` to all
  forms; a faint darker crease where planes meet. *Reads as cut paper; watch for clutter.*
- **F. Baked ambient occlusion in the texture** — paint soft corner/contact darkening into
  the maps (or a cheap vertex-AO), NOT runtime SSAO. *Grounds forms, dodges the billboard halo.*
- **G. Paper thickness / layered cardstock** — give walls/props a thin extruded edge in a
  slightly darker tone. *Sells "cut from card"; modest effort.*

### Colour & light
- **H. Curated per-zone palettes** — replace ad-hoc colours with designed 3–5 colour
  harmonies per zone (warm street vs cool plaza). *Biggest single "designed" signal; low effort, high payoff.*
- **I. Lighting redesign** — one warm key + soft cool fill, gentle; retune the current
  hemi 2.0 / sun 2.0 for calm pastel form-shading (don't blow out, don't darken). *Medium.*
- **J. Soft grounded shadows** — larger, softer contact shadows under props/buildings/chars
  → diorama-on-a-table. *Cheap, high payoff.*
- **K. Subtle gradient on big flats** — bake a faint top-light→bottom-shade into walls so
  they're not dead-flat colour. *Cheap; pairs with A.*

### Form, depth & set dressing
- **L. Calm set dressing** — a *few* intentional cream die-cut props (planters, signs,
  awnings, lamps, bunting) via `papercraft-asset`. *Empty reads unfinished; crafted ≠ cluttered — keep negative space.*
- **M. Layered paper backdrop / parallax** — flat cut hills/skyline behind play space (reuse
  the `env_render` moods). *Depth; low risk.*
- **N. Softer silhouettes** — bevel box corners or use paper-fold cut shapes. *Less "primitive."*
- **O. Foreground framing cutouts** — soft out-of-focus paper at frame edges (pairs with
  tilt-shift) for diorama framing. *Polish.*

### Characters
- **P. Cream die-cut rim + grounded contact shadow on Shen/NPCs** — THE fix for "sticker."
  Per-character material/shader work. *High payoff; medium effort.*
- **Q. Standee foot / slight back-lean** — billboards read as standing paper, not floating
  decals. *Cheap.*
- **R. Soft paper drop-shadow behind cutouts** in the light direction. *Cheap.*

### UI (the most literally "web" part)
- **S. Papercraft UI skin** — restyle HUD / d-pad / dialogue / journal as cut-paper cards
  with deckle edges, paper texture, warm rounded type. *Huge fraction of the frame; cheap; transformative.*
- **T. Diegetic HUD** — counters/quest state as paper tally/sticker sheets; carry the
  journal's book craft to all chrome. *Cohesion.*
- **U. Type + icon pass** — one warm rounded display face for titles, consistent icon set.

### Post / lens (final 10% — mostly done)
- **V. Diorama FX stack** (`studio/js/fx.js`) — keep as the finishing lens. Park SSAO. *Done.*
- **W. Per-zone grade/mood** — tie grade warmth + sky gradient (and per-mood music) to each
  zone palette. *Cohesion.*
- **X. Frame-wide paper-grain overlay** — a faint consistent fibre over everything. *Subtle!*

### Meta
- **Y. Reference-lock** — pick a target from refs (Tearaway, Paper Mario: Origami King,
  Monument Valley, Lumino City, Hieronymus) and match its palette/edge/lighting. *Anchors taste.*
- **Z. Measure, don't guess** — A/B every change on localhost via screenshots; keep the FX
  preset-toggle pattern (baseline vs candidate) for each experiment.

---

## 6. Working method (every visual change)

1. `.claude/serve.sh` → `preview_start` the `game` config (per-worktree localhost; never
   `file://`). Repeat the exact `http://localhost:<port>/game.html` link to Christopher.
2. Make the change behind a **toggle / A-B** where possible (like `__fx`), so baseline vs
   candidate is one screenshot apart.
3. `preview_screenshot` close-up **and** wide; judge against the item's payoff + the §2
   constraints. Iterate numbers against Christopher's eye — he reacts to images, not prose.
4. `/zone-camera` QA to **0 fails** for any camera-affecting change.
5. `smoke` green; judge `SAVE_VERSION`; `/deploy` (PR-gated). Add SFX if the change adds an
   interaction.

## 7. Suggested sequence (fastest path to "designed")

Biggest payoff-per-effort first: **H (palette) → A+B (crisp textures) → C (toon) → S (UI
skin) → P (character rim) → J/K (shadows/gradient) → L/M (set dressing/backdrop) → I
(light) → keep V (diorama lens).** Reassess with Christopher after H+A+C — that trio alone
should move it a lot; let his reaction steer the rest.

## 8. Open decisions for Christopher (ask early)

- **Reference**: any game/app/image that nails the target feel? (drag into chat) — anchors everything.
- **Toon vs smooth** (item C): crisp printed flat bands, or keep soft gradients?
- **How stylised** the UI skin (item S) — fully diegetic paper, or just a tasteful reskin?
- **Stylisation budget**: how far from the current look is allowed before it stops feeling like "the same game"?

## 9. Pointers

- FX lens: `studio/js/fx.js` (+ wiring in `studio/game.html`, toggle `window.__fx`).
- Textures: **`papercraft-texture`** skill (`gen_paper.py`, `make_tileable.py`, `three-wiring.md`).
- Art/props/NPCs: **`papercraft-asset`** skill; image-gen key via **`gemini-key`** skill.
- Cameras: **`zone-camera`** skill. Scene data: `studio/specs/world.json`, moods in `specs/all.json`.
