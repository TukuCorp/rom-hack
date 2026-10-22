"""Fail if the calculation path names LEAP's regression oracle.

Scans leap-rs/src/calc/*.rs, leap-rs/src/data.rs and the modules calc pulls in (eval, expr,
table, area) with `//` comments stripped, case-insensitively, for the oracle's names. Also fails
if calc reads a table by a non-literal name or by a literal name that is a results table, since
data.rs loads every top-level .nx1 (the area zip carries a top-level RegressionResults.nx1).
data.rs's own RESULT_TABLES list names those tables to leave out of the model, which is the
guard rather than a reference, so that list is allowed.
Run from the repo root. Exit 0 clean, 1 on any hit.
"""
import re
import sys
from pathlib import Path

SRC = Path("leap-rs/src")
FILES = sorted((SRC / "calc").glob("*.rs")) + [SRC / f for f in ("data.rs", "eval.rs", "expr.rs", "table.rs", "area.rs")]
BANNED = re.compile(r"regression|definitive|read_regression|_regressiontests|oracle_", re.I)
TABLE_CALL = re.compile(r"\.table(?:_or_empty)?\(\s*([^)]*)\)")

hits = []
missing = [f for f in FILES if not f.exists()]
if missing or not (SRC / "calc").is_dir():
    print(f"FAIL: expected files missing: {missing}")
    sys.exit(1)


def allowed_lines(path):
    """The lines of a table-name list that names the oracle tables to leave out.

    data.rs keeps LEAP's own results out of the model by listing the tables they live in
    (`RESULT_TABLES`). Naming them there is how the oracle stays unread, so those lines are
    the guard rather than a reference to it.
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    start = None
    for n, line in enumerate(lines, 1):
        if start is None and line.startswith("pub const RESULT_TABLES"):
            start = n
        elif start is not None and line.strip() == "};":
            return set(range(start, n + 1))
    return set()


ALLOWED = {f: allowed_lines(f) for f in FILES}

for f in FILES:
    for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
        code = line.split("//", 1)[0]
        if BANNED.search(code) and n not in ALLOWED[f]:
            hits.append(f"{f}:{n}: oracle name: {line.strip()}")
        if f.parent.name == "calc":
            for arg in TABLE_CALL.findall(code):
                arg = arg.strip()
                lit = re.fullmatch(r'"([^"]*)"', arg)
                if not lit:
                    hits.append(f"{f}:{n}: table read by non-literal name: {line.strip()}")
                elif re.search(r"result|regress", lit.group(1), re.I):
                    hits.append(f"{f}:{n}: results table read: {line.strip()}")
for h in hits:
    print(h)
print(f"scanned {len(FILES)} files; {len(hits)} hit(s)")
if hits:
    print("FAIL: calc path references the oracle")
    sys.exit(1)
print("CLEAN: no oracle reference in the calc path")
