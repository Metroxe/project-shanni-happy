#!/usr/bin/env bash
# Per-worktree dev server for the papercraft game.
#
# Christopher always works in git worktrees and needs to view *this* worktree's
# version of the game — not the main checkout's. Each worktree gets its OWN port
# (a deterministic base derived from the worktree path, then the first free port
# from there up), so several worktrees can serve their own game at the same time
# without colliding, and the URL stays stable once chosen.
#
# This writes a git-ignored .claude/launch.json pointing the preview server at
# THIS worktree's studio/ and prints the URL. Start it with `preview_start game`.
#
#   .claude/serve.sh         configure + print http://localhost:<port>/game.html
#   .claude/serve.sh stop     tear the server down (kill the port, drop the config)
#
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
LJ="$ROOT/.claude/launch.json"

in_use()   { lsof -ti tcp:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
recorded() { [ -f "$LJ" ] && sed -n 's/.*"port"[: ]*\([0-9][0-9]*\).*/\1/p' "$LJ" | head -1; }

if [ "${1:-}" = "stop" ]; then
  P="$(recorded || true)"
  if [ -n "${P:-}" ]; then
    PIDS="$(lsof -ti tcp:"$P" 2>/dev/null || true)"
    [ -n "$PIDS" ] && kill $PIDS 2>/dev/null || true
    echo "stopped dev server on port ${P}"
  else
    echo "no dev server configured"
  fi
  rm -f "$LJ"
  exit 0
fi

PORT="$(recorded || true)"             # keep this worktree's existing port (stable URL)
if [ -z "${PORT:-}" ]; then            # first run: first free port from the deterministic base up
  PORT=$(( 8700 + $(printf '%s' "$ROOT" | cksum | cut -d' ' -f1) % 200 ))
  while in_use "$PORT"; do PORT=$((PORT + 1)); done
fi

cat > "$LJ" <<JSON
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "game",
      "runtimeExecutable": "python3",
      "runtimeArgs": ["-m", "http.server", "${PORT}", "--directory", "${ROOT}/studio"],
      "port": ${PORT}
    }
  ]
}
JSON

echo "http://localhost:${PORT}/game.html"
