//! Print every stored expression of an area by branch path, variable and scenario:
//! `exprdump <area.zip> [branch-path-substring]`.
use leap_rs::{area::Area, data::Model};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let area = Area::from_zip_file(&a[1]).expect("an area zip");
    let filter = a.get(2).map(|s| s.to_lowercase());
    let dict = Area::from_zip_file("C:/Program Files/LEAP/_dictionaryNX.zip");
    let m = Model::load(&area, dict.as_ref());
    let path = |mut b: i64| {
        let mut parts = Vec::new();
        while let Some(br) = m.branches.get(&b) {
            parts.push(br.name.clone());
            if br.parent == b {
                break;
            }
            b = br.parent;
        }
        parts.reverse();
        parts.join("\\")
    };
    let mut rows: Vec<_> = m.exprs.iter().collect();
    rows.sort_by_key(|((b, v), _)| (path(*b), *v));
    for ((b, v), by) in rows {
        let p = path(*b);
        if filter.as_ref().is_some_and(|f| !p.to_lowercase().contains(f)) {
            continue;
        }
        let name = m.variables.get(v).map(|d| if d.leap_name.is_empty() { d.label.as_str() } else { d.leap_name.as_str() }).unwrap_or("?");
        for ((s, r), text) in by {
            let sc = m.scenarios.get(s).map(|x| x.abbreviation.as_str()).unwrap_or("?");
            println!("b{b:<5} {p} | v{v} {name} | s{s} {sc} r{r} | {text}");
        }
    }
    for s in m.scenarios.values() {
        println!("scenario s{} {} ({}) parent {} inherits {:?}", s.id, s.abbreviation, s.name, s.parent, s.inherits);
    }
}
