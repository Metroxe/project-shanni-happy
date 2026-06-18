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
- NEXT (ideas): more NPCs/quests; conversation state (remember choices); more zones/goals;
  sound; idle polish. NOTE: photos in the macOS **Photos library** are unreadable from bash
  (TCC blocks `cp`/`sips`/`qlmanage` on `~/Pictures/Photos Library.photoslibrary/originals/…`)
  — have the user drag the image into chat or export it to `studio/refs/` to use as a gen ref.
