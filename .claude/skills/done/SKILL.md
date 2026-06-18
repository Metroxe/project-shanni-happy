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

## Step 2 — Handle pending work
If `HAD_PENDING` is false (clean tree, everything already on `main`), skip to Step 3.

Otherwise ask with **AskUserQuestion** (header "Pending"):
- **Ship it (/deploy)** *(recommended when the work is finished)* — invoke the `/deploy` skill; let it run all the way to merge + live. Shipping always goes through `/deploy`'s PR — never push to `main` here.
- **Stash** — `git stash push -u -m "done: <short context>"` (recover later with `git stash pop`).
- **Leave it** — keep the branch + worktree + dev server exactly as-is to return to later; skip the teardown (go straight to Step 7, Report).
- **Discard** — destructive; confirm first, then `git reset --hard && git clean -fd`.

Execute the choice and confirm it finished before continuing.

## Step 3 — Confirm the branch landed, decide teardown
```sh
git fetch origin main -q
git log --oneline HEAD..origin/main     # empty ⇒ everything is on main
```
- **Not landed** and the user didn't choose "Leave it" → **stop and report.** Don't delete unmerged work; offer to run `/deploy`.
- **Landed** (or user explicitly OK'd losing it) → continue.

Decide `REMOVE` (read by Step 6):
- `HAD_PENDING` was false → nothing to come back to; `REMOVE = true` (no prompt).
- `HAD_PENDING` was true (now resolved) → ask with **AskUserQuestion** (header "Worktree"): **Remove it** (`REMOVE = true`) vs **Keep it** (`REMOVE = false`).

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

## Step 7 — Report
The branch + sha that landed on `main`, whether the main checkout synced, that **this
session's** serve + Claude preview were stopped (and that other sessions' servers/previews
were left running), and the worktree's final state (removed / kept / left for the user to close).

## Notes
- Project-local skill (lives beside `/deploy`). Copy to `~/.claude/skills/done/` to make
  it global across worktree projects.
