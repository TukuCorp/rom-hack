//! For each data block of a table: live count, whether the slot map accounts for it, free head.
use leap_rs::records;
fn main() {
    let p = std::env::args().nth(1).unwrap();
    let bytes = std::fs::read(&p).unwrap();
    let name = std::path::Path::new(&p).file_stem().unwrap().to_string_lossy().to_string();
    let fields = records::field_descriptors(&bytes);
    let page = records::page_size(&bytes);
    let stride = records::stride_of(&name, &bytes, &fields).unwrap();
    let (base, cap) = records::geometry_in(page, stride).unwrap();
    println!("stride {stride} base {base} cap {cap}");
    for at in records::data_blocks_in(&bytes, page) {
        let block = &bytes[at..at + page];
        let live = records::header_live_count(block).unwrap();
        let map = records::slot_map(block, base, cap);
        let marked = map.as_ref().map(|m| m.iter().filter(|b| **b).count());
        println!("block {} live {} map {:?} head {:?}", at / page, live, marked, records::free_list_head(block));
    }
}
