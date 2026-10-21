//! The script functions an area's expressions `Call`.
//!
//! LEAP areas can call VBScript functions from `Functions.vbs` (`@F105(¤Name¤)`). The two the
//! sample areas call are the ones LEAP's standard `Functions.vbs` defines for the health benefit
//! calculation, ported here function for function from that file (v1.4): `IndoorDeaths`, premature
//! deaths from indoor air pollution for a disease, sex and age group, and `BaselineMortality`, the
//! total baseline deaths of a sex and age group. They read the area through the same branches and
//! variables the script names, and the relative risk through LEAP's `PollutionRelRiskMean`, which
//! interpolates the dictionary's `FastRelativeRisk` grid (`FUN_02db3190`).

use super::inputs::{Cx, Inputs};
use crate::area::Area;
use std::sync::OnceLock;

/// The PM2.5 concentrations the relative-risk grid is tabulated at (`DAT_03799720`).
const GRID: [f64; 13] = [0.0, 5.0, 10.0, 25.0, 50.0, 100.0, 300.0, 500.0, 1000.0, 5000.0, 10000.0, 55000.0, 100000.0];

/// One row of the relative-risk grid: disease, age, version and the risks at `GRID`.
type RiskRow = (i64, i64, i64, [f64; 13]);

fn risk_grid() -> &'static Vec<RiskRow> {
    static GRID_ROWS: OnceLock<Vec<RiskRow>> = OnceLock::new();
    GRID_ROWS.get_or_init(|| {
        let Some(dict) = Area::from_zip_file("C:/Program Files/LEAP/_dictionaryNX.zip") else { return Vec::new() };
        let Some(t) = dict.table("FastRelativeRisk") else { return Vec::new() };
        let cols = ["PM0", "PM5", "PM10", "PM25", "PM50", "PM100", "PM300", "PM500", "PM1000", "PM5000", "PM10000", "PM55000", "PM100000"];
        t.rows
            .iter()
            .filter_map(|r| {
                let mut v = [0.0; 13];
                for (i, c) in cols.iter().enumerate() {
                    v[i] = t.float(r, c)?;
                }
                Some((t.int(r, "DiseaseID")?, t.int(r, "AgeID")?, t.int(r, "ver")?, v))
            })
            .collect()
    })
}

/// The mean relative risk of a disease at a PM2.5 exposure: linear between the grid points,
/// flat past the last, one at no exposure. IHD (5) and stroke (3) are tabulated by age, the
/// others for all ages.
pub fn rel_risk_mean(disease: i64, age: i64, exposure: f64, version: i64) -> f64 {
    if exposure <= 0.0 {
        return 1.0;
    }
    let age = if disease == 3 || disease == 5 { age } else { 0 };
    let Some((_, _, _, v)) = risk_grid().iter().find(|r| r.0 == disease && r.1 == age && r.2 == version) else {
        return 1.0;
    };
    if exposure > GRID[12] {
        return v[12];
    }
    for i in 1..13 {
        if exposure < GRID[i] {
            return v[i - 1] + (v[i] - v[i - 1]) * ((exposure - GRID[i - 1]) / (GRID[i] - GRID[i - 1]));
        }
    }
    v[12]
}

/// The relative-risk version the calculation uses: version 1 of the grid. Asiana's IndoorDeaths
/// branches reproduce LEAP's values to the last digit with it (6726.369726079367 for female ALRI
/// under five in 2010) and fall 11% short with version 2.
pub const RISK_VERSION: i64 = 1;

fn disease_type(name: &str) -> i64 {
    match name.to_uppercase().as_str() {
        "COPD" | "COPD RATE" => 1,
        "ALRI" | "ALRI DISEASE RATE" => 2,
        "STROKE" | "STROKE RATE" => 3,
        "LC" | "LUNG CANCER" | "LC RATE" | "LUNG CANCER RATE" => 4,
        "IHD" | "ISCHAEMIC HEART DISEASE" | "IHD RATE" | "ISCHAEMIC HEART DISEASE RATE" => 5,
        "CARDIOPULMONARY DISEASE" | "CARDIOPULMONARY DISEASE RATE" => 6,
        "RESPIRATORY DISEASE" | "RESPIRATORY DISEASE RATE" => 7,
        _ => -1,
    }
}

