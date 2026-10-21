//! Costs: what demand devices, processes and resources cost each year.
//!
//! Social costs (`Social Costs`, by cost category and by domestic or foreign currency) are
//! undiscounted annual amounts. Demand branches cost their stated demand cost per unit of
//! activity, or -- under the cost-of-saved-energy method -- their stated cost per unit of energy
//! saved against a reference scenario. Processes cost their annualized capital for every vintage
//! of capacity still in its lifetime, a fixed O&M per unit of capacity and a variable O&M on the
//! energy they lose (input less output); their fuel is costed at the resources, and in the
//! module's own cost balance. Resources cost their production, imports and exports.

use super::inputs::Inputs;
use super::put;
use crate::results::{Key, Results};

/// Result variable ids.
pub mod out {
    pub const SOCIAL_COSTS: i64 = 5;
    pub const MODULE_COST_BALANCE: i64 = 86;
    pub const COSTS_OF_PRODUCTION: i64 = 88;
    pub const INVESTMENT: i64 = 103;
}

/// Social cost categories.
pub mod category {
    pub const DEMAND: i64 = 1;
    pub const SAVED_ENERGY: i64 = 2;
    pub const CAPITAL: i64 = 11;
    pub const FIXED_OM: i64 = 12;
    pub const VARIABLE_OM: i64 = 13;
    pub const PRODUCTION: i64 = 20;
    pub const IMPORTS: i64 = 21;
    pub const EXPORTS: i64 = 22;
}

/// Module cost-balance categories.
pub mod production {
    pub const CAPITAL: i64 = 1;
    pub const FIXED_OM: i64 = 2;
    pub const VARIABLE_OM: i64 = 3;
    pub const FUEL: i64 = 6;
    pub const EXTERNALITY: i64 = 8;
}

/// Domestic and foreign currency.
pub const DOMESTIC: i64 = 1;
pub const FOREIGN: i64 = 2;

/// Input variable ids.
pub mod input {
    pub const DEMAND_COST: i64 = 776;
    pub const COST_SCALE: i64 = 774;
    pub const COST_UNIT: i64 = 775;
    pub const COST_METHOD: i64 = 942;
    pub const CSE_SCENARIO: i64 = 988;
    pub const CSE_ENERGY_UNIT: i64 = 989;
    pub const CAPITAL_COST: i64 = 2153;
    pub const FIXED_OM: i64 = 2156;
    pub const VARIABLE_OM: i64 = 2157;
    pub const INTEREST_RATE: i64 = 394;
    pub const LIFETIME: i64 = 393;
    pub const FUEL_COST: i64 = 474;
    pub const PRODUCTION_COST: i64 = 804;
    pub const IMPORT_COST: i64 = 802;
    pub const EXPORT_BENEFIT: i64 = 803;
}

/// The capital recovery factor at a rate (fraction) over a life in years.
pub fn crf(rate: f64, life: f64) -> f64 {
    if life <= 0.0 {
        return 1.0;
    }
    if rate == 0.0 {
        return 1.0 / life;
    }
    let grown = (1.0 + rate).powf(life);
    rate * grown / (grown - 1.0)
}

/// A money amount scale and currency: 10^scale times the currency's conversion.
fn money(inp: &Inputs, branch: i64, scale_var: i64, unit_var: i64) -> f64 {
    let m = inp.m;
    10f64.powi(m.static_or_default(branch, scale_var) as i32) * m.unit_conversion(m.static_or_default(branch, unit_var) as i64)
}

/// A demand branch's demand cost on its activity (the stated-cost method).
pub fn demand(inp: &Inputs, b: i64, activity: f64, year: i32, results: &mut Results) {
    if !inp.has(b, input::DEMAND_COST) || inp.m.static_value(b, input::COST_METHOD) == Some(2.0) {
        return;
    }
    let per = inp.value(b, input::DEMAND_COST, year) * money(inp, b, input::COST_SCALE, input::COST_UNIT);
    put(results, b, out::SOCIAL_COSTS, inp.scenario, inp.region, year, category::DEMAND, DOMESTIC, activity * per);
}

