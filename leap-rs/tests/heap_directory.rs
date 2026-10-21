//! Memo positions are slots of the heap block's directory, not ordinals.
//!
//! The Optimization Exercise's scenario table freed four memo slots of one heap block when its
//! optimizer rewrote data; the memos after them keep their slot numbers. Counting records puts
//! every later row five memos on -- NGCC's natural gas share reads 40 and wind's capital cost
//! lands on Capacity Credit. Read through the slot directory each row gets its own memo.

use leap_rs::area::Area;

const AREA: &str = "C:/Program Files/LEAP/Optimization Exercise.zip";

#[test]
fn rows_after_freed_slots_read_their_own_memos() {
    let Some(area) = Area::from_zip_file(AREA) else {
        eprintln!("note: {AREA} not found, test skipped");
        return;
    };
    let t = area.table("scenariodata").expect("the scenario table");
    let expr = |branch: i64, variable: i64, scenario: i64| -> String {
        let row = t
            .rows
            .iter()
            .find(|r| t.int(r, "BranchID") == Some(branch) && t.int(r, "VariableID") == Some(variable) && t.int(r, "ScenarioID") == Some(scenario))
            .expect("the row");
        t.text(row, "Expression").unwrap_or_default()
    };
    // NGCC's natural gas feedstock share, and wind's lifetime, availability and capital cost.
    assert_eq!(expr(590, 1036, 1), "100");
    assert_eq!(expr(592, 393, 1), "25");
    assert_eq!(expr(592, 2150, 1), "47");
    assert_eq!(expr(592, 2153, 1), "2100");
}
