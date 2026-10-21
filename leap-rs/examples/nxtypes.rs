//! Census of field types and inferred strides over directories of tables: `nxtypes <dir>...`.

use leap_rs::records;
use std::collections::BTreeMap;

fn main() {
    let mut types: BTreeMap<String, usize> = BTreeMap::new();
    for dir in std::env::args().skip(1) {
        let mut entries: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().collect();
        entries.sort_by_key(|e| e.path());
        for e in entries {
            let p = e.path();
            if p.extension().map(|x| x.to_ascii_lowercase()) != Some("nx1".into()) {
                continue;
            }
            let bytes = std::fs::read(&p).unwrap();
            let name = p.file_stem().unwrap().to_string_lossy().to_string();
            let fields = records::field_descriptors(&bytes);
            for f in &fields {
                *types.entry(f.type_name.clone()).or_default() += 1;
            }
            let page = records::page_size(&bytes);
            let blocks = records::data_blocks_in(&bytes, page).len();
            if fields.is_empty() {
                println!("UNPLACED {dir}/{name} blocks={blocks}");
            } else if blocks > 0 {
                let s = records::stride_of(&name, &bytes, &fields);
                let rule = records::record_size(&fields);
                if s.is_none() || s != rule {
                    println!("{dir}/{name}: rule {rule:?} stride {s:?} blocks {blocks}");
                }
            }
        }
    }
    println!("{types:#?}");
}
