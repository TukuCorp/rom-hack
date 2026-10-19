//! The Rust dictionary reader over every table of the shipped area, not only the fixtures.
//!
//! `NX1_RECORD_LAYOUT` is what the capture tool reads out of each table's dictionary. The fixture
//! tests run `records::field_descriptors` on four of those dictionaries; this one runs it on all
//! of them, straight out of the vendor zip through the crate's own archive reader, and holds the
//! answer to the oracle field by field. Every table in the area places now, the five written in
//! 8192-byte pages included, and the page a table states is the page its blocks are read in.
//!
//! The area ships with LEAP, so like `vendor_e2e` this prints a note and passes without it.

use leap_rs::container;
use leap_rs::oracle_records::NX1_RECORD_LAYOUT;
use leap_rs::records;

const AREA: &str = "C:/Program Files/LEAP/Freedonia.zip";

/// The five tables whose files state 8192-byte pages, with the field count their dictionaries
/// read and the page size the header word at 0x14 states. PluginProperties, Plugins and
/// emissionmappings hold no data block at all; refs and uservardata do, and their records tile
/// back from 8188 rather than the 4092 every other table's records tile back from.
const BIG_PAGE_TABLES: &[(&str, usize, usize)] = &[
    ("PluginProperties", 12, 8192),
    ("Plugins", 20, 8192),
    ("emissionmappings", 27, 8192),
    ("refs", 17, 8192),
    ("uservardata", 37, 8192),
];

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

#[test]
fn the_reader_places_every_table_the_oracle_places() {
    let Some(tables) = tables() else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    assert_eq!(tables.len(), 86, "tables in the shipped area");
    assert_eq!(NX1_RECORD_LAYOUT.len(), 86, "every table in the area places now");

    let mut disagree = Vec::new();
    for (name, bytes) in &tables {
        let got: Vec<(String, String, u32, u32, u32)> = records::field_descriptors(bytes)
            .into_iter()
            .map(|f| (f.name, f.type_name, f.declared_length, f.offset, f.size))
            .collect();
        let want: Vec<(String, String, u32, u32, u32)> = NX1_RECORD_LAYOUT
            .iter()
            .find(|(n, ..)| n == name)
            .map(|(.., fields)| {
                fields
                    .iter()
                    .map(|(n, t, d, o, s)| (n.to_string(), t.to_string(), *d, *o, *s))
                    .collect()
            })
            .expect("a layout for every table");
        if got != want {
            disagree.push(format!("{name}: reader {} fields, oracle {}", got.len(), want.len()));
        }
        if let Some((_, count, page)) = BIG_PAGE_TABLES.iter().find(|(n, _, _)| n == name) {
            assert_eq!(records::page_size(bytes), *page, "{name}: the page the file states");
            assert_eq!(got.len(), *count, "{name}: the dictionary reads whole");
        }
    }
    assert!(disagree.is_empty(), "reader and oracle disagree on: {disagree:#?}");

    // Every other table is written in the 4 KiB pages this crate's default assumes.
    for (name, bytes) in &tables {
        if BIG_PAGE_TABLES.iter().any(|(n, _, _)| n == name) {
            continue;
        }
        assert_eq!(records::page_size(bytes), records::BLOCK, "{name}");
    }
}

#[test]
fn every_data_block_has_a_slot_map() {
    let Some(tables) = tables() else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let mut short = std::collections::BTreeSet::new();
    let mut blocks = 0;
    for (name, bytes) in &tables {
        let Some((_, _, _, _, has_data, _)) = NX1_RECORD_LAYOUT.iter().find(|(n, ..)| n == name)
        else {
            continue;
        };
        if !has_data {
            continue;
        }
        let fields = records::field_descriptors(bytes);
        // The reader's own stride for the table, not the oracle's, and the page size the file
        // states: the sweep is what holds the rule and the measurement against every block in
        // the area, including the big-page files whose records tile back from 8188.
        let size = records::stride(name, &fields).expect("a stride for a placed table");
        let page = records::page_size(bytes);
        let (base, cap) =
            records::geometry_in(page, size).expect("a geometry for a placed table");
        for at in records::data_blocks_in(bytes, page) {
            let block = &bytes[at..at + page];
            blocks += 1;
            match records::slot_map(block, base, cap) {
                Some(map) => {
                    let live = records::header_live_count(block).unwrap() as usize;
                    assert_eq!(map.iter().filter(|b| **b).count(), live, "{name}");
                    assert_eq!(
                        records::live_records(block, base, &fields, size).len(),
                        live,
                        "{name}"
                    );
                }
                None => {
                    short.insert(name.as_str());
                }
            }
        }
    }
    assert_eq!(blocks, 2191, "data blocks in the placed tables");
    assert!(
        short.is_empty(),
        "tables whose blocks the slot map cannot account for: {short:?}"
    );
}
#[test]
fn the_dictionary_states_the_field_count_it_carries() {
    // `OriginalFieldCount` is the one number in the file that could still witness a wider
    // dictionary: had fields been dropped since the records were written, the stated count
    // would exceed the placed descriptors. It never does -- every table that states it states
    // the placed count, including all twenty-eight measured tables -- so the extra stride is
    // not fields the dictionary dropped. Four tables state no count at all.
    let Some(tables) = tables() else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let mut without = Vec::new();
    for (name, bytes) in &tables {
        let fields = records::field_descriptors(bytes);
        let tag = b"OriginalFieldCount=";
        let hits: Vec<usize> = bytes
            .windows(tag.len())
            .enumerate()
            .filter(|(_, w)| *w == tag)
            .map(|(i, _)| i)
            .collect();
        assert!(hits.len() <= 1, "{name}: the count appears more than once");
        match hits.first() {
            None => without.push(name.as_str()),
            Some(at) => {
                let mut end = at + tag.len();
                while bytes.get(end).is_some_and(|b| b.is_ascii_digit()) {
                    end += 1;
                }
                let stated: usize = std::str::from_utf8(&bytes[at + tag.len()..end])
                    .expect("a numeric field count")
                    .parse()
                    .expect("a numeric field count");
                assert_eq!(stated, fields.len(), "{name}: the dictionary states its field count");
            }
        }
        if records::measured_stride(name).is_some() {
            assert_eq!(hits.len(), 1, "{name}: a measured table states its field count");
        }
    }
    without.sort_unstable();
    assert_eq!(without, ["MapUpdate", "PluginProperties", "branchreferences", "version"]);
}

