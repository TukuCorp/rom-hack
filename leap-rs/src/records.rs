//! Typed rows out of a NexusDB table, which is what turns a `.leap` area into numbers.
//!
//! `crate::nx1` reads a table dictionary as text and the record area as wide strings. This
//! module goes the rest of the way: it reads the offset and size the dictionary states for each
//! field, works out how long a record is, and decodes the fields by type.
//!
//! The dictionary is a stream of tagged properties rather than a fixed structure, which is the
//! thing to know before reading the code. A property is a tag byte and a value whose width the
//! tag names: `0x01` and `0x02` are one byte, `0x03` two, `0x12` four, `0x06` and `0x07` a
//! length-prefixed string, `0x08` a flag with no value, `0x09` a nested object whose class name
//! is the string that follows. Only the properties a field actually carries are written, so a
//! byte layout per field does not generalise; walking the tokens and anchoring on the byte pattern
//! that introduces the ordinal does. A dictionary that crosses a page boundary is spliced first,
//! because each page carries a 32-byte lead and a 4-byte trailer around its part of the stream.
//!
//! Three rules extract a field: the name is the first string after the class name, the type name
//! is the first string beginning with `nxt`, and the placement is the two numbers after the fixed
//! pattern that precedes them. The result is only returned when the fields tile the record from
//! zero with no gap: a partial or misread stream does not survive that, so a table this reader
//! cannot place comes back empty rather than wrong. 83 of the 86 tables in the shipped area place.
//! cannot place comes back empty rather than wrong. All 86 tables in the shipped area place.
//!
//! The file leaves its record-size descriptor blank, so the size is computed the way the engine
//! computes it (`record_size`). That rule is the vendor's own, read out of `FUN_012ec9e0`, and it
//! is the stride for 58 of the 86 tables in the shipped area. For the other 28 the block's own
//! bytes pin a wider stride (`MEASURED_STRIDE`); what sets it is not established, and the
//! dictionary the file carries does not derive it -- see that table's doc comment. The block
//! geometry follows from the stride (`geometry`): a 0x20-byte
//! header, a used-slot bitmap, and the records tiling back from 4092. The bitmap is also what
//! says which records are live (`slot_map`), so a record that was deleted is left out even when
//! its bytes still look written.

use std::fmt;

/// The size of a data block, and where the records sit inside it.
pub const BLOCK: usize = 0x1000;
/// Where a table file states the page it is written in: the usable size at 0x14 plus the four
/// bytes of page trailer that follow the records. Every table in the shipped area states 0x0ffc
/// here, which is this crate's 4 KiB `BLOCK`, except four that state 0x1ffc for 8192-byte pages.
const PAGE_SIZE_AT: usize = 0x14;
/// 60 bytes: where the records of a table start when its geometry puts them there, as it does
/// for datanames. `geometry` gives the base for any record size; this is a default for callers
/// that pass one in.
pub const HEADER: usize = 0x3c;
/// The class name that starts a field descriptor, and the one that ends the field list.
const NEEDLE: &[u8] = b"\x06\x12TnxFieldDescriptor";
const INDICES: &[u8] = b"\x07\x11IndicesDescriptor";

/// Where a data block's used-slot bitmap starts, right after its header.
const SLOT_MAP: usize = 0x20;

/// A dictionary page's header and trailer, around the stream it carries.
const PAGE_LEAD: usize = 0x20;
const PAGE_TAIL: usize = 4;

/// The properties that introduce the ordinal, and then the placement pair.
const ANCHOR: &[u8] = &[0x02, 0x03, 0x01, 0x00];
const MIDDLE: &[u8] = &[0x12, 0x00, 0x00, 0x00, 0x00, 0x02, 0x03];

/// One field of a table, as its dictionary states it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Field {
    pub name: String,
    pub type_name: String,
    /// The declared length, in characters for a string and in display width for a number.
    pub declared_length: u32,
    /// Where the field starts inside a record.
    pub offset: u32,
    /// How many bytes the field occupies.
    pub size: u32,
}

