//! Blob fields and the heap blocks they point at, across the whole shipped area.
//!
//! The area keeps a memo beside its row: a blob field is an eight-byte reference whose low
//! word is the one-based memo position and whose high word is the page number of the `NXHD`
//! heap block in the same file, and zero means the row has no blob. Every non-zero blob
//! reference the shipped area holds resolves this way, in all thirteen files that carry
//! heap blocks and their 550 blocks holding 5,505 memos between them.
//!
//! A memo is a kind byte and raw payload bytes, and the kind states how the payload reads:
//!
//! * 0 is an empty memo: twelve zero bytes, pointed at by live rows that carry an
//!   empty note. Three area-wide.
//! * 3 is a counted short string, narrow or wide: the trailing two bytes are a
//!   little-endian count, odd for a narrow text (that many bytes) and even for a wide
//!   one (that many bytes, half as many units), with zero padding between the text and
//!   the count. All 2,607 hold thirteen payload bytes. The count, not the content,
//!   decides the width: a five-unit text has no NUL unit inside its record, which is
//!   where guessing the width from the content truncates `Water` to `W`.
//! * 4 is a terminated text whose width the blob field states: `nxtBlob` and
//!   `nxtBlobMemo` fields hold narrow text, `nxtBlobWideMemo` fields hold wide text.
//!   Every live reference in the area agrees. The wide set is ASCII plus the argument
//!   separator the expressions spell (`U+00A4`) and three trailing control bytes the
//!   area carries as dirt (`0x0b`, `0x0e`, `0x0f`).
//! * 5 is a binary segment directory: one or more little-endian `u32` triples and a NUL
//!   byte, 449 area-wide. Each triple is an op number, a segment number and a text
//!   offset, and every offset splits as chunk times 4059 plus a remainder: 4059 is the
//!   most content bytes a memo holds. This port reads the directory shape and no
//!   further: what the ops mean past plain (1), current (2) and superseded (the rest)
//!   is not settled. `Memo::text` answers `None` for them.
//!
//! A superseded memo keeps its kind and allocation but has its first payload byte zeroed,
//! which is why the record walk starts one byte later where that byte is zero. No live
//! row points at the 222 memos that carry the zero, and skipping it reads the text they
//! held: the walk keeps working because the allocation it steps by is intact.
//!
//! Two expression rows of the shipped scenario table point at segment directories rather
//! than at expression text, both counted in the 449 above, which `expression_text` reports
//! as no text rather than as a wrong one.

use crate::{heap, model, records};

/// The most content bytes a memo holds, and the chunk the segment offsets count in.
///
/// The longest memos in the area hold 4059 narrow characters plus their terminator
/// (alloc 4060), and every one of the 950 directory offsets splits as chunk times this
/// plus a remainder below it.
pub const SEGMENT: u32 = 4059;

/// One heap memo in full: its kind byte and its raw payload bytes.
///
/// The payload starts where the record walk puts the text: past a single zeroed leading
/// byte where a superseded memo carries one. That byte is not part of the text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Memo {
    /// The kind byte the record carries: 0 empty, 3 counted text, 4 terminated text,
    /// 5 segment directory.
    pub kind: u8,
    /// The payload between the kind byte and the end of the record.
    pub bytes: Vec<u8>,
}

/// The text width a blob field stores: narrow bytes or wide little-endian units.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Width {
    /// One byte per character, as `nxtBlob` and `nxtBlobMemo` fields store it.
    Narrow,
    /// Two bytes per unit, as `nxtBlobWideMemo` fields store it.
    Wide,
}

/// The width a blob field type stores.
///
/// `nxtBlobWideMemo` fields hold wide text and the other blob types hold narrow text.
/// The shipped area uses three blob types and every live reference agrees with this.
pub fn width_of(type_name: &str) -> Width {
    if type_name.contains("Wide") { Width::Wide } else { Width::Narrow }
}

/// The width the named blob field of a table file stores, from its dictionary.
///
/// Nothing when the table carries no such field.
pub fn field_width(file: &[u8], name: &str) -> Option<Width> {
    let fields = records::field_descriptors(file);
    let at = records::index_of(&fields, name)?;
    Some(width_of(&fields[at].type_name))
}

