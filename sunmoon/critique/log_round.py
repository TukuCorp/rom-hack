#!/usr/bin/env python3
"""Append a gauntlet round to sunmoon/progress.json from a critic verdict.

  python sunmoon/critique/log_round.py --key sunmoon/critique/ab-R1-field-plates.key.json \
      --pick A --piece "HUD / plates" --gap "..." --note "..." --round 1
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROGRESS = ROOT / "progress.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", required=True, help="the .key.json written next to a composite")
    ap.add_argument("--pick", required=True, choices=["A", "B"], help="which panel the critic called authentic")
    ap.add_argument("--piece", required=True)
    ap.add_argument("--gap", default="")
    ap.add_argument("--note", default="")
    ap.add_argument("--round", type=int, default=None)
    a = ap.parse_args()

    key = json.loads(Path(a.key).read_text())
    win = key.get(a.pick) == "ours"
    composite = str(Path(a.key).with_suffix("").with_suffix(".webp")).replace("\\", "/")
    bar = key.get("bar", "").replace("\\", "/")
    ours = key.get("ours", "").replace("\\", "/")

    prog = json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {"rounds": []}
    rounds = prog.setdefault("rounds", [])
    rnd = a.round if a.round is not None else max([r.get("round", 0) for r in rounds] + [0]) + 1
    rounds.append({
        "round": rnd,
        "piece": a.piece,
        "win": bool(win),
        "gap": a.gap,
        "note": a.note,
        "critic_pick": a.pick,
        "key": Path(a.key).name,
        "imgs": [bar, ours, composite],
    })
    PROGRESS.write_text(json.dumps(prog, indent=1) + "\n")
    print(json.dumps({"round": rnd, "piece": a.piece, "ours_won_blind": win,
                      "critic_called_ours": key.get(a.pick)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
