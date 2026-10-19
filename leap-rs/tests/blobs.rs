//! Blob fields joined to their heap memos, across the whole shipped area.
//!
//! The vendor bytes, so the join is tested on what LEAP wrote: the sweep reads every heap
//! block of every table to the count it states, and the join tests resolve rows to the
//! memos they point at -- expression texts that parse, info-page paths, branch notes --
//! with the binary memos pinned as binary rather than read as text.
//!
//! The area ships with LEAP, so like `vendor_e2e` this prints a note and passes without it.

use leap_rs::{blobs, container, expr, heap, model, records};
use leap_rs::records::Value;

const AREA: &str = "C:/Program Files/LEAP/Freedonia.zip";

/// Every `.nx1` member of the shipped area, as (table name, bytes).
fn tables() -> Option<Vec<(String, Vec<u8>)>> {
    let zip = std::fs::read(AREA).ok()?;
    let names = container::member_names(&zip)?;
    Some(
        names
            .iter()
            .filter(|name| name.to_lowercase().ends_with(".nx1"))
            .map(|name| {
                let table = name.rsplit('/').next().unwrap().trim_end_matches(".nx1");
                let bytes = container::read_member(&zip, name).expect("a member the zip lists");
                (table.to_string(), bytes)
            })
            .collect(),
    )
}

/// One table member of the shipped area, by file name without the extension.
fn member(table: &str) -> Option<Vec<u8>> {
    let zip = std::fs::read(AREA).ok()?;
    container::read_member(&zip, &format!("Freedonia/{table}.nx1"))
}

#[test]
fn every_heap_block_reads_to_the_count_it_states() {
    let Some(tables) = tables() else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let mut blocks = 0;
    let mut memos = 0;
    let mut short = Vec::new();
    for (name, bytes) in &tables {
        for page in blobs::heap_pages(bytes) {
            let page_size = records::page_size(bytes);
            let block = &bytes[page * page_size..(page + 1) * page_size];
            let stated = heap::stated(block).unwrap_or(0) as usize;
            let got = heap::memos(block).len();
            blocks += 1;
            memos += got;
            if got != stated {
                short.push(format!("{name} page {page}: {got} of {stated}"));
            }
        }
    }
    assert!(short.is_empty(), "heap blocks short of their stated count: {short:#?}");
    assert_eq!(blocks, 550, "heap blocks in the thirteen files that carry them");
    assert_eq!(memos, 5505, "memos those blocks state and hold");
}

#[test]
fn every_blob_reference_resolves_to_a_memo_it_names() {
    let Some(tables) = tables() else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let mut refs = 0;
    let mut bad = Vec::new();
    for (name, bytes) in &tables {
        let fields = records::field_descriptors(bytes);
        let at: Vec<usize> = fields
            .iter()
            .enumerate()
            .filter(|(_, field)| field.type_name.starts_with("nxtBlob"))
            .map(|(i, _)| i)
            .collect();
        if at.is_empty() {
            continue;
        }
        let page = records::page_size(bytes);
        let data = records::data_blocks_in(bytes, page);
        if data.is_empty() {
            continue;
        }
        let Some(size) = records::stride(name, &fields) else {
            panic!("{name}: no stride for a table with blob fields and data blocks");
        };
        let Some((base, _)) = records::geometry_in(page, size) else {
            panic!("{name}: no geometry for a table with blob fields and data blocks");
        };
        for start in data {
            let block = &bytes[start..start + page];
            for row in records::live_records(block, base, &fields, size) {
                for i in &at {
                    let Value::Blob(blob) = row[*i] else {
                        panic!("{name}: a blob field did not decode as a blob");
                    };
                    if blob == 0 {
                        continue;
                    }
                    refs += 1;
                    if blobs::resolve(bytes, blob).is_none() {
                        let (index, block) = (blob & 0xffff_ffff, blob >> 32);
                        bad.push(format!("{name}: position {index} of heap page {block}"));
                    }
                }
            }
        }
    }
    assert!(bad.is_empty(), "blob references with no memo behind them: {bad:#?}");
    assert_eq!(refs, 4547, "non-zero blob references in the shipped area");
}

#[test]
fn scenario_rows_resolve_to_expressions_that_parse() {
    let Some(bytes) = member("scenariodata") else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let rows = model::scenarios(&bytes);
    assert_eq!(rows.len(), 1012, "scenario rows in the shipped table");
    let first: Vec<String> = rows
        .iter()
        .take(7)
        .map(|row| blobs::expression_text(&bytes, row).expect("an expression memo"))
        .collect();
    assert_eq!(first, vec!["0.2", "5", "1000", "5", "0", "1", "2040"]);
    for text in &first {
        assert!(expr::parse(text).is_ok(), "{text}");
    }
    // Two rows point at binary memos rather than at expression text, and those come back
    // as nothing rather than as a wrong reading.
    for (branch, variable, index, block) in [(595, 2027, 169, 13), (831, 991, 113, 21)] {
        let row = rows
            .iter()
            .find(|row| row.branch == branch && row.variable == variable)
            .unwrap_or_else(|| panic!("branch {branch} variable {variable} is in the table"));
        assert_eq!((row.memo_index, row.memo_block), (index, block));
        assert_eq!(blobs::expression_text(&bytes, row), None);
        let memo = blobs::resolve(&bytes, blobs::join(index, block)).expect("the binary memo");
        assert_eq!(memo.kind, 5);
        assert_eq!(memo.text(blobs::Width::Wide), None);
    }
    let memo = blobs::resolve(&bytes, blobs::join(169, 13)).expect("the binary memo");
    assert_eq!(memo.bytes, vec![2, 0, 0, 0, 19, 0, 0, 0, 126, 0, 0, 0, 0]);
}

