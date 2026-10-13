//! Typed rows out of a NexusDB table, which is what turns a `.leap` area into numbers.
//!
//! `crate::nx1` reads a table dictionary as text and the record area as wide strings. This
//! module goes the rest of the way: it reads the offset and size the dictionary states for
//! each field, works out how long a record is, and decodes the fields by type.
//!
//! Three things about the format are worth stating before the code, because none of them is
//! obvious from the bytes.
//!
//! A field descriptor spells its placement as a tag byte and then a value whose width the tag
//! names: `0x02` is one byte, `0x03` is two, `0x12` is four. Reading that pair is the whole of
//! the dictionary read, and the result for `datanames.nx1` is the layout the bytes actually
//! have -- TableID at 0 size 4, TableName at 4 size 102, FieldID at 106, SetID at 110, Name at
//! 114 size 302, Abbreviation at 416, DateChanged at 518 -- so the check is available and is
//! what the test does.
//!
//! The record size is not in the file. Every one of the eighty tables has that descriptor field
//! zeroed, because the area was written by an export that left it blank, so it has to be
//! derived: a data block is 4096 bytes with a 60-byte header, the records area is 4032 bytes,
//! and the vendor fills it with a whole number of records, so the record size is the smallest
//! divisor of 4032 that is at least four bytes past the last field. That predicts 12 for
//! `years`, 224 for `units` and 576 for `datanames`, and each is what the bytes show.
//!
//! The records start 60 bytes into the block rather than 64. The extra four bytes the header
//! looks like it has belong to the first record; reading strings from a 64-byte base misaligns
//! every one of them.
//!
//! What this does not do is filter deleted records, and that matters for a caller that wants
//! live rows: `years.nx1` has records past the live ones that still carry bytes, and the first
//! two of those count up from 78, which is a free-record chain. NexusDB keeps the deleted map
//! in the block header and reading it is the next step rather than a finished one.

use std::fmt;

/// The size of a data block, and where the records sit inside it.
pub const BLOCK: usize = 0x1000;
const HEADER: usize = 0x3c;
const DATA: usize = BLOCK - HEADER - 4;

/// The tag bytes that introduce an encoded number, and the width each one names.
const TAG_ONE: u8 = 0x02;
const TAG_TWO: u8 = 0x03;
const TAG_FOUR: u8 = 0x12;

/// The class name that starts a field descriptor.
const NEEDLE: &[u8] = b"\x06\x12TnxFieldDescriptor";

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

/// Every field the table dictionary describes, in the order it lists them.
///
/// Returns the fields read before anything unexpected, so a caller can see how far a read got.
pub fn field_descriptors(bytes: &[u8]) -> Vec<Field> {
    let Some(mut at) = find(bytes, NEEDLE, 0) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    while bytes[at..].starts_with(NEEDLE) {
        at += NEEDLE.len();
        let Some(name) = short(bytes, &mut at) else { return out };
        let Some((_, next)) = value(bytes, at) else { return out };
        at = next;
        let Some(type_name) = short(bytes, &mut at) else { return out };
        let Some((declared_length, next)) = value(bytes, at) else { return out };
        at = next;
        if bytes.get(at..at + 7) != Some(&[0x02, 0x00, 0x08, 0x02, 0x03, 0x01, 0x00][..]) {
            return out;
        }
        at += 7;
        let Some((_, next)) = value(bytes, at) else { return out };
        at = next;
        if bytes.get(at..at + 5) != Some(&[0x12, 0, 0, 0, 0][..]) {
            return out;
        }
        if bytes.get(at + 5..at + 7) != Some(&[0x02, 0x03][..]) {
            return out;
        }
        at += 7;
        let Some((offset, next)) = value(bytes, at) else { return out };
        let Some((size, next)) = value(bytes, next) else { return out };
        at = next;
        if bytes.get(at..at + 2) != Some(&[0x08, 0x08][..]) {
            return out;
        }
        at += 6;
        out.push(Field {
            name,
            type_name,
            declared_length: declared_length as u32,
            offset: offset as u32,
            size: size as u32,
        });
    }
    out
}

/// The length of a record, which the file does not state.
///
/// The records area holds a whole number of records, so the size is the smallest divisor of
/// that area that leaves room for the last field plus four bytes of per-record overhead. Every
/// table in the shipped area follows this, and the record size it gives is the stride the
/// bytes are actually written at.
pub fn record_size(fields: &[Field]) -> Option<usize> {
    let last = fields.iter().map(Field::end).max()? as usize;
    (4..=DATA).find(|size| DATA % size == 0 && *size >= last + 4)
}

/// Where each data block starts in a table.
pub fn data_blocks(bytes: &[u8]) -> Vec<usize> {
    (0..bytes.len() / BLOCK)
        .map(|b| b * BLOCK)
        .filter(|at| bytes.get(*at..*at + 4) == Some(&b"NXDH"[..]))
        .collect()
}

/// The records of one data block, decoded field by field.
pub fn records(block: &[u8], fields: &[Field], record_size: usize) -> Vec<Vec<Value>> {
    if record_size == 0 {
        return Vec::new();
    }
    let count = DATA / record_size;
    (0..count)
        .map(|k| {
            let base = HEADER + k * record_size;
            fields
                .iter()
                .map(|field| decode(block, base, field))
                .collect()
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

/// A tag byte and the value whose width it names.
fn value(bytes: &[u8], at: usize) -> Option<(i64, usize)> {
    match *bytes.get(at)? {
        TAG_ONE => Some((*bytes.get(at + 1)? as i64, at + 2)),
        TAG_TWO => {
            let lo = *bytes.get(at + 1)? as i64;
            let hi = *bytes.get(at + 2)? as i64;
            Some((lo | (hi << 8), at + 3))
        }
        TAG_FOUR => {
            let raw: [u8; 4] = bytes.get(at + 1..at + 5)?.try_into().ok()?;
            Some((i32::from_le_bytes(raw) as i64, at + 5))
        }
        _ => None,
    }
}

/// A length-prefixed string at `at`, advancing past it.
fn short(bytes: &[u8], at: &mut usize) -> Option<String> {
    if *bytes.get(*at)? != 0x06 {
        return None;
    }
    let n = *bytes.get(*at + 1)? as usize;
    let text = bytes.get(*at + 2..*at + 2 + n)?;
    *at += 2 + n;
    Some(String::from_utf8_lossy(text).into_owned())
}

fn find(bytes: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    bytes
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|i| i + from)
}
