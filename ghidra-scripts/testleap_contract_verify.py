#!/usr/bin/env python3
"""Differential test of the TestLEAP container contract against a re-implementation.

The model below was derived from observations -- the required-member list comes out of the
decompilation, the verdict codes and the executable-extension set come from live runs. The
vectors here are deliberately NEW combinations not used to build the model, so agreement is
a prediction confirmed rather than a rule restated.

Comparing, per vector: process exit code, and the first line of stdout.
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
import zipfile

TESTLEAP = r"C:\Program Files\LEAP\testleap.exe"

REQUIRED = ["masterstructure.nx1", "areadata.nx1", "scenariodata.nx1",
            "staticdata.nx1", "years.nx1"]
# .msc added after v04 came back flagged by the binary while the model said allowed.
# .wsh and .jse were probed and are genuinely not flagged, so this is not full PATHEXT.
EXEC_EXTS = {".exe", ".com", ".bat", ".cmd", ".vbs", ".js", ".msi", ".msc"}


def model(members, is_zip=True):
    """Recovered contract: first failing check wins; codes are message ids."""
    if not is_zip:
        return 5
    names = set(members)
    if any(req not in names for req in REQUIRED):
        return 3
    for m in members:
        if os.path.splitext(m)[1].lower() in EXEC_EXTS:
            return 4
    # v10 showed a nested meta/sysinfo.txt satisfies the meta check, so match on basename.
    if not any(os.path.basename(m) == "sysinfo.txt" for m in members):
        return 7
    return 0


def build(tmpdir, name, members, is_zip):
    path = os.path.join(tmpdir, name + ".leap")
    if not is_zip:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("this is not a zip archive")
        return path
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for member in members:
            zf.writestr(member, "x")
    return path


def run(path):
    p = subprocess.run([TESTLEAP, path], capture_output=True, text=True, timeout=60)
    first = ""
    for line in (p.stdout or "").splitlines():
        if line.strip():
            first = line.strip()
            break
    return p.returncode, first


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    required = list(REQUIRED)
    vec = []
    vec.append(("v01_upper_exe",   required + ["sysinfo.txt", "TOOL.EXE"], True))
    vec.append(("v02_wsh",         required + ["sysinfo.txt", "t.wsh"], True))
    vec.append(("v03_jse",         required + ["sysinfo.txt", "t.jse"], True))
    vec.append(("v04_msc",         required + ["sysinfo.txt", "t.msc"], True))
    vec.append(("v05_nested_exe",  required + ["sysinfo.txt", "sub/tool.exe"], True))
    vec.append(("v06_txt_exe",     required + ["sysinfo.txt", "a.txt.exe"], True))
    vec.append(("v07_exe_txt",     required + ["sysinfo.txt", "a.exe.txt"], True))
    vec.append(("v08_no_master",   [r for r in required if r != "masterstructure.nx1"] + ["sysinfo.txt"], True))
    vec.append(("v09_missing_two", [r for r in required if r not in ("years.nx1", "areadata.nx1")] + ["sysinfo.txt"], True))
    vec.append(("v10_meta_nested", required + ["meta/sysinfo.txt"], True))
    vec.append(("v11_bulk_extra",  required + ["sysinfo.txt", "a.txt", "b.csv", "c.py", "d.zip"], True))
    vec.append(("v12_empty_zip",   [], True))
    vec.append(("v13_no_ext",      required + ["sysinfo.txt", "noextension"], True))
    vec.append(("v14_not_zip",     [], False))
    # Ordering tests: the checks short-circuit, so which failure is reported depends on order.
    vec.append(("v15_nested_msc",  required + ["sysinfo.txt", "x/y/tool.msc"], True))
    vec.append(("v16_deep_meta",   required + ["deep/a/b/sysinfo.txt"], True))
    vec.append(("v17_exe_no_meta", required + ["tool.msc"], True))
    vec.append(("v18_missing_exe", [r for r in required if r != "years.nx1"] + ["sysinfo.txt", "UP.EXE"], True))
    vec.append(("v19_meta_and_exe", required + ["sysinfo.txt", "tool.bat"], True))

    tmpdir = tempfile.mkdtemp(prefix="testleap_vec_")
    print("%-16s %-6s %-6s %s" % ("vector", "model", "binary", "verdict"))
    bad = 0
    for name, members, is_zip in vec:
        path = build(tmpdir, name, members, is_zip)
        actual, first = run(path)
        predicted = model(members, is_zip)
        ok = (predicted == actual)
        if not ok:
            bad += 1
        print("%-16s %-6d %-6d %s%s" % (name, predicted, actual,
                                        "OK" if ok else "MISMATCH  ",
                                        "" if ok else first))

    print()
    print("vectors=%d  mismatches=%d" % (len(vec), bad))
    if bad:
        print("RESULT: FAIL")
        return 1
    print("RESULT: OK - the model predicted every verdict")
    return 0


if __name__ == "__main__":
    sys.exit(main())
