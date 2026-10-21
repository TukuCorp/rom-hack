//! Independent probes for the leap-rs calc claims. Built against the crate as a path dependency;
//! it adds nothing to the project.
//!
//! `calc <stripped_area_dir> <original_zip> <dictionary_zip> <area>`: calculate the area from a
//! copy with every regression/results file removed, require the output to equal the calculation
//! from the full zip exactly, and require every claimed variable to match LEAP's definitive
//! regression results within `results::close`.
//!
//! `stride <area_zip>`: for every table `records::MEASURED_STRIDE` names, require that the area
//! carries it with data blocks, that `stride_of` returns the measured stride, and report what
//! `infer_stride` alone returns.

use leap_rs::{area::Area, calc, container, data::Model, records, results};
use std::process::exit;

fn held(area: &str) -> &'static [i64] {
    match area {
        "Freedonia" => &[1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 30, 31, 35, 36, 41, 42, 43, 46, 65, 73, 77, 82, 84, 87, 89, 104, 105, 125, 126, 127, 2027],
        "Transport Exercise" => &[20, 21, 30, 40, 41, 60, 61, 62, 64, 66, 67, 68, 81, 125, 2027],
        _ => panic!("unknown area {area}"),
    }
}

fn calc_probe(stripped: &str, zip: &str, dict: &str, area: &str) -> bool {
    let inputs = Area::from_dir(stripped).expect("stripped area dir");
    let leaked: Vec<&str> = inputs.paths().filter(|p| p.contains("regression")).collect();
    if !leaked.is_empty() {
        println!("FAIL {area}: stripped inputs still hold {leaked:?}");
        return false;
    }
    let full = Area::from_zip_file(zip).expect("area zip");
    if full.file("RegressionResults.nx1").is_none() {
        println!("note {area}: zip has no top-level RegressionResults.nx1");
    }
    let dict = Area::from_zip_file(dict);
    let want = results::definitive(&full).expect("definitive regression results");
    let got = calc::run(&Model::load(&inputs, dict.as_ref()));
    let got_full = calc::run(&Model::load(&full, dict.as_ref()));
    let mut ok = true;
    let same = got.len() == got_full.len()
        && got.iter().zip(got_full.iter()).all(|((ka, va), (kb, vb))| ka == kb && va.to_bits() == vb.to_bits());
    println!("{area}: stripped-input results {} values, full-zip results {} values, bit-identical: {same}", got.len(), got_full.len());
    ok &= same;
    let reports = results::compare(&got, &want);
    let mut values = 0;
    for v in held(area) {
        match reports.iter().find(|r| r.variable == *v) {
            None => {
                println!("FAIL {area} var {v}: not in the oracle");
                ok = false;
            }
            Some(r) => {
                values += r.total;
                if r.total == 0 || r.matched != r.total {
                    ok = false;
                    println!("FAIL {area} var {v}: {}/{} matched; worst {:?}", r.matched, r.total, r.worst.iter().take(2).collect::<Vec<_>>());
                }
            }
        }
    }
    println!("{area}: {} held variables, {values} oracle values checked: {}", held(area).len(), if ok { "ALL MATCH" } else { "MISMATCH" });
    ok
}

fn stride_probe(zip: &str) -> bool {
    let bytes = std::fs::read(zip).expect("area zip");
    let names = container::member_names(&bytes).expect("zip members");
    let mut ok = true;
    let mut infer_agree = 0;
    for (table, measured) in records::MEASURED_STRIDE {
        let Some(name) = names.iter().find(|n| {
            !n.contains("_RegressionTests") && n.rsplit('/').next().unwrap().to_lowercase() == format!("{table}.nx1")
        }) else {
            println!("FAIL {table}: not in the area");
            ok = false;
            continue;
        };
        let t = container::read_member(&bytes, name).unwrap();
        let fields = records::field_descriptors(&t);
        let blocks = records::data_blocks_in(&t, records::page_size(&t)).len();
        let got = records::stride_of(table, &t, &fields);
        let inferred = records::infer_stride(&t, &fields);
        let good = blocks > 0 && got == Some(*measured);
        infer_agree += (inferred == Some(*measured)) as usize;
        println!("{table}: measured {measured}, blocks {blocks}, stride_of {got:?}, infer_stride {inferred:?} {}", if good { "OK" } else { "FAIL" });
        ok &= good;
    }
    println!("stride_of reproduces {} measured strides: {}; infer_stride alone agrees on {infer_agree}", records::MEASURED_STRIDE.len(), if ok { "ALL OK" } else { "MISMATCH" });
    ok
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let ok = match a.get(1).map(String::as_str) {
        Some("calc") if a.len() == 6 => calc_probe(&a[2], &a[3], &a[4], &a[5]),
        Some("stride") if a.len() == 3 => stride_probe(&a[2]),
        _ => {
            eprintln!("usage: probe calc <dir> <zip> <dict> <area> | probe stride <zip>");
            exit(3)
        }
    };
    exit(if ok { 0 } else { 1 });
}
