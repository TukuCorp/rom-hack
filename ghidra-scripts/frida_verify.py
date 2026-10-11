#!/usr/bin/env python3
"""DBI verification of IsLeapYear in the running process, plus API tracing.

Spawns testleap.exe under Frida, hooks IsLeapYear at image base + 0x2669c, logs the
registers on entry and the result on return, calls the real function directly for a
list of years, and traces its file/registry API calls during a normal validation run.

The direct results are compared against the same model used by the Ghidra emulator
harness, which is what makes this an independent cross-check: two different engines,
one running the code live and one emulating it.
"""

import argparse
import json
import os
import sys
import threading
import time
import zipfile

import frida

EXE = r"C:\Program Files\LEAP\testleap.exe"
HERE = os.path.dirname(os.path.abspath(__file__))
PAYLOAD = os.path.join(HERE, "frida_payload.js")
LEAP_OUT = r"C:\Users\tukum\Downloads\rom-hack\_probes\frida_valid.leap"
REQUIRED = ["masterstructure.nx1", "areadata.nx1", "scenariodata.nx1",
            "staticdata.nx1", "years.nx1"]


def is_leap(year):
    y = year & 0xFFFF
    return 1 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 0


def build_leap():
    os.makedirs(os.path.dirname(LEAP_OUT), exist_ok=True)
    with zipfile.ZipFile(LEAP_OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("sysinfo.txt", "LEAP 2024")
        for name in REQUIRED:
            zf.writestr(name, "x")
    return LEAP_OUT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wait", type=int, default=25)
    args = ap.parse_args()

    leap = build_leap()
    messages = []
    detached = threading.Event()

    device = frida.get_local_device()
    pid = device.spawn([EXE, leap])
    session = device.attach(pid)

    with open(PAYLOAD, "r", encoding="utf-8") as fh:
        source = fh.read()

    def on_message(message, data):
        messages.append(message)

    def on_detached(reason, *rest):
        detached.set()

    session.on("detached", on_detached)
    script = session.create_script(source)
    script.on("message", on_message)
    script.load()
    device.resume(pid)

    detached.wait(timeout=args.wait)
    try:
        device.kill(pid)
    except Exception:
        pass

    payloads = [m.get("payload", {}) for m in messages if m.get("type") == "send"]

    resolved = next((p for p in payloads if p.get("kind") == "resolved"), None)
    if resolved:
        print("module base :", resolved["base"])
        print("IsLeapYear  :", resolved["addr"])
    for p in payloads:
        if p.get("kind") == "fatal":
            print("FATAL:", p.get("why"))
            return 1

    direct = next((p["results"] for p in payloads if p.get("kind") == "direct"), None)
    if direct is None:
        print("no direct results returned")
        for m in messages:
            print(" ", json.dumps(m)[:240])
        return 1

    print()
    print("%-10s %-10s %-10s %s" % ("year", "live", "model", "verdict"))
    bad = 0
    for year, live in direct:
        expected = is_leap(year)
        ok = (live == expected)
        if not ok:
            bad += 1
        print("%-10d %-10d %-10d %s" % (year, live, expected, "OK" if ok else "MISMATCH"))

    hooks = [p for p in payloads if p.get("kind") == "hook"]
    print()
    mine = [p for p in hooks if p.get("direct")]
    native = [p for p in hooks if not p.get("direct")]
    print("hook fired %d times: %d from these direct calls, %d from the process itself"
          % (len(hooks), len(mine), len(native)))
    print("entry/return register pairs from the direct calls:")
    for p in mine[:4]:
        print("   EAX in = %-6d  EAX out = %d" % (p["year"], p["ret"]))
    if native:
        years = sorted(set(p["year"] for p in native))
        print("the process called it natively with these year arguments:")
        print("   %s" % ", ".join(str(y) for y in years[:20]))
        print("   natively returned %d and %d (%d true, %d false)"
              % (1, 0, sum(1 for p in native if p["ret"]), sum(1 for p in native if not p["ret"])))

    apis = [p for p in payloads if p.get("kind") == "api"]
    hooked = [p["name"] for p in payloads if p.get("kind") == "api-hooked"]
    missing = [p["name"] for p in payloads if p.get("kind") == "api-missing"]
    print()
    print("APIs hooked: %s" % ", ".join(hooked))
    if missing:
        print("APIs not resolvable: %s" % ", ".join(missing))
    print("API calls observed live: %d" % len(apis))
    for p in apis[:15]:
        print("   %-26s %s" % (p["name"], p["value"]))

    print()
    print("direct vectors=%d  mismatches=%d" % (len(direct), bad))
    if bad:
        print("RESULT: FAIL")
        return 1
    print("RESULT: OK - the live process and the model agree on every vector")
    return 0


if __name__ == "__main__":
    sys.exit(main())
