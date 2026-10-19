//! The values out of the model arithmetic: the subset of the evaluator this port can
//! stand behind.
//!
//! `crate::expr` reads the area's equations as trees and `crate::functions` names every code in
//! them, down to the address of the function that evaluates it. This module turns the trees it can
//! into numbers, and refuses the rest rather than approximating it.
//!
//! What is here is arithmetic and the functions whose evaluators read only what the
//! resolver carries. A number is its own value; `+ - * /` and unary `+ -` are the
//! language's own operators, with the precedence the parser already applies; and `@F010`
//! -- the registry's `%`, `_pc` -- is `param_1 / 100.0`, which is the whole body of
//! `FUN_01bcf430` (chunk-00197.c).
//! `@F029` and `@F030` -- Million and Billion -- are `param_1 * 10^6` and
//! `param_1 * 10^9`, the whole bodies of `FUN_01bcf370` and `FUN_01bcf3b0`
//! (chunk-00197.c) through the integer power `FUN_0053a590`.
//!
//! The growth family and the annualized cost evaluate through functions that read the
//! area's own variables, years and series -- `FUN_01be8250` for Growth, Interp, Step and
//! GrowthAs (chunk-00198.c), `FUN_01bbc620` for the annualized cost (chunk-00197.c) --
//! and those read through `crate::resolve::Resolver`: the years bound Growth, scenario
//! inheritance supplies the base-year value a Growth call compounds from, `@V` and `@C`
//! read the scenario expressions and the constants, and areadata states the discount
//! rate the annualized cost falls back to. `@F176` and `@F185` are property references
//! rather than functions and are not evaluated. Anything else comes back `None`,
//! which a caller can see, rather than a plausible number.
//!
//! A series literal on its own is kept verbatim by the parser and is not evaluated
//! here: it takes its meaning from the Interp or Step call that carries it.
//!
//! Two differences from the engine are known. Interp and Step read only the points
//! the series spells: whatever base-year override the engine applies outside the
//! series is not ported, so the golden tests stay off the base year for series
//! calls. And a Growth call takes its base-year value from the first expression an
//! ancestor scenario states for the same branch and variable -- the Current Accounts
//! row in the shipped area -- which is the inheritance the resolver reads, not a
//! separately stored model value.
//! One difference from the engine is known. A Growth call takes its base-year value
//! from the first expression an ancestor scenario states for the same branch and
//! variable -- the Current Accounts row in the shipped area -- which is the
//! inheritance the resolver reads, not a separately stored model value.
//!
//! Interp and Step carry the engine's base-year override: when the series starts
//! after the base year, the value stored in Current Accounts for the same branch
//! and variable heads the year/value list as a base-year point, so the base year
//! reads what Current Accounts stores and the years before the first series point
//! lerp or step from it. When the series already reaches the base year, or Current
//! Accounts states no value, the series rules on its own. That is the `param_9 == 0`
//! path of `FUN_01c203c0` (chunk-00199.c): both the Step and the Interp entries
//! reach it through `FUN_01c25af0` with a zero trailing flag, and the worker inserts
//! the Current Accounts value at the base year with the sorted insert `FUN_01bfc500`
//! whenever the first series year is past it.

use crate::expr::{Expr, SeriesPoint};
use crate::resolve::{Resolver, VarRef};

/// How deep variable references may chase before the evaluator stops.
///
/// Scenario expressions can name each other -- a Growth rate names a variable, a
/// GrowthAs reference names one, and nothing stops two rows from naming each other
/// back -- so every crossing from one row into another spends one unit of depth and
/// an exhausted depth reads `None` rather than looping.
pub const MAX_DEPTH: u32 = 32;

/// Where and when an expression is evaluated: the area it reads, the region and
/// scenario that -99 means, and the branch and variable whose row Growth takes its
/// base-year value from.
#[derive(Debug, Clone, Copy)]
pub struct Context<'a> {
    resolver: &'a Resolver,
    region: i64,
    scenario: i64,
    branch: i64,
    variable: i64,
    depth: u32,
}

impl<'a> Context<'a> {
    /// The evaluation context for one branch and variable in a region and scenario.
    pub fn new(
        resolver: &'a Resolver,
        region: i64,
        scenario: i64,
        branch: i64,
        variable: i64,
    ) -> Context<'a> {
        Context { resolver, region, scenario, branch, variable, depth: MAX_DEPTH }
    }

    /// The context for an expression another row points at, or nothing when the
    /// reference chase has run out of depth.
    fn child(&self, branch: i64, variable: i64, region: i64, scenario: i64) -> Option<Context<'a>> {
        if self.depth == 0 {
            return None;
        }
        Some(Context {
            resolver: self.resolver,
            region,
            scenario,
            branch,
            variable,
            depth: self.depth - 1,
        })
    }
}

