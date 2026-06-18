#!/usr/bin/env python3
r"""Turn a raw MusicGen clip into a SEAMLESS OGG-Vorbis loop (deterministic).

MusicGen clips don't loop. We build a gapless loop with an equal-power crossfade
that overlaps the clip's TAIL back onto its HEAD: the resulting loop point lands
between two originally-consecutive samples, so there is no click and no harmonic
seam — guaranteed by construction, not by ear.

  loop = [ x[:c]*fade_in + x[N-c:]*fade_out , x[c:N-c] ]          (length N-c)
         \__ crossfade region (c samples) __/  \__ untouched body __/

At the wrap, loop[-1] == x[N-c-1] and loop[0] == x[N-c]: adjacent in the source.

Encoding uses `oggenc` (reference libvorbis) because this Homebrew ffmpeg ships
without libvorbis (only the lower-quality native 'vorbis' encoder).

  studio/.venv-music/bin/python studio/make_loop.py out/music/raw/calm-s0.wav \
      --xfade 4 --out out/music/calm.ogg
  studio/.venv-music/bin/python studio/make_loop.py --analyze out/music/raw/*.wav
"""
import argparse, subprocess, sys, tempfile, shutil
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).resolve().parent


def load_mono(path):
    x, sr = sf.read(str(path), always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    return x.astype(np.float64), sr


def features(path):
    """Cheap descriptors to compare candidates without ears.

    rms        — overall loudness (too low = empty, too high = not 'soft').
    centroid   — spectral brightness in Hz (calm pastel = mellow, not harsh).
    transient  — onset density: count of sharp frame-to-frame energy jumps per
                 second. Drums / percussion spike this; calm pads keep it ~0.
    """
    x, sr = load_mono(path)
    rms = float(np.sqrt(np.mean(x ** 2)))
    # frame energy at ~23ms hops
    hop = max(1, sr // 43)
    frames = [x[i:i + hop] for i in range(0, len(x) - hop, hop)]
    e = np.array([np.sqrt(np.mean(f ** 2)) + 1e-9 for f in frames])
    de = np.diff(e)
    # a "transient" = a positive jump well above the typical jump size
    thr = np.mean(np.abs(de)) * 3 + 1e-6
    transients = int(np.sum(de > thr))
    dur = len(x) / sr
    tps = transients / max(dur, 1e-6)
    # spectral centroid over the whole clip
    win = x * np.hanning(len(x))
    mag = np.abs(np.fft.rfft(win))
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    centroid = float(np.sum(freqs * mag) / (np.sum(mag) + 1e-9))
    peak = float(np.max(np.abs(x)))
    return dict(rms=rms, centroid=centroid, transient_per_s=tps, peak=peak, dur=dur)


def analyze(paths):
    rows = []
    for p in paths:
        f = features(p)
        rows.append((p, f))
        print(f"{Path(p).name:24s} dur={f['dur']:5.1f}s rms={f['rms']:.3f} "
              f"peak={f['peak']:.2f} centroid={f['centroid']:6.0f}Hz "
              f"transients/s={f['transient_per_s']:.2f}")
    # "calmest, healthiest": enough body (rms) but fewest transients, then mellower.
    def score(item):
        f = item[1]
        # reject near-silence; otherwise prefer few transients + lower brightness
        body = 0 if f["rms"] < 0.02 else 1
        return (-body, f["transient_per_s"], f["centroid"])
    best = sorted(rows, key=score)[0]
    print(f"\n[pick] calmest candidate -> {Path(best[0]).name}")
    return best[0]


def make_loop(inp, out, xfade):
    x, sr = load_mono(inp)
    n = len(x)
    c = int(round(xfade * sr))
    if c <= 0 or n <= 2 * c:
        print(f"[loop] clip too short ({n/sr:.1f}s) for {xfade}s crossfade", file=sys.stderr)
        sys.exit(2)
    t = np.linspace(0.0, 1.0, c, endpoint=False)
    fade_in = np.sin(0.5 * np.pi * t)      # equal-power: in^2 + out^2 == 1
    fade_out = np.cos(0.5 * np.pi * t)
    head, tail, body = x[:c], x[n - c:], x[c:n - c]
    cross = head * fade_in + tail * fade_out
    loop = np.concatenate([cross, body])
    # clean + peak-normalize hot (JS sub-bus plays it quiet under the SFX)
    loop = loop - float(np.mean(loop))
    peak = float(np.max(np.abs(loop))) or 1.0
    loop = loop / peak * 0.95

    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
        tmp = tf.name
    try:
        sf.write(tmp, loop.astype(np.float32), sr, subtype="PCM_16")
        if not shutil.which("oggenc"):
            print("[loop] oggenc not found (brew install vorbis-tools)", file=sys.stderr)
            sys.exit(3)
        # -q 3 ≈ ~112 kbps VBR; mono ambient → small file, clean quality.
        subprocess.run(["oggenc", tmp, "-q", "3", "--quiet", "-o", str(out)], check=True)
    finally:
        Path(tmp).unlink(missing_ok=True)

    kb = out.stat().st_size / 1024
    print(f"[loop] {inp} -> {out}  loop={len(loop)/sr:.1f}s  xfade={xfade:.1f}s  {kb:.0f} KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--analyze", action="store_true", help="print features for inputs, pick calmest, don't encode")
    ap.add_argument("--xfade", type=float, default=4.0)
    ap.add_argument("--out", default=str(HERE / "out" / "music" / "calm.ogg"))
    args = ap.parse_args()

    # resolve relative inputs against the studio dir for convenience
    inputs = [str(HERE / p) if not Path(p).is_absolute() and not Path(p).exists() else p for p in args.inputs]

    if args.analyze:
        analyze(inputs)
        return 0
    make_loop(inputs[0], args.out, args.xfade)
    return 0


if __name__ == "__main__":
    sys.exit(main())
