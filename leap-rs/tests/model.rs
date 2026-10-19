//! Tests for the model an area holds, starting with its branch tree.
//!
//! The first block here is the vendor bytes, so the reader is tested on what LEAP wrote. The
//! whole list is the reader output and is checked for the thing a wrong reading would break:
//! every named branch has a parent the table also holds, and the links do not close into a cycle.

use std::collections::{HashMap, HashSet};

use leap_rs::expr::{self, Expr};
use leap_rs::{heap, model};
use leap_rs::oracle_records::{
    NX1_BRANCHES, NX1_BRANCH_BLOCK, NX1_BRANCH_DICTIONARY, NX1_BRANCH_LAST_BLOCK,
    NX1_SCENARIO_BLOB_BLOCKS, NX1_SCENARIO_BLOCK, NX1_SCENARIO_DICTIONARY,
    NX1_SCENARIO_BLOB_BLOCK,
    NX1_SCENARIO_LONG_BLOB_BLOCK,
};
use leap_rs::records;

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

fn named() -> Vec<&'static (i32, i32, i16, i16, &'static str)> {
    NX1_BRANCHES.iter().filter(|b| !b.4.is_empty()).collect()
}

#[test]
fn the_top_level_reads_out_of_the_vendor_bytes() {
    let block = unhex(NX1_BRANCH_BLOCK);
    let fields = records::field_descriptors(&unhex(NX1_BRANCH_DICTIONARY));
    assert_eq!(fields.len(), 27, "the structure table has this many fields");
    let got = model::branches_with(&fields, &block);
    assert_eq!(got.len(), 8, "a block holds eight of these");

    let names: Vec<&str> = got.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(
        names,
        vec![
            "Load Shapes",
            "Land Areas",
            "Effects",
            "Indicators",
            "Non Energy",
            "Stock Changes",
            "Statistical Differences",
            "Freedonia"
        ]
    );

    // The area itself is the root and the seven modules under it hang off it.
    assert_eq!(got[7].id, -1);
    assert_eq!(got[7].parent, 0);
    assert_eq!(got[7].name, "Freedonia");
    assert!(got[..7].iter().all(|b| b.parent == -1));
    assert_eq!(got[0].kind, 48, "Load Shapes carries its own branch type");
    assert_eq!(got[0].level, 0);
}

#[test]
fn the_last_block_holds_only_the_branches_its_slot_map_marks() {
    // The structure table's last block states two live records, and its used-slot map marks
    // slots 0 and 1. Five more slots hold residue of freed branches -- their ids are small
    // numbers and their names are empty -- and the signature of an unwritten slot took them for
    // branches. Read through the map, the block is the two branches it holds.
    let fields = records::field_descriptors(&unhex(NX1_BRANCH_DICTIONARY));
    let block = unhex(NX1_BRANCH_LAST_BLOCK);
    assert_eq!(records::header_live_count(&block), Some(2));
    let got = model::branches_with(&fields, &block);
    let ids: Vec<i64> = got.iter().map(|b| b.id).collect();
    assert_eq!(ids, vec![854, 855]);
    assert_eq!(got[0].name, "Biogas");
    assert_eq!(got[1].name, "Sample GHG Reduction Target");
}

#[test]
fn every_named_branch_has_a_parent_the_table_holds() {
    let ids: HashSet<i64> = NX1_BRANCHES.iter().map(|b| b.0 as i64).collect();
    let named = named();
    assert_eq!(named.len(), 434, "every branch the table holds");
    for b in &named {
        assert!(
            b.1 == 0 || ids.contains(&(b.1 as i64)),
            "{} has parent {} which is not a branch",
            b.4,
            b.1
        );
    }
    // Exactly one branch has a parent that is not a branch, and it is the area.
    let roots: Vec<&str> = named.iter().filter(|b| b.1 == 0).map(|b| b.4).collect();
    assert_eq!(roots, vec!["Freedonia"]);

    // Read through the slot maps there is no nameless row left: the five the signature let in
    // were freed slots, and every row read is a named branch.
    assert_eq!(NX1_BRANCHES.len(), named.len());
}

#[test]
fn the_parent_links_do_not_close_into_a_cycle() {
    let by_id: HashMap<i64, i64> = NX1_BRANCHES.iter().map(|b| (b.0 as i64, b.1 as i64)).collect();
    for b in named() {
        let mut at = b.0 as i64;
        let mut steps = 0;
        while at != 0 {
            at = *by_id.get(&at).unwrap_or(&0);
            steps += 1;
            assert!(steps <= 64, "the parent links of {} close into a cycle", b.4);
        }
        assert!(steps > 0, "{} does not reach the root", b.4);
    }
}

