//! Stock turnover: devices tracked by vintage, as the transport analysis method runs it.
//!
//! A category states its total stock in the base year (`Stock`) and its sales each year (`Sales`);
//! each technology beneath it takes a share of both (`Stock Share`, `Sales Share`, multiplied down
//! the tree). The base-year stock is spread over the vintages before the base year by the
//! technology's stock-vintage profile -- a share of the stock per age -- and that year's sales form
//! the base-year vintage. From then on each vintage ages along the survival profile, a vintage of
//! age `a` keeping `S(a) / S(a-1)` of what it held the year before, and each year's sales enter as
//! a new vintage. A device beneath the technology drives each vehicle its mileage, degraded by age
//! along the mileage profile, at the fuel economy its vintage was sold with.

use super::inputs::Inputs;
use super::{put, var};
use crate::results::Results;
use std::collections::BTreeMap;

/// Input variable ids.
pub mod input {
    pub const STOCK: i64 = 940;
    pub const SALES: i64 = 958;
    pub const SALES_SCALE: i64 = 936;
    pub const STOCK_SCALE: i64 = 937;
    pub const SALES_SHARE: i64 = 1424;
    pub const STOCK_SHARE: i64 = 1428;
    pub const FUEL_ECONOMY: i64 = 1061;
    pub const FUEL_ECONOMY_UNIT: i64 = 1303;
    pub const FUEL_ECONOMY_CORRECTION: i64 = 1661;
    pub const MILEAGE: i64 = 1185;
    pub const MILEAGE_UNIT: i64 = 1193;
    pub const MILEAGE_SCALE: i64 = 1194;
    pub const DEVICE_SHARE: i64 = 2165;
    pub const USAGE_FACTOR: i64 = 2184;
    /// Lifecycle profiles, stated as data on the branch or as a static setting.
    pub const MILEAGE_PROFILE: (i64, i64) = (2340, 1186);
    pub const SURVIVAL_PROFILE: (i64, i64) = (2342, 1297);
    pub const VINTAGE_PROFILE: (i64, i64) = (2344, 1308);
    pub const EFFECT_PROFILE: (i64, i64) = (2341, 1127);
    pub const NEW_DEVICE_LOADING: i64 = 1077;
    pub const AVG_LOADING: i64 = 1076;
    pub const LOADING_NUM_UNIT: i64 = 1004;
    pub const LOADING_DENOM_UNIT: i64 = 1005;
    pub const PER_UNIT_TYPE: i64 = 1128;
}

/// Branch types.
pub mod kind {
    pub const TECHNOLOGY: i64 = 4;
    pub const DEVICE: i64 = 36;
    pub const EFFECT: i64 = 34;
}

/// Result variable ids.
pub mod out {
    pub const DEVICE_STOCKS: i64 = 60;
    pub const DEVICE_SALES: i64 = 61;
    pub const VEHICLE_DISTANCE: i64 = 62;
    pub const STOCK_FUEL_ECONOMY: i64 = 64;
    pub const NEW_FUEL_ECONOMY: i64 = 66;
    pub const STOCK_MILEAGE: i64 = 67;
    pub const NEW_MILEAGE: i64 = 68;
    pub const SCRAPPAGE: i64 = 81;
    pub const RETIREMENTS: i64 = 85;
}

/// The fuel economy unit class's base is miles per US gallon of gasoline equivalent; one MJ/100 km
/// unit is this many base units over the value (the units table's own conversion).
const MJ_PER_100KM_AT_1_MPGE: f64 = 7797.834312;

/// A lifecycle profile id a branch states, as data or as a static setting.
pub fn profile_id(inp: &Inputs, branch: i64, ids: (i64, i64)) -> Option<i64> {
    if inp.has(branch, ids.0) {
        return Some(inp.value(branch, ids.0, inp.m.base_year) as i64);
    }
    inp.m.static_value(branch, ids.1).map(|v| v as i64).filter(|v| *v > 0)
}

/// A profile's value at an age, as a fraction; past its last age, its last value or (`ends`) zero.
pub fn profile_at(inp: &Inputs, id: Option<i64>, age: i64, ends: bool) -> f64 {
    let Some(id) = id else { return 1.0 };
    let p = inp.m.profile(id);
    match p.iter().find(|(t, _)| *t == age) {
        Some((_, v)) => v / 100.0,
        None if ends => 0.0,
        None => p.last().map(|(_, v)| v / 100.0).unwrap_or(1.0),
    }
}

