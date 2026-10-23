//! Print a table of an area or dictionary zip as tab-separated rows:
//! `tabledump <zip> <table> [substring]`, keeping only rows that contain the substring.
use leap_rs::area::Area;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let zip = Area::from_zip_file(&a[1]).expect("a zip");
    let t = zip.table(&a[2]).expect("a table of that name");
    let names: Vec<String> = t.fields.iter().map(|f| f.name.clone()).collect();
    println!("{}", names.join("\t"));
    for r in &t.rows {
        let cell = |n: &str| {
            t.text(r, n)
                .or_else(|| t.int(r, n).map(|v| v.to_string()))
                .or_else(|| t.float(r, n).map(|v| v.to_string()))
                .unwrap_or_default()
                .replace(['\r', '\n', '\t'], " ")
        };
        let line: Vec<String> = names.iter().map(|n| cell(n)).collect();
        let line = line.join("\t");
        if a.get(3).is_none_or(|s| line.to_lowercase().contains(&s.to_lowercase())) {
            println!("{line}");
        }
    }
}