#[test]
fn a_ted_memo_resolves_to_a_number_that_parses() {
    let Some(bytes) = member("tedenvdata") else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let memo = blobs::resolve_at(&bytes, 1, 5).expect("the first memo of the first heap block");
    assert_eq!(memo.kind, 3);
    assert_eq!(memo.text(blobs::Width::Narrow), Some("68607".to_string()));
    assert!(expr::parse("68607").is_ok());
}

#[test]
fn info_page_paths_resolve() {
    let Some(bytes) = member("tedtechdata") else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let fields = records::field_descriptors(&bytes);
    let at = records::index_of(&fields, "InfoPageURL").expect("the info-page field");
    let page = records::page_size(&bytes);
    let size = records::stride("tedtechdata", &fields).expect("the tedtechdata stride");
    let (base, _) = records::geometry_in(page, size).expect("the tedtechdata geometry");
    let mut paths = 0;
    for start in records::data_blocks_in(&bytes, page) {
        let block = &bytes[start..start + page];
        for row in records::live_records(block, base, &fields, size) {
            let Value::Blob(blob) = row[at] else {
                panic!("an info-page field did not decode as a blob");
            };
            if blob == 0 {
                continue;
            }
            let memo = blobs::resolve(&bytes, blob).expect("an info-page memo");
            let text = memo.text(blobs::Width::Wide).expect("info pages are text");
            assert!(!text.is_empty());
            assert!(
                text.starts_with("http") || text.ends_with(".html") || text.ends_with(".htm"),
                "{text}",
            );
            paths += 1;
        }
    }
    assert_eq!(paths, 177, "info-page references in the shipped table");
}

#[test]
fn branch_notes_resolve() {
    let Some(bytes) = member("masterstructure") else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    // Pinned by memo position: the structure rows sit in another agent in-flight
    // stride rework this round, and the join sweep already ties rows to memos.
    let shapes = blobs::resolve_at(&bytes, 1, 6).expect("the Load Shapes html note");
    assert!(shapes.text(blobs::Width::Wide).expect("text").starts_with("%3Chtml%3E"));
    let root = blobs::resolve_at(&bytes, 2, 6).expect("the area root note");
    assert!(root.text(blobs::Width::Narrow).expect("text").starts_with("{\\rtf1"));
    let root_html = blobs::resolve_at(&bytes, 3, 6).expect("the area root html note");
    assert_eq!(root_html.kind, 5, "the root html note is a binary memo");
    assert_eq!(root_html.text(blobs::Width::Wide), None);
}
#[test]
fn an_empty_memo_reads_as_empty_text() {
    let Some(bytes) = member("fuels") else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let memo = blobs::resolve_at(&bytes, 3, 102).expect("the empty memo");
    assert_eq!(memo.kind, 0);
    assert!(memo.bytes.iter().all(|byte| *byte == 0));
    assert_eq!(memo.text(blobs::Width::Wide), Some(String::new()));
}

#[test]
fn fuel_notes_hold_text_and_binary_arrays_side_by_side() {
    let Some(bytes) = member("fuels") else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let fields = records::field_descriptors(&bytes);
    let name_at = records::index_of(&fields, "Name").expect("the name field");
    let notes_at = records::index_of(&fields, "Notes").expect("the notes field");
    let page = records::page_size(&bytes);
    let size = records::stride("fuels", &fields).expect("the fuels stride");
    let (base, _) = records::geometry_in(page, size).expect("the fuels geometry");
    let mut gas = None;
    for start in records::data_blocks_in(&bytes, page) {
        let block = &bytes[start..start + page];
        for row in records::live_records(block, base, &fields, size) {
            if row[name_at] == Value::Text("Natural Gas".to_string()) {
                let Value::Blob(blob) = row[notes_at] else {
                    panic!("a notes field did not decode as a blob");
                };
                gas = Some(blob);
            }
        }
    }
    let memo = blobs::resolve(&bytes, gas.expect("the Natural Gas notes reference"))
        .expect("the Natural Gas notes memo");
    assert_eq!(memo.kind, 5);
    assert_eq!(memo.bytes.len(), 73);
    assert_eq!(memo.bytes[..12], [1, 0, 0, 0, 21, 0, 0, 0, 0xdb, 0x0f, 0, 0]);
    assert_eq!(memo.bytes[72], 0, "a binary memo ends at its terminator");
    assert_eq!(memo.text(blobs::Width::Wide), None);
}

#[test]
fn the_parallel_effect_tables_point_at_the_same_kinds() {
    let Some(first) = member("scenarioeffects") else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let Some(second) = member("tedeffects") else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    for (index, block, kind) in [(1, 6, 4), (2, 6, 5), (6, 7, 5)] {
        let a = blobs::resolve_at(&first, index, block).expect("a scenarioeffects memo");
        let b = blobs::resolve_at(&second, index, block).expect("a tedeffects memo");
        assert_eq!((a.kind, b.kind), (kind, kind), "position {index} of heap page {block}");
        assert_eq!(a.bytes, b.bytes, "the parallel tables share the memo bytes");
    }
}


