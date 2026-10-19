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

A dictionary that crosses a page boundary is spliced first (dictionary_stream): each page carries
a 32-byte lead and a 4-byte trailer around its part of the stream, and reading those as stream
is what once looked like a "slack" in fuels and extra properties in areadata and tedtechdata.

Two things the dictionary does not state in these files, and both had to be read off the data.

The record size is zero in all the tables, because the area was written by an export that left
that descriptor field blank, so it is computed the way the engine computes it (record_size): the
summed field sizes rounded up to four bytes, plus four bytes per thirty-two fields for the
null-bitmap that ends every record. That is FUN_012ec9e0 in chunk-00122.c, reached from
FUN_012eb790's add-field accounting. Most tables obey it; for the rest the block's own bytes
pin a wider stride, measured off the block instead (BYTE_MEASURED) -- what sets it is not
established, and the dictionary does not derive it (see the note at BYTE_MEASURED).

Where the records start follows from the size (geometry): a block is a 0x20-byte header, a
used-slot bitmap of one bit per slot, and the records tiling back from 4092, so the capacity is
the most records that leave room for the header and their bitmap. The tool stops if a measured
base disagrees. The bitmap also says which slots are live (slot_map) whenever it marks exactly
the count the header states at 0x1e; where it cannot, the slot signature decides instead.

