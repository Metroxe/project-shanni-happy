#!/usr/bin/env python
"""Make an arbitrary image (e.g. a Gemini-generated paper/material surface) seamlessly
tileable, and PROVE the seam is gone — same ethos as the music-loop crossfade.

The procedural `gen_paper.py` is tileable by construction; use THIS only for
photographic / image-gen inputs that aren't periodic.

Method: offset by half (np.roll) so the seams move to the centre cross, then heal that
cross with a feathered linear blend against the un-rolled copy. Works well for
high-frequency, non-structured surfaces (paper, plaster, fabric); it will smear strong
large-scale structure — for that, regenerate rather than force-tile.

Usage:
  studio/.venv/bin/python .claude/skills/papercraft-texture/make_tileable.py \
      in.png out.png --feather 48
Verifies and prints PASS/FAIL on the wrap-vs-interior seam metric.
"""
import argparse, numpy as np
from PIL import Image


def _feather_heal(a, feather):
    """Heal the centre cross created by a half-offset, with a cosine feather band."""
    h, w = a.shape[:2]
    f = min(feather, w // 4, h // 4)
    out = a.copy()
    ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, 2 * f))  # 0..1 across the band
    # vertical seam at x=w//2: blend a band [w//2-f, w//2+f) with its mirror
    xs = slice(w // 2 - f, w // 2 + f)
    band = out[:, xs].astype(np.float32)
    mirror = band[:, ::-1]
    w_ramp = ramp[None, :, None]
    out[:, xs] = (band * (1 - w_ramp) + mirror * w_ramp).astype(a.dtype)
    # horizontal seam at y=h//2
    ys = slice(h // 2 - f, h // 2 + f)
    band = out[ys, :].astype(np.float32)
    mirror = band[::-1, :]
    h_ramp = ramp[:, None, None]
    out[ys, :] = (band * (1 - h_ramp) + mirror * h_ramp).astype(a.dtype)
    return out


def seam_metric(a):
    g = a.astype(float).mean(2) if a.ndim == 3 else a.astype(float)
    wrap = max(np.abs(g[:, 0] - g[:, -1]).mean(), np.abs(g[0, :] - g[-1, :]).mean())
    inter = np.abs(np.diff(g, axis=1)).mean()
    return wrap, inter


def make_tileable(inp, outp, feather=48):
    im = Image.open(inp).convert("RGB")
    a = np.asarray(im)
    h, w = a.shape[:2]
    rolled = np.roll(np.roll(a, w // 2, 1), h // 2, 0)
    healed = _feather_heal(rolled, feather)
    Image.fromarray(healed, "RGB").save(outp)
    wrap, inter = seam_metric(healed)
    ok = wrap <= 1.6 * inter
    print(f"WROTE {outp}  seam wrap={wrap:.2f} interiorΔ={inter:.2f} "
          f"→ {'PASS' if ok else 'FAIL (regenerate / raise --feather)'}")
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inp")
    ap.add_argument("outp")
    ap.add_argument("--feather", type=int, default=48)
    a = ap.parse_args()
    make_tileable(a.inp, a.outp, a.feather)


if __name__ == "__main__":
    main()
