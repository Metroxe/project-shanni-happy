#!/usr/bin/env python
"""Render every SceneSpec from the workflow output and assemble a labeled
contact sheet for the user to choose from."""
import json, os
from PIL import Image, ImageDraw, ImageFont
import importlib.util, sys

BASE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("er", os.path.join(BASE, "env_render.py"))
er = importlib.util.module_from_spec(spec); spec.loader.exec_module(er)

OUT = os.path.join(BASE, "out")
wrap = json.load(open(os.path.join(BASE, "specs", "all.json")))
specs = wrap["result"] if isinstance(wrap, dict) else wrap
if isinstance(specs, str):
    specs = json.loads(specs)

def font(sz):
    for p in ["/System/Library/Fonts/SFNS.ttf", "/System/Library/Fonts/Helvetica.ttc"]:
        try: return ImageFont.truetype(p, sz)
        except: pass
    return ImageFont.load_default()

paths = []
for i, sp in enumerate(specs, 1):
    p = f"{OUT}/env-{i}.png"
    er.render(sp, p)
    paths.append((i, sp.get("name", f"scene {i}"), p))

cols = 2
tw = 480
ims = [Image.open(p).convert("RGB") for _, _, p in paths]
r = tw / ims[0].width
th = int(ims[0].height * r)
pad, top, gap = 12, 34, 14
rows = (len(ims) + cols - 1) // cols
W = pad + (tw + gap) * cols - gap + pad
Hh = pad + (th + top) * rows
sheet = Image.new("RGB", (W, Hh), (243, 241, 236))
d = ImageDraw.Draw(sheet)
f = font(19); fn = font(15)
for idx, (n, name, _) in enumerate(paths):
    cx = pad + (idx % cols) * (tw + gap)
    cy = pad + (idx // cols) * (th + top)
    d.rectangle([cx, cy, cx + 150, cy + 24], fill=(194, 125, 139))
    d.text((cx + 7, cy + 4), f"{n}  {name}", fill=(255, 255, 255), font=fn)
    sheet.paste(ims[idx].resize((tw, th)), (cx, cy + top))
    d.rectangle([cx, cy + top, cx + tw - 1, cy + top + th - 1], outline=(214, 201, 178), width=2)
sheet.save(f"{OUT}/env-contact.png")
sheet.save(f"{OUT}/env-contact.jpg", quality=86)
print("sheet", sheet.size, "scenes", [n for _, n, _ in paths])