Usage: python tools/capture_nx1_records.py leap-rs/src/oracle_records.rs
"""

import struct
import sys
import zipfile

LEAP_ZIP = "C:/Program Files/LEAP/Freedonia.zip"
NEEDLE = b"\x06\x12TnxFieldDescriptor"
INDICES = b"\x07\x11IndicesDescriptor"
BLOCK = 0x1000
PAGE_LEAD = 0x20                   # a dictionary page: NXSH, page number, DICT, two words
PAGE_TAIL = 4                      # and a trailer word after the stream
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
    for this in out:
        _, _, _, offset, size = this
        if offset != end:
            return out, False
        end = offset + size
    return out, bool(out)


def record_size(rows):
    """The record size the engine computes: fields rounded to four, plus the null bitmap.

    FUN_012ec9e0 in chunk-00122.c: the summed field sizes are rounded up to a multiple of four
    (FUN_012eb790 seeds that total off each field's own size), and four bytes are added per
    thirty-two fields for the null-bitmap word at the end of every record. The 4032-divisor
    rule this replaces is refuted by the blocks themselves: RegressionResults' records sit 40
    apart where it says 42, writtenresults' 12 where it says 9, balcat2-4's 300 where it says
    336, and timeslices' 768 where it says 1008 -- none of which divide 4032 at all.
    """
    last = max(o + s for _, _, _, o, s in rows)
    return (last + 3) // 4 * 4 + 4 * ((len(rows) + 31) // 32)


def page_size(raw):
    """The page a table file is written in: its usable size at 0x14 plus the page trailer.

    Every table in the shipped area states 0x0ffc there and is written in 4 KiB pages.
    PluginProperties, Plugins, refs and uservardata state 0x1ffc: 8192-byte pages, whose
    blocks are twice as wide and whose records tile back from 8188 instead of 4092.
    """
    if raw[:4] != b"NX!2":
        return BLOCK
    usable = int.from_bytes(raw[20:24], "little")
    return usable + 4 if usable + 4 >= 0x40 else BLOCK


def data_blocks(raw, page):
    return [b * page for b in range(len(raw) // page)
            if raw[b * page:b * page + 4] == b"NXDH"]


def dictionary_stream(raw):
    """The dictionary as one stream, across the pages it spans.

    A page is PAGE_LEAD bytes of header, the stream, and a PAGE_TAIL-byte trailer, at the pitch the
    file header states (usable size at 0x14, plus four). A dictionary inside one page is returned
    as it is; one that crosses pages is the concatenation of their stream parts. Stepping over
    the seam as if it were stream is what lost fuels' ImageIndex and cut a descriptor in
    areadata and tedtechdata.
    """
    first = raw.find(NEEDLE)
    marker = raw.find(INDICES, first)
    if raw[:4] != b"NX!2" or first < 0 or marker < 0:
        return raw
    pitch = int.from_bytes(raw[20:24], "little") + 4
    if first // pitch == marker // pitch:
        return raw
    return b"".join(raw[page * pitch + PAGE_LEAD:(page + 1) * pitch - PAGE_TAIL]
                    for page in range(first // pitch, marker // pitch + 1))


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


def slot_map(block, base, cap):
    """The live slots the block's own used-slot map marks, or None when it cannot say.

    The u16 at 0x1e states how many records the block holds and the bitmap from 0x20 marks them,
    bit k for slot k, up to where the records start. When the marked slots number exactly the
    stated count, every live slot is accounted for and the rest are free; when they number fewer,
    the map is too short for the block and the caller falls back to the slot signature.
    """
    live = int.from_bytes(block[0x1e:0x20], "little")
    covered = min(cap, 8 * max(base - 0x20, 0))
    marked = [k for k in range(covered) if block[0x20 + k // 8] >> (k % 8) & 1]
    if len(marked) != live:
        return None
    return set(marked)


def live_slots(block, base, size):
    """The slots of a data block that hold live records, by its map or else by the signature."""
    cap = (len(block) - 4 - base) // size
    mapped = slot_map(block, base, cap)
    if mapped is not None:
        return sorted(mapped)
    return [k for k in range(cap)
            if not unwritten(block[base + k * size:base + (k + 1) * size], k)]


def unwritten(rec, index):
    """Whether a slot is one nothing was ever written to, or one the file has since freed.

    All zeroes is a slot nothing was written to. A freed slot holds its own number plus two in
    its first two bytes with the rest zero: years.nx1's slot 31 holds 33 and its slot 100 holds
    102, and areadata's slots 1, 2 and 3 hold 3, 4 and 5. The rest is a signature rather than the
    file's answer, and it under-filters: a units slot freed from the middle keeps its old bytes.
    """
    if all(b == 0 for b in rec):
        return True
    return all(b == 0 for b in rec[2:]) and i16(rec, 0) == index + 2


BYTE_MEASURED = {
    # Tables whose stride the block proves and the engine's rule does not reach: (name, base,
    # stride), where base is where record 0 then sits and geometry has to reproduce it. What sets
    # the wider stride is not established: OriginalFieldCount equals the placed field count
    # wherever the file states it, and the padding past the rule's end is all zeros, so it is
    # not fields the dictionary dropped. The evidence for each value is the block's own bytes:
    # the pitch of consecutive records' wide strings, the free-list links the free slots hold
    # (slot k holds k+2, and the last slot holds zero), or both.
    #
    # areadata: base 0x5c. Three of its four free slots hold links 3, 4 and 5 at 0x37c, 0x69c
    # and 0x9bc -- exactly 800 apart, slots 1, 2 and 3 -- and its fields land on 0x5c: BaseYear
    # reads d0 07 (2000) at offset 26, EndYear ee 07 (2030) at 36, the Notes blob reference is
    # (1, 6) and LastEdited is a day count that decodes into the 2020s.
    "areadata": (0x5c, 800),
    #
    # balcat, and balcat2-4, which share its schema: base 0x8c. Thirteen records, the
    # wide-string names at 0x8e, 0x1be, 0x2ee, ... every one exactly 0x130 (304) after the
    # last, and 13 * 304 from 0x8c ends at 4092. The engine's rule stops at 300, which leaves
    # the names landing three bytes late and only three of the thirteen readable.
    "balcat": (0x8c, 304),
    "balcat2": (0x8c, 304),
    "balcat3": (0x8c, 304),
    "balcat4": (0x8c, 304),
    #
    # constants: base 0x3c. Seventeen records, their Name fields at 0x3e and every one 192
    # apart; at the rule's 188 not one of the seventeen reads a printable name. The block is
    # full at 21 slots, so the base and the stride follow from each other.
    "constants": (0x3c, 192),
    #
    # datanames: base 0x3c. Twenty-one records over three blocks, TableName at 0x40 and the
    # next 576 later, every one readable: Balcat, Oil Products, Solid Fuels, ... where the
    # rule's 532 misaligns every record.
    "datanames": (0x3c, 576),
    #
    # fuels: base 0xfc. Three records, their Name fields at 0x106, 0x606 and 0xb06 -- 0x500
    # (1280) apart -- reading Non Energy, Electricity and Natural Gas. Neither 1344 nor 1028
    # puts a record where the names are.
    "fuels": (0xfc, 1280),
    #
    # landtypes: base 0x3c. Twelve records, their Name fields 336 apart, all twelve readable;
    # the rule's 328 lands four of them on the previous record's tail.
    "landtypes": (0x3c, 336),
    #
    # regioncategories and 2-4: base 0x8c, the same geometry as balcat, and their freed slots
    # prove it: the RegionCatIDs 3..13 sit at 0x1bc, 0x2ec, 0x41c ... exactly 0x130 (304)
    # apart, and the one live record's name \"All\" reads at 0x8e.
    "regioncategories": (0x8c, 304),
    "regioncategories2": (0x8c, 304),
    "regioncategories3": (0x8c, 304),
    "regioncategories4": (0x8c, 304),
    #
    # regions: base 0x2c. The freed slots' RegionIDs 3..11 sit exactly 0x170 (368) apart at
    # 0x19c, 0x30c, 0x47c ..., eleven slots of 368 from 0x2c end at 4092, and the live record
    # reads Region 1 at 0x2e. The rule's 448 puts two of its fields in the next record's text.
    "regions": (0x2c, 368),
    #
    # scenarioeffects and tedeffects: base 0x3fc. Two records, their Name fields at 0x3fe and
    # 0x9fe -- 0x600 (1536) apart -- reading Carbon Dioxide B... and Carbon Dioxide, with the
    # abbreviation and the wikipedia URL of each in the same record. The rule's 1524 is twelve
    # bytes short.
    "scenarioeffects": (0x3fc, 1536),
    "tedeffects": (0x3fc, 1536),
    #
    # scenariotemplate: base 0x7c. Three records, their Name fields at 0x89, 0x279 and 0x469
    # -- 0x1f0 (496) apart -- reading Income Growth Ra..., Population Growt... and End Year
    # Urbaniz..., and an eight-slot block.
    "scenariotemplate": (0x7c, 496),
    #
    # summaryreportrows: base 0x3c. Three records, their Comment fields at 0x4f and 0x58f --
    # 0x540 (1344) apart -- reading Key Results and Key Assumptions.
    "summaryreportrows": (0x3c, 1344),
    #
    # summaryreports: base 0x3fc. Two records, Name at 0x3fc and 0x9fc -- 0x600 (1536) apart
    # -- the first also carrying its Description at 0x534, the Name offset (0) plus 312.
    "summaryreports": (0x3fc, 1536),
    #
    # tags: base 0x3fc. Two records, Name at 0x404 and 0xa04 -- 0x600 (1536) apart -- reading
    # Fossil and Combustion Turbi...
    "tags": (0x3fc, 1536),
    #
    # taggroups: base 0x3c. Three records, Name at 0x40, 0x580 and 0xac0 -- 0x540 (1344)
    # apart -- reading Renewability, Status and Technology.
    "taggroups": (0x3c, 1344),
    #
    # tedtechdata: base 0x3c. Twelve records a block, their Name fields 336 apart, all twelve
    # readable where the rule's 332 leaves four of them unreadable.
    "tedtechdata": (0x3c, 336),
    #
    # timeslices: base 0xfc. Five records, their Name fields at 0x104, 0x404, 0x704, 0xa04 and
    # 0xd04 -- 0x300 (768) apart -- reading Hours 0000 to 1000, ... with each record's Hours
    # double following at 1000.0. Neither of the rules' values (756, 1008) lands there.
    "timeslices": (0xfc, 768),
    #
    # units: base 0x3c. Eighteen records a block, their Name fields 224 apart, all 54 over
    # three blocks readable; the rule's 216 misaligns 13 of them.
    "units": (0x3c, 224),
    #
    # variabledata: base 0x3fc. The one record's DefaultExpression and DefaultScenarioExpression
    # both read \"0\" at 0x604 and 0x926 -- the field offsets 520 and 1322 from 0x3fc -- and the
    # block holds nothing else, so the stride is what puts record 0 there with the block full.
    "variabledata": (0x3fc, 3072),
    #
    # variablecategories: base 0x3c. Twelve records, Name 576 apart, all readable; the rule's
    # 524 misaligns eleven of them.
    "variablecategories": (0x3c, 576),
    #
    # refs and uservardata are two of the four 8192-byte-page tables, so their records tile back
    # from 8188 rather than 4092. Both read out at a base of 0x3fc or 0x7fc, not the base the
    # rule's stride puts there, and their wide strings prove where record 0 is:
    #
    # refs: base 0x3fc. Two records, and the fields of the first land exactly there -- AuthorShort
    # \"IPCC\" at 0x5f4 (offset 504), RefYear \"1996\" at 0x65a (606), Title at 0x684 (648),
    # Publisher at 0x87a (1150) and the URL at 0xa70 (1652). The stride is what puts two records
    # from 0x3fc to 8188, and it is the count the block states.
    "refs": (0x3fc, 3584),
    #
    # uservardata: base 0x7fc. One record, Name \"Livestock\" at 0x7fc, Description \"Number of
    # livestock ...\" at 0x862 (102) and UnitString \"head\" at 0x958 (348); the record runs to the
    # end of the page, which is the one slot the block states.
    "uservardata": (0x7fc, 6144),
}


def geometry(page, size):
    """(base, capacity) of a data block for a record size, in pages of this size.

    The block is a 0x20-byte header, a used-slot bitmap of one bit per slot, and the records,
    which tile back from four bytes short of the page. The capacity is the most records that
    leave room for the header and their bitmap, and the base is where the first of them then
    starts. It reproduces every base measured by hand -- staticdata 0x48, balcat 0x8c,
    scenarios 0x24, regions 0x2c -- and puts years at 0x54, where the bit for slot 0 marks the
    2021 record. On an 8192-byte page it is the same rule: refs' two records tile back from
    8188 to 0x3fc, and uservardata's one from 8188 to 0x7fc.
    """
    cap = (page - 4 - 0x20) // size
    while cap and 0x20 + (cap + 7) // 8 > page - 4 - cap * size:
        cap -= 1
    return page - 4 - cap * size, cap


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
    live_counts = []
    fuels_dictionary = None
    units_holed = None
    with zipfile.ZipFile(LEAP_ZIP) as zf:
        for member in sorted(zf.namelist()):
            if not member.lower().endswith(".nx1"):
                continue
            raw = zf.read(member)
            name = member.rsplit("/", 1)[-1].replace(".nx1", "")
            rows, complete = field_descriptors(dictionary_stream(raw))
            page = page_size(raw)
            blocks = data_blocks(raw, page)
            if not complete or not rows:
                skipped.append(name)
                continue
            size = BYTE_MEASURED[name][1] if name in BYTE_MEASURED else record_size(rows)
            if size is None:
                skipped.append(name)
                continue
            base, cap = geometry(page, size)
            if cap == 0:
                # The record does not fit one of the file's own pages: no layout to state.
                skipped.append(name)
                continue
            if name in BYTE_MEASURED and BYTE_MEASURED[name][0] != base:
                raise SystemExit("%s: measured base %#x, geometry gives %#x"
                                 % (name, BYTE_MEASURED[name][0], base))
            tables.append((name, base, size, cap, rows))
            # A table with no data block is empty rather than unreadable, and the oracle says so.
            tables[-1] = (name, base, size, cap, bool(blocks), rows)
            if name == "datanames":
                first = segments(raw)[0][0]
                stop = raw.find(INDICES, first) + len(INDICES)
                block = raw[blocks[0]:blocks[0] + page]
                by_name = dict((f[0], f) for f in rows)
                want = ("TableID", "TableName", "FieldID", "SetID", "Name", "Abbreviation")
                decoded = [scan_table(block[base + k * size:], by_name, want)
                           for k in range(cap)]
                sample = (raw[first:stop], block, decoded)
            if name == "years":
                block = raw[blocks[0]:blocks[0] + page]
                by_name = dict((f[0], f) for f in rows)
                live = []
                for k in live_slots(block, base, size):
                    rec = block[base + k * size:base + (k + 1) * size]
                    name_field = by_name["Name"]
                    live.append((i16(rec, by_name["YearID"][3]),
                                 narrow(rec, name_field[3], name_field[4])))
                years = (block, live)
            if name == "regions":
                block = raw[blocks[0]:blocks[0] + page]
                by_name = dict((f[0], f) for f in rows)
                live = []
                for k in live_slots(block, base, size):
                    rec = block[base + k * size:base + (k + 1) * size]
                    name_field = by_name["Name"]
                    live.append((i16(rec, by_name["RegionID"][3]),
                                 wide(rec, name_field[3], name_field[4])))
                regions = (block, live)
            if name == "staticdata":
                block = raw[blocks[0]:blocks[0] + page]
                by_name = dict((f[0], f) for f in rows)
                live = []
                for k in live_slots(block, base, size):
                    rec = block[base + k * size:base + (k + 1) * size]
                    bid = by_name["BranchID"]
                    vid = by_name["VariableID"]
                    exp = by_name["Expression"]
                    live.append((i32(rec, bid[3]), i32(rec, vid[3]),
                                 int.from_bytes(rec[exp[3]:exp[3] + 8], "little")))
                staticdata = (block, live)
            if name in ("years", "datanames", "regions", "balcat",
                        "scenarios", "staticdata"):
                live_counts.append((name,
                                    i16(raw[blocks[0]:blocks[0] + page], 0x1e),
                                    raw[blocks[0]:blocks[0] + page].hex()))
            if name == "fuels":
                # The file's own pages through the one the dictionary ends on, so the seam the
                # dictionary crosses is in the fixture rather than repaired before it.
                pitch = int.from_bytes(raw[20:24], "little") + 4
                fuels_dictionary = raw[:(raw.find(INDICES) // pitch + 1) * pitch]
            if name == "units":
                # The first block whose slot map has a hole below its highest live slot: a
                # record deleted from the middle, which the signature cannot see.
                for one in blocks:
                    whole = raw[one:one + page]
                    cap = (page - 4 - base) // size
                    mapped = slot_map(whole, base, cap)
                    if mapped and max(mapped) + 1 != len(mapped):
                        units_holed = whole
                        break
            if name == "masterstructure":
                block = raw[blocks[0]:blocks[0] + page]
                last = raw[blocks[-1]:blocks[-1] + page]
                first = segments(raw)[0][0]
                stop = raw.find(INDICES, first) + len(INDICES)
                by_name = dict((f[0], f) for f in rows)
                got = []
                for one in blocks:
                    whole = raw[one:one + page]
                    for k in live_slots(whole, base, size):
                        rec = whole[base + k * size:base + (k + 1) * size]
                        name_field = by_name["Name"]
                        got.append((i32(rec, by_name["BranchID"][3]),
                                    i32(rec, by_name["ParentBranchID"][3]),
                                    i16(rec, by_name["BranchLevel"][3]),
                                    i16(rec, by_name["BranchType"][3]),
                                    wide(rec, name_field[3], name_field[4])))
                branches = (raw[first:stop], block, got, last)
            if name == "scenariodata":
                block = raw[blocks[0]:blocks[0] + page]
                first = segments(raw)[0][0]
                stop = raw.find(INDICES, first) + len(INDICES)
                by_name = dict((f[0], f) for f in rows)
                got = []
                for k in live_slots(block, base, size):
                    rec = block[base + k * size:base + (k + 1) * size]
                    slot = by_name["Expression"]
                    got.append((i32(rec, by_name["BranchID"][3]),
                                i16(rec, by_name["VariableID"][3]),
                                i16(rec, by_name["RegionID"][3]),
                                i16(rec, by_name["ScenarioID"][3]),
                                int.from_bytes(rec[slot[3]:slot[3] + 4], "little"),
                                int.from_bytes(rec[slot[3] + 4:slot[3] + 8], "little")))
                blob_blocks = [b for b in range(len(raw) // page)
                               if raw[b * page:b * page + 4] == b"NXHD"]
                blob = raw[blob_blocks[0] * page:(blob_blocks[0] + 1) * page]
                # Every blob block has to walk to the count it states, at the stride the block's
                # own headers show: the record occupies round_up_to_four(allocation + 2) bytes.
                # The fixture handed to the Rust tests is the block whose first memo is a sentence
                # rather than a number -- it is the one whose allocation was one byte past its
                # text, which the wider (+3) stride used to land inside the next header.
                long = None
                longest = 0
                for number in blob_blocks:
                    one = raw[number * page:(number + 1) * page]
                    stated = int.from_bytes(one[0x10:0x14], "little")
                    at = 0x14
                    seen = 0
                    first_length = 0
                    while at + 6 <= page and seen < stated:
                        alloc = one[at] | (one[at + 1] << 8)
                        size = (alloc + 2 + 3) // 4 * 4
                        if alloc < 4 or at + size > page:
                            break
                        if seen == 0:
                            first_length = alloc
                        seen += 1
                        at += size
                    if seen < stated:
                        raise SystemExit("%s: blob block at %#x walks %d of %d memos"
                                         % (name, number * page, seen, stated))
                    if first_length > longest:
                        longest = first_length
                        long = one
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
    lines.append("// (table, record base, record size, capacity, holds a data block, [(field, type, declared length, offset, size)])")
    lines.append("pub const NX1_RECORD_LAYOUT: &[(&str, usize, usize, usize, bool, &[(&str, &str, u32, u32, u32)])] = &[")
    for name, base, size, cap, has_data, rows in tables:
        lines.append("    // %s: %d fields" % (name, len(rows)))
        lines.append("    (%s, %d, %d, %d, %s, &[" % (quote(name), base, size, cap,
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
    if fuels_dictionary is None:
        fuels_dictionary = b""
    lines.append("/// The fuels table file through the page its dictionary ends on. The dictionary")
    lines.append("/// crosses a page seam, so the reader has to splice the pages to read all 45 fields.")
    lines.append("pub const NX1_FUELS_DICTIONARY: &str = %s;" % quote(fuels_dictionary.hex()))
    lines.append("")
    lines.append("/// A units data block whose used-slot map has a hole: slot 8 was deleted, and")
    lines.append("/// its residue still looks written to the unwritten-slot signature.")
    lines.append("pub const NX1_UNITS_HOLED_BLOCK: &str = %s;" % quote(units_holed.hex()))
    lines.append("")
    lines.append("/// The u16 word at 0x1e of one data block per table, which states how many")
    lines.append("/// records the table holds live: 31 years, 7 datanames, 1 region, 13 balance")
    lines.append("/// categories, 9 scenarios, 201 static values, each confirmed against the rows.")
    lines.append("pub const NX1_HEADER_LIVE_COUNTS: &[(&str, u16, &str)] = &[")
    for name, count, block_hex in live_counts:
        lines.append("    (%s, %d, %s)," % (quote(name), count, quote(block_hex)))
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
    lines.append("/// The block whose first memo is a sentence: an allocation one byte past its text, which")
    lines.append("/// the `+3` record stride used to land inside the next record's header and the `+2` stride")
    lines.append("/// does not.")
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
          % sum(1 for t in tables if not t[4]))
    print("  regions: block %d bytes, %d slots that read as written"
          % (len(regions[0]), len(regions[1])))
    print("  datanames: dictionary %d bytes, block %d bytes, %d rows"
          % (len(sample[0]), len(sample[1]), len(sample[2])))
    if skipped:
        print("  skipped: %s" % ", ".join(skipped))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
