//! Tests for the typed-row reader, over the vendor\u0027s own table bytes.
//!
//! The dictionary bytes and the data block here come out of `datanames.nx1` as it ships, so the
//! test decodes the same bytes a reader would meet. The layout assertions are the checks that
//! matter: the dictionary states an offset and a size for every field, and if that reading is
//! right then the fields tile the record exactly, which is a claim the vendor\u0027s own bytes can
//! settle rather than one this crate makes about itself.

use leap_rs::oracle_records::{
    NX1_DATANAMES_BLOCK, NX1_DATANAMES_DICTIONARY, NX1_DATANAMES_ROWS, NX1_RECORD_LAYOUT,
};
use leap_rs::records::{self, Field, Value};

/// The records area of a data block, which a record size has to divide.
const DATA: usize = 4032;

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

fn fields_of(rows: &[(&str, &str, u32, u32, u32)]) -> Vec<Field> {
    rows.iter()
        .map(|(name, type_name, declared_length, offset, size)| Field {
            name: name.to_string(),
            type_name: type_name.to_string(),
            declared_length: *declared_length,
            offset: *offset,
            size: *size,
        })
        .collect()
}

fn layout_of(table: &str) -> (usize, Vec<Field>) {
    for (name, size, _, rows) in NX1_RECORD_LAYOUT {
        if *name == table {
            return (*size, fields_of(rows));
        }
    }
    panic!("no oracle layout for {}", table);
}

#[test]
fn the_dictionary_states_where_every_field_sits() {
    let bytes = unhex(NX1_DATANAMES_DICTIONARY);
    let got = records::field_descriptors(&bytes);
    let (_, want) = layout_of("datanames");
    assert_eq!(got.len(), want.len(), "every field should be read");
    assert_eq!(got, want);

    // The strongest thing the vendor bytes can say: the fields tile the record with no gap and
    // no overlap, which is only true if each offset and size is read as written.
    let mut end = 0u32;
    for field in &got {
        assert_eq!(field.offset, end, "{} does not follow the field before it", field.name);
        end = field.end();
    }
    assert_eq!(end, 526, "the last field of datanames ends here");

    let names: Vec<&str> = got.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(
        names,
        vec![
            "TableID",
            "TableName",
            "FieldID",
            "SetID",
            "Name",
            "Abbreviation",
            "DateChanged"
        ]
    );
    assert_eq!(got[1].type_name, "nxtWideString");
    assert_eq!(got[1].declared_length, 50);
    assert_eq!(got[1].size, 102, "fifty characters is a hundred bytes and two of slack");
    assert_eq!(got[6].type_name, "nxtDateTime");
    assert_eq!(got[6].size, 8);
}

#[test]
fn the_record_size_rule_holds_for_every_table() {
    assert_eq!(NX1_RECORD_LAYOUT.len(), 80, "tables whose layout this reads");
    for (name, size, _, rows) in NX1_RECORD_LAYOUT {
        let fields = fields_of(rows);
        let last = fields.iter().map(Field::end).max().expect("a table has fields") as usize;
        assert_eq!(records::record_size(&fields), Some(*size), "{name}");
        assert_eq!(DATA % size, 0, "{name} does not fill a block");
        assert!(*size >= last + 4, "{name} does not leave room for its fields");
        // It is the smallest such divisor, so no smaller one also fits.
        for smaller in (4..*size).filter(|d| DATA % d == 0) {
            assert!(smaller < last + 4, "{name} could have used {smaller}");
        }
    }
    assert!(NX1_RECORD_LAYOUT.iter().any(|(n, s, _, _)| *n == "datanames" && *s == 576));
    assert!(NX1_RECORD_LAYOUT.iter().any(|(n, s, _, _)| *n == "years" && *s == 12));
    assert!(NX1_RECORD_LAYOUT.iter().any(|(n, s, _, _)| *n == "units" && *s == 224));
}

#[test]
fn an_empty_table_is_not_a_read_failure() {
    // The shipped area is mostly tables that hold no rows. They read cleanly and simply have no
    // data block, which is a different thing from a layout this reader cannot place.
    let empty: Vec<&str> = NX1_RECORD_LAYOUT
        .iter()
        .filter(|(_, _, has_data, _)| !has_data)
        .map(|(name, _, _, _)| *name)
        .collect();
    let with_data: Vec<&str> = NX1_RECORD_LAYOUT
        .iter()
        .filter(|(_, _, has_data, _)| *has_data)
        .map(|(name, _, _, _)| *name)
        .collect();
    assert_eq!(empty.len(), 26, "empty tables: {empty:?}");
    assert_eq!(with_data.len(), 54);
    assert!(empty.contains(&"envresults"));
    assert!(empty.contains(&"results"));
    assert!(with_data.contains(&"datanames"));
    assert!(with_data.contains(&"years"));
    assert!(with_data.contains(&"scenariodata"));

    // Six tables remain unreadable, and they are named rather than quietly missing.
    for name in [
        "PluginProperties",
        "Plugins",
        "areadata",
        "fuels",
        "tedtechdata",
        "uservardata",
    ] {
        assert!(
            !NX1_RECORD_LAYOUT.iter().any(|(n, _, _, _)| *n == name),
            "{} should not have a layout yet",
            name
        );
    }
}