impl Field {
    /// One past the last byte of the field.
    pub fn end(&self) -> u32 {
        self.offset + self.size
    }
}

/// A decoded field.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Int(i64),
    Float(f64),
    Bool(bool),
    Text(String),
    Blob(u64),
    /// A type this reader has no rule for, left in place rather than guessed at.
    Unset,
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Int(v) => write!(f, "{v}"),
            Value::Float(v) => write!(f, "{v}"),
            Value::Bool(v) => write!(f, "{v}"),
            Value::Text(v) => f.write_str(v),
            Value::Blob(v) => write!(f, "blob {v}"),
            Value::Unset => f.write_str("-"),
        }
    }
}

/// One token of the tagged property stream.
#[derive(Debug)]
struct Tok {
    tag: u8,
    start: usize,
    end: usize,
    num: i64,
    text: Option<String>,
}

impl Tok {
    fn text(&self) -> &str {
        self.text.as_deref().unwrap_or("")
    }

    fn is_number(&self) -> bool {
        matches!(self.tag, 0x01 | 0x02 | 0x03 | 0x04 | 0x05 | 0x12)
    }
}

/// Every field the table dictionary describes, or nothing when it cannot be placed.
///
/// The empty answer is deliberate. The fields have to tile a record with no gap for the read to
/// be believable, so a descriptor stream this reader cannot place comes back empty rather than
/// as a plausible wrong layout. Every dictionary in the shipped area tiles.
pub fn field_descriptors(bytes: &[u8]) -> Vec<Field> {
    let stream = dictionary_stream(bytes);
    let bytes = stream.as_ref();
    let starts = descriptor_starts(bytes);
    let Some(last) = starts.last().copied() else {
        return Vec::new();
    };
    let list_end = find(bytes, INDICES, last).unwrap_or(bytes.len());
    let mut out = Vec::new();
    for (i, lo) in starts.iter().enumerate() {
        let hi = if i + 1 < starts.len() { starts[i + 1] } else { list_end };
        let segment = &bytes[*lo..hi];
        let toks = tokens(segment);
        let texts: Vec<&Tok> = toks.iter().filter(|t| matches!(t.tag, 0x06 | 0x07)).collect();
        let names: Vec<&Tok> = texts.iter().copied().filter(|t| !t.text().starts_with("nxt")).collect();
        let types: Vec<&Tok> = texts.iter().copied().filter(|t| t.text().starts_with("nxt")).collect();
        if names.len() < 2 || types.is_empty() {
            return Vec::new();
        }
        let type_name = types[0];
let Some(declared) = toks.iter().find(|t| t.start >= type_name.end && t.is_number()) else {
            return Vec::new();
        };
        let Some((offset, size)) = placement(segment) else {
            return Vec::new();
        };
        out.push(Field {
            name: names[1].text().to_string(),
            type_name: type_name.text().to_string(),
            declared_length: declared.num as u32,
            offset,
            size,
        });
    }
    let mut end = 0u32;
    for field in &out {
        if field.offset != end {
            return Vec::new();
        }
        end = field.end();
    }
    out
}