#[test]
fn the_padding_past_the_rule_holds_no_data() {
    // For every measured table the bytes between the rule's end and the block-pinned stride
    // are zero in every slot of every data block. Had the dictionary dropped trailing fields,
    // their data would still sit here; it does not, so the extra stride is padding, not fields.
    let Some(tables) = tables() else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let mut checked: Vec<&str> = Vec::new();
    let mut slots = 0;
    for (name, bytes) in &tables {
        let Some(size) = records::measured_stride(name) else {
            continue;
        };
        let fields = records::field_descriptors(bytes);
        let rule = records::record_size(&fields).expect("a rule for a placed table");
        assert!(rule < size, "{name}");
        let page = records::page_size(bytes);
        let (base, _) = records::geometry_in(page, size).expect("a geometry for a placed table");
        let mut table_slots = 0;
        for at in records::data_blocks_in(bytes, page) {
            let block = &bytes[at..at + page];
            let count = (page - 4 - base) / size;
            for k in 0..count {
                let gap = &block[base + k * size + rule..base + (k + 1) * size];
                assert!(gap.iter().all(|b| *b == 0), "{name} block {at} slot {k}");
                table_slots += 1;
            }
        }
        assert!(table_slots > 0, "{name}: a measured table holds data blocks");
        checked.push(name.as_str());
        slots += table_slots;
    }
    checked.sort_unstable();
    assert_eq!(checked.len(), 28, "measured tables: {checked:?}");
    assert_eq!(slots, 4517, "measured slots with zeroed padding");
}

#[test]
fn the_free_list_head_accounts_for_every_free_slot() {
    // The u16 at 0x1c is the head of the block's free-slot list: the free slot most recently
    // freed (or the lowest never-allocated one), one-based, with each free slot's first u16
    // linking the next and the last holding zero; a full block holds zero. Walking the chain
    // from the head visits exactly the slots the map leaves free, in every data block.
    let Some(tables) = tables() else {
        eprintln!("note: {AREA} not found, sweep skipped");
        return;
    };
    let mut blocks = 0;
    let mut full = 0;
    let mut chained = 0;
    for (name, bytes) in &tables {
        let Some((_, _, _, _, has_data, _)) =
            NX1_RECORD_LAYOUT.iter().find(|(n, ..)| n == name)
        else {
            continue;
        };
        if !has_data {
            continue;
        }
        let fields = records::field_descriptors(bytes);
        let size = records::stride(name, &fields).expect("a stride for a placed table");
        let page = records::page_size(bytes);
        let (base, cap) =
            records::geometry_in(page, size).expect("a geometry for a placed table");
        for at in records::data_blocks_in(bytes, page) {
            let block = &bytes[at..at + page];
            blocks += 1;
            let live = records::header_live_count(block).unwrap() as usize;
            let head = records::free_list_head(block).unwrap();
            let map =
                records::slot_map(block, base, cap).expect("the map covers every block");
            assert_eq!(
                map.iter().filter(|b| **b).count(),
                live,
                "{name} block {at}"
            );
            let free: Vec<usize> = (0..cap).filter(|k| !map[*k]).collect();
            if live == cap {
                assert_eq!(head, 0, "{name} block {at}: a full block holds no head");
                assert!(free.is_empty(), "{name} block {at}");
                full += 1;
                continue;
            }
            assert_ne!(
                head, 0,
                "{name} block {at}: a partial block links its free slots"
            );
            assert!(
                !map[(head - 1) as usize],
                "{name} block {at}: the head is a free slot"
            );
            let mut seen = Vec::new();
            let mut next = head;
            while next != 0 {
                let k = (next - 1) as usize;
                assert!(k < cap, "{name} block {at}: link {next} runs past the block");
                assert!(
                    !map[k],
                    "{name} block {at}: link {next} lands on a live slot"
                );
                assert!(
                    !seen.contains(&k),
                    "{name} block {at}: link {next} repeats"
                );
                seen.push(k);
                let slot = &block[base + k * size..base + (k + 1) * size];
                next = u16::from_le_bytes([slot[0], slot[1]]);
            }
            seen.sort_unstable();
            assert_eq!(seen, free, "{name} block {at}: the chain is the free set");
            chained += 1;
        }
    }
    assert_eq!(blocks, 2191, "data blocks in the placed tables");
    assert_eq!(full, 2105, "full blocks hold a zero head");
    assert_eq!(chained, 86, "partial blocks chain exactly their free slots");
}
