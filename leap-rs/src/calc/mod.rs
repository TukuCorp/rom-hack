//! The LEAP calculation: an area's inputs to the results LEAP reports.
//!
//! `inputs` values any input variable of any branch in any scenario, region and year, the way the
//! program does: a year past the base year reads the first scenario along the inheritance chain
//! that states an expression, falling back on Current Accounts and then on the variable's default;
//! the base year reads Current Accounts. The modules beside it turn those inputs into the result
//! variables `results::Key` names, each one held to LEAP's own regression results.

pub mod inputs;
pub mod allocate;
pub mod costs;
pub mod demand;
pub mod effects;
pub mod scripts;
pub mod stock;
pub mod transform;
pub mod units;

use crate::data::Model;
use crate::results::{Key, Results};

/// Result variable ids, as `_dictionaryNX`'s `ResultDimensions` numbers them.
pub mod var {
    pub const FINAL_ENERGY_DEMAND: i64 = 30;
    pub const USEFUL_ENERGY_DEMAND: i64 = 31;
    pub const GROSS_ENERGY: i64 = 125;
    pub const ACTIVITY_LEVEL: i64 = 2027;
    pub const INDICATOR: i64 = 2174;
}

/// Every result the port calculates for an area, all scenarios and regions.
pub fn run(m: &Model) -> Results {
    let mut out = Results::new();
    let scenarios: Vec<i64> = m.scenarios.keys().copied().filter(|s| *s != crate::data::CURRENT_ACCOUNTS).collect();
    for &region in &m.regions {
        for &scenario in &scenarios {
            let inputs = inputs::Inputs::new(m, scenario, region);
            // Demand first, for every year; then year by year the transformation, the allocation
            // back to demands and the non-energy loadings, each reading only its own year.
            let mut own = Results::new();
            demand::run(&inputs, &mut own);
            let mut demands: std::collections::BTreeMap<i64, Vec<(i64, i64, f64)>> = std::collections::BTreeMap::new();
            for (k, v) in &own {
                if k.variable == var::FINAL_ENERGY_DEMAND {
                    demands.entry(k.year).or_default().push((k.branch, k.x1, *v));
                }
            }
            inputs.publish_all(&own);
            let mut state = transform::State::default();
            for year in m.years() {
                let list = demands.get(&(year as i64)).cloned().unwrap_or_default();
                let mut by_fuel = std::collections::BTreeMap::new();
                for (_, fuel, qty) in &list {
                    *by_fuel.entry(*fuel).or_insert(0.0) += qty;
                }
                let mut this = Results::new();
                let ledger = transform::run_year(&inputs, year, &by_fuel, &mut state, &mut this);
                allocate::run_year(&inputs, year, &ledger.flows, &list, &own, &mut this);
                inputs.publish_all(&this);
                effects::non_energy(&inputs, &mut this, year);
                indicators(&inputs, year, &mut this);
                own.extend(this);
            }
            out.extend(own);
        }
    }
    costs::saved_energy(m, &mut out);
    out
}

/// Indicator branches report the value of their Indicator variable.
fn indicators(inp: &inputs::Inputs, year: i32, results: &mut Results) {
    for &(b, v) in inp.m.exprs.keys() {
        if v == var::INDICATOR {
            // Static 2176 states the scale the indicator is entered at.
            let scale = 10f64.powi(inp.m.static_value(b, 2176).unwrap_or(0.0) as i32);
            put(results, b, var::INDICATOR, inp.scenario, inp.region, year, -1, -1, inp.value(b, v, year) * scale);
        }
    }
}

/// Store one result.
pub fn put(out: &mut Results, branch: i64, variable: i64, scenario: i64, region: i64, year: i32, x1: i64, x2: i64, value: f64) {
    out.insert(Key { branch, variable, scenario, region, year: year as i64, x1, x2 }, value);
}
