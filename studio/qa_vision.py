#!/usr/bin/env python
"""Vision QA for a registered pose set — the "AI" half of the pose-set check.

Asks Gemini whether the images the engine HARD-SWAPS between are unmistakably the
SAME character at the SAME size, differing ONLY in the intended action region.
Catches identity / colour / proportion drift that the geometry pass
(register_poses.py) cannot see. Run both; a set ships only when both pass.

Usage:  qa_vision.py <name> <pose1> <pose2> [pose3 ...]   reads out/<name>-<pose>-paper.png
Needs GEMINI_API_KEY in env (see the gemini-key skill). Prints a JSON verdict; exit 1 on fail.
"""
import sys, os, json, base64, urllib.request, urllib.error

BASE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(BASE, "out")
MODEL = os.environ.get("GEMINI_VISION_MODEL", "gemini-2.5-flash")
API = "https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"


def load_key():
    for k in ("GEMINI_API_KEY", "GEMINI_KEY", "GOOGLE_API_KEY"):
        v = os.environ.get(k)
        if v: return v.strip()
    sys.exit("No Gemini key in env (set GEMINI_API_KEY — see the gemini-key skill).")


def img_part(p):
    with open(p, "rb") as f:
        return {"inline_data": {"mime_type": "image/png", "data": base64.b64encode(f.read()).decode()}}


def main():
    name, poses = sys.argv[1], sys.argv[2:]
    if len(poses) < 2: sys.exit("need >=2 poses")
    prompt = (
        "These images are pose frames of ONE game character that the engine HARD-SWAPS "
        "between with no tween. For the swap to look right they must be unmistakably the "
        "SAME character at the SAME size, differing ONLY in the intended action (e.g. the "
        "arm / dumbbell position). Frames, in order: " + ", ".join(poses) + ". "
        "Reply with STRICT JSON only: {\"same_character\":bool,\"same_scale_and_height\":bool,"
        "\"feet_planted_same\":bool,\"only_action_differs\":bool,\"differences\":[short strings],"
        "\"verdict\":\"pass\" or \"fail\",\"why\":short string}. Fail if the face, hair, headband, "
        "outfit, colours, body proportions, or overall size differ between frames, or if anything "
        "other than the action region changed."
    )
    parts = [{"text": prompt}] + [img_part(os.path.join(OUT, f"{name}-{p}-paper.png")) for p in poses]
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0}}
    req = urllib.request.Request(API.format(m=MODEL) + "?key=" + load_key(),
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:400]}")
    try:
        v = json.loads(data["candidates"][0]["content"]["parts"][0]["text"])
    except Exception as e:
        sys.exit(f"parse fail: {e}; raw={json.dumps(data)[:500]}")
    print(json.dumps(v, indent=2))
    sys.exit(0 if v.get("verdict") == "pass" else 1)


if __name__ == "__main__":
    main()
