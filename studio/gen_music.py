#!/usr/bin/env python3
"""Generate calm background-music candidates with MusicGen (local, Apple Silicon).

Same ethos as the art pipeline: programmatic, no hand-authoring. We use the
MusicGen-MEDIUM weights (`facebook/musicgen-medium`) — identical model to Meta's
audiocraft, but loaded via HuggingFace `transformers`, which installs cleanly on
Apple-Silicon MPS without audiocraft's xformers / pinned-torch friction.

MusicGen does NOT loop natively, so this only RENDERS raw ~30s clips. The seamless
loop + OGG encode is a separate, deterministic step: `make_loop.py`.

Run inside the music venv:
  studio/.venv-music/bin/python studio/gen_music.py --seeds 0,1,2
Outputs studio/out/music/raw/<name>-s<seed>.wav (32 kHz mono). The raw dir is
git-ignored — only the final encoded loop is committed.
"""
import argparse, os, sys
from pathlib import Path

# Let unsupported MPS ops fall back to CPU instead of crashing mid-generate.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import torch
import numpy as np
import soundfile as sf
from transformers import AutoProcessor, MusicgenForConditionalGeneration

HERE = Path(__file__).resolve().parent
RAW = HERE / "out" / "music" / "raw"

# Calm, clean, warm pastel papercraft — soft/sparse/mellow, NO drums, NO tension.
DEFAULT_PROMPT = (
    "calm warm cozy ambient music for a gentle papercraft storybook game, "
    "soft felt piano and mellow celesta and music-box bells, warm analog pads, "
    "slow sparse and peaceful, tender reassuring lullaby, lo-fi and minimal, "
    "no drums, no percussion, no beat, soft and quiet"
)


def pick_device(want: str) -> str:
    if want != "auto":
        return want
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", default=DEFAULT_PROMPT)
    ap.add_argument("--name", default="calm")
    ap.add_argument("--seeds", default="0", help="comma-separated seeds, one clip each")
    ap.add_argument("--dur", type=float, default=30.0, help="seconds per clip (MusicGen tops out ~30s)")
    ap.add_argument("--model", default="facebook/musicgen-medium")
    ap.add_argument("--device", default="auto", choices=["auto", "mps", "cpu"])
    ap.add_argument("--guidance", type=float, default=3.0)
    ap.add_argument("--temperature", type=float, default=1.0)
    args = ap.parse_args()

    device = pick_device(args.device)
    seeds = [int(s) for s in str(args.seeds).split(",") if s.strip() != ""]
    RAW.mkdir(parents=True, exist_ok=True)

    print(f"[gen] device={device} model={args.model}", flush=True)
    print(f"[gen] prompt: {args.prompt}", flush=True)
    processor = AutoProcessor.from_pretrained(args.model)
    model = MusicgenForConditionalGeneration.from_pretrained(args.model)
    model.to(device)
    model.eval()

    sr = model.config.audio_encoder.sampling_rate  # 32000 for MusicGen
    # MusicGen runs at a 50 Hz codebook frame rate → 50 tokens per second.
    max_new = int(round(args.dur * 50))
    print(f"[gen] sr={sr} max_new_tokens={max_new} (~{args.dur:.0f}s)", flush=True)

    inputs = processor(text=[args.prompt], padding=True, return_tensors="pt").to(device)

    for seed in seeds:
        torch.manual_seed(seed)
        if device == "mps":
            torch.mps.manual_seed(seed)
        print(f"[gen] seed={seed} generating…", flush=True)
        with torch.no_grad():
            audio = model.generate(
                **inputs,
                do_sample=True,
                guidance_scale=args.guidance,
                temperature=args.temperature,
                max_new_tokens=max_new,
            )
        wav = audio[0, 0].to("cpu", torch.float32).numpy()
        # MusicGen can leave a tiny DC offset / hot peak — clean before saving.
        wav = wav - float(np.mean(wav))
        peak = float(np.max(np.abs(wav))) or 1.0
        wav = wav / peak * 0.97
        out = RAW / f"{args.name}-s{seed}.wav"
        sf.write(str(out), wav, sr, subtype="PCM_16")
        dur = len(wav) / sr
        rms = float(np.sqrt(np.mean(wav ** 2)))
        print(f"[gen]   wrote {out.name}  {dur:.1f}s  rms={rms:.3f}", flush=True)

    print("[gen] done", flush=True)


if __name__ == "__main__":
    sys.exit(main())