#[test]
fn the_tree_reaches_the_branches_the_model_is_built_from() {
    let find = |name: &str| {
        NX1_BRANCHES
            .iter()
            .find(|b| b.4 == name)
            .unwrap_or_else(|| panic!("no branch called {}", name))
    };
    assert_eq!(find("Demand").1, -1);
    assert_eq!(find("Household").1, 1);
    assert_eq!(find("Urban").1, 2);
    assert_eq!(find("Electricity Generation").1, 26);
    assert_eq!(find("Transmission and Distribution").1, 26);
    assert_eq!(find("Key Assumptions").0, 3);

    // The tree is deeper than one level and every branch on the way is present.
    let urban = find("Urban");
    assert_eq!(find("Household").0, urban.1);
    assert_eq!(find("Demand").0, find("Household").1);
    assert_eq!(find("Freedonia").0, find("Demand").1);
}

#[test]
fn the_scenario_table_says_which_expression_belongs_to_which_variable() {
    let fields = records::field_descriptors(&unhex(NX1_SCENARIO_DICTIONARY));
    assert_eq!(fields.len(), 5, "the scenario table has this many fields");
    let block = unhex(NX1_SCENARIO_BLOCK);
    let rows = model::scenarios_with(&fields, &block);

    assert_eq!(rows.len(), 168, "a block of this table holds this many rows");
    assert_eq!(
        rows[0],
        model::ScenarioRow {
            branch: -1,
            variable: 2186,
            region: 1,
            scenario: 1,
            memo_index: 1,
            memo_block: 5,
        }
    );
    assert_eq!(rows[6].variable, 2216);
    assert_eq!(rows[6].memo_index, 7);
    assert_eq!(rows[7].memo_index, 0, "this row carries no expression");
    assert_eq!(rows[7].memo_block, 0);

    // Every memo a row points at is in one of the file own seven blob blocks, and the rows that
    // have one number them one upwards in row order.
    for row in &rows {
        if row.memo_index == 0 {
            assert_eq!(row.memo_block, 0, "a row with no memo has no block");
            continue;
        }
        assert!(
            NX1_SCENARIO_BLOB_BLOCKS.contains(&(row.memo_block as usize)),
            "block {} is not one of the file blob blocks",
            row.memo_block
        );
    }
    let indices: Vec<u64> = rows
        .iter()
        .filter(|row| row.memo_index != 0)
        .map(|row| row.memo_index)
        .collect();
    assert_eq!(indices.len(), 165, "three rows of the block carry no expression");
    assert_eq!(
        indices,
        (1..=165).collect::<Vec<u64>>(),
        "the first block numbers its memos one upwards"
    );

    // The keys join to the rest of the model: every branch a row refers to is a branch of the
    // tree, and the rows are one region in three scenarios.
    let tree: std::collections::HashSet<i64> = NX1_BRANCHES.iter().map(|b| b.0 as i64).collect();
    for row in &rows {
        assert!(tree.contains(&row.branch), "branch {} is not in the tree", row.branch);
        assert!(row.variable > 0, "variable {}", row.variable);
    }
    let scenarios: Vec<i64> = {
        let mut seen: Vec<i64> = rows.iter().map(|row| row.scenario).collect();
        seen.sort_unstable();
        seen.dedup();
        seen
    };
    assert_eq!(scenarios, vec![1, 2, 11]);
    assert!(rows.iter().all(|row| row.region == 1));
}

#[test]
fn a_scenario_row_resolves_to_the_expression_it_points_at() {
    let fields = records::field_descriptors(&unhex(NX1_SCENARIO_DICTIONARY));
    let rows = model::scenarios_with(&fields, &unhex(NX1_SCENARIO_BLOCK));
    let blob = unhex(NX1_SCENARIO_BLOB_BLOCK);
    let memos = heap::memos(&blob);

    // The block states how many memos it holds, and the walk stops when it has them.
    assert_eq!(rows.iter().map(|row| row.memo_index).max(), Some(165));
    assert_eq!(heap::stated(&blob), Some(190), "the block states its own count");
    assert_eq!(memos.len(), 190, "every memo the block states, and no terminator");

    // The expressions the first rows point at, in the order the rows name them.
    let first: Vec<&str> = rows
        .iter()
        .take(7)
        .map(|row| memos[(row.memo_index - 1) as usize].as_str())
        .collect();
    assert_eq!(first, vec!["0.2", "5", "1000", "5", "0", "1", "2040"]);
    assert_eq!(memos[7], "EN");
    assert_eq!(memos[8], "Fictitious or Example Data");

    // And the arithmetic reader reads them: a number is a number and a formula is a formula.
    assert_eq!(expr::parse(&memos[0]).unwrap(), Expr::Number("0.2".to_string()));
    let formula = memos
        .iter()
        .find(|text| text.starts_with("@F001(@F010("))
        .expect("the block holds a wrapped percentage");
    assert_eq!(formula, "@F001(@F010(3))");
    assert!(expr::parse(formula).is_ok(), "{formula}");
    assert_eq!(
        expr::parse(&memos[5]).unwrap(),
        Expr::Number("1".to_string()),
        "the sixth row is a plain one"
    );

    // Every position that the rows of this block use has a memo behind it.
    for row in rows.iter().filter(|row| row.memo_index != 0) {
        assert!(
            heap::memo(&blob, row.memo_index).is_some(),
            "position {} has no memo",
            row.memo_index
        );
    }
    assert_eq!(heap::memo(&blob, 0), None);
}

