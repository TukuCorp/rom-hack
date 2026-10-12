#!/usr/bin/env python3
"""Capture ground truth for the .leap container validator from the real binary.

The decision chain is entry @ 0x0061a848 in testleap.exe, which asks the zip
library whether the archive contains a member (FUN_0060df1c) and assigns a
verdict code in this order:

  5  archive will not open as a zip          (FUN_00610058)
  1  contains masterstructure.db             (pre-2012 LEAP format)
  3  any of the required .nx1 members absent
  4  any of the 27 forbidden patterns present
  7  no sysinfo.txt                          (FUN_00611e78)
  0  valid

Run with /S so the binary prints only "Result: <code>" and nothing else, which
makes stdout deterministic and path independent. Writes src/oracle_container.rs.
"""

import argparse
import os
import subprocess
import sys
import tempfile
import zipfile

TESTLEAP = r"C:\Program Files\LEAP\testleap.exe"

# Order matters: this is the order the chain in entry tests them.
REQUIRED = ["masterstructure.nx1", "areadata.nx1", "scenariodata.nx1",
            "staticdata.nx1", "scenariodata.nx1", "years.nx1"]

# The complete ordered pattern list read out of entry @ 0x0061a848 lines 356-411.
FORBIDDEN = ["*.exe", "*.com", "*.bat", "*.js", "*.cgi", "*.asp", "*.aspx",
             "*.php", "*.vbs", "*.htm", "*.html", "*.cmd", "*.sql", "*.vb",
             "*.vbscript", "*.wsf", "*.ws", "*.paf", "*.pif", "*.msi", "*.msp",
             "*.mst", "*.msc", "*.inf", "*.ins", "*.cpl", "*.command"]


def vectors():
    v = []
    base = REQUIRED + ["sysinfo.txt"]
    v.append(("valid", base, True))
    v.append(("empty_zip", [], True))
    v.append(("not_a_zip", None, False))
    # Every forbidden extension, one at a time, plus an uppercase variant.
    for pat in FORBIDDEN:
        ext = pat[2:]
        v.append(("forbid_" + ext, base + ["tool." + ext], True))
        v.append(("forbid_" + ext + "_upper", base + ["TOOL." + ext.upper()], True))
    # Near misses that must stay allowed.
    for nm in ("t.wsh", "t.jse", "noextension", "a.exe.txt", "a.txt.exe.note",
               "t.docx", "t.xlsm"):
        v.append(("allow_" + nm.replace(".", "_"), base + [nm], True))
    # Extension matching on a path that has no extension at all.
    v.append(("forbid_nested_exe", base + ["sub/dir/tool.exe"], True))
    v.append(("forbid_nested_msc", base + ["x/y/tool.msc"], True))
    # masterstructure.db present is the pre-2012 branch (code 1).
    v.append(("db_present", REQUIRED + ["sysinfo.txt", "masterstructure.db"], True))
    v.append(("db_only", ["masterstructure.db", "sysinfo.txt"], True))
    # Each required member missing, one at a time.
    for req in set(REQUIRED):
        v.append(("missing_" + req.replace(".", "_"),
                  [r for r in REQUIRED if r != req] + ["sysinfo.txt"], True))
    v.append(("missing_all_nx1", ["sysinfo.txt"], True))
    # Meta file variants.
    for nm in ("meta/sysinfo.txt", "deep/a/b/sysinfo.txt", "SYSINFO.TXT",
               "sysinfo.txt.bak", "sysinfo.txt"):
        v.append(("meta_" + nm.replace("/", "_").replace(".", "_"),
                  REQUIRED + [nm], True))
    # Ordering probes: which failure is reported when several apply.
    v.append(("order_forbid_and_missing",
              [r for r in REQUIRED if r != "years.nx1"] + ["tool.php"], True))
    v.append(("order_forbid_and_nometa", REQUIRED + ["tool.cpl"], True))
    v.append(("order_db_and_forbid", REQUIRED + ["tool.exe", "masterstructure.db"], True))
    v.append(("order_db_and_missing", ["masterstructure.db"], True))
    # Name-matching probes: is a required member matched by basename, and is the
    # comparison case-insensitive? The meta check already matched a nested and an
    # upper-cased sysinfo.txt, so these pin whether the other lookups behave the same.
    req = list(REQUIRED)
    v.append(("name_req_nested",
              ["sub/" + m for m in req] + ["sysinfo.txt"], True))
    v.append(("name_req_upper",
              [m.upper() for m in req] + ["sysinfo.txt"], True))
    v.append(("name_req_one_nested",
              ["sub/" + m if m == "years.nx1" else m for m in req] + ["sysinfo.txt"], True))
    v.append(("name_req_suffix_only",
              [r for r in req if r != "years.nx1"] + ["xyears.nx1", "sysinfo.txt"], True))
    v.append(("name_req_prefix_only",
              [r for r in req if r != "years.nx1"] + ["years.nx1.bak", "sysinfo.txt"], True))
    v.append(("name_db_nested",
              req + ["sysinfo.txt", "sub/masterstructure.db"], True))
    v.append(("name_db_upper",
              req + ["sysinfo.txt", "MASTERSTRUCTURE.DB"], True))
    v.append(("name_forbid_bare_ext", req + ["sysinfo.txt", ".exe"], True))
    v.append(("name_forbid_dir_entry", req + ["sysinfo.txt", "dir.exe/"], True))
    v.append(("name_forbid_upper_nested", req + ["sysinfo.txt", "sub/TOOL.EXE"], True))
    v.append(("name_forbid_double_ext", req + ["sysinfo.txt", "t.exe.exe"], True))
    v.append(("name_forbid_trailing_dot", req + ["sysinfo.txt", "tool.exe."], True))
    v.append(("name_extra_docs", req + ["sysinfo.txt", "a.txt", "b.csv", "c.pdf"], True))
    # Discriminating probes for the extension rule: does the test use "the text
    # after the last dot" or "ends with .<ext>"? Windows also strips trailing dots
    # and spaces from names, which is why tool.exe. above is still flagged.
    v.append(("ext_bare_exe", req + ["sysinfo.txt", "exe"], True))
    v.append(("ext_exe_dot", req + ["sysinfo.txt", "exe."], True))
    v.append(("ext_two_trailing_dots", req + ["sysinfo.txt", "tool.exe.."], True))
    v.append(("ext_double_dot_mid", req + ["sysinfo.txt", "tool..exe"], True))
    v.append(("ext_trailing_space", req + ["sysinfo.txt", "tool.exe "], True))
    v.append(("ext_leading_dot_upper", req + ["sysinfo.txt", ".EXE"], True))
    v.append(("ext_exe_in_middle_only", req + ["sysinfo.txt", "tool.exex"], True))
    v.append(("ext_dot_exe_dot_txt", req + ["sysinfo.txt", "tool.exe.txt"], True))
    v.append(("ext_dot_exe_dot", req + ["sysinfo.txt", ".exe."], True))
    v.append(("ext_dotdot_exe", req + ["sysinfo.txt", "..exe"], True))
    v.append(("ext_a_b_exe_dot", req + ["sysinfo.txt", "a.b.exe."], True))
    v.append(("ext_dot_only", req + ["sysinfo.txt", "."], True))
    # Malformed-archive probes, to pin the not-a-zip branch (exit 5). Each is a
    # raw byte payload written instead of a real zip.
    v.append(("raw_empty", [], b""))
    v.append(("raw_text", [], b"nope, not an archive"))
    v.append(("raw_pk_garbage", [], b"PK\x03\x04" + b"\x00" * 40))
    v.append(("raw_eocd_only", [], b"PK\x05\x06" + b"\x00" * 18))
    v.append(("raw_eocd_bad_offset", [], b"PK\x05\x06" + b"\x00" * 8 + (999).to_bytes(4, "little") + b"\x00" * 6))
    return v


