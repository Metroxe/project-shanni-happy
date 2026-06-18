#!/usr/bin/env python
"""Register a character's pose images onto ONE shared canvas so they hard-swap
without popping — then QA the set.

Usage:  register_poses.py <name> <pose1> <pose2> [pose3 ...]
Reads   out/<name>-<pose>-cut.png   (transparent figures from cutout.py)
Writes  out/<name>-<pose>-paper.png (registered, cream die-cut border)
        out/<name>-poses.json       (manifest: shared canvas, baseline, files)
Prints  a QA report; exits 1 if any check fails.

Why this exists: the renderer pins a billboard's world height to nd.h and derives
width from the texture aspect, computed ONCE from the default texture. So every
pose image of a character must share the SAME canvas, the SAME foot baseline, and
the SAME body scale — otherwise a hard swap makes the character resize, jump, or
lift off the ground. Independent Gemini gens never line up on their own; this
normalizes them and proves the result.

Registration anchor: feet (bottom of alpha) → fixed baseline row, and figure
height (feet→crown) → the first pose's height. This is valid only while the action
keeps the head as the topmost point (a curl, not an overhead press) — the QA below
asserts that, so a bad anchor fails loudly instead of silently shrinking the body.
What registration canNOT fix is identity (face / outfit / colour); that is the job
of the vision QA pass (qa_vision.py) and the cheap palette proxy here.
"""
import sys, os, json, numpy as np
from PIL import Image
from scipy import ndimage

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "out")
STRUCT = ndimage.generate_binary_structure(2, 2)   # 8-connected
BORDER, RING, PAD, ALPHA_T = 18, 3, 6, 40
CREAM = (250, 246, 237); STROKE = (214, 201, 178)


def load_cut(name, pose):
    return np.asarray(Image.open(os.path.join(OUT, f"{name}-{pose}-cut.png")).convert("RGBA"))


def measure(a):
    ys, xs = np.where(a)
    top, bot = int(ys.min()), int(ys.max())
    figH = bot - top + 1
    loy = bot - int(round(0.18 * figH))                 # lower-body (legs/feet) centroid
    lm = a.copy(); lm[:loy] = False
    lxs = np.where(lm)[1]
    cx = float(lxs.mean()) if lxs.size else float(xs.mean())
    return top, bot, figH, cx


