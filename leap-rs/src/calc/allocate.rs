//! Primary requirements and emissions allocated back to the demands that caused them.
//!
//! A demand for a fuel is traced down the modules: the first module that produces the fuel meets
//! the part it produced from its processes, in proportion to their outputs, and the part it
//! imported stays a requirement for the fuel itself. A process's share of the demand needs that
//! amount over its efficiency of each feedstock, traced on through the modules below, and carries
//! its emissions per unit of output with it. A fuel no module below produces is primary.

use super::effects;
use super::inputs::Inputs;
use super::put;
use super::transform::ModuleFlow;
use crate::results::{Key, Results};
use std::collections::BTreeMap;

/// Result variable ids.
pub mod out {
    pub const PRIMARY_ALLOCATED: i64 = 35;
    pub const GWP_ALLOCATED: i64 = 104;
    pub const GWP_INDIRECT: i64 = 105;
}

/// Trace `qty` of `fuel` demanded above module `from`.
#[allow(clippy::too_many_arguments)]
pub fn trace(flows: &[ModuleFlow], fuel: i64, qty: f64, from: usize, origin: i64, primary: &mut BTreeMap<i64, f64>, loads: &mut BTreeMap<(i64, i64), f64>, depth: usize) {
    if qty == 0.0 {
        return;
    }
    let found = (from..flows.len()).find(|i| flows[*i].fuels.iter().any(|f| f.0 == fuel));
    let Some(i) = found.filter(|_| depth < 64) else {
        *primary.entry(fuel).or_default() += qty;
        return;
    };
    let flow = &flows[i];
    // Each consumer of the fuel -- final demand, or one module's processes -- is met from the
    // module's production up to the whole of its own requirement; what that leaves short was
    // imported, and stays a requirement for the fuel itself.
    let (_, need, made) = flow.fuels.iter().find(|f| f.0 == fuel).copied().unwrap();
    let asked = flow.origins.get(&(fuel, origin)).copied().unwrap_or(need);
    let fraction = if asked <= 0.0 { 1.0 } else { (made / asked).min(1.0) };
    let produced = qty * fraction;
    if qty - produced != 0.0 {
        *primary.entry(fuel).or_default() += qty - produced;
    }
    let total: f64 = flow.procs.iter().filter(|p| p.fuels.contains(&fuel)).map(|p| p.output).sum();
    if total <= 0.0 {
        *primary.entry(fuel).or_default() += produced;
        return;
    }
    for p in flow.procs.iter().filter(|p| p.fuels.contains(&fuel)) {
        let amount = produced * p.output / total;
        if amount == 0.0 {
            continue;
        }
        let share = amount / p.output;
        for (f, e, kg) in &p.loadings {
            *loads.entry((*f, *e)).or_default() += kg * share;
        }
        let input = if p.eff == 0.0 { 0.0 } else { amount / p.eff };
        for (f, sh) in &p.feeds {
            trace(flows, *f, input * sh, i + 1, i as i64, primary, loads, depth + 1);
        }
    }
}

/// Allocate one year's primary requirements and warming potentials to every demand branch.
pub fn run_year(inp: &Inputs, year: i32, flows: &[ModuleFlow], demands: &[(i64, i64, f64)], read: &Results, results: &mut Results) {
    let (s, r) = (inp.scenario, inp.region);
    let demands = demands.to_vec();
    // The direct part: each fuel's direct warming potential summed over every demand branch, and
    // shared out again in proportion to final energy demand.
    let mut fed_total: BTreeMap<i64, f64> = BTreeMap::new();
    let mut direct_total: BTreeMap<(i64, i64), f64> = BTreeMap::new();
    for (b, fuel, qty) in &demands {
        *fed_total.entry(*fuel).or_default() += qty;
        for ((f, e), v) in direct_of(inp, *b, year, read) {
            let _ = fuel;
            *direct_total.entry((f, e)).or_default() += v;
        }
    }
    for (b, fuel, qty) in demands {
        let mut primary = BTreeMap::new();
        let mut loads = BTreeMap::new();
        trace(flows, fuel, qty, 0, -1, &mut primary, &mut loads, 0);
        for (f, q) in &primary {
            put(results, b, out::PRIMARY_ALLOCATED, s, r, year, *f, -1, *q);
        }
        let total = fed_total.get(&fuel).copied().unwrap_or(0.0);
        let direct: BTreeMap<(i64, i64), f64> = direct_total
            .iter()
            .filter(|((f, _), _)| *f == fuel)
            .map(|(k, v)| (*k, if total == 0.0 { 0.0 } else { v * qty / total }))
            .collect();
        let mut keys: Vec<(i64, i64)> = loads.keys().copied().collect();
        keys.extend(direct.keys().copied());
        keys.sort();
        keys.dedup();
        for (f, e) in keys {
            let gwp = effects::gwp(inp, e).1;
            let indirect = loads.get(&(f, e)).copied().unwrap_or(0.0) * gwp;
            let own = direct.get(&(f, e)).copied().unwrap_or(0.0);
            if gwp == 0.0 && own == 0.0 {
                continue;
            }
            put(results, b, out::GWP_INDIRECT, s, r, year, f, e, indirect);
            put(results, b, out::GWP_ALLOCATED, s, r, year, f, e, indirect + own);
        }
    }
}

/// A demand branch's own 100-year warming potentials, by (fuel, effect).
fn direct_of(inp: &Inputs, b: i64, year: i32, results: &Results) -> BTreeMap<(i64, i64), f64> {
    let (s, r) = (inp.scenario, inp.region);
    let mut direct = BTreeMap::new();
    for e in descendants_of_kind(inp, b, 34) {
        let lo = Key { branch: e, variable: effects::out::GWP_100, scenario: s, region: r, year: year as i64, x1: i64::MIN, x2: i64::MIN };
        let hi = Key { x1: i64::MAX, x2: i64::MAX, ..lo };
        for (k, v) in results.range(lo..=hi) {
            *direct.entry((k.x1, k.x2)).or_default() += v;
        }
    }
    direct
}

fn descendants_of_kind(inp: &Inputs, b: i64, kind: i64) -> Vec<i64> {
    let mut out = Vec::new();
    for k in inp.m.kids(b) {
        if inp.m.branches[k].kind == kind {
            out.push(*k);
        }
        out.extend(descendants_of_kind(inp, *k, kind));
    }
    out
}
