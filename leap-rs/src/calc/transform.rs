//! Transformation and resources: requirements passed from final demand down the module tree to
//! primary supply.
//!
//! Modules are calculated in tree order, starting with the one nearest final demand. A module is
//! asked for the requirements on its output fuels; its processes are dispatched to meet them (or
//! run their historical production before their first simulation year); a shortfall is imported or
//! left unmet, a surplus exported; and the inputs the processes need become requirements on the
//! modules below. What is left after the last module is met by the resources: indigenous
//! production where the resource allows it, imports otherwise.

use super::inputs::Inputs;
use super::put;
use crate::results::Results;
use std::collections::BTreeMap;

/// Branch types.
pub mod kind {
    pub const TRANSFORMATION: i64 = 50;
    pub const MODULE: i64 = 2;
    pub const PROCESS: i64 = 3;
    pub const PROCESSES: i64 = 5;
    pub const OUTPUT_FUELS: i64 = 6;
    pub const OUTPUT_FUEL: i64 = 7;
    pub const FEEDSTOCKS: i64 = 32;
    pub const FEEDSTOCK: i64 = 33;
    pub const AUXILIARIES: i64 = 30;
    pub const RESOURCE: i64 = 15;
}

/// Input variable ids.
pub mod input {
    pub const SIMPLE: i64 = 1536;
    pub const EFFICIENCY_METHOD: i64 = 579;
    pub const OUTPUT_CAPACITY: i64 = 484;
    pub const HAS_CAPACITY: i64 = 2257;
    pub const ENDOGENOUS_OUTPUT_SHARES: i64 = 377;
    pub const CAPACITY_UNIT: i64 = 379;
    pub const CAPACITY_SCALE: i64 = 389;
    pub const HISTORICAL_UNIT: i64 = 441;
    pub const HISTORICAL_SCALE: i64 = 440;
    pub const LOAD_CURVE: i64 = 485;
    pub const SIMPLE_OUTPUT_FUEL: i64 = 1535;
    pub const OUTPUT_FUEL_ID: i64 = 2126;
    pub const FEEDSTOCK_FUEL_ID: i64 = 1033;
    pub const RESOURCE_FUEL_ID: i64 = 561;
    pub const OUTPUT_SHARE: i64 = 418;
    pub const IMPORT_TARGET: i64 = 420;
    pub const EXPORT_TARGET: i64 = 421;
    pub const SHORTFALL_RULE: i64 = 387;
    pub const SHORTFALL_RULE_DATA: i64 = 2334;
    pub const SURPLUS_RULE: i64 = 388;
    pub const LOSSES: i64 = 539;
    pub const PROCESS_EFFICIENCY: i64 = 2146;
    pub const PROCESS_SHARE: i64 = 2147;
    pub const DISPATCH_RULE: i64 = 1671;
    pub const FIRST_SIMULATION_YEAR: i64 = 1672;
    pub const EXOGENOUS_CAPACITY: i64 = 2145;
    pub const MAX_AVAILABILITY: i64 = 2150;
    pub const MERIT_ORDER: i64 = 1679;
    pub const CAPACITY_CREDIT: i64 = 910;
    pub const HISTORICAL_PRODUCTION: i64 = 2148;
    pub const FEEDSTOCK_SHARE: i64 = 1036;
    pub const ENDOGENOUS_CAPACITY: i64 = 506;
    pub const ADDITION_ORDER: i64 = 512;
    pub const ALLOW_UNPLANNED: i64 = 513;
    pub const LIFETIME: i64 = 393;
    pub const PLANNING_RESERVE_MARGIN: i64 = 909;
    pub const SYSTEM_PEAK_LOAD_SHAPE: i64 = 2246;
    pub const SYSTEM_LOAD_SHAPE: i64 = 2021;
    pub const BASE_YEAR_RESERVES: i64 = 800;
    pub const MAXIMUM_PRODUCTION: i64 = 801;
    pub const RESERVE_SCALE: i64 = 815;
    pub const RESERVE_UNIT: i64 = 816;
    /// Static on the area branch: the first year production draws down reserves.
    pub const FIRST_DEPLETION_YEAR: i64 = 2182;
}

/// Result variable ids.
pub mod out {
    pub const INPUTS: i64 = 1;
    pub const OUTPUTS: i64 = 2;
    pub const CAPACITY: i64 = 3;
    pub const CAPACITY_ADDED: i64 = 4;
    pub const ACTUAL_AVAILABILITY: i64 = 7;
    pub const CAPACITY_RETIRED: i64 = 8;
    pub const MODULE_BALANCE: i64 = 9;
    pub const REQUIREMENTS: i64 = 10;
    pub const RESERVE_MARGIN: i64 = 11;
    pub const LOAD_FACTOR: i64 = 12;
    pub const PEAK: i64 = 13;
    pub const IMPORTS: i64 = 14;
    pub const OUTPUTS_BY_FEEDSTOCK: i64 = 16;
    pub const EXPORTS: i64 = 17;
    pub const PRODUCTION: i64 = 18;
    pub const SELF_SUFFICIENCY: i64 = 19;
    pub const POWER_REQUIREMENTS: i64 = 22;
    pub const PRIMARY_SUPPLY: i64 = 36;
    pub const MODULE_IMPORTS: i64 = 42;
    pub const MODULE_EXPORTS: i64 = 43;
    pub const EFFICIENCY: i64 = 46;
    pub const MODULE_UNMET: i64 = 65;
    pub const RESERVES: i64 = 73;
    pub const POWER_GENERATION: i64 = 77;
    pub const PLANNING_RESERVE_MARGIN: i64 = 82;
    pub const UNMET: i64 = 84;
    pub const ENERGY_GENERATION: i64 = 89;
    pub const CURTAILED_ENERGY: i64 = 126;
    pub const CURTAILED_POWER: i64 = 127;
}

