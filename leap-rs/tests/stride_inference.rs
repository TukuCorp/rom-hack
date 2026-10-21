//! The stride a table is written at, read from its own blocks rather than from a list.
//!
//! `records::MEASURED_STRIDE` pins 28 strides for the Freedonia area by hand. Other areas carry
//! the same tables at strides of their own, so the reader has to find the stride the blocks were
//! written at: a full block holds exactly as many live records as the stride's geometry has
//! slots, and a partial block's free-slot chain, read at that stride, lands on exactly the slots
//! its used-slot map leaves free. This holds the inference to every stride the area pins.

use leap_rs::container;
use leap_rs::records;

const AREA: &str = "C:/Program Files/LEAP/Freedonia.zip";

fn tables() -> Option<Vec<(String, Vec<u8>)>> {
    let zip = std::fs::read(AREA).ok()?;
    let names = container::member_names(&zip)?;
    Some(
        names
            .iter()
            .filter(|name| name.to_lowercase().ends_with(".nx1") && !name.contains("_RegressionTests"))
            .map(|name| {
                let table = name.rsplit('/').next().unwrap().trim_end_matches(".nx1");
                (table.to_string(), container::read_member(&zip, name).unwrap())
            })
            .collect(),
    )
}

#[test]
fn the_inferred_stride_is_every_stride_the_area_pins() {
    let Some(tables) = tables() else {
        eprintln!("note: {AREA} not found, inference test skipped");
        return;
    };
    let mut checked = 0;
    let mut wrong = Vec::new();
    for (name, bytes) in &tables {
        let fields = records::field_descriptors(bytes);
        let page = records::page_size(bytes);
        if fields.is_empty() || records::data_blocks_in(bytes, page).is_empty() {
            continue;
        }
        let want = records::stride(name, &fields);
        let got = records::stride_of(name, bytes, &fields);
        if name != "variabledata" {
            assert_eq!(records::infer_stride(bytes, &fields), want, "{name}: inferred alone");
        }
        if got != want {
            wrong.push(format!("{name}: inferred {got:?}, pinned {want:?}"));
        }
        checked += 1;
    }
    assert!(wrong.is_empty(), "{wrong:#?}");
    assert!(checked >= 50, "tables with data blocks: {checked}");
}
