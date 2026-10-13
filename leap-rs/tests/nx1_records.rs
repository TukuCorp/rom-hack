//! Tests for the wide-string reader over a table record area.
//!
//! The bytes are the first 0x9000 of three tables from the Freedonia area that ships with LEAP,
//! so nothing needs installing. Two kinds of evidence are mixed here on purpose. The comparison
//! against the full expected list shows the Rust reader agrees with the reference parser; the
//! domain assertions below are independent, because they name things LEAP itself calls these
//! model objects, and a reader that got the encoding wrong would not produce them.

use leap_rs::nx1::wide_strings;
use leap_rs::oracle_nx1_strings::{NX1_DOMAIN_NAMES, NX1_STRINGS};

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

fn strings_of(table: &str) -> Vec<String> {
    let (_, hex, _) = NX1_STRINGS
        .iter()
        .find(|t| t.0 == table)
        .unwrap_or_else(|| panic!("no oracle window for {}", table));
    let bytes = unhex(hex);
    wide_strings(&bytes, bytes.len())
}

#[test]
fn every_string_matches_the_reference_reader() {
    assert_eq!(NX1_STRINGS.len(), 3);
    for (table, hex, want) in NX1_STRINGS {
        let bytes = unhex(hex);
        let got = wide_strings(&bytes, bytes.len());
        assert_eq!(got, *want, "strings of {}", table);
    }
}

#[test]
fn the_names_leap_itself_uses_are_all_here() {
    assert!(!NX1_DOMAIN_NAMES.is_empty());
    for (table, name) in NX1_DOMAIN_NAMES {
        assert!(
            strings_of(table).iter().any(|s| s == name),
            "{} should carry {}",
            table,
            name
        );
    }
}

#[test]
fn the_scenario_table_yields_the_model_arithmetic() {
    let strings = strings_of("scenariodata");
    let expressions: Vec<&String> = strings.iter().filter(|s| s.starts_with('@')).collect();
    assert!(
        expressions.len() >= 3,
        "expected expressions in the scenario table, got {:?}",
        strings
    );
    // LEAP writes arithmetic as @F<function>(...), @V<variable>(...) and @C<constant>.
    for e in expressions {
        assert!(
            e.starts_with("@F") || e.starts_with("@V") || e.starts_with("@C"),
            "{} is not in the form LEAP writes arithmetic in",
            e
        );
    }
}

#[test]
fn short_and_unterminated_runs_are_ignored() {
    assert!(wide_strings(&[], 0).is_empty());
    assert!(wide_strings(&[0u8; 64], 64).is_empty());

    let mut four = Vec::new();
    for c in b"ABCD" {
        four.push(*c);
        four.push(0);
    }
    four.extend_from_slice(&[0, 0]);
    assert!(wide_strings(&four, four.len()).is_empty(), "four characters is below the threshold");

    let mut five = Vec::new();
    for c in b"ABCDE" {
        five.push(*c);
        five.push(0);
    }
    five.extend_from_slice(&[0, 0]);
    assert_eq!(wide_strings(&five, five.len()), vec!["ABCDE".to_string()]);

    // The same five characters without the terminating NUL are not a field.
    let mut open = Vec::new();
    for c in b"ABCDE" {
        open.push(*c);
        open.push(0);
    }
    open.extend_from_slice(b"XY");
    assert!(wide_strings(&open, open.len()).is_empty());
}

