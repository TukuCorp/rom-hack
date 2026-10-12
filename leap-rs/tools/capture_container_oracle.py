#!/usr/bin/env python3
"""Capture ground truth for the .leap container validator from the real binary.

The decision chain is entry @ 0x0061a848 in testleap.exe, which asks the zip
library whether the archive contains a member (FUN_0060df1c) and assigns a
verdict code in this order, first failing check wins:

  5  archive will not open as a zip          (FUN_00610058)
  1  contains masterstructure.db             (pre-2012 LEAP layout)
  3  any of the required .nx1 members absent
  4  any of the 27 forbidden patterns present
  7  no sysinfo.txt                          (FUN_00611e78)
  0  valid

Three output modes are captured per vector, because they differ:

  default   one message per file, nothing more
  /S short  no messages, a single "Result: <code>" line
  /Q quiet  no output at all; only the exit code survives

The file is named <case>.leap and passed as a relative name with the working
directory set to the temp dir, so the path that appears inside the messages is
deterministic and reproducible by the port. Writes src/oracle_container.rs.
"""

import argparse
import os
import struct
import subprocess
import sys
import tempfile
import zipfile

TESTLEAP = "C:/Program Files/LEAP/testleap.exe"

# Cases whose sysinfo.txt is stored rather than deflated, to exercise both branches of
# the reader.
STORED = {"meta_stored"}

# Order matters: this is the order the chain in entry tests them.
REQUIRED = ["masterstructure.nx1", "areadata.nx1", "scenariodata.nx1",
            "staticdata.nx1", "scenariodata.nx1", "years.nx1"]

# The complete ordered pattern list read out of entry @ 0x0061a848 lines 356-411.
FORBIDDEN = ["*.exe", "*.com", "*.bat", "*.js", "*.cgi", "*.asp", "*.aspx",
             "*.php", "*.vbs", "*.htm", "*.html", "*.cmd", "*.sql", "*.vb",
             "*.vbscript", "*.wsf", "*.ws", "*.paf", "*.pif", "*.msi", "*.msp",
             "*.mst", "*.msc", "*.inf", "*.ins", "*.cpl", "*.command"]


# Archives that need byte surgery after zlib and zipfile have written them, because a
# normal writer will not produce the zip64 shapes for a small archive. Both helpers are
# shared with tools/differential_sweep.py so the two cannot drift apart.
ZIP64_EOCD = {"zip64_eocd", "zip64_entry"}
ZIP64_ENTRY = {"zip64_entry"}
ZIP64_ENTRY_INDEX = 6


def to_zip64_eocd(path):
    """Move the end of central directory figures into a zip64 record and leave the
    maximum values behind as placeholders."""
    raw = bytearray(open(path, "rb").read())
    at = raw.rfind(bytes([0x50, 0x4b, 5, 6]))
    if at < 0:
        raise SystemExit("no end of central directory in " + path)
    entries = struct.unpack_from("<H", raw, at + 10)[0]
    cd_size = struct.unpack_from("<I", raw, at + 12)[0]
    cd_at = struct.unpack_from("<I", raw, at + 16)[0]
    del raw[at:]

    record = bytearray()
    record += struct.pack("<I", 0x06064B50)
    record += struct.pack("<Q", 44)
    record += struct.pack("<HH", 45, 45)
    record += struct.pack("<II", 0, 0)
    record += struct.pack("<QQ", entries, entries)
    record += struct.pack("<QQ", cd_size, cd_at)
    record_at = len(raw)
    raw += record
    raw += struct.pack("<IIQI", 0x07064B50, 0, record_at, 1)
    raw += struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, 0xFFFF, 0xFFFF,
                       0xFFFFFFFF, 0xFFFFFFFF, 0)
    open(path, "wb").write(bytes(raw))


