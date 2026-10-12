//! Raw DEFLATE decompression (RFC 1951), written here so the crate stays
//! dependency-free.
//!
//! A .leap archive is a zip, and the meta step needs the contents of a member rather than
//! just its name. The oracle archives were written deflated, so reading them at all needs
//! an inflater. The shape follows the reference puff decoder: canonical Huffman tables
//! built from code lengths, then the three block types, with no checksum verification
//! because the original validator does not verify one either.

/// A position in the bit stream. DEFLATE packs Huffman codes least significant bit first.
struct Bits {
    data: Vec<u8>,
    pos: usize,
}

impl Bits {
    fn new(data: &[u8]) -> Bits {
        Bits { data: data.to_vec(), pos: 0 }
    }

    fn take(&mut self, n: u32) -> Option<u32> {
        let mut v = 0u32;
        for i in 0..n {
            let byte = *self.data.get(self.pos >> 3)?;
            let bit = (byte >> (self.pos & 7)) & 1;
            v |= (bit as u32) << i;
            self.pos += 1;
        }
        Some(v)
    }

    /// Drop the rest of the current byte, which a stored block requires.
    fn align(&mut self) {
        self.pos = (self.pos + 7) & !7;
    }

    fn take_bytes(&mut self, n: usize) -> Option<Vec<u8>> {
        let start = self.pos >> 3;
        let end = start.checked_add(n)?;
        if end > self.data.len() {
            return None;
        }
        let out = self.data[start..end].to_vec();
        self.pos = end * 8;
        Some(out)
    }
}

/// A canonical Huffman table in the shape the reference decoder uses: how many codes there
/// are of each length, and the symbols in code order.
struct Huffman {
    counts: [u16; 16],
    symbols: Vec<u16>,
}

impl Huffman {
    fn build(lengths: &[u16]) -> Option<Huffman> {
        let mut counts = [0u16; 16];
        for &len in lengths {
            if len as usize >= counts.len() {
                return None;
            }
            counts[len as usize] += 1;
        }
        counts[0] = 0;

        let mut left: i32 = 1;
        for len in 1..16 {
            left <<= 1;
            left -= counts[len] as i32;
            if left < 0 {
                return None;
            }
        }

        let mut offsets = [0usize; 16];
        for len in 1..15 {
            offsets[len + 1] = offsets[len] + counts[len] as usize;
        }
        let mut symbols = vec![0u16; lengths.iter().filter(|&&l| l != 0).count()];
        for (symbol, &len) in lengths.iter().enumerate() {
            if len != 0 {
                symbols[offsets[len as usize]] = symbol as u16;
                offsets[len as usize] += 1;
            }
        }
        Some(Huffman { counts, symbols })
    }

    fn decode(&self, bits: &mut Bits) -> Option<u16> {
        let mut code: i32 = 0;
        let mut first: i32 = 0;
        let mut index: usize = 0;
        for len in 1..16 {
            code |= bits.take(1)? as i32;
            let count = self.counts[len] as i32;
            if code - first < count {
                return self.symbols.get(index + (code - first) as usize).copied();
            }
            index += count as usize;
            first = (first + count) << 1;
            code <<= 1;
        }
        None
    }
}

