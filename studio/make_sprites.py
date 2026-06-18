#!/usr/bin/env python
"""Render the papercraft prop set as standalone transparent sprites + a manifest,
for use as depth-sorted 3D billboards in the game."""
import os, json, importlib.util

BASE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("er", os.path.join(BASE, "env_render.py"))
er = importlib.util.module_from_spec(spec); spec.loader.exec_module(er)

OUT = os.path.join(BASE, "out", "sprites")
os.makedirs(OUT, exist_ok=True)

SPRITES = {
    "tree_a":    {"type": "tree",  "scale": 1.2, "color": "a9d6a0", "color2": "c2a98c"},
    "tree_b":    {"type": "tree",  "scale": 1.1, "color": "bcd9b0", "color2": "bfa07f"},
    "tree_pink": {"type": "tree",  "scale": 1.1, "color": "f6d3df", "color2": "c9a98f"},
    "bush":      {"type": "bush",  "scale": 1.0, "color": "c7ddb8"},
    "rock":      {"type": "rock",  "scale": 1.0, "color": "cfcabd"},
    "house":     {"type": "house", "scale": 1.0, "color": "f0c9c1", "color2": "c98f86"},
    "flower":    {"type": "flower","scale": 1.5, "color": "f3b6c3"},
}

manifest = {}
for name, p in SPRITES.items():
    w, h = er.render_prop(p, os.path.join(OUT, name + ".png"))
    manifest[name] = {"file": "out/sprites/" + name + ".png", "w": w, "h": h}
    print(f"{name}: {w}x{h}")

json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
print("wrote manifest with", len(manifest), "sprites")
