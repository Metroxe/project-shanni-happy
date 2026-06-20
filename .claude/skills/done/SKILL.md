---
name: done
description: Finish a git worktree work session — resolve any pending work, confirm it landed on main via its PR, stop this session's serve + Claude preview (this worktree only, never other sessions'), sync the primary checkout, then clean up the worktree. Pairs with /deploy. Use when the user says they're done / wrap up / finalize / close out / finish the current worktree, or runs /done.
---

# /done — finish a worktree work session

Close out the current **worktree** session: resolve any pending work, confirm it landed
on `main` **through its PR** (`main` is branch-protected — nothing reaches it by direct
push), stop **this session's** serve + Claude preview (this worktree only — never other
concurrent sessions'), sync the primary checkout, then tear down the worktree. Pairs with
`/deploy` (which ships).

NEVER auto-commit, force-push, push to `main` directly, or discard unmerged work without
explicit confirmation. If anything isn't safe, stop and report.

**Minimize interaction — you're wrapping up a job you were trusted to finish, not checking
in.** The only thing you may prompt for is the single go-live gate in Step 2 (and only when
there's pending work). Worktree teardown and serve/preview shutdown happen silently. End on
a one-line goal verdict.

## Step 0 — Snapshot pending state
```sh
git rev-parse --abbrev-ref HEAD
git status -sb
git fetch origin main -q
git log --oneline HEAD..origin/main     # local commits not yet on main
```
`HAD_PENDING` = dirty working tree **OR** local commits not on `main`. Remember it; later steps read it.

## Step 1 — Confirm we're in a worktree
```sh
[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ] && echo worktree || echo main
```
If this is the main checkout (not a linked worktree), there's nothing to finalize — say so and stop.

## Step 2 — The go-live gate (the one decision that's the user's)
If `HAD_PENDING` is false (clean tree, everything already on `main`), skip to Step 3.

Otherwise this is the single human decision in the wrap-up. Ask with **AskUserQuestion**
(header "Ship it?"), and **lead the question text with the goal verdict** so the user knows
what they're approving — e.g. *"Goal: pet-shop music per-scene. Done and QA-clean. Go live?"*
- **Ship it (/deploy)** *(default — work finished and meant to go live)* — invoke the
  `/deploy` skill; let it run all the way to merge + live (silently). Shipping always goes
  through `/deploy`'s PR — never push to `main` here.
- **Stash** — `git stash push -u -m "done: <short context>"` (recover later with `git stash pop`).
- **Leave it** — keep the branch + worktree + dev server as-is to return to later; skip the teardown (go straight to Step 7).
- **Discard** — destructive, work gone for good; never pick this yourself — only on the user's explicit say-so.

Execute the choice and confirm it finished. Once the user says ship, everything downstream
(merge, deploy, sync, teardown, close) is yours to finish without further prompts — unless
`/deploy` hits an irreversible/catastrophic snag (see its recoverable-vs-catastrophic line).

## Step 3 — Confirm the branch landed, decide teardown
```sh
git fetch origin main -q
git log --oneline HEAD..origin/main     # empty ⇒ everything is on main
```
- **Not landed** and the user didn't choose "Leave it" → **stop and report.** Don't delete unmerged work; offer to run `/deploy`.
- **Landed** (or user explicitly OK'd losing it) → continue.

Decide `REMOVE` (read by Step 6) — **silently, no prompt.** Once the work has landed on
`main` (confirmed above) there's nothing to come back to and removing the worktree is safe
and reversible (its commits are on `main`), so `REMOVE = true`. The only way to keep it is
the explicit "Leave it" choice in Step 2, which already skipped to Step 7.

## Step 4 — Sync the primary checkout
Bring the `main` checkout current without leaving here:
```sh
MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
git -C "$MAIN" merge --ff-only origin/main 2>&1 || echo "skip: main checkout not fast-forwardable"
```
Skip with a note if it isn't on `main` or can't fast-forward — don't force.

## Step 5 — Stop ONLY this session's serve + Claude preview

> ⚠️ **Cardinal guard — scope to THIS worktree, never a blanket stop.** Many sessions
> run concurrently, each with its own serve + its own Claude preview. Identify this
> session's resources by **this worktree's absolute path / its own port**, and stop
> *only* those. A blanket `preview_stop` of everything, or running `serve.sh stop` /
> killing a port that isn't this worktree's, kills someone else's live session. Do NOT
> do that. When in doubt, leave it running and report it instead of stopping it.

Run this **before** the teardown (Step 6), while we're still inside the worktree.

1. **Dev server (localhost serve).** `.claude/serve.sh stop` is per-worktree by design —
   it reads *this* worktree's own `.claude/launch.json` (its unique port + pid) and only
   stops that one. Run it from inside the worktree:
   ```sh
   WT=$(git rev-parse --show-toplevel)        # this worktree's absolute path
   .claude/serve.sh stop                       # frees THIS worktree's port, removes its launch.json
   ```
2. **Claude preview.** The harness can hold previews from many worktrees at once, so you
   must filter:
   - Call **preview_list** — it returns `{serverId, cwd, port}` per running preview.
   - For each entry whose **`cwd` exactly equals `$WT`**, call **preview_stop** with that
     `serverId`. That is this session's preview.
   - **Leave every other entry running** — those belong to other sessions/worktrees (and
     possibly other projects entirely). If *no* entry matches `$WT`, there is nothing to
     stop (already gone) — stop nothing.
3. **Verify (optional, read-only).** Confirm this worktree's port has no listener and the
   preview is gone, without touching anything else:
   ```sh
   PORT=$(sed -n 's/.*"port"[: ]*\([0-9]*\).*/\1/p' .claude/launch.json 2>/dev/null)
   [ -n "$PORT" ] && (lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 && echo "!! still up on $PORT" || echo "OK: $PORT down")
   ```
   Then re-run **preview_list** and confirm no entry's `cwd` is `$WT`.

## Step 6 — Remove the worktree (only if `REMOVE`)
If `REMOVE` is false (user chose "Keep it"), skip to Step 7.
1. Prefer the harness: call **ExitWorktree** with `action: "remove"` (add `discard_changes: true` only with explicit confirmation). It refuses unless work is committed + merged.
2. If ExitWorktree reports **no active worktree session** (this worktree was pre-spawned by the app / FleetView, not created via `EnterWorktree`), do **not** `git worktree remove` the directory you're standing in. Run from the main checkout as the **last** shell action (the current dir vanishes):
   ```sh
   MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
   CUR=$(git rev-parse --show-toplevel); BR=$(git rev-parse --abbrev-ref HEAD)
   git -C "$MAIN" worktree remove --force "$CUR"
   git -C "$MAIN" branch -D "$BR"
   ```
   …or tell the user to close it from their worktree UI.

## Step 7 — Report — one line, goal verdict first
End with a single line that names the goal and verdicts it, so when the user reopens this
session cold they instantly know where it landed — e.g. *"Done. Pet-shop music shipped and
live. Nothing needs you."* If something's still alive (a kept worktree, an ambiguous
resource you left running) name it in that line; otherwise end on "Nothing needs you." Keep
the detail (branch/sha, sync status, what was stopped) in your back pocket for if asked.

## Notes
- Project-local skill (lives beside `/deploy`). Copy to `~/.claude/skills/done/` to make
  it global across worktree projects.