/// The dictionary as one stream, across the pages it spans.
///
/// A table file states its page pitch in the header (the usable size at 0x14, plus four), and a
/// page is `PAGE_LEAD` bytes of header -- `NXSH`, the page number, `DICT` and two words -- then
/// the stream, then a `PAGE_TAIL`-byte trailer. A dictionary inside one page comes back as it is;
/// one that crosses pages is the concatenation of their stream parts. Reading the seam as stream
/// is what lost fuels' `ImageIndex` and cut a descriptor in areadata and tedtechdata. Bytes that
/// are not a whole table file, such as a dictionary already cut out, come back unchanged.
fn dictionary_stream(bytes: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    use std::borrow::Cow;
    let (Some(first), Some(head)) = (find(bytes, NEEDLE, 0), bytes.get(..24)) else {
        return Cow::Borrowed(bytes);
    };
    let Some(marker) = find(bytes, INDICES, first) else {
        return Cow::Borrowed(bytes);
    };
    if &head[..4] != b"NX!2" {
        return Cow::Borrowed(bytes);
    }
    let pitch = u32::from_le_bytes([head[20], head[21], head[22], head[23]]) as usize + 4;
    if pitch <= PAGE_LEAD + PAGE_TAIL || first / pitch == marker / pitch {
        return Cow::Borrowed(bytes);
    }
    let mut out = Vec::new();
    for page in first / pitch..=marker / pitch {
        let lo = page * pitch + PAGE_LEAD;
        let hi = ((page + 1) * pitch - PAGE_TAIL).min(bytes.len());
        out.extend_from_slice(bytes.get(lo..hi).unwrap_or_default());
    }
    Cow::Owned(out)
}

/// Every position where a field descriptor really starts.
///
/// A match counts only when the name after the class name reads as an identifier, so a class
/// name that turns up inside other data does not start a field. The one case the shipped area
/// showed, in `fuels.nx1`, was a page seam cutting a field name in two, and splicing the pages
/// removed it; the check stays as a guard.
fn descriptor_starts(bytes: &[u8]) -> Vec<usize> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(at) = find(bytes, NEEDLE, from) {
        let name = at + NEEDLE.len();
        if bytes.get(name) == Some(&0x06) {
            let n = bytes.get(name + 1).copied().unwrap_or(0) as usize;
            if let Some(text) = bytes.get(name + 2..name + 2 + n) {
                if n > 0 && text.iter().all(|b| b.is_ascii_graphic() || *b == b' ') {
                    out.push(at);
                }
            }
        }
        from = at + 1;
    }
    out
}

/// The offset and size of one field, found by the pattern that introduces them.
fn placement(segment: &[u8]) -> Option<(u32, u32)> {
    let anchor = find(segment, ANCHOR, 0)?;
    let (_, mut at) = number(segment, anchor + ANCHOR.len())?;
    if segment.get(at..at + MIDDLE.len())? != MIDDLE {
        return None;
    }
    at += MIDDLE.len();
    let (offset, at) = number(segment, at)?;
    let (size, _) = number(segment, at)?;
    Some((offset as u32, size as u32))
}

/// A tagged number, as (value, next).
fn number(bytes: &[u8], at: usize) -> Option<(i64, usize)> {
    match *bytes.get(at)? {
        0x01 | 0x02 => Some((*bytes.get(at + 1)? as i64, at + 2)),
        0x03 => {
            let lo = *bytes.get(at + 1)? as i64;
            let hi = *bytes.get(at + 2)? as i64;
            Some((lo | (hi << 8), at + 3))
        }
        0x04 | 0x05 | 0x12 => {
            let raw: [u8; 4] = bytes.get(at + 1..at + 5)?.try_into().ok()?;
            Some((i32::from_le_bytes(raw) as i64, at + 5))
        }
        _ => None,
    }
}

/// The token stream in one segment, stopping at a tag this reader has no rule for.
fn tokens(segment: &[u8]) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut at = 0usize;
    while at < segment.len() {
        let tag = segment[at];
        match tag {
            0x01 | 0x02 | 0x03 | 0x04 | 0x05 | 0x12 => {
                let Some((num, next)) = number(segment, at) else { break };
                out.push(Tok { tag, start: at, end: next, num, text: None });
                at = next;
            }
            0x06 | 0x07 => {
                let n = segment.get(at + 1).copied().unwrap_or(0) as usize;
                let Some(text) = segment.get(at + 2..at + 2 + n) else { break };
                let next = at + 2 + n;
                out.push(Tok {
                    tag,
                    start: at,
                    end: next,
                    num: 0,
                    text: Some(String::from_utf8_lossy(text).into_owned()),
                });
                at = next;
            }
            0x08 | 0x09 => {
                out.push(Tok { tag, start: at, end: at + 1, num: 0, text: None });
                at += 1;
            }
            _ => break,
        }
    }
    out
}