def to_zip64_entry(path, index):
    """Rewrite one central entry so its compressed size and local header offset become
    the zip64 placeholders, with the real values moved into a zip64 extra field."""
    raw = bytearray(open(path, "rb").read())
    eocd = raw.rfind(bytes([0x50, 0x4b, 5, 6]))
    cd_size = struct.unpack_from("<I", raw, eocd + 12)[0]
    at = struct.unpack_from("<I", raw, eocd + 16)[0]
    for _ in range(index):
        name_len = struct.unpack_from("<H", raw, at + 28)[0]
        extra_len = struct.unpack_from("<H", raw, at + 30)[0]
        comment_len = struct.unpack_from("<H", raw, at + 32)[0]
        at += 46 + name_len + extra_len + comment_len

    name_len = struct.unpack_from("<H", raw, at + 28)[0]
    extra_len = struct.unpack_from("<H", raw, at + 30)[0]
    compressed = struct.unpack_from("<I", raw, at + 20)[0]
    local = struct.unpack_from("<I", raw, at + 42)[0]

    extra = struct.pack("<HHQQ", 0x0001, 16, compressed, local)
    insert_at = at + 46 + name_len + extra_len
    raw[insert_at:insert_at] = extra
    struct.pack_into("<H", raw, at + 30, extra_len + 20)
    struct.pack_into("<I", raw, at + 20, 0xFFFFFFFF)
    struct.pack_into("<I", raw, at + 42, 0xFFFFFFFF)

    eocd += 20
    struct.pack_into("<I", raw, eocd + 12, cd_size + 20)
    open(path, "wb").write(bytes(raw))


def vectors():
    v = []
    base = REQUIRED + ["sysinfo.txt"]
    v.append(("valid", base, True))
    v.append(("empty_zip", [], True))
    v.append(("not_a_zip", None, False))
    for pat in FORBIDDEN:
        ext = pat[2:]
        v.append(("forbid_" + ext, base + ["tool." + ext], True))
        v.append(("forbid_" + ext + "_upper", base + ["TOOL." + ext.upper()], True))
    for nm in ("t.wsh", "t.jse", "noextension", "a.exe.txt", "a.txt.exe.note",
               "t.docx", "t.xlsm"):
        v.append(("allow_" + nm.replace(".", "_"), base + [nm], True))
    v.append(("forbid_nested_exe", base + ["sub/dir/tool.exe"], True))
    v.append(("forbid_nested_msc", base + ["x/y/tool.msc"], True))
    v.append(("db_present", REQUIRED + ["sysinfo.txt", "masterstructure.db"], True))
    v.append(("db_only", ["masterstructure.db", "sysinfo.txt"], True))
    for req in sorted(set(REQUIRED)):
        v.append(("missing_" + req.replace(".", "_"),
                  [r for r in REQUIRED if r != req] + ["sysinfo.txt"], True))
    v.append(("missing_all_nx1", ["sysinfo.txt"], True))
    # Names are spelled out rather than derived, because the file name becomes part of
    # the captured message and two cases differing only in case would collide on a
    # case-insensitive filesystem.
    for case, member in (("meta_nested", "meta/sysinfo.txt"),
                         ("meta_deep_nested", "deep/a/b/sysinfo.txt"),
                         ("meta_upper", "SYSINFO.TXT"),
                         ("meta_bak_suffix", "sysinfo.txt.bak"),
                         ("meta_plain", "sysinfo.txt")):
        v.append((case, REQUIRED + [member], True))
    v.append(("order_forbid_and_missing",
              [r for r in REQUIRED if r != "years.nx1"] + ["tool.php"], True))
    v.append(("order_forbid_and_nometa", REQUIRED + ["tool.cpl"], True))
    v.append(("order_db_and_forbid", REQUIRED + ["tool.exe", "masterstructure.db"], True))
    v.append(("order_db_and_missing", ["masterstructure.db"], True))
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
    v.append(("raw_empty", [], bytes()))
    v.append(("raw_text", [], b"nope, not an archive"))
    v.append(("raw_pk_garbage", [], bytes([80, 75, 3, 4]) + bytes(40)))
    v.append(("raw_eocd_only", [], bytes([80, 75, 5, 6]) + bytes(18)))
    v.append(("raw_eocd_bad_offset", [],
              bytes([80, 75, 5, 6]) + bytes(8) + (999).to_bytes(4, "little") + bytes(6)))
    return v


