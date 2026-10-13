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
fn the_last_block_leaves_out_the_slot_nothing_was_written_to() {
    // The structure table fills its last block seven slots deep, and the eighth is a slot the
    // file never wrote to. A reader that takes every slot would report a branch that is not one.
    let fields = records::field_descriptors(&unhex(NX1_BRANCH_DICTIONARY));
    let block = unhex(NX1_BRANCH_LAST_BLOCK);
    let got = model::branches_with(&fields, &block);
    assert_eq!(got.len(), 7, "seven of the block's eight slots");
    let ids: Vec<i64> = got.iter().map(|b| b.id).collect();
    assert_eq!(ids, vec![854, 855, 4, 5, 6, 7, 8]);
    assert_eq!(got[0].name, "Biogas");
    assert_eq!(got[1].name, "Sample GHG Reduction Target");

    // The five nameless rows are here, and they are the freed slots the rule cannot tell apart.
    assert_eq!(got.iter().filter(|b| b.name.is_empty()).count(), 5);
}

#[test]
fn every_named_branch_has_a_parent_the_table_holds() {
    let ids: HashSet<i64> = NX1_BRANCHES.iter().map(|b| b.0 as i64).collect();
    let named = named();
    assert_eq!(named.len(), 434, "five rows are slots that were written and then freed");
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

    // The five nameless rows are the ones the rule could not tell from written slots, and they
    // are the whole of the difference between the rows read and the branches there are.
    assert_eq!(NX1_BRANCHES.len() - named.len(), 5);
    assert!(NX1_BRANCHES.iter().filter(|b| b.4.is_empty()).all(|b| b.1 == 0));
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
fn a_block_the_walk_cannot_finish_comes_back_short_rather_than_invented() {
    // One block of the shipped table is not walked to its end: its first record holds a text longer
    // than its own allocation accounts for, and what follows it is not a record this reader
    // understands. The block states how many memos it holds, so the shortfall is visible rather
    // than quietly filled in -- and if a later pass does learn to read it, this test says so.
    let blob = unhex(NX1_SCENARIO_LONG_BLOB_BLOCK);
    assert_eq!(heap::stated(&blob), Some(152));
    let memos = heap::memos(&blob);
    assert_eq!(memos.len(), 1, "the reader reports what it read, not what it hopes");
    assert!(memos.len() < 152);
    assert!(memos[0].starts_with(" divided @C1000 total population"), "{:?}", memos[0]);

    // The other six blocks of the same file read to the count they state, and one of them is
    // checked on the vendor bytes in the test above.
    let first = unhex(NX1_SCENARIO_BLOB_BLOCK);
    assert_eq!(heap::memos(&first).len(), heap::stated(&first).unwrap() as usize);
}
