//! Tests for the resolver: what the remaining functions read.
//!
//! Years, scenario expressions and constants are read out of the vendor area through
//! the crate's own table readers, so the resolver meets what LEAP wrote. The year bounds
//! are knowable independently (the area settings state the base year), the scenario map
//! is checked key by key against rows the model tests already pin, and the constants are
//! the molecular weights their names say. Like the area sweep, these tests print a note
//! and pass when LEAP is not installed.

use leap_rs::{container, expr, model, resolve};

const AREA: &str = "C:/Program Files/LEAP/Freedonia.zip";

/// One member of the shipped area, or nothing when LEAP is not installed.
fn member(name: &str) -> Option<Vec<u8>> {
    let zip = std::fs::read(AREA).ok()?;
    let names = container::member_names(&zip)?;
    let want = format!("/{name}.nx1");
    let full = names
        .iter()
        .find(|name| name.to_lowercase().ends_with(&want as &str))?;
    container::read_member(&zip, full)
}

#[test]
fn the_years_come_out_of_the_years_table() {
    let Some(bytes) = member("years") else {
        eprintln!("note: {AREA} not found, resolver years test skipped");
        return;
    };
    let list = resolve::year_list(&bytes);
    assert_eq!(list.len(), 31, "the thirty-one years the area holds");
    let mut ordered = list.clone();
    ordered.sort_unstable();
    assert_eq!(ordered, (2020..=2050).collect::<Vec<i32>>());

    // The bounds are knowable without this reader: the area settings state the base
    // year, and the year LEAP stops at is the end.
    let years = resolve::years(&bytes).expect("a non-empty year list has bounds");
    assert_eq!(years.base, 2020, "the base year the area settings state");
    assert_eq!(years.end, 2050, "the year LEAP stops at");
    assert!(resolve::years(&[]).is_none());
}

#[test]
fn every_scenario_row_resolves_to_the_expression_it_points_at() {
    let Some(bytes) = member("scenariodata") else {
        eprintln!("note: {AREA} not found, scenario map test skipped");
        return;
    };
    let exprs = resolve::scenario_expressions(&bytes);
    // Every row that carries a memo resolves, and no other row does: the count the
    // model reader states is the independent check on the blob-page walk, and the
    // absolute number pins it so a walk that stops early is loud.
    let rows = model::scenarios(&bytes);
    let with_memo = rows.iter().filter(|row| row.memo_index != 0).count();
    assert_eq!(exprs.len(), with_memo, "every row that carries an expression");
    assert_eq!(exprs.len(), 1009, "rows with expressions in the shipped table");

    // Spot checks against rows the model tests pin and the recon worked by hand.
    let find = |branch: i64, variable: i64, scenario: i64| {
        exprs
            .iter()
            .find(|row| {
                row.branch == branch && row.variable == variable && row.scenario == scenario
            })
            .unwrap_or_else(|| panic!("no expression for ({branch},{variable},s{scenario})"))
    };
    assert_eq!(find(32, 2027, 2).text, "@F001(@V(556,2027,-99,-99,0,0,0,0)/100)");
    assert_eq!(find(556, 2027, 1).text, "3.5");
    assert_eq!(find(2, 2027, 2).text, "@F001(@F010(3))");
    assert_eq!(find(2, 2027, 1).text, "8");
    assert_eq!(find(579, 2027, 2).text, "@F037(294,2027,-99,-99,0,0,0,0)");
    assert_eq!(find(579, 2027, 1).text, "40");
    assert_eq!(find(40, 776, 1).text, "@F043(1*5, 1)");
    assert_eq!(find(48, 2027, 2).text, "@F007(\u{a4}2030,28, 2050,50\u{a4})");

    // Every text that carries arithmetic parses: a row that pointed at padding would
    // show up here. Texts without a reference marker are names and settings the table
    // also holds ("EN", "Tonnes CO2e"), not broken formulas.
    // The three shapes a marker-carrying text comes in: a clean expression, a bare
    // property reference with one padding unit on the end ("@F172\u{a00}" -- the heap
    // walk reads to the record end when a memo carries no terminator), and an
    // expression with a " ?note" on the end ("@F169 ?Runs in proportion ..."). The
    // last two do not parse as stored; their prefixes do.
    let mut padded = 0;
    let mut noted = 0;
    for row in &exprs {
        if ["@F", "@V", "@C"].iter().any(|mark| row.text.contains(mark)) {
            if expr::parse(&row.text).is_err() {
                if bare_with_padding(&row.text) {
                    padded += 1;
                } else if noted_prefix(&row.text).is_some() {
                    noted += 1;
                } else {
                    panic!(
                        "({},{},s{}) {:?} is neither an expression nor a known memo shape",
                        row.branch, row.variable, row.scenario, row.text
                    );
                }
            }
        }
    }
    assert_eq!(padded, 29, "bare property references with a padding unit");
    assert_eq!(noted, 3, "expressions with a trailing note");
    assert!(resolve::scenario_expressions(&[]).is_empty());
}

/// The expression prefix of a memo with a trailing " ?note", when it parses.
fn noted_prefix(text: &str) -> Option<&str> {
    let (prefix, note) = text.split_once(" ?")?;
    assert!(!note.is_empty(), "{text:?}: the note marker ends the memo");
    expr::parse(prefix).is_ok().then_some(prefix)
}

