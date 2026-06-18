#!/usr/bin/env python
"""Flat papercraft environment renderer (pure PIL, deterministic).
Reads a SceneSpec JSON and renders a PNG in the locked art direction:
flat pastel bands, soft rounded hills, cream die-cut paper props, Shen cutout.

Usage:  env-render.py <spec.json|--demo> <out.png>

SceneSpec = {
  name: str,
  palette: {sky, ground, path, shadow},          # hex (no #)
  hills:  [{color, xPct, widthPct, heightPct}],  # far, borderless
  clouds: [{xPct, yPct, scale}],                 # in the sky
  props:  [{type, xPct, scale, color?, color2?}],# type: tree|bush|house|rock|flower
  shen:   {xPct, scale}                          # optional, default centre
}
Props sit on the ground; scale (~0.3 far .. ~1.5 near) sets size AND depth.
"""
import sys, json
import os
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))
W, H = 1000, 640
HY = int(H * 0.60)            # horizon line
CREAM = (250, 246, 237)
SHEN_PNG = os.path.join(BASE, "out", "shen-paper.png")
SHEN_ASPECT = 0.4634

DEMO = {
  "name": "village path (demo)",
  "palette": {"sky": "eaf1ea", "ground": "e9e0cf", "path": "ddd0b8", "shadow": "3c3428"},
  "hills": [{"color": "dfe7d6", "xPct": 20, "widthPct": 48, "heightPct": 24},
            {"color": "e6dfe9", "xPct": 78, "widthPct": 58, "heightPct": 30}],
  "clouds": [{"xPct": 22, "yPct": 20, "scale": 1.0}, {"xPct": 70, "yPct": 14, "scale": 0.8}],
  "props": [{"type": "tree", "xPct": 12, "scale": 1.2, "color": "b9d3b0", "color2": "c2a98c"},
            {"type": "house", "xPct": 80, "scale": 0.9, "color": "f0c9c1", "color2": "c98f86"},
            {"type": "bush", "xPct": 30, "scale": 0.7, "color": "c7ddb8"},
            {"type": "tree", "xPct": 92, "scale": 0.7, "color": "cfe0bf", "color2": "c2a98c"},
            {"type": "flower", "xPct": 40, "scale": 0.6, "color": "f3b6c3"},
            {"type": "flower", "xPct": 63, "scale": 0.7, "color": "f4e2b8"},
            {"type": "rock", "xPct": 58, "scale": 0.6, "color": "cfcabd"}],
  "shen": {"xPct": 50, "scale": 0.95},
}


def hx(c, default):
    c = (c or default).lstrip('#')
    return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))


def depth_baseY(scale):
    t = max(0.0, min(1.0, (scale - 0.3) / 1.2))
    return HY + (H - HY) * (0.10 + 0.82 * t)


def paper_ellipses(d, boxes, fill, ow):
    for (x0, y0, x1, y1) in boxes:
        d.ellipse([x0 - ow, y0 - ow, x1 + ow, y1 + ow], fill=CREAM)
    for (x0, y0, x1, y1) in boxes:
        d.ellipse([x0, y0, x1, y1], fill=fill)


def paper_poly(d, pts, fill, ow):
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    big = [(cx + (x - cx) * (1 + ow / 40.0), cy + (y - cy) * (1 + ow / 40.0)) for (x, y) in pts]
    d.polygon(big, fill=CREAM)
    d.polygon(pts, fill=fill)


def paper_rect(d, box, fill, ow):
    x0, y0, x1, y1 = box
    d.rectangle([x0 - ow, y0 - ow, x1 + ow, y1 + ow], fill=CREAM)
    d.rectangle([x0, y0, x1, y1], fill=fill)


def draw_tree(d, cx, by, s, color, color2):
    ow = max(3, int(6 * s))
    tw, th = 16 * s, 70 * s
    canopy_r = 60 * s
    paper_rect(d, [cx - tw / 2, by - th, cx + tw / 2, by], hx(color2, 'c2a98c'), ow)
    cy = by - th - canopy_r * 0.7
    boxes = [(cx - canopy_r, cy - canopy_r, cx + canopy_r, cy + canopy_r),
             (cx - canopy_r * 1.4, cy + 6 * s - canopy_r * 0.8, cx - canopy_r * 0.2, cy + 6 * s + canopy_r * 0.8),
             (cx + canopy_r * 0.2, cy + 6 * s - canopy_r * 0.8, cx + canopy_r * 1.4, cy + 6 * s + canopy_r * 0.8)]
    paper_ellipses(d, boxes, hx(color, 'b9d3b0'), ow)


def draw_bush(d, cx, by, s, color, color2):
    ow = max(3, int(5 * s))
    r = 42 * s
    boxes = [(cx - r, by - 2 * r, cx + r, by),
             (cx - r * 1.7, by - r * 1.3, cx - r * 0.3, by),
             (cx + r * 0.3, by - r * 1.3, cx + r * 1.7, by)]
    paper_ellipses(d, boxes, hx(color, 'c7ddb8'), ow)