/// Module balance categories (the second extra dimension of the balance result).
pub mod balance {
    pub const IMPORTS: i64 = 2;
    pub const OUTPUTS: i64 = 3;
    pub const REQUIREMENTS: i64 = 4;
    pub const EXPORTS: i64 = 5;
}

/// Dispatch rule codes, as the `@F` constants name them.
pub mod rule {
    pub const PERCENT_SHARE: i64 = 169;
    pub const PROPORTIONAL_TO_CAPACITY: i64 = 170;
    pub const FULL_CAPACITY: i64 = 171;
    pub const MERIT_ORDER: i64 = 172;
    pub const RUNNING_COST: i64 = 173;
    pub const REQUIREMENTS_REMAIN_UNMET: i64 = 263;
}

/// GJ in a kWh, and hours in a year.
pub const GJ_PER_KWH: f64 = 0.0036;
pub const HOURS: f64 = 8760.0;
/// The reserves LEAP reports for an unlimited resource.
pub const UNLIMITED_RESERVES: f64 = 1e15;

/// What the transformation carries from one year to the next.
#[derive(Debug, Default, Clone)]
pub struct State {
    /// Endogenous capacity added per process: (year, kW).
    pub added: BTreeMap<i64, Vec<(i32, f64)>>,
    /// Where the endogenous addition cycle stands: the index of the next process to add.
    pub cycle: BTreeMap<i64, usize>,
    /// Exogenous capacity last year per process, for added/retired.
    pub last_exogenous: BTreeMap<i64, f64>,
    /// Cumulative indigenous production per resource fuel, for reserves.
    pub produced: BTreeMap<i64, f64>,
    /// Exogenous capacity added per process after the base year: (year, kW).
    pub exogenous_added: BTreeMap<i64, Vec<(i32, f64)>>,
}

/// The flows of one year past the modules.
#[derive(Debug, Default, Clone)]
pub struct Ledger {
    /// Requirements not yet met, by fuel.
    pub req: BTreeMap<i64, f64>,
    /// Imports and exports the modules made, by fuel.
    pub imports: BTreeMap<i64, f64>,
    pub exports: BTreeMap<i64, f64>,
    /// Each module's flows, in calculation order, for allocating primary requirements and
    /// emissions back to demands.
    pub flows: Vec<ModuleFlow>,
    /// The requirements not yet met by who asked for them: (fuel, origin), where the origin is
    /// -1 for final demand or the index of the module whose processes need the fuel.
    pub origin_req: BTreeMap<(i64, i64), f64>,
}

/// One module's flows in a year.
#[derive(Debug, Default, Clone)]
pub struct ModuleFlow {
    /// Output fuels: (fuel, requirement, produced).
    pub fuels: Vec<(i64, f64, f64)>,
    /// The requirement on each output fuel by who asked for it: (fuel, origin) -> amount.
    pub origins: BTreeMap<(i64, i64), f64>,
    pub procs: Vec<ProcFlow>,
}

/// Move the requirements on a fuel, by origin, out of the ledger into a module's record.
fn take_origins(led: &mut Ledger, fuel: i64, into: &mut BTreeMap<(i64, i64), f64>) {
    let keys: Vec<(i64, i64)> = led.origin_req.range((fuel, i64::MIN)..=(fuel, i64::MAX)).map(|(k, _)| *k).collect();
    for k in keys {
        if let Some(v) = led.origin_req.remove(&k) {
            *into.entry(k).or_default() += v;
        }
    }
}

/// One process's flows in a year.
#[derive(Debug, Default, Clone)]
pub struct ProcFlow {
    /// The output fuels it serves.
    pub fuels: Vec<i64>,
    pub output: f64,
    pub eff: f64,
    /// Feedstock fuels and shares.
    pub feeds: Vec<(i64, f64)>,
    /// Loadings by (feedstock fuel, effect), kg.
    pub loadings: Vec<(i64, i64, f64)>,
}

struct Process {
    id: i64,
    eff: f64,
    share: f64,
    rule: i64,
    historical: bool,
    hist_gj: f64,
    cap_kw: f64,
    exog_kw: f64,
    endog_kw: f64,
    avail: f64,
    merit: f64,
    credit: f64,
    feedstocks: Vec<(i64, i64, f64)>,
    simple_fuel: i64,
}

fn bool_static(inp: &Inputs, b: i64, v: i64) -> bool {
    inp.m.static_value(b, v).map(|x| x != 0.0).unwrap_or_else(|| {
        let d = inp.m.variables.get(&v).map(|d| d.default.trim().to_ascii_lowercase()).unwrap_or_default();
        d == "true" || d == "-1" || d == "1"
    })
}

fn child_of_kind(inp: &Inputs, b: i64, k: i64) -> Option<i64> {
    inp.m.kids(b).iter().copied().find(|c| inp.m.branches[c].kind == k)
}

fn kids_of_kind(inp: &Inputs, b: i64, k: i64) -> Vec<i64> {
    inp.m.kids(b).iter().copied().filter(|c| inp.m.branches[c].kind == k).collect()
}

