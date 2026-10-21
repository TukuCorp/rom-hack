//! Demand: activity levels multiplied down the tree, times the energy intensity of each technology.

use super::inputs::Inputs;
use super::{put, var};
use crate::results::Results;

/// Input variable ids (the program dictionary's `Variables`).
pub mod input {
    pub const ACTIVITY_LEVEL: i64 = 2027;
    /// Static: the unit a branch's activity is stated in.
    pub const ACTIVITY_UNIT: i64 = 2023;
    pub const FINAL_ENERGY_INTENSITY: i64 = 2040;
    /// Static: the scale exponent of a branch's activity level (6 million, -2 percent).
    pub const NUM_SCALE: i64 = 349;
    /// Static: a technology's fuel.
    pub const FUEL_ID: i64 = 2031;
    /// Static: the energy unit a technology's intensity is stated in.
    pub const ENERGY_UNIT: i64 = 2032;
    /// Static: set (-1) when a category states the intensity for its children.
    pub const INTENSITY_HERE: i64 = 296;
    pub const FUEL_SHARE: i64 = 308;
    /// Static: set (-1) when a category is analysed in useful energy.
    pub const USEFUL_METHOD: i64 = 307;
    pub const USEFUL_ENERGY_INTENSITY: i64 = 318;
    pub const EFFICIENCY: i64 = 2039;
    /// Static: whether a useful-energy category's base year is stated in final energy.
    pub const FINAL_BASE_YEAR: i64 = 994;
    /// Static: the demand method (2: transport stock turnover).
    pub const DEMAND_METHOD: i64 = 1301;
    /// The total energy method's energy and its scale exponent.
    pub const TOTAL_ENERGY: i64 = 2042;
    pub const TOTAL_ENERGY_SCALE: i64 = 351;
}

/// The "No data" activity unit: a branch measured in it carries no activity level of its own.
pub const NO_DATA_UNIT: f64 = 95.0;

/// Branch types.
pub mod kind {
    pub const DEMAND: i64 = 14;
    pub const CATEGORY: i64 = 1;
    pub const TECHNOLOGY: i64 = 4;
}

/// The demand results of one scenario and region, every year.
pub fn run(inp: &Inputs, out: &mut Results) {
    let m = inp.m;
    let roots: Vec<i64> = m.branches.values().filter(|b| b.kind == kind::DEMAND).map(|b| b.id).collect();
    for year in m.years() {
        for root in &roots {
            walk(inp, *root, 1.0, year, out);
        }
    }
}

/// The scale an energy intensity is stated at (10^static 351: -6 is per million activity units).
pub fn intensity_scale(inp: &Inputs, branch: i64) -> f64 {
    10f64.powi(inp.m.static_value(branch, input::TOTAL_ENERGY_SCALE).unwrap_or(0.0) as i32)
}

/// A branch's activity level as a multiplier: the stated value at its scale.
pub fn activity_factor(inp: &Inputs, branch: i64, year: i32) -> Option<f64> {
    if !inp.has(branch, input::ACTIVITY_LEVEL) {
        return None;
    }
    let scale = inp.m.static_value(branch, input::NUM_SCALE).unwrap_or(0.0);
    Some(inp.value(branch, input::ACTIVITY_LEVEL, year) * 10f64.powi(scale as i32))
}

fn walk(inp: &Inputs, branch: i64, parent: f64, year: i32, out: &mut Results) {
    let m = inp.m;
    let kind = m.branches.get(&branch).map(|b| b.kind).unwrap_or(0);
    // A branch with no activity unit ("No data") passes its parent's activity through; any other
    // branch that states no activity level has none.
    let activity = match activity_factor(inp, branch, year) {
        Some(f) => parent * f,
        None if m.static_value(branch, input::ACTIVITY_UNIT) == Some(NO_DATA_UNIT) || kind == kind::DEMAND => parent,
        None if kind == kind::TECHNOLOGY || kind == kind::CATEGORY => 0.0,
        None => parent,
    };
    inp.set_activity(branch, year, activity);
    // A stock-turnover category: the whole time series at once, from the base year.
    if m.static_value(branch, input::DEMAND_METHOD) == Some(2.0)
        && (inp.has(branch, super::stock::input::STOCK) || inp.has(branch, super::stock::input::SALES))
    {
        if year == m.base_year {
            super::stock::category(inp, branch, out);
        }
        return;
    }
    if kind == kind::TECHNOLOGY {
        technology(inp, branch, activity, year, out);
        return;
    }
    // Useful-energy analysis: the category states a useful intensity and its children the shares
    // of useful energy each fuel meets at its efficiency.
    if m.static_value(branch, input::USEFUL_METHOD).unwrap_or(0.0) != 0.0
        && m.static_value(branch, input::INTENSITY_HERE).unwrap_or(0.0) != 0.0
    {
        useful(inp, branch, activity, year, out);
        return;
    }
    // An intensity stated on the category itself: its children split it by fuel share.
    if m.static_value(branch, input::INTENSITY_HERE).unwrap_or(0.0) != 0.0
        && inp.has(branch, input::FINAL_ENERGY_INTENSITY)
    {
        let fei = inp.value(branch, input::FINAL_ENERGY_INTENSITY, year) * intensity_scale(inp, branch);
        let unit = m.static_value(branch, input::ENERGY_UNIT).unwrap_or(7.0) as i64;
        for k in m.kids(branch).to_vec() {
            let fuel = m.static_value(k, input::FUEL_ID).unwrap_or(-1.0) as i64;
            let share = inp.value(k, input::FUEL_SHARE, year) / 100.0;
            let own = activity_factor(inp, k, year).unwrap_or(1.0);
            inp.set_activity(k, year, activity * own);
            let fed = activity * own * fei * super::units::to_gj(m, fuel, unit) * share;
            put(out, k, var::FINAL_ENERGY_DEMAND, inp.scenario, inp.region, year, fuel, -1, fed);
            put(out, k, var::GROSS_ENERGY, inp.scenario, inp.region, year, fuel, -1, fed);
            super::effects::demand_loadings(inp, out, k, fuel, fed, year);
            super::costs::demand(inp, k, activity * own, year, out);
        }
        return;
    }
    for k in m.kids(branch).to_vec() {
        walk(inp, k, activity, year, out);
    }
}

