#!/usr/bin/env bash
# One-shot driver: build the music venv (if needed), generate NIGHT-themed MusicGen
# candidates, and crossfade-loop each seed into a candidate OGG. Then pick the cleanest
# BROWSER loop with qa/scenarios/music-seam.mjs and copy it to out/music/night.ogg.
# NOTE: keep echoes ASCII ('...' not a unicode ellipsis) — a multibyte char in an echo
# trips 'set -u' parsing on this bash.
set -euo pipefail
cd "$(dirname "$0")"                       # studio/
VENV=.venv-music
PY="$VENV/bin/python"
mkdir -p out/music/raw out/music/cand

NIGHT_PROMPT="calm quiet nighttime ambient music for a cozy papercraft town after dark, soft warm felt piano and gentle glassy music-box bells, mellow analog pad, slow sparse peaceful and dreamy, tender reassuring, gentle nighttime hush, lo-fi and minimal, no drums, no percussion, no beat, soft and quiet"

if [ ! -x "$PY" ]; then
  echo "[night] creating music venv ..."
  uv venv --python 3.12 "$VENV"
  uv pip install --python "$PY" -r requirements-music.txt
fi

echo "[night] generating candidates (seeds 0,1,2) ..."
# Force CPU: MusicGen on MPS gets SIGKILL'd here (Metal allocation spike), even small.
# CPU uses swappable system RAM (plenty free) -- slower but reliable. musicgen-small is
# plenty for a calm ambient loop (medium is heavier).
"$PY" gen_music.py --name night --seeds 0,1,2 --dur 30 \
  --model facebook/musicgen-small --device cpu \
  --prompt "$NIGHT_PROMPT"

echo "[night] analyzing ..."
"$PY" make_loop.py --analyze out/music/raw/night-s*.wav || true

# crossfade-loop EACH seed into a candidate (the cleanest browser wrap is decoder-dependent,
# so build them all and choose by the seam check, not just make_loop's calmest score).
for s in 0 1 2; do
  echo "[night] looping seed $s ..."
  "$PY" make_loop.py "out/music/raw/night-s${s}.wav" --xfade 4 \
    --out "out/music/cand/night-s${s}.ogg" || true
done

echo "[night] done -- candidates in out/music/cand/. Pick the cleanest BROWSER loop:"
echo "  node studio/qa/scenarios/music-seam.mjs out/music/cand/night-s*.ogg"
echo "  cp -f out/music/cand/night-s<best>.ogg out/music/night.ogg   # lowest wrap/p999"
ls -la out/music/cand/