/// The function codes this module evaluates, as (code, what the registry calls it, the evaluator
/// symbol, the evaluator's address, and the semantics read out of its decompiled body).
///
/// Codes 1, 7, 8, 37, 41, 43 and 69 evaluate through `FUN_01be8250` (the growth
/// family), `FUN_01bbc620` (the annualized cost) and `FUN_01bd1c70` (the baseline
/// value) and read the area through the resolver; codes 10, 29 and 30 are pure
/// scalings and read nothing.
pub const PORTED: &[(u32, &str, &str, usize, &str)] = &[
    (
        1,
        "Growth",
        "_gr",
        0x1be7c10,
        "FUN_01be8250: V(base)=base, V(y)=V(y-1)*(1+r) (chunk-00198.c)",
    ),
    (
        7,
        "Interp",
        "_in",
        0x1c06d80,
        "FUN_01be8250 mode 1: lerp between points, flat ends (chunk-00198.c)",
    ),
    (
        8,
        "Step",
        "_sp",
        0x1c014f0,
        "FUN_01be8250 mode 0: right-continuous step, flat ends (chunk-00198.c)",
    ),
    (10, "%", "_pc", 0x1bcf430, "FUN_01bcf430: `param_1 / 100.0` (chunk-00197.c)"),
    (
        29,
        "Million",
        "_million",
        0x1bcf370,
        "FUN_01bcf370: param * 10^6 through FUN_0053a590 (chunk-00197.c)",
    ),
    (
        30,
        "Billion",
        "_billion",
        0x1bcf3b0,
        "FUN_01bcf3b0: param * 10^9 through FUN_0053a590 (chunk-00197.c)",
    ),
    (
        37,
        "GrowthAs",
        "_gras",
        0x1bbe700,
        "FUN_01be8250 via 01bbcac0: own*(ref_now/ref_base)^1 (chunk-00198.c)",
    ),
    (
        41,
        "GrowthAs",
        "_grasel",
        0x1bbcac0,
        "FUN_01bbcac0: own*(ref_now/ref_base)^elasticity (chunk-00198.c)",
    ),
    (
        43,
        "AnnualizedCost",
        "_annualizedcostsimple",
        0x1bbca50,
        "FUN_01bbc620 with om=0: cost*CRF(rate,life) (chunk-00197.c)",
    ),
    (
        69,
        "BaselineValue",
        "_blvl",
        0x1bd1be0,
        "FUN_01bd1c70 via 01bd2500: own branch/variable at the baseline scenario (chunk-00197.c)",
    ),
];

/// What the port says about a whole expression: a number, or nothing.
///
/// `None` means the expression holds something this port cannot value -- a series, a variable or
/// constant reference, or a function code whose evaluator is not ported -- and never a guess.
///
/// This is the context-free reading: it knows no area, so the growth family, `@V`
/// and `@C` all come back `None` here. `at` is the reading that knows one.
pub fn number(expr: &Expr) -> Option<f64> {
    match expr {
        Expr::Number(text) => text.parse::<f64>().ok(),
        Expr::Paren(inner) => number(inner),
        Expr::Unary { op, expr } => {
            let value = number(expr)?;
            Some(match op {
                crate::expr::UnOp::Neg => -value,
                crate::expr::UnOp::Pos => value,
            })
        }
        Expr::Binary { op, lhs, rhs } => {
            let (lhs, rhs) = (number(lhs)?, number(rhs)?);
            Some(match op {
                crate::expr::BinOp::Add => lhs + rhs,
                crate::expr::BinOp::Sub => lhs - rhs,
                crate::expr::BinOp::Mul => lhs * rhs,
                crate::expr::BinOp::Div => lhs / rhs,
            })
        }
        Expr::Func { code, args } => {
            let args = args.as_ref()?;
            match *code {
                10 if args.len() == 1 => Some(number(&args[0])? / 100.0),
                29 if args.len() == 1 => Some(million_value(number(&args[0])?)),
                30 if args.len() == 1 => Some(billion_value(number(&args[0])?)),
                _ => None,
            }
        }
        Expr::Const(_) | Expr::Var { .. } | Expr::Series(_) => None,
    }
}