/// The length of a record, which the file does not state: the engine's own rule.
///
/// A record is its fields, rounded up to four bytes, plus a null-bitmap word per thirty-two
/// fields. That is what the decompiled engine computes in `FUN_012ec9e0` (chunk-00122.c), reached
/// from `FUN_012eb790`'s add-field accounting, which is also where a field's offset is the running
/// total and the total is seeded from the summed field sizes: `round_up_to_four(total) +
/// 4 * ceil(field_count / 32)`. The bytes agree wherever the file was written from the dictionary
/// it still carries -- the years table's 12, staticdata's 20, scenarios' 312, RegressionResults' 40
/// and writtenresults' 12 are all this rule's answer, where the 4032-divisor rule it replaces gave
/// 12, 18, 336, 42 and 9. Where the bytes do not agree, `stride` prefers the measured value.
pub fn record_size(fields: &[Field]) -> Option<usize> {
    let sum: u32 = fields.iter().map(Field::end).max()?;
    let count = fields.len();
    let word = 4 * ((count + 31) / 32);
    Some(((sum as usize + 3) / 4) * 4 + word)
}

/// The strides the shipped files' own bytes pin, for the tables the engine's rule does not reach.
///
/// Each value is measured from the block, not derived: the pitch between consecutive records'
/// wide strings, the free-list links the block leaves in its free slots, or both.
/// `tests/nx1_records_typed.rs` holds the per-table evidence; `tests/nx1_area_sweep.rs` shows
/// the rule and the measurement agreeing with every data block's slot map.
///
/// What sets these strides is not established. The dictionary the file carries does not derive
/// them: the engine's record size (`FUN_012ec9e0`, both branches) is computed from the field list
/// the file carries now, the stream states no stored length, and `OriginalFieldCount` equals the
/// placed field count wherever the file states it. The padding past the rule's end holds no data
/// either -- every byte of it is zero in every slot of every data block -- so it is not fields
/// the dictionary dropped. One stride fits every block of its table, so whatever set it did so
/// uniformly; the blocks' bytes are the only record of it.
///
/// The base moves with the stride, so each entry also pins where record 0 sits: `geometry(stride)`
/// reproduces it, and it is where the block's first record's fields decode.
pub const MEASURED_STRIDE: &[(&str, usize)] = &[
    ("areadata", 800),
    ("balcat", 304),
    ("balcat2", 304),
    ("balcat3", 304),
    ("balcat4", 304),
    ("constants", 192),
    ("datanames", 576),
    ("fuels", 1280),
    ("landtypes", 336),
    ("regioncategories", 304),
    ("regioncategories2", 304),
    ("regioncategories3", 304),
    ("regioncategories4", 304),
    ("regions", 368),
    ("refs", 3584),
    ("scenarioeffects", 1536),
    ("scenariotemplate", 496),
    ("summaryreportrows", 1344),
    ("summaryreports", 1536),
    ("taggroups", 1344),
    ("tags", 1536),
    ("tedeffects", 1536),
    ("tedtechdata", 336),
    ("timeslices", 768),
    ("units", 224),
    ("uservardata", 6144),
    ("variabledata", 3072),
    ("variablecategories", 576),
];

/// The stride a table's records are written at.
///
/// The engine's rule, or the measured stride where the blocks carry a wider one (`MEASURED_STRIDE`).
pub fn stride(table: &str, fields: &[Field]) -> Option<usize> {
    measured_stride(table).or_else(|| record_size(fields))
}

