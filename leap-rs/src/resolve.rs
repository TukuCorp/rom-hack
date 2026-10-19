//! The resolver: what the remaining functions read.
//!
//! `crate::expr` reads the area's equations as trees and `crate::functions` names every
//! code in them, but the functions that evaluate through the model -- Growth, Interp,
//! Step, GrowthAs, AnnualizedCost -- read the area's own variables, years and series.
//! This module addresses those: the years (base and end year, from the years table), the
//! variables and their values per branch and scenario (`@V` references, through the
//! scenario table's blob memos), the constants (`@C` references, through the constants
//! table), and the discount rate the annualized cost falls back to (areadata).
//!
//! What each piece is built from is worth stating, because it decides how much a result
//! can be trusted. The years are the minimum and maximum of the year list the years
//! table holds -- 2020 to 2050 in the shipped area, the base year the area settings state
//! through to the year LEAP stops at. A scenario expression is a `model::ScenarioRow`
//! resolved through `heap`: the row's memo block is the number of a page in the same
//! file, and the memo positionReads the text at that address. A variable reference
//! file, and the memo at that position reads the text the row points at. A variable
//! reference carries -99 for the region or scenario to mean the current one, which is
//! the engine's
//! own rule (`FUN_01baa390` skips validating a branch written -99 and reads the current
//! one); anything else is an explicit id. A scenario with no row of its own inherits its
//! parent's, following the scenarios table's parent links, which is how LEAP's scenario
//! inheritance reads.
//!
//! One caveat travels with the discount rate. It is the only rate the area states
//! (`areadata.DiscountRate`, 5.0 in the shipped area), but the row that holds it is
//! otherwise a template default: the same row states BaseYear 2000 and EndYear 2030
//! against the years table's and the settings' 2020 to 2050, and LastVariableID 27
//! against the settings' 2327. So the rate is what the area states, and nothing more is
//! claimed for it.

use crate::expr::Expr;
use crate::{heap, model, records};
use crate::records::Value;

/// The region or scenario selector -99 means: the current one.
///
/// The engine reads it that way (`FUN_01baa390` for the branch, and the same convention
/// down the variable-reference path), so the resolver does too.
pub const CURRENT: i64 = -99;

/// The study years: the base year through to the end year.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Years {
    pub base: i32,
    pub end: i32,
}

/// The year list out of a years table, in the order the file stores it.
///
/// The file stores the rows in insertion order rather than sorted, so callers that need
/// the bounds use `years`.
pub fn year_list(bytes: &[u8]) -> Vec<i32> {
    let fields = records::field_descriptors(bytes);
    let Some(year) = records::index_of(&fields, "YearID") else {
        return Vec::new();
    };
    let Some(size) = records::record_size(&fields) else {
        return Vec::new();
    };
    let Some((base, _)) = records::geometry(size) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for block in records::data_blocks(bytes) {
        let Some(whole) = bytes.get(block..block + records::BLOCK) else {
            continue;
        };
        for row in records::live_records(whole, base, &fields, size) {
            if let Some(Value::Int(id)) = row.get(year) {
                if let Ok(id) = i32::try_from(*id) {
                    out.push(id);
                }
            }
        }
    }
    out
}

/// The base and end year: the minimum and maximum of the year list.
///
/// Nothing when the table holds no years.
pub fn years(bytes: &[u8]) -> Option<Years> {
    let list = year_list(bytes);
    Some(Years {
        base: *list.iter().min()?,
        end: *list.iter().max()?,
    })
}

/// One scenario expression: which branch, variable, region and scenario it sets, and the
/// arithmetic text the row points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioExpr {
    pub branch: i64,
    pub variable: i64,
    pub region: i64,
    pub scenario: i64,
    pub text: String,
}

/// Every expression the scenario table holds, in the order the file stores its rows.
///
/// Rows with no memo are left out, and so is a row whose memo the blob walk cannot read
/// -- the count test holds that against the rows the model reader states, so a walk that
/// stops early is loud rather than silently short.
pub fn scenario_expressions(bytes: &[u8]) -> Vec<ScenarioExpr> {
    let page = records::page_size(bytes);
    if page == 0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for row in model::scenarios(bytes) {
        if row.memo_index == 0 {
            continue;
        }
        let Some(block) = row
            .memo_block
            .checked_mul(page as u64)
            .and_then(|at| usize::try_from(at).ok())
            .and_then(|at| bytes.get(at..at + page))
        else {
            continue;
        };
        let Some(text) = heap::memo(block, row.memo_index) else {
            continue;
        };
        out.push(ScenarioExpr {
            branch: row.branch,
            variable: row.variable,
            region: row.region,
            scenario: row.scenario,
            text,
        });
    }
    out
}

