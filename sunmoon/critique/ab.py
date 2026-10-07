#!/usr/bin/env python3
"""Blind A/B composite builder for the Sun/Moon gauntlet.

Puts a reference capture (bar/) and one of our screenshots side by side as A|B in a
randomised order, normalised to the same height, with the answer key written next to
the output. The critic must never see which panel is ours.

  python sunmoon/critique/ab.py --ours sunmoon/critique/x.png --bar sunmoon/bar/Ember_VII.png \
      --out sunmoon/critique/ab-01.webp
"""
import argparse
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw


def load(path, height):
    im = Image.open(path).convert("RGB")
    scale = height / im.height
    return im.resize((max(1, round(im.width * scale)), height), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ours", required=True)
    ap.add_argument("--bar", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--height", type=int, default=440)
    ap.add_argument("--label", default="")
    ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args()

    seed = a.seed if a.seed is not None else random.randrange(1 << 30)
    rng = random.Random(seed)
    ours_first = rng.random() < 0.5

    bar = load(a.bar, a.height)
    ours = load(a.ours, a.height)
    left, right = (ours, bar) if ours_first else (bar, ours)
    key = {"A": "ours" if ours_first else "bar",
           "B": "bar" if ours_first else "ours",
           "ours": a.ours, "bar": a.bar, "seed": seed, "note": a.label}

    pad, head = 10, 26
    w = left.width + right.width + pad * 3
    h = a.height + head + pad * 2
    canvas = Image.new("RGB", (w, h), (14, 16, 22))
    draw = ImageDraw.Draw(canvas)
    for i, (im, letter) in enumerate(((left, "A"), (right, "B"))):
        x = pad + i * (im.width + pad)
        canvas.paste(im, (x, head + pad))
        draw.rectangle([x, head + pad, x + im.width - 1, head + pad + im.height - 1], outline=(90, 100, 120))
        draw.text((x + 4, 8), f"{letter}  {im.width}x{im.height}", fill=(235, 240, 250))
        if a.label:
            draw.text((x + 4, head + pad + im.height + 4), "", fill=(200, 200, 210))
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out, quality=92)
    key_path = out.with_suffix(".key.json")
    key_path.write_text(json.dumps(key, indent=1))
    print(json.dumps({"out": str(out), "key": str(key_path), "seed": seed,
                      "A": key["A"], "B": key["B"]}))


if __name__ == "__main__":
    main()