def duplicate_vectors():
    """Archives that make the reader pick between candidates.

    The vendor reads the LAST root match ignoring case, so which of two case-variant
    sysinfo.txt entries holds the meta lines decides whether anything is echoed. And a
    trailing-slash entry is a directory, which the data-file count leaves out.
    """
    meta = "Area Name: from sysinfo.txt" + chr(10)
    return [
        ("dup_last_is_plain", list(REQUIRED) + ["sysinfo.txt", "SYSINFO.TXT"], meta),
        ("dup_last_is_meta", list(REQUIRED) + ["SYSINFO.TXT", "sysinfo.txt"], meta),
        ("dup_directory", list(REQUIRED) + ["sysinfo.txt", "adir/"], "x"),
        # The two zip64 shapes. The first moves the end of central directory figures into
        # a zip64 record; the second also makes the sysinfo.txt entry use per-entry
        # placeholders, so the member read has to resolve them to echo anything.
        ("zip64_eocd", list(REQUIRED) + ["sysinfo.txt"], "x"),
        ("zip64_entry", list(REQUIRED) + ["sysinfo.txt"], meta),
    ]


def build(tmpdir, name, members, is_zip, sysinfo="x"):
    path = os.path.join(tmpdir, name + ".leap")
    if isinstance(is_zip, (bytes, bytearray)):
        with open(path, "wb") as fh:
            fh.write(is_zip)
        return path
    if not is_zip:
        with open(path, "wb") as fh:
            fh.write(b"this is not a zip archive at all")
        return path
    method = zipfile.ZIP_STORED if name in STORED else zipfile.ZIP_DEFLATED
    with zipfile.ZipFile(path, "w", method) as zf:
        for member in members:
            zf.writestr(member, sysinfo if member == "sysinfo.txt" else "x")
    if name in ZIP64_ENTRY:
        to_zip64_entry(path, ZIP64_ENTRY_INDEX)
    if name in ZIP64_EOCD:
        to_zip64_eocd(path)
    return path


def meta_vectors():
    """Vectors whose sysinfo.txt carries meta lines, to exercise the echo.

    The tool prints a line from sysinfo.txt when, after trimming, it starts with one of
    the ten known keys, case-insensitively. These probes pin the trimming, the case
    folding, the colon in the key, duplicates, and the line splitting.
    """
    keys = ("Area Name:", "Base Year:", "End Year:", "Scope:", "First Scenario Year:",
            "Regions:", "Scenarios:", "Scenario Names:", "Time Slices:",
            "User Variables:")
    out = []
    out.append(("meta_echo_order", ["Time Slices: 12", "Area Name: VN", "Regions: 1"]))
    out.append(("meta_no_keys", ["Version: 1", "Comment: hi"]))
    out.append(("meta_case_fold", ["area name: vn", "BASE YEAR: 2020"]))
    out.append(("meta_leading_space",
                ["  Area Name: indented", chr(9) + "Base Year: tabbed"]))
    out.append(("meta_prefix_only",
                ["Area Name", "Area Name:", "Area Names: x", "Area Name: ok"]))
    out.append(("meta_duplicate", ["Area Name: one", "Area Name: two"]))
    out.append(("meta_empty_value", ["Area Name:", "Base Year: "]))
    out.append(("meta_cr_only",
                ["Area Name: vn" + chr(13) + "Base Year: 2020"]))
    out.append(("meta_no_final_newline",
                ["Area Name: vn" + chr(10) + "Base Year: 2020"]))
    out.append(("meta_all_keys", [k + " v" for k in keys]))
    out.append(("meta_near_keys",
                ["Area Names: x", "Base Years: y", "Scopes: z", "Region: w"]))
    out.append(("meta_blank_lines",
                ["", "Area Name: vn", "", "Base Year: 2020", ""]))
    # A long, repetitive body so the deflate stream really uses back-references. Without
    # it the tiny bodies above never exercise the match path of the inflater.
    out.append(("meta_long",
                ["Area Name: " + ("sector " * 40) + str(i) for i in range(1, 61)]))
    # Stored, not deflated, so the uncompressed branch is exercised too.
    out.append(("meta_stored", ["Area Name: stored", "Base Year: 2021"]))
    return out


def run(cwd, args):
    # Bytes, not text. Text mode translates CRLF to LF, which would quietly weaken the
    # parity claim, and the original writes CRLF.
    p = subprocess.run([TESTLEAP] + args, cwd=cwd, capture_output=True, timeout=60)
    return p.returncode, (p.stdout or b"").decode("latin-1")