#[test]
fn datanames_decodes_into_typed_rows() {
    let block = unhex(NX1_DATANAMES_BLOCK);
    assert_eq!(block.len(), records::BLOCK);
    assert_eq!(records::data_blocks(&block), vec![0]);

    let (size, fields) = layout_of("datanames");
    let rows = records::records(&block, &fields, size);
    assert_eq!(rows.len(), 7, "a block holds seven of these");
    assert_eq!(rows.len(), NX1_DATANAMES_ROWS.len());

    for (row, want) in rows.iter().zip(NX1_DATANAMES_ROWS) {
        assert_eq!(row.len(), 7);
        assert_eq!(row[0], Value::Int(want.0 as i64), "TableID");
        assert_eq!(row[1], Value::Text(want.1.to_string()), "TableName");
        assert_eq!(row[2], Value::Int(want.2 as i64), "FieldID");
        assert_eq!(row[3], Value::Int(want.3 as i64), "SetID");
        assert_eq!(row[4], Value::Text(want.4.to_string()), "Name");
        assert_eq!(row[5], Value::Text(want.5.to_string()), "Abbreviation");
        assert!(matches!(row[6], Value::Float(_)), "DateChanged");
    }

    // The rows are the fuel list LEAP itself uses, read out of the record area by offset.
    let names: Vec<String> = NX1_DATANAMES_ROWS.iter().map(|r| r.4.to_string()).collect();
    assert_eq!(names[0], "Electricity");
    assert_eq!(names[4], "Natural Gas");
    assert!(NX1_DATANAMES_ROWS.iter().all(|r| r.1 == "Balcat"));
    assert!(NX1_DATANAMES_ROWS.iter().all(|r| r.0 == 1));
    assert!(NX1_DATANAMES_ROWS.iter().all(|r| r.3 == -1));
    assert_eq!(NX1_DATANAMES_ROWS[0].2, 1);
    assert_eq!(NX1_DATANAMES_ROWS[6].2, 7);
}

#[test]
fn blocks_that_are_not_data_blocks_are_left_alone() {
    assert!(records::data_blocks(&[0u8; 64]).is_empty());
    assert!(records::data_blocks(b"").is_empty());
    // A dictionary block is not a data block, and the reader only looks at the tag. A blob
    // block carries NXHD instead and holds RTF rather than records, so it is not one either.
    let mut header = vec![0u8; records::BLOCK];
    header[..4].copy_from_slice(b"NXSH");
    assert!(records::data_blocks(&header).is_empty());
    header[..4].copy_from_slice(b"NXHD");
    assert!(records::data_blocks(&header).is_empty());

    assert_eq!(records::record_size(&[]), None);
    assert!(records::records(&header, &[], 0).is_empty());
}

#[test]
fn a_layout_that_would_not_tile_is_refused() {
    let bytes = unhex(NX1_DATANAMES_DICTIONARY);
    assert_eq!(records::field_descriptors(&bytes).len(), 7, "the whole stream");

    // Cut the stream in the middle of the field list: an incomplete stream is not a layout.
    let cut = &bytes[..bytes.len() / 2];
    assert!(records::field_descriptors(cut).is_empty(), "a partial stream");
    assert!(records::field_descriptors(&[0u8; 64]).is_empty());
}

#[test]
fn a_moved_field_is_refused_rather_than_returned_with_a_hole() {
    // The tiling rule is what makes a wrong reading loud. Move one field by a byte and the
    // reader has to come back empty instead of with a layout that has a gap in it.
    let hex = NX1_DATANAMES_DICTIONARY.replace(
        "1200000000020302040266",
        "1200000000020302050266",
    );
    assert_ne!(hex, NX1_DATANAMES_DICTIONARY, "the placement pattern is not in the oracle");
    assert!(records::field_descriptors(&unhex(&hex)).is_empty());
    assert_eq!(records::field_descriptors(&unhex(NX1_DATANAMES_DICTIONARY)).len(), 7);
}

#[test]
fn a_class_name_inside_stream_data_is_not_a_field() {
    // fuels.nx1 really does carry the descriptor class name inside stream data, followed by a
    // string that is not an identifier. A match only counts when the name after it reads as one,
    // so a bogus one in front of a real dictionary must change nothing.
    let real = unhex(NX1_DATANAMES_DICTIONARY);
    let mut bytes = vec![0u8; 4];
    bytes.extend_from_slice(b"\x06\x12TnxFieldDescriptor");
    bytes.push(0x06);
    bytes.push(3);
    bytes.extend_from_slice(&[0x01, 0x00, 0x02]);
    bytes.extend_from_slice(&real);

    assert_eq!(records::field_descriptors(&bytes), records::field_descriptors(&real));
    assert_eq!(records::field_descriptors(&bytes).len(), 7);
}
