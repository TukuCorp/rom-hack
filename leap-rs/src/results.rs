//! Calculated results keyed the way LEAP stores them, and the comparison against LEAP's own.
//!
//! Every sample area SEI ships carries `_RegressionTests/Definitive/RegressionResults.nx1`: the
//! results LEAP itself calculated for that area, at full double precision, one row per branch,
//! result variable, scenario, region, year and up to two extra dimensions (a fuel, a pollutant, a
//! time slice -- whatever the variable's `ResultDimensions` row names). That table is the oracle
//! the calculation engine is held to.

use crate::area::Area;
use std::collections::BTreeMap;

/// Where one result value sits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Key {
    pub branch: i64,
    pub variable: i64,
    pub scenario: i64,
    pub region: i64,
    pub year: i64,
    pub x1: i64,
    pub x2: i64,
}

/// A set of result values.
pub type Results = BTreeMap<Key, f64>;

/// The results a regression table holds.
pub fn read_regression(area: &Area) -> Option<Results> {
    let t = area.table("RegressionResults")?;
    let mut out = Results::new();
    for row in &t.rows {
        let key = Key {
            branch: t.int(row, "BranchID")?,
            variable: t.int(row, "VariableID")?,
            scenario: t.int(row, "ScenarioID")?,
            region: t.int(row, "RegionID")?,
            year: t.int(row, "YearID")?,
            x1: t.int(row, "ExtraID1")?,
            x2: t.int(row, "ExtraID2")?,
        };
        out.insert(key, t.float(row, "Value")?);
    }
    Some(out)
}

/// LEAP's own results for a shipped area: the definitive regression set.
pub fn definitive(area: &Area) -> Option<Results> {
    read_regression(&area.sub("_RegressionTests/Definitive"))
}

/// How one result variable compares.
#[derive(Debug, Clone, Default)]
pub struct VarReport {
    pub variable: i64,
    pub total: usize,
    pub matched: usize,
    /// The worst mismatches: key, got, want.
    pub worst: Vec<(Key, f64, f64)>,
}

/// The relative tolerance a value is held to, and the share of its variable's scale below which
/// a difference is LEAP's own floating-point noise (the oracle carries values like 6e-10 where
/// the variable runs to 1e7).
pub const REL_TOL: f64 = 1e-6;
pub const SCALE_TOL: f64 = 1e-9;
/// An absolute floor: LEAP stores floating-point residue such as 3e-8 GJ of unmet electricity
/// where the port computes 4e-8 of imports or exactly zero.
pub const ABS_TOL: f64 = 1e-6;

/// Compare calculated results against the oracle, variable by variable. A key the calculation
/// does not produce reads as zero, which is what LEAP stores for a result that is not there.
pub fn compare(got: &Results, want: &Results) -> Vec<VarReport> {
    let mut scale: BTreeMap<i64, f64> = BTreeMap::new();
    for (k, v) in want {
        let s = scale.entry(k.variable).or_insert(0.0);
        *s = s.max(v.abs());
    }
    let mut reports: BTreeMap<i64, VarReport> = BTreeMap::new();
    for (k, w) in want {
        let g = got.get(k).copied().unwrap_or(0.0);
        let r = reports.entry(k.variable).or_insert_with(|| VarReport { variable: k.variable, ..Default::default() });
        r.total += 1;
        if close(g, *w, scale[&k.variable]) {
            r.matched += 1;
        } else {
            r.worst.push((*k, g, *w));
        }
    }
    for r in reports.values_mut() {
        r.worst.sort_by(|a, b| {
            let da = (a.1 - a.2).abs() / a.2.abs().max(1e-300);
            let db = (b.1 - b.2).abs() / b.2.abs().max(1e-300);
            db.partial_cmp(&da).unwrap_or(std::cmp::Ordering::Equal)
        });
    }
    reports.into_values().collect()
}

/// Whether a calculated value matches LEAP's to the tolerance above.
pub fn close(got: f64, want: f64, scale: f64) -> bool {
    (got - want).abs() <= REL_TOL * want.abs() + SCALE_TOL * scale + ABS_TOL
}
