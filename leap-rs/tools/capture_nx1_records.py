"""Capture the typed-row layout of a NexusDB `.nx1` table, as the vendor dictionary states it.

A table file is a header block, a dictionary, index blocks, and then data blocks tagged
`NXDH`. The records carry no field directory of their own, so the dictionary is the only
thing that says where a field sits, and it says it per field:

    TnxFieldDescriptor, the field name, the type name, the declared length, an ordinal,
    and then a pair of encoded numbers, the offset and the size.

The numbers are written as a tag byte and then a value whose width the tag names: 0x02 is
one byte, 0x03 is two, 0x12 is four. Reading the pair for datanames.nx1 gives TableID at 0
size 4, TableName at 4 size 102, FieldID at 106 size 4, SetID at 110 size 4, Name at 114
size 302, Abbreviation at 416 size 102 and DateChanged at 518 size 8, which is exactly the
layout the bytes have: the first record spells Balcat then Electricity with the integers
between them, and every wide-string slot decodes as clean UTF-16 in all seven records of
the block.

Two things the dictionary does not state in these files, and both had to be read off the data.

The record size is zero in every one of the eighty tables, because the area was written by an
export that left that descriptor field blank. It is recoverable: a data block is 4096 bytes
with a 60-byte header, the records area is 4032 bytes, and it holds a whole number of records,
so the record size is the smallest divisor of 4032 that is at least four bytes past the last
field. That predicts 12 for years, 224 for units, 448 for regions and 576 for datanames, and
each is what the bytes show.

The record base is 60 bytes into the block rather than 64: the fourth byte the header looks
like it has belongs to the first record. Reading strings from a 64-byte base misaligns every
one of them, which is how the 60 was found.

What this does not do yet. Deleted records are not filtered, and they matter: in years.nx1 the
records past the live ones still carry bytes, and the first two of them count up from 78, which
is a free-record chain rather than a year. NexusDB keeps a deleted-record map in the block
header, and a reader that wants live rows has to consult it. That is the next read, and it is
why the decoded sample here is datanames.nx1, whose seven records are all live.

Usage: python tools/capture_nx1_records.py leap-rs/src/oracle_records.rs
"""

import struct
import sys
import zipfile

LEAP_ZIP = "C:/Program Files/LEAP/Freedonia.zip"
NEEDLE = b"\x06\x12TnxFieldDescriptor"
INDICES = b"\x07\x11IndicesDescriptor"
BLOCK = 0x1000
HEADER = 0x3c
DATA = BLOCK - HEADER - 4          # 4032 records bytes, four spare at the end of the block


def read_value(buf, at):
    """A tag byte and the value whose width it names."""
    tag = buf[at]
    if tag == 0x02:
        return buf[at + 1], at + 2
    if tag == 0x03:
        return buf[at + 1] | (buf[at + 2] << 8), at + 3
    if tag == 0x12:
        return int.from_bytes(buf[at + 1:at + 5], "little"), at + 5
    raise ValueError("tag %#x" % tag)


def field_descriptors(raw):
    """(rows, complete) where a row is (name, type, declared length, offset, size)."""
    at = raw.find(NEEDLE)
    if at < 0:
        return [], False
    rows = []
    while raw[at:at + len(NEEDLE)] == NEEDLE:
        at += len(NEEDLE)
        try:
            n = raw[at + 1]
            name = raw[at + 2:at + 2 + n].decode("latin-1")
            at += 2 + n
            _, at = read_value(raw, at)
            n = raw[at + 1]
            type_name = raw[at + 2:at + 2 + n].decode("latin-1")
            at += 2 + n
            declen, at = read_value(raw, at)
            if raw[at:at + 7] != bytes([2, 0, 8, 2, 3, 1, 0]):
                return rows, False
            at += 7
            _, at = read_value(raw, at)
            if raw[at:at + 5] != bytes([0x12, 0, 0, 0, 0]) or raw[at + 5:at + 7] != bytes([2, 3]):
                return rows, False
            at += 7
            offset, at = read_value(raw, at)
            size, at = read_value(raw, at)
            if raw[at:at + 2] != bytes([8, 8]):
                return rows, False
            at += 6
        except (ValueError, IndexError):
            return rows, False
        rows.append((name, type_name, declen, offset, size))
    # A fields-descriptor trailer sits between the last field and the indices descriptor.
    return rows, INDICES in raw[at:at + 32]


def record_size(rows):
    """The smallest divisor of DATA that leaves room for every field plus four bytes."""
    last = max(o + s for _, _, _, o, s in rows)
    for size in range(4, DATA + 1):
        if DATA % size == 0 and size >= last + 4:
            return size
    return None