/// One constant of the constants table: its id, name and value.
#[derive(Debug, Clone, PartialEq)]
pub struct Constant {
    pub id: i64,
    pub name: String,
    pub value: f64,
}

/// Every constant the constants table holds, in the order the file stores them.
///
/// The values are the molecular weights their names say (C 12.011, CO2 44.01, S 32.064,
/// SO2 64.063, ...), which is what makes `@C0004/@C0003` in the stored sulfur expression
/// checkable rather than merely plausible.
pub fn constants(bytes: &[u8]) -> Vec<Constant> {
    let fields = records::field_descriptors(bytes);
    let (Some(id), Some(name), Some(value)) = (
        records::index_of(&fields, "ID"),
        records::index_of(&fields, "Name"),
        records::index_of(&fields, "Value"),
    ) else {
        return Vec::new();
    };
    let Some(size) = records::stride("constants", &fields) else {
        return Vec::new();
    };
    let page = records::page_size(bytes);
    let Some((base, _)) = records::geometry_in(page, size) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for block in records::data_blocks_in(bytes, page) {
        let Some(whole) = bytes.get(block..block + page) else {
            continue;
        };
        for row in records::live_records(whole, base, &fields, size) {
            match (row.get(id), row.get(name), row.get(value)) {
                (Some(Value::Int(id)), Some(Value::Text(name)), Some(Value::Float(value))) => {
                    out.push(Constant {
                        id: *id,
                        name: name.clone(),
                        value: *value,
                    })
                }
                _ => continue,
            }
        }
    }
    out
}

/// The discount rate the area states, as a fraction of one.
///
/// Read from `areadata.DiscountRate` (5.0 in the shipped area, so 0.05). The staleness
/// caveat in the module docs applies: the same row is a template default for the years,
/// so this is the rate the area states and nothing more is claimed for it.
pub fn discount_rate(bytes: &[u8]) -> Option<f64> {
    let fields = records::field_descriptors(bytes);
    let rate = records::index_of(&fields, "DiscountRate")?;
    let size = records::stride("areadata", &fields)?;
    let page = records::page_size(bytes);
    let (base, _) = records::geometry_in(page, size)?;
    for block in records::data_blocks_in(bytes, page) {
        let whole = bytes.get(block..block + page)?;
        for row in records::live_records(whole, base, &fields, size) {
            if let Some(Value::Float(rate)) = row.get(rate) {
                return Some(rate / 100.0);
            }
        }
    }
    None
}

/// A `@V` reference: the branch and variable it reads, the region and scenario
/// selectors (`None` is -99, the current one), and the four trailing selectors.
///
/// The trailing four select filtered results; the area always sets them to zero, and the
/// resolver carries them without acting on them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VarRef {
    pub branch: i64,
    pub variable: i64,
    pub region: Option<i64>,
    pub scenario: Option<i64>,
    pub rest: [i64; 4],
}

/// The reference a `@V` tree carries, when its eight arguments are plain numbers.
///
/// A negative id is a unary minus on a number, not part of the id -- the expression
/// reader already parses it that way. Anything but eight plain numbers is refused.
pub fn parse_var(tree: &Expr) -> Option<VarRef> {
    let Expr::Var { args: Some(args) } = tree else {
        return None;
    };
    parse_var_args(args)
}

/// The reference eight argument trees carry, when they are plain numbers.
///
/// This is the shared shape behind `@V` and the GrowthAs calls `@F037` (eight
/// arguments) and `@F041` (those eight plus the elasticity), so the evaluator reads
/// the reference out of a function call the same way it reads one out of `@V`.
/// Anything but eight plain numbers is refused.
pub fn parse_var_args(args: &[Expr]) -> Option<VarRef> {
    if args.len() != 8 {
        return None;
    }
    let mut ids = [0i64; 8];
    for (slot, arg) in ids.iter_mut().zip(args) {
        *slot = var_number(arg)?;
    }
    let select = |id: i64| (id != CURRENT).then_some(id);
    Some(VarRef {
        branch: ids[0],
        variable: ids[1],
        region: select(ids[2]),
        scenario: select(ids[3]),
        rest: [ids[4], ids[5], ids[6], ids[7]],
    })
}