def build(tmpdir, name, members, is_zip):
    path = os.path.join(tmpdir, name + ".leap")
    if isinstance(is_zip, (bytes, bytearray)):
        with open(path, "wb") as fh:
            fh.write(is_zip)
        return path
    if not is_zip:
        with open(path, "wb") as fh:
            fh.write(b"this is not a zip archive at all")
        return path
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for member in members:
            zf.writestr(member, "x")
    return path


def run(path):
    p = subprocess.run([TESTLEAP, path, "/S"], capture_output=True, text=True, timeout=60)
    return p.returncode, (p.stdout or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if not os.path.exists(TESTLEAP):
        print("missing %s" % TESTLEAP, file=sys.stderr)
        return 1

    tmpdir = tempfile.mkdtemp(prefix="leap_containervec_")
    rows = []
    for name, members, is_zip in vectors():
        path = build(tmpdir, name, members, is_zip)
        code, out = run(path)
        with open(path, "rb") as fh:
            payload = fh.read()
        rows.append((name, payload, code, out, members or [], is_zip))

    def esc(s):
        return (s.replace("\\", "\\\\").replace(chr(34), chr(92) + chr(34))
                 .replace(chr(10), chr(92) + "n").replace(chr(13), chr(92) + "r"))

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("// GENERATED by tools/capture_container_oracle.py -- do not edit by hand.\n")
        fh.write("// Ground truth captured by running the original testleap.exe with /S.\n")
        fh.write("//\n")
        fh.write("// One vector per line:\n")
        fh.write("//   (case name, the exact input file bytes as lowercase hex,\n")
        fh.write("//    expected process exit code, expected stdout)\n")
        fh.write("//\n")
        fh.write("// The bytes are stored verbatim so the test replays the exact archives the\n")
        fh.write("// verdicts were captured from, with nothing reconstructed.\n")
        fh.write("pub const CONTAINER_VECTORS: &[(&str, &str, i32, &str)] = &[\n")
        for name, payload, code, out, members, is_zip in rows:
            fh.write("    // %s\n" % (", ".join(members) if members else "raw payload"))
            fh.write("    (%s, %s, %d, %s),\n"
                     % (chr(34) + name + chr(34), chr(34) + payload.hex() + chr(34),
                        code, chr(34) + esc(out) + chr(34)))
        fh.write("];\n")

    print("wrote %s with %d vectors" % (args.out, len(rows)))
    codes = {}
    for name, payload, code, out, members, is_zip in rows:
        codes[code] = codes.get(code, 0) + 1
    print("exit-code histogram: %s" % sorted(codes.items()))
    for name, payload, code, out, members, is_zip in rows[:3]:
        print("  sample %s -> exit %d stdout %r bytes %d" % (name, code, out, len(payload)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