def data_blocks(raw):
    return [b * BLOCK for b in range(len(raw) // BLOCK)
            if raw[b * BLOCK:b * BLOCK + 4] == b"NXDH"]


def wide(rec, off, size):
    """The UTF-16 text in a slot, which is NUL terminated inside it."""
    out = []
    for i in range(size // 2 - 1):
        c = rec[off + 2 * i] | (rec[off + 2 * i + 1] << 8)
        if c == 0:
            break
        out.append(chr(c))
    return "".join(out)


def i16(rec, off):
    return struct.unpack_from("<h", rec, off)[0]


def i32(rec, off):
    return struct.unpack_from("<i", rec, off)[0]


def esc(s):
    return s.replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34))


def quote(s):
    return chr(34) + esc(s) + chr(34)


def scan_table(rec, by_name, names):
    """(value, ...) for the named fields of one record."""
    out = []
    for name in names:
        _, type_name, _, off, size = by_name[name]
        if type_name == "nxtInt16":
            out.append(i16(rec, off))
        elif type_name == "nxtInt32":
            out.append(i32(rec, off))
        elif type_name == "nxtWideString":
            out.append(wide(rec, off, size))
        else:
            out.append(None)
    return tuple(out)


def main(out):
    tables = []
    skipped = []
    sample = None
    with zipfile.ZipFile(LEAP_ZIP) as zf:
        for member in sorted(zf.namelist()):
            if not member.lower().endswith(".nx1"):
                continue
            raw = zf.read(member)
            rows, complete = field_descriptors(raw)
            name = member.rsplit("/", 1)[-1].replace(".nx1", "")
            blocks = data_blocks(raw)
            if not complete or not rows or not blocks:
                skipped.append(name)
                continue
            size = record_size(rows)
            if size is None:
                skipped.append(name)
                continue
            tables.append((name, size, rows))
            if name == "datanames":
                start = raw.find(NEEDLE)
                stop = raw.find(INDICES, start) + len(INDICES)
                block = raw[blocks[0]:blocks[0] + BLOCK]
                by_name = dict((f[0], f) for f in rows)
                decoded = [scan_table(block[HEADER + k * size:], by_name,
                                      ["TableID", "TableName", "FieldID", "SetID", "Name",
                                       "Abbreviation"])
                           for k in range(DATA // size)]
                sample = (raw[start:stop], block, decoded)

    lines = []
    lines.append("// GENERATED by tools/capture_nx1_records.py -- do not edit by hand.")
    lines.append("//")
    lines.append("// The record layout each table dictionary states, with the record size that has")
    lines.append("// to be derived because these files leave it blank, plus one table dictionary")
    lines.append("// bytes and its first data block, so the Rust reader runs on the vendor bytes")
    lines.append("// rather than on a fixture.")
    lines.append("//")
    lines.append("// (table, record size, [(field, type, declared length, offset, size)])")
    lines.append("pub const NX1_RECORD_LAYOUT: &[(&str, usize, &[(&str, &str, u32, u32, u32)])] = &[")
    for name, size, rows in tables:
        lines.append("    // %s: %d fields" % (name, len(rows)))
        lines.append("    (%s, %d, &[" % (quote(name), size))
        for row in rows:
            lines.append("        (%s, %s, %d, %d, %d),"
                         % tuple([quote(row[0]), quote(row[1])] + list(row[2:])))
        lines.append("    ]),")
    lines.append("];")
    lines.append("")
    lines.append("/// The datanames dictionary, from its first field descriptor to the indices one.")
    lines.append("pub const NX1_DATANAMES_DICTIONARY: &str = %s;" % quote(sample[0].hex()))
    lines.append("")
    lines.append("/// The first data block of datanames.nx1. All seven of its records are live.")
    lines.append("pub const NX1_DATANAMES_BLOCK: &str = %s;" % quote(sample[1].hex()))
    lines.append("")
    lines.append("/// Those records, as (TableID, TableName, FieldID, SetID, Name, Abbreviation).")
    lines.append("pub const NX1_DATANAMES_ROWS: &[(i32, &str, i32, i32, &str, &str)] = &[")
    for row in sample[2]:
        lines.append("    (%d, %s, %d, %d, %s, %s),"
                     % (row[0], quote(row[1]), row[2], row[3], quote(row[4]), quote(row[5])))
    lines.append("];")
    with open(out, "w", encoding="utf-8", newline=chr(10)) as fh:
        fh.write(chr(10).join(lines) + chr(10))

    print("wrote %s" % out)
    print("  %d tables with a complete descriptor stream, %d skipped" % (len(tables), len(skipped)))
    print("  datanames: dictionary %d bytes, block %d bytes, %d rows"
          % (len(sample[0]), len(sample[1]), len(sample[2])))
    if skipped:
        print("  skipped: %s" % ", ".join(skipped))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
