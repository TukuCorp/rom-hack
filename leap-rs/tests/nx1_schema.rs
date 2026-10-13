//! Tests for the NexusDB dictionary reader.
//!
//! The bytes come from three tables in the Freedonia area that ships with LEAP, stored in the
//! oracle so nothing needs to be installed. The expected field and index lists were produced by
//! the reference parser in `tools/capture_nx1_oracle.py`, so this suite shows the Rust reader
//! agrees with the reference on real vendor files. It does not, on its own, show either is right
//! about LEAP; the settings-file check below is separate evidence, because that file is a
//! different artefact rather than a second reading of the same bytes.

use leap_rs::nx1::{dictionary, tagged_strings, Dictionary, DICTIONARY_WINDOW};
use leap_rs::oracle_nx1::{NX1_INI_OVERLAP, NX1_TABLES};

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

#[test]
fn every_field_and_index_matches_the_reference_parser() {
    assert_eq!(NX1_TABLES.len(), 3);
    for (table, hex, want_fields, want_indexes) in NX1_TABLES {
        let dict = dictionary(&unhex(hex));
        let got: Vec<(&str, &str)> = dict
            .fields
            .iter()
            .map(|f| (f.name.as_str(), f.type_name.as_str()))
            .collect();
        assert_eq!(got, *want_fields, "fields of {}", table);
        let indexes: Vec<&str> = dict.indexes.iter().map(String::as_str).collect();
        assert_eq!(indexes, *want_indexes, "indexes of {}", table);
    }
}

#[test]
fn the_field_names_are_corroborated_by_the_plain_text_settings_file() {
    assert!(
        !NX1_INI_OVERLAP.is_empty(),
        "the capture should have found at least one shared name"
    );
    let names: Vec<&str> = NX1_TABLES
        .iter()
        .flat_map(|(_, _, fields, _)| fields.iter().map(|(name, _)| *name))
        .collect();
    for key in NX1_INI_OVERLAP {
        assert!(
            names.contains(key),
            "{} is a settings-file key but was not read from any table",
            key
        );
    }
}

#[test]
fn the_scan_finds_the_markers_and_shrugs_at_nonsense() {
    let (_, hex, _, _) = NX1_TABLES[0];
    let strings = tagged_strings(&unhex(hex), DICTIONARY_WINDOW);
    for marker in ["NexusDB", "TnxFieldDescriptor", "TnxIndexDescriptor"] {
        assert!(strings.iter().any(|s| s == marker), "{} should be found", marker);
    }

    // Anything that is not a table yields nothing, rather than panicking or inventing fields.
    assert_eq!(dictionary(&[]), Dictionary::default());
    assert_eq!(dictionary(&[0u8; 4096]), Dictionary::default());
    assert_eq!(dictionary(&[0xffu8; 4096]), Dictionary::default());
    assert_eq!(dictionary(b"PK\x03\x04not a nexus table at all"), Dictionary::default());
}

