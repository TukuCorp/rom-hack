//! Print a blob's raw memo: `blobraw <file.nx1> <blob>`.

use leap_rs::blobs;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let bytes = std::fs::read(&a[1]).unwrap();
    let blob: u64 = a[2].parse().unwrap();
    let (idx, page) = blobs::split(blob).unwrap();
    println!("index {idx} page {page}");
    let m = blobs::resolve(&bytes, blob).unwrap();
    println!("kind {} len {}", m.kind, m.bytes.len());
    for chunk in m.bytes.chunks(12) {
        println!("  {:02x?} {:?}", chunk, chunk.chunks(4).filter(|c| c.len() == 4).map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect::<Vec<_>>());
    }
}
