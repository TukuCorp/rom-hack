//! Tests for the typed-row reader, over the vendor\u0027s own table bytes.
//!
//! The dictionary bytes and the data block here come out of `datanames.nx1` as it ships, so the
//! test decodes the same bytes a reader would meet. The layout assertions are the checks that
//! matter: the dictionary states an offset and a size for every field, and if that reading is
//! right then the fields tile the record exactly, which is a claim the vendor\u0027s own bytes can
//! settle rather than one this crate makes about itself.

use leap_rs::oracle_records::{
    NX1_DATANAMES_BLOCK, NX1_DATANAMES_DICTIONARY, NX1_DATANAMES_ROWS, NX1_HEADER_LIVE_COUNTS,
    NX1_RECORD_LAYOUT, NX1_REGION_BLOCK, NX1_REGION_ROWS, NX1_STATICDATA_BLOCK,
    NX1_STATICDATA_ROWS, NX1_YEARS_BLOCK, NX1_YEARS_ROWS,
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

fn layout_of(table: &str) -> (usize, usize, usize, Vec<Field>) {
    for (name, base, size, cap, _, rows) in NX1_RECORD_LAYOUT {
        if *name == table {
            return (*base, *size, *cap, fields_of(rows));
        }
    }
    panic!("no oracle layout for {}", table);
}

/// The geometry the vendor block's own markers prove per table: the pitch of consecutive
/// live records, the free-slot numbers the reader already knows about, and the doubles and
/// datetimes the fields hold. Datanames and years agree with the record-size rule; the first
/// four defeat it.
const BLOCK_PROVEN: &[(&str, u32, usize, usize)] = &[
    ("staticdata", 0x48, 20, 201),
    ("balcat", 0x8c, 304, 13),
    ("scenarios", 0x24, 312, 13),
    ("regions", 0x2c, 368, 11),
    ("datanames", 0x3c, 576, 7),
    ("years", 0x3c, 12, 336),
];

#[test]
fn the_dictionary_states_where_every_field_sits() {
    let bytes = unhex(NX1_DATANAMES_DICTIONARY);
    let got = records::field_descriptors(&bytes);
    let (_, _, _, want) = layout_of("datanames");
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

/// The strides the data blocks themselves prove, from the pitch of consecutive live records:
/// the wide-string or double fields of neighbouring records sit an exact distance apart. For
/// three tables that pitch is not the stride the record-size rule derives, and the rule gives
/// way to the bytes.
const BLOCK_MEASURED: &[(&str, u32, usize)] = &[
    ("staticdata", 0x48, 20),
    ("balcat", 0x8c, 304),
    ("scenarios", 0x24, 312),
    ("regions", 0x2c, 368),
];

#[test]
fn the_record_size_rule_holds_for_every_table_worth_trusting_it_on() {
    assert_eq!(NX1_RECORD_LAYOUT.len(), 80, "tables whose layout this reads");
    for (name, base, size, _, _, rows) in NX1_RECORD_LAYOUT {
        if let Some((_, measured_base, measured)) =
            BLOCK_MEASURED.iter().find(|(n, _, _)| *n == *name)
        {
            // The block measures this table differently from the rule, and the pitch of its
            // own records is the evidence. staticdata's fields end at 14, which the rule
            // rounds into an 18-byte slot, but its records sit 20 apart -- a chain of
            // increasing ids runs through them and its double values land exactly on that
            // pitch as 1.0, 2021.0, 0.0. Neither 20 nor 304 nor 312 divides 4032, so the
            // smallest-divisor derivation is refuted, not extended, and the base moves with
            // the stride: the record area is what the block's own numbers agree to.
            assert_eq!(*size, *measured, "{name} carries the stride its block shows");
            assert_eq!(*base, *measured_base as usize, "{name} carries the base its block shows");
            assert_ne!(
                records::record_size(&fields_of(rows)),
                Some(*measured),
                "{name} would not need a measured stride if the rule gave it"
            );
            continue;
        }
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
    assert!(NX1_RECORD_LAYOUT
        .iter()
        .any(|(n, _, s, _, _, _)| *n == "datanames" && *s == 576));
    assert!(NX1_RECORD_LAYOUT
        .iter()
        .any(|(n, _, s, _, _, _)| *n == "years" && *s == 12));
    assert!(NX1_RECORD_LAYOUT
        .iter()
        .any(|(n, _, s, _, _, _)| *n == "units" && *s == 224));
}

#[test]
fn the_pitch_consecutive_live_records_show_matches_the_layout() {
    // Which field is pitched varies by table -- the wide-string names of datanames and
    // scenarios, the doubles and the counting id of staticdata, the names of balcat -- but the
    // distance is exact, every live record at the same pitch, ending a whole number of pitches
    // from the 4092 bytes where the record area of a 4096-byte block stops. balcat's thirteen
    // records sit 0x130 apart from 0x8c and end at 4092; scenariodata's expression table tiles
    // the other way, whole blocks of 168 rows. The rule already agrees for datanames and years.
    for (name, want_base, want, want_cap) in BLOCK_PROVEN {
        let (base, size, cap, _) = layout_of(name);
        assert_eq!(
            (base, size, cap),
            (*want_base as usize, *want, *want_cap),
            "{name}: the records sit {want} apart from {want_base:#x} with room for {want_cap}, the layout says otherwise"
        );
    }
}

#[test]
fn the_block_header_states_the_live_record_count() {
    // Word 0x1e of a data block states how many records the table has live. It is the file's
    // own answer to what the unwritten-slot signature only estimates, confirmed against the
    // rows the records themselves show for six tables: 31 years, 7 datanames, 1 live region,
    // 13 balance categories, 9 scenarios, 201 static values.
    for (name, count, block) in NX1_HEADER_LIVE_COUNTS {
        assert_eq!(records::header_live_count(&unhex(block)), Some(*count), "{name}");
    }
}

#[test]
fn the_engine_record_size_formula_agrees_where_it_can() {
    // The decompiled engine computes the record size itself (FUN_012ec9e0, reached through
    // FUN_012eb790's add-field accounting): round the summed field sizes up to a multiple of
    // four, then add four bytes per 32 fields for the null-bitmap that ends every record --
    // the f8 words the years and staticdata blocks had shown all along. The formula agrees
    // with the measured strides for years, scenarios and staticdata. datanames, balcat and
    // regions sit further out, so their files grew by an exporter-side slack the current
    // dictionary cannot name, and the pitch -- not the formula -- carries their truth.
    for (name, want) in [
        ("years", 12usize),
        ("scenarios", 312),
        ("staticdata", 20),
    ] {
        let (_, _, _, fields) = layout_of(name);
        assert_eq!(records::engine_record_size(&fields), Some(want), "{name}");
        let (_, size, _, _) = layout_of(name);
        assert_eq!(size, want, "{name}: the measured pitch IS the formula's answer");
    }
    for (name, engine, measured) in [
        ("datanames", (528usize + 4), 576usize),
        ("balcat", (296 + 4), 304),
        ("regions", (356 + 4), 368),
    ] {
        let (_, _, _, fields) = layout_of(name);
        assert_eq!(records::engine_record_size(&fields), Some(engine), "{name}");
        assert_eq!(
            measured - engine,
            match name {
                "datanames" => 44,
                "balcat" => 4,
                _ => 8,
            },
            "{name}: the exporter-side slack this table's file carries"
        );
    }
}

#[test]
fn staticdata_decodes_as_an_ascending_table_of_variable_values() {
    // Base 0x48, records 20 apart: the geometry the Expression doubles themselves prove, so
    // this test reads the doubles back and pins the ones that appeared in the byte walks. The
    // variable id is sparse but never falls.
    let block = unhex(NX1_STATICDATA_BLOCK);
    let (base, size, _, fields) = layout_of("staticdata");
    let rows = records::live_records(&block, base, &fields, size);
    let wants = NX1_STATICDATA_ROWS;
    assert_eq!(rows.len(), wants.len(), "every slot that reads as written");
    let mut previous = (-1i64, 0i64);
    for (row, want) in rows.iter().zip(wants) {
        assert_eq!(row[0], Value::Int(want.0 as i64), "BranchID");
        assert_eq!(row[1], Value::Int(want.1 as i64), "VariableID");
        match row[2] {
            Value::Float(got) => {
                assert_eq!(got, f64::from_bits(want.2), "Expression of variable {}", want.1);
            }
            _ => panic!("Expression is not a double"),
        }
        // Per branch the ids ascend; a new branch section restarts the id count, as the
        // freed-area structure implies: the globals come first, then each branch's block.
        let (branch, id) = (i64::from(want.0), i64::from(want.1));
        assert!(branch > previous.0 || (branch == previous.0 && id > previous.1),
            "ids ascend within a branch: ({}, {}) after {:?}", want.0, want.1, previous);
        previous = (branch, id);
    }
    // The exact values the byte walks showed: two exact ones, then the LEAP base year as a
    // static value, then zero. A wrong base or stride scrambles these before anything else.
    assert_eq!(f64::from_bits(wants[1].2), 1.0, "variable 1690's value");
    assert_eq!(f64::from_bits(wants[3].2), 2021.0, "the LEAP base year as a value");
    // The first per-branch section after the globals ends at slot 34 (branch -1, id 2325),
    // and the first branch carries its own values: a wrong stride mixes branches into ids
    // that break this before anything else would.
    assert_eq!(wants[34], (-1, 2325, 4611686018427387904), "globals end here");
    assert_eq!(wants[35].0, 1, "the first per-branch row");
}

#[test]
fn regions_decodes_as_the_one_row_its_header_states_plus_freed_debris() {
    // regions lives at base 0x2c with records 368 apart, and freed regions from a past edit
    // still hold their RegionID in residue, so the unwritten-slot signature yields their
    // slots as live. The block's own header says one live record; the reader carries the
    // freed ones named rather than quietly.
    let block = unhex(NX1_REGION_BLOCK);
    let (base, size, _, fields) = layout_of("regions");
    let rows = records::live_records(&block, base, &fields, size);
    let wants = NX1_REGION_ROWS;
    assert_eq!(rows.len(), wants.len(), "every slot that reads as written");
    for (row, want) in rows.iter().zip(wants) {
        assert_eq!(row.len(), 22, "all 22 fields the regions dictionary states");
        assert_eq!(row[0], Value::Int(want.0 as i64), "RegionID");
        assert_eq!(row[1], Value::Text(want.1.to_string()), "Name");
    }
    assert_eq!(wants[0], (1, "Region 1"), "the live row the header states");
    assert!(
        wants.iter().skip(1).all(|w| w == &(w.0, "")),
        "the freed slots keep their RegionIDs and nothing they decode");
}

#[test]
fn the_record_area_of_every_measured_table_tiles_to_4092() {
    // The relation the whole format hangs on and all six proven tables agree to: the block
    // ends with four spare bytes at 4092, records tile back from there in whole strides, and
    // the capacity is exactly what fits. base + capacity * stride == 4092 is a two-way check:
    // a wrong base, a wrong stride, or a wrong capacity breaks it.
    for (name, base, size, cap) in BLOCK_PROVEN {
        let (got_base, got_size, got_cap, _) = layout_of(name);
        assert_eq!(
            (got_base, got_size, got_cap),
            (*base as usize, *size, *cap),
            "{name}: the layout disagrees with the block-proven geometry"
        );
        assert_eq!(
            got_base + got_cap * got_size,
            4092usize,
            "{name}: the record area must end at the block's four spare bytes"
        );
    }
}

#[test]
fn an_empty_table_is_not_a_read_failure() {
    // The shipped area is mostly tables that hold no rows. They read cleanly and simply have no
    // data block, which is a different thing from a layout this reader cannot place.
    let empty: Vec<&str> = NX1_RECORD_LAYOUT
        .iter()
        .filter(|(_, _, _, _, has_data, _)| !has_data)
        .map(|(name, _, _, _, _, _)| *name)
        .collect();
    let with_data: Vec<&str> = NX1_RECORD_LAYOUT
        .iter()
        .filter(|(_, _, _, _, has_data, _)| *has_data)
        .map(|(name, _, _, _, _, _)| *name)
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
            !NX1_RECORD_LAYOUT.iter().any(|(n, _, _, _, _, _)| *n == name),
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

    let (base, size, _, fields) = layout_of("datanames");
    let rows = records::records(&block, base, &fields, size);
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
    assert!(records::records(&header, records::HEADER, &[], 0).is_empty());
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

#[test]
fn the_year_list_comes_out_of_the_written_slots() {
    // The one table where the answer is knowable independently: the year list runs from the
    // area base year to 2050, and this block holds free slots past the written ones that would
    // otherwise be read as years 33 and up.
    let block = unhex(NX1_YEARS_BLOCK);
    let (base, size, _, fields) = layout_of("years");
    let rows = records::live_records(&block, base, &fields, size);
    assert_eq!(rows.len(), 31, "every written slot and no free one");
    assert_eq!(rows.len(), NX1_YEARS_ROWS.len());

    let mut years = Vec::new();
    for (row, want) in rows.iter().zip(NX1_YEARS_ROWS) {
        assert_eq!(row[0], Value::Int(want.0 as i64), "YearID");
        assert_eq!(row[1], Value::Text(want.1.to_string()), "Name");
        years.push(want.0);
    }

    // The rows come out in insertion order, which is not sorted, and as a set they are the whole
    // run from 2020 to 2050 -- the base year the area settings state to the year LEAP stops at.
    assert_eq!(years[0], 2021);
    assert_eq!(years[10], 2020);
    assert_eq!(years[11], 2050);
    let mut ordered = years.clone();
    ordered.sort_unstable();
    assert_ne!(years, ordered, "the file stores the rows in insertion order");
    assert_eq!(ordered, (2020..=2050).collect::<Vec<i16>>());

    // Without the rule the free slots read as years, which is what the rule is for.
    let everything = records::records(&block, base, &fields, size);
    assert_eq!(everything.len(), 336, "the block holds this many slots");
    assert!(
        everything.iter().any(|row| row[0] == Value::Int(33)),
        "a free slot reads as year 33 when nothing filters it"
    );
}