fn disease_name(id: i64) -> &'static str {
    match id {
        1 => "COPD Rate",
        2 => "ALRI Disease Rate",
        3 => "Stroke Rate",
        4 => "Lung Cancer Rate",
        5 => "Ischaemic Heart Disease Rate",
        6 => "Cardiopulmonary Disease Rate",
        7 => "Respiratory Disease Rate",
        _ => "*ERROR*",
    }
}

fn gender_type(name: &str) -> i64 {
    match name.to_uppercase().as_str() {
        "FEMALE" => 0,
        "MALE" => 1,
        _ => -1,
    }
}

fn gender_name(t: i64) -> &'static str {
    if t == 0 { "Female" } else { "Male" }
}

fn output_age(name: &str) -> i64 {
    let up = name.to_uppercase();
    if up.starts_with("LESS THAN 5") {
        return 5;
    }
    if up.starts_with("OVER 70") {
        return 70;
    }
    let parts: Vec<&str> = name.split(' ').collect();
    parts.get(1).and_then(|p| p.trim().parse().ok()).unwrap_or(-1)
}

fn input_ages(out: i64) -> &'static [i64] {
    match out {
        5 => &[5],
        30 => &[30, 35, 40, 45],
        50 => &[50, 55, 60, 65],
        70 => &[70, 75, 80],
        _ => &[],
    }
}

fn age_branch_name(age: i64) -> String {
    match age {
        5 => "Less than 5 Years".into(),
        80 => "More than 80 years".into(),
        a => format!("Age {a} to {} years", a + 4),
    }
}

/// A branch by its path below the tree root, names compared without case.
pub fn branch_path(inp: &Inputs, path: &str) -> Option<i64> {
    let mut at: Option<i64> = None;
    for part in path.split('\\').filter(|p| !p.is_empty()) {
        let parent = at.unwrap_or(-1);
        let next = inp.m.kids(parent).iter().copied().find(|k| inp.m.branches[k].name.eq_ignore_ascii_case(part.trim()))?;
        at = Some(next);
    }
    at
}

/// A variable's id by the name the script uses.
fn variable_id(inp: &Inputs, name: &str) -> Option<i64> {
    if name.eq_ignore_ascii_case("Activity Level") {
        return Some(2027);
    }
    inp.m.variables.values().find(|v| v.label.eq_ignore_ascii_case(name)).map(|v| v.id)
}

/// `Branch.Variable(name).ValueRS(region, scenario, year)`: the value at the branch's scale.
fn value_rs(inp: &Inputs, branch: i64, var: &str, cx: &Cx) -> f64 {
    let Some(v) = variable_id(inp, var) else { return 0.0 };
    let scale = if v == 2027 { 10f64.powi(inp.m.static_value(branch, 349).unwrap_or(0.0) as i32) } else { 1.0 };
    inp.value_in(branch, v, cx.scenario, cx.region, cx.year) * scale
}

fn path_value(inp: &Inputs, path: &str, var: &str, cx: &Cx) -> f64 {
    let resolved = branch_path(inp, path).or_else(|| branch_path(inp, &format!("Key Assumptions\\{path}")));
    resolved.map(|b| value_rs(inp, b, var, cx)).unwrap_or(0.0)
}

fn parent_n(inp: &Inputs, b: i64, n: usize) -> Option<i64> {
    let mut at = b;
    for _ in 0..n {
        at = inp.m.branches.get(&at)?.parent;
    }
    inp.m.branches.contains_key(&at).then_some(at)
}

/// A script function's value in a context, when the port carries it.
pub fn call(inp: &Inputs, name: &str, cx: &Cx) -> Option<f64> {
    match name.trim().to_ascii_lowercase().as_str() {
        "indoordeaths" => Some(indoor_deaths(inp, cx)),
        "baselinemortality" => Some(baseline_mortality(inp, cx)),
        _ => None,
    }
}

