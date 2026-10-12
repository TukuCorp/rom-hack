//! Parity tests for the .leap container validator against the original binary.
//!
//! The oracle in leap_rs::oracle_container stores the exact input bytes of every
//! archive together with the exit code and the whole of stdout that testleap.exe
//! produced when run with /S. Comparing both fields is a whole-process check, so a
//! green run is evidence about the port rather than a restatement of it.

use leap_rs::container::{
    validate, CODE_EXECUTABLE_MEMBER, CODE_MISSING_REQUIRED, CODE_NOT_ZIP, CODE_NO_META,
    CODE_UNSUPPORTED_VERSION, CODE_VALID, FORBIDDEN_PATTERNS,
};
use leap_rs::oracle_container::CONTAINER_VECTORS;

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

#[test]
fn the_oracle_covers_every_verdict() {
    assert_eq!(CONTAINER_VECTORS.len(), 113);
    assert_eq!(FORBIDDEN_PATTERNS.len(), 27);
    let mut seen: Vec<i32> = CONTAINER_VECTORS.iter().map(|v| v.2).collect();
    seen.sort_unstable();
    seen.dedup();
    assert_eq!(
        seen,
        vec![
            CODE_VALID,
            CODE_UNSUPPORTED_VERSION,
            CODE_MISSING_REQUIRED,
            CODE_EXECUTABLE_MEMBER,
            CODE_NOT_ZIP,
            CODE_NO_META
        ],
        "the oracle should exercise every verdict the chain can reach"
    );
}

#[test]
fn every_vector_matches_the_original_exit_code_and_stdout() {
    let mut mismatches = Vec::new();
    for (name, hex_payload, expected_code, expected_stdout) in CONTAINER_VECTORS {
        let bytes = unhex(hex_payload);
        let report = validate(&bytes);
        if report.code != *expected_code {
            mismatches.push(format!(
                "{}: exit code {} but the original gave {}",
                name, report.code, expected_code
            ));
        }
        if report.stdout != *expected_stdout {
            mismatches.push(format!(
                "{}: stdout {:?} but the original printed {:?}",
                name, report.stdout, expected_stdout
            ));
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} of {} vectors disagree with the original:\n{}",
        mismatches.len(),
        CONTAINER_VECTORS.len(),
        mismatches.join("\n")
    );
}

#[test]
fn a_truncated_archive_is_not_a_zip() {
    let (_, hex_payload, _, _) = CONTAINER_VECTORS[0];
    let bytes = unhex(hex_payload);
    assert_eq!(validate(&bytes[..bytes.len() / 2]).code, CODE_NOT_ZIP);
    assert_eq!(validate(&[]).code, CODE_NOT_ZIP);
}