#[test]
fn memo_text_follows_kind_and_width() {
    use blobs::{Memo, Width};
    // Kind 3 is counted: the trailing word says how much text, odd for narrow bytes
    // and even for wide units. A five-unit text has no NUL unit, which is where the
    // old content guess truncated it.
    let water = Memo { kind: 3, bytes: vec![0x57, 0, 0x61, 0, 0x74, 0, 0x65, 0, 0x72, 0, 0, 0x0a, 0] };
    assert_eq!(water.text(Width::Wide), Some("Water".to_string()));
    assert_eq!(water.text(Width::Narrow), Some("Water".to_string()));
    let falsum = Memo { kind: 3, bytes: vec![0x46, 0, 0x61, 0, 0x6c, 0, 0x73, 0, 0x65, 0, 0, 0x0a, 0] };
    assert_eq!(falsum.text(Width::Wide), Some("False".to_string()));
    let rate = Memo { kind: 3, bytes: vec![0x31, 0, 0x33, 0, 0x2e, 0, 0x37, 0, 0x35, 0, 0, 0x0a, 0] };
    assert_eq!(rate.text(Width::Wide), Some("13.75".to_string()));
    // Narrow counted memos carry an odd count.
    let num = Memo { kind: 3, bytes: vec![0x36, 0x38, 0x36, 0x30, 0x37, 0, 0, 0, 0, 0, 0, 0x05, 0] };
    assert_eq!(num.text(Width::Narrow), Some("68607".to_string()));
    assert_eq!(num.text(Width::Wide), Some("68607".to_string()));
    // An even count with a two-byte narrow text reads narrow; a wide one reads wide.
    let thirty = Memo { kind: 3, bytes: vec![0x33, 0x30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x02, 0] };
    assert_eq!(thirty.text(Width::Narrow), Some("30".to_string()));
    let zero = Memo { kind: 3, bytes: vec![0x30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x02, 0] };
    assert_eq!(zero.text(Width::Wide), Some("0".to_string()));
    let neg = Memo { kind: 3, bytes: vec![0x2d, 0, 0x31, 0, 0, 0, 0, 0, 0, 0, 0, 0x04, 0] };
    assert_eq!(neg.text(Width::Wide), Some("-1".to_string()));
    // Kind 4 reads in the stated width: narrow fields hold narrow bytes.
    assert_eq!(Memo { kind: 4, bytes: b"68607".to_vec() }.text(Width::Narrow), Some("68607".to_string()));
    assert_eq!(Memo { kind: 4, bytes: b"{\\rtf1\\ansi".to_vec() }.text(Width::Narrow), Some("{\\rtf1\\ansi".to_string()));
    // Wide fields hold wide units, including the separator the expressions spell.
    assert_eq!(Memo { kind: 4, bytes: vec![b'0', 0, b'.', 0, b'2', 0] }.text(Width::Wide), Some("0.2".to_string()));
    let sep = Memo { kind: 4, bytes: vec![0x40, 0, 0xa4, 0, 0x29, 0, 0] };
    assert_eq!(sep.text(Width::Wide), Some("@\u{a4})".to_string()));
    // Kind 5 is binary and kind 0 is empty, in either width.
    assert_eq!(Memo { kind: 0, bytes: vec![0; 12] }.text(Width::Wide), Some(String::new()));
    assert_eq!(Memo { kind: 0, bytes: vec![0; 12] }.text(Width::Narrow), Some(String::new()));
    assert_eq!(Memo { kind: 5, bytes: vec![2, 0, 0, 0, 20, 0, 0, 0, 0x94, 0x19, 0, 0, 0] }.text(Width::Wide), None);
    assert_eq!(Memo { kind: 5, bytes: vec![9, 0, 0, 0, 97, 0, 0, 0, 1, 0, 0, 0, 0] }.text(Width::Narrow), None);
}

#[test]
fn blob_field_types_have_known_widths() {
    let Some(tables) = tables() else { eprintln!("note: vendor area not found"); return; };
    let mut types = std::collections::BTreeSet::new();
    for (_, bytes) in &tables {
        for field in records::field_descriptors(bytes) {
            if field.type_name.starts_with("nxtBlob") { types.insert(field.type_name.clone()); }
        }
    }
    let types: Vec<String> = types.into_iter().collect();
    assert_eq!(types, vec!["nxtBlob", "nxtBlobMemo", "nxtBlobWideMemo"]);
    assert_eq!(blobs::width_of("nxtBlob"), blobs::Width::Narrow);
    assert_eq!(blobs::width_of("nxtBlobMemo"), blobs::Width::Narrow);
    assert_eq!(blobs::width_of("nxtBlobWideMemo"), blobs::Width::Wide);
    let Some(bytes) = member("scenariodata") else { eprintln!("note: vendor area not found"); return; };
    assert_eq!(blobs::field_width(&bytes, "Expression"), Some(blobs::Width::Wide));
    let Some(ted) = member("tedenvdata") else { eprintln!("note: vendor area not found"); return; };
    assert_eq!(blobs::field_width(&ted, "UncontrolledExpression"), Some(blobs::Width::Narrow));
    assert_eq!(blobs::field_width(&bytes, "NoSuchField"), None);
}
/// Every live blob reference with its field type, as (table, field, type, page, index).
fn live_refs(tables: &[(String, Vec<u8>)]) -> Vec<(String, String, String, u64, u64)> {
    let mut out = Vec::new();
    for (name, bytes) in tables {
        let fields = records::field_descriptors(bytes);
        let at: Vec<usize> = fields.iter().enumerate()
            .filter(|(_, f)| f.type_name.starts_with("nxtBlob"))
            .map(|(i, _)| i).collect();
        if at.is_empty() { continue; }
        let page = records::page_size(bytes);
        let data = records::data_blocks_in(bytes, page);
        if data.is_empty() { continue; }
        let Some(size) = records::stride(name, &fields) else { continue; };
        let Some((base, _)) = records::geometry_in(page, size) else { continue; };
        for start in data {
            let block = &bytes[start..start + page];
            for row in records::live_records(block, base, &fields, size) {
                for i in &at {
                    if let Value::Blob(blob) = row[*i] {
                        if blob == 0 { continue; }
                        out.push((name.clone(), fields[*i].name.clone(), fields[*i].type_name.clone(), blob & 0xffff_ffff, blob >> 32));
                    }
                }
            }
        }
    }
    out
}

