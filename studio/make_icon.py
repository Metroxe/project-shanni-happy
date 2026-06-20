#!/usr/bin/env python3
"""App icon for project-shanni-happy: Shen's actual bucket hat, lifted straight
from the game cutout so it matches the in-game character exactly (dusty rose,
bold dark outline, dashed stitch line), composited onto a calm pastel ground.

Programmatic + on-aesthetic (no hand-drawn asset): we isolate the hat from
out/shen-cut.png, then render the PWA / iOS home-screen sizes.

    studio/.venv/bin/python studio/make_icon.py

Outputs (committed; the deploy ships them): out/apple-touch-icon.png (180),
out/icon-192.png, out/icon-512.png, out/favicon-32.png. Needs Pillow
(in requirements.txt). Stripped tooling: the .py is removed from the deployed
site by CI; the PNGs are what ship.
"""
import os
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SRC = os.path.join(OUT, "shen-cut.png")

BG_TOP = (254, 245, 240)   # warm cream, complements the rose hat
BG_BOT = (242, 226, 220)


def is_pink(r, g, b, a):
    return a > 120 and r > 172 and 105 < g < 208 and 105 < b < 208 and (r - g) > 26 and abs(g - b) < 38


def isolate_hat(src):
    """Keep only the hat: scan each column for the hat's rose, then clip below a
    smooth brim-bottom arc (the brim droops lower at the sides) so the face,
    glasses and hair under the brim drop away. Finally strip any near-white skin
    that pokes through at the brim's inner edge."""
    W, H = src.size
    px = src.load()
    out = src.copy()
    opx = out.load()
    SCAN = 300
    # rough column cut at the lowest rose pixel (drops most of the body/jacket)
    for x in range(W):
        last = -1
        for y in range(min(SCAN, H)):
            if is_pink(*px[x, y]):
                last = y
        if last < 0:
            for y in range(H):
                opx[x, y] = (0, 0, 0, 0)
        else:
            for y in range(last + 8, H):
                opx[x, y] = (0, 0, 0, 0)
    # smooth brim-bottom arc clip (in the hat's own bbox space)
    box = out.getbbox()
    ox0, oy0, ox1, oy1 = box
    hw = ox1 - ox0
    cx = ox0 + hw / 2
    A, SIDE = 150, 200          # center cut / side cut, measured from bbox top
    for x in range(ox0, ox1):
        arc = oy0 + A + (SIDE - A) * ((x - cx) / (hw / 2)) ** 2
        for y in range(H):
            if y > arc:
                opx[x, y] = (0, 0, 0, 0)
    # remove leftover dark "teeth" (bangs / hairline) at the brim's inner bottom
    # center, staying clear of the bold side outline (which lives in outer columns)
    bx0, by0, bx1, by1 = out.getbbox()
    bw, bh = bx1 - bx0, by1 - by0
    for x in range(int(bx0 + 0.26 * bw), int(bx0 + 0.74 * bw)):
        for y in range(int(by0 + 0.62 * bh), by1):
            r, g, b, a = opx[x, y]
            if a > 0 and r < 130 and g < 130 and b < 130:
                opx[x, y] = (0, 0, 0, 0)
    # strip near-white skin specks (the hat has no white)
    for x in range(W):
        for y in range(H):
            r, g, b, a = opx[x, y]
            if a > 0 and r > 236 and g > 214 and b > 198:
                opx[x, y] = (0, 0, 0, 0)
    return out.crop(out.getbbox())


def background(size):
    col = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / (size - 1)
        col.putpixel((0, y), tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))
    return col.resize((size, size)).convert("RGBA")


def build_512(hat):
    S = 512
    img = background(S)
    target_w = 366                      # ~71% wide → safe for a maskable/round crop
    scale = target_w / hat.width
    hw, hh = target_w, int(hat.height * scale)
    h = hat.resize((hw, hh), Image.LANCZOS)
    hx, hy = (S - hw) // 2, (S - hh) // 2 - 8
    # soft contact/drop shadow under the hat
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    silh = Image.new("RGBA", h.size, (70, 60, 44, 255))
    silh.putalpha(h.split()[-1])
    sh.paste(silh, (hx, hy + 16), silh)
    sh = sh.filter(ImageFilter.GaussianBlur(11))
    sa = sh.split()[-1].point(lambda v: int(v * 0.28))
    sh.putalpha(sa)
    img.alpha_composite(sh)
    img.alpha_composite(h, (hx, hy))
    return img


def main():
    src = Image.open(SRC).convert("RGBA")
    hat = isolate_hat(src)
    icon = build_512(hat)

    def emit(path, size, rgb):
        out = icon if size == 512 else icon.resize((size, size), Image.LANCZOS)
        # apple-touch icons flatten to opaque RGB — iOS composites any alpha to
        # black, and a screenshot fallback creeps in if the icon looks "empty".
        out = out.convert("RGB") if rgb else out.convert("RGBA")
        out.save(path)
        print("wrote", os.path.relpath(path, HERE), f"{size}px")

    emit(os.path.join(OUT, "icon-512.png"), 512, False)
    emit(os.path.join(OUT, "icon-192.png"), 192, False)
    emit(os.path.join(OUT, "favicon-32.png"), 32, False)
    # apple-touch-icon at the standard iPhone/iPad sizes (opaque)
    for sz in (180, 167, 152):
        nm = "apple-touch-icon.png" if sz == 180 else f"apple-touch-icon-{sz}.png"
        emit(os.path.join(OUT, nm), sz, True)
    # iOS root-convention fallbacks: Safari fetches /apple-touch-icon.png and
    # /apple-touch-icon-precomposed.png from the site root when adding to the Home
    # Screen. Served at root on the tunnel + user/org Pages; harmless elsewhere.
    for nm in ("apple-touch-icon.png", "apple-touch-icon-precomposed.png"):
        emit(os.path.join(HERE, nm), 180, True)


if __name__ == "__main__":
    main()
