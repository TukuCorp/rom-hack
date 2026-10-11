#!/usr/bin/env python3
"""Verify a DecompileAll export produced by ghidra-scripts/DecompileAll.java.

Checks, in order:
  * every record start has a matching end and the address in both agrees
  * records are not truncated mid-file (a chunk ending inside a record)
  * no duplicate function addresses across chunks
  * no empty function bodies
  * done.txt agrees with the records actually written
Optionally compares the record count against an expected function total.

Usage:
  python verify_decompilation.py <exportDir> [--expected N]
Exits 0 when clean, 1 when any check fails.
"""

import argparse
import os
import re
import sys

START = re.compile(r"^/\* ===== ([0-9a-fA-Fx]+)\s+(.*?) ===== \*/$")
END = re.compile(r"^/\* ===== end ([0-9a-fA-Fx]+) ===== \*/$")
SIG = re.compile(r"^/\* .* \*/$")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export_dir")
    ap.add_argument("--expected", type=int, default=None,
                    help="expected function total from the analysed program")
    ap.add_argument("--index", default=None,
                    help="also write a TSV index of address, name, chunk")
    ap.add_argument("--max-failures", type=int, default=0,
                    help="tolerate this many addresses in done.txt with no record")
    args = ap.parse_args()

    chunks = sorted(f for f in os.listdir(args.export_dir)
                    if re.match(r"chunk-\d+\.c$", f))
    if not chunks:
        print("FAIL: no chunk-*.c files in", args.export_dir)
        return 1

    seen = {}          # address -> (chunk, name)
    records = 0
    empty_bodies = []
    mismatched = []
    unterminated = []
    total_bytes = 0

    for chunk in chunks:
        path = os.path.join(args.export_dir, chunk)
        total_bytes += os.path.getsize(path)
        open_addr = None
        open_name = None
        body_lines = 0
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.rstrip("\n").rstrip("\r")
                m = START.match(line)
                if m:
                    if open_addr is not None:
                        unterminated.append((chunk, open_addr, "new record before end"))
                    open_addr, open_name = m.group(1), m.group(2)
                    body_lines = 0
                    continue
                e = END.match(line)
                if e:
                    if open_addr is None:
                        mismatched.append((chunk, "end without start", e.group(1)))
                        continue
                    if e.group(1) != open_addr:
                        mismatched.append((chunk, open_addr, e.group(1)))
                    if body_lines == 0:
                        empty_bodies.append((chunk, open_addr, open_name))
                    if open_addr in seen:
                        mismatched.append((chunk, open_addr, "duplicate address"))
                    else:
                        seen[open_addr] = (chunk, open_name)
                    records += 1
                    open_addr = None
                    continue
                if open_addr is not None and not SIG.match(line):
                    if line.strip():
                        body_lines += 1
        if open_addr is not None:
            unterminated.append((chunk, open_addr, "chunk ended inside record"))

    done_path = os.path.join(args.export_dir, "done.txt")
    done_addrs = []
    if os.path.exists(done_path):
        with open(done_path, "r", encoding="utf-8", errors="replace") as fh:
            done_addrs = [l.strip() for l in fh if l.strip()]

    print("chunks            : %d" % len(chunks))
    print("records written   : %d" % records)
    print("unique addresses  : %d" % len(seen))
    print("total size        : %.1f MB" % (total_bytes / 1048576.0))
    print("done.txt entries  : %d" % len(done_addrs))
    if args.expected is not None:
        print("expected total    : %d" % args.expected)
    print()

    if args.index:
        with open(args.index, "w", encoding="utf-8") as fh:
            for addr in sorted(seen):
                chunk, name = seen[addr]
                fh.write("%s\t%s\t%s\n" % (addr, name, chunk))
        print("index written     : %s (%d entries)" % (args.index, len(seen)))
        print()

    problems = 0
    for label, items in (("unterminated record", unterminated),
                         ("start/end mismatch", mismatched),
                         ("empty body", empty_bodies)):
        if items:
            problems += len(items)
            print("%-20s: %d" % (label, len(items)))
            for it in items[:10]:
                print("    ", it)

    if len(done_addrs) != len(set(done_addrs)):
        print("done.txt contains duplicate addresses")
        problems += 1
    missing_from_done = set(seen) - set(done_addrs)
    if missing_from_done:
        print("records missing from done.txt: %d" % len(missing_from_done))
        problems += 1

    # Addresses recorded as done but with no record written: these are the
    # functions whose decompilation failed or timed out. They are also the ones
    # a resume would silently skip, so they must be surfaced, not hidden.
    no_record = [a for a in done_addrs if a not in seen]
    if no_record:
        print("failed / no record : %d" % len(no_record))
        for a in no_record[:20]:
            print("    ", a)
        if len(no_record) > args.max_failures:
            print("exceeds --max-failures %d" % args.max_failures)
            problems += 1

    if args.expected is not None and records != args.expected:
        print("record count %d != expected %d" % (records, args.expected))
        problems += 1

    if problems:
        print("\nRESULT: FAIL (%d problem(s))" % problems)
        return 1
    print("RESULT: OK - %d functions decompiled, internally consistent" % records)
    return 0


if __name__ == "__main__":
    sys.exit(main())