/// The cost of saved energy: every branch under that method, in every scenario, against its
/// reference scenario's final energy demand. Run once all scenarios are calculated.
pub fn saved_energy(m: &crate::data::Model, results: &mut Results) {
    let branches: Vec<i64> = m.branches.keys().copied().filter(|b| m.static_value(*b, input::COST_METHOD) == Some(2.0)).collect();
    let mut adds = Vec::new();
    for &region in &m.regions {
        for &scenario in m.scenarios.keys().filter(|s| **s != crate::data::CURRENT_ACCOUNTS) {
            let inp = Inputs::new(m, scenario, region);
            for &b in &branches {
                let reference = m.static_or_default(b, input::CSE_SCENARIO) as i64;
                let unit = m.static_or_default(b, input::CSE_ENERGY_UNIT) as i64;
                let fuel = inp.fuel_of(b);
                let gj = super::units::to_gj(m, fuel, unit);
                for year in m.years() {
                    let fed = |s: i64| -> f64 {
                        let lo = Key { branch: b, variable: super::var::FINAL_ENERGY_DEMAND, scenario: s, region, year: year as i64, x1: i64::MIN, x2: i64::MIN };
                        let hi = Key { x1: i64::MAX, x2: i64::MAX, ..lo };
                        results.range(lo..=hi).map(|(_, v)| v).sum()
                    };
                    let saved = fed(reference) - fed(scenario);
                    if saved == 0.0 || gj == 0.0 {
                        continue;
                    }
                    let cost = saved / gj * inp.value(b, input::DEMAND_COST, year) * money(&inp, b, input::COST_SCALE, input::COST_UNIT);
                    adds.push((Key { branch: b, variable: out::SOCIAL_COSTS, scenario, region, year: year as i64, x1: category::SAVED_ENERGY, x2: DOMESTIC }, cost));
                }
            }
        }
    }
    results.extend(adds);
}

/// One process's costs in a year.
#[allow(clippy::too_many_arguments)]
pub fn process(
    inp: &Inputs,
    module: i64,
    p: i64,
    year: i32,
    capacity_kw: f64,
    vintages: &[(i32, f64)],
    output: f64,
    input_gj: f64,
    feedstocks: &[(i64, i64, f64)],
    loadings: &[(i64, i64, f64)],
    results: &mut Results,
) {
    let m = inp.m;
    let (s, r) = (inp.scenario, inp.region);
    let per_cap = |scale: i64, unit: i64| -> f64 {
        10f64.powi(m.static_or_default(module, scale) as i32) * m.unit_conversion(m.static_or_default(module, unit) as i64)
            / m.unit_conversion(m.static_or_default(module, 379) as i64)
    };
    // Capital, annualized over each vintage's lifetime.
    let mut capital = 0.0;
    let mut invested = 0.0;
    for (v, kw) in vintages {
        let life = inp.value(p, input::LIFETIME, *v);
        if year < *v || (year as f64) >= *v as f64 + life {
            continue;
        }
        let cost = inp.value(p, input::CAPITAL_COST, *v) * per_cap(395, 396) * kw;
        let rate = inp.value(p, input::INTEREST_RATE, *v) / 100.0;
        capital += cost * crf(rate, life);
        if *v == year {
            invested += cost;
        }
    }
    let fixed = inp.value(p, input::FIXED_OM, year) * per_cap(397, 398) * capacity_kw;
    let var_unit = super::units::to_gj(m, -1, m.static_or_default(module, 475) as i64);
    // Variable O&M is charged on the output, or -- where the module sets LVarOMCostPerOutput --
    // on the energy the process loses (input less output); Freedonia's modules set it and the
    // Optimization Exercise's do not, and both match only this way.
    let basis = if m.static_or_default(module, 874) != 0.0 { input_gj - output } else { output };
    let variable = if var_unit == 0.0 {
        0.0
    } else {
        inp.value(p, input::VARIABLE_OM, year) * money(inp, module, 399, 400) * basis / var_unit
    };
    let externality: f64 = loadings.iter().map(|(_, e, kg)| kg * externality_per_kg(inp, *e, year)).sum();
    let mut fuel = 0.0;
    for (fb, f, used) in feedstocks {
        if !inp.has(*fb, input::FUEL_COST) {
            continue;
        }
        let unit = m.static_value(*fb, 478).unwrap_or_else(|| m.static_or_default(module, 478)) as i64;
        let gj = super::units::to_gj(m, *f, unit);
        if gj != 0.0 {
            fuel += used / gj * inp.value(*fb, input::FUEL_COST, year) * money(inp, module, 476, 477);
        }
    }
    for (cat, socialcat, v) in [
        (production::CAPITAL, category::CAPITAL, capital),
        (production::FIXED_OM, category::FIXED_OM, fixed),
        (production::VARIABLE_OM, category::VARIABLE_OM, variable),
        (production::FUEL, 0, fuel),
        (production::EXTERNALITY, 0, externality),
    ] {
        put(results, p, out::COSTS_OF_PRODUCTION, s, r, year, cat, -1, v);
        put(results, p, out::MODULE_COST_BALANCE, s, r, year, cat, -1, -v);
        if socialcat != 0 {
            put(results, p, out::SOCIAL_COSTS, s, r, year, socialcat, DOMESTIC, v);
        }
    }
    if invested != 0.0 {
        put(results, p, out::INVESTMENT, s, r, year, 2, DOMESTIC, invested);
    }
}

