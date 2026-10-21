//! Print a table's fields and live rows: `nxdump <file.nx1> [max_rows]`.

use leap_rs::{blobs, records};

/// One cell on one line: tabs and line breaks become spaces.
fn flat(text: &str) -> String {
    text.replace(['\r', '\n', '\t'], " ")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = &args[1];
    let max: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(50);
    let bytes = std::fs::read(path).expect("table file");
    let name = std::path::Path::new(path).file_stem().unwrap().to_string_lossy().to_string();
    let fields = records::field_descriptors(&bytes);
    let page = records::page_size(&bytes);
    let rule = records::record_size(&fields);
    let stride = records::stride_of(&name, &bytes, &fields);
    println!("# {name}: {} fields, page {page}, rule {rule:?}, stride {stride:?}", fields.len());
    for f in &fields {
        println!("#   {} {} len={} off={} size={}", f.name, f.type_name, f.declared_length, f.offset, f.size);
    }
    let Some(stride) = stride else { return };
    let Some((base, _)) = records::geometry_in(page, stride) else { return };
    println!("{}", fields.iter().map(|f| f.name.as_str()).collect::<Vec<_>>().join("\t"));
    let mut n = 0;
    for block in records::data_blocks_in(&bytes, page) {
        let whole = &bytes[block..block + page];
        for row in records::live_records(whole, base, &fields, stride) {
            if n >= max {
                continue;
            }
            n += 1;
            let cells: Vec<String> = row
                .iter()
                .zip(&fields)
                .map(|(v, f)| match v {
                    records::Value::Blob(b) if *b != 0 => blobs::resolve(&bytes, *b)
                        .and_then(|m| m.text(blobs::width_of(&f.type_name)))
                        .map(|t| format!("«{}»", flat(&t.chars().take(400).collect::<String>())))
                        .unwrap_or_else(|| format!("blob {b}")),
                    other => flat(&other.to_string()),
                })
                .collect();
            println!("{}", cells.join("\t"));
        }
    }
    eprintln!("rows printed: {n}");
}
