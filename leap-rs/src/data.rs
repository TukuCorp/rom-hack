//! The model an area holds, as typed data: the inputs the calculation reads.
//!
//! An area stores its model in a handful of tables. `masterstructure` is the branch tree;
//! `scenariodata` holds every time-varying input as an expression per branch, variable, region and
//! scenario; `staticdata` holds the settings that do not vary (a technology's fuel, a branch's units,
//! a module's dispatch method) as one number per branch and variable; `scenarios` and
//! `scenarioinheritance` say which scenario falls back on which; and the rest are lookups -- fuels,
//! units, constants, years, regions, time slices, lifecycle profiles. A variable a branch states
//! nothing for takes its default from the program's own dictionary (`_dictionaryNX`'s `Variables`).

use crate::area::Area;
use crate::table::Table;
use std::collections::{BTreeMap, HashMap};

/// The tables an area keeps LEAP's own calculated results in, left out of the model.
pub const RESULT_TABLES: &[&str] = &[
    "regressionresults",
    "results",
    "aggresultscache",
    "envresults",
    "timesliceresults",
    "writtenresults",
    "lastchangedcalculated",
];

/// The Current Accounts scenario, which every scenario falls back on and which holds base-year data.
pub const CURRENT_ACCOUNTS: i64 = 1;

/// One branch of the tree.
#[derive(Debug, Clone, PartialEq)]
pub struct Branch {
    pub id: i64,
    pub parent: i64,
    pub order: i64,
    pub kind: i64,
    pub level: i64,
    pub name: String,
    pub show_results: bool,
    /// The effect (pollutant) an environmental-loading branch carries.
    pub effect: i64,
}

/// One scenario and the scenarios it falls back on.
#[derive(Debug, Clone, PartialEq)]
pub struct Scenario {
    pub id: i64,
    pub name: String,
    pub abbreviation: String,
    /// The scenario this one is based on; zero for Current Accounts.
    pub parent: i64,
    /// Further scenarios it inherits from, in the order the inheritance table states.
    pub inherits: Vec<i64>,
    pub order: i64,
}

/// One unit: what one of it is in its class's base unit.
#[derive(Debug, Clone, PartialEq)]
pub struct Unit {
    pub id: i64,
    pub name: String,
    pub conversion: f64,
    pub class: i64,
    pub inverse: bool,
}

/// One time slice.
#[derive(Debug, Clone, PartialEq)]
pub struct TimeSlice {
    pub id: i64,
    pub order: i64,
    pub name: String,
    pub hours: f64,
}

/// The program dictionary's entry for an input variable.
#[derive(Debug, Clone, PartialEq)]
pub struct VariableDef {
    pub id: i64,
    pub leap_name: String,
    pub label: String,
    pub default: String,
    pub is_static: bool,
}

/// The model of one area.
#[derive(Debug, Clone, Default)]
pub struct Model {
    pub branches: BTreeMap<i64, Branch>,
    pub children: BTreeMap<i64, Vec<i64>>,
    pub statics: HashMap<(i64, i64), f64>,
    /// (branch, variable) -> (region, scenario) -> expression text.
    pub exprs: HashMap<(i64, i64), BTreeMap<(i64, i64), String>>,
    pub scenarios: BTreeMap<i64, Scenario>,
    pub regions: Vec<i64>,
    pub base_year: i32,
    pub end_year: i32,
    pub first_scenario_year: i32,
    pub units: BTreeMap<i64, Unit>,
    pub constants: BTreeMap<i64, f64>,
    pub timeslices: Vec<TimeSlice>,
    /// Lifecycle profile id -> (time, value).
    pub lifecycles: BTreeMap<i64, Vec<(i64, f64)>>,
    pub variables: BTreeMap<i64, VariableDef>,
    /// The raw tables, for what the typed fields above do not cover.
    pub tables: BTreeMap<String, Table>,
}

