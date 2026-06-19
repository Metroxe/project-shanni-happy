# project-shanni-happy — working notes for Claude

A hands-free, voice-driven build of a small **flat papercraft** game. The user does
not hand-author art or code; everything is programmatic and driven through Claude Code.

## Locked art direction (do not drift)

Flat, minimal, **clean** Paper-Mario papercraft. NOT realistic, NOT anime, NOT noir
(noir was tried and dropped). "High fidelity" to this user = clean execution: no
clutter, no clashing colours, no stray lines/artifacts, calm negative space.

- One base graphic per NPC (chibi, generated in Gemini), static by default. A *few*
  characters add a SMALL set (1–3) of alternate **pose images** for the rare moment the
  drawing itself must change (e.g. Chrees curling a dumbbell). These **hard-swap** —
  instant, no tween, Paper-Mario style. Every pose image of a character shares ONE
  canvas + foot baseline + body scale (registered by `studio/register_poses.py`,
  vision-checked by `studio/qa_vision.py`) so the swap can't resize or unground them.
  Most characters still have exactly one image. See the `papercraft-asset` skill §4.
- ALL motion = the paper cutout physically moving: hop-walk (squash on contact, stretch
  in air, slight lean), jump (squash → launch → airborne → land squash), contact shadow
  that shrinks/fades with height. Personality is in the motion (and, sparingly, a pose
  swap) — **never a tween between two drawings.** (The old "jump-for-joy" celebration +
  pastel sparkles were removed at the user's request — do NOT re-add them.)
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

## Sound — every interaction makes a sound (do not ship silent interactions)

**The rule:** if the player does something, or the world reacts to them, it is **audible.**
Any new interaction — a new collectible, NPC action, button, door, quest beat, menu, screen
transition — **ships its sound effect in the same change that adds it.** A silent interaction
is a bug, not a "later." Stay on-aesthetic: soft, warm, calm pastel — never harsh or loud (the
master chain caps level, but still pick gentle params). Like the art, personality lives in
motion + sound, not in louder.

**The second rule: world sounds are spatial.** A sound that comes from a *place* in the world
— an NPC's animation loop, an ambient prop, a distant event — **must be attenuated by the
player's distance to it**: full only when the player is near, fading with distance, and **not
fired at all** once they're far. A world sound audible across the whole map is a bug, exactly
like a silent interaction is. (Player-centric sounds — the player's own footsteps / jumps —
and UI / dialogue sounds are *not* spatial; they play full.) Mechanism: pass a 0..1
multiplier to `Sound.sfx(name, mul)`; `proxGain(x,z)` in `game.html` is the standard rolloff
(full ≤~2.5u, squared falloff to silent ~9u, skips the call past the edge). **When you add any
sound, ask: does it come from a spot in the world? If yes, gate it through `proxGain` in the
same change** — same reflex as shipping its sound at all.

**The system:** all **SFX + the dialogue voice** are **procedural Web Audio**, synthesized at
play time in `studio/js/audio.js` — **no asset files for those** (same ethos as the art:
programmatic, no hand-authoring). The module exports `Sound`; it's already wired into
`game.html`, so new sounds plug into existing seams rather than new plumbing. The one
**exception is background music** — a single seamless ~26s loop **generated programmatically
with MusicGen** (`gen_music.py` + `make_loop.py`, NOT hand-authored) and committed as one small
OGG (`out/music/calm.ogg`), because real-time music synthesis isn't practical. It plays through a
**music sub-bus** under the master, so the volume slider + mute already scale it.

- **Add a new SFX:** write a tiny synth fn in the `SFX` map in `audio.js` (use the `note()`
  and `noise()` helpers; set its level in `CFG.sfx`), then trigger it with `Sound.sfx('name')`.
- **Trigger it — two patterns, pick by where the event lives:**
  1. **Sim-driven** (emerges from the deterministic sim/physics: footsteps, jump, land,
     hamster pickup `squeak`) → detect the **state transition** in `audioStep(s)` in `game.html`,
     comparing against `aprev` (mode / onGround / walkPhase). It runs every fixed step, so fire on
     the *edge* (changed-since-last), never every frame.
  2. **Discrete UI/events** (menus, buttons, dialogue, transitions) → call `Sound.sfx('name')`
     right at the event site, or wire a `Dialogue.on*` hook (`onReveal`, `onChoiceOpen/Move/Pick`,
     `onLine`, `onEnd`) in `game.html`.
- **Positional sounds are proximity-gated** — see the "world sounds are spatial" rule above; any
  world-anchored sound goes through `proxGain` (Chrees' rep `lift` does), with the multiplier passed
  to `Sound.sfx(name, mul)`.
- **Dialogue voice:** the Charlie-Brown muted-brass "wah" is `Sound.blip(ch, speaker)`, one per
  revealed glyph (fired from `Dialogue.onReveal`). A new speaker gets its timbre in `VOICES`.
- **Gesture gate:** browsers block audio until a user gesture — `Sound.resume()` is already
  wired to the title **Start** / first key / first tap, so new triggers don't handle it.
- **Background music:** `Sound.startMusic(url, autoplay=true)` (called from `beginGame()`,
  after the gesture) fetches+decodes once and loops a single `AudioBufferSourceNode` (gapless —
  NOT an `<audio>` element) through the music sub-bus. **Auto-plays only on a real deploy:**
  `beginGame` passes `BUILD!=='dev'`, so the loop starts itself on GitHub Pages (where `build.json`
  exists → `BUILD` is a git sha) but stays **silent in a local dev worktree** (no `build.json` →
  `BUILD==='dev'`). `autoplay=false` only *arms* the track (sets URL + preloads); the music slider
  (`setMusicVolume`) still starts it on demand, so it isn't a dead control in dev. `Sound.stopMusic()` /
  `Sound.setMusicVolume(0..1)` (0 = off) / `Sound.toggleMusic()`; the **music** pause-menu slider
  drives it, persisted to `shen.musicvol` (own key — NOT in the save blob). Decode failure degrades
  to "no music", never a crash.
- **⚠️ Background music MUST loop seamlessly — every time, no exceptions.** A loop with an audible
  seam/click/gap is a bug, not "good enough." MusicGen (and most generators) do NOT loop natively,
  so you always run the loop step: render a little long (~30s), then `make_loop.py` does an
  **equal-power crossfade of the tail back over the head** so the wrap lands on two
  originally-consecutive samples (no click) with a continuous envelope (no level jump). NEVER commit
  a raw generated clip as the loop. **VERIFY the seam** before shipping (don't trust your ear over a
  background tab): decode the OGG in an `OfflineAudioContext` and check the wrap discontinuity
  `|x[0]-x[N-1]|` sits within the clip's own adjacent-sample-delta distribution (well under its max)
  — that's a numeric proof the loop is gapless. To make a NEW loop, follow the `gen_music.py` →
  `make_loop.py` flow in `requirements-music.txt`.
- **Three independent levels, all automatic** — **master** "volume" + mute (`shen.vol`/`shen.muted`,
  scales everything), **effects** (`shen.sfxvol`, the SFX+voice sub-bus), **music** (`shen.musicvol`,
  the music sub-bus). Each has its own pause-menu slider. Never gate or scale a sound yourself —
  SFX/`blip` route through the effects sub-bus and music through the music sub-bus, both under the
  master, so just call `Sound.sfx` / `Sound.blip` / `Sound.startMusic` and the sliders cover it.
- **Verify in preview** (don't assume): spy on `Sound.sfx` / `Sound.blip`, drive the interaction,
  assert the event fired the sound, console clean. (Exactly how the audio work verified
  step/collect/blip — wrap the fn, push calls to a log, read it back.)

## How to run

```sh
python3 -m venv studio/.venv && studio/.venv/bin/pip install -r studio/requirements.txt
.claude/serve.sh            # prints http://localhost:<port>/game.html for THIS worktree
```
Then `preview_start` the **`game`** config and open the printed URL (e.g.
`/game.html` or `/env-live.html`). The asset pipeline is the `papercraft-asset`
skill (`.claude/skills/papercraft-asset/`).

### Showing the user something — ALWAYS via per-worktree localhost, never `file://`

Christopher works in **git worktrees** and needs to view *this* worktree's version of
the game, not the main checkout's. A raw `file://` path also can't actually run the
game (ES modules + `fetch` are CORS-blocked off `file://`). So whenever you want him to
look at the game (or any `studio/` page):

1. Run `.claude/serve.sh` — it writes a **git-ignored** `.claude/launch.json` pointed at
   *this* worktree's `studio/` and prints the URL. Each worktree gets its **own
   deterministic port** (base derived from the worktree path, first free port up), so
   multiple worktrees serve their own game side-by-side; the URL is stable once chosen.
2. `preview_start` the **`game`** config (this is also what you use to verify changes).
3. Give him the full `http://localhost:<port>/game.html` link — and **repeat that exact
   link every time** you point him at something, so he never has to scroll back for it.

`/done` tears the server down (`.claude/serve.sh stop` + `preview_stop`).

## Workflow: deploy & done (PR-based — never push to `main`)

Work happens in **git worktrees** (one per session/chat), each on its own branch.
`main` is **branch-protected**: it only accepts changes through a pull request that
passes the **`smoke`** check. Do NOT `git push origin main` (or `HEAD:main`) — that's
how work has accidentally landed on `main` before. Multiple sessions run at once, so
always `git fetch origin main` and check for peers before acting.

- **`/deploy`** = go live. Commit on the worktree branch → `git push -u origin HEAD` →
  open a PR (`gh pr create --base main`) → wait for `smoke` green (`gh pr checks --watch`)
  → if `BEHIND`, read the incoming diff then `gh pr update-branch` → squash-merge
  (`gh pr merge --squash --delete-branch`). Merging `main` triggers the Pages deploy
  (`deploy.yml`). After merge, the worktree branch is **refreshed to merged `main`**
  (`git reset --hard origin/main`) and you keep working in the same worktree; the next
  `/deploy` opens a fresh PR off the same branch name.
- **`/done`** = close out the worktree. Resolve pending work (offer `/deploy`), confirm
  the branch landed on `main` via its PR, sync the primary checkout, tear down the worktree.
- **CI**: `ci.yml` runs the `smoke` job on every PR — assembles the site and loads
  `game.html` in headless Chromium asserting `window.__ready` + no errors
  (`test/smoke.mjs`, uses `playwright`). This is the required check that gates merges.

## Conventions

- Python tooling lives in `studio/`, computes paths from `__file__` (repo-relative).
- Generated assets land in `studio/out/`. Keep the committed art (`shen-cut`,
  `shen-paper`, `env-bg`, concept sheets); intermediate frame dirs are git-ignored.
- Secrets: image gen uses the Gemini key from 1Password; **never commit keys**.
  `studio/.exec` is a machine-specific chrome path (git-ignored).
- `.claude/launch.json` is **generated per-worktree by `.claude/serve.sh` and
  git-ignored** (holds this worktree's unique port + absolute `studio/` path) — never
  commit it or hardcode a port.

## Cameras — ALWAYS QA them (not optional)

Whenever you add, move, or tune a camera/zone, you MUST run the camera QA as part of
building it — it is part of "done", not a follow-up. Invoke the **`/zone-camera`** skill
(`.claude/skills/zone-camera/`) and enforce its cardinal rule:

> **Shen must be visible from every reachable spot and through every transition.**

But **visible is the floor, not the goal** — also enforce the **framing rules**:
> **Shen is never a tiny dot (≥ ~13% of the screen, AIM ~15%+), and never looked
> down on top-down (3/4 view, angle ≤ ~32°).** She sits BEHIND and slightly above,
> not overhead. For an open area where she'd drift far, DON'T zoom out — keep the camera
> close and use a zone **`trackWid`** so the eye follows her across the field (constant
> size). The hard floor/ceiling are `CAM_MIN_FRAC` / `CAM_MAX_PITCH` in `game.html`.

Three design rules: **one fixed camera per zone** (never vary the angle by travel
direction — that flips the eye into a wall on reversal), **contain the player** so
every reachable spot is inside a zone, and **keep her big + low-angle** (small-ish
`back`, `height` ≲ ~0.7×`back`; pulling `back` way out to flatten the angle is the trap
that shrinks her and walks the eye into neighbouring buildings).

Workflow every time: author the camera → serve the worktree on localhost (never
`file://`) → in the preview run `cameraQA.static()` (visibility) AND `cameraQA.framing()`
(size + angle; reports `minSize`/`maxPitch`), `cameraQA.transition([a],[b])` for
cross-junction pairs, AND `cameraQA.path([...])` for **round-trips** (down a road and
back, up the stairs and back — reversals hit transitions a one-way sweep misses; they
also catch a blend grazing a building that `static` won't) → `cameraQA.warp(x,z)` +
screenshot any failure → fix → re-run until **0 failures** on both. (The occlusion
check raycasts BUILDINGS only, so eyeball prop-heavy areas — a tree between camera and
Shen won't be flagged.) A camera change with unrun or failing QA is not finished.
Reference + harness: `studio/test-scene.html`.

## World/asset QA gate — RUN EVERY PUSH that touches a world or asset (not optional)

Whenever you add/move/retexture buildings, props, surfaces, terrain, colliders, or a new
asset, you MUST run this gate before calling it done / before `/deploy`. `/zone-camera`
proves Shen is *visible*; it does NOT prove the world *looks right* or is *traversable*.
These bugs recur every build — audit for ALL of them, every time. Full how-to +
detection commands + root-cause code refs live in the **`/papercraft-env-qa`** skill
(this is the standing summary so it's not forgotten between sessions).

**The gate (all must pass):**
1. `node test/smoke.mjs studio` → green (boots, no JS errors).
2. `node studio/qa_shots.mjs` → captures the zone battery + flicker pairs + a **per-object
   close-up of EVERY placed prop & building** (`studio/out/qa/props/`) AND prints
   **`✓ geometry audit clean`** (`window.__overlaps()`=`[]` and `cameraQA.reach()` all
   reachable). Footprint overlaps = z-fight/clipping; unreachable = a wall blocks a route.
   **Every single thing placed in a session must be screenshotted and looked at** — zone
   shots hide per-object defects (a barrier that reads as a bench, a prop facing wrong, a
   shrub clipping a wall). Inspect the `props/` close-ups, not just the wide shots.
3. In the preview (`/zone-camera`): `cameraQA.static()`=0 + `cameraQA.path()` round-trips=0,
   AND `cameraQA.walk([a],[b])` on every corridor (`stuckAt` null).
4. **Multi-agent picture sweep** over `studio/out/qa/*.png` (template
   `.claude/skills/papercraft-env-qa/visual-qa.workflow.js`) — but trust the geometric
   audit over the sweep's synthesizer (it once mis-dismissed a real z-fight as a "hedge join").
   Fix everything found → re-shoot → repeat until clean.

**Two cardinal rules:** (1) **Never the abyss** — no reachable spot/angle may see off the
edge of the world; build PAST the edge, ring open areas with buildings, block with
believable objects (hedges / construction `barrier`), backfill with `buildBackdrop()` + fog.
(2) **Stay on the locked look** — no clipping, no stray outlines, no clashing colours.

**Recurring failure modes → root cause → fix (audit for each):**
| Symptom | Cause → Fix |
|---|---|
| Windows/door sunk into ground | building `base`=`groundHeight`; box `bottom=base` (NO downward extension) |
| Dark squares / mottled patch / flicker on a park-edge wall | box extended below base INTO the retaining wall (vertical z-fight) → `bottom=base` |
| Two buildings/stairs flicker where they meet | overlapping footprints → `window.__overlaps()` must be `[]`; separate them |
| Road/plaza/sidewalk shimmer seam | coplanar surfaces same height → distinct per-kind `y`-eps (+ `lift`) |
| Stray white/cream outline lines | `EdgesGeometry` on the wrong thing → `edge=false` on buildings + rounded/small props (keep only as deliberate die-cut) |
| "Invisible circle" blocks a path | coarse box collider (`r=0.5·min(w,d)` → r=2 bulge) → tight perimeter ring (~0.55); confirm with `cameraQA.walk` |
| Silent unreachable area | a stray collider walled it off → `cameraQA.reach()` `unreachable` must be `[]` |
| Clip THROUGH a prop (slide/climber) | one centre collider → per-part `cols:[{dx,dz,r}]` |
| Prop faces the wrong way | make it orientation-free (lamp = top globe) or set per-prop `rot` |
| Props that don't belong / overlap | bushes on a road, bench on a bush → streets = lamps/trees, park = bushes; space props ≥~3u; the `placement` lens |
| Edits not showing on reload | browser cached `specs/world.json` → it's fetched `cache:'no-store'`; hard-reload |

Debug hooks (all on `window`): `cameraQA.{static,framing,path,transition,reach,walk,warp}`,
`__overlaps()`, `__colliders(x,z,r)`, `__freecam/__look` (free-cam for QA shots).

## Status / next

- DONE: **Camera framing pass** — every zone retuned to a calmer 3/4 view (no top-down;
  the worst, the `corner`, went from ~56° to ~26°) and a bigger Shen (min ~13%, AIM ~15%+
  of screen). New **`trackWid`** zone field gives the open `park` a 2D follow so she stays
  a constant size wherever she roams (was a tiny dot off-centre). New **`cameraQA.framing()`**
  + `CAM_MIN_FRAC`/`CAM_MAX_PITCH` guardrails in `game.html` make "not too small / not
  top-down" permanent 0-failure gates. Full QA green (framing, visibility, round-trips).
  Rules written into `/zone-camera` (SKILL + REFERENCE) and the Cameras section above.
- DONE: character cutout + die-cut; walk + jump (hop); 6 environment moods;
  pipeline migrated into the repo; **3D Paper-Mario game loop** (`studio/game.html`
  + `studio/js/sim.js`) — perspective follow-camera (Shen always centred),
  full-window responsive, 2D ground movement, depth-sorted billboard props
  (walk behind/in front), d-pad + keyboard; `/deploy` skill
  + GitHub Pages. **Live: https://metroxe.github.io/project-shanni-happy/**
- DONE: **Removed flower collecting + jump-for-joy** (user request). No more flower
  collectibles, no score/win HUD, no joy mode/button/`J` key/sound. The only
  collectibles are hamsters (Adrian's quest). The **Talk** action button is now
  contextual (shows only when beside an NPC); **hop** is always shown. Chrees kept as
  a flavour NPC with rewritten (non-flower, non-quest) dialogue. No `SAVE_VERSION`
  bump (removed ids drop via sanitize; the removed `q_chrees` is ignored on load).
- DONE: **NPC dialogue system** (`studio/js/dialogue.js`) — walk-up proximity prompt
  over the NPC, bottom dialogue box with typewriter reveal, advance-on-button, and
  branching **choice menus** (↑/↓ or d-pad to pick; Talk/Enter/Space/click to confirm);
  movement is gated while talking. Data-driven: per-NPC trees live in `world.json` under
  `npcs[]` (`{name, tex, x, z, h, dialogue:{start, nodes:{id:{text, speaker?, next?,
  choices?}}}}`). NPCs render as grounded billboards with idle paper breathing + a greet
  hop. First NPC **Chrees** (buff, red headband, long hair, black tank) → `out/chrees-paper.png`.
- DONE: **`studio/gen_image.py`** — reusable Gemini image-gen (text→image, optional
  `--ref` style/face conditioning); made Chrees using chibi #4 as a style ref. Key: env
  `GEMINI_API_KEY` from 1Password item **"Bowmark Gemini Key"** (id
  `s66drdsfeobdn5brqel5kvdtta`, vault `Christopher-Macbook-CLI`); model `gemini-3-pro-image`.
  `cutout.py` now takes an optional name arg: `cutout.py <src.png> <name>` →
  `out/<name>-cut.png` + `out/<name>-paper.png`.
- DONE: **Save system** (`studio/js/save.js`) — localStorage persistence keyed
  `shanni-happy:save`. Saves on `visibilitychange→hidden` + `pagehide` (true "exit
  any time", sync write finishes during teardown), on every flower pickup, and a 10 s
  interval backstop for hard kills. **Title / continue screen** (`#title` in game.html):
  New Game / Continue over the dimmed live world; gameplay input gated by `started`;
  New Game asks "Erase save?" once before wiping an existing save. Defensive load:
  `sanitize()` clamps position to bounds, intersects collectible ids with the current
  world, recomputes score; the whole load is try/catch → worst case "fresh start" (bad
  blob stashed under `…:save:backup`). Debug surface: `window.game.{save,wipe,saveData,
  start,reset}`. Verified end-to-end (collect→reload→continue, stale-id drop, OOB clamp,
  corrupt JSON, future-version, erase guard).

  ### Save compatibility — WE control it (not the deploy/build version)
  `build.json` (the deploy git-sha) is a **debug label only and never decides whether a
  save loads.** Compatibility is governed by two things we own in the project:
  - **`SAVE_VERSION`** (integer in `studio/js/save.js`). A loaded save with an *older*
    `v` is **discarded → clean fresh start** UNLESS `migrate()` has a step that walks it
    up to the current `v` (then progress is preserved). A *newer* `v` (reverted deploy)
    is preserved-but-ignored. So bumping `SAVE_VERSION` is the deliberate "this breaks
    old saves" switch.
  - **Stable collectible ids** (`world.json` `id:"f1"…`). Progress is a SET of collected
    ids, never array indices. **⚠️ NEVER renumber/reuse an id once shipped** — that
    silently corrupts saves and is exactly what the id scheme prevents.

  **Bump rule — before every deploy, judge whether the diff breaks saves:**
  - **Do NOT bump (the common case):** new / moved / removed flower (ids + sanitize
    cover it), art / colour / prop / cloud / hill changes, new NPC or dialogue, physics
    tuning, or adding a NEW saved field that load defaults when it's absent.
  - **Bump `SAVE_VERSION`:** the *meaning or units* of a saved field change (e.g. the
    coordinate system, so old `x`/`z` map to the wrong place), a saved field load relies
    on is removed/renamed without a safe default, `collected` semantics change, or
    restoring an old position/progress would soft-lock or misplace the player. Bump =
    discard old saves; to keep progress instead, also add a `migrate()` step. When
    genuinely unsure, prefer bumping — a clean reset beats a silently broken world.
  The `/deploy` skill enforces this check at push time.
- DONE: **Procedural audio** (`studio/js/audio.js`) — all Web Audio synthesis, **no asset
  files**. Gameplay SFX via sim-transition detection (`audioStep` in game.html), UI/dialogue
  SFX via `Sound.sfx` + `Dialogue.on*` hooks, and a Charlie-Brown muted-brass dialogue voice
  (`Sound.blip`, per-speaker `VOICES`). **Pause menu** (Esc / ☰) with a master volume slider +
  mute, persisted (`shen.vol` / `shen.muted`); audio unlocks on first gesture. See the
  **Sound** section above for the "every interaction makes a sound" rule + how to add one.
- DONE: **Background music** (`studio/out/music/calm.ogg`) — one seamless ~26s ambient loop,
  generated programmatically with **MusicGen-medium** (`gen_music.py` → 30s clips, `make_loop.py`
  → equal-power crossfade loop + `oggenc`; env in `requirements-music.txt`. Generated on **CPU** —
  PyTorch MPS crashed mid-generate on this M4 Pro). Plays through a **music sub-bus** in `audio.js`
  (`Sound.startMusic`/`stopMusic`/`setMusicVolume`), a gapless looping `AudioBufferSourceNode`
  started from `beginGame()` after the gesture. Decode failure degrades to "no music", never a crash.
- DONE: **Independent volume mix** — `audio.js` now has **two sub-buses under the master**: SFX +
  dialogue-voice route through `sfxGain`, music through `musicGain`. **Three pause-menu sliders** —
  master **volume** (`shen.vol`/`shen.muted`), **effects** (`shen.sfxvol`), **music**
  (`shen.musicvol`, 0 = off) — each its own key, none in the save blob. `Sound.setSfxVolume` /
  `setMusicVolume` / `setVolume`; defaults reproduce the old single-volume behaviour exactly.
- DONE: **Quest system + journal book** (`studio/js/quests.js` + the journal UI in `game.html`).
  - **Engine** (`Quests`, UI-agnostic like `dialogue.js`): data-driven quests in `world.json`
    `quests[]` (`{id, name, giver?, summary?, steps:[{desc, goal?}]}`). Goal types auto-advance
    against the live world: `collect` (`{kind?,ids?,count?}` — counted from the collected set, so
    progress is **derived on load**, never stored), `talk` (`{npc}`), `reach` (`{x,z,r?}`),
    `manual`. State is compact (`{status,step}` per quest) + persisted in the save blob's new
    `quests` field (additive — **no `SAVE_VERSION` bump**; absent → fresh). Hooks `onStart/onAdvance/
    onComplete` drive sound + toasts. `Quests.note({type,...})` is fed from game seams; `Quests.list()`
    feeds the journal.
  - **Wiring**: dialogue nodes carry an optional `action` (`"start:q_hamsters"`) fired via
    `Dialogue.onAction`; NPCs get a `quest` field + `entryNode()` picks a **state-aware greeting**
    (default intro / `progress` / `ready` / `done` nodes by quest status). Collecting feeds
    `note('collect')`; talking feeds `note('talk')`.
  - **Journal** = the pause menu replacement (Esc / 📖). A **book** with **left binder-divider tabs**
    (📜 Quests, ⚙ Settings) and a **page-flip** on switch (`#pages` rotateY). Quests tab = expandable
    list (name + giver → summary, rose "current task" box with a progress bar, done/active/future
    step rows). Settings tab = the three volume sliders + mute + restart/resume (relocated, same ids).
    Quest milestones show a `#qtoast` + a badge dot on the 📖 button when closed.
  - **Content (Rocky-themed town)**: **Adrian** the shy pet-shop clerk (`out/adrian-paper.png`, Gemini
    chibi → `cutout.py`) gives **Hamster Roundup** — find 5 escaped **hamsters** (`out/hamster-paper.png`,
    collectible `kind:"hamster"`, scattered) and return them. This is now the **only** quest —
    **Chrees** is a flavour-only NPC (his "Bloom the Block" flower quest was removed with flowers).
  - **Sounds** (all procedural, `audio.js`): `squeak` (hamster), `quest`/`questStep`/`questDone`,
    `book`/`bookClose`/`flip`. Verified in preview: full lifecycle (accept→auto-track→complete),
    real dialogue acceptance for both NPCs, journal DOM + page-flip, save round-trip, **camera QA 0 fails**.
- IN FLIGHT: **Premium look overhaul** (make it less "web-ish"). Working brief + A–Z of style
  directions + concerns + method: **`studio/PREMIUM_LOOK.md`** — READ IT before doing visual work.
  Two pieces already exist: (1) a post-processing finishing lens `studio/js/fx.js` (`EffectComposer`
  presets `off|minimal|diorama|full`, toggle `window.__fx('diorama')`; **diorama accepted as the final
  10% lens**; SSAO parked — billboard halo); (2) the **`papercraft-texture`** skill that fixes the
  blurry/stretched surfaces (256px fixed-`repeat` → crisp seamless tiles + world-space UVs). The brief
  says the real win is in the **bones** (palette, textures, toon, UI skin, character rim), not the lens.
- NEXT (ideas): more NPCs/quests (drop-in: add art + a `world.json` npc/quest); conversation state
  (remember choices) — persist into the reserved `npcs:{}` slot already in the save blob; more zones/goals;
  per-mood music loops (6 palettes in `specs/all.json`); idle polish. NOTE: photos in the macOS **Photos library** are unreadable from bash
  (TCC blocks `cp`/`sips`/`qlmanage` on `~/Pictures/Photos Library.photoslibrary/originals/…`)
  — have the user drag the image into chat or export it to `studio/refs/` to use as a gen ref.