def scale_rgba(arr, s):
    if abs(s - 1.0) < 2e-3: return arr
    h, w = arr.shape[:2]
    return np.asarray(Image.fromarray(arr, "RGBA").resize(
        (max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS))


def process(name, pose, target_h):
    arr = load_cut(name, pose)
    a = arr[..., 3] > ALPHA_T
    _, _, figH0, _ = measure(a)
    arr = scale_rgba(arr, target_h / figH0)
    a = arr[..., 3] > ALPHA_T
    top, bot, figH, cx = measure(a)
    paper = ndimage.binary_dilation(a, STRUCT, BORDER)
    ring = ndimage.binary_dilation(paper, STRUCT, RING)
    rys, rxs = np.where(ring)
    return dict(pose=pose, arr=arr, fg=a, paper=paper, ring=ring, raw_h=figH0,
                top=top, feet=bot, figH=figH, cx=cx,
                rT=int(rys.min()), rB=int(rys.max()), rL=int(rxs.min()), rR=int(rxs.max()))


def main():
    name, poses = sys.argv[1], sys.argv[2:]
    if len(poses) < 2: sys.exit("need >=2 poses")
    _, _, target_h, _ = measure(load_cut(name, poses[0])[..., 3] > ALPHA_T)
    P = [process(name, p, target_h) for p in poses]

    aboveFeet = max(p["feet"] - p["rT"] for p in P)
    belowFeet = max(p["rB"] - p["feet"] for p in P)
    leftExt = max(p["cx"] - p["rL"] for p in P)
    rightExt = max(p["rR"] - p["cx"] for p in P)
    H = int(round(aboveFeet + belowFeet)) + 2 * PAD
    W = int(round(leftExt + rightExt)) + 2 * PAD
    baseline = PAD + int(round(aboveFeet))
    centerX = PAD + int(round(leftExt))

    manifest = {"name": name, "canvas": [W, H], "baseline": baseline,
                "foot_ratio": round(baseline / H, 4), "default": poses[0], "poses": {}}
    placed = {}
    for p in P:
        cv = np.zeros((H, W, 4), np.uint8)
        oy, ox = baseline - p["feet"], centerX - int(round(p["cx"]))

        def blit(mask, col):
            ys, xs = np.where(mask); Y, X = ys + oy, xs + ox
            ok = (Y >= 0) & (Y < H) & (X >= 0) & (X < W)
            cv[Y[ok], X[ok], :3] = col; cv[Y[ok], X[ok], 3] = 255
        blit(p["ring"], STROKE); blit(p["paper"], CREAM)
        ys, xs = np.where(p["fg"]); Y, X = ys + oy, xs + ox
        ok = (Y >= 0) & (Y < H) & (X >= 0) & (X < W)
        cv[Y[ok], X[ok], :3] = p["arr"][ys[ok], xs[ok], :3]; cv[Y[ok], X[ok], 3] = 255
        Image.fromarray(cv, "RGBA").save(os.path.join(OUT, f"{name}-{p['pose']}-paper.png"))
        m = np.zeros((H, W), bool); m[Y[ok], X[ok]] = True
        placed[p["pose"]] = {"fg": m, "rgb": cv[..., :3]}
        manifest["poses"][p["pose"]] = {"file": f"out/{name}-{p['pose']}-paper.png"}
    json.dump(manifest, open(os.path.join(OUT, f"{name}-poses.json"), "w"), indent=1)

    # ---------- QA ----------
    fails, rep = [], {}
    means, crowns, headWs = {}, {}, {}
    for p in P:
        fg = placed[p["pose"]]["fg"]
        ys, xs = np.where(fg)
        feet, top = int(ys.max()), int(ys.min())
        headW = int(fg[top: top + int(0.12 * target_h)].any(axis=0).sum())  # top-band width
        bodyW = int(fg.any(axis=0).sum())
        means[p["pose"]] = placed[p["pose"]]["rgb"][fg].mean(axis=0)
        crowns[p["pose"]], headWs[p["pose"]] = top, headW
        rep[p["pose"]] = {"raw_input_h": p["raw_h"], "feet_row": feet, "crown_row": top,
                          "fig_h": feet - top + 1, "head_w": headW, "body_w": bodyW}
        if feet != baseline: fails.append(f"{p['pose']}: feet at {feet}, baseline {baseline}")
        if abs((feet - top + 1) - target_h) > 2: fails.append(f"{p['pose']}: fig height off")
    # cross-pose anchor validity: the SAME head must sit at the top of every pose.
    # If one pose raised the weights above the head, its top band widens / its crown
    # rises vs the others — that's what invalidates the feet→crown scale anchor.
    b = poses[0]
    for q in poses[1:]:
        if abs(crowns[q] - crowns[b]) > 3:
            fails.append(f"{q}: crown row {crowns[q]} vs {b} {crowns[b]} — vertical drift")
        if abs(headWs[q] - headWs[b]) > 0.12 * headWs[b]:
            fails.append(f"{q}: top-band width {headWs[q]} vs {b} {headWs[b]} — head moved or "
                         f"weights raised above head (crown anchor invalid)")
    # palette proxy (gross recolor / identity drift; real check is the vision pass)
    base_m = means[poses[0]]
    for q in poses[1:]:
        d = float(np.linalg.norm(means[q] - base_m))
        rep[q]["palette_dist_vs_" + poses[0]] = round(d, 1)
        if d > 22: fails.append(f"{q}: palette dist {d:.1f} vs {poses[0]} (possible recolor — verify)")

    out = {"canvas": [W, H], "baseline": baseline, "foot_ratio": round(baseline / H, 4),
           "scale_corrections": {p["pose"]: round(target_h / p["raw_h"], 3) for p in P},
           "per_pose": rep, "pass": not fails, "fails": fails}
    print(json.dumps(out, indent=2))
    sys.exit(0 if not fails else 1)


if __name__ == "__main__":
    main()
