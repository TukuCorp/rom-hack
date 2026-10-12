#!/usr/bin/env python3
"""Differential sweep: run the ported binary and the vendor program on the same inputs.

Every other suite in the crate consists of vectors I chose. This one builds archives I did
not choose, including deliberately awkward ones, and diffs the two programs on exit code
and the whole of stdout. It is the check most likely to find a gap in the minimal zip
reader, since that reader knows nothing about zip64, unicode names or archive comments.

Usage: differential_sweep.py --vendor PATH --ours PATH
"""

import argparse
import os
import random
import subprocess
import sys
import tempfile
import zipfile

# The zip64 shapes need byte surgery, so the sweep borrows the helpers the container
# capture uses rather than growing a second copy that could drift.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from capture_container_oracle import to_zip64_entry, to_zip64_eocd

REQ = ["masterstructure.nx1", "areadata.nx1", "scenariodata.nx1", "staticdata.nx1",
       "scenariodata.nx1", "years.nx1"]
ETERNA = ["a.txt", "b.csv", "data", "tool.exe", "x.php", "sub/tool.msc",
          "meta/sysinfo.txt", "SYSINFO.TXT", "caf\u00e9.nx1", "deep/a/b/years.nx1"]


def write_zip(path, members, compress=zipfile.ZIP_DEFLATED, comment=None, force_zip64=False):
    with zipfile.ZipFile(path, "w", compress) as zf:
        for name, data in members:
            if force_zip64:
                with zf.open(name, "w", force_zip64=True) as fh:
                    fh.write(data)
            else:
                zf.writestr(name, data)
        if comment:
            zf.comment = comment


def edge_cases(path_dir):
    """Names and structures chosen to poke at the reader rather than to be realistic."""
    out = []
    base = [(m, b"x") for m in REQ] + [("sysinfo.txt", b"Area Name: VN" + bytes([13, 10]))]

    def add(name, members, **kw):
        filename = name + ".leap"
        write_zip(os.path.join(path_dir, filename), members, **kw)
        out.append(filename)

    add("e_backslash_name", base + [("sub\\tool.exe", b"x")])
    add("e_unicode_name", base + [("caf\u00e9.nx1", b"x")])
    add("e_duplicate_names", base + [("dup.txt", b"x"), ("dup.txt", b"y")])
    add("e_trailing_space", base + [("tool.exe ", b"x")])
    add("e_trailing_dot", base + [("tool.exe.", b"x")])
    add("e_directory_entry", base + [("adir/", b"")])
    add("e_zero_byte_member", base + [("empty.txt", b"")])
    add("e_long_name", base + [("l" * 300 + ".txt", b"x")])
    add("e_parent_path", base + [("../escape.exe", b"x")])
    add("e_nested_required", [("sub/" + m, b"x") for m in REQ] + [("sysinfo.txt", b"x")])
    add("e_upper_required", [(m.upper(), b"x") for m in REQ] + [("sysinfo.txt", b"x")])
    add("e_zip64", base, force_zip64=True)
    add("e_stored", base, compress=zipfile.ZIP_STORED)
    add("e_comment", base, comment=b"a trailing comment" + bytes([0x50, 0x4b, 0x05, 0x06]))
    add("e_only_dirs", [("one/", b""), ("two/", b"")])
    add("e_no_local_headers", base)
    add("e_db_and_meta", base + [("masterstructure.db", b"x")])
    add("e_forbidden_and_missing", [("a.txt", b"x"), ("b.php", b"x")])

    # The zip64 shapes, which a normal writer will not produce for a small archive.
    for name, surgery in (("e_zip64_eocd", to_zip64_eocd),
                          ("e_zip64_entry", lambda p: to_zip64_entry(p, 6))):
        filename = name + ".leap"
        write_zip(os.path.join(path_dir, filename), base)
        surgery(os.path.join(path_dir, filename))
        out.append(filename)
    return out


