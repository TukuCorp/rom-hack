#!/usr/bin/env python3
"""Differential test of date validation in testleap.exe against a re-implementation.

Emulates FUN_004266d8, which validates a date by indexing the month-length table at
0x61cef8 with the record chosen by IsLeapYear. Initial register state (EAX/EDX/ECX)
and initial memory state (the stack and the out-parameter buffer) are both supplied,
so the emulator is driven from a fully specified starting state.

The model is the transcribed rule: year 1..9999, month 1..12, day 1..days-in-month,
with the leap rule expressed as %4 assuming %100 and %400 overrides.
"""

import argparse
import base64
import json
import struct
import sys
import urllib.request

FUNC = "004266d8"
STACK = 0x20000000
BUF = 0x20000010

MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]


def is_leap(y):
    return (y % 4 == 0) and (y % 100 != 0 or y % 400 == 0)


def model(y, m, d):
    if not (1 <= y <= 9999):
        return 0
    if not (1 <= m <= 12):
        return 0
    dim = MONTH_DAYS[m - 1]
    if m == 2 and is_leap(y):
        dim = 29
    return 1 if (1 <= d <= dim) else 0


def emulate(url, y, m, d):
    stack = struct.pack("<II", 0xDEADBEEF, BUF)
    body = json.dumps({
        "function": FUNC,
        "registers": {"EAX": hex(y), "EDX": hex(m), "ECX": hex(d), "ESP": hex(STACK)},
        "memory": [
            {"address": hex(STACK), "data": base64.b64encode(stack).decode()},
            {"address": hex(BUF), "data": base64.b64encode(b"\x00" * 8).decode()},
        ],
        "return_registers": "EAX",
        "read_memory_after": [{"address": hex(BUF), "length": 8}],
        "max_steps": 20000,
    }).encode()
    req = urllib.request.Request(url.rstrip("/") + "/emulate_function", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mcp-url", default="http://127.0.0.1:8089")
    args = ap.parse_args()

    vectors = [
        (2024, 2, 29, "leap year, 29 Feb"),
        (2023, 2, 29, "non-leap, rejected"),
        (2000, 2, 29, "400-year leap, accepted"),
        (1900, 2, 29, "century non-leap, rejected"),
        (2100, 2, 29, "century non-leap, rejected"),
        (2400, 2, 29, "400-year leap, accepted"),
        (2024, 2, 30, "past month length"),
        (2024, 4, 31, "April has 30 days"),
        (2024, 12, 31, "year end"),
        (2024, 1, 1, "year start"),
        (2024, 0, 15, "month 0"),
        (2024, 13, 15, "month 13"),
        (2024, 6, 0, "day 0"),
        (0, 6, 15, "year 0"),
        (9999, 12, 31, "max year"),
        (10000, 1, 1, "year past range"),
        (1996, 2, 29, "ordinary leap"),
        (1800, 2, 29, "century non-leap"),
    ]

    print("%-14s %-6s %-7s %s" % ("date", "model", "binary", "note"))
    bad = 0
    for y, m, d, note in vectors:
        res = emulate(args.mcp_url, y, m, d)
        if res.get("error") or not res.get("success"):
            print("%-14s %-6d %-7s %s" % ("%d-%d-%d" % (y, m, d), model(y, m, d),
                                          "ERR", res))
            bad += 1
            continue
        al = int(res["registers"]["EAX"], 16) & 0xFF
        predicted = model(y, m, d)
        ok = (al == predicted)
        if not ok:
            bad += 1
        print("%-14s %-6d %-7d %s%s" % ("%d-%d-%d" % (y, m, d), predicted, al,
                                        "OK   " if ok else "MISMATCH  ", note))

    print()
    print("vectors=%d  mismatches=%d" % (len(vectors), bad))
    if bad:
        print("RESULT: FAIL")
        return 1
    print("RESULT: OK - the rule predicted every verdict, including the century cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())

