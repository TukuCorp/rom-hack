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
//! What this does not do yet, and a caller should know before trusting a count. The walk reaches
//! the end of six of the seven blob blocks of the shipped scenario table, each time with one
//! record left over -- a terminator rather than a memo -- and it stops early in the seventh, the
//! one whose first memo is a long text that opens with a space. A caller can tell: if the list is
//! no longer than the highest position the records point at, the block was not read to its end.
//! A few memos also carry no terminator inside their own record, so their text picks up a
//! character of padding, and some memos hold letter values such as `True` and `False`, which the
//! expression reader refuses because they are values rather than arithmetic.

/// The length of the blob block header, where the first memo starts.
const DATA_START: usize = 0x14;

/// The memos in one blob block, in the order the block holds them.
pub fn memos(block: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut at = DATA_START;
    while at + 6 <= block.len() {
        let alloc = u16::from_le_bytes([block[at], block[at + 1]]) as usize;
        let size = (alloc + 3 + 3) / 4 * 4;
        if alloc < 4 || at + size > block.len() {
            break;
        }
        let from = if block[at + 3] == 0 { at + 4 } else { at + 3 };
        out.push(text(block, from, at + size));
        at += size;
    }
    out
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
