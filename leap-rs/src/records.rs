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
//! byte layout per field does not generalise -- an earlier version of this reader managed 54 of
//! the 86 tables in the shipped area and got three more shapes wrong. Walking the tokens and
//! anchoring on the byte pattern that introduces the ordinal gets 80.
//!
//! Three rules extract a field: the name is the first string after the class name, the type name
//! is the first string beginning with `nxt`, and the placement is the two numbers after the fixed
//! pattern that precedes them. The result is only returned when the fields tile the record from
//! zero with no gap: a partial or misread stream does not survive that, so a table this reader
//! cannot place comes back empty rather than wrong.
//!
//! Two more things the file does not state. The record size is zero in all eighty tables, because
//! the area was written by an export that left that descriptor field blank, so it is derived: for
//! most tables a data block's records area runs to 4092, and the size is the smallest divisor of
//! 4032 that is at least four bytes past the last field -- which every record then wastes in a
//! trailing flag block. Where the vendor bytes refute that the records' own pitch wins, the
//! oracle carries both. And the records do not all start 60 bytes into the block either: the
//! samples decode from there, but staticdata starts at 0x48, balcat at 0x8c, scenarios at 0x24
//! and regions at 0x2c, so the base travels with the layout rather than living here.
//!
//! What this does not do is filter deleted records, which matters. The block header does carry
//! the answer: word 0x1e states the live record count and word 0x20 onward is a used-slot
//! bitmap, and years' freed slots hold their own slot numbers -- but the reader has not wired
//! the map in and still reads the signature instead. That is why the decoded samples in the
//! whose seven records are all live, and not the year list.

use std::fmt;

/// The size of a data block, and where the records sit inside it.
pub const BLOCK: usize = 0x1000;
/// 60 bytes: where the records of most tables start, and the base of the sample fixtures.
/// The measured tables start elsewhere and the layout carries their base instead, so this
/// is a default rather than a rule.
pub const HEADER: usize = 0x3c;
/// The record area of a table that starts at 60 bytes, which is what the record-size rule
/// divides; the measured tables' areas differ by their base and the layout carries them.
const DATA: usize = BLOCK - HEADER - 4;