/// Whether bytes read as strict narrow text up to their terminator.
fn narrow_shape(payload: &[u8]) -> bool {
    let end = payload.iter().position(|b| *b == 0).unwrap_or(payload.len());
    let text = &payload[..end];
    !text.is_empty() && text.iter().all(|b| *b == 9 || *b == 10 || *b == 13 || (32..=126).contains(b))
}

/// Whether units read as wide text up to their terminator, in the area wide set.
fn wide_shape(payload: &[u8]) -> bool {
    let mut at = 0;
    let mut chars = 0;
    while at + 2 <= payload.len() {
        let unit = u16::from_le_bytes([payload[at], payload[at + 1]]);
        if unit == 0 { break; }
        let Some(_) = char::from_u32(unit as u32) else { return false; };
        if !(unit == 9 || unit == 10 || unit == 13 || (32..127).contains(&unit)
            || unit == 0xa4 || unit == 0x0b || unit == 0x0e || unit == 0x0f)
        { return false; }
        chars += 1;
        at += 2;
    }
    chars > 0
}

#[test]
fn kind3_counted_rule_holds_area_wide() {
    let Some(tables) = tables() else { eprintln!("note: vendor area not found"); return; };
    let mut count = 0;
    let mut tens = 0;
    for (name, bytes) in &tables {
        let page = records::page_size(bytes);
        for pageno in blobs::heap_pages(bytes) {
            let block = &bytes[pageno * page..(pageno + 1) * page];
            let stated = heap::stated(block).unwrap_or(0);
            for ix in 1..=stated as u64 {
                let Some(memo) = blobs::resolve_at(bytes, ix, pageno as u64) else { continue; };
                if memo.kind != 3 { continue; }
                count += 1;
                assert_eq!(memo.bytes.len(), 13, "{name} pg={pageno} ix={ix}: counted memos hold thirteen bytes");
                let w = u16::from_le_bytes([memo.bytes[11], memo.bytes[12]]) as usize;
                assert!((1..=10).contains(&w), "{name} pg={pageno} ix={ix}: count {w} in range");
                if w == 10 { tens += 1; }
                let end = memo.bytes.iter().position(|b| *b == 0).unwrap_or(memo.bytes.len());
                assert!(end <= w, "{name} pg={pageno} ix={ix}: text never runs past its count");
                if end == w {
                    assert!(memo.bytes[..w].iter().all(|b| (32..=126).contains(b) || *b == 9 || *b == 10 || *b == 13));
                    assert_eq!(memo.bytes[w], 0, "{name} pg={pageno} ix={ix}: a terminator pads the narrow text");
                } else {
                    assert_eq!(w % 2, 0, "{name} pg={pageno} ix={ix}: wide counts are even");
                    for c in 0..w / 2 {
                        let u = u16::from_le_bytes([memo.bytes[2 * c], memo.bytes[2 * c + 1]]);
                        assert!((32..127).contains(&(u as u32)) || u == 9 || u == 10 || u == 13, "{name} pg={pageno} ix={ix}: wide units are ASCII");
                    }
                    assert!(memo.bytes[w..11].iter().all(|b| *b == 0), "{name} pg={pageno} ix={ix}: zeros pad to the count");
                }
                assert!(memo.text(blobs::Width::Wide).is_some());
                assert!(memo.text(blobs::Width::Narrow).is_some());
            }
        }
    }
    assert_eq!(count, 2607, "counted memos area-wide");
    assert_eq!(tens, 51, "five-unit texts with no NUL unit");
}
#[test]
fn kind4_width_is_the_field_type() {
    let Some(tables) = tables() else { eprintln!("note: vendor area not found"); return; };
    let by_name: std::collections::HashMap<&str, &[u8]> = tables.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
    let refs = live_refs(&tables);
    assert_eq!(refs.len(), 4547, "non-zero blob references in the shipped area");
    let mut narrow = 0;
    let mut wide = 0;
    let mut binary = 0;
    let mut empty = 0;
    for (table, field, ftype, ix, pg) in &refs {
        let bytes = by_name[table.as_str()];
        let memo = blobs::resolve(bytes, blobs::join(*ix, *pg)).expect("every live reference resolves");
        let width = blobs::width_of(ftype);
        match memo.kind {
            0 => { empty += 1; assert_eq!(memo.text(width), Some(String::new())); }
            3 => { assert!(memo.text(width).is_some()); }
            4 => {
                assert!(memo.text(width).is_some(), "{table} {field} pg={pg} ix={ix} reads in field width");
                match width {
                    blobs::Width::Narrow => { narrow += 1; assert!(narrow_shape(&memo.bytes), "{table} {field} pg={pg} ix={ix} holds narrow bytes"); }
                    blobs::Width::Wide => { wide += 1; assert!(wide_shape(&memo.bytes), "{table} {field} pg={pg} ix={ix} holds wide units"); }
                }
            }
            _ => { binary += 1; assert_eq!(memo.text(width), None); }
        }
        let _ = field;
    }
    assert_eq!((narrow, wide, binary, empty), (1214, 467, 256, 3), "live kind-4 by field width, kind-3 and kind-5 and kind-0");
    // Spot checks: a narrow note, a wide note, the separator, the dirt.
    let area = by_name["areadata"];
    let note = blobs::resolve_at(area, 1, 6).expect("the area note");
    assert!(note.text(blobs::Width::Narrow).expect("text").starts_with("Sample LEAP data set for fictional"));
    let constants = by_name["constants"];
    let gas = blobs::resolve_at(constants, 8, 5).expect("the Methane note");
    assert_eq!(gas.kind, 4);
    assert_eq!(gas.text(blobs::Width::Wide), Some("Methane\u{f}".to_string()));
    let scen = by_name["scenariodata"];
    let sep = blobs::resolve_at(scen, 26, 5).expect("the separator expression");
    assert_eq!(sep.text(blobs::Width::Wide), Some("@F007(\u{a4}2030,90\u{a4})".to_string()));
    let dol = blobs::resolve_at(scen, 55, 5).expect("the Dollars expression");
    assert_eq!(dol.text(blobs::Width::Wide), Some("Dollars\u{b}".to_string()));
}
#[test]
fn superseded_memos_carry_a_zeroed_first_byte() {
    let Some(tables) = tables() else { eprintln!("note: vendor area not found"); return; };
    let by_name: std::collections::HashMap<&str, &[u8]> = tables.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
    let live: std::collections::HashSet<(String, u64, u64)> = live_refs(&tables).into_iter().map(|(t, _, _, ix, pg)| (t, ix, pg)).collect();
    let mut zeroed = 0;
    let mut kinds = std::collections::BTreeMap::new();
    for (name, bytes) in &tables {
        let page = records::page_size(bytes);
        for pageno in blobs::heap_pages(bytes) {
            let block = &bytes[pageno * page..(pageno + 1) * page];
            let stated = heap::stated(block).unwrap_or(0);
            for ix in 1..=stated as u64 {
                if blobs::tombstoned(bytes, ix, pageno as u64) != Some(true) { continue; }
                zeroed += 1;
                let memo = blobs::resolve_at(bytes, ix, pageno as u64).expect("the zeroed memo");
                if memo.kind == 4 {
                    assert!(!live.contains(&(name.clone(), ix, pageno as u64)), "{name} pg={pageno} ix={ix}: no live row points at a zeroed memo");
                }
                *kinds.entry(memo.kind).or_insert(0) += 1;
                assert!(memo.text(blobs::Width::Wide).is_some() || memo.text(blobs::Width::Narrow).is_some(), "{name} pg={pageno} ix={ix}: the text survives past the zero");
            }
        }
    }
    assert_eq!(zeroed, 225, "memos with a zeroed first payload byte");
    assert_eq!(kinds, std::collections::BTreeMap::from([(0, 3), (4, 222)]), "only empty and wide-text memos");
    // Spot checks: a long HTML note and a short expression read past the zero.
    let constants = by_name["constants"];
    let html = blobs::resolve_at(constants, 1, 6).expect("the old html note");
    assert!(html.text(blobs::Width::Wide).expect("text").starts_with("%3Cspan"));
    let scen = by_name["scenariodata"];
    let nine = blobs::resolve_at(scen, 1, 25).expect("the old expression");
    assert_eq!(nine.text(blobs::Width::Wide), Some("9, 4.3, 2020, 4.5\u{a4})".to_string()));
}

