#!/usr/bin/env python
"""Generate a papercraft asset image via the Gemini image API (text-to-image,
optionally conditioned on reference images).

Key: read from env GEMINI_API_KEY (or GEMINI_KEY). It lives in 1Password
("Bowmark Gemini Key"); load it before running, e.g.:

  set -a; source ~/.secrets.env; set +a
  export GEMINI_API_KEY="$(op item get s66drdsfeobdn5brqel5kvdtta \
      --vault Christopher-Macbook-CLI --fields label='API Key' --reveal)"

Never commit the key.

Usage:
  studio/.venv/bin/python studio/gen_image.py -o studio/refs/chrees-1.png \
      -p "a full-body standing chibi ..." [--ref studio/refs/x.png ...] \
      [--model gemini-3-pro-image] [--aspect 3:4]
"""
import argparse, base64, json, mimetypes, os, sys, urllib.request, urllib.error

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def load_key():
    for k in ("GEMINI_API_KEY", "GEMINI_KEY", "GOOGLE_API_KEY"):
        v = os.environ.get(k)
        if v:
            return v.strip()
    sys.exit("No Gemini key in env (set GEMINI_API_KEY). See module docstring.")


def part_from_image(path):
    mime = mimetypes.guess_type(path)[0] or "image/png"
    with open(path, "rb") as f:
        return {"inline_data": {"mime_type": mime, "data": base64.b64encode(f.read()).decode()}}


def generate(prompt, out, model="gemini-3-pro-image", refs=None, aspect="3:4"):
    parts = [{"text": prompt}]
    for r in (refs or []):
        parts.append(part_from_image(r))
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": aspect},
        },
    }
    url = API.format(model=model) + "?key=" + load_key()
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:800]}")

    cands = data.get("candidates", [])
    if not cands:
        sys.exit(f"No candidates. Response: {json.dumps(data)[:800]}")
    saved = False
    for p in cands[0].get("content", {}).get("parts", []):
        if "text" in p:
            print("model:", p["text"][:300])
        inline = p.get("inline_data") or p.get("inlineData")
        if inline and not saved:
            raw = base64.b64decode(inline.get("data"))
            with open(out, "wb") as f:
                f.write(raw)
            print(f"WROTE {out} ({len(raw)} bytes)")
            saved = True
    if not saved:
        fr = cands[0].get("finishReason")
        sys.exit(f"No image in response (finishReason={fr}). {json.dumps(data)[:600]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-p", "--prompt", required=True)
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--model", default="gemini-3-pro-image")
    ap.add_argument("--ref", action="append", default=[], help="reference image (repeatable)")
    ap.add_argument("--aspect", default="3:4")
    a = ap.parse_args()
    generate(a.prompt, a.out, a.model, a.ref, a.aspect)


if __name__ == "__main__":
    main()
