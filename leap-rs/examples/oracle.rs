//! Print LEAP's own results beside the port's for one variable:
//! `oracle <area.zip> <variable> [scenario] [year] [branch]`.
use leap_rs::{area::Area, calc, data::Model, results};

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let area = Area::from_zip_file(&a[1]).expect("an area zip");
    let num = |i: usize| a.get(i).and_then(|s| s.parse::<i64>().ok());
    let (var, scen, year, branch) = (num(2).expect("a variable"), num(3), num(4), num(5));
    let dict = Area::from_zip_file("C:/Program Files/LEAP/_dictionaryNX.zip");
    let m = Model::load(&area, dict.as_ref());
    let want = results::definitive(&area).expect("regression results");
    let got = calc::run(&m);
    let keep = |k: &results::Key| {
        k.variable == var && scen.is_none_or(|s| k.scenario == s) && year.is_none_or(|y| k.year == y) && branch.is_none_or(|b| k.branch == b)
    };
    let mut keys: Vec<_> = want.keys().chain(got.keys()).filter(|k| keep(k)).copied().collect();
    keys.sort();
    keys.dedup();
    for k in keys {
        let name = m.branches.get(&k.branch).map(|b| b.name.as_str()).unwrap_or("?");
        println!("b{} {:<20} s{} y{} x{} {}: want {} got {}", k.branch, name, k.scenario, k.year, k.x1, k.x2,
            want.get(&k).copied().unwrap_or(f64::NAN), got.get(&k).copied().unwrap_or(f64::NAN));
    }
}
