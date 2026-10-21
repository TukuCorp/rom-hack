//! Heap census under the slot directory, for the blobs tests: `heapprobe <area.zip>`.
use leap_rs::{blobs, container, heap, records};
use leap_rs::records::Value;
fn main() {
    let zip = std::fs::read(std::env::args().nth(1).unwrap()).unwrap();
    let names = container::member_names(&zip).unwrap();
    let (mut slots, mut used, mut free, mut chain_ok, mut blocks) = (0, 0, 0, 0, 0);
    let mut kinds = std::collections::BTreeMap::new();
    let mut live_kinds = std::collections::BTreeMap::new();
    let (mut dirs, mut entries, mut assembled, mut odd_starts) = (0, 0, 0, 0);
    for name in names.iter().filter(|n| n.ends_with(".nx1") && !n.contains("_Regression")) {
        let bytes = container::read_member(&zip, name).unwrap();
        let page = records::page_size(&bytes);
        for pg in blobs::heap_pages(&bytes) {
            let block = &bytes[pg * page..(pg + 1) * page];
            blocks += 1;
            let len = block.len();
            let n = u16::from_le_bytes([block[len - 6], block[len - 5]]) as u64;
            slots += n;
            let mut free_set = std::collections::BTreeSet::new();
            for k in 1..=n {
                match heap::slot_offset(block, k) {
                    Some(_) => { used += 1; let (kind, _) = heap::record_raw(block, k).unwrap(); *kinds.entry(kind).or_insert(0) += 1; }
                    None => { free += 1; free_set.insert(k); }
                }
            }
            // walk the free chain
            let mut seen = std::collections::BTreeSet::new();
            let mut next = u16::from_le_bytes([block[len - 8], block[len - 7]]) as u64;
            while next != 0 && seen.insert(next) {
                let at = len - 10 - 2 * next as usize;
                let v = u16::from_le_bytes([block[at], block[at + 1]]) as u64;
                next = v >> 2;
            }
            if seen == free_set { chain_ok += 1; }
        }
        // live refs
        let fields = records::field_descriptors(&bytes);
        let stem = name.rsplit('/').next().unwrap().trim_end_matches(".nx1");
        let Some(stride) = records::stride_of(stem, &bytes, &fields) else { continue };
        let Some((base, _)) = records::geometry_in(page, stride) else { continue };
        for at in records::data_blocks_in(&bytes, page) {
            for row in records::live_records(&bytes[at..at + page], base, &fields, stride) {
                for (v, f) in row.iter().zip(&fields) {
                    if let Value::Blob(b) = v { if *b != 0 {
                        let m = blobs::resolve(&bytes, *b).expect("live ref resolves");
                        *live_kinds.entry(m.kind).or_insert(0) += 1;
                        if m.kind == 5 {
                            dirs += 1;
                            entries += m.segments().map(|s| s.len()).unwrap_or(0);
                            if blobs::resolve_text(&bytes, *b, blobs::width_of(&f.type_name)).is_some() { assembled += 1; }
                            let (ix, pgn) = blobs::split(*b).unwrap();
                            let _ = (ix, pgn);
                        }
                    }}
                }
            }
        }
        let _ = &mut odd_starts;
    }
    println!("blocks {blocks} slots {slots} used {used} free {free} chains_ok {chain_ok}");
    println!("kinds of used slots {kinds:?}");
    println!("live ref kinds {live_kinds:?}");
    println!("live directories {dirs} entries {entries} assembled {assembled}");
}