#[test]
fn empty_memos_are_live_and_read_empty() {
    let Some(tables) = tables() else { eprintln!("note: vendor area not found"); return; };
    let live: std::collections::HashSet<(String, u64, u64)> = live_refs(&tables).into_iter().map(|(t, _, _, ix, pg)| (t, ix, pg)).collect();
    let mut found = Vec::new();
    for (name, bytes) in &tables {
        let page = records::page_size(bytes);
        for pageno in blobs::heap_pages(bytes) {
            let block = &bytes[pageno * page..(pageno + 1) * page];
            let stated = heap::stated(block).unwrap_or(0);
            for ix in 1..=stated as u64 {
                let Some(memo) = blobs::resolve_at(bytes, ix, pageno as u64) else { continue; };
                if memo.kind != 0 { continue; }
                assert_eq!(memo.bytes, vec![0; 12], "{name} pg={pageno} ix={ix}: twelve zero bytes");
                assert_eq!(memo.text(blobs::Width::Wide), Some(String::new()));
                assert!(live.contains(&(name.clone(), ix, pageno as u64)), "{name} pg={pageno} ix={ix}: live rows point at empty notes");
                found.push((name.clone(), pageno, ix));
            }
        }
    }
    assert_eq!(found.len(), 3, "empty memos area-wide");
}
/// The old content guess, kept here as the oracle the stated rule is measured against:
/// wide wins when the units until the terminator are ASCII, narrow when the bytes are.
fn old_guess(memo: &blobs::Memo) -> Option<String> {
    fn ascii(u: u16) -> bool { u == 9 || u == 10 || u == 13 || (32..127).contains(&u) }
    fn wide(payload: &[u8]) -> Option<String> {
        let mut out = String::new();
        let mut at = 0;
        while at + 2 <= payload.len() {
            let unit = u16::from_le_bytes([payload[at], payload[at + 1]]);
            if unit == 0 { break; }
            let c = char::from_u32(unit as u32)?;
            if !ascii(unit) { return None; }
            out.push(c);
            at += 2;
        }
        (!out.is_empty()).then_some(out)
    }
    fn narrow(payload: &[u8]) -> Option<String> {
        let end = payload.iter().position(|b| *b == 0).unwrap_or(payload.len());
        let text = &payload[..end];
        if text.is_empty() || !text.iter().all(|b| *b == 9 || *b == 10 || *b == 13 || (32..=126).contains(b)) { return None; }
        Some(text.iter().map(|b| *b as char).collect())
    }
    if memo.bytes.iter().all(|b| *b == 0) { return Some(String::new()); }
    if let Some(w) = wide(&memo.bytes) { return Some(w); }
    narrow(&memo.bytes)
}