/// The modules of the area, in calculation order.
pub fn modules(inp: &Inputs) -> Vec<i64> {
    let mut out = Vec::new();
    for root in inp.m.branches.values().filter(|b| b.kind == kind::TRANSFORMATION) {
        out.extend(kids_of_kind(inp, root.id, kind::MODULE));
    }
    out
}

/// A yearly shape's values by time slice and its profile type (0 energy, 1 percent of peak,
/// 2 availability), when an expression of a branch's variable is `YearlyShape(n)`.
pub fn yearly_shape(inp: &Inputs, branch: i64, var: i64, year: i32) -> Option<(i64, Vec<(i64, f64, f64)>)> {
    let (text, def) = inp.expression(branch, var, inp.scenario, inp.region, year)?;
    let tree = inp.parse(text)?;
    let profile = match &*tree {
        crate::expr::Expr::Func { code: 164, args: Some(a) } => {
            let cx = super::inputs::Cx { branch, variable: var, scenario: inp.scenario, region: inp.region, year, def };
            inp.eval(&a[0], &cx) as i64
        }
        _ => return None,
    };
    profile_values(inp, profile)
}

/// A yearly shape profile's values by time slice, with its type (0 energy, 1 percent of peak,
/// 2 availability).
pub fn profile_values(inp: &Inputs, profile: i64) -> Option<(i64, Vec<(i64, f64, f64)>)> {
    let m = inp.m;
    let kind = m
        .table("tsprofiles")
        .and_then(|t| t.rows.iter().find(|r| t.int(r, "TSProfileID") == Some(profile)).and_then(|r| t.int(r, "ProfileType")))
        .unwrap_or(1);
    let t = m.table("tsprofiledata")?;
    let mut vals = Vec::new();
    for ts in &m.timeslices {
        let v = t
            .rows
            .iter()
            .find(|r| t.int(r, "TSProfileID") == Some(profile) && t.int(r, "TimeSliceID") == Some(ts.id))
            .and_then(|r| t.float(r, "PercentValue"))
            .unwrap_or(0.0);
        vals.push((ts.id, v, ts.hours));
    }
    Some((kind, vals))
}

/// The system load shape of a module as weights: a slice's power requirement is the module's
/// annual requirement in kWh times its weight. The shape is stated on the module itself or on the
/// Load Shapes tree's branch for the fuel; a percent-of-peak shape weighs each slice by its share
/// of the peak over the shape's integral, an energy shape by its share of the year's energy over
/// its hours.
fn load_shape(inp: &Inputs, module: i64, fuels: &[i64], year: i32) -> Option<Vec<(i64, f64, f64)>> {
    let m = inp.m;
    // A Load Shapes branch carries no fuel setting; it is the fuel it is named after.
    let names: Vec<String> = fuels.iter().filter_map(|f| fuel_name(inp, *f)).collect();
    let holders: Vec<i64> = std::iter::once(module)
        .chain(m.branches.values().filter(|b| b.kind == 49 && names.contains(&b.name)).map(|b| b.id))
        .collect();
    let mut found = None;
    for &b in &holders {
        for var in [input::SYSTEM_PEAK_LOAD_SHAPE, input::SYSTEM_LOAD_SHAPE] {
            if found.is_none() && inp.has(b, var) {
                found = yearly_shape(inp, b, var, year);
            }
        }
    }
    // A fuel with a Load Shapes branch that states no shape takes the default (ShapeDefault,
    // `@F235`): the area's first yearly shape profile.
    if found.is_none() && holders.len() > 1 {
        let first = m.table("tsprofiles").and_then(|t| {
            t.rows
                .iter()
                .filter_map(|r| Some((t.int(r, "ProfileOrder")?, t.int(r, "TSProfileID")?)))
                .min()
                .map(|(_, id)| id)
        });
        found = first.and_then(|p| profile_values(inp, p));
    }
    let (kind, vals) = found?;
    if kind == 0 {
        let total: f64 = vals.iter().map(|(_, v, _)| v).sum();
        if total == 0.0 {
            return None;
        }
        Some(vals.into_iter().map(|(t, v, h)| (t, if h == 0.0 { 0.0 } else { v / total / h }, h)).collect())
    } else {
        let integral: f64 = vals.iter().map(|(_, v, h)| v * h).sum();
        if integral == 0.0 {
            return None;
        }
        Some(vals.into_iter().map(|(t, v, h)| (t, v / integral, h)).collect())
    }
}

/// Whether a module leaves a shortfall on an output fuel unmet rather than importing it: the
/// output fuel's Shortfall Rule is `RequirementsRemainUnmet` (`@F263`).
fn shortfall_unmet(inp: &Inputs, outs: &[i64], fuel: i64, year: i32) -> bool {
    outs.iter().any(|o| {
        inp.m.static_or_default(*o, input::OUTPUT_FUEL_ID) as i64 == fuel
            && if inp.has(*o, input::SHORTFALL_RULE_DATA) {
                inp.value(*o, input::SHORTFALL_RULE_DATA, year) as i64 == rule::REQUIREMENTS_REMAIN_UNMET
            } else {
                inp.m.static_or_default(*o, input::SHORTFALL_RULE) as i64 == rule::REQUIREMENTS_REMAIN_UNMET
            }
    })
}

/// A fuel's name.
pub fn fuel_name(inp: &Inputs, fuel: i64) -> Option<String> {
    let t = inp.m.table("fuels")?;
    let row = t.rows.iter().find(|r| t.int(r, "FuelID") == Some(fuel))?;
    t.text(row, "Name")
}