fn indoor_deaths(inp: &Inputs, cx: &Cx) -> f64 {
    let m = inp.m;
    let ka = if branch_path(inp, "Key Assumptions\\IBC").is_some() { "Key Assumptions\\IBC\\" } else { "Key Assumptions\\" };
    let Some(ctx) = m.branches.get(&cx.branch) else { return 0.0 };
    if ctx.kind != 38 || !ctx.name.eq_ignore_ascii_case("indoor") {
        return 0.0;
    }
    let (Some(disease_b), Some(age_b), Some(gender_b)) = (parent_n(inp, cx.branch, 1), parent_n(inp, cx.branch, 2), parent_n(inp, cx.branch, 3)) else {
        return 0.0;
    };
    let disease = disease_type(&m.branches[&disease_b].name);
    let out_age = output_age(&m.branches[&age_b].name);
    let gender = gender_type(&m.branches[&gender_b].name);
    if disease < 0 || out_age < 0 || gender < 0 {
        return 0.0;
    }
    let Some(cooking) = branch_path(inp, "Demand\\Residential\\Cooking") else { return 0.0 };
    let rates_root = format!("{ka}Disease Rates\\{}\\{}", m.branches[&gender_b].name, disease_name(disease));
    let ratio = [
        1.0,
        path_value(inp, &format!("{ka}Indoor Pollution\\Child Exposure Ratio"), "Activity Level", cx),
        path_value(inp, &format!("{ka}Indoor Pollution\\Other Adult Exposure Ratio"), "Activity Level", cx),
    ];
    let g = gender_name(gender);
    let pop_types = [format!("{g} Cooks"), format!("{g} Children"), format!("Other {g} Adults")];
    let mut deaths = 0.0;
    for &age in input_ages(out_age) {
        let rate = path_value(inp, &format!("{rates_root}\\{}", age_branch_name(age)), "Activity Level", cx);
        let fraction = path_value(inp, &format!("{ka}Demographics\\Population Fraction\\{}", age_branch_name(age)), "Activity Level", cx);
        for &tech in m.kids(cooking) {
            let expo = value_rs(inp, tech, "Primary Cook Exposure", cx);
            for (k, pt) in pop_types.iter().enumerate() {
                let population = value_rs(inp, tech, pt, cx);
                let exposure = expo * ratio[k];
                let rr = rel_risk_mean(disease, age, exposure, RISK_VERSION);
                if std::env::var("LEAP_DEBUG_SCRIPTS").is_ok() {
                    eprintln!("age {age} tech {tech} pt {k} rate {rate} frac {fraction} expo {expo} ratio {} pop {population} rr {rr}", ratio[k]);
                }
                deaths += rate * ((rr - 1.0) / rr) * population * fraction;
            }
        }
    }
    deaths
}

fn baseline_mortality(inp: &Inputs, cx: &Cx) -> f64 {
    let m = inp.m;
    let Some(ctx) = m.branches.get(&cx.branch) else { return 0.0 };
    if ctx.kind != 10 {
        return 0.0;
    }
    let gender = gender_type(&ctx.name);
    let Some(group) = parent_n(inp, cx.branch, 1) else { return 0.0 };
    let ages: &[i64] = match m.branches[&group].name.to_lowercase().as_str() {
        "adults" => &[30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80],
        "children" => &[5],
        _ => return 0.0,
    };
    if gender < 0 {
        return 0.0;
    }
    // The script leaves its KARoot unset here, so the paths are relative; they resolve under the
    // key assumptions.
    let total = path_value(inp, "Demographics\\Population", "Activity Level", cx);
    let mut deaths = 0.0;
    for &age in ages {
        let fraction = path_value(inp, &format!("Demographics\\Population Fraction\\{}", age_branch_name(age)), "Activity Level", cx);
        let mut gfrac = path_value(inp, &format!("Demographics\\Female Fraction\\{}", age_branch_name(age)), "Activity Level", cx);
        if gender == 1 {
            gfrac = 1.0 - gfrac;
        }
        for disease in 1..=7 {
            if (disease == 2 && age == 5) || (disease != 2 && age != 5) {
                let rate = path_value(
                    inp,
                    &format!("Disease Rates\\{}\\{}\\{}", gender_name(gender), disease_name(disease), age_branch_name(age)),
                    "Activity Level",
                    cx,
                );
                deaths += total * fraction * gfrac * rate;
            }
        }
    }
    deaths
}
