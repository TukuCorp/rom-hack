"""Capture the LEAP expression-function registry and the fuel-property codes.

`leap.exe` builds one table of every function its expression language can call. The builder
is `FUN_01b90910`, and it does nothing but call `FUN_01b90400` for each entry with the code
and two names, so the table is recoverable by reading the decompilation rather than by
guessing from the expressions.

The record it fills is 0xc0 bytes per entry in the global array behind `PTR_DAT_037e7a38`:
the code at +0x04, the name at +0x08, the name upper-cased at +0x10, a second name at +0x18,
and at +0x20 the marker text, which the builder makes by formatting "000%d" with the code
and prefixing "@F" from a literal at 0x01b908ec. That is where @F007 comes from, and it is
why this table and the expression parser have to agree.

An argument is one of three things, and each resolves differently:

  * L"...", a literal in the code, which needs only unescaping;
  * &DAT_xxxxxxxx, a wide string in the image, read through the PE section map using the
    image base out of the optional header;
  * local_xx, a string fetched earlier by FUN_01bdcbc0(&local_xx, id) from a resource table.
    Those entries are recorded with the resource id and no name, because the resource table
    is a separate read. Every one of them still yields its second name, which the call site
    spells out.

The fuel properties are numbered in the same space and registered elsewhere, by three
functions that each map a property name to the expression text that yields it:

    FUN_0289e140(dst, L"carboncontent", L"@F175", scratch)

That is a second and independent statement of the numbering, and one expression in the
corpus makes it checkable: @F176*(1-@F185)*(@C0004/@C0003) is the sulfur emission factor it
looks like only if 176 is sulfur content and 185 sulfur retention.

Usage: python tools/capture_function_table.py leap-rs/src/oracle_functions.rs
"""

import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BS = chr(92)
D = chr(34)
DECOMPILED = os.path.join(HERE, "..", "..", "leap-decompiled")
VENDOR_EXE = "C:/Program Files/LEAP/leap.exe"
REGISTRY_CHUNK = "chunk-00196.c"
RESOURCE_CHUNK = "chunk-00197.c"
RESOURCE_MARKER = "01bdcbc0  FUN_01bdcbc0"
PROPERTY_CHUNKS = ["chunk-00283.c", "chunk-00302.c"]
PROPERTY_CALLS = ["FUN_0289e140", "FUN_02c2e520", "FUN_02c34c80"]


DISPATCH_CHUNK = "chunk-00196.c"
ARITY_CHUNK = "chunk-00195.c"
DISPATCH_CALL = re.compile(
    r"(FUN_01b5c[0-9a-f]{3})\(param_6,\s*(&DAT_[0-9a-f]+|L" + D + r"[^" + D + r"]*" + D + r"),\s*(FUN_[0-9a-f]+)\)")


def helper_arity():
    """The arity each registration helper states, from the constant it writes at +0x10.

    The helpers are one per signature: each builds the same descriptor, fills in the name and the
    evaluator address, and writes its own number at +0x10. Reading them back gives 0 for
    FUN_01b5c0c0, 1 for FUN_01b5c120 and so on, and the numbers agree with what the vendor store:
    _gr says 1 and @F001 takes one argument, _gras says 8 and @F037 takes eight, _grasel says 9 and
    @F041 takes nine.
    """
    path = os.path.join(DECOMPILED, ARITY_CHUNK)
    out = {}
    current = None
    for line in open(path, encoding="utf-8", errors="replace"):
        m = re.match(r"void (FUN_01b5c[0-9a-f]{3})\(", line)
        if m:
            current = m.group(1)
        if current and "+ 0x10)" in line and "=" in line and current not in out:
            value = line.split("=")[-1].strip().rstrip(";")
            if re.fullmatch(r"(0x[0-9a-f]+|[0-9]+)", value):
                out[current] = int(value, 0)
        if line.startswith("/* ===== end"):
            current = None
    return out


def evaluators(image):
    """Every (second name, registration helper, evaluator address) the dispatch states.

    `FUN_01b89f80` is the other half of the picture: for each entry it hands the second name
    and the address of the function that actually evaluates it to one of a family of helpers,
    one per signature. That is the list of things a port has to implement, and the helper
    reused by a name is a statement about the signature that a later pass can read.
    """
    path = os.path.join(DECOMPILED, DISPATCH_CHUNK)
    found = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        m = DISPATCH_CALL.search(line)
        if not m:
            continue
        helper = m.group(1)
        name = resolve(m.group(2), {}, image, {})[0]
        if name is None:
            continue
        found.setdefault(name, (helper, int(m.group(3)[len("FUN_"):], 16)))
    return sorted(found.items())


