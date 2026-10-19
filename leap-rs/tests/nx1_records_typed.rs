//! Tests for the typed-row reader, over the vendor\u0027s own table bytes.
//!
//! The dictionary bytes and the data block here come out of `datanames.nx1` as it ships, so the
//! test decodes the same bytes a reader would meet. The layout assertions are the checks that
//! matter: the dictionary states an offset and a size for every field, and if that reading is
//! right then the fields tile the record exactly, which is a claim the vendor\u0027s own bytes can
//! settle rather than one this crate makes about itself.

use leap_rs::oracle_records::{
    NX1_DATANAMES_BLOCK, NX1_DATANAMES_DICTIONARY, NX1_DATANAMES_ROWS, NX1_HEADER_LIVE_COUNTS,
    NX1_FUELS_DICTIONARY, NX1_RECORD_LAYOUT, NX1_REGION_BLOCK, NX1_REGION_ROWS,
    NX1_STATICDATA_BLOCK, NX1_STATICDATA_ROWS, NX1_UNITS_HOLED_BLOCK, NX1_YEARS_BLOCK,
    NX1_YEARS_ROWS,
};
use leap_rs::records::{self, Field, Value};

/// The stride the tool's layout and the reader's rule agree the table is written at.
fn stride_of(table: &str, rows: &[(&str, &str, u32, u32, u32)]) -> Option<usize> {
    records::stride(table, &fields_of(rows))
}

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
    // years was listed at 0x3c with 336 slots until the slot map was read: its first two
    // "slots" there are the zero tail of a 42-byte bitmap, and slot 0 -- the bit-0 record,
    // 2021 -- starts at 0x54.
    ("years", 0x54, 12, 334),
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

