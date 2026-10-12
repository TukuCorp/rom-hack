//! Conformance tests for the crate inflater, against streams produced by zlib.
//!
//! The container oracle only inflates the small sysinfo.txt bodies inside .leap archives,
//! which leaves parts of the decoder unexercised. This corpus is built to force them: a
//! four-byte block repeated sixteen thousand times drives the short-distance copies, a
//! sixteen-repeat of a 4096-byte block drives the mid range, a 300-byte copy of a 32000
//! byte prefix drives a long distance, incompressible data drives stored blocks, and the
//! several zlib levels drive different Huffman table choices.

use leap_rs::deflate::inflate;
use leap_rs::oracle_deflate::DEFLATE_VECTORS;

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

fn expected(prefix: &[u8], block: &[u8], repeats: usize) -> Vec<u8> {
    let mut out = prefix.to_vec();
    for _ in 0..repeats {
        out.extend_from_slice(block);
    }
    out
}

#[test]
fn the_corpus_covers_the_hard_paths() {
    assert_eq!(DEFLATE_VECTORS.len(), 12);
    let names: Vec<&str> = DEFLATE_VECTORS.iter().map(|v| v.0).collect();
    for wanted in [
        "empty",
        "one_byte_repeated",
        "wide_block_repeated",
        "incompressible",
        "stored_level0",
        "long_distance",
    ] {
        assert!(names.contains(&wanted), "the corpus is missing {}", wanted);
    }
    let longest = DEFLATE_VECTORS
        .iter()
        .map(|v| v.2.len() / 2 + (v.3.len() / 2) * v.4)
        .max()
        .expect("there is at least one vector");
    assert!(
        longest > 32_000,
        "the corpus should reach past the 32768 byte window, longest is {}",
        longest
    );
}

#[test]
fn every_stream_inflates_to_the_expected_bytes() {
    let mut failures = Vec::new();
    for (case, stream_hex, prefix_hex, block_hex, repeats, level) in DEFLATE_VECTORS {
        let stream = unhex(stream_hex);
        let want = expected(&unhex(prefix_hex), &unhex(block_hex), *repeats);
        match inflate(&stream) {
            Some(got) if got == want => {}
            Some(got) => {
                // Report the first byte that differs, not just the lengths, or a
                // decoder that is wrong but not short says nothing useful.
                let at = got.iter().zip(want.iter()).position(|(a, b)| a != b);
                failures.push(match at {
                    Some(i) => format!(
                        "{} (zlib level {}): first of {} bytes differs at {}, got {:#04x} not {:#04x}",
                        case, level, want.len(), i, got[i], want[i]
                    ),
                    None => format!(
                        "{} (zlib level {}): got {} bytes, want {}",
                        case, level, got.len(), want.len()
                    ),
                });
            }
            None => failures.push(format!("{} (zlib level {}): inflate gave up", case, level)),
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} streams did not inflate:\n{}",
        failures.len(),
        DEFLATE_VECTORS.len(),
        failures.join("\n")
    );
}

#[test]
fn malformed_input_is_rejected_rather_than_guessed() {
    // An empty stream has no block header at all.
    assert_eq!(inflate(&[]), None);
    // BTYPE 3 is reserved.
    assert_eq!(inflate(&[0xff, 0xff, 0xff, 0xff]), None);
    // A stored block whose length complement does not match.
    assert_eq!(inflate(&[0x01, 0x05, 0x00, 0x00, 0x00, 0x61]), None);
}