#[test]
fn the_block_whose_first_memo_is_the_longest_reads_to_its_stated_count() {
    // The fifth block is the one whose first memo is a sentence rather than a number or a
    // formula, and its allocation is one byte more than its text needs, so the record ends a
    // word short of where the old framing said. Read at the stride the block's own headers
    // show, every one of the 152 memos it states comes back -- including the nested header at
    // 0x58 that the short framing swallowed.
    let blob = unhex(NX1_SCENARIO_LONG_BLOB_BLOCK);
    assert_eq!(heap::stated(&blob), Some(152));
    let memos = heap::memos(&blob);
    assert_eq!(memos.len(), 152, "every memo the block states");
    assert!(memos[0].starts_with(" divided @C1000 total population"), "{:?}", memos[0]);
    // The second record starts at 0x58 and holds a single raw character, the only memo of its
    // kind in the block; the third is the formula the old walk never reached.
    assert_eq!(memos[1], "\u{aa}", "the record at 0x58");
    assert_eq!(memos[2], "@F041(32,2027,-99,-99,0,0,0,0, 1.1)");

    // Every other block of the same file reads to the count it states as well, and one of them
    // is checked on the vendor bytes in the test above.
    let first = unhex(NX1_SCENARIO_BLOB_BLOCK);
    assert_eq!(heap::memos(&first).len(), heap::stated(&first).unwrap() as usize);
}

#[test]
fn a_block_the_walk_cannot_finish_comes_back_short_rather_than_invented() {
    // The walk stops where it meets something that is not a record, rather than hunting for the
    // next one: a truncated block reports what it read and not what it hopes. The ninth record
    // of the first block is a valid header, so cutting the block two bytes into it leaves the
    // reader with the eight memos before it and no invention after them.
    let whole = unhex(NX1_SCENARIO_BLOB_BLOCK);
    let mut cut = whole.clone();
    let at = record_offset(&whole, 8);
    cut.truncate(at + 2);
    assert_eq!(heap::memos(&cut).len(), 8, "the eight memos the bytes hold");
    assert!(heap::memos(&cut).len() < heap::stated(&whole).unwrap() as usize);

    // A block whose first bytes are not a record at all reads as nothing.
    assert!(heap::memos(&[0u8; 64]).is_empty());
    assert!(heap::memos(&[]).is_empty());
}

/// The offset of the memo at a zero-based position, by walking the block the way `heap` does.
fn record_offset(block: &[u8], position: usize) -> usize {
    let mut at = 0x14;
    for _ in 0..position {
        let alloc = u16::from_le_bytes([block[at], block[at + 1]]) as usize;
        at += (alloc + 2 + 3) / 4 * 4;
    }
    at
}

#[test]
fn a_memo_decodes_as_utf16_and_a_position_past_the_count_has_none() {
    // A memo whose text is outside the basic plane: "a", U+1F600, "b" is four UTF-16 units,
    // so its allocation is 2 * 4 + 1 and the record occupies round_up_to_four(alloc + 2).
    // The block states one memo, and asking for a second gets nothing rather than the bytes
    // of whatever follows.
    let mut block = vec![0u8; 64];
    block[0x10..0x14].copy_from_slice(&1u32.to_le_bytes());
    let units = [0x0061u16, 0xd83d, 0xde00, 0x0062];
    let alloc = (2 * units.len() + 1) as u16;
    block[0x14..0x16].copy_from_slice(&alloc.to_le_bytes());
    block[0x16] = 0x03;
    for (i, unit) in units.iter().enumerate() {
        block[0x17 + 2 * i..0x19 + 2 * i].copy_from_slice(&unit.to_le_bytes());
    }
    assert_eq!(heap::stated(&block), Some(1));
    assert_eq!(heap::memos(&block), vec!["a\u{1f600}b".to_string()]);
    assert_eq!(heap::memo(&block, 1), Some("a\u{1f600}b".to_string()));
    assert_eq!(heap::memo(&block, 2), None, "one memo is all the block states");
    assert_eq!(heap::memo(&block, 0), None);

    // The same memo read at the end of a block that states more memos than it holds: the walk
    // stops where the records do, so a position beyond them has no memo rather than invented
    // bytes.
    let short = &block[..0x20];
    assert_eq!(heap::memo(short, 1), Some("a\u{1f600}b".to_string()));
    assert_eq!(heap::memo(short, 2), None);
}