/// One year of the transformation and resources, given final demand by fuel.
pub fn run_year(inp: &Inputs, year: i32, demand: &BTreeMap<i64, f64>, st: &mut State, results: &mut Results) -> Ledger {
    let mut led = Ledger { req: demand.clone(), ..Default::default() };
    led.origin_req = demand.iter().map(|(f, q)| ((*f, -1), *q)).collect();
    for module in modules(inp) {
        run_module(inp, module, year, &mut led, st, results);
    }
    resources(inp, year, &mut led, st, results);
    led
}

fn run_module(inp: &Inputs, module: i64, year: i32, led: &mut Ledger, st: &mut State, results: &mut Results) {
    let m = inp.m;
    let (s, r) = (inp.scenario, inp.region);
    let simple = bool_static(inp, module, input::SIMPLE);
    let losses = m.static_or_default(module, input::EFFICIENCY_METHOD) == 1.0;
    let has_capacity = bool_static(inp, module, input::HAS_CAPACITY);
    let output_capacity = bool_static(inp, module, input::OUTPUT_CAPACITY);
    let cap_conv = m.unit_conversion(m.static_or_default(module, input::CAPACITY_UNIT) as i64)
        * 10f64.powi(m.static_or_default(module, input::CAPACITY_SCALE) as i32);
    let hist_conv = super::units::to_gj(m, -1, m.static_or_default(module, input::HISTORICAL_UNIT) as i64)
        * 10f64.powi(m.static_or_default(module, input::HISTORICAL_SCALE) as i32);

    // Output fuels.
    let outs: Vec<i64> = child_of_kind(inp, module, kind::OUTPUT_FUELS).map(|b| kids_of_kind(inp, b, kind::OUTPUT_FUEL)).unwrap_or_default();

    // Processes.
    let proc_ids: Vec<i64> = child_of_kind(inp, module, kind::PROCESSES).map(|b| kids_of_kind(inp, b, kind::PROCESS)).unwrap_or_default();
    let mut procs: Vec<Process> = Vec::new();
    for p in &proc_ids {
        let p = *p;
        let eff = if losses {
            100.0 - inp.value(p, input::LOSSES, year)
        } else {
            inp.value(p, input::PROCESS_EFFICIENCY, year)
        } / 100.0;
        let fsy = inp.value(p, input::FIRST_SIMULATION_YEAR, year) as i32;
        let exog = inp.value(p, input::EXOGENOUS_CAPACITY, year) * cap_conv;
        let endog: f64 = alive_endogenous(inp, st, p, year);
        let mut feedstocks = Vec::new();
        if let Some(fs) = child_of_kind(inp, p, kind::FEEDSTOCKS) {
            for f in kids_of_kind(inp, fs, kind::FEEDSTOCK) {
                let fuel = m.static_or_default(f, input::FEEDSTOCK_FUEL_ID) as i64;
                feedstocks.push((f, fuel, inp.value(f, input::FEEDSTOCK_SHARE, year) / 100.0));
            }
        }
        // Capacity in output terms.
        let mut cap = exog + endog;
        if !output_capacity {
            cap *= eff;
        }
        procs.push(Process {
            id: p,
            eff,
            share: inp.value(p, input::PROCESS_SHARE, year) / 100.0,
            rule: inp.value(p, input::DISPATCH_RULE, year).round() as i64,
            historical: year < fsy && inp.has(p, input::HISTORICAL_PRODUCTION),
            hist_gj: inp.value(p, input::HISTORICAL_PRODUCTION, year) * hist_conv,
            cap_kw: cap,
            exog_kw: exog,
            endog_kw: endog,
            avail: inp.value(p, input::MAX_AVAILABILITY, year) / 100.0,
            merit: inp.value(p, input::MERIT_ORDER, year),
            credit: inp.value(p, input::CAPACITY_CREDIT, year) / 100.0,
            feedstocks,
            simple_fuel: m.static_or_default(p, input::SIMPLE_OUTPUT_FUEL) as i64,
        });
    }

    if simple {
        // Each process meets the requirements on its own output fuel.
        let mut flow = ModuleFlow::default();
        for p in &procs {
            let fuel = p.simple_fuel;
            let need = led.req.get(&fuel).copied().unwrap_or(0.0);
            put(results, module, out::REQUIREMENTS, s, r, year, fuel, -1, need);
            put(results, module, out::MODULE_BALANCE, s, r, year, fuel, balance::OUTPUTS, need);
            put(results, module, out::MODULE_BALANCE, s, r, year, fuel, balance::REQUIREMENTS, -need);
            led.req.insert(fuel, 0.0);
            take_origins(led, fuel, &mut flow.origins);
            let loadings = process_flows(inp, p, need, fuel, year, led, results);
            put(results, p.id, out::EFFICIENCY, s, r, year, -1, -1, p.eff * 100.0);
            flow.fuels.push((fuel, need, need));
            flow.procs.push(ProcFlow { fuels: vec![fuel], output: need, eff: p.eff, feeds: p.feedstocks.iter().map(|f| (f.1, f.2)).collect(), loadings });
        }
        led.flows.push(flow);
        return;
    }

    // Requirements on each output fuel.
    let mut want: Vec<(i64, f64, f64)> = Vec::new(); // (fuel, requirement, output share)
    for o in &outs {
        let fuel = m.static_or_default(*o, input::OUTPUT_FUEL_ID) as i64;
        let need = led.req.get(&fuel).copied().unwrap_or(0.0);
        want.push((fuel, need, inp.value(*o, input::OUTPUT_SHARE, year) / 100.0));
    }
    let total_req: f64 = want.iter().map(|w| w.1).sum();
    let endogenous_shares = want.len() == 1 || bool_static(inp, module, input::ENDOGENOUS_OUTPUT_SHARES);
    let shares: Vec<f64> = if endogenous_shares {
        want.iter().map(|w| if total_req == 0.0 { if want.len() == 1 { 1.0 } else { 0.0 } } else { w.1 / total_req }).collect()
    } else {
        want.iter().map(|w| w.2).collect()
    };
    let target: f64 = if endogenous_shares {
        total_req
    } else {
        want.iter().zip(&shares).filter(|(_, sh)| **sh > 0.0).map(|(w, sh)| w.1 / sh).fold(0.0, f64::max)
    };

    // Load curve and capacity planning.
    let out_fuels: Vec<i64> = want.iter().map(|w| w.0).collect();
    let shape = load_shape(inp, module, &out_fuels, year);
    // Shapes come as weights, so the sum dividing them is one.
    let shape_sum: f64 = if shape.is_some() { 1.0 } else { 0.0 };
    let shape_max: f64 = shape.as_ref().map(|v| v.iter().map(|(_, p, _)| *p).fold(0.0, f64::max)).unwrap_or(0.0);
    let peak_of = |gj: f64| -> f64 {
        let kwh = gj / GJ_PER_KWH;
        match &shape {
            Some(_) if shape_sum > 0.0 => kwh * shape_max / shape_sum,
            _ => kwh / HOURS,
        }
    };
    let peak = peak_of(target);
    if has_capacity && procs.iter().any(|p| !p.historical) {
        add_endogenous(inp, module, year, &mut procs, peak, st, output_capacity, cap_conv);
    }

    // Dispatch.
    let mut outputs: Vec<f64> = vec![0.0; procs.len()];
    let mut slices: Vec<Vec<(i64, f64)>> = vec![Vec::new(); procs.len()];
    // Processes before their first simulation year run their historical production; the others
    // are dispatched against what is left.
    let mut residual = target;
    for (i, p) in procs.iter().enumerate() {
        if p.historical {
            outputs[i] = p.hist_gj;
            residual -= p.hist_gj;
        }
    }
    let residual = residual.max(0.0);
    if procs.iter().any(|p| !p.historical) {
        // Without capacity there is nothing to fill the load curve with: dispatch for the year and
        // spread each output over the slices by the shape.
        if let (Some(shape), true) = (&shape, has_capacity) {
            dispatch_load_curve(&procs, residual, shape, shape_sum, &mut outputs, &mut slices);
        } else {
            dispatch_annual(&procs, residual, has_capacity, &mut outputs);
        }
    }
    if let Some(shape) = &shape {
        for (i, p) in procs.iter().enumerate() {
            if p.historical || !has_capacity {
                let kwh = outputs[i] / GJ_PER_KWH;
                slices[i] = shape.iter().map(|(t, pct, h)| (*t, kwh * pct / shape_sum * h)).collect();
            }
        }
        for (t, pct, _) in shape {
            put(results, module, out::POWER_REQUIREMENTS, s, r, year, *t, -1, target / GJ_PER_KWH * pct / shape_sum);
        }
    }

    // Per output fuel: produced, imported, exported, unmet.
    let produced: f64 = outputs.iter().sum();
    let mut origins = BTreeMap::new();
    for w in &want {
        take_origins(led, w.0, &mut origins);
    }
    for ((fuel, need, _), share) in want.iter().zip(&shares) {
        let made = produced * share;
        put(results, module, out::REQUIREMENTS, s, r, year, *fuel, -1, *need);
        put(results, module, out::MODULE_BALANCE, s, r, year, *fuel, balance::OUTPUTS, made);
        put(results, module, out::MODULE_BALANCE, s, r, year, *fuel, balance::REQUIREMENTS, -need);
        if made < *need {
            let gap = need - made;
            if shortfall_unmet(inp, &outs, *fuel, year) {
                put(results, module, out::MODULE_UNMET, s, r, year, *fuel, -1, gap);
            } else {
                put(results, module, out::MODULE_IMPORTS, s, r, year, *fuel, -1, gap);
                put(results, module, out::MODULE_BALANCE, s, r, year, *fuel, balance::IMPORTS, gap);
                *led.imports.entry(*fuel).or_default() += gap;
            }
        } else if made > *need {
            let extra = made - need;
            put(results, module, out::MODULE_EXPORTS, s, r, year, *fuel, -1, extra);
            put(results, module, out::MODULE_BALANCE, s, r, year, *fuel, balance::EXPORTS, -extra);
            *led.exports.entry(*fuel).or_default() += extra;
        }
        led.req.insert(*fuel, 0.0);
    }

    // Process flows and results.
    let mut flow = ModuleFlow { fuels: want.iter().zip(&shares).map(|((f, n, _), sh)| (*f, *n, produced * sh)).collect(), procs: Vec::new(), origins };
    let mut total_cap = 0.0;
    let mut firm = 0.0;
    for (i, p) in procs.iter().enumerate() {
        let out_fuel = want.first().map(|w| w.0).unwrap_or(-1);
        for ((fuel, _, _), share) in want.iter().zip(&shares) {
            let _ = (fuel, share);
        }
        let loadings = process_flows_multi(inp, p, outputs[i], &want, &shares, year, led, results);
        flow.procs.push(ProcFlow { fuels: want.iter().map(|w| w.0).collect(), output: outputs[i], eff: p.eff, feeds: p.feedstocks.iter().map(|f| (f.1, f.2)).collect(), loadings });
        put(results, p.id, out::EFFICIENCY, s, r, year, -1, -1, p.eff * 100.0);
        let _ = out_fuel;
        if has_capacity {
            let cap_rated = p.exog_kw + p.endog_kw;
            // Capacity is reported in output terms.
            let k = if output_capacity { 1.0 } else { p.eff };
            put(results, p.id, out::CAPACITY, s, r, year, 1, -1, p.exog_kw * k);
            if p.endog_kw != 0.0 || st.added.contains_key(&p.id) {
                put(results, p.id, out::CAPACITY, s, r, year, 2, -1, p.endog_kw * k);
            }
            let last = st.last_exogenous.insert(p.id, p.exog_kw * k);
            if let Some(last) = last {
                if p.exog_kw * k > last {
                    st.exogenous_added.entry(p.id).or_default().push((year, p.exog_kw - last / k));
                    put(results, p.id, out::CAPACITY_ADDED, s, r, year, 1, -1, p.exog_kw * k - last);
                } else if p.exog_kw * k < last {
                    put(results, p.id, out::CAPACITY_RETIRED, s, r, year, 1, -1, last - p.exog_kw * k);
                }
            }
            if let Some(adds) = st.added.get(&p.id) {
                let now: f64 = adds.iter().filter(|(y, _)| *y == year).map(|(_, kw)| kw).sum();
                if now != 0.0 {
                    put(results, p.id, out::CAPACITY_ADDED, s, r, year, 2, -1, now * k);
                }
            }
            total_cap += p.cap_kw;
            firm += p.cap_kw * p.credit;
            if cap_rated > 0.0 {
                put(results, p.id, out::ACTUAL_AVAILABILITY, s, r, year, -1, -1, outputs[i] / GJ_PER_KWH / (p.cap_kw * HOURS) * 100.0);
            }
        }
        let mut vintages: Vec<(i32, f64)> = st.added.get(&p.id).cloned().unwrap_or_default();
        vintages.extend(st.exogenous_added.get(&p.id).cloned().unwrap_or_default());
        let fed: Vec<(i64, i64, f64)> = p.feedstocks.iter().map(|(fb, f, sh)| (*fb, *f, if p.eff == 0.0 { 0.0 } else { outputs[i] / p.eff * sh })).collect();
        let input_gj = if p.eff == 0.0 { 0.0 } else { outputs[i] / p.eff };
        let loads = flow.procs.last().map(|f| f.loadings.clone()).unwrap_or_default();
        super::costs::process(inp, module, p.id, year, if has_capacity { p.exog_kw + p.endog_kw } else { 0.0 }, &vintages, outputs[i], input_gj, &fed, &loads, results);
        // Generation by time slice, or for the year as one slice.
        if shape.is_some() {
            for (t, kwh) in &slices[i] {
                let hours = inp.m.timeslices.iter().find(|x| x.id == *t).map(|x| x.hours).unwrap_or(HOURS);
                put(results, p.id, out::POWER_GENERATION, s, r, year, *t, -1, kwh / hours);
                put(results, p.id, out::ENERGY_GENERATION, s, r, year, *t, -1, kwh * GJ_PER_KWH);
            }
        } else {
            put(results, p.id, out::POWER_GENERATION, s, r, year, 1, -1, outputs[i] / GJ_PER_KWH / HOURS);
            put(results, p.id, out::ENERGY_GENERATION, s, r, year, 1, -1, outputs[i]);
        }
    }
    let peak_now = peak_of(target);
    if has_capacity || peak_now > 0.0 {
        let rm = if peak_now == 0.0 { 0.0 } else { (firm - peak_now) / peak_now * 100.0 };
        put(results, module, out::RESERVE_MARGIN, s, r, year, -1, -1, rm);
    }
    if shape.is_some() {
        put(results, module, out::PEAK, s, r, year, -1, -1, peak_now);
        if total_cap > 0.0 {
            put(results, module, out::LOAD_FACTOR, s, r, year, -1, -1, produced / GJ_PER_KWH / (total_cap * HOURS) * 100.0);
        }
        put(results, module, out::PLANNING_RESERVE_MARGIN, s, r, year, -1, -1, inp.value(module, input::PLANNING_RESERVE_MARGIN, year));
    }
    led.flows.push(flow);
}

