//! The value of any input variable, as LEAP evaluates it.
//!
//! A variable's data is an expression per branch, region and scenario. For a year past the last
//! historical year the scenario chain is searched for the first scenario that states one; failing
//! that, and for the base year, Current Accounts' expression is read; failing that, the variable's
//! default from the program dictionary. The expression is then evaluated at the year, in the context
//! of the branch and variable it belongs to, which is what `@F003` (BaseYearValue), `@F009`
//! (Remainder) and the growth family read.

use crate::data::{Model, CURRENT_ACCOUNTS};
use crate::expr::{self, BinOp, Expr, UnOp, SERIES_DELIM};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

/// The Indicator variable and the static stating the scale it is entered at.
pub const INDICATOR: i64 = 2174;
pub const INDICATOR_SCALE: i64 = 2176;

/// The calculated Total Activity variable of a demand branch.
pub const TOTAL_ACTIVITY: i64 = 1604;

/// LEAP's "Unlimited" (`@F165`).
pub const UNLIMITED: f64 = 1e30;

/// Where an expression is evaluated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Cx {
    pub branch: i64,
    pub variable: i64,
    pub scenario: i64,
    pub region: i64,
    pub year: i32,
    /// The scenario whose data the expression is.
    pub def: i64,
}

/// The input variables of one area, evaluated for one calculation scenario and region.
pub struct Inputs<'m> {
    pub m: &'m Model,
    pub scenario: i64,
    pub region: i64,
    chains: RefCell<HashMap<i64, Rc<Vec<i64>>>>,
    parsed: RefCell<HashMap<String, Option<Rc<Expr>>>>,
    cache: RefCell<HashMap<(i64, i64, i64, i64, i32), f64>>,
    busy: RefCell<HashSet<(i64, i64, i64, i64, i32)>>,
    /// Base-year values the calculation derives rather than reads (a useful-energy category's
    /// intensity, its children's useful shares).
    base: RefCell<HashMap<(i64, i64), f64>>,
    /// Calculated results an expression can read (`@V` naming a result variable), summed over
    /// their extra dimensions, by (branch, variable, scenario, year).
    published: RefCell<HashMap<(i64, i64, i64, i32), f64>>,
    /// Each demand branch's total activity, by (branch, year): what `@V(..,1604,..)` reads.
    activity: RefCell<HashMap<(i64, i32), f64>>,
}