/// A bare `@F<code>` with one trailing unit from outside the expression alphabet.
fn bare_with_padding(text: &str) -> bool {
    let Some(last) = text.chars().last() else {
        return false;
    };
    if last.is_ascii_graphic() || last == ' ' || last == expr::SERIES_DELIM {
        return false;
    }
    let prefix = &text[..text.len() - last.len_utf8()];
    matches!(
        expr::parse(prefix),
        Ok(expr::Expr::Func { args: None, .. })
    )
}

#[test]
fn the_constants_come_out_of_the_constants_table() {
    let Some(bytes) = member("constants") else {
        eprintln!("note: {AREA} not found, constants test skipped");
        return;
    };
    let constants = resolve::constants(&bytes);
    assert_eq!(constants.len(), 17, "every constant the table holds");
    let value = |id: i64| {
        constants
            .iter()
            .find(|constant| constant.id == id)
            .unwrap_or_else(|| panic!("no constant @{id}"))
            .value
    };
    // The molecular weights their names say: C, CO2, S, SO2.
    assert_eq!(value(1), 12.011);
    assert_eq!(value(2), 44.01);
    assert_eq!(value(3), 32.064);
    assert_eq!(value(4), 64.063);
    // The ratio the stored sulfur expression multiplies by: SO2 over S.
    // The ratio the stored sulfur expression multiplies by: SO2 over S, which is a hair
    // under two (64.128 would be exactly twice 32.064; the file holds 64.063).
    assert!((value(4) / value(3) - 1.998).abs() < 1e-4);
    assert!(resolve::constants(&[]).is_empty());
}

#[test]
fn a_variable_reference_names_its_branch_and_variable() {
    // `@V(556,2027,-99,-99,0,0,0,0)`: branch 556, variable 2027, current region and
    // scenario, no filtered-results selectors. The -99 rule is the engine's own:
    // `FUN_01baa390` skips validating a branch written -99 and reads the current one.
    let parsed = expr::parse("@V(556,2027,-99,-99,0,0,0,0)").unwrap();
    let reference = resolve::parse_var(&parsed).expect("eight numeric arguments");
    assert_eq!(reference.branch, 556);
    assert_eq!(reference.variable, 2027);
    assert_eq!(reference.region, None, "-99 is the current region");
    assert_eq!(reference.scenario, None, "-99 is the current scenario");
    assert_eq!(reference.rest, [0, 0, 0, 0]);

    // Negative ids are unary minuses on numbers, and an explicit selector stays one.
    let parsed = expr::parse("@V(-12,1538,0,-1,0,0,0,0)").unwrap();
    let reference = resolve::parse_var(&parsed).unwrap();
    assert_eq!(reference.branch, -12);
    assert_eq!(reference.variable, 1538);
    assert_eq!(reference.region, Some(0));
    assert_eq!(reference.scenario, Some(-1));

    // Anything but eight plain numbers is refused rather than guessed at.
    for src in ["@V(1,2,3)", "@V", "@F001(1)", "1"] {
        let parsed = expr::parse(src).unwrap();
        assert!(resolve::parse_var(&parsed).is_none(), "{src}");
    }
}

#[test]
fn the_resolver_answers_years_expressions_constants_and_rate() {
    let (Some(scenariodata), Some(years), Some(scenarios), Some(constants), Some(areadata)) =
        (member("scenariodata"), member("years"), member("scenarios"), member("constants"), member("areadata"))
    else {
        eprintln!("note: {AREA} not found, resolver test skipped");
        return;
    };
    let resolver = resolve::Resolver::new(&scenariodata, &years, &scenarios, &constants, &areadata);
    assert_eq!(resolver.years(), Some(resolve::Years { base: 2020, end: 2050 }));
    assert_eq!(resolver.discount(), Some(0.05), "areadata states DiscountRate 5.0");
    assert_eq!(resolver.constant(4), Some(64.063));
    assert_eq!(resolver.constant(9999), None);
    assert_eq!(resolver.parent(2), Some(1), "Baseline inherits Current Accounts");
    assert_eq!(resolver.parent(1), Some(0), "Current Accounts has no parent");

    // Scenario inheritance: (556,2027) is only written in Current Accounts, and
    // Baseline reads through to it.
    assert_eq!(resolver.expression(556, 2027, 1, 1), Some("3.5"));
    assert_eq!(resolver.expression(556, 2027, 1, 2), Some("3.5"));
    assert_eq!(
        resolver.expression(32, 2027, 1, 2),
        Some("@F001(@V(556,2027,-99,-99,0,0,0,0)/100)")
    );
    // Mitigation (11) inherits Baseline's (2) row where it writes none of its own.
    assert_eq!(
        resolver.expression(32, 2027, 1, 11),
        Some("@F001(@V(556,2027,-99,-99,0,0,0,0)/100)")
    );
    // The region matches exactly, and an unknown key has nothing.
    assert_eq!(resolver.expression(556, 2027, 2, 2), None);
    assert_eq!(resolver.expression(999999, 2027, 1, 2), None);
}