/// The endogenous capacity of a process still within its lifetime.
fn alive_endogenous(inp: &Inputs, st: &State, p: i64, year: i32) -> f64 {
    let life = inp.value(p, input::LIFETIME, year) as i32;
    st.added
        .get(&p)
        .map(|v| v.iter().filter(|(y, _)| *y <= year && year < *y + life.max(1)).map(|(_, k)| k).sum())
        .unwrap_or(0.0)
}

/// Add endogenous capacity until the firm capacity meets the planning reserve margin.
#[allow(clippy::too_many_arguments)]
fn add_endogenous(inp: &Inputs, module: i64, year: i32, procs: &mut [Process], peak: f64, st: &mut State, output_capacity: bool, cap_conv: f64) {
    if peak <= 0.0 {
        return;
    }
    let prm = inp.value(module, input::PLANNING_RESERVE_MARGIN, year) / 100.0;
    let mut order: Vec<(f64, usize)> = procs
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            inp.value(p.id, input::ENDOGENOUS_CAPACITY, year) > 0.0
                && inp.value(p.id, input::ADDITION_ORDER, year) > 0.0
                && inp.value(p.id, input::ALLOW_UNPLANNED, year) != 0.0
        })
        .map(|(i, p)| (inp.value(p.id, input::ADDITION_ORDER, year), i))
        .collect();
    order.sort_by(|a, b| a.partial_cmp(b).unwrap());
    if order.is_empty() {
        return;
    }
    let firm = |procs: &[Process]| -> f64 { procs.iter().map(|p| (p.exog_kw + p.endog_kw) * p.credit).sum() };
    let mut at = st.cycle.get(&module).copied().unwrap_or(0) % order.len();
    let mut guard = 0;
    while (firm(procs) - peak) / peak < prm && guard < 10_000 {
        let i = order[at].1;
        let size = inp.value(procs[i].id, input::ENDOGENOUS_CAPACITY, year) * cap_conv;
        procs[i].endog_kw += size;
        let eff = procs[i].eff;
        procs[i].cap_kw = (procs[i].exog_kw + procs[i].endog_kw) * if output_capacity { 1.0 } else { eff };
        st.added.entry(procs[i].id).or_default().push((year, size));
        at = (at + 1) % order.len();
        guard += 1;
    }
    st.cycle.insert(module, at);
}