def draw_house(d, cx, by, s, color, color2):
    ow = max(3, int(6 * s))
    bw, bh = 150 * s, 110 * s
    paper_rect(d, [cx - bw / 2, by - bh, cx + bw / 2, by], hx(color, 'f0c9c1'), ow)
    roof = [(cx - bw / 2 - 14 * s, by - bh), (cx + bw / 2 + 14 * s, by - bh), (cx, by - bh - 70 * s)]
    paper_poly(d, roof, hx(color2, 'c98f86'), ow)
    dw, dh = 34 * s, 56 * s
    d.rectangle([cx - dw / 2, by - dh, cx + dw / 2, by], fill=hx(color2, 'c98f86'))
    ww = 26 * s
    d.rectangle([cx - bw / 2 + 18 * s, by - bh + 22 * s, cx - bw / 2 + 18 * s + ww, by - bh + 22 * s + ww],
                fill=CREAM)


def draw_rock(d, cx, by, s, color, color2):
    ow = max(2, int(4 * s))
    r = 34 * s
    paper_ellipses(d, [(cx - r, by - r * 1.1, cx + r, by)], hx(color, 'cfcabd'), ow)


def draw_flower(d, cx, by, s, color, color2):
    ow = max(2, int(3 * s))
    stem = 46 * s
    d.line([cx, by, cx, by - stem], fill=hx('9cbf9a', '9cbf9a'), width=max(2, int(4 * s)))
    pc = by - stem
    pr = 11 * s
    for ang in range(0, 360, 72):
        import math
        px = cx + math.cos(math.radians(ang)) * pr * 1.3
        py = pc + math.sin(math.radians(ang)) * pr * 1.3
        d.ellipse([px - pr, py - pr, px + pr, py + pr], fill=hx(color, 'f3b6c3'))
    d.ellipse([cx - pr * 0.7, pc - pr * 0.7, cx + pr * 0.7, pc + pr * 0.7], fill=CREAM)


DRAW = {"tree": draw_tree, "bush": draw_bush, "house": draw_house,
        "rock": draw_rock, "flower": draw_flower}


def render(spec, out, draw_shen=True):
    pal = spec.get('palette', {})
    SKY = hx(pal.get('sky'), 'eaf1ea')
    GROUND = hx(pal.get('ground'), 'e9e0cf')
    PATH = hx(pal.get('path'), 'ddd0b8')
    SHAD = hx(pal.get('shadow'), '3c3428')

    img = Image.new('RGB', (W, H), SKY)
    d = ImageDraw.Draw(img, 'RGBA')

    for c in spec.get('clouds', []):
        s = c.get('scale', 1.0)
        cx, cy = W * c.get('xPct', 50) / 100, H * c.get('yPct', 18) / 100
        r = 34 * s
        for (dx, dy, rr) in [(-r, 4, r), (0, -4, r * 1.25), (r, 4, r), (r * 1.9, 8, r * 0.8)]:
            d.ellipse([cx + dx - rr, cy + dy - rr, cx + dx + rr, cy + dy + rr], fill=(255, 255, 255, 235))

    for hsp in spec.get('hills', []):
        cx = W * hsp.get('xPct', 50) / 100
        hw = W * hsp.get('widthPct', 50) / 100
        hh = H * hsp.get('heightPct', 22) / 100
        d.ellipse([cx - hw / 2, HY - hh, cx + hw / 2, HY + hh * 0.4], fill=hx(hsp.get('color'), 'dfe7d6'))

    d.rectangle([0, HY, W, H], fill=GROUND)
    d.polygon([(W * 0.42, HY), (W * 0.58, HY), (W * 0.80, H), (W * 0.20, H)], fill=PATH)

    shen = spec.get('shen', {"xPct": 50, "scale": 0.95})
    drawables = []
    for p in spec.get('props', []):
        if p.get('type') in DRAW:
            p = dict(p); p['_baseY'] = depth_baseY(p.get('scale', 0.8)); p['_kind'] = 'prop'
            drawables.append(p)
    if draw_shen:
        sh = {"_kind": "shen", "_baseY": depth_baseY(shen.get('scale', 0.95)), **shen}
        drawables.append(sh)
    drawables.sort(key=lambda x: x['_baseY'])

    shen_img = Image.open(SHEN_PNG).convert('RGBA')
    for it in drawables:
        cx = W * it.get('xPct', 50) / 100
        by = it['_baseY']
        if it['_kind'] == 'prop':
            DRAW[it['type']](d, cx, by, it.get('scale', 0.8), it.get('color'), it.get('color2'))
        else:
            s = it.get('scale', 0.95)
            sh_h = int(H * 0.50 * s); sh_w = int(sh_h * SHEN_ASPECT)
            sw = shen_img.resize((sh_w, sh_h), Image.LANCZOS)
            sr = sh_w * 0.42
            d.ellipse([cx - sr, by - sr * 0.30, cx + sr, by + sr * 0.30],
                      fill=(SHAD[0], SHAD[1], SHAD[2], 70))
            img.paste(sw, (int(cx - sh_w / 2), int(by - sh_h)), sw)

    img.save(out)
    print("rendered", spec.get('name', '?'), "->", out)


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else '--demo'
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(BASE, "out", "env-demo.png")
    spec = DEMO if arg == '--demo' else json.load(open(arg))
    render(spec, out)
