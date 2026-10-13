//! Tests for the model an area holds, starting with its branch tree.
//!
//! The first block here is the vendor bytes, so the reader is tested on what LEAP wrote. The
//! whole list is the reader output and is checked for the thing a wrong reading would break:
//! every named branch has a parent the table also holds, and the links do not close into a cycle.

use std::collections::{HashMap, HashSet};

use leap_rs::model;
use leap_rs::oracle_records::{
    NX1_BRANCHES, NX1_BRANCH_BLOCK, NX1_BRANCH_DICTIONARY, NX1_BRANCH_LAST_BLOCK,
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
