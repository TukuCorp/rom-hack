//! Parity tests for the .leap container validator against the original binary.
//!
//! The oracle in leap_rs::oracle_container stores, for every archive, the exact input
//! bytes, the exit code, and the whole of stdout for each of the four output modes the
//! original has. Checking the exit code and all four strings is a whole-process
//! comparison, CRLF included, so a green run is evidence about the port rather than a
//! restatement of it.

use leap_rs::container::{
    decide, report, validate, Decision, Flags, Meta, CODE_EXECUTABLE_MEMBER, CODE_MISSING_REQUIRED,
    CODE_NOT_ZIP, CODE_NO_META, CODE_UNSUPPORTED_VERSION, CODE_VALID, FORBIDDEN_PATTERNS,
    META_KEYS,
};
use leap_rs::oracle_container::CONTAINER_VECTORS;

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

/// The name the capture used, which is what the messages quote.
fn display_name(case: &str) -> String {
    format!("{}.leap", case)
}

#[test]
fn the_oracle_covers_every_verdict() {
    assert_eq!(CONTAINER_VECTORS.len(), 127);
    assert_eq!(FORBIDDEN_PATTERNS.len(), 27);
    assert_eq!(META_KEYS.len(), 10);
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
fn every_vector_matches_the_original_in_all_four_modes() {
    let mut mismatches = Vec::new();
    for (case, hex_payload, expected_code, out_default, out_short, out_quiet, out_nometa) in
        CONTAINER_VECTORS
    {
        let bytes = unhex(hex_payload);
        let name = display_name(case);
        let runs = [
            ("default", report(&bytes, &name, Flags::default()), out_default),
            (
                "short",
                report(&bytes, &name, Flags { short: true, ..Flags::default() }),
                out_short,
            ),
            (
                "quiet",
                report(&bytes, &name, Flags { quiet: true, ..Flags::default() }),
                out_quiet,
            ),
            (
                "nometa",
                report(&bytes, &name, Flags { nometa: true, ..Flags::default() }),
                out_nometa,
            ),
        ];
        for (mode, got, want) in runs {
            if got.code != *expected_code {
                mismatches.push(format!(
                    "{} ({}): exit code {} but the original gave {}",
                    case, mode, got.code, expected_code
                ));
            }
            if got.stdout.as_str() != *want {
                mismatches.push(format!(
                    "{} ({}): stdout {:?} but the original printed {:?}",
                    case, mode, got.stdout, want
                ));
            }
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} disagreements across {} vectors and 4 modes:\n{}",
        mismatches.len(),
        CONTAINER_VECTORS.len(),
        mismatches.join("\n")
    );
}

#[test]
fn the_decision_model_agrees_with_the_reported_code() {
    for (case, hex_payload, expected_code, ..) in CONTAINER_VECTORS {
        let bytes = unhex(hex_payload);
        assert_eq!(decide(&bytes).code(), *expected_code, "{}: decision code", case);
        assert_eq!(
            validate(&bytes).code,
            *expected_code,
            "{}: short-mode report code",
            case
        );
        // The one case that never reaches the result line is the one where the library
        // aborts, which prints the exception instead and still exits 0.
        let aborted = matches!(
            decide(&bytes),
            Decision::Passed { meta: Meta::NotAtRoot, .. }
        );
        if !aborted {
            // Any echoed meta lines come first, so the verdict is the last line.
            assert!(
                validate(&bytes)
                    .stdout
                    .ends_with(&format!("Result: {}\r\n", expected_code)),
                "{}: the /S output should end with the verdict line, got {:?}",
                case,
                validate(&bytes).stdout
            );
        }
    }
}

#[test]
fn a_truncated_archive_is_not_a_zip() {
    let (_, hex_payload, expected_code, ..) = CONTAINER_VECTORS[0];
    assert_eq!(expected_code, CODE_VALID, "vector 0 should be the valid archive");
    let bytes = unhex(hex_payload);
    assert_eq!(validate(&bytes[..bytes.len() / 2]).code, CODE_NOT_ZIP);
    assert_eq!(validate(&[]).code, CODE_NOT_ZIP);
}
