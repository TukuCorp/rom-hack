//! Calculate an area and compare against LEAP's definitive regression results:
//! `compare <area.zip> [variable] [max_rows]`.

use leap_rs::{area::Area, calc, data::Model, results};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let area = Area::from_zip_file(&args[1]).expect("an area zip");
    let only: Option<i64> = args.get(2).and_then(|s| s.parse().ok());
    let rows: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(8);
    let dict = Area::from_zip_file("C:/Program Files/LEAP/_dictionaryNX.zip");
    let m = Model::load(&area, dict.as_ref());
    let want = results::definitive(&area).expect("regression results");
    let got = calc::run(&m);
    let (mut t, mut ok) = (0, 0);
    for r in results::compare(&got, &want) {
        t += r.total;
        ok += r.matched;
        if only.is_some_and(|v| v != r.variable) {
            continue;
        }
        println!("var {:>5}: {:>6}/{:<6} matched", r.variable, r.matched, r.total);
        for (k, g, w) in r.worst.iter().take(if only.is_some() { rows } else { 3 }) {
            let name = m.branches.get(&k.branch).map(|b| b.name.as_str()).unwrap_or("?");
            println!("    b{} {:<24} s{} y{} x{} {}: got {g} want {w}", k.branch, name, k.scenario, k.year, k.x1, k.x2);
        }
    }
    println!("TOTAL {ok}/{t} matched ({:.2}%)", 100.0 * ok as f64 / t as f64);
}
