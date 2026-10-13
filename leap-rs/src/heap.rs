//! The blob heap: the memos a blob field points at.
//!
//! A record does not hold its memo text. A `nxtBlobWideMemo` field is an eight-byte reference, and
//! `crate::model::ScenarioRow` splits it into a position and a data block -- the second number is
//! the number of an `NXHD` block in the same file. This module reads the memos out of such a
//! block, in order, so a record can be resolved to the text it points at.
//!
//! The framing, read off the vendor bytes rather than from a specification:
//!
//!   * a memo starts with a two-byte allocation, then a kind byte, then the text in UTF-16;
//!   * the text begins right after the kind byte, except that when that byte is zero it begins
//!     one byte later, which is how the memos whose text starts with a space are stored;
//!   * a memo occupies `round_up_to_four(allocation + 3)` bytes. The gaps between memos in a
//!     block confirm it: allocations of 13, 17, 21, 31, 33, 53 and 66 are 16, 20, 24, 36, 36, 56
//!     and 72 bytes apart;
//!   * the allocation is `2c + 1` for a text of `c` units, with a floor of 13.
//!
//! A blob block states in its own header how many memos it holds, and that is the check this reader
//! leans on: six of the seven blob blocks of the shipped scenario table read to exactly the count
//! they state, and the seventh comes back short. That one opens with a record whose text is longer
//! than its allocation accounts for, and what follows it is not a record this reader understands, so
//! it yields one memo where 152 are stated. The shortfall is visible rather than filled in.
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
/// states. It does not hunt for records: when it meets something it cannot read it stops, so six of
/// the seven blocks of the shipped scenario table read to their stated count exactly and the seventh
/// comes back short. A caller can see that, because the count is what the block states.
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

/// One memo at `at`, as its text and the number of bytes it occupies.
fn record(block: &[u8], at: usize) -> Option<(String, usize)> {
    let alloc = u16::from_le_bytes([*block.get(at)?, *block.get(at + 1)?]) as usize;
    let size = (alloc + 3 + 3) / 4 * 4;
    if alloc < 4 || at + size > block.len() {
        return None;
    }
    let from = if *block.get(at + 3)? == 0 { at + 4 } else { at + 3 };
    Some((text(block, from, at + size), size))
}

/// The memo at a one-based position, when the block holds one.
pub fn memo(block: &[u8], position: u64) -> Option<String> {
    if position == 0 {
        return None;
    }
    memos(block).into_iter().nth((position - 1) as usize)
}

/// A UTF-16 run, ending at its terminator or at the end of its record.
fn text(block: &[u8], from: usize, end: usize) -> String {
    let mut out = String::new();
    let mut at = from;
    while at + 2 <= end {
        let unit = u16::from_le_bytes([block[at], block[at + 1]]);
        if unit == 0 {
            break;
        }
        out.push(char::from_u32(unit as u32).unwrap_or('\u{fffd}'));
        at += 2;
    }
    out
}