/// The externality cost of one kilogram of an effect: the Effects tree branch for the effect
/// states it per its constraint unit and scale.
pub fn externality_per_kg(inp: &Inputs, effect: i64, year: i32) -> f64 {
    let m = inp.m;
    let Some(b) = m.branches.values().find(|b| b.kind == 39 && b.effect == effect) else { return 0.0 };
    if !inp.has(b.id, 2267) {
        return 0.0;
    }
    let per = 10f64.powi(m.static_or_default(b.id, 2235) as i32) * m.unit_conversion(m.static_or_default(b.id, 2236) as i64);
    if per == 0.0 { 0.0 } else { inp.value(b.id, 2267, year) / per }
}

/// A resource's costs: production at its production cost, imports at their import cost, exports
/// at their export benefit (negative), each per the denominator unit it states.
pub fn resource(inp: &Inputs, b: i64, fuel: i64, year: i32, production: f64, imports: f64, exports: f64, results: &mut Results) {
    let m = inp.m;
    let (s, r) = (inp.scenario, inp.region);
    let base_unit = m.static_or_default(b, 608) as i64;
    let per = |amount: f64, cost_var: i64, denom_var: i64, scale_var: i64, unit_var: i64| -> f64 {
        let unit = m.static_value(b, denom_var).map(|u| u as i64).unwrap_or(base_unit);
        let gj = super::units::to_gj(m, fuel, unit);
        if gj == 0.0 || amount == 0.0 {
            return 0.0;
        }
        amount / gj * inp.value(b, cost_var, year) * money(inp, b, scale_var, unit_var)
    };
    put(results, b, out::SOCIAL_COSTS, s, r, year, category::PRODUCTION, DOMESTIC, per(production, input::PRODUCTION_COST, 608, 809, 810));
    put(results, b, out::SOCIAL_COSTS, s, r, year, category::IMPORTS, FOREIGN, per(imports, input::IMPORT_COST, 868, 805, 806));
    put(results, b, out::SOCIAL_COSTS, s, r, year, category::EXPORTS, FOREIGN, -per(exports, input::EXPORT_BENEFIT, 869, 807, 808));
}