/// The value of an expression's text, or nothing.
pub fn text(src: &str) -> Option<f64> {
    number(&crate::expr::parse(src).ok()?)
}
/// The value of a stored expression's text in context, or nothing.
///
/// This is the single entry point for evaluating what the area holds: the text of
/// one scenario expression plus the branch, variable, region, scenario and year it
/// is read for. It parses the text and reads it through `at` with the context for
/// that row, so the growth family, `@V`, `@C` and the contextual codes resolve
/// against the area. `None` is a refusal -- unparseable text or anything `at`
/// refuses -- and never a guess. `text` stays the context-free reading for what
/// needs no area.
pub fn text_in_context(
    resolver: &Resolver,
    src: &str,
    branch: i64,
    variable: i64,
    region: i64,
    scenario: i64,
    year: i32,
) -> Option<f64> {
    let tree = crate::expr::parse(src).ok()?;
    at(&Context::new(resolver, region, scenario, branch, variable), &tree, year)
}

/// Growth, iteratively: the base-year value compounded year by year at the rate.
///
/// `V(base) = base` and `V(y) = V(y-1) * (1+r)`, which is the loop the decompiled
/// growth worker runs rather than a closed power. A year before the base year has
/// no value.
pub fn growth_value(base: f64, rate: f64, base_year: i32, year: i32) -> Option<f64> {
    if year < base_year {
        return None;
    }
    let mut value = base;
    for _ in base_year..year {
        value *= 1.0 + rate;
    }
    Some(value)
}

/// Interp: linear interpolation between the series points, flat past the ends.
///
/// A year at or before the first point reads the first value, at or after the last
/// reads the last, and a year between two points lerps. Nothing when the series is
/// empty, which the typed grammar cannot produce.
pub fn interp_value(points: &[SeriesPoint], year: i32) -> Option<f64> {
    let first = points.first()?;
    let last = points.last()?;
    if year <= first.year {
        return Some(first.value);
    }
    if year >= last.year {
        return Some(last.value);
    }
    for pair in points.windows(2) {
        let (lo, hi) = (pair[0], pair[1]);
        if year >= lo.year && year <= hi.year {
            let span = f64::from(hi.year - lo.year);
            let here = f64::from(year - lo.year);
            return Some(lo.value + (hi.value - lo.value) * here / span);
        }
    }
    None
}

/// Step: each point's value holds until the next point's year, flat past the ends.
///
/// A year before the first point reads the first value, so a single point reads
/// the same everywhere. Nothing when the series is empty, which the typed grammar
/// cannot produce.
pub fn step_value(points: &[SeriesPoint], year: i32) -> Option<f64> {
    let mut value = points.first()?.value;
    for point in points {
        if point.year <= year {
            value = point.value;
        } else {
            break;
        }
    }
    Some(value)
}

/// Million: the argument scaled by a million.
///
/// `param * 10^6`, which is the whole body of `FUN_01bcf370` (chunk-00197.c):
/// the power is `FUN_0053a590(10.0, 6)`, exact in floating point, so this is one
/// multiplication like the engine's.
pub fn million_value(value: f64) -> f64 {
    value * 1e6
}
/// Billion: the argument scaled by a billion.
///
/// `param * 10^9`, which is the whole body of `FUN_01bcf3b0` (chunk-00197.c),
/// through the same integer power helper as Million.
pub fn billion_value(value: f64) -> f64 {
    value * 1e9
}
/// The annualized cost: the capital cost spread over its life at the discount rate,
/// plus the other annual cost.
///
/// With a life of zero there is nothing to spread, so the cost itself (plus the
/// other cost); with a zero rate the cost splits evenly; otherwise the cost times
/// the capital recovery factor `rate*(1+rate)^life / ((1+rate)^life - 1)`. A
/// negative life, a negative rate, or a life that is not a whole number of years
/// is refused. `om` is the other annual cost, which the two-argument area call
/// always leaves at zero.
pub fn annualized_value(cost: f64, life: f64, rate: f64, om: f64) -> Option<f64> {
    if life < 0.0 || rate < 0.0 {
        return None;
    }
    if life == 0.0 {
        return Some(cost + om);
    }
    if life.fract() != 0.0 || life > f64::from(i32::MAX) {
        return None;
    }
    let years = life as i32;
    let crf = if rate == 0.0 {
        1.0 / life
    } else {
        let grown = (1.0 + rate).powi(years);
        rate * grown / (grown - 1.0)
    };
    Some(cost * crf + om)
}

/// GrowthAs: the own base value scaled by the reference variable's movement.
///
/// `own * (ref_now / ref_base) ^ elasticity`, where the reference values are the
/// named variable read at the evaluated year and at the base year. A reference
/// that starts at zero, or whose movement is not positive, reads zero rather than
/// dividing by zero or raising a negative base to a fractional power.
pub fn growth_as_value(own_base: f64, ref_now: f64, ref_base: f64, elasticity: f64) -> Option<f64> {
    if ref_base == 0.0 {
        return Some(0.0);
    }
    let factor = ref_now / ref_base;
    if factor <= 0.0 {
        return Some(0.0);
    }
    Some(own_base * factor.powf(elasticity))
}

