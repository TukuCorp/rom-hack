//! The calculation against LEAP's own results, on the public sample areas SEI ships.
//!
//! Each area zip carries `_RegressionTests/Definitive/RegressionResults.nx1`: the results LEAP
//! itself calculated, at full double precision, by branch, result variable, scenario, region,
//! year and extra dimension. The port calculates the area from its inputs alone and every value of
//! every variable listed here has to match LEAP's (`results::close`: within 1e-6 relative, or 1e-9
//! of the variable's largest value where LEAP stores its own floating-point noise). Nothing is
//! mocked: the inputs and the oracle are the vendor's files, read through the crate's own readers.
//! Like `vendor_e2e`, a test prints a note and passes when LEAP is not installed.

use leap_rs::{area::Area, calc, data::Model, results};

const LEAP: &str = "C:/Program Files/LEAP";

/// The variables each area is held to in full.
const HELD: &[(&str, &[i64])] = &[
    // Every variable the Freedonia regression results hold: all 45 of them, the costs (5, 86,
    // 88, 103) and the pollutant loadings (40) included.
    ("Freedonia", &[1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 30, 31, 35, 36, 40, 41, 42, 43, 46, 65, 73, 77, 82, 84, 86, 87, 88, 89, 103, 104, 105, 125, 126, 127, 2027]),
    // Every Transport Exercise variable but 85 (Device Retirements), whose base-year value is
    // not yet derived; its later years already match.
    ("Transport Exercise", &[20, 21, 30, 40, 41, 60, 61, 62, 64, 66, 67, 68, 81, 125, 2027]),
];

fn check(area: &str, vars: &[i64]) {
    let Some(zip) = Area::from_zip_file(format!("{LEAP}/{area}.zip")) else {
        eprintln!("note: {area} not found, case study skipped");
        return;
    };
    let dict = Area::from_zip_file(format!("{LEAP}/_dictionaryNX.zip"));
    let m = Model::load(&zip, dict.as_ref());
    let want = results::definitive(&zip).expect("the area ships its regression results");
    let got = calc::run(&m);
    let reports = results::compare(&got, &want);
    let mut failures = Vec::new();
    for v in vars {
        let r = reports.iter().find(|r| r.variable == *v).unwrap_or_else(|| panic!("{area}: variable {v} is in the oracle"));
        if r.matched != r.total {
            let worst: Vec<String> = r.worst.iter().take(3).map(|(k, g, w)| format!("{k:?}: got {g} want {w}")).collect();
            failures.push(format!("{area} var {v}: {}/{} matched; {worst:#?}", r.matched, r.total));
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn freedonia_matches_leap() {
    for (area, vars) in HELD {
        if *area == "Freedonia" {
            check(area, vars);
        }
    }
}

#[test]
fn transport_exercise_matches_leap() {
    for (area, vars) in HELD {
        if *area == "Transport Exercise" {
            check(area, vars);
        }
    }
}
