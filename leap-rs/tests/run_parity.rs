//! Parity tests for the TestLEAP argument loop against the original binary.
//!
//! The container suite proves one archive is judged the same way. This proves the loop
//! around it is too: the order the messages come out in, which verdict becomes the exit
//! code, what an argument that matches nothing does, and what "/S" does to a run of
//! several files rather than to a single one.

use leap_rs::container::{run, usage, Flags, Input, Report, USAGE};
use leap_rs::oracle_run::{RUN_ARCHIVES, RUN_USAGE, RUN_USAGE_CODE, RUN_VECTORS};

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

/// The archives the vectors name, keyed by the file name the capture used.
fn table() -> Vec<(String, Vec<u8>)> {
    RUN_ARCHIVES
        .iter()
        .map(|(name, hex)| (format!("{}.leap", name), unhex(hex)))
        .collect()
}

#[test]
fn the_usage_text_matches_the_original() {
    assert_eq!(RUN_VECTORS.len(), 14);
    assert_eq!(RUN_ARCHIVES.len(), 3);
    assert_eq!(USAGE, RUN_USAGE, "the usage text should be verbatim");
    let bare = usage();
    assert_eq!(bare.stdout, RUN_USAGE);
    assert_eq!(bare.code, RUN_USAGE_CODE);
    // An argument list of nothing but flags is not the usage. It reaches the file loop,
    // finds no files, and prints nothing at all unless /S asks for the result line.
    assert_eq!(run(&[], Flags::default()), Report { code: 0, stdout: String::new() });
    assert_eq!(
        run(&[], Flags { short: true, ..Flags::default() }).stdout,
        "Result: 0\r\n"
    );
    // The usage is the leading bare newline then CRLF lines, which is worth stating
    // explicitly because it is the one place the newline is not CRLF.
    assert!(USAGE.starts_with('\n'));
    assert!(USAGE.ends_with("\r\n"));
}

#[test]
fn every_argument_list_matches_the_original_in_all_four_modes() {
    let archives = table();
    let mut mismatches = Vec::new();

    for (case, arguments, expected_code, out_default, out_short, out_quiet, out_nometa) in
        RUN_VECTORS
    {
        let inputs: Vec<Input<'_>> = arguments
            .iter()
            .map(|arg: &&str| match archives.iter().find(|(name, _)| name.as_str() == *arg) {
                Some((name, bytes)) => Input::File {
                    name: name.as_str(),
                    bytes: bytes.as_slice(),
                },
                None => Input::NoMatch { as_typed: arg },
            })
            .collect();

        let runs = [
            ("default", run(&inputs, Flags::default()), out_default),
            (
                "short",
                run(&inputs, Flags { short: true, ..Flags::default() }),
                out_short,
            ),
            (
                "quiet",
                run(&inputs, Flags { quiet: true, ..Flags::default() }),
                out_quiet,
            ),
            (
                "nometa",
                run(&inputs, Flags { nometa: true, ..Flags::default() }),
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
        "{} disagreements across {} argument lists and 4 modes:\n{}",
        mismatches.len(),
        RUN_VECTORS.len(),
        mismatches.join("\n")
    );
}

#[test]
fn the_exit_code_is_the_last_verdict_not_the_worst() {
    // Stated as its own test because it is the surprising part of the loop: a bad file
    // followed by a good one exits 0.
    let archives = table();
    let find = |name: &str| archives.iter().find(|(n, _)| n == name).expect("present");
    let (good_name, good) = find("good.leap");
    let (bad_name, bad) = find("bad.leap");
    let bad_first = run(
        &[
            Input::File { name: bad_name.as_str(), bytes: bad.as_slice() },
            Input::File { name: good_name.as_str(), bytes: good.as_slice() },
        ],
        Flags::default(),
    );
    assert_eq!(bad_first.code, 0, "the last file was valid, so the run exits 0");
    let good_first = run(
        &[
            Input::File { name: good_name.as_str(), bytes: good.as_slice() },
            Input::File { name: bad_name.as_str(), bytes: bad.as_slice() },
        ],
        Flags::default(),
    );
    assert_eq!(good_first.code, 5, "the last file was not a zip");
}