#[test]
fn stated_rule_matches_the_guess_where_it_reads() {
    let Some(tables) = tables() else { eprintln!("note: vendor area not found"); return; };
    let by_name: std::collections::HashMap<&str, &[u8]> = tables.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
    let refs = live_refs(&tables);
    let live: std::collections::HashSet<(String, u64, u64)> = refs.iter().map(|(t, _, _, ix, pg)| (t.clone(), *ix, *pg)).collect();
    // Live memos read in field width. The guess agrees everywhere but two classes:
    // five-unit counted texts (no NUL unit to stop at) and wide texts past ASCII.
    let mut same = 0;
    let mut counted = 0;
    let mut past = 0;
    for (table, _, ftype, ix, pg) in &refs {
        let memo = blobs::resolve(by_name[table.as_str()], blobs::join(*ix, *pg)).expect("resolve");
        let new = memo.text(blobs::width_of(ftype));
        let old = old_guess(&memo);
        if new == old { same += 1; continue; }
        if memo.kind == 3 {
            counted += 1;
            assert_eq!((memo.bytes[memo.bytes.len() - 2], memo.bytes[memo.bytes.len() - 1]), (10u8, 0u8), "{table} pg={pg} ix={ix}: counted overrides count five");
        } else {
            past += 1;
            assert_eq!(memo.kind, 4);
            assert!(wide_shape(&memo.bytes), "{table} pg={pg} ix={ix}: past-ASCII overrides read wide");
        }
    }
    assert_eq!((same, counted, past), (4433, 50, 64), "live partition");
    // Dead memos read by shape where a field width no longer exists.
    let mut dsame = 0;
    let mut dfp = 0;
    let mut dpast = 0;
    for (name, bytes) in &tables {
        let page = records::page_size(bytes);
        for pageno in blobs::heap_pages(bytes) {
            let block = &bytes[pageno * page..(pageno + 1) * page];
            let stated = heap::stated(block).unwrap_or(0);
            for ix in 1..=stated as u64 {
                if live.contains(&(name.clone(), ix, pageno as u64)) { continue; }
                let memo = blobs::resolve_at(bytes, ix, pageno as u64).expect("the dead memo");
                let old = old_guess(&memo);
                if blobs::tombstoned(bytes, ix, pageno as u64) == Some(true) && memo.kind == 4 {
                    assert_eq!(old_guess(&memo), old, "{name} pg={pageno} ix={ix}: the walk skips the zero for both");
                    assert!(memo.text(blobs::Width::Wide).is_some() || memo.text(blobs::Width::Narrow).is_some());
                    dsame += 1;
                    continue;
                }
                let new = memo.text(if wide_shape(&memo.bytes) { blobs::Width::Wide } else { blobs::Width::Narrow });
                if new == old { dsame += 1; continue; }
                if memo.kind == 5 { dfp += 1; assert_eq!(new, None); continue; }
                dpast += 1;
                assert_eq!(memo.kind, 4);
                assert!(wide_shape(&memo.bytes));
            }
        }
    }
    assert_eq!((dsame, dfp, dpast), (931, 26, 1), "dead partition");
}
#[test]
fn kind5_memos_are_segment_directories() {
    let Some(tables) = tables() else { eprintln!("note: vendor area not found"); return; };
    let by_name: std::collections::HashMap<&str, &[u8]> = tables.iter().map(|(n, b)| (n.as_str(), b.as_slice())).collect();
    assert_eq!(tables.len(), 86, "tables in the shipped area");
    let refs = live_refs(&tables);
    let live: std::collections::HashSet<(String, u64, u64)> = refs.iter().map(|(t, _, _, ix, pg)| (t.clone(), *ix, *pg)).collect();
    let mut memos = 0;
    let mut triples = 0;
    let mut max_at = 0;
    let mut max_op = 0;
    let mut range: std::collections::BTreeMap<String, (u32, u32)> = std::collections::BTreeMap::new();
    let mut small: std::collections::BTreeMap<u32, std::collections::BTreeSet<String>> = std::collections::BTreeMap::new();
    let mut live_plain = 0;
    let mut shadowed = 0;
    let mut unshadowed = Vec::new();
    let mut dead_twos = 0;
    let mut mutones: std::collections::BTreeSet<(String, u32, u32)> = std::collections::BTreeSet::new();
    let mut all: std::collections::BTreeMap<(String, u64, u64), (bool, Vec<blobs::Segment>)> = std::collections::BTreeMap::new();
    for (name, bytes) in &tables {
        let page = records::page_size(bytes);
        for pageno in blobs::heap_pages(bytes) {
            let block = &bytes[pageno * page..(pageno + 1) * page];
            let stated = heap::stated(block).unwrap_or(0);
            for ix in 1..=stated as u64 {
                let Some(memo) = blobs::resolve_at(bytes, ix, pageno as u64) else { continue; };
                if memo.kind != 5 { continue; }
                let segs = memo.segments().expect("every kind-5 memo is well formed");
                memos += 1;
                triples += segs.len();
                let is_live = live.contains(&(name.clone(), ix, pageno as u64));
                all.insert((name.clone(), pageno as u64, ix), (is_live, segs.clone()));
                for s in &segs {
                    max_at = max_at.max(s.at);
                    max_op = max_op.max(s.op);
                    let e = range.entry(name.clone()).or_insert((s.id, s.id));
                    e.0 = e.0.min(s.id);
                    e.1 = e.1.max(s.id);
                    if s.id <= 8 { small.entry(s.id).or_default().insert(name.clone()); }
                    if s.op == 1 { mutones.insert((name.clone(), s.id, s.at)); }
                }
                if is_live && segs.iter().any(|s| s.op == 1 || s.op == 2) { live_plain += 1; }
                if !is_live && segs.iter().any(|s| s.op == 2) { dead_twos += 1; }
            }
        }
    }
    assert_eq!((memos, triples), (449, 950), "directories and entries area-wide");
    assert!(max_at > 60000, "offsets pass any row or field id: {max_at}");
    assert_eq!(max_op, 170, "ops pass the table count");
    for s in all.values().flat_map(|(_, segs)| segs) { assert!(s.chunk() <= 16, "chunks stay small"); }
    let range: Vec<(String, (u32, u32))> = range.into_iter().collect();
    assert_eq!(range, vec![("constants", (5, 15)), ("fuels", (19, 103)), ("masterstructure", (6, 7)), ("refs", (17, 66)), ("scenariodata", (13, 25)), ("scenarioeffects", (6, 260)), ("scenarios", (13, 20)), ("tedeffects", (6, 260)), ("tedtechdata", (7, 184))].into_iter().map(|(t, r)| (t.to_string(), r)).collect::<Vec<_>>());
    assert!(small[&6].len() >= 3 && small[&7].len() >= 3, "low numbers repeat across tables: {small:?}");
    // A live op-2 entry shadows a dead op-1 entry with the same numbers, 188 of 192.
    let mut twos = 0;
    for ((t, _, _), (is_live, segs)) in &all {
        if !is_live { continue; }
        for s in segs {
            if s.op != 2 { continue; }
            twos += 1;
            let hit = all.iter().any(|((dt, _, _), (dlive, dsegs))| !dlive && dt == t && dsegs.iter().any(|d| d.op == 1 && d.id == s.id && d.at == s.at));
            if hit { shadowed += 1; } else { unshadowed.push((t.clone(), s.id, s.at)); }
        }
    }
    assert_eq!(twos, 191, "live current entries");
    assert_eq!(shadowed, 188, "with a dead plain shadow");
    assert_eq!(unshadowed, vec![("scenarios".to_string(), 14, 1558), ("scenarios".to_string(), 15, 1654), ("scenarios".to_string(), 16, 3476)], "without a dead plain shadow");
    assert!(unshadowed.iter().all(|(t, _, _)| t == "scenarios"), "the four sit in one table");
    assert_eq!(dead_twos, 1, "one twice-superseded directory keeps a current entry");
    assert_eq!(live_plain + 1, all.iter().filter(|(_, (l, _))| *l).count(), "one live directory holds only op 3");
    let _ = (by_name, mutones);
}
#[test]
fn current_accounts_directories_beside_baseline_text() {
    let Some(bytes) = member("scenariodata") else { eprintln!("note: vendor area not found"); return; };
    let rows = model::scenarios(&bytes);
    // Branch 595 Passenger, variable 2027: Current Accounts holds a directory,
    // Baseline holds a function call, and a dead memo holds the older directory.
    let dir = blobs::resolve_at(&bytes, 169, 13).expect("the directory");
    assert_eq!(dir.segments(), Some(vec![blobs::Segment { op: 2, id: 19, at: 126 }]));
    let row = rows.iter().find(|r| r.branch == 595 && r.variable == 2027 && r.scenario == 1).expect("the row");
    assert_eq!((row.memo_index, row.memo_block), (169, 13));
    assert_ne!((dir.segments().expect("segs")[0].id, dir.segments().expect("segs")[0].at), (595, 2027), "not branch and variable");
    let sib = rows.iter().find(|r| r.branch == 595 && r.variable == 2027 && r.scenario == 2).expect("the sibling");
    let text = blobs::expression_text(&bytes, sib).expect("sibling text");
    assert!(text.starts_with("@F041("), "{text}");
    assert_eq!(text.chars().count(), 35);
    let old = blobs::resolve_at(&bytes, 2, 19).expect("the older directory");
    assert_eq!(old.segments(), Some(vec![blobs::Segment { op: 170, id: 13, at: 61 }, blobs::Segment { op: 1, id: 19, at: 126 }]));
    assert_eq!(blobs::expression_text(&bytes, row), None);
    // Branch 831 HFC125, variable 991: the same shape.
    let dir = blobs::resolve_at(&bytes, 113, 21).expect("the directory");
    assert_eq!(dir.segments(), Some(vec![blobs::Segment { op: 2, id: 25, at: 252 }]));
    let row = rows.iter().find(|r| r.branch == 831 && r.variable == 991 && r.scenario == 1).expect("the row");
    assert_eq!((row.memo_index, row.memo_block), (113, 21));
    let sib = rows.iter().find(|r| r.branch == 831 && r.variable == 991 && r.scenario == 2).expect("the sibling");
    let text = blobs::expression_text(&bytes, sib).expect("sibling text");
    assert!(text.starts_with("@F037("), "{text}");
    assert_eq!(text.chars().count(), 30);
    let old = blobs::resolve_at(&bytes, 2, 25).expect("the older directory");
    assert_eq!(old.segments(), Some(vec![blobs::Segment { op: 114, id: 21, at: 213 }, blobs::Segment { op: 1, id: 25, at: 252 }]));
    assert_eq!(blobs::expression_text(&bytes, row), None);
}

