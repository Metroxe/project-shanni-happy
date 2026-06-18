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

## Status / next

- DONE: character cutout + die-cut; walk + jump-for-joy; 6 environment moods;
  pipeline migrated into the repo; **3D Paper-Mario game loop** (`studio/game.html`
  + `studio/js/sim.js`) — perspective follow-camera (Shen always centred),
  full-window responsive, 2D ground movement, depth-sorted billboard props
  (walk behind/in front), d-pad + keyboard, 6 collectible flowers; `/deploy` skill
  + GitHub Pages. **Live: https://metroxe.github.io/project-shanni-happy/**
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
- NEXT (ideas): more NPCs/quests; conversation state (remember choices) — persist into the
  reserved `npcs:{}` slot already in the save blob; more zones/goals;
  sound; idle polish. NOTE: photos in the macOS **Photos library** are unreadable from bash
  (TCC blocks `cp`/`sips`/`qlmanage` on `~/Pictures/Photos Library.photoslibrary/originals/…`)
  — have the user drag the image into chat or export it to `studio/refs/` to use as a gen ref.