impl<'m> Inputs<'m> {
    pub fn new(m: &'m Model, scenario: i64, region: i64) -> Inputs<'m> {
        Inputs {
            m,
            scenario,
            region,
            chains: RefCell::default(),
            parsed: RefCell::default(),
            cache: RefCell::default(),
            busy: RefCell::default(),
            base: RefCell::default(),
            published: RefCell::default(),
            activity: RefCell::default(),
        }
    }

    /// Record a demand branch's total activity in a year.
    pub fn set_activity(&self, branch: i64, year: i32, value: f64) {
        self.activity.borrow_mut().insert((branch, year), value);
    }

    /// Make calculated results readable by expressions, every year they hold.
    pub fn publish_all(&self, results: &crate::results::Results) {
        let mut p = self.published.borrow_mut();
        for (k, v) in results {
            if k.region == self.region {
                *p.entry((k.branch, k.variable, k.scenario, k.year as i32)).or_insert(0.0) += v;
            }
        }
    }

    /// Make a year's calculated results readable by expressions.
    pub fn publish(&self, results: &crate::results::Results, year: i32) {
        let mut p = self.published.borrow_mut();
        for (k, v) in results {
            if k.year == year as i64 && k.region == self.region {
                *p.entry((k.branch, k.variable, k.scenario, year)).or_insert(0.0) += v;
            }
        }
    }

    /// Fix the base-year value of a branch's variable to one the calculation derived.
    pub fn set_base(&self, branch: i64, variable: i64, value: f64) {
        self.base.borrow_mut().insert((branch, variable), value);
        self.cache.borrow_mut().retain(|k, _| !(k.0 == branch && k.1 == variable));
    }

    /// The base year.
    pub fn base(&self) -> i32 {
        self.m.base_year
    }

    /// The scenarios one scenario reads data from, itself first and Current Accounts last.
    pub fn chain(&self, scenario: i64) -> Rc<Vec<i64>> {
        self.chains
            .borrow_mut()
            .entry(scenario)
            .or_insert_with(|| Rc::new(self.m.scenario_chain(scenario)))
            .clone()
    }

    /// Whether a branch states any data for a variable, in any scenario.
    pub fn has(&self, branch: i64, variable: i64) -> bool {
        self.m.exprs.contains_key(&(branch, variable))
    }

    /// Whether a branch states data for a variable in this scenario's chain.
    pub fn states(&self, branch: i64, variable: i64) -> bool {
        self.expression(branch, variable, self.scenario, self.region, self.m.end_year).is_some()
    }

    /// The expression a branch's variable is evaluated with at a year, and the scenario it is
    /// stated in.
    pub fn expression(&self, branch: i64, variable: i64, scenario: i64, region: i64, year: i32) -> Option<(&'m str, i64)> {
        let rows = self.m.exprs.get(&(branch, variable))?;
        if year >= self.m.first_scenario_year && scenario != CURRENT_ACCOUNTS {
            for s in self.chain(scenario).iter() {
                if *s == CURRENT_ACCOUNTS {
                    break;
                }
                if let Some(e) = rows.get(&(region, *s)) {
                    return Some((e.as_str(), *s));
                }
            }
        }
        rows.get(&(region, CURRENT_ACCOUNTS)).map(|e| (e.as_str(), CURRENT_ACCOUNTS))
    }

    /// A variable's value in this scenario and region.
    pub fn value(&self, branch: i64, variable: i64, year: i32) -> f64 {
        self.value_in(branch, variable, self.scenario, self.region, year)
    }

    /// A variable's value in any scenario and region.
    pub fn value_in(&self, branch: i64, variable: i64, scenario: i64, region: i64, year: i32) -> f64 {
        // Total Activity is calculated, for this calculation's scenario (and so for its base year).
        if variable == TOTAL_ACTIVITY && (scenario == self.scenario || scenario == CURRENT_ACCOUNTS) {
            return self.activity.borrow().get(&(branch, year)).copied().unwrap_or(0.0);
        }
        if year < self.m.first_scenario_year && scenario != CURRENT_ACCOUNTS {
            return self.value_in(branch, variable, CURRENT_ACCOUNTS, region, year);
        }
        if year == self.m.base_year {
            if let Some(v) = self.base.borrow().get(&(branch, variable)) {
                return *v;
            }
        }
        if !self.m.variables.is_empty() && !self.m.variables.contains_key(&variable) {
            return self.published.borrow().get(&(branch, variable, scenario, year)).copied().unwrap_or(0.0);
        }
        let key = (branch, variable, scenario, region, year);
        if let Some(v) = self.cache.borrow().get(&key) {
            return *v;
        }
        if !self.busy.borrow_mut().insert(key) {
            // A circular reference reads zero rather than recursing forever.
            return 0.0;
        }
        let value = match self.expression(branch, variable, scenario, region, year) {
            Some((text, def)) => {
                let cx = Cx { branch, variable, scenario, region, year, def };
                self.eval_text(text, &cx)
            }
            // An indicator branch that states nothing aggregates the indicators beneath it.
            None if variable == INDICATOR && !self.m.kids(branch).is_empty() => self
                .m
                .kids(branch)
                .iter()
                .map(|k| {
                    let scale = 10f64.powi(self.m.static_value(*k, INDICATOR_SCALE).unwrap_or(0.0) as i32);
                    self.value_in(*k, variable, scenario, region, year) * scale
                })
                .sum(),
            None => self.default(branch, variable, scenario, region, year),
        };
        self.busy.borrow_mut().remove(&key);
        self.cache.borrow_mut().insert(key, value);
        value
    }

    /// The program default for a variable no scenario states.
    fn default(&self, branch: i64, variable: i64, scenario: i64, region: i64, year: i32) -> f64 {
        let Some(def) = self.m.variables.get(&variable) else { return 0.0 };
        let text = def.default.trim();
        match text.to_ascii_lowercase().as_str() {
            "" => 0.0,
            "true" | "yes" => 1.0,
            "false" | "no" => 0.0,
            _ => {
                let cx = Cx { branch, variable, scenario, region, year, def: CURRENT_ACCOUNTS };
                self.eval_text(text, &cx)
            }
        }
    }

    /// Parse (once) and evaluate an expression's text.
    pub fn eval_text(&self, text: &str, cx: &Cx) -> f64 {
        match strip_comment(text).trim_matches(|c: char| c.is_whitespace() || c.is_control()).to_ascii_lowercase().as_str() {
            "true" | "yes" => return 1.0,
            "false" | "no" => return 0.0,
            _ => {}
        }
        match self.parse(text) {
            Some(tree) => self.eval(&tree, cx),
            None => 0.0,
        }
    }

    /// An expression's text as a tree, comments and the wrapping whitespace dropped.
    pub fn parse(&self, text: &str) -> Option<Rc<Expr>> {
        if let Some(p) = self.parsed.borrow().get(text) {
            return p.clone();
        }
        // Stray control characters some areas leave in expressions read as spaces.
        let clean: String = strip_comment(text).chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
        let tree = expr::parse(clean.trim()).ok().map(Rc::new);
        self.parsed.borrow_mut().insert(text.to_string(), tree.clone());
        tree
    }

    /// The value of a tree in a context.
    pub fn eval(&self, e: &Expr, cx: &Cx) -> f64 {
        match e {
            Expr::Number(s) => s.parse().unwrap_or(0.0),
            // `year` is the year being calculated.
            Expr::Ident(name) if name.eq_ignore_ascii_case("year") => cx.year as f64,
            Expr::Ident(_) => 0.0,
            Expr::Paren(inner) => self.eval(inner, cx),
            Expr::Unary { op, expr } => {
                let v = self.eval(expr, cx);
                match op {
                    UnOp::Neg => -v,
                    UnOp::Pos => v,
                }
            }
            Expr::Binary { op, lhs, rhs } => {
                let a = self.eval(lhs, cx);
                let b = self.eval(rhs, cx);
                match op {
                    BinOp::Add => a + b,
                    BinOp::Sub => a - b,
                    BinOp::Mul => a * b,
                    BinOp::Pow => a.powf(b),
                    BinOp::Lt => f64::from(u8::from(a < b)),
                    BinOp::Gt => f64::from(u8::from(a > b)),
                    BinOp::Le => f64::from(u8::from(a <= b)),
                    BinOp::Ge => f64::from(u8::from(a >= b)),
                    BinOp::Eq => f64::from(u8::from(a == b)),
                    BinOp::Ne => f64::from(u8::from(a != b)),
                    BinOp::Div => {
                        if b == 0.0 {
                            0.0
                        } else {
                            a / b
                        }
                    }
                }
            }
            Expr::Const(code) => self.constant(*code as i64),
            Expr::Series(_) => 0.0,
            // A reference that selects extra result dimensions (its fifth or sixth argument) reads
            // nothing: Asiana's two such indicators are zero in LEAP's results.
            Expr::Var { args: Some(a) } if a.len() > 5 && (self.eval(&a[4], cx) != 0.0 || self.eval(&a[5], cx) != 0.0) => 0.0,
            Expr::Var { args } => match args.as_deref().and_then(|a| self.reference(a, cx)) {
                Some((b, v, s, r)) => self.value_in(b, v, s, r, cx.year),
                None => 0.0,
            },
            Expr::Func { code, args } => self.func(*code, args.as_deref().unwrap_or(&[]), cx),
        }
    }

    /// A constant: the area's own (`@C0001`..), or the program's (`@C1000` BaseYear and on).
    pub fn constant(&self, code: i64) -> f64 {
        match code {
            1000 => self.m.base_year as f64,
            1003 => self.m.end_year as f64,
            1004 => self.m.first_scenario_year as f64,
            1005 => (self.m.first_scenario_year - 1) as f64,
            1006 => self.discount_rate(),
            1007 => self.m.statics.get(&(-1, 2198)).copied().unwrap_or(0.0),
            _ => self.m.constants.get(&code).copied().unwrap_or(0.0),
        }
    }

    /// The fuel a branch's environmental loadings apply to: the nearest fuel the branch or an
    /// ancestor states, or the fuel a fuel branch stands for.
    pub fn fuel_of(&self, branch: i64) -> i64 {
        let mut at = branch;
        for _ in 0..32 {
            // A technology's fuel, a feedstock's, a resource's or an output fuel's.
            for v in [2031, 1033, 561, 2126] {
                if let Some(f) = self.m.static_value(at, v) {
                    return f as i64;
                }
            }
            match self.m.branches.get(&at) {
                Some(b) => at = b.parent,
                None => break,
            }
        }
        -1
    }

    /// A property of a fuel, as `@F175`..`@F186` read it: contents and fractions as fractions.
    pub fn fuel_property(&self, code: u32, fuel: i64) -> f64 {
        let Some(t) = self.m.table("fuels") else { return 0.0 };
        let Some(row) = t.rows.iter().find(|r| t.int(r, "FuelID") == Some(fuel)) else { return 0.0 };
        // LEAP reads the percentage properties to two decimals: Asiana's charcoal sulfur of 0.036%
        // loads as 0.04 and its 0.00064% for gas and LPG as nothing, and Freedonia's gasoline 0.044%
        // as 0.04 -- the only reading under which their SO2 loadings match.
        let f = |name: &str| {
            let v = t.float(row, name).unwrap_or(0.0);
            if name.starts_with("Percent") || name == "SulfurRetention" { (v * 100.0).round() / 100.0 } else { v }
        };
        match code {
            175 => f("PercentCarbon") / 100.0,
            176 => f("PercentSulfur") / 100.0,
            177 => f("PercentNitrogen") / 100.0,
            178 => f("PercentAsh") / 100.0,
            179 => f("PercentMethane") / 100.0,
            180 => f("PercentMoisture") / 100.0,
            181 => f("EnergyContent"),
            182 => f("LHVHHVRatio"),
            183 => f("Density"),
            184 => f("PercentOxidized") / 100.0,
            185 => f("SulfurRetention") / 100.0,
            186 => f("NonEnergyCarbonStored") / 100.0,
            _ => 0.0,
        }
    }

    /// The area discount rate in percent.
    pub fn discount_rate(&self) -> f64 {
        self.m.statics.get(&(-1, 2197)).copied().unwrap_or(0.0)
    }

    /// The branch, variable, scenario and region an `@V` argument list names. -99 is the context's
    /// own region or scenario; so is a region of 0 or a scenario outside the area.
    pub fn reference(&self, args: &[Expr], cx: &Cx) -> Option<(i64, i64, i64, i64)> {
        let n = |i: usize| -> Option<i64> { args.get(i).map(|a| self.eval(a, cx).round() as i64) };
        let mut branch = n(0)?;
        // -10 is the context's own branch, -11 its parent, and so on up the tree.
        if (-30..=-10).contains(&branch) {
            let mut at = cx.branch;
            for _ in 0..(-10 - branch) {
                at = self.m.branches.get(&at).map(|b| b.parent).unwrap_or(at);
            }
            branch = at;
        }
        let variable = n(1)?;
        let region = match n(2) {
            Some(r) if r > 0 && self.m.regions.contains(&r) => r,
            _ => cx.region,
        };
        let scenario = match n(3) {
            Some(s) if s > 0 && self.m.scenarios.contains_key(&s) => s,
            _ => cx.scenario,
        };
        Some((branch, variable, scenario, region))
    }

    /// The Current Accounts value of the context's own variable at the base year: what a series
    /// that starts after the base year is headed by.
    fn base_value(&self, cx: &Cx) -> f64 {
        self.value_in(cx.branch, cx.variable, CURRENT_ACCOUNTS, cx.region, self.m.base_year)
    }

    /// The year/value points of a series literal, each value evaluated in the context. A trailing
    /// odd entry is returned apart: a growth rate past the last point.
    fn series(&self, args: &[Expr], cx: &Cx) -> (Vec<(f64, f64)>, Option<f64>) {
        let mut items: Vec<f64> = Vec::new();
        for a in args {
            match a {
                Expr::Series(inner) => {
                    for part in split_top(inner) {
                        let v = self.parse(part).map(|t| self.eval(&t, cx)).unwrap_or(0.0);
                        items.push(v);
                    }
                }
                other => items.push(self.eval(other, cx)),
            }
        }
        let tail = (items.len() % 2 == 1).then(|| items[items.len() - 1]);
        let points = items.chunks_exact(2).map(|p| (p[0], p[1])).collect();
        (points, tail)
    }

    /// Every value a function's arguments hold, series literals split into their entries.
    fn series_values(&self, args: &[Expr], cx: &Cx) -> Vec<f64> {
        let mut items = Vec::new();
        for a in args {
            match a {
                Expr::Series(inner) => {
                    for part in split_top(inner) {
                        items.push(self.parse(part).map(|t| self.eval(&t, cx)).unwrap_or(0.0));
                    }
                }
                other => items.push(self.eval(other, cx)),
            }
        }
        items
    }

    /// Series points headed by the base-year value when they start after the base year and the
    /// expression is scenario data.
    fn headed(&self, mut points: Vec<(f64, f64)>, cx: &Cx) -> Vec<(f64, f64)> {
        let base = self.m.base_year as f64;
        if cx.def != CURRENT_ACCOUNTS && points.first().is_some_and(|p| p.0 > base) {
            points.insert(0, (base, self.base_value(cx)));
        }
        points
    }

    fn func(&self, code: u32, args: &[Expr], cx: &Cx) -> f64 {
        let arg = |i: usize| args.get(i).map(|a| self.eval(a, cx)).unwrap_or(0.0);
        let y = cx.year;
        match code {
            // Growth(rate): the previous year's value compounded at the rate.
            1 => {
                if y <= self.m.base_year {
                    return self.base_value(cx);
                }
                let prev = self.value_in(cx.branch, cx.variable, cx.scenario, cx.region, y - 1);
                prev * (1.0 + arg(0))
            }
            // BaseYearValue.
            3 => self.base_value(cx),
            // PrevYearValue(@V arguments).
            6 => match self.reference(args, cx) {
                Some((b, v, s, r)) => self.value_in(b, v, s, r, y - 1),
                None => 0.0,
            },
            // Interp.
            7 => {
                let (points, tail) = self.series(args, cx);
                interp(&self.headed(points, cx), tail, y)
            }
            // Step.
            8 => {
                let (points, _) = self.series(args, cx);
                step(&self.headed(points, cx), y)
            }
            // Remainder(total): the total less the siblings' values.
            9 => {
                let total = arg(0);
                let parent = self.m.branches.get(&cx.branch).map(|b| b.parent).unwrap_or(0);
                let others: f64 = self
                    .m
                    .kids(parent)
                    .iter()
                    .filter(|k| **k != cx.branch && self.has(**k, cx.variable))
                    .map(|k| self.value_in(*k, cx.variable, cx.scenario, cx.region, y))
                    .sum();
                total - others
            }
            // %.
            10 => arg(0) / 100.0,
            29 => arg(0) * 1e6,
            30 => arg(0) * 1e9,
            // GrowthAs(@V..): the base value moving with the reference; with a ninth argument,
            // at that elasticity.
            37 | 41 => {
                let Some((b, v, s, r)) = self.reference(args, cx) else { return 0.0 };
                let elasticity = if code == 41 { arg(8) } else { 1.0 };
                let own = self.base_value(cx);
                let now = self.value_in(b, v, s, r, y);
                let then = self.value_in(b, v, s, r, self.m.base_year);
                crate::eval::growth_as_value(own, now, then, elasticity).unwrap_or(0.0)
            }
            // AnnualizedCost(cost, life).
            43 => {
                crate::eval::annualized_value(arg(0), arg(1), self.discount_rate() / 100.0, 0.0).unwrap_or(0.0)
            }
            // Growth(rate, year, rate, ...): piecewise growth rates.
            47 => {
                if y <= self.m.base_year {
                    return self.base_value(cx);
                }
                let mut rate = arg(0);
                let mut i = 1;
                while i + 1 < args.len() {
                    // The new rate already applies in the year it is stated from.
                    if (y as f64) >= arg(i) {
                        rate = arg(i + 1);
                    }
                    i += 2;
                }
                let prev = self.value_in(cx.branch, cx.variable, cx.scenario, cx.region, y - 1);
                prev * (1.0 + rate)
            }
            61 => arg(0).trunc(),
            // BaselineValue: the variable in the scenario that inherits Current Accounts directly.
            69 => {
                let chain = self.chain(cx.scenario);
                let baseline = chain
                    .iter()
                    .copied()
                    .find(|s| self.m.scenarios.get(s).is_some_and(|sc| sc.parent == CURRENT_ACCOUNTS))
                    .unwrap_or(CURRENT_ACCOUNTS);
                self.value_in(cx.branch, cx.variable, baseline, cx.region, y)
            }
            // InterpFSY and Data: the series as stated, no base-year heading.
            82 | 83 => {
                let (points, tail) = self.series(args, cx);
                interp(&points, tail, y)
            }
            // Unlimited, Yes, No.
            165 => UNLIMITED,
            167 => 1.0,
            168 => 0.0,
            // If(condition, then, else), its arguments in a series literal or as arguments.
            150 => {
                let parts: Vec<f64> = self.series_values(args, cx);
                match parts.as_slice() {
                    [c, a, b, ..] => if *c != 0.0 { *a } else { *b },
                    [c, a] => if *c != 0.0 { *a } else { 0.0 },
                    _ => 0.0,
                }
            }
            // Call(¤Name¤): a script function.
            105 => {
                let name = match args.first() {
                    Some(Expr::Series(n)) => n.clone(),
                    _ => String::new(),
                };
                super::scripts::call(self, &name, cx).unwrap_or(0.0)
            }
            // Fuel properties of the fuel the branch's loading applies to.
            175..=186 => self.fuel_property(code, self.fuel_of(cx.branch)),
            // Enumerated settings (dispatch rules, shortfall rules, shapes) read as their code.
            _ => code as f64,
        }
    }
}

/// Linear interpolation over the points, flat before the first; past the last, flat or growing at
/// the trailing rate (in percent).
pub fn interp(points: &[(f64, f64)], tail: Option<f64>, year: i32) -> f64 {
    let y = year as f64;
    let Some(first) = points.first() else { return 0.0 };
    let last = points[points.len() - 1];
    if y <= first.0 {
        return first.1;
    }
    if y >= last.0 {
        return match tail {
            Some(rate) => last.1 * (1.0 + rate / 100.0).powf(y - last.0),
            None => last.1,
        };
    }
    for w in points.windows(2) {
        let (a, b) = (w[0], w[1]);
        if y >= a.0 && y <= b.0 {
            if b.0 == a.0 {
                return b.1;
            }
            return a.1 + (b.1 - a.1) * (y - a.0) / (b.0 - a.0);
        }
    }
    last.1
}

/// Each point's value holds from its year until the next point's.
pub fn step(points: &[(f64, f64)], year: i32) -> f64 {
    let y = year as f64;
    let Some(first) = points.first() else { return 0.0 };
    let mut value = first.1;
    for p in points {
        if p.0 <= y {
            value = p.1;
        } else {
            break;
        }
    }
    value
}

/// The text before a `?` comment that sits outside any series literal.
pub fn strip_comment(text: &str) -> &str {
    let mut inside = false;
    for (i, c) in text.char_indices() {
        if c == SERIES_DELIM {
            inside = !inside;
        } else if c == '?' && !inside {
            return &text[..i];
        }
    }
    text
}

/// The comma-separated entries of a series literal, commas inside parentheses kept.
pub fn split_top(inner: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut start = 0;
    for (i, c) in inner.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                out.push(inner[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    let last = inner[start..].trim();
    if !last.is_empty() {
        out.push(last);
    }
    out
}