/// The stride a table file's records are written at, read from its own data blocks.
///
/// `MEASURED_STRIDE` pins the shipped Freedonia area's strides by hand; other areas carry the
/// same tables at strides of their own, so this finds the stride the blocks agree on. Two facts
/// of a block depend on the stride. A full block -- free-list head zero -- holds exactly as many
/// live records as the stride's geometry has slots. A partial block's free-slot chain, whose
/// links sit in each free slot's first u16, visits exactly the slots the used-slot map leaves
/// free, and only when those slots are read at the stride the block was written at. The answer
/// is the narrowest stride, from the engine's rule up in steps of four, that every block passes;
/// a table with no data block is written at the rule. It reproduces all 28 measured strides of
/// the shipped area but one, `variabledata`, whose single sparse record does not pin it
/// (`stride_of` settles that case).
pub fn infer_stride(bytes: &[u8], fields: &[Field]) -> Option<usize> {
    let rule = record_size(fields)?;
    let page = page_size(bytes);
    let blocks: Vec<&[u8]> = data_blocks_in(bytes, page)
        .into_iter()
        .filter_map(|at| bytes.get(at..at + page))
        .collect();
    if blocks.is_empty() {
        return Some(rule);
    }
    let fits = |stride: usize| blocks.iter().all(|block| stride_fits(block, page, stride));
    (rule..page).step_by(4).find(|stride| fits(*stride))
}

/// The stride to read a table file at: the measured stride its name carries when the file's
/// blocks agree with it, or else the stride they infer.
///
/// A block holding one sparse record per page does not pin its stride: any stride whose geometry
/// still has one slot, and whose first record starts past every byte the record writes, reads it
/// alike. The measured value settles that for the tables it names (`variabledata` holds a single
/// record whose expressions sit 520 and 1322 bytes into a 3072-byte slot); for the rest the
/// narrowest consistent stride is the answer.
pub fn stride_of(table: &str, bytes: &[u8], fields: &[Field]) -> Option<usize> {
    let page = page_size(bytes);
    let blocks: Vec<&[u8]> = data_blocks_in(bytes, page)
        .into_iter()
        .filter_map(|at| bytes.get(at..at + page))
        .collect();
    match measured_stride(&table.to_lowercase()) {
        Some(stride) if blocks.iter().all(|block| stride_fits(block, page, stride)) => Some(stride),
        _ => infer_stride(bytes, fields),
    }
}

/// Whether one data block reads consistently at a stride: see `infer_stride`.
fn stride_fits(block: &[u8], page: usize, stride: usize) -> bool {
    let Some((base, cap)) = geometry_in(page, stride) else {
        return false;
    };
    let (Some(live), Some(head)) = (header_live_count(block), free_list_head(block)) else {
        return false;
    };
    let live = live as usize;
    let Some(map) = slot_map(block, base, cap) else {
        return false;
    };
    // Between the used-slot map and the first record nothing is written; a stride narrower
    // than the block's own puts the first record's bytes in that gap.
    let gap = block.get(SLOT_MAP + (cap + 7) / 8..base).unwrap_or(&[]);
    if gap.iter().any(|byte| *byte != 0) {
        return false;
    }
    if live == cap {
        return head == 0;
    }
    let mut seen = vec![false; cap];
    let mut next = head as usize;
    let mut walked = 0;
    while next != 0 {
        let k = next - 1;
        if k >= cap || map[k] || seen[k] {
            return false;
        }
        seen[k] = true;
        walked += 1;
        let at = base + k * stride;
        let Some(link) = block.get(at..at + 2) else {
            return false;
        };
        next = u16::from_le_bytes([link[0], link[1]]) as usize;
    }
    walked == cap - live
}

/// The measured stride for one table, where the engine's rule is not the block's answer.
pub fn measured_stride(table: &str) -> Option<usize> {
    MEASURED_STRIDE
        .iter()
        .find(|(name, _)| *name == table)
        .map(|(_, size)| *size)
}

/// Where a named field sits in a decoded row, when the table has that field.
pub fn index_of(fields: &[Field], name: &str) -> Option<usize> {
    fields.iter().position(|field| field.name == name)
}

