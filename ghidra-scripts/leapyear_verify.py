#!/usr/bin/env python3
"""Differential test: Delphi IsLeapYear in testleap.exe versus a from-pseudocode re-implementation.

Ground truth comes from Ghidra emulation of FUN_0042669c (0x0042669c) over GhidraMCP, so the
"original binary" side is real machine code, not a reading of the listing.

Two things are compared per vector:
  al_expected  - the low byte, i.e. the actual Boolean the function returns
  full EAX     - exposes that only AL is set: the upper 24 bits keep division leftovers,
                 which is what the decompiler rendered as CONCAT31.

Requires: start-ghidra-mcp-headless.ps1 -Port 8089 -Project <ghidra-bench>  (BenchSmall)
"""

import argparse
import json
import sys
import urllib.request

FUNC = "0042669c"


def emulate(url, year):
    body = json.dumps({
        "function": FUNC,
        "registers": {"EAX": hex(year & 0xFFFFFFFF)},
        "memory": {},
        "return_registers": "EAX,EDX",
        "max_steps": 10000,
    }).encode()
    req = urllib.request.Request(url.rstrip("/") + "/emulate_function", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def reimplemented(year):
    """Transcribed from the pseudo-code: 16-bit truncation, and on true only AL is written."""
    y = year & 0xFFFF
    if (y & 3) == 0:
        if y % 100 != 0:
            return 1, ((y // 100) & 0xFFFFFF00) | 1
        if y % 400 == 0:
            return 1, ((y // 400) & 0xFFFFFF00) | 1
    return 0, 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mcp-url", default="http://127.0.0.1:8089")
    args = ap.parse_args()

    # Boundary cases plus width cases that exercise the Word truncation.
    vectors = [0, 1, 4, 100, 400, 1600, 1700, 1800, 1900, 1996, 2000, 2023, 2024,
               2100, 2400, 32004, 65532, 65535, 65536, 65537, 131072, 4294967295]

    print("%-12s %-10s %-10s %-10s %-10s %s" % (
        "input", "bin AL", "py AL", "bin EAX", "py EAX", "verdict"))
    bad = 0
    for v in vectors:
        res = emulate(args.mcp_url, v)
        if not res.get("success"):
            print("%-12d EMULATION FAILED: %s" % (v, res))
            bad += 1
            continue
        eax = int(res["registers"].get("EAX", "0x0"), 16)
        bin_al = eax & 0xFF
        bin_hi = (eax >> 8) & 0xFFFFFF
        py_al, py_hi = reimplemented(v)
        ok = (bin_al == py_al) and (eax == py_hi)
        if not ok:
            bad += 1
        print("%-12d 0x%-8x 0x%-8x 0x%-8x 0x%-8x %s" % (
            v, bin_al, py_al, eax, py_hi, "OK" if ok else "MISMATCH"))

    print()
    print("vectors=%d  mismatches=%d" % (len(vectors), bad))
    if bad:
        print("RESULT: FAIL")
        return 1
    print("RESULT: OK - re-implementation matches the binary on every vector")
    return 0


if __name__ == "__main__":
    sys.exit(main())