#[test]
fn scenario_effect_blocks_157_and_161_hold_dead_hex_text() {
    let Some(first) = member("scenarioeffects") else { eprintln!("note: vendor area not found"); return; };
    let Some(second) = member("tedeffects") else { eprintln!("note: vendor area not found"); return; };
    let Some(all) = tables() else { eprintln!("note: vendor area not found"); return; };
    let live: std::collections::HashSet<(u64, u64)> = live_refs(&all).into_iter().filter(|(t, _, _, _, _)| t == "scenarioeffects" || t == "tedeffects").map(|(_, _, _, ix, pg)| (ix, pg)).collect();
    for (pg, head) in [(157u64, "00000054"), (161u64, "25000700")] {
        for (bytes, table) in [(&first, "scenarioeffects"), (&second, "tedeffects")] {
            let memo = blobs::resolve_at(bytes, 1, pg).expect("the long memo");
            assert_eq!(memo.kind, 4, "{table} pg={pg}");
            assert!(!live.contains(&(1u64, pg)), "{table} pg={pg}: no live row points at it");
            let text = memo.text(blobs::Width::Narrow).expect("narrow text");
            assert_eq!(text.len(), 4059, "{table} pg={pg}: the longest memos the heap holds");
            assert!(text.starts_with(head), "{table} pg={pg}");
        }
    }
    assert_eq!(blobs::resolve_at(&first, 1, 157).expect("a").bytes, blobs::resolve_at(&second, 1, 157).expect("b").bytes, "mirrors share the bytes");
    assert_eq!(blobs::resolve_at(&first, 1, 161).expect("a").bytes, blobs::resolve_at(&second, 1, 161).expect("b").bytes, "mirrors share the bytes");
    // Block 157 is hex digits and line breaks: decoded, it carries wide map labels.
    let raw = blobs::resolve_at(&first, 1, 157).expect("a").bytes;
    let text: String = raw.iter().take_while(|b| **b != 0).map(|b| *b as char).collect();
    assert!(text.chars().all(|c| c.is_ascii_hexdigit() || c == (13 as char) || c == (10 as char)));
    let stripped: String = text.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    let even = stripped.len() - stripped.len() % 2;
    let mut bin = Vec::new();
    let hex: Vec<u8> = stripped.chars().take(even).map(|c| c.to_digit(16).expect("hex") as u8).collect();
    for pair in hex.chunks(2) { bin.push(pair[0] * 16 + pair[1]); }
    assert!(![[0x1f, 0x8b], [0x50, 0x4b], [0x42, 0x4d], [0x89, 0x50], [0x47, 0x49], [0xd7, 0xcd], [0x01, 0x00]].iter().any(|m| bin.starts_with(m)), "no common image or archive magic");
    let mut labels = Vec::new();
    let mut at = 0;
    while at + 8 <= bin.len() {
        let mut run = String::new();
        let mut j = at;
        while j + 2 <= bin.len() {
            let unit = u16::from_le_bytes([bin[j], bin[j + 1]]);
            if unit == 0 || unit >= 127 || unit < 32 { break; }
            run.push(char::from_u32(unit as u32).expect("ascii"));
            j += 2;
        }
        if run.len() >= 4 { labels.push(run); }
        at = if j > at { j + 2 } else { at + 1 };
    }
    assert!(labels.iter().any(|l| l == "North America"), "map labels: {labels:?}");
    assert!(labels.iter().any(|l| l == "Central America"), "map labels: {labels:?}");
    // Block 161 is a hex head with an RTF tail citing a soil map.
    let one = blobs::resolve_at(&first, 1, 161).expect("a").bytes;
    let text: String = one.iter().map(|b| *b as char).collect();
    assert!(text.contains("Oldeman"), "the soil citation");
    assert!(text.contains("\\par"), "the RTF tail");
}