/// The page size a table file is written in: the usable size at 0x14 plus its four-byte
/// trailer.
///
/// Every table in the shipped area states 0x0ffc there, so its pages are this crate's 4 KiB
/// `BLOCK`. PluginProperties, Plugins, refs and uservardata state 0x1ffc, so their pages are
/// 8192 bytes, and a block of theirs is that wide rather than 4096. Bytes that do not carry a
/// table header -- a dictionary or a block cut out by a test -- come back as `BLOCK`.
pub fn page_size(bytes: &[u8]) -> usize {
    match bytes.get(PAGE_SIZE_AT..PAGE_SIZE_AT + 4) {
        Some(raw) if bytes.get(..4) == Some(&b"NX!2"[..]) => {
            let usable = u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) as usize;
            if usable + 4 >= SLOT_MAP + 4 { usable + 4 } else { BLOCK }
        }
        _ => BLOCK,
    }
}

/// Where each data block starts in a table, in pages of the size the file states.
pub fn data_blocks_in(bytes: &[u8], page: usize) -> Vec<usize> {
    if page == 0 {
        return Vec::new();
    }
    (0..bytes.len() / page)
        .map(|b| b * page)
        .filter(|at| bytes.get(*at..*at + 4) == Some(&b"NXDH"[..]))
        .collect()
}

/// Where each data block starts in a table of 4 KiB pages.
pub fn data_blocks(bytes: &[u8]) -> Vec<usize> {
    data_blocks_in(bytes, BLOCK)
}

/// The records of one data block, decoded field by field, from the record base the layout
/// states for that table. The count is what fits in the record area, which ends four bytes
/// short of the block.
pub fn records(
    block: &[u8],
    base: usize,
    fields: &[Field],
    record_size: usize,
) -> Vec<Vec<Value>> {
    if record_size == 0 {
        return Vec::new();
    }
    if base + 4 >= block.len() {
        return Vec::new();
    }
    let count = (block.len() - 4 - base) / record_size;
    (0..count)
        .map(|k| {
            let base = base + k * record_size;
            fields.iter().map(|field| decode(block, base, field)).collect()
        })
        .collect()
}

/// The live record count the block header itself states, in the u16 at 0x1e.
///
/// This is the file's own answer to the question the unwritten-slot signature only estimates,
/// confirmed for six tables against the rows the records show: years 31, datanames 7,
/// regions 1, balcat 13, scenarios 9 and staticdata 201, where 201 is also the whole capacity
/// the table's geometry allows. Word 0x1c beside it is the free-list head (`free_list_head`).
pub fn header_live_count(block: &[u8]) -> Option<u16> {
    block
        .get(0x1e..0x20)
        .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
}

/// The head of the block's free-slot list, in the u16 at 0x1c, one-based: the free slot plus
/// one, with zero meaning the block is full.
///
/// Each free slot's first u16 links the next free slot the same way, and the last link is
/// zero, so walking from the head visits exactly the slots the used-slot map leaves free.
/// That walk matches the map on every data block of the shipped area: 2105 full blocks hold
/// a zero head, and the other 86 chains land on precisely their free sets, which is also what
/// pins the unwritten-slot signature below -- a never-allocated slot's `index + 2` is the link
/// to the next slot, and a freed one's zero is the null the head held when the block was full.
pub fn free_list_head(block: &[u8]) -> Option<u16> {
    block
        .get(0x1c..0x1e)
        .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
}