fn technology(inp: &Inputs, branch: i64, activity: f64, year: i32, out: &mut Results) {
    let m = inp.m;
    let fuel = m.static_value(branch, input::FUEL_ID).unwrap_or(-1.0) as i64;
    let unit = m.static_value(branch, input::ENERGY_UNIT).unwrap_or(7.0) as i64;
    let to_gj = super::units::to_gj(m, fuel, unit);
    let fed = if m.static_value(branch, input::DEMAND_METHOD) == Some(3.0) {
        // The total energy method: the energy is stated outright, at its own scale.
        let scale = 10f64.powi(m.static_or_default(branch, input::TOTAL_ENERGY_SCALE) as i32);
        inp.value(branch, input::TOTAL_ENERGY, year) * scale * to_gj
    } else {
        if !inp.has(branch, input::FINAL_ENERGY_INTENSITY) {
            return;
        }
        activity * inp.value(branch, input::FINAL_ENERGY_INTENSITY, year) * intensity_scale(inp, branch) * to_gj
    };
    put(out, branch, var::FINAL_ENERGY_DEMAND, inp.scenario, inp.region, year, fuel, -1, fed);
    put(out, branch, var::GROSS_ENERGY, inp.scenario, inp.region, year, fuel, -1, fed);
    super::effects::demand_loadings(inp, out, branch, fuel, fed, year);
    super::costs::demand(inp, branch, activity, year, out);
}

/// A useful-energy category: base-year final intensity and fuel shares give the useful intensity
/// and each fuel's share of useful energy; later years read those as their base values, and each
/// fuel's final demand is its useful energy over its efficiency.
fn useful(inp: &Inputs, branch: i64, activity: f64, year: i32, out: &mut Results) {
    let m = inp.m;
    let kids: Vec<i64> = m.kids(branch).to_vec();
    let base = m.base_year;
    let eff = |k: i64, y: i32| -> f64 {
        if inp.has(k, input::EFFICIENCY) { inp.value(k, input::EFFICIENCY, y) / 100.0 } else { 1.0 }
    };
    // A base year stated in final energy (the default) derives the useful intensity and the
    // useful shares; one stated in useful energy (LFinalBaseYear off) states them itself.
    let final_base = m.static_value(branch, input::FINAL_BASE_YEAR) != Some(0.0);
    if year == base && final_base {
        let shares: Vec<f64> = kids.iter().map(|k| inp.value(*k, input::FUEL_SHARE, base) / 100.0 * eff(*k, base)).collect();
        let sum: f64 = shares.iter().sum();
        let fei = inp.value(branch, input::FINAL_ENERGY_INTENSITY, base);
        inp.set_base(branch, input::USEFUL_ENERGY_INTENSITY, fei * sum);
        for (k, share) in kids.iter().zip(&shares) {
            let scale = 10f64.powi(m.static_value(*k, input::NUM_SCALE).unwrap_or(0.0) as i32);
            inp.set_base(*k, input::ACTIVITY_LEVEL, if sum == 0.0 { 0.0 } else { share / sum / scale });
        }
    }
    let uei = inp.value(branch, input::USEFUL_ENERGY_INTENSITY, year);
    let unit = m.static_value(branch, input::ENERGY_UNIT).unwrap_or(7.0) as i64;
    for k in kids {
        let fuel = m.static_value(k, input::FUEL_ID).unwrap_or(-1.0) as i64;
        let share = activity_factor(inp, k, year).unwrap_or(0.0);
        inp.set_activity(k, year, activity * share);
        let useful = activity * uei * super::units::to_gj(m, fuel, unit) * share;
        let e = eff(k, year);
        let fed = if e == 0.0 { 0.0 } else { useful / e };
        put(out, k, var::USEFUL_ENERGY_DEMAND, inp.scenario, inp.region, year, fuel, -1, useful);
        put(out, k, var::FINAL_ENERGY_DEMAND, inp.scenario, inp.region, year, fuel, -1, fed);
        put(out, k, var::GROSS_ENERGY, inp.scenario, inp.region, year, fuel, -1, fed);
        super::effects::demand_loadings(inp, out, k, fuel, fed, year);
        super::costs::demand(inp, k, activity * share, year, out);
    }
}