impl Model {
    /// The model an area holds, with the program dictionary for variable defaults.
    pub fn load(area: &Area, dictionary: Option<&Area>) -> Model {
        let mut m = Model::default();
        let ms = area.table_or_empty("masterstructure");
        for row in &ms.rows {
            let Some(id) = ms.int(row, "BranchID") else { continue };
            let b = Branch {
                id,
                parent: ms.int(row, "ParentBranchID").unwrap_or(0),
                order: ms.int(row, "BranchOrder").unwrap_or(0),
                kind: ms.int(row, "BranchType").unwrap_or(0),
                level: ms.int(row, "BranchLevel").unwrap_or(0),
                name: ms.text(row, "Name").unwrap_or_default(),
                show_results: ms.bool(row, "ShowResults").unwrap_or(false),
                effect: ms.int(row, "EffectID").unwrap_or(0),
            };
            m.branches.insert(id, b);
        }
        for b in m.branches.values() {
            m.children.entry(b.parent).or_default().push(b.id);
        }
        for kids in m.children.values_mut() {
            kids.sort_by_key(|k| (m.branches[k].order, *k));
        }

        let st = area.table_or_empty("staticdata");
        for row in &st.rows {
            if let (Some(b), Some(v), Some(x)) =
                (st.int(row, "BranchID"), st.int(row, "VariableID"), st.float(row, "Expression"))
            {
                m.statics.insert((b, v), x);
            }
        }

        let sd = area.table_or_empty("scenariodata");
        for row in &sd.rows {
            let (Some(b), Some(v), Some(r), Some(s)) = (
                sd.int(row, "BranchID"),
                sd.int(row, "VariableID"),
                sd.int(row, "RegionID"),
                sd.int(row, "ScenarioID"),
            ) else {
                continue;
            };
            if let Some(text) = sd.text(row, "Expression") {
                m.exprs.entry((b, v)).or_default().insert((r, s), text);
            }
        }

        let sc = area.table_or_empty("scenarios");
        for row in &sc.rows {
            let Some(id) = sc.int(row, "ScenarioID") else { continue };
            m.scenarios.insert(
                id,
                Scenario {
                    id,
                    name: sc.text(row, "Name").unwrap_or_default(),
                    abbreviation: sc.text(row, "Abbreviation").unwrap_or_default(),
                    parent: sc.int(row, "MainParentScenarioID").unwrap_or(0),
                    inherits: Vec::new(),
                    order: sc.int(row, "ScOrder").unwrap_or(0),
                },
            );
        }
        let si = area.table_or_empty("scenarioinheritance");
        let mut inherit: Vec<(i64, i64, i64)> = si
            .rows
            .iter()
            .filter_map(|row| {
                Some((si.int(row, "ScenarioID")?, si.int(row, "InheritOrder")?, si.int(row, "ParentScenarioID")?))
            })
            .collect();
        inherit.sort();
        for (s, _, p) in inherit {
            if let Some(sc) = m.scenarios.get_mut(&s) {
                sc.inherits.push(p);
            }
        }

        let rg = area.table_or_empty("regions");
        m.regions = rg.rows.iter().filter_map(|row| rg.int(row, "RegionID")).collect();
        m.regions.sort();

        let un = area.table_or_empty("units");
        for row in &un.rows {
            let Some(id) = un.int(row, "UnitID") else { continue };
            m.units.insert(
                id,
                Unit {
                    id,
                    name: un.text(row, "Name").unwrap_or_default(),
                    conversion: un.float(row, "Conversion").unwrap_or(1.0),
                    class: un.int(row, "UnitClassID").unwrap_or(0),
                    inverse: un.bool(row, "Inverse").unwrap_or(false),
                },
            );
        }

        let cs = area.table_or_empty("constants");
        for row in &cs.rows {
            if let (Some(id), Some(v)) = (cs.int(row, "ID"), cs.float(row, "Value")) {
                m.constants.insert(id, v);
            }
        }

        let ts = area.table_or_empty("timeslices");
        for row in &ts.rows {
            m.timeslices.push(TimeSlice {
                id: ts.int(row, "TimeSliceID").unwrap_or(0),
                order: ts.int(row, "TSOrder").unwrap_or(0),
                name: ts.text(row, "Name").unwrap_or_default(),
                hours: ts.float(row, "Hours").unwrap_or(0.0),
            });
        }
        m.timeslices.sort_by_key(|t| (t.order, t.id));

        let lc = area.table_or_empty("lifecycletimedata");
        for row in &lc.rows {
            if let (Some(id), Some(t), Some(v)) =
                (lc.int(row, "LifeCycleID"), lc.int(row, "TimeID"), lc.float(row, "LFValue"))
            {
                m.lifecycles.entry(id).or_default().push((t, v));
            }
        }
        for v in m.lifecycles.values_mut() {
            v.sort_by_key(|(t, _)| *t);
        }

        if let Some(dict) = dictionary {
            let vt = dict.table_or_empty("Variables");
            for row in &vt.rows {
                let Some(id) = vt.int(row, "VariableID") else { continue };
                m.variables.insert(
                    id,
                    VariableDef {
                        id,
                        leap_name: vt.text(row, "LEAPName").unwrap_or_default(),
                        label: vt.text(row, "TabLabel").unwrap_or_default(),
                        default: vt.text(row, "DefaultValue").unwrap_or_default(),
                        is_static: vt.bool(row, "IsStatic").unwrap_or(false),
                    },
                );
            }
        }

        // The area's own user variables, with the defaults the area states for them.
        let uv = area.table_or_empty("uservardata");
        for row in &uv.rows {
            let Some(id) = uv.int(row, "VariableID") else { continue };
            let expr = uv.text(row, "DefaultExpression").unwrap_or_default();
            let default = if expr.trim().is_empty() {
                uv.float(row, "DefaultValue").map(|v| v.to_string()).unwrap_or_default()
            } else {
                expr
            };
            m.variables.insert(
                id,
                VariableDef {
                    id,
                    leap_name: uv.text(row, "Name").unwrap_or_default(),
                    label: uv.text(row, "Name").unwrap_or_default(),
                    default,
                    is_static: false,
                },
            );
        }

        // The study years: the settings the static table holds for the area branch.
        let area_static = |v: i64| m.statics.get(&(-1, v)).copied();
        let yt = area.table_or_empty("years");
        let mut years: Vec<i64> = yt.rows.iter().filter_map(|r| yt.int(r, "YearID")).collect();
        years.sort();
        m.base_year = area_static(2192).map(|y| y as i32).or(years.first().map(|y| *y as i32)).unwrap_or(0);
        m.end_year = area_static(2193).map(|y| y as i32).or(years.last().map(|y| *y as i32)).unwrap_or(0);
        m.first_scenario_year =
            area_static(1692).map(|y| y as i32).filter(|y| *y > m.base_year).unwrap_or(m.base_year + 1);

        for name in area.paths().filter(|p| p.ends_with(".nx1") && !p.contains('/')).map(str::to_string).collect::<Vec<_>>() {
            let stem = name.trim_end_matches(".nx1").to_string();
            // Results LEAP stored from its own last calculation are outputs, not inputs: the
            // calculation must never see them.
            if RESULT_TABLES.contains(&stem.as_str()) {
                continue;
            }
            if let Some(t) = area.table(&stem) {
                m.tables.insert(stem, t);
            }
        }
        m
    }

