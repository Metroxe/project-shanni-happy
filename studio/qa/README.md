# QA system — one home, add checks by dropping a file

This directory is the **single home** for project-shanni-happy QA so that many sessions /
branches can add checks over time without conflicting. Read this before adding any QA.

## The two tiers (both required — neither substitutes for the other)

1. **Deterministic checks** — code assertions that must always hold (geometry overlaps,
   reachability, camera framing, boot). They never forget and run in seconds. Live in
   `studio/qa/checks/*.mjs`, auto-discovered and run by **`node studio/qa_audit.mjs`**.
   This is the tier the **Stop hook** gates on (a clean run stamps `.claude/.qa-stamp`).
2. **Visual sweep** — **screenshots, then a human or sub-agent SERIOUSLY looks at each
   one.** Geometry can be perfectly valid while the frame has a clashing colour, a prop
   that reads as the wrong object, a blurry/stretched texture, or the abyss. **A
   deterministic check is NOT a substitute for looking.** Capture with
   `node studio/qa_shots.mjs`, then run the multi-agent picture sweep
   (`.claude/skills/papercraft-env-qa/visual-qa.workflow.js`). For **any** visual/world
   change, do this — not just at deploy. The whole point: *take screenshots and actually
   study them.*

## The harness — never copy-paste a server, never hardcode a port

Every QA script boots game.html through **`withGamePage()`** in `studio/qa/harness.mjs`:

```js
import { withGamePage } from './qa/harness.mjs';        // path is relative to the script
const overlaps = await withGamePage(async (page, ctx) => {
  // ctx.pageErrors = live uncaught-error array; ctx.port = the (free) port chosen
  return await page.evaluate('window.__overlaps()');
});
```

It serves `studio/` on an **OS-assigned free port** (binds port 0), so two QA scripts can
never collide (the old hand-picked `PORT=8788` in two scripts was a real bug). Options:
`{ viewport, start=true, launchArgs }` (e.g. `launchArgs:['--autoplay-policy=no-user-gesture-required']`
for an audio probe). **Do not re-implement the static server or pick a port by hand.**

## Add a DETERMINISTIC check (the common case) — drop ONE file

Create `studio/qa/checks/<id>.mjs`:

```js
export const meta = {
  id: 'no-floating-props',                 // unique, kebab
  title: 'No prop floats above or sinks below its ground',
  touches: ['studio/specs/world.json'],    // which files this guards (docs only)
};
export async function run(page, ctx) {
  const fails = [];
  // assert via window.* debug hooks; push a human-readable string per failure
  const bad = await page.evaluate('window.__floatingProps ? window.__floatingProps() : []');
  if (bad.length) fails.push('floating/sunk: ' + bad.map(b => b.label).join(', '));
  return { fails };                        // fails:[] = pass
}
```

`qa_audit.mjs` finds it automatically — **no central file to edit, no merge conflict.**
If the check needs a new probe, add a `window.__yourProbe()` to `game.html` next to
`__overlaps`/`cameraQA`. This is how the **capture reflex** (CLAUDE.md) lands a new class:
when a defect is reported, write it here **generically** ("no overlaps", not "these two
shops") so it guards every future change.

## Add a SCENARIO probe — a flow that drives the game and asserts outcomes

Some QA isn't a static invariant but a flow (enter the pet shop, run the quest, save→reload,
audio is per-scene). Put these in `studio/qa/scenarios/<name>.mjs`, **also using
`withGamePage`**, exit non-zero on failure, and capture screenshots into
`studio/out/qa/<name>/` for the visual sweep. List them in the deploy gate so they run
before ship.

## Capture reflex (the rule this structure serves)

When Christopher reports a problem once: **fix → generalize to the class → promote to a
check here (prefer a deterministic `checks/` module; only if truly subjective, add a NAMED
line to the sweep `TAXONOMY`) → record** (CLAUDE.md failure-modes table + memory). He should
never report the same *class* twice. See CLAUDE.md "QA reflex".

## Pending checks (defensive — already written, waiting on a probe)

These checks exist in `checks/` NOW but **skip** (⊘) until the feature's branch exposes a
`window.__*` probe — so they're green on this branch and **auto-activate on merge**. Each was
mined from a problem Christopher flagged once; when your branch adds the feature, add its probe
and the check turns on:

| Check | Expected probe in `game.html` | Flagged in |
|---|---|---|
| `interior-overlap` | `window.__interiorOverlaps()` → `[{a,b}]` overlapping interior pieces | pet shop ("door has wall texture over it"; "fish tank overlaps the shelf") |
| `floor-bounds` | `window.__floorOverruns()` → `[{zone\|label}]` floors past the zone edge | pet shop ("the floor goes past all the seams") |
| `scene-background` | `window.__sceneBackgrounds()` → `[{scene,isWhiteOrUnset}]` | pet shop ("never pitch white") |
| `texture-density` | `window.__textureDensity()` → `{lowDensity:[{label,texelsPerMetre}]}` | textures ("blurry … don't line up") — the textures branch was already building this |

If your branch named the probe differently, just update the one line in the matching check file.

## Cross-branch integration — fold-in checklist (this branch merges FIRST)

This branch establishes the home (`studio/qa/`, the registry, the harness, the Stop hook).
The other in-flight sessions rebase onto it and fold their QA in:

- **Pet shop** (`vibrant-cray`: `qa_petshop/qa_quest/qa_save/qa_audio.mjs`) → move into
  `studio/qa/scenarios/` and switch each to `withGamePage` (delete the copy-pasted server;
  this also removes the `PORT=8788` clash with `qa_audit.mjs`). Any static invariant for the
  shop interior (no overlaps inside, Adrian reachable across the counter) → a `checks/` module
  so it runs on every change, not only in the scenario.
- **Textures/blending** (`xenodochial-joliot`: `qa_shots.mjs` facade-framing rewrite + new
  textures) → keep the head-on facade framing (it's an improvement; it sits in a different
  hunk than this branch's exit-code/stamp edit, so they merge cleanly). Add a
  `checks/texture.mjs` for anything codifiable (e.g. every material has a sane `repeat`, no
  1×1 stretched map); for the subjective "blurry / seam / clash" judgments, add NAMED lines
  to the sweep `TAXONOMY` and lean on the screenshot sweep.
- **Loading zones** (`compassionate-neumann`: `dialogue.js` + `game.html`) → add a
  `scenarios/loading-zones.mjs` (town→interior→town round-trip: no soft-lock, save records
  the scene, camera valid through the swap) and, if there's a static invariant (e.g. every
  zone trigger has a matching return), a `checks/` module.

After each folds in, `qa_audit.mjs` automatically runs the union of all `checks/` — the
system gets stricter with every merge, with no central wiring to fight over.
