#!/usr/bin/env python
"""Generate a high-res, *seamlessly tileable* papercraft surface texture set.

Why this exists: the in-engine `paperTex()` (256px, fixed repeat) reads blurry and
stretched on big surfaces. This bakes crisp, tileable maps that — combined with the
world-space UV wiring in SKILL.md — give uniform texel density and no seams.

Tileability is by CONSTRUCTION: the grain is built from a random-phase 1/f spectrum
via inverse FFT, which is periodic, so left/right and top/bottom edges already match.
No seam-healing needed (unlike the Gemini path → see make_tileable.py).

Outputs (PNG) for a given --out prefix:
  <prefix>_color.png   subtle value-varied paper (near-neutral; TINT in-engine)
  <prefix>_bump.png    grayscale height (use as bumpMap, or derive normals)
  <prefix>_normal.png  tangent-space normal map (RGB)

Usage (run in the studio venv — pillow + numpy):
  studio/.venv/bin/python .claude/skills/papercraft-texture/gen_paper.py \
      --out studio/out/textures/paper --size 1024 --seed 7
  # optional: --tint e7edf2  bakes a base colour (usually leave neutral & tint in JS)
  # tuning: --fiber 0.6 (directional streaks) --grain 0.5 (fine tooth) --mottle 0.7
"""
import argparse, numpy as np
from PIL import Image


def _spectral_noise(n, beta, rng, anis=1.0):
    """Real periodic field from a random-phase 1/f^beta spectrum.

    anis>1 stretches features along x (horizontal paper fibres). Periodic → tileable.
    """
    fx = np.fft.fftfreq(n)[None, :]
    fy = np.fft.fftfreq(n)[:, None]
    radial = np.sqrt((fx * anis) ** 2 + (fy / anis) ** 2)
    radial[0, 0] = 1.0
    amp = radial ** (-beta / 2.0)
    amp[0, 0] = 0.0  # drop DC → zero mean
    phase = rng.uniform(0, 2 * np.pi, size=(n, n))
    field = np.fft.ifft2(amp * np.exp(1j * phase)).real
    field -= field.mean()
    s = field.std()
    return field / (s if s > 1e-9 else 1.0)


def _norm01(a):
    lo, hi = a.min(), a.max()
    return (a - lo) / (hi - lo + 1e-9)


def generate(out, size=1024, seed=0, fiber=0.55, grain=0.5, mottle=0.7,
             tint=None, contrast=0.12):
    rng = np.random.default_rng(seed)
    # three octaves: broad mottle, directional fibre, fine tooth — all periodic.
    broad = _spectral_noise(size, beta=3.2, rng=rng, anis=1.0)
    fibre = _spectral_noise(size, beta=2.2, rng=rng, anis=3.5)
    tooth = _spectral_noise(size, beta=1.1, rng=rng, anis=1.0)
    height = _norm01(mottle * broad + fiber * fibre + grain * tooth)

    # COLOUR: keep near-neutral and LOW contrast so it multiplies a material tint
    # without dirtying it. value = 1 - contrast*(0.5 - h)  → subtle light/dark grain.
    val = 1.0 - contrast * (0.5 - height)
    val = np.clip(val, 0.0, 1.0)
    if tint:
        t = tint.lstrip("#")
        base = np.array([int(t[i:i + 2], 16) for i in (0, 2, 4)], float) / 255.0
    else:
        base = np.array([1.0, 1.0, 1.0])
    color = (val[..., None] * base * 255).astype(np.uint8)

    # BUMP: the height itself, mild.
    bump = (_norm01(height) * 255).astype(np.uint8)

    # NORMAL: from height gradient (periodic gradient via np.roll keeps it tileable).
    h = height.astype(np.float32)
    strength = 2.0
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    nz = np.ones_like(h)
    inv = 1.0 / np.sqrt(dx * dx + dy * dy + nz * nz)
    normal = np.stack([-dx * inv, -dy * inv, nz * inv], -1)
    normal_rgb = ((normal * 0.5 + 0.5) * 255).astype(np.uint8)

    Image.fromarray(color, "RGB").save(out + "_color.png")
    Image.fromarray(bump, "L").save(out + "_bump.png")
    Image.fromarray(normal_rgb, "RGB").save(out + "_normal.png")
    print(f"WROTE {out}_color.png / _bump.png / _normal.png  ({size}x{size}, seamless)")

    # numeric seam proof: wrap deltas must sit inside the interior delta distribution.
    col = color.astype(float).mean(2)
    wrap_x = np.abs(col[:, 0] - col[:, -1]).mean()
    wrap_y = np.abs(col[0, :] - col[-1, :]).mean()
    inter = np.abs(np.diff(col, axis=1)).mean()
    print(f"seam check: wrapX={wrap_x:.2f} wrapY={wrap_y:.2f} interiorΔ={inter:.2f} "
          f"({'OK' if max(wrap_x, wrap_y) <= 1.6 * inter else 'CHECK'})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="output path prefix")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--fiber", type=float, default=0.55)
    ap.add_argument("--grain", type=float, default=0.5)
    ap.add_argument("--mottle", type=float, default=0.7)
    ap.add_argument("--contrast", type=float, default=0.12)
    ap.add_argument("--tint", default=None, help="bake a base hex (else neutral)")
    a = ap.parse_args()
    import os
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    generate(a.out, a.size, a.seed, a.fiber, a.grain, a.mottle, a.tint, a.contrast)


if __name__ == "__main__":
    main()