/// Whether a slot is one nothing was ever written to, or one the file has since freed.
///
/// A slot nothing was written to is all zero. A slot that was freed in these files holds its own
/// slot number plus two in its first two bytes with the rest of the record zero. That number is
/// the free-list link, not the slot: one-based, it names the next free slot, so slot 31 holding
/// 33 links slot 32, and the last free slot holds zero where the chain ends. `regions` and
/// `areadata` carry the same chaining, `areadata`'s slots 1, 2 and 3 holding 3, 4 and 5, which is
/// what pinned that table's 800-byte stride. A slot freed from a full block holds zero for the
/// same reason: the deleted Peso record in `units` sits at the head the chain now names, and
/// zero is the null head it replaced.
///
/// It stays a signature rather than the file's answer, and it under-filters: a slot freed from
/// the middle of a `units` block has its first four bytes zeroed and keeps the rest of its old
/// record, which is the `f1`/residue case the map catches and this cannot. `slot_map` is the
/// file's answer; this is what `live_records` falls back to where the map cannot account for the
/// count the header states.
pub fn slot_is_unwritten(record: &[u8], index: usize) -> bool {
    if record.iter().all(|byte| *byte == 0) {
        return true;
    }
    record.len() >= 2
        && record[2..].iter().all(|byte| *byte == 0)
        && u16::from_le_bytes([record[0], record[1]]) as usize == index + 2
}

/// Where the records of a data block start and how many fit, for a record size.
///
/// A block is a 0x20-byte header, a used-slot bitmap of one bit per slot, and the records, which
/// tile back from 4092 -- four bytes short of the block. The capacity is the most records that
/// still leave room for the header and their bitmap, and the base is where the first of them then
/// starts. Every base measured by hand from record pitches agrees: staticdata 0x48, balcat 0x8c,
/// scenarios 0x24, regions 0x2c, datanames 0x3c; years sits at 0x54.
pub fn geometry(record_size: usize) -> Option<(usize, usize)> {
    geometry_in(BLOCK, record_size)
}

/// `geometry` for a page of any size: 4096 bytes, or the 8192 the four big-page tables state.
pub fn geometry_in(page: usize, record_size: usize) -> Option<(usize, usize)> {
    let end = page.checked_sub(4)?;
    if end <= SLOT_MAP || record_size == 0 || record_size > end - SLOT_MAP {
        return None;
    }
    let mut cap = (end - SLOT_MAP) / record_size;
    while cap > 0 && SLOT_MAP + (cap + 7) / 8 > end - cap * record_size {
        cap -= 1;
    }
    (cap > 0).then(|| (end - cap * record_size, cap))
}

/// Which slots of a data block hold live records, by the block's own used-slot map.
///
/// The bitmap starts at 0x20 and marks slot k with bit k, up to where the records start. When the
/// marked slots number exactly the live count the header states, every live slot is accounted for
/// and the rest are free; when they number fewer, the map does not cover the block -- the derived
/// geometry is wrong for that table -- and there is no answer.
pub fn slot_map(block: &[u8], base: usize, capacity: usize) -> Option<Vec<bool>> {
    let live = header_live_count(block)? as usize;
    let covered = capacity.min(8 * base.saturating_sub(SLOT_MAP));
    let map: Vec<bool> = (0..capacity)
        .map(|k| k < covered && block.get(SLOT_MAP + k / 8).is_some_and(|b| b >> (k % 8) & 1 == 1))
        .collect();
    (map.iter().filter(|live| **live).count() == live).then_some(map)
}

/// The live records of a data block, in the order the block holds them, from the record base the
/// layout states for that table.
///
/// The block's used-slot map decides which slots are live. Where it cannot account for the count
/// the header states, the unwritten-slot signature decides instead, which keeps residue of freed
/// records that the map would have left out.
pub fn live_records(
    block: &[u8],
    base: usize,
    fields: &[Field],
    record_size: usize,
) -> Vec<Vec<Value>> {
    if record_size == 0 {
        return Vec::new();
    }
    if base + 4 >= block.len() {
        return Vec::new();
    }
    let count = (block.len() - 4 - base) / record_size;
    let map = slot_map(block, base, count);
    (0..count)
        .filter(|k| match &map {
            Some(map) => map[*k],
            None => {
                let base = base + k * record_size;
                !block
                    .get(base..base + record_size)
                    .map(|record| slot_is_unwritten(record, *k))
                    .unwrap_or(true)
            }
        })
        .map(|k| {
            let base = base + k * record_size;
            fields.iter().map(|field| decode(block, base, field)).collect()
        })
        .collect()
}