/// The technologies (and devices) of a stock category, with the share path to each.
fn technologies(inp: &Inputs, cat: i64) -> Vec<(i64, Vec<i64>)> {
    let mut out = Vec::new();
    fn walk(inp: &Inputs, b: i64, path: &mut Vec<i64>, out: &mut Vec<(i64, Vec<i64>)>) {
        for k in inp.m.kids(b).to_vec() {
            let kind = inp.m.branches[&k].kind;
            path.push(k);
            if kind == kind::TECHNOLOGY {
                out.push((k, path.clone()));
            } else if kind == super::demand::kind::CATEGORY {
                walk(inp, k, path, out);
            }
            path.pop();
        }
    }
    walk(inp, cat, &mut Vec::new(), &mut out);
    out
}

/// A fuel economy in its stated unit as gigajoules per kilometre.
pub fn gj_per_km(inp: &Inputs, value: f64, unit: i64) -> f64 {
    let u = inp.m.units.get(&unit);
    let conv = u.map(|u| u.conversion).unwrap_or(1.0);
    let inverse = u.is_some_and(|u| u.inverse);
    let mpge = if inverse { conv / value } else { value * conv };
    MJ_PER_100KM_AT_1_MPGE / mpge / 100.0 / 1000.0
}

/// Kilometres per one of a distance denominator unit. The transport class states a vehicle-mile
/// as 1.609 km, but LEAP's per-mile loadings read the statute mile the length class states
/// (1.609344): the Transport Exercise's CO, NOx and PM10 match only at that.
pub fn vehicle_distance_km(inp: &Inputs, unit: i64) -> f64 {
    let Some(u) = inp.m.units.get(&unit) else { return 1.0 };
    if u.class == 14 && u.name.to_lowercase().contains("mile") {
        return inp.m.units.values().find(|l| l.class == 4 && l.name == "Mile").map(|l| l.conversion).unwrap_or(1.609344);
    }
    if u.class == 14 {
        return 1.0;
    }
    u.conversion
}

/// A stock category's results, every year.
pub fn category(inp: &Inputs, cat: i64, out: &mut Results) {
    let m = inp.m;
    let base = m.base_year;
    let (s, r) = (inp.scenario, inp.region);
    let sales_scale = 10f64.powi(m.static_or_default(cat, input::SALES_SCALE) as i32);
    let stock_scale = 10f64.powi(m.static_or_default(cat, input::STOCK_SCALE) as i32);
    for (t, path) in technologies(inp, cat) {
        let sales = |y: i32| -> f64 {
            let mut v = inp.value(cat, input::SALES, y) * sales_scale;
            for p in &path {
                v *= inp.value(*p, input::SALES_SHARE, y) / 100.0;
            }
            v
        };
        let mut base_stock = inp.value(cat, input::STOCK, base) * stock_scale;
        for p in &path {
            base_stock *= inp.value(*p, input::STOCK_SHARE, base) / 100.0;
        }
        let vintage_profile = profile_id(inp, t, input::VINTAGE_PROFILE);
        let survival = profile_id(inp, t, input::SURVIVAL_PROFILE);
        let oldest = vintage_profile.map(|id| m.profile(id).iter().map(|(a, _)| *a).max().unwrap_or(0)).unwrap_or(0);
        let first = base - oldest as i32 - 1;

        // Stock by vintage, every year.
        let mut stock: BTreeMap<i32, f64> = BTreeMap::new();
        let mut by_year: Vec<(i32, BTreeMap<i32, f64>, f64)> = Vec::new();
        for y in m.years() {
            let sold = sales(y);
            if y == base {
                for a in 1..=oldest {
                    stock.insert(base - a as i32, base_stock * profile_at(inp, vintage_profile, a, true));
                }
            } else {
                for (v, st) in stock.iter_mut() {
                    let a = (y - v) as i64;
                    let prev = profile_at(inp, survival, a - 1, true);
                    let now = profile_at(inp, survival, a, true);
                    *st = if prev == 0.0 { 0.0 } else { *st * now / prev };
                }
            }
            stock.insert(y, sold);
            by_year.push((y, stock.clone(), sold));
        }

        let mut prev_total = None;
        for (y, st, sold) in &by_year {
            let total: f64 = st.values().sum();
            put(out, t, out::DEVICE_SALES, s, r, *y, -1, -1, *sold);
            put(out, t, out::SCRAPPAGE, s, r, *y, -1, -1, 0.0);
            if let Some(p) = prev_total {
                put(out, t, out::RETIREMENTS, s, r, *y, -1, -1, p + sold - total);
            }
            prev_total = Some(total);
            for v in first..=m.end_year {
                put(out, t, out::DEVICE_STOCKS, s, r, *y, v as i64, -1, st.get(&v).copied().unwrap_or(0.0));
            }
        }

        // Devices: distance, energy and loadings.
        for d in m.kids(t).to_vec() {
            if m.branches[&d].kind != kind::DEVICE {
                continue;
            }
            device(inp, t, d, &by_year, out);
        }
    }
}