/// One entry of a kind-5 segment directory: an op number, a segment number and a text
/// offset in chunks of `SEGMENT` bytes.
///
/// Op 1 is a plain segment and op 2 a current one; higher ops sit in superseded memos.
/// Segment numbers run per table in creation order. What the higher ops mean past that
/// is not settled, so this port reads the entries and decodes no semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Segment {
    /// The op number: 1 plain, 2 current, higher superseded.
    pub op: u32,
    /// The segment number, per table in creation order.
    pub id: u32,
    /// The text offset: chunk times `SEGMENT` plus a remainder below it.
    pub at: u32,
}

impl Segment {
    /// The 4059-byte chunk holding the segment text.
    pub fn chunk(&self) -> u32 {
        self.at / SEGMENT
    }

    /// The offset of the segment text inside its chunk.
    pub fn offset(&self) -> u32 {
        self.at % SEGMENT
    }
}

impl Memo {
    /// The memo text, when its payload is text.
    ///
    /// The kind decides how the payload reads and the width decides the units of a
    /// kind-4 memo only: kind 3 carries its own count and kinds 0 and 5 are never text.
    /// An all-zero payload reads as empty text.
    pub fn text(&self, width: Width) -> Option<String> {
        if self.bytes.iter().all(|byte| *byte == 0) {
            return Some(String::new());
        }
        match self.kind {
            0 => Some(String::new()),
            3 => counted(&self.bytes),
            4 => match width {
                Width::Narrow => narrow(&self.bytes),
                Width::Wide => wide(&self.bytes),
            },
            _ => None,
        }
    }

    /// The segment directory a kind-5 memo holds, in the order the memo lists it.
    ///
    /// Nothing when the memo is not a well-formed directory: one or more
    /// little-endian `u32` triples and a NUL byte. All 449 in the area are.
    pub fn segments(&self) -> Option<Vec<Segment>> {
        if self.kind != 5 {
            return None;
        }
        if self.bytes.len() < 13
            || (self.bytes.len() - 1) % 12 != 0
            || self.bytes[self.bytes.len() - 1] != 0
        {
            return None;
        }
        let mut out = Vec::new();
        let mut at = 0;
        while at + 12 <= self.bytes.len() {
            let op = u32::from_le_bytes([self.bytes[at], self.bytes[at + 1], self.bytes[at + 2], self.bytes[at + 3]]);
            let id = u32::from_le_bytes([self.bytes[at + 4], self.bytes[at + 5], self.bytes[at + 6], self.bytes[at + 7]]);
            let pos = u32::from_le_bytes([self.bytes[at + 8], self.bytes[at + 9], self.bytes[at + 10], self.bytes[at + 11]]);
            out.push(Segment { op, id, at: pos });
            at += 12;
        }
        Some(out)
    }
}

/// A kind-3 counted short string: the trailing two bytes count the text, odd for a
/// narrow text in bytes and even for a wide one, with zero padding between the text
/// and the count.
fn counted(payload: &[u8]) -> Option<String> {
    if payload.len() < 3 {
        return None;
    }
    let count = u16::from_le_bytes([payload[payload.len() - 2], payload[payload.len() - 1]]) as usize;
    let end = payload.iter().position(|byte| *byte == 0).unwrap_or(payload.len());
    if end == count {
        let text = payload.get(..count)?;
        if text.is_empty() || !text.iter().all(|byte| is_text_byte(*byte)) {
            return None;
        }
        return Some(text.iter().map(|byte| *byte as char).collect());
    }
    if end < count && count % 2 == 0 {
        let mut out = String::new();
        let mut at = 0;
        while at + 2 <= count {
            let unit = u16::from_le_bytes([payload[at], payload[at + 1]]);
            let c = char::from_u32(unit as u32)?;
            if !is_text_char(c) {
                return None;
            }
            out.push(c);
            at += 2;
        }
        if at == count && !out.is_empty() {
            return Some(out);
        }
    }
    None
}

