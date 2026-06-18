---
name: deploy
description: Deploy the game to GitHub Pages. Commits pending work, pushes main, and the Pages workflow builds & publishes the studio/ static site, then reports the live URL. Use when the user types /deploy or asks to deploy / publish / ship the game.
---

# /deploy — publish to GitHub Pages

The game is a static site. A GitHub Actions workflow (`.github/workflows/deploy.yml`)
assembles `studio/` into `_site/` (dropping the python/dev files) and publishes it to
GitHub Pages on every push to `main`. Entry point is `index.html` → redirects to
`game.html`.

Preconditions (already set up):
- Repo `Metroxe/project-shanni-happy` is **public** (Pages needs public on a Free plan).
- Pages source = **GitHub Actions** (the workflow self-enables via `configure-pages` `enablement: true`).
- Live URL: **https://metroxe.github.io/project-shanni-happy/**

## Steps

1. Make sure we're on `main` with the intended changes:
   ```sh
   git add -A
   git commit -m "deploy: <short summary of what changed>"   # skip if nothing to commit
   git push origin main
   ```
2. The push triggers the `Deploy to GitHub Pages` workflow. Watch it:
   ```sh
   gh run list --workflow=deploy.yml -L 1
   gh run watch $(gh run list --workflow=deploy.yml -L 1 --json databaseId --jq '.[0].databaseId') --exit-status
   ```
3. On success, report the live URL (and confirm it serves):
   ```sh
   gh api repos/Metroxe/project-shanni-happy/pages --jq .html_url
   curl -sI https://metroxe.github.io/project-shanni-happy/ | head -1
   ```
   Give the user the playable link: https://metroxe.github.io/project-shanni-happy/

## Notes
- Three.js loads from the unpkg CDN (works on Pages over https). All other paths in
  `game.html` are relative, so the project subpath (`/project-shanni-happy/`) just works.
- First-ever deploy can take a couple of minutes for Pages to provision; subsequent
  deploys are faster. If the run fails on the deploy step the very first time, re-run it
  (`gh run rerun <id>`) — Pages may have just finished enabling.
- To change what ships, edit the "Assemble static site" step in the workflow.