/// The value of an expression in a context at a year, or nothing.
///
/// This is the reading that knows the area: `@V` follows scenario inheritance
/// through the resolver, `@C` reads the constants, the growth family reads the
/// years and the base-year values, and the annualized cost reads the discount
/// rate. `None` is a refusal -- an unknown code, a missing row, a selector
/// outside the area, an unsettled shape -- and never a guess.
pub fn at(ctx: &Context, tree: &Expr, year: i32) -> Option<f64> {
    match tree {
        Expr::Number(text) => text.parse::<f64>().ok(),
        Expr::Paren(inner) => at(ctx, inner, year),
        Expr::Unary { op, expr } => {
            let value = at(ctx, expr, year)?;
            Some(match op {
                crate::expr::UnOp::Neg => -value,
                crate::expr::UnOp::Pos => value,
            })
        }
        Expr::Binary { op, lhs, rhs } => {
            let (lhs, rhs) = (at(ctx, lhs, year)?, at(ctx, rhs, year)?);
            Some(match op {
                crate::expr::BinOp::Add => lhs + rhs,
                crate::expr::BinOp::Sub => lhs - rhs,
                crate::expr::BinOp::Mul => lhs * rhs,
                crate::expr::BinOp::Div => lhs / rhs,
            })
        }
        Expr::Func { code, args } => {
            let args: &[Expr] = args.as_deref().unwrap_or(&[]);
            match *code {
                10 if args.len() == 1 => Some(at(ctx, &args[0], year)? / 100.0),
                29 if args.len() == 1 => Some(million_value(at(ctx, &args[0], year)?)),
                30 if args.len() == 1 => Some(billion_value(at(ctx, &args[0], year)?)),
                69 if args.is_empty() => {
                    let target = blvl_scenario(ctx.resolver, ctx.scenario)?;
                    let reference = VarRef {
                        branch: ctx.branch,
                        variable: ctx.variable,
                        region: None,
                        scenario: Some(target),
                        rest: [0, 0, 0, 0],
                    };
                    eval_var(ctx, &reference, year)
                }
                1 if args.len() == 1 => {
                    let years = ctx.resolver.years()?;
                    let rate = at(ctx, &args[0], year)?;
                    let base = base_value(ctx)?;
                    growth_value(base, rate, years.base, year)
                }
                7 if args.len() == 1 => {
                    let Expr::Series(inner) = &args[0] else {
                        return None;
                    };
                    let points = crate::expr::parse_series(inner).ok()?;
                    interp_value(&base_year_override(ctx, &points), year)
                }
                8 if args.len() == 1 => {
                    let Expr::Series(inner) = &args[0] else {
                        return None;
                    };
                    let points = crate::expr::parse_series(inner).ok()?;
                    step_value(&base_year_override(ctx, &points), year)
                }
                37 if args.len() == 8 => {
                    let reference = crate::resolve::parse_var_args(args)?;
                    growth_as(ctx, &reference, 1.0, year)
                }
                41 if args.len() == 9 => {
                    let reference = crate::resolve::parse_var_args(&args[..8])?;
                    let elasticity = at(ctx, &args[8], year)?;
                    growth_as(ctx, &reference, elasticity, year)
                }
                43 if args.len() == 2 => {
                    let (cost, life) = (at(ctx, &args[0], year)?, at(ctx, &args[1], year)?);
                    let rate = ctx.resolver.discount()?;
                    annualized_value(cost, life, rate, 0.0)
                }
                _ => None,
            }
        }
        Expr::Var { .. } => {
            let reference = crate::resolve::parse_var(tree)?;
            eval_var(ctx, &reference, year)
        }
        Expr::Const(code) => ctx.resolver.constant(i64::from(*code)),
        Expr::Series(_) => None,
    }
}

/// The value a variable reference names at a year, following scenario inheritance.
///
/// A -99 region or scenario selector reads the context's own; an explicit one has
/// to match a stored row exactly, so a selector outside the area -- region 0,
/// scenario -1 in the shipped rows -- reads nothing. The trailing four selectors
/// name filtered results, which the area always leaves at zero; anything else is
/// refused. Each crossing into another row spends one unit of depth.
pub fn eval_var(ctx: &Context, reference: &VarRef, year: i32) -> Option<f64> {
    if reference.rest != [0, 0, 0, 0] {
        return None;
    }
    let region = reference.region.unwrap_or(ctx.region);
    let scenario = reference.scenario.unwrap_or(ctx.scenario);
    let text = ctx.resolver.expression(reference.branch, reference.variable, region, scenario)?;
    let tree = crate::expr::parse(&text).ok()?;
    let child = ctx.child(reference.branch, reference.variable, region, scenario)?;
    at(&child, &tree, year)
}