/// A kind-4 narrow text: the bytes until the terminator or the end of the record.
fn narrow(payload: &[u8]) -> Option<String> {
    let end = payload.iter().position(|byte| *byte == 0).unwrap_or(payload.len());
    let text = &payload[..end];
    if text.is_empty() || !text.iter().all(|byte| is_text_byte(*byte)) {
        return None;
    }
    Some(text.iter().map(|byte| *byte as char).collect())
}

/// A kind-4 wide text: the units until the terminator or the end of the record.
///
/// Past ASCII the area holds three things: the argument separator the scenario
/// expressions spell (`U+00A4`, sixty memos) and three trailing control bytes it carries
/// as dirt (`0x0b` once, `0x0e` three times, `0x0f` once). Anything else is not text.
fn wide(payload: &[u8]) -> Option<String> {
    let mut out = String::new();
    let mut at = 0;
    while at + 2 <= payload.len() {
        let unit = u16::from_le_bytes([payload[at], payload[at + 1]]);
        if unit == 0 {
            break;
        }
        let c = char::from_u32(unit as u32)?;
        if !is_wide_char(c) {
            return None;
        }
        out.push(c);
        at += 2;
    }
    (!out.is_empty()).then_some(out)
}

/// The characters memo text holds: ASCII printables and whitespace.
fn is_text_char(c: char) -> bool {
    c == '\t' || c == '\n' || c == '\r' || (' '..='~').contains(&c)
}

/// The wide characters past ASCII that the area holds: the expression argument
/// separator and three trailing control bytes.
fn is_wide_char(c: char) -> bool {
    is_text_char(c) || c == '\u{a4}' || c == '\u{b}' || c == '\u{e}' || c == '\u{f}'
}

/// The bytes `is_text_char` accepts, as bytes.
fn is_text_byte(byte: u8) -> bool {
    byte == b'\t' || byte == b'\n' || byte == b'\r' || (0x20..=0x7e).contains(&byte)
}
/// The page numbers of every heap block a table file carries.
///
/// A page whose first four bytes are `NXHD` is a heap block, read in the page size the
/// file states, the same pages `records::data_blocks_in` skips past.
pub fn heap_pages(file: &[u8]) -> Vec<usize> {
    let page = records::page_size(file);
    if page == 0 || file.len() < page {
        return Vec::new();
    }
    (0..file.len() / page)
        .map(|page_number| page_number * page)
        .filter(|at| file.get(*at..*at + 4) == Some(&b"NXHD"[..]))
        .map(|at| at / page)
        .collect()
}

/// An eight-byte blob field value as its memo position and heap block page.
///
/// The low word is the one-based position within the block and the high word the block page
/// number in the same file. Zero is not a reference and has neither.
pub fn split(blob: u64) -> Option<(u64, u64)> {
    (blob != 0).then_some((blob & 0xffff_ffff, blob >> 32))
}

/// The inverse of `split`: the field value for a position and block page.
pub fn join(index: u64, block: u64) -> u64 {
    index | block << 32
}

/// The memo a blob field value names, in the file that holds the row.
///
/// Nothing when the value is zero, when the block page is not a heap block of the file,
/// or when the position runs past what the block states and holds. The width the text
/// reads in is the caller business: `Memo::text` takes it, and `expression_text` reads it
/// off the field.
pub fn resolve(file: &[u8], blob: u64) -> Option<Memo> {
    let (index, block) = split(blob)?;
    resolve_at(file, index, block)
}

/// The memo at a one-based position of a heap block page, in the file that holds the row.
pub fn resolve_at(file: &[u8], index: u64, block: u64) -> Option<Memo> {
    if index == 0 {
        return None;
    }
    let page = records::page_size(file);
    let start = (block as usize).checked_mul(page)?;
    let whole = file.get(start..start + page)?;
    if whole.get(..4) != Some(&b"NXHD"[..]) {
        return None;
    }
    let (kind, bytes) = heap::record_bytes(whole, index)?;
    Some(Memo { kind, bytes })
}