/// Annual dispatch without a load curve.
fn dispatch_annual(procs: &[Process], target: f64, has_capacity: bool, outputs: &mut [f64]) {
    let avail = |p: &Process| if has_capacity { p.cap_kw * p.avail * HOURS * GJ_PER_KWH } else { f64::INFINITY };
    let mut left = target;
    for (i, p) in procs.iter().enumerate() {
        if p.historical {
            continue;
        } else if p.rule == rule::FULL_CAPACITY {
            outputs[i] = if has_capacity { avail(p) } else { 0.0 };
            left -= outputs[i];
        }
    }
    let shares: f64 = procs.iter().filter(|p| !p.historical && p.rule == rule::PERCENT_SHARE).map(|p| p.share).sum();
    let base = left.max(0.0);
    for (i, p) in procs.iter().enumerate() {
        if !p.historical && p.rule == rule::PERCENT_SHARE {
            let _ = shares;
            outputs[i] = (base * p.share).min(avail(p));
            left -= outputs[i];
        }
    }
    // Merit order and proportional rules fill what is left, group by group.
    let mut groups: BTreeMap<i64, Vec<usize>> = BTreeMap::new();
    for (i, p) in procs.iter().enumerate() {
        if !p.historical && (p.rule == rule::MERIT_ORDER || p.rule == rule::PROPORTIONAL_TO_CAPACITY || p.rule == rule::RUNNING_COST) {
            groups.entry((p.merit * 1000.0) as i64).or_default().push(i);
        }
    }
    for (_, g) in groups {
        let room: f64 = g.iter().map(|i| avail(&procs[*i])).sum();
        if room <= 0.0 || left <= 0.0 {
            continue;
        }
        let take = left.min(room);
        for i in &g {
            outputs[*i] = take * avail(&procs[*i]) / room;
        }
        left -= take;
    }
}

