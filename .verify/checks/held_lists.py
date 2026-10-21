"""Check tests/case_studies.rs HELD lists equal the claimed variable ids, and that each area's
test calls check() with them. Run from the repo root. Exit 0 match, 1 otherwise."""
import re
import sys
from pathlib import Path

CLAIMED = {
    "Freedonia": [1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 30, 31, 35, 36,
                  41, 42, 43, 46, 65, 73, 77, 82, 84, 87, 89, 104, 105, 125, 126, 127, 2027],
    "Transport Exercise": [20, 21, 30, 40, 41, 60, 61, 62, 64, 66, 67, 68, 81, 125, 2027],
}
src = Path("leap-rs/tests/case_studies.rs").read_text(encoding="utf-8")
code = "\n".join(l.split("//", 1)[0] for l in src.splitlines())
block = re.search(r"const HELD[^=]*=\s*&\[(.*?)\];", code, re.S)
if not block:
    print("FAIL: no HELD const")
    sys.exit(1)
found = {name: [int(x) for x in re.findall(r"-?\d+", ids)]
         for name, ids in re.findall(r'\(\s*"([^"]+)"\s*,\s*&\[([^\]]*)\]\s*\)', block.group(1))}
ok = True
for area, want in CLAIMED.items():
    got = found.get(area)
    status = "OK" if got == want else "MISMATCH"
    ok &= got == want
    print(f"{area}: {status} held={got} claimed={want}")
if set(found) != set(CLAIMED):
    ok = False
    print(f"MISMATCH: areas in HELD {sorted(found)}")
for area in CLAIMED:
    if not re.search(r'\*area\s*==\s*"%s"\s*\{\s*check\(area,\s*vars\)' % re.escape(area), code):
        ok = False
        print(f"MISMATCH: no #[test] calling check() for {area}")
if not ok:
    sys.exit(1)
print("HELD lists match the claim")