    /// A raw table by lower-case name.
    pub fn table(&self, name: &str) -> Option<&Table> {
        self.tables.get(&name.to_lowercase())
    }

    /// A static setting of a branch.
    pub fn static_value(&self, branch: i64, variable: i64) -> Option<f64> {
        self.statics.get(&(branch, variable)).copied()
    }

    /// A static setting of a branch, or the program dictionary's default for it.
    pub fn static_or_default(&self, branch: i64, variable: i64) -> f64 {
        self.static_value(branch, variable)
            .or_else(|| self.variables.get(&variable).and_then(|v| v.default.trim().parse().ok()))
            .unwrap_or(0.0)
    }

    /// A unit's conversion to its class's base unit.
    pub fn unit_conversion(&self, unit: i64) -> f64 {
        self.units.get(&unit).map(|u| u.conversion).unwrap_or(1.0)
    }

    /// A lifecycle profile's values by age, in percent.
    pub fn profile(&self, id: i64) -> &[(i64, f64)] {
        self.lifecycles.get(&id).map(Vec::as_slice).unwrap_or(&[])
    }

    /// The first ancestor (or the branch itself) of a given type.
    pub fn ancestor_of_kind(&self, branch: i64, kind: i64) -> Option<i64> {
        if self.branches.get(&branch)?.kind == kind {
            return Some(branch);
        }
        self.ancestors(branch).into_iter().find(|b| self.branches.get(b).is_some_and(|x| x.kind == kind))
    }

    /// The children of a branch in branch order.
    pub fn kids(&self, branch: i64) -> &[i64] {
        self.children.get(&branch).map(Vec::as_slice).unwrap_or(&[])
    }

    /// The ancestors of a branch, nearest first, not including the branch.
    pub fn ancestors(&self, branch: i64) -> Vec<i64> {
        let mut out = Vec::new();
        let mut at = branch;
        while let Some(b) = self.branches.get(&at) {
            if b.parent == 0 || out.contains(&b.parent) || !self.branches.contains_key(&b.parent) {
                break;
            }
            out.push(b.parent);
            at = b.parent;
        }
        out
    }

    /// The scenarios a scenario reads data from, in the order it looks: itself, then what it
    /// inherits, then its parent's chain, ending in Current Accounts.
    pub fn scenario_chain(&self, scenario: i64) -> Vec<i64> {
        fn chain(m: &Model, s: i64, depth: usize) -> Vec<i64> {
            let Some(sc) = m.scenarios.get(&s) else { return Vec::new() };
            if depth > 64 {
                return vec![s];
            }
            let base = chain(m, sc.parent, depth + 1);
            let mut out = vec![s];
            // Assumption: a later inheritance entry takes precedence over an earlier one.
            for p in sc.inherits.iter().rev() {
                for x in chain(m, *p, depth + 1) {
                    if !base.contains(&x) && !out.contains(&x) {
                        out.push(x);
                    }
                }
            }
            for x in base {
                if !out.contains(&x) {
                    out.push(x);
                }
            }
            out
        }
        let mut out = chain(self, scenario, 0);
        out.retain(|s| *s != CURRENT_ACCOUNTS);
        out.push(CURRENT_ACCOUNTS);
        out
    }

    /// The years of the study.
    pub fn years(&self) -> std::ops::RangeInclusive<i32> {
        self.base_year..=self.end_year
    }
}