def section_map(path):
    """(data, image base, sections) out of a PE header."""
    data = open(path, "rb").read()
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    coff = pe + 4
    count, = struct.unpack_from("<H", data, coff + 2)
    opt_size, = struct.unpack_from("<H", data, coff + 16)
    opt = coff + 20
    magic, = struct.unpack_from("<H", data, opt)
    if magic == 0x20B:
        base, = struct.unpack_from("<Q", data, opt + 24)
    else:
        base, = struct.unpack_from("<I", data, opt + 28)
    sections = []
    table = opt + opt_size
    for i in range(count):
        at = table + 40 * i
        name = data[at:at + 8].rstrip(bytes(1)).decode("latin-1")
        vsize, va, rsize, raw = struct.unpack_from("<IIII", data, at + 8)
        sections.append((name, va, max(vsize, rsize), raw))
    return data, base, sections


class Image:
    """A mapped image, enough to read a wide string at a virtual address."""

    def __init__(self, path):
        self.data, self.base, self.sections = section_map(path)

    def wide_at(self, va, limit=200):
        rva = va - self.base
        for _, sva, size, raw in self.sections:
            if sva <= rva < sva + size:
                at = raw + (rva - sva)
                out = []
                for i in range(0, limit * 2, 2):
                    c = self.data[at + i] | (self.data[at + i + 1] << 8)
                    if c == 0:
                        return "".join(out)
                    out.append(chr(c))
                return "".join(out)
        return None


def split_args(text):
    """Split on the commas that are not inside a quoted literal."""
    out, cur, quoted = [], [], False
    for ch in text:
        if ch == D:
            quoted = not quoted
            cur.append(ch)
        elif ch == "," and not quoted:
            out.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur).strip())
    return out


ESCAPES = {"r": chr(13), "n": chr(10), "t": chr(9), "0": chr(0), BS: BS,
           D: D, chr(39): chr(39)}


def unescape(text):
    """The body of a C wide literal, back into the string it spells."""
    out = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == BS and i + 1 < len(text):
            nxt = text[i + 1]
            if nxt in ESCAPES:
                out.append(ESCAPES[nxt])
                i += 2
                continue
            if nxt == "x":
                j = i + 2
                while j < len(text) and text[j] in "0123456789abcdefABCDEF":
                    j += 1
                out.append(chr(int(text[i + 2:j], 16)))
                i = j
                continue
            out.append(nxt)
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def literal_arg(arg):
    """The string an L"..." argument spells, or None when it is something else."""
    if arg.startswith("L") and len(arg) > 2 and arg[1] == D and arg.endswith(D):
        return unescape(arg[2:-1])
    return None


def resource_names(image):
    """The id to name switch inside FUN_01bdcbc0, which is how a resource name resolves.

    The function is nothing but a chain of `if (param_2 == n) { FUN_00415060(param_1,
    L"Name"); return param_1; }`, so each branch is one entry and no runtime is needed to
    read it.
    """
    path = os.path.join(DECOMPILED, RESOURCE_CHUNK)
    body = []
    inside = False
    for line in open(path, encoding="utf-8", errors="replace"):
        if RESOURCE_MARKER in line:
            inside = True
            continue
        if inside and line.startswith("/* ====="):
            break
        if inside:
            body.append(line)
    names = {}
    pending = None
    for line in body:
        m = re.search(r"if \(param_2 == ([0-9a-fxA-F]+)\)", line)
        if m:
            pending = int(m.group(1), 0)
            continue
        m = re.search(r"FUN_00415060\(param_1,(&DAT_[0-9a-f]+|L" + D + r"[^" + D + r"]*" + D + r")\)", line)
        if m and pending is not None:
            names[pending] = resolve(m.group(1), {}, image, {})[0]
            pending = None
    return names


def resolve(arg, resources, image, names):
    """A name argument, as (string, resource id)."""
    text = literal_arg(arg)
    if text is not None:
        return text, None
    if arg.startswith("&DAT_"):
        return image.wide_at(int(arg[len("&DAT_"):], 16)), None
    if arg in resources:
        return names.get(resources[arg]), resources[arg]
    raise SystemExit("cannot resolve the name argument %s" % arg)


def registrations(source, resources, image, names):
    """Every (code, name, name resource id, second name) the builder registers."""
    out = []
    call = re.compile(r"FUN_01b90400\([^,]+,\s*([^,]+),\s*(.*)\)\s*;\s*$")
    for line in source:
        text = line.strip()
        if "FUN_01b90400(" not in text or not text.endswith(";"):
            continue
        m = call.search(text)
        if not m:
            continue
        args = split_args(m.group(2))
        if len(args) != 2:
            raise SystemExit("expected two names in: %s" % text)
        name, resource = resolve(args[0], resources, image, names)
        short, _ = resolve(args[1], resources, image, names)
        out.append((int(m.group(1).strip(), 0), name, resource, short))
    out.sort()
    return out