def fault_cases(path_dir):
    """Archives whose member basename is empty. These are kept out of the main sweep,
    which is meant to be a strict gate, because the vendor does not survive them: it
    dereferences a null and dies with EAccessViolation. The port has no equivalent fault
    to reproduce, so this is a deliberate divergence rather than a bug to chase."""
    base = [(m, b"x") for m in REQ] + [("sysinfo.txt", b"x")]
    out = []
    for name, member in (("f_empty_name", ""), ("f_slash_name", "/")):
        write_zip(os.path.join(path_dir, name + ".leap"), base + [(member, b"x")])
        out.append(name + ".leap")
    return out


def random_cases(path_dir, seed, count):
    rng = random.Random(seed)
    out = []
    for i in range(count):
        members = []
        for m in REQ:
            if rng.random() < 0.85:
                members.append((m, b"x"))
        if rng.random() < 0.8:
            members.append(("sysinfo.txt", rng.choice([
                b"x", b"Area Name: VN" + bytes([13, 10]),
                b"Base Year: 2020" + bytes([10]), b"Regions: 3" + bytes([13, 10]),
            ])))
        for extra in rng.sample(ETERNA, rng.randrange(0, 4)):
            members.append((extra, b"x"))
        rng.shuffle(members)
        name = "r%03d.leap" % i
        compress = rng.choice([zipfile.ZIP_DEFLATED, zipfile.ZIP_STORED])
        write_zip(os.path.join(path_dir, name), members, compress=compress)
        out.append(name)
    return out


def run(program, args, cwd):
    p = subprocess.run([program] + args, cwd=cwd, capture_output=True, timeout=120)
    code = p.returncode
    if code > 2 ** 31:
        code -= 2 ** 32
    return code, (p.stdout or b"")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vendor", required=True)
    ap.add_argument("--ours", required=True)
    ap.add_argument("--random", type=int, default=60)
    ap.add_argument("--seed", type=int, default=20261012)
    args = ap.parse_args()

    for program in (args.vendor, args.ours):
        if not os.path.exists(program):
            print("missing %s" % program, file=sys.stderr)
            return 1

    work = tempfile.mkdtemp(prefix="leap_sweep_")
    faults = tempfile.mkdtemp(prefix="leap_sweep_faults_")
    fault_names = fault_cases(faults)
    names = edge_cases(work) + random_cases(work, args.seed, args.random)

    lists = [[n] for n in names]
    lists.append(["*.leap"])
    lists.append(["r0*.leap"])
    lists.append(["e_*.leap", "/S"])
    lists.append([names[0], names[1], "/S"])
    lists.append([names[0], "/N"])
    lists.append([names[0], "/Q"])
    lists.append(["*.nothing"])

    bad = 0
    for argument_list in lists:
        vcode, vout = run(args.vendor, argument_list, work)
        ocode, oout = run(args.ours, argument_list, work)
        if vcode != ocode or vout != oout:
            bad += 1
            print("DIVERGENCE %r" % (argument_list,))
            print("   exit vendor=%s ours=%s" % (vcode, ocode))
            if vout != oout:
                print("   vendor %r" % vout[:400])
                print("   ours   %r" % oout[:400])

    print()
    print("--- archives the vendor cannot survive, checked separately ---")
    unexpected = 0
    for name in fault_names:
        vcode, vout = run(args.vendor, [name], faults)
        ocode, oout = run(args.ours, [name], faults)
        faulted = b"EAccessViolation" in vout
        print("  %-16s vendor exit=%-3s faulted=%-5s ours exit=%-3s %r"
              % (name, vcode, faulted, ocode, oout[:70]))
        if not faulted:
            unexpected += 1
            print("     the vendor no longer faults here, so the carve-out is stale")

    print()
    print("archives=%d argument-lists=%d divergences=%d stale-faults=%d"
          % (len(names), len(lists), bad, unexpected))
    print("workdir:", work)
    print("faults :", faults)
    return 1 if (bad or unexpected) else 0


if __name__ == "__main__":
    sys.exit(main())