const LENGTH_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
    131, 163, 195, 227, 258,
];
const LENGTH_EXTRA: [u32; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA: [u32; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];
const CODE_LENGTH_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/// The two tables DEFLATE prescribes for a fixed-Huffman block.
fn fixed_tables() -> Option<(Huffman, Huffman)> {
    let mut literal = [0u16; 288];
    for (i, slot) in literal.iter_mut().enumerate() {
        *slot = match i {
            0..=143 => 8,
            144..=255 => 9,
            256..=279 => 7,
            _ => 8,
        };
    }
    let distance = [5u16; 30];
    Some((Huffman::build(&literal)?, Huffman::build(&distance)?))
}

/// The two tables a dynamic-Huffman block carries in its header.
fn dynamic_tables(bits: &mut Bits) -> Option<(Huffman, Huffman)> {
    let literals = bits.take(5)? as usize + 257;
    let distances = bits.take(5)? as usize + 1;
    let code_lengths = bits.take(4)? as usize + 4;
    if literals > 286 || distances > 30 {
        return None;
    }

    let mut lengths_of_lengths = [0u16; 19];
    for i in 0..code_lengths {
        lengths_of_lengths[CODE_LENGTH_ORDER[i]] = bits.take(3)? as u16;
    }
    let alphabet = Huffman::build(&lengths_of_lengths)?;

    let mut lengths = vec![0u16; literals + distances];
    let mut i = 0;
    while i < lengths.len() {
        let symbol = alphabet.decode(bits)?;
        match symbol {
            0..=15 => {
                lengths[i] = symbol;
                i += 1;
            }
            16 => {
                if i == 0 {
                    return None;
                }
                let previous = lengths[i - 1];
                let repeat = 3 + bits.take(2)? as usize;
                for _ in 0..repeat {
                    if i >= lengths.len() {
                        return None;
                    }
                    lengths[i] = previous;
                    i += 1;
                }
            }
            17 => {
                let repeat = 3 + bits.take(3)? as usize;
                for _ in 0..repeat {
                    if i >= lengths.len() {
                        return None;
                    }
                    lengths[i] = 0;
                    i += 1;
                }
            }
            18 => {
                let repeat = 11 + bits.take(7)? as usize;
                for _ in 0..repeat {
                    if i >= lengths.len() {
                        return None;
                    }
                    lengths[i] = 0;
                    i += 1;
                }
            }
            _ => return None,
        }
    }
    Some((
        Huffman::build(&lengths[..literals])?,
        Huffman::build(&lengths[literals..])?,
    ))
}

/// Decode one block body until the end-of-block symbol.
fn decode_body(bits: &mut Bits, literal: &Huffman, distance: &Huffman, out: &mut Vec<u8>) -> Option<()> {
    loop {
        let symbol = literal.decode(bits)?;
        if symbol < 256 {
            out.push(symbol as u8);
            continue;
        }
        if symbol == 256 {
            return Some(());
        }
        let index = (symbol - 257) as usize;
        if index >= LENGTH_BASE.len() {
            return None;
        }
        let length = LENGTH_BASE[index] as usize + bits.take(LENGTH_EXTRA[index])? as usize;
        let dsymbol = distance.decode(bits)? as usize;
        if dsymbol >= DIST_BASE.len() {
            return None;
        }
        let offset = DIST_BASE[dsymbol] as usize + bits.take(DIST_EXTRA[dsymbol])? as usize;
        if offset > out.len() {
            return None;
        }
        let from = out.len() - offset;
        for k in 0..length {
            let byte = out[from + k];
            out.push(byte);
        }
    }
}

/// Inflate a raw DEFLATE stream. Returns None on anything malformed.
pub fn inflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut bits = Bits::new(data);
    let mut out = Vec::new();
    loop {
        let last = bits.take(1)?;
        match bits.take(2)? {
            0 => {
                bits.align();
                let header = bits.take_bytes(4)?;
                let length = u16::from_le_bytes([header[0], header[1]]) as usize;
                let complement = u16::from_le_bytes([header[2], header[3]]) as usize;
                if complement != (!length & 0xFFFF) {
                    return None;
                }
                let chunk = bits.take_bytes(length)?;
                out.extend_from_slice(&chunk);
            }
            1 => {
                let (literal, distance) = fixed_tables()?;
                decode_body(&mut bits, &literal, &distance, &mut out)?;
            }
            2 => {
                let (literal, distance) = dynamic_tables(&mut bits)?;
                decode_body(&mut bits, &literal, &distance, &mut out)?;
            }
            _ => return None,
        }
        if last == 1 {
            return Some(out);
        }
    }
}
