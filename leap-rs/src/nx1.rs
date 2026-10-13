//! Reads the dictionary of a NexusDB table, the part of a `.leap` area that is plain text.
//!
//! A table file opens with a readable header and then a dictionary, and the dictionary is a
//! tagged byte stream: a `0x06` byte introduces a one-byte-length-prefixed run of printable
//! bytes, and everything else is a value whose width depends on its tag. That is the whole of
//! what this module needs to know about the format.
//!
//! A field is the class name `TnxFieldDescriptor`, then the field name, then the type name,
//! which is the pattern every one of the vendor tables follows. An index is
//! `TnxIndexDescriptor` followed by its name. The extraction is checked against three tables
//! from the Freedonia area that ships with LEAP, and four of the field names it recovers also
//! appear as keys in the area plain-text settings file, which is a separate artefact.
//!
//! What this deliberately does not do is read records. Those sit behind the per-block header
//! described in `docs/nx1-reconnaissance.md` and are not readable yet.

/// The tags that introduce a length-prefixed printable string. The vendor uses two:
/// descriptors carry `0x06`, and header names such as `NexusDB` carry `0x07`.
const STRING_TAG: u8 = 0x06;
const ALT_STRING_TAG: u8 = 0x07;

/// The longest run this reader will accept as a string, which is well above the longest name
/// the vendor uses and keeps a stray tag byte from swallowing the rest of the file.
const MAX_STRING: usize = 64;

/// How much of a table is scanned. The dictionary sits at the front of the file; the largest
/// one seen, in `areadata.nx1`, finishes well inside thirty-two kilobytes.
pub const DICTIONARY_WINDOW: usize = 0x8000;

/// One field of a table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Field {
    pub name: String,
    /// The NexusDB type class, such as `nxtInt16` or `nxtDouble`.
    pub type_name: String,
}

/// What a table says about itself.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Dictionary {
    pub fields: Vec<Field>,
    pub indexes: Vec<String>,
}

/// Every tagged printable string in `bytes[..end]`, in the order the file stores them.
pub fn tagged_strings(bytes: &[u8], end: usize) -> Vec<String> {
    let end = end.min(bytes.len());
    let mut out = Vec::new();
    let mut at = 0usize;
    while at + 2 < end {
        if bytes[at] == STRING_TAG || bytes[at] == ALT_STRING_TAG {
            let n = bytes[at + 1] as usize;
            if n >= 1 && n <= MAX_STRING && at + 2 + n <= end {
                let chunk = &bytes[at + 2..at + 2 + n];
                if chunk.iter().all(|b| b.is_ascii_graphic() || *b == b' ') {
                    out.push(String::from_utf8_lossy(chunk).into_owned());
                    at += 2 + n;
                    continue;
                }
            }
        }
        at += 1;
    }
    out
}

/// Read a table dictionary out of the front of a `.leap` table file.
///
/// Returns an empty dictionary rather than an error for anything it does not recognise, so a
/// caller can treat a file with no dictionary as a file with no fields.
pub fn dictionary(bytes: &[u8]) -> Dictionary {
    let end = bytes.len().min(DICTIONARY_WINDOW);
    let strings = tagged_strings(bytes, end);
    let mut dict = Dictionary::default();
    for (i, text) in strings.iter().enumerate() {
        if text == "TnxFieldDescriptor" && i + 2 < strings.len() {
            let field = Field {
                name: strings[i + 1].clone(),
                type_name: strings[i + 2].clone(),
            };
            if !dict.fields.contains(&field) {
                dict.fields.push(field);
            }
        } else if text == "TnxIndexDescriptor" && i + 1 < strings.len() {
            let name = strings[i + 1].clone();
            if !dict.indexes.contains(&name) {
                dict.indexes.push(name);
            }
        }
    }
    dict
}

/// How much of a table is scanned for record text. The record area follows the dictionary,
/// so this is generous on purpose; a caller with a larger slice can pass one.
pub const RECORD_WINDOW: usize = 0x9000;

/// Distinct, NUL-terminated UTF-16 runs of printable text, in first-seen order.
///
/// The record area stores its text as fixed-width wide string fields, zero padded, so a name
/// is a run of printable ASCII with a zero byte between each character, followed by a NUL. A
/// run counts from five characters, which is what keeps an incidental pair of bytes in binary
/// data from being read as a name. This is the function that makes the model readable: the
/// fuel and branch names, and the expressions in the scenario table, are all stored this way.
pub fn wide_strings(bytes: &[u8], end: usize) -> Vec<String> {
    let end = end.min(bytes.len());
    let mut out: Vec<String> = Vec::new();
    let mut at = 0usize;
    while at + 12 <= end {
        let head_ok = bytes[at].is_ascii_graphic() || bytes[at] == b' ';
        if head_ok && bytes[at + 1] == 0 {
            let mut n = 0usize;
            while at + 2 * n + 1 < end
                && (bytes[at + 2 * n].is_ascii_graphic() || bytes[at + 2 * n] == b' ')
                && bytes[at + 2 * n + 1] == 0
            {
                n += 1;
            }
            if n >= 5 && bytes.get(at + 2 * n..at + 2 * n + 2) == Some(&[0u8, 0u8][..]) {
                let text: String = (0..n).map(|k| bytes[at + 2 * k] as char).collect();
                let text = text.trim().to_string();
                if !text.is_empty() && !out.contains(&text) {
                    out.push(text);
                }
                at += 2 * n;
                continue;
            }
        }
        at += 1;
    }
    out
}