/// Dispatch on the load curve: each time slice's power requirement is met group by group in merit
/// order, a group sharing in proportion to its available capacity.
fn dispatch_load_curve(procs: &[Process], target: f64, shape: &[(i64, f64, f64)], shape_sum: f64, outputs: &mut [f64], slices: &mut [Vec<(i64, f64)>]) {
    let kwh = target / GJ_PER_KWH;
    let mut groups: BTreeMap<i64, Vec<usize>> = BTreeMap::new();
    for (i, p) in procs.iter().enumerate() {
        if p.rule != rule::FULL_CAPACITY && !p.historical {
            groups.entry((p.merit * 1000.0) as i64).or_default().push(i);
        }
    }
    for (t, pct, hours) in shape {
        let mut need = kwh * pct / shape_sum;
        let mut got = vec![0.0; procs.len()];
        for (i, p) in procs.iter().enumerate() {
            if p.rule == rule::FULL_CAPACITY && !p.historical {
                got[i] = p.cap_kw * p.avail;
                need -= got[i];
            }
        }
        for g in groups.values() {
            let room: f64 = g.iter().map(|i| procs[*i].cap_kw * procs[*i].avail).sum();
            if room <= 0.0 || need <= 0.0 {
                continue;
            }
            let take = need.min(room);
            for i in g {
                got[*i] = take * procs[*i].cap_kw * procs[*i].avail / room;
            }
            need -= take;
        }
        for i in 0..procs.len() {
            if procs[i].historical {
                continue;
            }
            let energy = got[i] * hours;
            outputs[i] += energy * GJ_PER_KWH;
            slices[i].push((*t, energy));
        }
    }
}

/// A simple module's process: its output and the feedstock it needs.
fn process_flows(inp: &Inputs, p: &Process, output: f64, fuel: i64, year: i32, led: &mut Ledger, results: &mut Results) -> Vec<(i64, i64, f64)> {
    process_flows_multi(inp, p, output, &[(fuel, output, 1.0)], &[1.0], year, led, results)
}