/// The bytes a memo holds, a long memo's segments assembled.
///
/// A kind-5 memo is a directory of segments, each a little-endian `u32` triple: the one-based
/// memo position of the segment, the heap page it sits on, and the byte offset at which the
/// segment ends in the assembled value. A segment is either raw bytes (its whole payload, cut to
/// the length the offsets give it) or a further directory, read the same way: the directory a row
/// points at can name a second directory that lists the data segments. The Freedonia passenger
/// activity reads this way: a directory naming one directory of two segments, 61 and 65 bytes,
/// which assemble into the 63 wide characters `75/40 ? calculated passenger km divided @C1000
/// total population`.
pub fn assemble(file: &[u8], index: u64, block: u64, depth: usize) -> Option<Vec<u8>> {
    let page = records::page_size(file);
    let start = (block as usize).checked_mul(page)?;
    let whole = file.get(start..start + page)?;
    if whole.get(..4) != Some(&b"NXHD"[..]) {
        return None;
    }
    let (kind, bytes) = heap::record_raw(whole, index)?;
    if kind != 5 {
        return Some(bytes);
    }
    if depth > 8 || bytes.len() < 12 {
        return None;
    }
    let mut out = Vec::new();
    let mut at = 0;
    while at + 12 <= bytes.len() {
        let word = |k: usize| u32::from_le_bytes([bytes[at + k], bytes[at + k + 1], bytes[at + k + 2], bytes[at + k + 3]]);
        let (pos, pg, end) = (word(0) as u64, word(4) as u64, word(8) as usize);
        let piece = assemble(file, pos, pg, depth + 1)?;
        let need = end.checked_sub(out.len())?;
        out.extend_from_slice(piece.get(..need)?);
        at += 12;
    }
    Some(out)
}

/// The text of a terminated memo read leniently: the units (or bytes) up to the terminator, any
/// control character read as a space. Areas carry stray control characters after expressions --
/// Asiana's `1403000` ends in U+0007 -- which the strict reading refuses outright.
pub fn lenient_text(memo: &Memo, width: Width) -> Option<String> {
    if memo.kind != 4 {
        return None;
    }
    let clean = |c: char| if c.is_control() { ' ' } else { c };
    Some(match width {
        Width::Narrow => memo.bytes.iter().take_while(|b| **b != 0).map(|b| clean(*b as char)).collect(),
        Width::Wide => {
            let units: Vec<u16> = memo.bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).take_while(|u| *u != 0).collect();
            char::decode_utf16(units).map(|c| clean(c.unwrap_or(char::REPLACEMENT_CHARACTER))).collect()
        }
    })
}

/// The text a blob field value names, long memos assembled from their segments.
pub fn resolve_text(file: &[u8], blob: u64, width: Width) -> Option<String> {
    let memo = resolve(file, blob)?;
    if memo.kind != 5 {
        return memo.text(width).or_else(|| lenient_text(&memo, width));
    }
    let (index, block) = split(blob)?;
    let bytes = assemble(file, index, block, 0)?;
    Some(match width {
        Width::Narrow => {
            let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
            bytes[..end].iter().map(|b| *b as char).collect()
        }
        Width::Wide => {
            let units: Vec<u16> = bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .take_while(|u| *u != 0)
                .collect();
            char::decode_utf16(units).map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER)).collect()
        }
    })
}

/// Whether the memo at a one-based position carries the zeroed first payload byte of a
/// superseded memo. No live row points at such a memo; skipping the byte reads the text
/// it held. Nothing past the count the block states and holds.
pub fn tombstoned(file: &[u8], index: u64, block: u64) -> Option<bool> {
    if index == 0 {
        return None;
    }
    let page = records::page_size(file);
    let start = (block as usize).checked_mul(page)?;
    let whole = file.get(start..start + page)?;
    heap::tombstoned(whole, index)
}

/// The expression text of a scenario row, when its memo is text.
///
/// The width comes off the `Expression` field: the shipped table stores
/// `nxtBlobWideMemo`. `None` when the row carries no expression, when the table carries
/// no such field, and when its memo is not text: two rows of the shipped table point at
/// segment directories, and those come back as nothing rather than as a wrong reading.
pub fn expression_text(file: &[u8], row: &model::ScenarioRow) -> Option<String> {
    let width = field_width(file, "Expression")?;
    resolve(file, join(row.memo_index, row.memo_block))?.text(width)
}