def properties():
    """Every (property name, @F code) pair the three mapping functions state."""
    found = {}
    for chunk in PROPERTY_CHUNKS:
        path = os.path.join(DECOMPILED, chunk)
        for line in open(path, encoding="utf-8", errors="replace"):
            if not any(name + "(" in line for name in PROPERTY_CALLS):
                continue
            at = line.find("(")
            args = split_args(line[at + 1:].rstrip().rstrip(";").rstrip(")"))
            if len(args) < 3:
                continue
            name = literal_arg(args[1])
            code = literal_arg(args[2])
            if name is None or code is None:
                continue
            m = re.fullmatch(r"@F([0-9]+)", code)
            if m:
                found.setdefault(name, int(m.group(1)))
    return sorted(found.items(), key=lambda kv: (kv[1], kv[0]))


def rust_str(s):
    """A Rust string literal for s, or None."""
    if s is None:
        return "None"
    body = []
    for ch in s:
        if ch == D:
            body.append(BS + D)
        elif ch == BS:
            body.append(BS + BS)
        elif 0x20 <= ord(ch) < 0x7F:
            body.append(ch)
        else:
            body.append(BS + "u{%x}" % ord(ch))
    return "Some(" + D + "".join(body) + D + ")"


def rust_num(n):
    return "None" if n is None else "Some(%d)" % n


def main(out):
    image = Image(VENDOR_EXE)
    path = os.path.join(DECOMPILED, REGISTRY_CHUNK)
    source = open(path, encoding="utf-8", errors="replace").read().split(chr(10))

    # FUN_01bdcbc0(&local_78, 0x1e) fills a local from the resource table.
    resources = {}
    resource = re.compile(r"FUN_01bdcbc0\(&(local_[0-9a-f]+)\s*,\s*([^)]*)\);")
    for line in source:
        m = resource.search(line)
        if m:
            resources[m.group(1)] = int(m.group(2).strip(), 0)

    entries = registrations(source, resources, image, resource_names(image))
    props = properties()
    evals = evaluators(image)
    helpers = helper_arity()
    by_short = {}
    for code, _name, _resid, short in entries:
        if short:
            by_short.setdefault(short.lower(), code)
    arity = []
    for short, (helper, _address) in evals:
        code = by_short.get(short)
        if code is not None and helper in helpers:
            arity.append((code, helpers[helper]))
    arity.sort()

    lines = []
    lines.append("// GENERATED by tools/capture_function_table.py -- do not edit by hand.")
    lines.append("//")
    lines.append("// Every function the LEAP expression language can call, as the vendor registers")
    lines.append("// them in FUN_01b90910: the code, the name, the name resource id when the name")
    lines.append("// comes from the resource table rather than from a literal, and the second name")
    lines.append("// that every call site spells out.")
    lines.append("//")
    lines.append("// (code, name, name resource id, second name)")
    lines.append("pub const LEAP_FUNCTIONS: &[(u32, Option<&str>, Option<u32>, Option<&str>)] = &[")
    for code, name, resid, short in entries:
        lines.append("    (%d, %s, %s, %s)," % (code, rust_str(name), rust_num(resid), rust_str(short)))
    lines.append("];")
    lines.append("")
    lines.append("/// Property names, each mapped by the vendor to the expression that yields it.")
    lines.append("/// A second statement of the numbering, from a different site in the binary.")
    lines.append("pub const LEAP_PROPERTIES: &[(&str, u32)] = &[")
    for name, code in props:
        lines.append("    (%s, %d)," % (rust_str(name)[5:-1], code))
    lines.append("];")
    lines.append("")
    lines.append("/// Second name, the helper that registered it, and the address of the function")
    lines.append("/// that evaluates it: the list of what a port has to implement.")
    lines.append("pub const LEAP_EVALUATORS: &[(&str, &str, usize)] = &[")
    for name, (helper, addr) in evals:
        lines.append("    (%s, %s, %#x)," % (rust_str(name)[5:-1], D + helper + D, addr))
    lines.append("];")
    lines.append("")
    lines.append("/// Code and the number of arguments its evaluator takes, as the helper that")
    lines.append("/// registered it states. Only the codes whose helper is known appear.")
    lines.append("pub const LEAP_ARITY: &[(u32, u32)] = &[")
    for code, count in arity:
        lines.append("    (%d, %d)," % (code, count))
    lines.append("];")
    with open(out, "w", encoding="utf-8", newline=chr(10)) as fh:
        fh.write(chr(10).join(lines) + chr(10))

    named = sum(1 for e in entries if e[1] is not None)
    print("wrote %s" % out)
    print("  %d registrations, %d named, %d named from the resource table"
          % (len(entries), named, sum(1 for e in entries if e[2] is not None)))
    print("  codes %d..%d" % (entries[0][0], entries[-1][0]))
    print("  %d property codes, %d..%d" % (len(props), min(c for _, c in props),
                                            max(c for _, c in props)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