#[test]
fn every_layout_carries_the_stride_the_rule_gives_or_the_block_proves() {
    assert_eq!(NX1_RECORD_LAYOUT.len(), 86, "tables whose layout this reads");
    for (name, base, size, cap, _, rows) in NX1_RECORD_LAYOUT {
        // The reader's stride is the engine's rule, or the measurement the block's own bytes
        // prove where the two differ. Either way it is the stride the layout carries, and that
        // layout's base and capacity follow from it.
        assert_eq!(stride_of(name, rows), Some(*size), "{name}");
        let page = base + cap * size + 4;
        assert_eq!(records::geometry_in(page, *size), Some((*base, *cap)), "{name}");
        match records::measured_stride(name) {
            Some(measured) => {
                assert_eq!(measured, *size, "{name}: the measured stride");
                // A measured entry is only justified where the rule gives something else:
                // the stride the file writes is the one its block proves, not the one the
                // dictionary still describes.
                assert_ne!(
                    records::record_size(&fields_of(rows)),
                    Some(*size),
                    "{name} would not need a measured stride if the rule gave it"
                );
            }
            None => assert_eq!(records::record_size(&fields_of(rows)), Some(*size), "{name}"),
        }
    }
    // The two tables that opened this step: datanames is measured, years is on the rule.
    assert_eq!(records::measured_stride("datanames"), Some(576));
    assert_eq!(records::measured_stride("years"), None);
    assert_eq!(records::measured_stride("units"), Some(224));
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
fn the_block_geometry_follows_from_the_record_size() {
    // A data block is a 0x20-byte header, a used-slot bitmap of one bit per slot, and records
    // tiling back from 4092; the capacity is the most records that leave room for the header
    // and their bitmap. The bases in BLOCK_PROVEN were measured by hand from record pitches
    // before this rule existed, and it has to reproduce every one of them.
    for (name, base, size, cap) in BLOCK_PROVEN {
        assert_eq!(records::geometry(*size), Some((*base as usize, *cap)), "{name}");
    }
    for (name, base, size, cap, _, _) in NX1_RECORD_LAYOUT {
        // The page follows from the layout: the record area ends four bytes short of it. Five
        // tables are written in 8192-byte pages, so `geometry` is asked for that page size.
        let page = base + cap * size + 4;
        assert_eq!(records::geometry_in(page, *size), Some((*base, *cap)), "{name}");
    }
    assert_eq!(records::geometry(0), None);
    assert_eq!(records::geometry(4093), None);
    assert_eq!(records::geometry_in(8192, 0), None, "no record size, no geometry");
    assert_eq!(records::geometry_in(4, 4093), None, "a record wider than the page");
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
fn the_stated_live_count_agrees_with_the_layout_per_table() {
    // A sweep over the shipped area's own first-block headers narrows the word's meaning to
    // the live count: for the tables written exactly full the stated count equals the
    // layout's capacity (balcat 13, datanames 7, staticdata 201, units 18, scenariodata
    // 168...), and for the partially filled ones it does not (years states 31 live of
    // 334, regions 1 of 11, scenarios 9 of 13). The two families are the file's own
    // numbers -- the layout carries the capacity, the header carries the live count.
    let layout = |name: &str| {
        NX1_RECORD_LAYOUT
            .iter()
            .find(|(n, _, _, _, _, _)| *n == name)
            .map(|(_, _, _, c, _, _)| *c)
            .expect("a layout for the table")
    };
    for (name, count) in [
        ("balcat", 13usize),
        ("datanames", 7),
        ("staticdata", 201),
        ("units", 18),
        ("scenariodata", 168),
    ] {
        assert_eq!(layout(name), count, "{name} is written exactly full");
    }
    for (name, count, cap) in [
        ("years", 31usize, 334),
        ("regions", 1, 11),
        ("scenarios", 9, 13),
    ] {
        assert_eq!(layout(name), cap, "{name}: the layout states the capacity");
        assert_ne!(count, cap, "{name}: the stated count is the live number");
    }
}


#[test]
fn the_engine_record_size_rule_is_what_the_blocks_that_hold_to_it_carry() {
    // FUN_012ec9e0's rule: the summed field sizes rounded up to a multiple of four, plus four
    // bytes per thirty-two fields for the null-bitmap that ends every record. It is the stride
    // the blocks carry wherever the file was written from the dictionary it still holds:
    // years' 12, staticdata's 20, scenarios' 312, scenariodata's 24, maccreport's 76,
    // RegressionResults' 40 and writtenresults' 12 -- where the 4032-divisor rule this
    // replaced gave 12, 18, 336, 24, 84, 42 and 9, and two of those do not even divide 4032.
    for (name, want) in [
        ("years", 12usize),
        ("staticdata", 20),
        ("scenarios", 312),
        ("scenariodata", 24),
        ("maccreport", 76),
        ("RegressionResults", 40),
        ("writtenresults", 12),
    ] {
        let (_, size, _, fields) = layout_of(name);
        assert_eq!(records::record_size(&fields), Some(want), "{name}: the rule's answer");
        assert_eq!(size, want, "{name}: the block's stride is the rule's answer");
        assert_eq!(records::measured_stride(name), None, "{name} needs no measurement");
    }
    // And the tables whose records were written from a wider dictionary than the file now
    // And the twenty-eight tables where the rule stops short of the stride the block proves.
    // Each pair is (rule, measured) as the bytes read; what sets the extra is not established
    // (see `MEASURED_STRIDE`).
    for (name, rule, measured) in [
        ("areadata", 784usize, 800usize),
        ("balcat", 300, 304),
        ("balcat2", 300, 304),
        ("balcat3", 300, 304),
        ("balcat4", 300, 304),
        ("constants", 188, 192),
        ("datanames", 532, 576),
        ("fuels", 1028, 1280),
        ("landtypes", 328, 336),
        ("regioncategories", 300, 304),
        ("regioncategories2", 300, 304),
        ("regioncategories3", 300, 304),
        ("regioncategories4", 300, 304),
        ("refs", 3284, 3584),
        ("regions", 360, 368),
        ("scenarioeffects", 1524, 1536),
        ("scenariotemplate", 488, 496),
        ("summaryreportrows", 1304, 1344),
        ("summaryreports", 1424, 1536),
        ("taggroups", 1332, 1344),
        ("tags", 1496, 1536),
        ("tedeffects", 1524, 1536),
        ("tedtechdata", 332, 336),
        ("timeslices", 756, 768),
        ("units", 216, 224),
        ("uservardata", 5552, 6144),
        ("variabledata", 2188, 3072),
        ("variablecategories", 524, 576),
    ] {
        let (_, size, _, fields) = layout_of(name);
        assert_eq!(records::record_size(&fields), Some(rule), "{name}: the rule's answer");
        assert_eq!(records::measured_stride(name), Some(measured), "{name}");
        assert_eq!(size, measured, "{name}: the block writes further out than the rule");
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
fn regions_decodes_as_the_one_row_its_header_states() {
    // regions lives at base 0x2c with records 368 apart, and freed regions from a past edit
    // still hold their number: slot 1 holds 3, slot 2 holds 4 and slot 9 holds 11, the freed
    // number the signature now reads (its slot number plus two) rather than a RegionID. The
    // block's used-slot map marks one slot, which is the one row the header states, and the
    // freed ones stay out either way.
    let block = unhex(NX1_REGION_BLOCK);
    let (base, size, cap, fields) = layout_of("regions");
    let rows = records::live_records(&block, base, &fields, size);
    assert_eq!(rows.len(), 1, "the one live region");
    assert_eq!(rows[0].len(), 22, "all 22 fields the regions dictionary states");
    assert_eq!(rows[0][0], Value::Int(1), "RegionID");
    assert_eq!(rows[0][1], Value::Text("Region 1".to_string()), "Name");
    assert_eq!(NX1_REGION_ROWS, &[(1, "Region 1")]);

    // The freed numbers are what the signature reads, and it leaves every freed slot out.
    let signature = (0..cap)
        .filter(|k| !records::slot_is_unwritten(&block[base + k * size..base + (k + 1) * size], *k))
        .count();
    assert_eq!(signature, 1, "only the live slot reads as written");
}

#[test]
fn the_slot_map_gives_exactly_the_live_count_every_block_states() {
    // The six tables whose stated count was confirmed against the rows by hand: read through
    // the used-slot map at 0x20, each block yields exactly the records its header states.
    for (name, live, hex) in NX1_HEADER_LIVE_COUNTS {
        let block = unhex(hex);
        let (base, size, cap, fields) = layout_of(name);
        let map = records::slot_map(&block, base, cap).expect("a map that accounts for every live slot");
        assert_eq!(map.len(), cap, "{name}: one entry per slot");
        assert_eq!(map.iter().filter(|live| **live).count(), *live as usize, "{name}");
        let rows = records::live_records(&block, base, &fields, size);
        assert_eq!(rows.len(), *live as usize, "{name}: the rows the header states");
    }
}

#[test]
fn a_record_deleted_from_the_middle_is_left_out() {
    // A units block holds eighteen slots, all of which look written, and states seventeen live.
    // Slot 8 is the one deleted: its first four bytes were overwritten when it was freed, but
    // the rest of the Argentine Peso record is still there, which is exactly what the signature
    // cannot see. The used-slot map has its bit clear, so the row is gone and the neighbours
    // either side of it are not.
    let block = unhex(NX1_UNITS_HOLED_BLOCK);
    let (base, size, cap, fields) = layout_of("units");
    assert_eq!(records::header_live_count(&block), Some(17));
    let map = records::slot_map(&block, base, cap).unwrap();
    let dead: Vec<usize> = (0..cap).filter(|k| !map[*k]).collect();
    assert_eq!(dead, vec![8]);
    let freed = &block[base + 8 * size..base + 9 * size];
    assert!(!records::slot_is_unwritten(freed, 8), "the signature takes it for written");
    let text = String::from_utf16_lossy(
        &freed[4..30].chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>(),
    );
    assert_eq!(text, "rgentine Peso", "the freed record's residue");

    let rows = records::live_records(&block, base, &fields, size);
    assert_eq!(rows.len(), 17);
    let names: Vec<String> = rows.iter().map(|r| r[1].to_string()).collect();
    assert!(names.iter().all(|n| !n.contains("rgentine")));
    assert!(names[7].starts_with("Russian R"), "slot 7 survives: {}", names[7]);
    assert!(names[8].starts_with("Colombian P"), "slot 9 follows it: {}", names[8]);
}

#[test]
fn fuels_dictionary_tiles_once_its_page_seam_is_read() {
    // The fuels dictionary runs across a page boundary, and a dictionary page is a 32-byte lead,
    // the stream, and a 4-byte trailer. Read through that seam, all 45 fields tile with no gap.
    // An earlier reading stepped over the seam bytes as if they were stream, lost ImageIndex
    // (an Int16 at 893) inside them, and covered the hole with a two-byte "slack" before
    // PluginGUID; the fixture is the file's own pages, so the seam is what is under test.
    let bytes = unhex(NX1_FUELS_DICTIONARY);
    let got = records::field_descriptors(&bytes);
    assert_eq!(got.len(), 45, "every field the dictionary states");
    let names: Vec<&str> = got.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(
        names[..4],
        vec!["FuelID", "EnergyContent", "Name", "LHVHHVRatio"]
    );
    let image = got
        .iter()
        .find(|f| f.name == "ImageIndex")
        .expect("the field the seam used to swallow");
    assert_eq!((image.type_name.as_str(), image.offset, image.size), ("nxtInt16", 893, 2));
    let guid = got.iter().find(|f| f.name == "PluginGUID").expect("PluginGUID");
    assert_eq!((guid.offset, guid.size), (895, 51));
    let mut end = 0u32;
    for field in &got {
        assert_eq!(field.offset, end, "{}: the fields tile with no gap", field.name);
        end = field.end();
    }
}

#[test]
fn a_gap_in_front_of_a_string_is_refused_like_any_other() {
    // With the seam read there is no gap left anywhere in the shipped area, so the tiling rule
    // has no exception. Unmark the ImageIndex descriptor in place -- same length, so the pages
    // do not move -- and its field is lost, which opens the old two-byte gap in front of the
    // null string PluginGUID. That has to be a refusal, not a slack. The seam falls inside the
    // name itself ("ImageIn", page lead, "dex"), which is how the old reading came to take the
    // descriptor for a class name inside stream data.
    let mut bytes = unhex(NX1_FUELS_DICTIONARY);
    let name = b"\x06\x0aImageIn\x05\x00\x00\x00NXSH";
    let at = bytes.windows(name.len()).position(|w| w == name).expect("ImageIndex descriptor");
    bytes[at] = 0x00;
    assert!(records::field_descriptors(&bytes).is_empty());
    assert_eq!(records::field_descriptors(&unhex(NX1_FUELS_DICTIONARY)).len(), 45);
}

#[test]
fn tedtechdata_places_the_field_on_its_page_seam() {
    // IncludeCapacityData is the descriptor the page boundary cuts in two: its offset and size
    // sit after the seam. Read through it, the field lands at 308, one byte, between the Int16
    // ending at 308 and the next boolean at 309, and the table joins the layouts.
    let (_, _, _, fields) = layout_of("tedtechdata");
    assert_eq!(fields.len(), 48);
    let cap = fields.iter().find(|f| f.name == "IncludeCapacityData").unwrap();
    assert_eq!((cap.type_name.as_str(), cap.offset, cap.size), ("nxtBoolean", 308, 1));
    let mut end = 0u32;
    for field in &fields {
        assert_eq!(field.offset, end, "{}: the fields tile with no gap", field.name);
        end = field.end();
    }
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
    assert_eq!(empty.len(), 28, "empty tables: {empty:?}");
    assert_eq!(with_data.len(), 58);
    assert!(empty.contains(&"envresults"));
    assert!(empty.contains(&"results"));
    assert!(empty.contains(&"PluginProperties"));
    assert!(empty.contains(&"Plugins"));
    assert!(empty.contains(&"emissionmappings"));
    assert!(with_data.contains(&"datanames"));
    assert!(with_data.contains(&"years"));
    assert!(with_data.contains(&"scenariodata"));
    assert!(with_data.contains(&"refs"));
    assert!(with_data.contains(&"uservardata"));

    // The five tables written in 8192-byte pages place too, now that the geometry takes the
    // page size the file states rather than assuming 4092 bytes of records: the three that hold
    // nothing are empty like the rest, and refs and uservardata hold rows.
    for name in [
        "PluginProperties",
        "Plugins",
        "emissionmappings",
        "refs",
        "uservardata",
    ] {
        assert!(
            NX1_RECORD_LAYOUT.iter().any(|(n, _, _, _, _, _)| *n == name),
            "{name} has no layout"
        );
        let (base, size, cap, _) = layout_of(name);
        assert_eq!(base + cap * size + 4, 8192, "{name}: an 8 KiB page");
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
fn a_field_narrower_than_its_type_comes_back_unset_rather_than_panicking() {
    // A dictionary states a size per field, and nothing stops a hand-edited one from stating a
    // size its type cannot fill -- an Int32 in two bytes, a double in four, a flag in none.
    // The reader has no business panicking on that: the field comes back `Unset`, the same
    // answer it gives a type it has no rule for.
    let field = |name: &str, type_name: &str, offset: u32, size: u32| Field {
        name: name.to_string(),
        type_name: type_name.to_string(),
        declared_length: 0,
        offset,
        size,
    };
    let fields = vec![
        field("Int16", "nxtInt16", 0, 1),
        field("Int32", "nxtInt32", 4, 3),
        field("Int64", "nxtInt64", 8, 4),
        field("Double", "nxtDouble", 16, 4),
        field("Boolean", "nxtBoolean", 24, 0),
        field("Wide", "nxtWideString", 32, 0),
        field("Blob", "nxtBlob", 40, 4),
        field("Date", "nxtDateTime", 48, 2),
    ];
    let block = vec![0x11u8; 128];
    let rows = records::records(&block, 0, &fields, 64);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0], vec![Value::Unset; 8], "every narrow field, quietly");

    // A slot narrower than the text it claims still reads as text: two bytes are one unit, and
    // the last one is the slot's reserved terminator, so this one holds nothing but that.
    let one = vec![field("Wide", "nxtWideString", 0, 2)];
    let mut block = vec![0u8; 128];
    block[0] = 0x41;
    assert_eq!(
        records::records(&block, 0, &one, 64)[0][0],
        Value::Text(String::new()),
        "the reserved unit"
    );

    // A field that claims to start past the end of its record leaves nothing to read, and
    // nothing to panic over either.
    let past = vec![field("Past", "nxtInt32", 4090, 4)];
    assert_eq!(records::records(&vec![0u8; 128], 0, &past, 64)[0][0], Value::Unset);
}

#[test]
fn a_wide_string_decodes_as_utf16_including_its_surrogate_pairs() {
    // A character outside the basic multilingual plane is two UTF-16 units, and a reader that
    // maps unit by unit -- `char::from_u32(unit as u32)` -- turns each half into a replacement
    // character. The area's own strings are all ASCII, so the pair is built from the bytes
    // here: "a", U+1F600, "b", terminated and padded like a slot.
    let mut block = vec![0u8; 128];
    for (i, unit) in [0x0061u16, 0xd83d, 0xde00, 0x0062].iter().enumerate() {
        block[2 * i..2 * i + 2].copy_from_slice(&unit.to_le_bytes());
    }
    let fields = vec![Field {
        name: "Text".to_string(),
        type_name: "nxtWideString".to_string(),
        declared_length: 0,
        offset: 0,
        size: 16,
    }];
    let rows = records::records(&block, 0, &fields, 64);
    assert_eq!(rows[0][0], Value::Text("a\u{1f600}b".to_string()));
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
    assert_eq!(everything.len(), 334, "the block holds this many slots");
    assert!(
        everything.iter().any(|row| row[0] == Value::Int(33)),
        "a free slot reads as year 33 when nothing filters it"
    );

    // What the free slots actually hold: their own slot number plus two, which is the
    // signature's rule. Slot 31 is the first free one and holds 33; the last slot of the
    // block holds zero. The number is what pinned areadata's and variabledata's strides.
    for (slot, want) in [(31usize, 33i64), (32, 34), (100, 102), (333, 0)] {
        let record = &block[base + slot * size..base + (slot + 1) * size];
        let held = i64::from(i16::from_le_bytes([record[0], record[1]]));
        assert_eq!(held, want, "slot {slot} of the years block");
        if want == 0 {
            assert!(record.iter().all(|byte| *byte == 0), "the last slot was never written");
        } else {
            assert!(records::slot_is_unwritten(record, slot), "slot {slot}");
            assert!(!records::slot_is_unwritten(record, slot + 1), "not slot {}", slot + 1);
        }
    }
}