def esc(s):
    bs = chr(92)
    out = []
    for ch in s:
        if ch == bs:
            out.append(bs + bs)
        elif ch == chr(34):
            out.append(bs + chr(34))
        elif ch == chr(10):
            out.append(bs + "n")
        elif ch == chr(13):
            out.append(bs + "r")
        else:
            out.append(ch)
    return "".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    if not os.path.exists(TESTLEAP):
        print("missing %s" % TESTLEAP, file=sys.stderr)
        return 1

    tmpdir = tempfile.mkdtemp(prefix="leap_containervec_")
    work = [(name, members, is_zip, "x") for name, members, is_zip in vectors()]
    for name, lines in meta_vectors():
        work.append((name, list(REQUIRED) + ["sysinfo.txt"], True,
                     chr(10).join(lines) + chr(10)))
    for name, members, sysinfo in duplicate_vectors():
        work.append((name, members, True, sysinfo))

    rows = []
    for name, members, is_zip, sysinfo in work:
        build(tmpdir, name, members, is_zip, sysinfo)
        arg = name + ".leap"
        code_d, out_d = run(tmpdir, [arg])
        code_s, out_s = run(tmpdir, [arg, "/S"])
        code_q, out_q = run(tmpdir, [arg, "/Q"])
        code_n, out_n = run(tmpdir, [arg, "/N"])
        if not (code_d == code_s == code_q == code_n):
            print("verdict differs between modes for %s: %d %d %d %d"
                  % (name, code_d, code_s, code_q, code_n), file=sys.stderr)
            return 1
        with open(os.path.join(tmpdir, arg), "rb") as fh:
            payload = fh.read()
        rows.append((name, payload, code_d, out_d, out_s, out_q, out_n, members or []))

    q = chr(34)
    # The file name is part of the captured message, so two cases differing only in case
    # would silently share one file on Windows and one of the two messages would be wrong.
    lowered = [row[0].lower() for row in rows]
    clashes = sorted(set(n for n in lowered if lowered.count(n) > 1))
    if clashes:
        print("case names collide case-insensitively: %s" % clashes, file=sys.stderr)
        return 1

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("// GENERATED by tools/capture_container_oracle.py -- do not edit by hand." + chr(10))
        fh.write("// Ground truth captured by running the original testleap.exe four ways," + chr(10))
        fh.write("// with the file given as a relative name from the temp dir it sits in." + chr(10))
        fh.write("//" + chr(10))
        fh.write("// One vector per line:" + chr(10))
        fh.write("//   (case name, exact input bytes as lowercase hex, exit code," + chr(10))
        fh.write("//    default stdout, /S stdout, /Q stdout, /N stdout)" + chr(10))
        fh.write("//" + chr(10))
        fh.write("// The bytes and the stdout are stored verbatim, exactly as produced, with" + chr(10))
        fh.write("// CRLF preserved. Nothing is reconstructed and nothing is normalised. The" + chr(10))
        fh.write("// path inside the messages is always <case>.leap." + chr(10))
        fh.write("pub const CONTAINER_VECTORS: &[(&str, &str, i32, &str, &str, &str, &str)] = &[" + chr(10))
        for name, payload, code, out_d, out_s, out_q, out_n, members in rows:
            fh.write("    // %s" % (", ".join(members) if members else "raw payload"))
            fh.write(chr(10))
            cells = (q + name + q, q + payload.hex() + q, str(code),
                     q + esc(out_d) + q, q + esc(out_s) + q, q + esc(out_q) + q,
                     q + esc(out_n) + q)
            fh.write("    (" + ", ".join(cells) + "),")
            fh.write(chr(10))
        fh.write("];" + chr(10))

    print("wrote %s with %d vectors" % (args.out, len(rows)))
    hist = {}
    for _, _, code, _, _, _, _, _ in rows:
        hist[code] = hist.get(code, 0) + 1
    print("exit-code histogram: %s" % sorted(hist.items()))
    empty_q = sum(1 for r in rows if r[5] == "")
    print("vectors with empty /Q output: %d of %d" % (empty_q, len(rows)))
    echoed = sum(1 for r in rows if r[3].count(chr(13) + chr(10)) > 1)
    print("vectors whose default output exceeds the File line: %d" % echoed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
