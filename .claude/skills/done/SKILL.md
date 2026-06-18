---
name: done
description: Finish a git worktree work session — verify the tree is clean and the branch is merged into main, sync the main checkout, then exit/clean up the worktree. Use when the user says they're "done", wants to wrap up / finalize / close out / finish the current worktree, or runs /done.
---

# /done — finish a worktree work session

Wrap up the current git **worktree** session: make sure everything is committed and
landed on `main`, sync the primary checkout, then clean up the worktree. Pairs with
`/deploy` — that one *publishes* the site, `/done` *closes out the worktree* afterward.

This skill NEVER auto-commits, force-pushes, or discards unmerged work. If anything
isn't safe, stop and report rather than forcing it.

## 1. Confirm we're in a worktree
- `git rev-parse --is-inside-work-tree` and `git worktree list`.
- The current dir should be a *linked* worktree (e.g. under `.../.claude/worktrees/…`),
  not the main checkout. If we're on the main checkout or not in a worktree, there's
  nothing to finalize — say so and stop.

## 2. Require a clean tree
- `git status --porcelain`. If non-empty, STOP: ask the user to commit (or run
  `/deploy`) first. Do not auto-commit, stash, or discard their work.

## 3. Make sure the branch is on main
- `git fetch origin main -q`, then `git log --oneline origin/main..HEAD`:
  - **Empty** → already merged (e.g. `/deploy` pushed `HEAD:main`). Continue.
  - **Non-empty + fast-forwardable** (`git merge-base HEAD origin/main` == `origin/main`):
    ask if they want it on `main` now. If yes: `git push origin HEAD:main` (on this repo
    that also triggers the Pages deploy). If they'd rather not ship, leave it and note so.
  - **Diverged** (merge-base ≠ origin/main): STOP — a fast-forward isn't possible. Offer
    a merge or PR; never force-push.

## 4. Sync the main checkout
- From `git worktree list`, find the worktree whose branch is `main` (the primary
  checkout). Bring it current without leaving here:
  `git -C <main-path> merge --ff-only origin/main`.
- Skip with a note if it isn't on `main` or can't fast-forward — don't force.

## 5. Exit the worktree
- Call the harness **ExitWorktree** tool with `action: "remove"`. It refuses unless the
  work is committed + merged; only pass `discard_changes: true` with explicit user
  confirmation.
- NOTE: ExitWorktree only manages worktrees created via **EnterWorktree this session**.
  If this worktree was pre-spawned by the harness / FleetView, ExitWorktree is a no-op —
  do NOT `git worktree remove` the directory you're standing in. Instead report that the
  branch is landed and `main` synced, and the user can close/discard the worktree from
  their worktree UI.

## 6. Report
- The branch + sha that landed on `main`, whether the main checkout synced, and the
  worktree's final state (removed, or left for the user to close).

## Notes
- Project-local skill (lives beside `/deploy`). Copy to `~/.claude/skills/done/` to make
  it global across all worktree projects.