/// The series points an Interp or Step call reads, with the base-year override.
///
/// When the series starts after the base year and Current Accounts states a value
/// for the context's own branch and variable, that value heads the list as a
/// base-year point: the base year then reads what Current Accounts stores, and the
/// years before the first series point lerp or step from it. Otherwise -- the
/// series already reaches the base year, the years table is empty, or there is no
/// Current Accounts value -- the series rules on its own.
///
/// This is the `param_9 == 0` path of `FUN_01c203c0` (chunk-00199.c): both the Step
/// and the Interp entries reach it through `FUN_01c25af0` with a zero trailing flag,
/// and the worker inserts the Current Accounts value at the base year with the
/// sorted insert `FUN_01bfc500` whenever the first series year is past it. In
/// Current Accounts itself nothing is inserted, and here `base_value` reads nothing
/// for the same reason.
pub fn base_year_override(ctx: &Context, points: &[SeriesPoint]) -> Vec<SeriesPoint> {
    let Some(first) = points.first() else {
        return points.to_vec();
    };
    let Some(years) = ctx.resolver.years() else {
        return points.to_vec();
    };
    if first.year <= years.base {
        return points.to_vec();
    }
    let Some(base) = base_value(ctx) else {
        return points.to_vec();
    };
    let mut out = Vec::with_capacity(points.len() + 1);
    out.push(SeriesPoint { year: years.base, value: base });
    out.extend_from_slice(points);
    out
}
/// The scenario BaselineValue reads: the nearest ancestor-or-self that directly
/// inherits Current Accounts.
///
/// The Current Accounts root -- the scenario whose parent is none or zero -- has
/// no baseline value, so the call reads nothing there, which is where the engine
/// raises "cannot be used in Current Accounts". In a baseline scenario the engine
/// warns and falls back to Current Accounts instead, so the root is read. A
/// scenario cycle reads nothing rather than looping. This is the walk in
/// `FUN_01bd1c70` (chunk-00197.c): "Baseline scenarios are those that immediately
/// inherit from Current Accounts."
fn blvl_scenario(resolver: &Resolver, scenario: i64) -> Option<i64> {
    let mut at = scenario;
    let mut candidate = scenario;
    let mut seen = Vec::new();
    loop {
        if seen.contains(&at) {
            return None;
        }
        seen.push(at);
        match resolver.parent(at) {
            None | Some(0) => {
                if at == scenario {
                    return None;
                }
                if candidate == scenario {
                    return Some(at);
                }
                return Some(candidate);
            }
            Some(parent) => {
                candidate = at;
                at = parent;
            }
        }
    }
}
/// The base-year value a Growth or GrowthAs call compounds or scales from.
///
/// The first expression an ancestor scenario states for the context's own branch
/// and variable, read at the base year: the Current Accounts row in the shipped
/// area. That first row is authoritative -- when it does not parse or has no
/// value, the call reads nothing rather than trying a higher ancestor. An
/// ancestor Growth call read at the base year lands here again and walks one
/// parent higher, so a chain of scenarios each stating Growth still terminates at
/// the row of numbers at its base.
fn base_value(ctx: &Context) -> Option<f64> {
    let years = ctx.resolver.years()?;
    let mut ancestor = ctx.resolver.parent(ctx.scenario)?;
    loop {
        if let Some(text) = ctx.resolver.expression(ctx.branch, ctx.variable, ctx.region, ancestor) {
            let tree = crate::expr::parse(&text).ok()?;
            let child = ctx.child(ctx.branch, ctx.variable, ctx.region, ancestor)?;
            return at(&child, &tree, years.base);
        }
        ancestor = ctx.resolver.parent(ancestor)?;
    }
}

/// GrowthAs through the area: the own base against the reference variable's
/// movement between the base year and the evaluated year.
fn growth_as(ctx: &Context, reference: &VarRef, elasticity: f64, year: i32) -> Option<f64> {
    let years = ctx.resolver.years()?;
    let own = base_value(ctx)?;
    let now = eval_var(ctx, reference, year)?;
    let base = eval_var(ctx, reference, years.base)?;
    growth_as_value(own, now, base, elasticity)
}
