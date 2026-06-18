#!/usr/bin/env python
"""Cut chibi #4 out of its flat background and build a Paper-Mario die-cut.
Outputs:
  out/shen-cut.png   -> figure only, transparent (reusable game asset)
  out/shen-paper.png -> figure + cream sticker border + darker outer stroke
Prints the paper PNG width/height and the foot-baseline ratio (for ground anchoring).
"""
import sys, os, numpy as np
from PIL import Image
from scipy import ndimage

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "refs", "shen-chibi-4.png")
OUT = os.path.join(BASE, "out")

im = Image.open(SRC).convert("RGB")
arr = np.asarray(im).astype(np.int16)
H, W, _ = arr.shape

# background colour = median of the 1px frame
edge = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]], axis=0)
bg = np.median(edge, axis=0)
dist = np.sqrt(((arr - bg) ** 2).sum(axis=2))

# bg = anything close to the frame colour (also catches the soft floor shadow)
isbg = dist < 78

# outside = bg-coloured region connected to the border (keeps any bg-coloured
# interior pixel as foreground, which a plain colour-key would wrongly drop)
lbl, n = ndimage.label(isbg)
border_labels = set(lbl[0]) | set(lbl[-1]) | set(lbl[:, 0]) | set(lbl[:, -1])
border_labels.discard(0)
outside = np.isin(lbl, list(border_labels))
fg = ~outside

# keep only the largest blob -> drops stray specks / detached shadow bits
lbl2, n2 = ndimage.label(fg)
sizes = ndimage.sum(np.ones_like(lbl2), lbl2, range(1, n2 + 1))
fg = lbl2 == (1 + int(np.argmax(sizes)))
fg = ndimage.binary_fill_holes(fg)

# drop the outermost 1px ring (anti-aliased against teal -> would fringe)
fg_core = ndimage.binary_erosion(fg, iterations=1)

struct = ndimage.generate_binary_structure(2, 2)  # 8-connected
BORDER = 18
paper = ndimage.binary_dilation(fg, structure=struct, iterations=BORDER)
ring  = ndimage.binary_dilation(paper, structure=struct, iterations=3)

cream  = np.array([250, 246, 237], np.uint8)
stroke = np.array([214, 201, 178], np.uint8)

# ---- figure-only transparent asset ----
cut = np.zeros((H, W, 4), np.uint8)
for c in range(3):
    cut[..., c] = arr[..., c]
af = ndimage.gaussian_filter((fg_core * 255).astype(np.float32), 0.6)
cut[..., 3] = af.astype(np.uint8)

# ---- paper sticker ----
paper_img = np.zeros((H, W, 4), np.uint8)
paper_img[ring]  = [*stroke, 255]
paper_img[paper] = [*cream, 255]
for c in range(3):
    paper_img[..., c] = np.where(fg_core, arr[..., c], paper_img[..., c])
paper_img[..., 3] = np.where(ring, 255, 0)

# crop both to the ring bbox + small pad
ys, xs = np.where(ring)
pad = 6
y0, y1 = max(0, ys.min() - pad), min(H, ys.max() + 1 + pad)
x0, x1 = max(0, xs.min() - pad), min(W, xs.max() + 1 + pad)

paper_c = paper_img[y0:y1, x0:x1]
cut_c   = cut[y0:y1, x0:x1]
Image.fromarray(paper_c, "RGBA").save(f"{OUT}/shen-paper.png")
Image.fromarray(cut_c,   "RGBA").save(f"{OUT}/shen-cut.png")

# foot baseline: lowest opaque row of the *figure*, as a ratio of the paper height
fys = np.where(fg[y0:y1, x0:x1].any(axis=1))[0]
foot_ratio = (fys.max() + 1) / paper_c.shape[0]
ph, pw = paper_c.shape[:2]
print(f"PAPER {pw}x{ph} aspect {pw/ph:.4f} foot_baseline {foot_ratio:.4f}")
