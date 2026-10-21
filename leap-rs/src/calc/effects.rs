//! Environmental loadings and their global warming potentials.

use super::inputs::Inputs;
use super::put;
use crate::results::Results;

/// Result variable ids.
pub mod out {
    pub const POLLUTANT_LOADINGS: i64 = 40;
    pub const GWP_20: i64 = 20;
    pub const GWP_500: i64 = 21;
    pub const GWP_100: i64 = 41;
}

/// An effect's global warming potentials (20, 100 and 500 years), from the area's effects table.
pub fn gwp(inp: &Inputs, effect: i64) -> (f64, f64, f64) {
    let Some(t) = inp.m.table("scenarioeffects") else { return (0.0, 0.0, 0.0) };
    let Some(row) = t.rows.iter().find(|r| t.int(r, "EffectID") == Some(effect)) else {
        return (0.0, 0.0, 0.0);
    };
    (
        t.float(row, "GWP20").unwrap_or(0.0),
        t.float(row, "GWP").unwrap_or(0.0),
        t.float(row, "GWP500").unwrap_or(0.0),
    )
}

/// Store one loading (kg) on an effect branch, with its warming potentials.
pub fn put_loading(inp: &Inputs, results: &mut Results, branch: i64, effect: i64, fuel: i64, year: i32, kg: f64) {
    let (s, r) = (inp.scenario, inp.region);
    put(results, branch, out::POLLUTANT_LOADINGS, s, r, year, fuel, effect, kg);
    let (g20, g100, g500) = gwp(inp, effect);
    put(results, branch, out::GWP_20, s, r, year, fuel, effect, kg * g20);
    put(results, branch, out::GWP_100, s, r, year, fuel, effect, kg * g100);
    put(results, branch, out::GWP_500, s, r, year, fuel, effect, kg * g500);
}

/// The loadings of the effect branches beneath a demand technology, from its energy use: each
/// effect states a loading per unit of energy (or of fuel mass or volume) consumed.
pub fn demand_loadings(inp: &Inputs, results: &mut Results, tech: i64, fuel: i64, energy_gj: f64, year: i32) {
    let m = inp.m;
    for e in m.kids(tech).to_vec() {
        if m.branches[&e].kind != 34 {
            continue;
        }
        let effect = m.branches[&e].effect;
        let num = m.unit_conversion(m.static_or_default(e, 1004) as i64);
        let denom = super::units::to_gj(m, fuel, m.static_or_default(e, 1005) as i64);
        let factor = inp.value(e, 1076, year);
        let kg = if denom == 0.0 { 0.0 } else { energy_gj / denom * factor * num };
        put_loading(inp, results, e, effect, fuel, year, kg);
    }
}

/// The loadings of the effect branches beneath a process feedstock, from the energy it consumes.
pub fn feedstock_loadings(inp: &Inputs, results: &mut Results, feedstock: i64, fuel: i64, energy_gj: f64, year: i32) -> Vec<(i64, f64)> {
    let m = inp.m;
    let mut out = Vec::new();
    for e in m.kids(feedstock).to_vec() {
        if m.branches[&e].kind != 35 {
            continue;
        }
        let effect = m.branches[&e].effect;
        let num = m.unit_conversion(m.static_or_default(e, 1004) as i64);
        let denom = super::units::to_gj(m, fuel, m.static_or_default(e, 1005) as i64);
        let factor = inp.value(e, 1076, year);
        let kg = if denom == 0.0 { 0.0 } else { energy_gj / denom * factor * num };
        put_loading(inp, results, e, effect, fuel, year, kg);
        out.push((effect, kg));
    }
    out
}

/// Non-energy loadings: each effect branch of the Non Energy tree states its loading directly, in
/// the mass unit its activity unit names.
pub fn non_energy(inp: &Inputs, results: &mut Results, year: i32) {
    let m = inp.m;
    for b in m.branches.values().filter(|b| b.kind == 27) {
        let unit = m.unit_conversion(m.static_or_default(b.id, 2023) as i64);
        let kg = inp.value(b.id, 991, year) * unit;
        put_loading(inp, results, b.id, b.effect, 0, year, kg);
    }
}
