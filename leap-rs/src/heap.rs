//! The blob heap: the memos a blob field points at.
//!
//! A record does not hold its memo text. A `nxtBlobWideMemo` field is an eight-byte reference, and
//! `crate::model::ScenarioRow` splits it into a position and a data block -- the second number is
//! the number of an `NXHD` block in the same file. This module reads the memos out of such a
//! block, in order, so a record can be resolved to the text it points at.
//!
//! That text reading holds for the scenario table. Other tables heap blocks hold
//! narrow text and binary memos too, which `crate::blobs` resolves kind by kind.
//!
//! The framing, read off the vendor bytes rather than from a specification:
//!
//!   * a memo starts with a two-byte allocation, then a kind byte, then the text in UTF-16;
//!   * the text begins right after the kind byte, except that when the byte *there* is zero it
//!     begins one byte later. Two records of the shipped table have a zero there -- the first of
//!     the fifth block and the first of the seventh -- and reading from the byte after it is what
//!     turns the units those two start with into the space and the `9` they hold;
//!   * a memo occupies `round_up_to_four(allocation + 2)` bytes. The gaps between memos confirm
//!     it: allocations of 13, 17, 21, 31, 33 and 53 are 16, 20, 24, 36, 36 and 56 bytes apart;
//!   * the allocation is `2c + 1` for a text of `c` units, with a floor of 13.
//!
//! That last stride took a correction. It read `allocation + 3` (72 bytes for the allocation of
//! 66) until the fifth blob block of the shipped scenario table was walked: its first memo is a
//! sentence whose allocation is one byte past what its text needs, so the wider stride landed the
//! next record on the zeros in the middle of the following header and the walk stopped there, one
//! memo into a block that states 152. At `allocation + 2` the record ends at 0x58, where a real
//! header sits -- allocation 25, kind 5, one raw character -- and all seven blocks of that file
//! read to exactly the count they state.
//!
//! A blob block states in its own header how many memos it holds, and that is the check this reader
//! leans on. The walk stops where it meets something that is not a record, so a block it cannot
//! finish comes back short rather than filled in.
//!
//! Two smaller things to expect. A few memos carry no terminator inside their own record, so their
//! text picks up a character of the padding after it, and some hold letter values such as `True` and
//! `False`, which the expression reader refuses because they are values rather than arithmetic.

/// The length of the blob block header, where the first memo starts.
const DATA_START: usize = 0x14;

/// How many memos a blob block states it holds, from the word at 0x10.
///
/// The shipped scenario table states 190 for a block whose rows point at 190 positions, and 152
/// for another whose rows point at 152, so this reads as the count of memos the block holds.
pub fn stated(block: &[u8]) -> Option<u32> {
    let bytes: [u8; 4] = block.get(0x10..0x14)?.try_into().ok()?;
    Some(u32::from_le_bytes(bytes))
}

/// The memos in one blob block, in the order the block holds them.
///
/// The walk starts at the block header and follows the record sizes until it has the memos the block
/// states. It does not hunt for records: when it meets something it cannot read it stops, so a block the reader cannot finish comes back short rather than filled in. A caller can see that,
/// because the count is what the block states. All seven heap blocks of the shipped scenario table
/// read to exactly the count they state.
pub fn memos(block: &[u8]) -> Vec<String> {
    let want = stated(block).map(|count| count as usize);
    let mut out = Vec::new();
    let mut at = DATA_START;
    while at + 6 <= block.len() {
        if want.is_some_and(|count| out.len() >= count) {
            break;
        }
        match record(block, at) {
            Some((text, size)) => {
                out.push(text);
                at += size;
            }
            None => break,
        }
    }
    out
}

/// One record at `at`: where its text starts, where the record ends, and how wide it is.
fn header(block: &[u8], at: usize) -> Option<(usize, usize, usize)> {
    let alloc = u16::from_le_bytes([*block.get(at)?, *block.get(at + 1)?]) as usize;
    let size = (alloc + 2 + 3) / 4 * 4;
    if alloc < 4 || at + size > block.len() {
        return None;
    }
    let from = if *block.get(at + 3)? == 0 { at + 4 } else { at + 3 };
    Some((from, at + size, size))
}

/// One memo at `at`, as its text and the number of bytes it occupies.
fn record(block: &[u8], at: usize) -> Option<(String, usize)> {
    let (from, end, size) = header(block, at)?;
    Some((text(block, from, end), size))
}

/// The memo at a one-based position, when the block holds one.
///
/// The records before it are stepped over by their sizes alone: their texts are never decoded,
/// which is the whole cost of `memos` when only one memo is wanted. A position past the count
/// the block states, or past the last record it holds, has no memo.
pub fn memo(block: &[u8], position: u64) -> Option<String> {
    if position == 0 {
        return None;
    }
    let want = stated(block).map(|count| count as usize);
    let mut at = DATA_START;
    let mut seen = 0usize;
    while at + 6 <= block.len() {
        if want.is_some_and(|count| seen >= count) {
            break;
        }
        let (from, end, size) = header(block, at)?;
        seen += 1;
        if seen == position as usize {
            return Some(text(block, from, end));
        }
        at += size;
    }
    None
}

/// One record's kind byte and payload bytes at a one-based position, without decoding the text.
///
/// `memos` and `memo` read every memo as wide text, which is what the scenario table's memos are.
/// Other tables heap blocks hold narrow text and binary memos too, so a caller that needs
/// those reads the record raw here and decodes it in `crate::blobs`: the payload starts where
/// `header` puts the text and runs to the end of the record.
///
/// A position past the count the block states, or past the last record it holds, has no memo.
pub fn record_bytes(block: &[u8], position: u64) -> Option<(u8, Vec<u8>)> {
    if position == 0 {
        return None;
    }
    let want = stated(block).map(|count| count as usize);
    let mut at = DATA_START;
    let mut seen = 0usize;
    while at + 6 <= block.len() {
        if want.is_some_and(|count| seen >= count) {
            break;
        }
        let (from, end, size) = header(block, at)?;
        seen += 1;
        if seen == position as usize {
            return Some((block[at + 2], block[from..end].to_vec()));
        }
        at += size;
    }
    None
}

/// A UTF-16 run, ending at its terminator or at the end of its record.
///
/// Decoded as UTF-16 rather than unit by unit, so a character outside the basic multilingual
/// plane -- two units, a high surrogate then a low one -- comes back as the one character it is.
fn text(block: &[u8], from: usize, end: usize) -> String {
    let mut units = Vec::new();
    let mut at = from;
    while at + 2 <= end {
        let unit = u16::from_le_bytes([block[at], block[at + 1]]);
        if unit == 0 {
            break;
        }
        units.push(unit);
        at += 2;
    }
    char::decode_utf16(units)
        .map(|unit| unit.unwrap_or('\u{fffd}'))
        .collect()
}

/// Whether the record at a one-based position starts one byte later than its kind byte
/// says: the byte there is zero, the zero of a superseded memo, and the text starts past
/// it. No live row points at such a memo. A position past the count the block states,
/// or past the last record it holds, has no answer.
pub fn tombstoned(block: &[u8], position: u64) -> Option<bool> {
    if position == 0 {
        return None;
    }
    let want = stated(block).map(|count| count as usize);
    let mut at = DATA_START;
    let mut seen = 0usize;
    while at + 6 <= block.len() {
        if want.is_some_and(|count| seen >= count) {
            break;
        }
        let (from, _, size) = header(block, at)?;
        seen += 1;
        if seen == position as usize {
            return Some(from == at + 4);
        }
        at += size;
    }
    None
}