#[allow(clippy::too_many_arguments)]
fn process_flows_multi(inp: &Inputs, p: &Process, output: f64, want: &[(i64, f64, f64)], shares: &[f64], year: i32, led: &mut Ledger, results: &mut Results) -> Vec<(i64, i64, f64)> {
    let mut loadings = Vec::new();
    let (s, r) = (inp.scenario, inp.region);
    for ((fuel, _, _), share) in want.iter().zip(shares) {
        put(results, p.id, out::OUTPUTS, s, r, year, *fuel, 1, output * share);
    }
    let input = if p.eff == 0.0 { 0.0 } else { output / p.eff };
    for (fb, fuel, share) in &p.feedstocks {
        let used = input * share;
        put(results, p.id, out::INPUTS, s, r, year, *fuel, 1, used);
        put(results, p.id, super::var::GROSS_ENERGY, s, r, year, *fuel, -1, used);
        put(results, p.id, out::OUTPUTS_BY_FEEDSTOCK, s, r, year, *fuel, 1, output * share);
        *led.req.entry(*fuel).or_default() += used;
        *led.origin_req.entry((*fuel, led.flows.len() as i64)).or_default() += used;
        for (effect, kg) in super::effects::feedstock_loadings(inp, results, *fb, *fuel, used, year) {
            loadings.push((*fuel, effect, kg));
        }
    }
    loadings
}

/// Primary supply: what the resources produce, import and export.
fn resources(inp: &Inputs, year: i32, led: &mut Ledger, st: &mut State, results: &mut Results) {
    let m = inp.m;
    let (s, r) = (inp.scenario, inp.region);
    for b in m.branches.values().filter(|b| b.kind == kind::RESOURCE) {
        let fuel = m.static_or_default(b.id, input::RESOURCE_FUEL_ID) as i64;
        let need = led.req.get(&fuel).copied().unwrap_or(0.0);
        let fossil = is_fossil(inp, fuel);
        let max_prod = inp.value(b.id, input::MAXIMUM_PRODUCTION, year);
        // Reserves in GJ: the stated amount (Unlimited reading as 1e15) at the resource's scale and
        // unit, drawn down by production from the first depletion year on.
        let stated = inp.value(b.id, input::BASE_YEAR_RESERVES, m.base_year);
        let unlimited = stated >= super::inputs::UNLIMITED;
        let reserve_unit = 10f64.powi(m.static_or_default(b.id, input::RESERVE_SCALE) as i32)
            * super::units::to_gj(m, fuel, m.static_or_default(b.id, input::RESERVE_UNIT) as i64);
        let reserves_base = if unlimited { UNLIMITED_RESERVES } else { stated } * reserve_unit;
        let first_depletion = m.static_value(-1, input::FIRST_DEPLETION_YEAR).map(|y| y as i32).unwrap_or(m.first_scenario_year);
        // Secondary fuels are only produced by modules: what is left of them is imported.
        let primary = m.branches.get(&b.parent).is_some_and(|p| p.kind == 12);
        let mut limit = if primary { max_prod } else { 0.0 };
        let produced_before = st.produced.get(&fuel).copied().unwrap_or(0.0);
        if fossil {
            let left = if unlimited { f64::INFINITY } else { (reserves_base - produced_before).max(0.0) };
            let _ = first_depletion;
            limit = limit.min(left);
        }
        let production = need.max(0.0).min(limit);
        let imports = need.max(0.0) - production + led.imports.get(&fuel).copied().unwrap_or(0.0);
        let exports = led.exports.get(&fuel).copied().unwrap_or(0.0);
        if year >= first_depletion {
            *st.produced.entry(fuel).or_default() += production;
        }
        put(results, b.id, out::PRODUCTION, s, r, year, fuel, -1, production);
        put(results, b.id, out::IMPORTS, s, r, year, fuel, 2, imports);
        put(results, b.id, out::EXPORTS, s, r, year, fuel, 2, exports);
        put(results, b.id, out::PRIMARY_SUPPLY, s, r, year, fuel, 1, production);
        put(results, b.id, out::PRIMARY_SUPPLY, s, r, year, fuel, 2, imports);
        put(results, b.id, out::PRIMARY_SUPPLY, s, r, year, fuel, 3, -exports);
        super::costs::resource(inp, b.id, fuel, year, production, imports, exports, results);
        if fossil {
            let reserves = reserves_base - st.produced.get(&fuel).copied().unwrap_or(0.0);
            put(results, b.id, out::RESERVES, s, r, year, fuel, -1, reserves);
        }
        let requirement = production + imports - exports;
        put(results, b.id, out::SELF_SUFFICIENCY, s, r, year, fuel, -1, if requirement == 0.0 { 0.0 } else { production / requirement * 100.0 });
        put(results, b.id, out::UNMET, s, r, year, fuel, -1, 0.0);
    }
}

/// Fuels whose production draws down reserves: every resource but the renewable ones. The four
/// sample areas report reserves for natural gas, crude oil and the coals (Asiana's coking coal is
/// fuel type 0) and none for biomass (type 2), hydro (11), wind and renewables (12) or solar (13).
pub fn is_fossil(inp: &Inputs, fuel: i64) -> bool {
    let Some(t) = inp.m.table("fuels") else { return false };
    let Some(row) = t.rows.iter().find(|r| t.int(r, "FuelID") == Some(fuel)) else { return false };
    !matches!(t.int(row, "FuelTypeID"), Some(2 | 11 | 12 | 13))
}