/// One field of one record, or `Unset`.
///
/// A field is only read when its slot is there and holds enough bytes for its type. The size comes
/// out of the dictionary, and a dictionary that states an `nxtInt32` in two bytes, a double in four
/// or a blob in none is refused rather than read past; `Unset` is also the answer for a type this
/// reader has no rule for, so a caller can see what was not read.
fn decode(block: &[u8], base: usize, field: &Field) -> Value {
    let at = base + field.offset as usize;
    let size = field.size as usize;
    let Some(slot) = block.get(at..at + size) else {
        return Value::Unset;
    };
    match field.type_name.as_str() {
        "nxtInt8" => bytes::<1>(slot).map_or(Value::Unset, |b| Value::Int(b[0] as i8 as i64)),
        "nxtInt16" => bytes::<2>(slot).map_or(Value::Unset, |b| Value::Int(i16::from_le_bytes(b) as i64)),
        "nxtInt32" | "nxtAutoInc" | "nxtDate" => {
            bytes::<4>(slot).map_or(Value::Unset, |b| Value::Int(i32::from_le_bytes(b) as i64))
        }
        "nxtInt64" => bytes::<8>(slot).map_or(Value::Unset, |b| Value::Int(i64::from_le_bytes(b))),
        "nxtDouble" | "nxtDateTime" => {
            bytes::<8>(slot).map_or(Value::Unset, |b| Value::Float(f64::from_le_bytes(b)))
        }
        "nxtBoolean" => bytes::<1>(slot).map_or(Value::Unset, |b| Value::Bool(b[0] != 0)),
        "nxtWideString" => bytes::<2>(slot).map_or(Value::Unset, |_| Value::Text(wide_string(slot))),
        "nxtNullString" => bytes::<1>(slot).map_or(Value::Unset, |_| Value::Text(narrow_string(slot))),
        "nxtShortString" => bytes::<1>(slot).map_or(Value::Unset, |_| Value::Text(short_string(slot))),
        "nxtBlob" | "nxtBlobWideMemo" | "nxtBlobMemo" => {
            bytes::<8>(slot).map_or(Value::Unset, |b| Value::Blob(u64::from_le_bytes(b)))
        }
        _ => Value::Unset,
    }
}

/// The first `N` bytes of a slot, when the dictionary gave the field that many.
fn bytes<const N: usize>(slot: &[u8]) -> Option<[u8; N]> {
    slot.get(..N)?.try_into().ok()
}

/// A UTF-16 slot, NUL terminated inside itself, with the last two bytes reserved.
///
/// Decoded as UTF-16 rather than unit by unit, so a character outside the basic multilingual plane
/// -- a high surrogate then a low one -- comes back as the one character it is. A slot too narrow
/// to hold a unit and its reserved terminator reads as empty rather than under-flowing.
fn wide_string(slot: &[u8]) -> String {
    let limit = (slot.len() / 2).saturating_sub(1);
    let units = (0..limit).map(|i| u16::from_le_bytes([slot[2 * i], slot[2 * i + 1]]));
    let text: Vec<u16> = units.take_while(|unit| *unit != 0).collect();
    char::decode_utf16(text)
        .map(|unit| unit.unwrap_or('\u{fffd}'))
        .collect()
}

/// A length-prefixed narrow slot: the first byte counts the characters that follow.
fn short_string(slot: &[u8]) -> String {
    let len = (slot[0] as usize).min(slot.len() - 1);
    String::from_utf8_lossy(&slot[1..1 + len]).into_owned()
}

/// A narrow slot, NUL terminated inside itself.
fn narrow_string(slot: &[u8]) -> String {
    let end = slot.iter().position(|b| *b == 0).unwrap_or(slot.len());
    String::from_utf8_lossy(&slot[..end]).into_owned()
}

fn find(bytes: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    bytes.get(from..)
        .and_then(|rest| rest.windows(needle.len()).position(|w| w == needle))
        .map(|i| i + from)
}