fn device(inp: &Inputs, t: i64, d: i64, by_year: &[(i32, BTreeMap<i32, f64>, f64)], out: &mut Results) {
    let m = inp.m;
    let base = m.base_year;
    let (s, r) = (inp.scenario, inp.region);
    let fuel = m.static_value(d, super::demand::input::FUEL_ID).unwrap_or(-1.0) as i64;
    let mileage_unit = m.static_value(d, input::MILEAGE_UNIT).or(m.static_value(t, input::MILEAGE_UNIT)).unwrap_or_else(|| m.static_or_default(d, input::MILEAGE_UNIT)) as i64;
    let mileage_scale = 10f64.powi(m.static_or_default(d, input::MILEAGE_SCALE) as i32);
    let km = m.unit_conversion(mileage_unit) * mileage_scale;
    let mileage_profile = profile_id(inp, d, input::MILEAGE_PROFILE);
    let fe_unit = m.static_or_default(d, input::FUEL_ECONOMY_UNIT) as i64;
    let share = |y: i32| inp.value(d, input::DEVICE_SHARE, y) / 100.0;
    let usage = |y: i32| if inp.has(d, input::USAGE_FACTOR) { inp.value(d, input::USAGE_FACTOR, y) } else { 1.0 };
    let new_mileage = |y: i32| inp.value(d, input::MILEAGE, y.max(base)) * km;
    let fei = |v: i32| -> f64 {
        let y = v.max(base);
        let fe = inp.value(d, input::FUEL_ECONOMY, y);
        let correction = if inp.has(d, input::FUEL_ECONOMY_CORRECTION) { inp.value(d, input::FUEL_ECONOMY_CORRECTION, y) } else { 1.0 };
        gj_per_km(inp, fe, fe_unit) / correction
    };
    let to_mj100 = |gj_km: f64| gj_km * 1000.0 * 100.0;

    // Per year: distance and energy by vintage.
    let mut per_year: Vec<(i32, Vec<(i32, f64, f64)>)> = Vec::new();
    for (y, st, _) in by_year {
        let mut rows = Vec::new();
        for (v, n) in st {
            let a = (y - v) as i64;
            let dist = n * new_mileage(*v) * profile_at(inp, mileage_profile, a, false) * share(*y) * usage(*y);
            rows.push((*v, dist, dist * fei(*v)));
        }
        per_year.push((*y, rows));
    }
    for (y, rows) in &per_year {
        let total_stock: f64 = by_year.iter().find(|(yy, ..)| yy == y).map(|(_, st, _)| st.values().sum()).unwrap_or(0.0);
        let dist: f64 = rows.iter().map(|r| r.1).sum();
        let energy: f64 = rows.iter().map(|r| r.2).sum();
        put(out, t, var::FINAL_ENERGY_DEMAND, s, r, *y, fuel, -1, energy);
        put(out, t, var::GROSS_ENERGY, s, r, *y, fuel, -1, energy);
        put(out, t, out::VEHICLE_DISTANCE, s, r, *y, -1, -1, dist);
        put(out, t, out::STOCK_MILEAGE, s, r, *y, -1, -1, if total_stock == 0.0 { 0.0 } else { dist / total_stock });
        put(out, t, out::NEW_MILEAGE, s, r, *y, -1, -1, new_mileage(*y));
        put(out, t, out::STOCK_FUEL_ECONOMY, s, r, *y, -1, -1, if dist == 0.0 { 0.0 } else { to_mj100(energy / dist) });
        put(out, t, out::NEW_FUEL_ECONOMY, s, r, *y, -1, -1, to_mj100(fei(*y)));
    }

    // Environmental loadings of the device.
    for e in m.kids(d).to_vec() {
        if m.branches[&e].kind != kind::EFFECT {
            continue;
        }
        let effect = m.branches[&e].effect;
        let per = m.static_or_default(e, input::PER_UNIT_TYPE) as i64;
        let num = m.unit_conversion(m.static_or_default(e, input::LOADING_NUM_UNIT) as i64);
        let denom_unit = m.static_or_default(e, input::LOADING_DENOM_UNIT) as i64;
        let denom = match per {
            0 => super::units::to_gj(m, fuel, denom_unit),
            _ => vehicle_distance_km(inp, denom_unit),
        };
        let degradation = profile_id(inp, e, input::EFFECT_PROFILE);
        for (y, rows) in &per_year {
            let mut kg = 0.0;
            for (v, dist, energy) in rows {
                let a = (y - v) as i64;
                let factor = inp.value(e, input::NEW_DEVICE_LOADING, *v) * profile_at(inp, degradation, a, false);
                let amount = if per == 0 { energy / denom } else { dist / denom };
                kg += amount * factor * num;
            }
            super::effects::put_loading(inp, out, e, effect, fuel, *y, kg);
        }
    }
    let _ = (s, r);
}