/// The class name that starts a field descriptor, and the one that ends the field list.
const NEEDLE: &[u8] = b"\x06\x12TnxFieldDescriptor";
const INDICES: &[u8] = b"\x07\x11IndicesDescriptor";

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
/// be believable, and six of the eighty-six tables in the shipped area carry a descriptor shape
/// this reader cannot place; those come back empty rather than as a plausible wrong layout.
pub fn field_descriptors(bytes: &[u8]) -> Vec<Field> {
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

/// Every position where a field descriptor really starts.
///
/// The class name turns up inside stream data as well -- `fuels.nx1` has one followed by a string
/// that is not an identifier -- so a match counts only when the name after it reads as one.
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

/// The length of a record, which the file does not state.
///
/// The records area holds a whole number of records, so the size is the smallest divisor of that
/// area that leaves room for the last field plus four bytes of per-record overhead. Every table in
/// the shipped area follows this, and the size it gives is the stride the bytes are written at.
pub fn record_size(fields: &[Field]) -> Option<usize> {
    let last = fields.iter().map(Field::end).max()? as usize;
    (4..=DATA).find(|size| DATA % size == 0 && *size >= last + 4)
}

/// Where each data block starts in a table.
/// Where a named field sits in a decoded row, when the table has that field.
pub fn index_of(fields: &[Field], name: &str) -> Option<usize> {
    fields.iter().position(|field| field.name == name)
}

/// Where each data block starts in a table.
pub fn data_blocks(bytes: &[u8]) -> Vec<usize> {
    (0..bytes.len() / BLOCK)
        .map(|b| b * BLOCK)
        .filter(|at| bytes.get(*at..*at + 4) == Some(&b"NXDH"[..]))
        .collect()
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
    if base + 4 >= BLOCK {
        return Vec::new();
    }
    let count = (BLOCK - 4 - base) / record_size;
    (0..count)
        .map(|k| {
            let base = base + k * record_size;
            fields.iter().map(|field| decode(block, base, field)).collect()
        })
        .collect()
}

/// Whether a slot is one nothing was ever written to.
///
/// A fresh block leaves either zeroes or, for every slot past the last written one, the slot
/// number in its first two bytes with the rest of the record zero. The year list is what makes
/// this checkable rather than merely plausible: with the rule, `years.nx1` reads as exactly the 31
/// years 2020 to 2050, which is the base year the area settings file states, and without it the
/// free slots past them read as years 33 and up.
///
/// It is a signature of an unwritten slot rather than the file own answer, and it under-filters:
/// a slot that was written and then freed keeps bytes elsewhere in the record and still looks
/// written. The exact rule is a map the block header carries, which is not read yet, so a caller
/// that needs certainty should compare the count against the header own used count.
pub fn slot_is_unwritten(record: &[u8], index: usize) -> bool {
    if record.iter().all(|byte| *byte == 0) {
        return true;
    }
    record.len() >= 2
        && record[2..].iter().all(|byte| *byte == 0)
        && u16::from_le_bytes([record[0], record[1]]) as usize == index
}

/// The records of a data block that read as written, in the order the block holds them,
/// from the record base the layout states for that table.
pub fn live_records(
    block: &[u8],
    base: usize,
    fields: &[Field],
    record_size: usize,
) -> Vec<Vec<Value>> {
    if record_size == 0 {
        return Vec::new();
    }
    if base + 4 >= BLOCK {
        return Vec::new();
    }
    let count = (BLOCK - 4 - base) / record_size;
    (0..count)
        .filter(|k| {
            let base = base + k * record_size;
            !block
                .get(base..base + record_size)
                .map(|record| slot_is_unwritten(record, *k))
                .unwrap_or(true)
        })
        .map(|k| {
            let base = base + k * record_size;
            fields.iter().map(|field| decode(block, base, field)).collect()
        })
        .collect()
}

fn decode(block: &[u8], base: usize, field: &Field) -> Value {
    let at = base + field.offset as usize;
    let size = field.size as usize;
    let Some(slot) = block.get(at..at + size) else {
        return Value::Unset;
    };
    match field.type_name.as_str() {
        "nxtInt8" => Value::Int(slot[0] as i8 as i64),
        "nxtInt16" => Value::Int(i16::from_le_bytes([slot[0], slot[1]]) as i64),
        "nxtInt32" => Value::Int(i32::from_le_bytes([slot[0], slot[1], slot[2], slot[3]]) as i64),
        "nxtInt64" => Value::Int(i64::from_le_bytes(slot.try_into().unwrap_or([0; 8]))),
        "nxtDouble" | "nxtDateTime" => {
            Value::Float(f64::from_le_bytes(slot.try_into().unwrap_or([0; 8])))
        }
        "nxtBoolean" => Value::Bool(slot[0] != 0),
        "nxtWideString" => Value::Text(wide_string(slot)),
        "nxtNullString" => Value::Text(narrow_string(slot)),
        "nxtBlob" | "nxtBlobWideMemo" | "nxtBlobMemo" => {
            Value::Blob(u64::from_le_bytes(slot.try_into().unwrap_or([0; 8])))
        }
        _ => Value::Unset,
    }
}

/// A UTF-16 slot, NUL terminated inside itself, with the last two bytes reserved.
fn wide_string(slot: &[u8]) -> String {
    let limit = slot.len() / 2 - 1;
    let mut out = String::new();
    for i in 0..limit {
        let unit = u16::from_le_bytes([slot[2 * i], slot[2 * i + 1]]);
        if unit == 0 {
            break;
        }
        out.push(char::from_u32(unit as u32).unwrap_or('\u{fffd}'));
    }
    out
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