/// A plain number argument, with a unary sign, as an integer id.
fn var_number(tree: &Expr) -> Option<i64> {
    match tree {
        Expr::Number(text) => text.parse().ok(),
        Expr::Unary { op, expr } => {
            let id = var_number(expr)?;
            match op {
                crate::expr::UnOp::Neg => id.checked_neg(),
                crate::expr::UnOp::Pos => Some(id),
            }
        }
        Expr::Paren(inner) => var_number(inner),
        _ => None,
    }
}

/// The resolver over the decoded tables: years, scenario expressions, scenario parents,
/// constants and the discount rate.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolver {
    years: Option<Years>,
    exprs: Vec<ScenarioExpr>,
    parents: Vec<(i64, i64)>,
    constants: Vec<Constant>,
    discount: Option<f64>,
}

impl Resolver {
    /// The resolver over the area tables it reads: the scenario table (expressions),
    /// the years table, the scenarios table (inheritance parents), the constants
    /// table, and areadata (the discount rate).
    ///
    /// Empty slices read as empty tables, so a resolver over a partial area still
    /// answers what it can.
    pub fn new(
        scenariodata_bytes: &[u8],
        years_bytes: &[u8],
        scenarios_bytes: &[u8],
        constants_bytes: &[u8],
        areadata_bytes: &[u8],
    ) -> Resolver {
        Resolver {
            years: years(years_bytes),
            exprs: scenario_expressions(scenariodata_bytes),
            parents: scenario_parents(scenarios_bytes),
            constants: constants(constants_bytes),
            discount: discount_rate(areadata_bytes),
        }
    }

    /// The study years, when the years table holds any.
    pub fn years(&self) -> Option<Years> {
        self.years
    }

    /// The discount rate as a fraction, when areadata states one.
    pub fn discount(&self) -> Option<f64> {
        self.discount
    }

    /// The parent scenario, when the scenarios table names one.
    pub fn parent(&self, scenario: i64) -> Option<i64> {
        self.parents
            .iter()
            .find(|(child, _)| *child == scenario)
            .map(|(_, parent)| *parent)
    }

    /// The constant a `@C` code names, when the constants table holds it.
    pub fn constant(&self, id: i64) -> Option<f64> {
        self.constants
            .iter()
            .find(|constant| constant.id == id)
            .map(|constant| constant.value)
    }

    /// The expression for a branch, variable, region and scenario: the row itself,
    /// else the nearest ancestor scenario's row, which is scenario inheritance.
    ///
    /// The region matches exactly; only the scenario falls back. Nothing when no row
    /// on the chain carries an expression.
    pub fn expression(
        &self,
        branch: i64,
        variable: i64,
        region: i64,
        scenario: i64,
    ) -> Option<&str> {
        let mut at = scenario;
        let mut seen = Vec::new();
        loop {
            if seen.contains(&at) {
                return None;
            }
            seen.push(at);
            if let Some(row) = self.exprs.iter().find(|row| {
                row.branch == branch
                    && row.variable == variable
                    && row.region == region
                    && row.scenario == at
            }) {
                return Some(row.text.as_str());
            }
            at = self.parent(at)?;
        }
    }
}

/// The scenario inheritance links out of a scenarios table: (scenario, parent).
fn scenario_parents(bytes: &[u8]) -> Vec<(i64, i64)> {
    let fields = records::field_descriptors(bytes);
    let (Some(id), Some(parent)) = (
        records::index_of(&fields, "ScenarioID"),
        records::index_of(&fields, "MainParentScenarioID"),
    ) else {
        return Vec::new();
    };
    let Some(size) = records::record_size(&fields) else {
        return Vec::new();
    };
    let Some((base, _)) = records::geometry(size) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for block in records::data_blocks(bytes) {
        let Some(whole) = bytes.get(block..block + records::BLOCK) else {
            continue;
        };
        for row in records::live_records(whole, base, &fields, size) {
            match (row.get(id), row.get(parent)) {
                (Some(Value::Int(id)), Some(Value::Int(parent))) => out.push((*id, *parent)),
                _ => continue,
            }
        }
    }
    out
}
