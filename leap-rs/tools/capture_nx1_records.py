"""Capture the typed-row layout of a NexusDB `.nx1` table, as the vendor dictionary states it.

A table file is a header block, a dictionary, index blocks, and then data blocks tagged
`NXDH`. The records carry no field directory of their own, so the dictionary is the only thing
that says where a field sits, and it says it per field, as a stream of tagged properties:

    0x01 and 0x02  one byte,  0x03  two bytes,  0x12  four bytes,
    0x06 and 0x07  a length-prefixed string,  0x08  a flag with no value,
    0x09  a nested object, whose class name is the string that follows.

Only the properties a field actually has are written, which is why a fixed byte layout per
field does not work and the first version of this reader only managed 53 of the 86 tables. The
tokens do work, and the extraction is three rules: the field name is the first string after the
class name, the type name is the first string beginning with `nxt`, and the placement is the two
numbers after the zero encoded as 0x12. For datanames.nx1 that gives TableID at 0 size 4,
TableName at 4 size 102, FieldID at 106 size 4, SetID at 110 size 4, Name at 114 size 302,
Abbreviation at 416 size 102 and DateChanged at 518 size 8, which is exactly the layout the
bytes have.

Two things the dictionary does not state in these files, and both had to be read off the data.

The record size is zero in all eighty tables, because the area was written by an export that
left that descriptor field blank. It is mostly recoverable by arithmetic: a data block is 4096
bytes, the records area runs to 4092, and for most tables the record size is the smallest
divisor of 4032 that is at least four bytes past the last field. Not all tables obey that, and
three are overridden below (BYTE_MEASURED): their records pitch their own fields at a stride
the arithmetic does not produce, and the live records' pitch is the vendor bytes' own answer,
so the measured stride wins where it exists.

Where the records start varies by table, and that is the next open question. The samples
here decode from 60 bytes in, and datanames and years tile 4092 exactly from there,
but the three overridden tables put their first record at 0x24, 0x48 and 0x8c
(BYTE_MEASURED), and no rule is established for that base yet. The block header
carries more structure than a fixed 60 bytes: word 0x1e states the live record count
and word 0x20 onward is a used-slot bitmap, one set bit per live record.

What this still does not do, stated because it matters. Deleted records are not filtered,
and the live count and bitmap the header states are not consumed yet either, so the
reader keeps its signature test: a slot is unwritten when every byte is zero or when its
first two bytes carry the slot number and the rest is zero. That is also why the
decoded sample is datanames.nx1, whose seven records are all live, and not the year list.

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


def tokens(buf, lo, hi):
    """The tagged token stream in buf[lo:hi], as (tag, value, next)."""
    at = lo
    out = []
    while at < hi:
        tag = buf[at]
        if tag in (0x01, 0x02):
            out.append((tag, buf[at + 1], at + 2))
            at += 2
        elif tag == 0x03:
            out.append((tag, buf[at + 1] | (buf[at + 2] << 8), at + 3))
            at += 3
        elif tag == 0x12:
            out.append((tag, int.from_bytes(buf[at + 1:at + 5], "little"), at + 5))
            at += 5
        elif tag in (0x04, 0x05):
            out.append((tag, int.from_bytes(buf[at + 1:at + 5], "little"), at + 5))
            at += 5
        elif tag in (0x06, 0x07):
            n = buf[at + 1]
            out.append((tag, buf[at + 2:at + 2 + n].decode("latin-1"), at + 2 + n))
            at += 2 + n
        elif tag == 0x08:
            out.append((tag, None, at + 1))
            at += 1
        elif tag == 0x09:
            out.append((tag, None, at + 1))
            at += 1
        else:
            break
    return out


ANCHOR = bytes([0x02, 0x03, 0x01, 0x00])          # the two properties before the ordinal
MIDDLE = bytes([0x12, 0, 0, 0, 0, 0x02, 0x03])    # the zero, then the property before the pair


def number(buf, at):
    """A tagged number, as (value, next)."""
    tag = buf[at]
    if tag in (0x01, 0x02):
        return buf[at + 1], at + 2
    if tag == 0x03:
        return buf[at + 1] | (buf[at + 2] << 8), at + 3
    if tag in (0x04, 0x05, 0x12):
        return int.from_bytes(buf[at + 1:at + 5], "little"), at + 5
    return None, None


def placement(segment):
    """(offset, size) for one field, found by the byte pattern that precedes it.

    Counting tokens does not work: a field may carry more properties than another, and fields
    such as the ones in areadata.nx1, fuels.nx1 and tedtechdata.nx1 carry more than the pair
    this reader wants. The ordinal is introduced by a fixed byte pattern and the pair follows a
    fixed pattern after it, so anchoring on those is what generalises.
    """
    at = segment.find(ANCHOR)
    if at < 0:
        return None, None
    _, at = number(segment, at + len(ANCHOR))
    if at is None or segment[at:at + len(MIDDLE)] != MIDDLE:
        return None, None
    offset, at = number(segment, at + len(MIDDLE))
    size, at = number(segment, at)
    return offset, size


def segments(raw):
    """The byte range of each real TnxFieldDescriptor entry.

    The class name turns up inside stream data too -- fuels.nx1 has one followed by a string
    that is not an identifier -- so a match only counts when the name after it reads as one.
    """
    starts = []
    i = raw.find(NEEDLE)
    while i >= 0:
        at = i + len(NEEDLE)
        if raw[at:at + 1] == bytes([0x06]):
            n = raw[at + 1]
            name = raw[at + 2:at + 2 + n]
            if n and all(32 <= b < 127 for b in name):
                starts.append(i)
        i = raw.find(NEEDLE, i + 1)
    if not starts:
        return []
    end = raw.find(INDICES, starts[-1])
    if end < 0:
        end = len(raw)
    bounds = list(zip(starts, starts[1:] + [end]))
    return bounds


def field_descriptors(raw):
    """(rows, complete); a row is (name, type, declared length, offset, size)."""
    out = []
    for lo, hi in segments(raw):
        ts = tokens(raw, lo, hi)
        texts = [t for t in ts if t[0] in (0x06, 0x07)]
        names = [t for t in texts if not t[1].startswith("nxt")]
        types = [t for t in texts if t[1].startswith("nxt")]
        if len(names) < 2 or not types:
            return out, False
        name = names[1][1]                     # names[0] is the class name
        type_name = types[0][1]
        after_type = [t for t in ts if t[2] > types[0][2] and t[0] in (0x01, 0x02, 0x03, 0x12)]
        offset, size = placement(raw[lo:hi])
        if not after_type or offset is None:
            return out, False
        out.append((name, type_name, after_type[0][1], offset, size))
    # The fields have to tile the record from zero, which is a claim the bytes can settle and
    # a partial or misread descriptor stream will not survive.
    end = 0
    for _, _, _, offset, size in out:
        if offset != end:
            return out, False
        end = offset + size
    return out, bool(out)


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


def narrow(rec, off, size):
    """A narrow slot, NUL terminated inside itself."""
    end = rec[off:off + size].find(0)
    if end < 0:
        end = size
    return rec[off:off + end].decode("latin-1")


def unwritten(rec, index):
    """Whether a slot is one nothing was ever written to.

    A fresh block leaves either zeroes or, for every slot past the last written one, the slot
    number in its first two bytes with the rest zero. The year list is what makes this testable:
    with it, years.nx1 reads as exactly the 31 years 2020 to 2050, and without it the free slots
    past them read as years 33 upwards.
    """
    if all(b == 0 for b in rec):
        return True
    return all(b == 0 for b in rec[2:]) and i16(rec, 0) == index


BYTE_MEASURED = {
    # Tables whose stride the block proves and the rule gets wrong. The evidence is the pitch
    # of consecutive live records, and each entry is (name, base, stride): where record 0 sits
    # in the block and how far apart they are. Years and datanames were checked the same way
    # and agree with the rule, so they stay on it.
    #
    # staticdata: freedonia/staticdata.nx1 block 0, base 0x48. Its Expression doubles land
    # exactly on base+6 with a 20 pitch, reading 1.0, 1.0, 2021.0, 0.0 -- the year 2021 is a
    # LEAP value, not a coincidence -- and a 4-byte flag block ending in f8 after each record.
    # The header word at 0x1e states 201, and (4092-0x48)/20 is 201. At that pitch the id
    # field reads 1685, 1690, 1691, ... 1716 at offset 4, a sparse ascending list, and the
    # rule's 18 would put an id chain across slot boundaries.
    "staticdata": (0x48, 20),
    #
    # balcat: base 0x8c. Thirteen records, the wide-string names at 0x8e, 0x1be, 0x2ee, ...
    # every one exactly 0x130 (304) after the last, and 13 * 304 from 0x8c ends at 4092. The
    # rule's 336 puts two of its fields in the next record's text.
    "balcat": (0x8c, 304),
    #
    # scenarios: base 0x24. Nine records, names 0x138 (312) apart from "Current Accounts" at
    # 0x30, abbreviations 0x138 apart from "BAS" at 0x1f6. Record 1 reads Baseline -- memo
    # (index 1, blob block 13), parent 1 -- the semantics the area itself implies. Its free
    # slots 9..11 sit 0x138 apart too, marker-proven.
    "scenarios": (0x24, 312),
    #
    # regions: base 0x2c. The freed slots hold u32 numbers exactly 0x170 (368) apart at
    # 0x19c, 0x30c, 0x47c ... -- pitch the rule's 448 does not produce -- and 11 slots of
    # 368 from 0x2c end at 4092. Slot 0 is the one live record (Region 1), slots 1..9 keep
    # the RegionIDs 3..11 of the regions the area had and then deleted, with their first
    # field intact, and slot 10 is all zero.
    "regions": (0x2c, 368),
}


def esc(s):
    return s.replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34))


def quote(s):
    return chr(34) + esc(s) + chr(34)


def scan_table(rec, by_name, names):
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
    years = None
    branches = None
    scenarios = None
    regions = None
    staticdata = None
    with zipfile.ZipFile(LEAP_ZIP) as zf:
        for member in sorted(zf.namelist()):
            if not member.lower().endswith(".nx1"):
                continue
            raw = zf.read(member)
            rows, complete = field_descriptors(raw)
            name = member.rsplit("/", 1)[-1].replace(".nx1", "")
            blocks = data_blocks(raw)
            if not complete or not rows:
                skipped.append(name)
                continue
            rule = record_size(rows)
            if name in BYTE_MEASURED:
                base, size = BYTE_MEASURED[name]
            else:
                base, size = HEADER, rule
            if size is None:
                skipped.append(name)
                continue
            tables.append((name, base, size, rows))
            # A table with no data block is empty rather than unreadable, and the oracle says so.
            tables[-1] = (name, base, size, bool(blocks), rows)
            if name == "datanames":
                first = segments(raw)[0][0]
                stop = raw.find(INDICES, first) + len(INDICES)
                block = raw[blocks[0]:blocks[0] + BLOCK]
                by_name = dict((f[0], f) for f in rows)
                want = ("TableID", "TableName", "FieldID", "SetID", "Name", "Abbreviation")
                decoded = [scan_table(block[HEADER + k * size:], by_name, want)
                           for k in range(DATA // size)]
                sample = (raw[first:stop], block, decoded)
            if name == "years":
                block = raw[blocks[0]:blocks[0] + BLOCK]
                by_name = dict((f[0], f) for f in rows)
                live = []
                for k in range(DATA // size):
                    rec = block[HEADER + k * size:HEADER + (k + 1) * size]
                    if unwritten(rec, k):
                        continue
                    name_field = by_name["Name"]
                    live.append((i16(rec, by_name["YearID"][3]),
                                 narrow(rec, name_field[3], name_field[4])))
                years = (block, live)
            if name == "regions":
                block = raw[blocks[0]:blocks[0] + BLOCK]
                by_name = dict((f[0], f) for f in rows)
                live = []
                for k in range((BLOCK - 4 - base) // size):
                    rec = block[base + k * size:base + (k + 1) * size]
                    if unwritten(rec, k):
                        continue
                    name_field = by_name["Name"]
                    live.append((i16(rec, by_name["RegionID"][3]),
                                 wide(rec, name_field[3], name_field[4])))
                regions = (block, live)
            if name == "staticdata":
                block = raw[blocks[0]:blocks[0] + BLOCK]
                by_name = dict((f[0], f) for f in rows)
                live = []
                for k in range((BLOCK - 4 - base) // size):
                    rec = block[base + k * size:base + (k + 1) * size]
                    if unwritten(rec, k):
                        continue
                    bid = by_name["BranchID"]
                    vid = by_name["VariableID"]
                    exp = by_name["Expression"]
                    live.append((i32(rec, bid[3]), i32(rec, vid[3]),
                                 int.from_bytes(rec[exp[3]:exp[3] + 8], "little")))
                staticdata = (block, live)
            if name == "masterstructure":
                block = raw[blocks[0]:blocks[0] + BLOCK]
                last = raw[blocks[-1]:blocks[-1] + BLOCK]
                first = segments(raw)[0][0]
                stop = raw.find(INDICES, first) + len(INDICES)
                by_name = dict((f[0], f) for f in rows)
                got = []
                for one in blocks:
                    whole = raw[one:one + BLOCK]
                    for k in range(DATA // size):
                        rec = whole[HEADER + k * size:HEADER + (k + 1) * size]
                        if unwritten(rec, k):
                            continue
                        name_field = by_name["Name"]
                        got.append((i32(rec, by_name["BranchID"][3]),
                                    i32(rec, by_name["ParentBranchID"][3]),
                                    i16(rec, by_name["BranchLevel"][3]),
                                    i16(rec, by_name["BranchType"][3]),
                                    wide(rec, name_field[3], name_field[4])))
                branches = (raw[first:stop], block, got, last)
            if name == "scenariodata":
                block = raw[blocks[0]:blocks[0] + BLOCK]
                first = segments(raw)[0][0]
                stop = raw.find(INDICES, first) + len(INDICES)
                by_name = dict((f[0], f) for f in rows)
                got = []
                for k in range(DATA // size):
                    rec = block[HEADER + k * size:HEADER + (k + 1) * size]
                    if unwritten(rec, k):
                        continue
                    slot = by_name["Expression"]
                    got.append((i32(rec, by_name["BranchID"][3]),
                                i16(rec, by_name["VariableID"][3]),
                                i16(rec, by_name["RegionID"][3]),
                                i16(rec, by_name["ScenarioID"][3]),
                                int.from_bytes(rec[slot[3]:slot[3] + 4], "little"),
                                int.from_bytes(rec[slot[3] + 4:slot[3] + 8], "little")))
                blob_blocks = [b for b in range(len(raw) // BLOCK)
                               if raw[b * BLOCK:b * BLOCK + 4] == b"NXHD"]
                blob = raw[blob_blocks[0] * BLOCK:(blob_blocks[0] + 1) * BLOCK]
                # The block whose first record is longer than its allocation accounts for is the
                # one a walk from the header cannot finish, so the tool finds it rather than naming
                # it: 0x14 in, count the records and compare with what the block states.
                broken = None
                for number in blob_blocks:
                    one = raw[number * BLOCK:(number + 1) * BLOCK]
                    stated = int.from_bytes(one[0x10:0x14], "little")
                    at = 0x14
                    seen = 0
                    while at + 6 <= BLOCK and seen < stated:
                        alloc = one[at] | (one[at + 1] << 8)
                        size = (alloc + 6) // 4 * 4
                        if alloc < 4 or at + size > BLOCK:
                            break
                        seen += 1
                        at += size
                    if seen < stated:
                        broken = one
                        break
                long = broken
                scenarios = (raw[first:stop], block, got, blob_blocks, blob, long)

    lines = []
    lines.append("// GENERATED by tools/capture_nx1_records.py -- do not edit by hand.")
    lines.append("//")
    lines.append("// The record layout each table dictionary states, with where record 0 sits in the")
    lines.append("// block (BYTE_MEASURED tables differ from 60) and the record size that has to be")
    lines.append("// derived or measured because these files leave it blank, plus one table")
    lines.append("// dictionary bytes and its first data block, so the Rust reader runs on the vendor")
    lines.append("// bytes rather than on a fixture.")
    lines.append("//")
    lines.append("// (table, record base, record size, holds a data block, [(field, type, declared length, offset, size)])")
    lines.append("pub const NX1_RECORD_LAYOUT: &[(&str, usize, usize, bool, &[(&str, &str, u32, u32, u32)])] = &[")
    for name, base, size, has_data, rows in tables:
        lines.append("    // %s: %d fields" % (name, len(rows)))
        lines.append("    (%s, %d, %d, %s, &[" % (quote(name), base, size,
                                                  "true" if has_data else "false"))
        for row in rows:
            lines.append("        (%s, %s, %d, %d, %d),"
                         % tuple([quote(row[0]), quote(row[1])] + list(row[2:])))
        lines.append("    ]),")
    lines.append("];")
    lines.append("")
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
    lines.append("")
    lines.append("/// The first data block of years.nx1, whose written slots hold the year list.")
    lines.append("pub const NX1_YEARS_BLOCK: &str = %s;" % quote(years[0].hex()))
    lines.append("")
    lines.append("/// (year, name) for every written slot, in file order, which is insertion order.")
    lines.append("pub const NX1_YEARS_ROWS: &[(i16, &str)] = &[")
    for year, text in years[1]:
        lines.append("    (%d, %s)," % (year, quote(text)))
    lines.append("];")
    lines.append("")
    lines.append("/// The first data block of regions.nx1.")
    lines.append("pub const NX1_REGION_BLOCK: &str = %s;" % quote(regions[0].hex()))
    lines.append("")
    lines.append("/// (RegionID, Name) for every slot that reads as written, freed ones included. The")
    lines.append("/// header states one live record; the freed slots keep the RegionIDs of the regions")
    lines.append("/// the area had and deleted, which the reader does not recognise yet.")
    lines.append("pub const NX1_REGION_ROWS: &[(i32, &str)] = &[")
    for rid, text in regions[1]:
        lines.append("    (%d, %s)," % (rid, quote(text)))
    lines.append("];")
    lines.append("")
    lines.append("/// The first data block of staticdata.nx1, all 201 of whose slots are live.")
    lines.append("pub const NX1_STATICDATA_BLOCK: &str = %s;" % quote(staticdata[0].hex()))
    lines.append("")
    lines.append("/// (BranchID, VariableID, Expression as raw f64 bits), one per live slot, in file")
    lines.append("/// order. The ids ascend with gaps -- the variables that appear are only the ones")
    lines.append("/// the area gave static values, and the doubles carry the 1.0 and 2021.0 values that")
    lines.append("/// pinned this table's geometry in the first place.")
    lines.append("pub const NX1_STATICDATA_ROWS: &[(i32, i32, u64)] = &[")
    for bid, vid, bits in staticdata[1]:
        lines.append("    (%d, %d, %d)," % (bid, vid, bits))
    lines.append("];")
    lines.append("")
    lines.append("/// The masterstructure dictionary, and its first data block, which holds the top level.")
    lines.append("pub const NX1_BRANCH_DICTIONARY: &str = %s;" % quote(branches[0].hex()))
    lines.append("pub const NX1_BRANCH_BLOCK: &str = %s;" % quote(branches[1].hex()))
    lines.append("/// Its last data block, whose final slot was never written.")
    lines.append("pub const NX1_BRANCH_LAST_BLOCK: &str = %s;" % quote(branches[3].hex()))
    lines.append("")
    lines.append("/// Every branch the structure table holds, as (id, parent, level, kind, name).")
    lines.append("pub const NX1_BRANCHES: &[(i32, i32, i16, i16, &str)] = &[")
    for branch in branches[2]:
        lines.append("    (%d, %d, %d, %d, %s)," % (branch[0], branch[1], branch[2], branch[3],
                                                   quote(branch[4])))
    lines.append("];")
    lines.append("")
    lines.append("/// The first scenario data block, and the blocks its expressions live in.")
    lines.append("pub const NX1_SCENARIO_DICTIONARY: &str = %s;" % quote(scenarios[0].hex()))
    lines.append("pub const NX1_SCENARIO_BLOCK: &str = %s;" % quote(scenarios[1].hex()))
    lines.append("")
    lines.append("/// The NXHD blocks of the same file, which is where the expression memos are.")
    lines.append("pub const NX1_SCENARIO_BLOB_BLOCKS: &[usize] = &[%s];"
                 % ", ".join(str(b) for b in scenarios[3]))
    lines.append("")
    lines.append("/// The first of those blocks, which holds the memos the first rows point at.")
    lines.append("pub const NX1_SCENARIO_BLOB_BLOCK: &str = %s;" % quote(scenarios[4].hex()))
    lines.append("/// The last one, whose first record is a text longer than its allocation allows.")
    lines.append("pub const NX1_SCENARIO_LONG_BLOB_BLOCK: &str = %s;" % quote(scenarios[5].hex()))
    lines.append("")
    lines.append("/// Rows as (branch, variable, region, scenario, memo index, memo block).")
    lines.append("pub const NX1_SCENARIO_ROWS: &[(i32, i16, i16, i16, u32, u32)] = &[")
    for row in scenarios[2]:
        lines.append("    (%d, %d, %d, %d, %d, %d),"
                     % (row[0], row[1], row[2], row[3], row[4], row[5]))
    lines.append("];")
    with open(out, "w", encoding="utf-8", newline=chr(10)) as fh:
        fh.write(chr(10).join(lines) + chr(10))

    print("wrote %s" % out)
    print("  %d tables with a complete descriptor stream, %d skipped" % (len(tables), len(skipped)))
    print("  %d of them hold no data block and are therefore empty"
          % sum(1 for t in tables if not t[3]))
    print("  regions: block %d bytes, %d slots that read as written"
          % (len(regions[0]), len(regions[1])))
    print("  datanames: dictionary %d bytes, block %d bytes, %d rows"
          % (len(sample[0]), len(sample[1]), len(sample[2])))
    if skipped:
        print("  skipped: %s" % ", ".join(skipped))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
