---
name: deploy
description: Ship the current worktree's work live (GitHub Pages) through a pull request — commit, push the branch, open a PR, wait for the `smoke` check to go green, merge, then watch the Pages deploy and verify the live URL. Aware of other in-flight sessions/PRs and never pushes to main directly. Use when the user types /deploy or asks to deploy / publish / ship / go live.
---

# /deploy — ship via PR → green → merge → Pages

Take the current branch's work live at **https://metroxe.github.io/project-shanni-happy/**.
Everything reaches `main` through a **pull request** that must pass the **`smoke`** check
(headless boot test, `.github/workflows/ci.yml`) before merge. `main` is **branch-protected
— never push to it directly.** Merging the PR triggers the Pages deploy
(`.github/workflows/deploy.yml`, runs on push to `main`).

Repo: `Metroxe/project-shanni-happy`.

**Run it through.** Narrate each step; don't pause for routine confirmations (staging,
opening the PR, merging your own green PR). Stop only for real decisions: ambiguous scope,
unexpected diffs, a failing check, or a peer session in flight.

## Phase 0 — Pre-flight & peer detection (always)

```sh
git rev-parse --abbrev-ref HEAD                      # branch (must NOT be main)
git status --short                                   # pending work?
git fetch origin main -q
git log --oneline HEAD..origin/main                  # did main advance under us?
gh pr list  -R Metroxe/project-shanni-happy --state open --json number,title,headRefName,updatedAt,isDraft
gh run list -R Metroxe/project-shanni-happy --limit 8 --json status,conclusion,name,event,headBranch,databaseId
```

Classify (first match wins):
- **HEAD is `main`** → stop. A worktree session should be on its own branch; do not commit on `main`.
- **A PR already open for this branch, no new local changes** → jump to Phase 3 (watch → merge).
- **Working tree dirty** → Phase 1.
- **Clean tree and your work already on `main`** (`HEAD..origin/main` shows it landed) → nothing to ship; jump to Phase 5.

**Peers — surface, don't barge through:**
- `origin/main` advanced → show the new commits + authors; flag any that touch your files.
- **Duplicate guard:** if `git diff HEAD origin/main -- <your changed files>` shows your change is *already on `main`* (a peer landed an equivalent), **STOP and report** — don't open a redundant PR. (This is the exact failure we are designing against.)
- Another open PR touching the same files, or an in-progress deploy with a different head SHA → surface it; offer wait / proceed / abort.

## Phase 1 — Commit & push the branch

1. Review `git diff` and `git diff --cached`. Write a clear commit subject + body in the repo's voice. One commit unless the changes are logically distinct.
2. You're in a worktree, so you're already on a feature branch — **stay on it.** Never commit on `main`. (If somehow on `main`: `git checkout -b <kebab-slug>` first.)
3. ```sh
   git add -A
   git commit -m "<subject>" -m "<body>"
   git push -u origin HEAD
   ```

## Phase 2 — Open the PR

```sh
gh pr create -R Metroxe/project-shanni-happy --base main --head "$(git rev-parse --abbrev-ref HEAD)" \
  --title "<subject>" --body "$(cat <<'EOF'
## Summary
- <what changed & why>

## Verification
- `smoke` check (headless boot) gates this PR
- <anything verified in preview>
EOF
)"
```
If a PR for this branch already exists, reuse it (`gh pr view --json number,url`).

## Phase 3 — Wait for green, stay current with main, merge

1. Block on checks:
   ```sh
   gh pr checks <N> -R Metroxe/project-shanni-happy --watch
   ```
   If `smoke` (or any required check) fails → `gh run view <id> -R Metroxe/project-shanni-happy --log-failed`, surface it, **stop. Never merge red.** Fix in the worktree, push; checks re-run.
2. Confirm the branch is current with `main`:
   ```sh
   gh pr view <N> -R Metroxe/project-shanni-happy --json mergeStateStatus,headRefName,baseRefName
   ```
   - `BEHIND` → main moved. **Read what landed before merging:**
     ```sh
     git fetch origin main -q
     git log --oneline HEAD..origin/main
     git diff HEAD...origin/main
     ```
     Evaluate open-endedly: does it overlap your files, invalidate your assumptions, or duplicate your work? If anything warrants a pause, **stop and surface specifics.** If clean:
     ```sh
     gh pr update-branch <N> -R Metroxe/project-shanni-happy
     ```
     Loop back to step 1 (the update re-runs `smoke`).
   - `CLEAN` (or only non-required red) → proceed.
3. Squash-merge and delete the remote branch:
   ```sh
   gh pr merge <N> -R Metroxe/project-shanni-happy --squash --delete-branch
   ```
   If "not mergeable" → main moved again; back to step 2.

## Phase 4 — Watch the Pages deploy

```sh
gh run list -R Metroxe/project-shanni-happy --workflow=deploy.yml -L 1
gh run watch $(gh run list -R Metroxe/project-shanni-happy --workflow=deploy.yml -L 1 --json databaseId --jq '.[0].databaseId') --exit-status
```
On failure → `gh run view <id> --log-failed`, surface it.

## Phase 5 — Verify live & report

```sh
curl -sI https://metroxe.github.io/project-shanni-happy/ | head -1     # expect HTTP/2 200
```
Spot-check the deployed `game.html` contains your change if useful. Report: PR # + URL,
`smoke` result, deploy run, live URL, and what shipped.

## Phase 6 — Stay in the worktree (refresh, don't re-branch)

Only when in a worktree **and** the tree is clean:
```sh
git fetch origin main -q
git reset --hard origin/main      # branch now sits at the merged main tip
```
Narrate: *"Refreshed `<branch>` to merged `main` (`<sha>`) — staying in this worktree;
further work stacks here and the next /deploy re-PRs the same branch."* The remote branch
was deleted on merge, so the next `git push -u origin HEAD` opens a clean new PR off the
same name.

## Guards
- Clean tree only for the refresh; worktree only (never touch `main` in the primary checkout).
- Never `git push` to `main`, never force-push to `main`, never bypass the `smoke` gate.
- Branch protection lets admins override in a pinch — don't. Always go through the PR.

## Notes
- Pages deploy assembles `studio/` → `_site` (drops python/dev files). Tooling outside
  `studio/` (CI, tests, skills, `package.json`) is never shipped to the site.
- Project-local skill; pairs with `/done` (which closes out the worktree afterward).
