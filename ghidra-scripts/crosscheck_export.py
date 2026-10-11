#!/usr/bin/env python3
"""Independently cross-check a DecompileAll export against a live Ghidra session.

The export is verified internally by verify_decompilation.py, which only proves the
file is self-consistent. This script proves something stronger: it asks Ghidra, over
GhidraMCP, to decompile the same addresses again and compares that fresh output with
the bytes written to the export.

Requires a GhidraMCP headless server holding the analysed project, e.g.
  start-ghidra-mcp-headless.ps1 -Port 8089 -Project <ghidra-projects>

Usage:
  python crosscheck_export.py <exportDir> [--mcp-url URL] [--samples 25] [--seed 1]
"""

import argparse
import json
import os
import random
import re
import sys
import urllib.parse
import urllib.request

START = re.compile(r"^/\* ===== ([0-9a-fA-Fx]+)\s+(.*?) ===== \*/$")
END = re.compile(r"^/\* ===== end ([0-9a-fA-Fx]+) ===== \*/$")
SIG = re.compile(r"^/\* .* \*/$")


def norm(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.rstrip() for line in text.split("\n")).strip()


def fetch_code(export_dir, wanted):
    """Scan chunks once and pull the code body for each wanted address."""
    found = {}
    for name in sorted(f for f in os.listdir(export_dir) if re.match(r"chunk-\d+\.c$", f)):
        if len(found) == len(wanted):
            break
        cur = None
        buf = []
        skip_sig = False
        with open(os.path.join(export_dir, name), "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.rstrip("\n").rstrip("\r")
                m = START.match(line)
                if m:
                    cur, buf, skip_sig = m.group(1), [], True
                    continue
                if END.match(line):
                    if cur in wanted:
                        found[cur] = "\n".join(buf)
                    cur = None
                    continue
                if cur is not None:
                    if skip_sig:
                        skip_sig = False
                        # the export writes one signature comment line right after the header
                        if SIG.match(line):
                            continue
                    buf.append(line)
    return found


def mcp_decompile(url, address):
    q = urllib.parse.urlencode({"address": address})
    req = urllib.request.Request("%s/force_decompile?%s" % (url.rstrip("/"), q))
    with urllib.request.urlopen(req, timeout=300) as resp:
        payload = json.loads(resp.read().decode("utf-8", "replace"))
    if not isinstance(payload, dict):
        return None
    return payload.get("decompiled")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export_dir")
    ap.add_argument("--mcp-url", default="http://127.0.0.1:8089")
    ap.add_argument("--samples", type=int, default=25)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    done_path = os.path.join(args.export_dir, "done.txt")
    if not os.path.exists(done_path):
        print("FAIL: no done.txt in", args.export_dir)
        return 1
    with open(done_path, encoding="utf-8", errors="replace") as fh:
        addrs = [l.strip() for l in fh if l.strip()]
    if not addrs:
        print("FAIL: done.txt is empty")
        return 1

    random.seed(args.seed)
    sample = random.sample(addrs, min(args.samples, len(addrs)))
    wanted = set(sample)
    exported = fetch_code(args.export_dir, wanted)
    print("sampled %d of %d exported functions" % (len(sample), len(addrs)))

    same = diff = missing = err = 0
    for addr in sample:
        if addr not in exported:
            missing += 1
            print("  %s: not found in chunk files" % addr)
            continue
        try:
            live = mcp_decompile(args.mcp_url, addr)
        except Exception as exc:
            err += 1
            print("  %s: MCP error %s" % (addr, exc))
            continue
        if live is None:
            err += 1
            print("  %s: no decompilation returned" % addr)
            continue
        if norm(live) == norm(exported[addr]):
            same += 1
        else:
            diff += 1
            print("  %s: MISMATCH (export %d chars, live %d chars)"
                  % (addr, len(norm(exported[addr])), len(norm(live))))

    print()
    print("identical : %d" % same)
    print("mismatched: %d" % diff)
    print("missing   : %d" % missing)
    print("errors    : %d" % err)
    if diff or missing or err:
        print("\nRESULT: FAIL")
        return 1
    print("\nRESULT: OK - live Ghidra reproduces the exported text exactly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
