//! Tests for the first evaluated subset of the model arithmetic.
//!
//! The numbers here are the area's own. The seven memo texts the scenario table's first block
//! holds come out of the vendor bytes through `heap`, and the expressions come from
//! `NX1_EXPRESSIONS`, so the evaluator meets what LEAP wrote rather than what a test wrote.
//! What is not evaluated is asserted to be not evaluated: a function whose decompiled body reads
//! the model, a variable or constant reference, and a series literal all come back `None`.

use leap_rs::eval;
use leap_rs::expr;
use leap_rs::heap;
use leap_rs::oracle_nx1_expr::NX1_EXPRESSIONS;
use leap_rs::oracle_records::NX1_SCENARIO_BLOB_BLOCK;
use leap_rs::{container, resolve};

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

/// The seven memo texts the first blob block holds, through the reader rather than as fixtures.
fn first_memos() -> Vec<String> {
    heap::memos(&unhex(NX1_SCENARIO_BLOB_BLOCK))
}

#[test]
fn the_areas_own_number_memos_evaluate_to_themselves() {
    // The first seven rows of the scenario table resolve to these texts, and six of them are
    // plain numbers: the arithmetic reader gives each its value, and 2040 is a year the area
    // states in its own year list.
    let memos = first_memos();
    let wants: [(usize, &str, f64); 7] = [
        (0, "0.2", 0.2),
        (1, "5", 5.0),
        (2, "1000", 1000.0),
        (3, "5", 5.0),
        (4, "0", 0.0),
        (5, "1", 1.0),
        (6, "2040", 2040.0),
    ];
    for (index, text, want) in wants {
        assert_eq!(memos[index], text, "memo {index}");
        assert_eq!(eval::text(&memos[index]), Some(want), "{text}");
    }
    // A memo that is a name rather than arithmetic has no value, and neither does a formula
    // whose evaluator is not ported.
    assert_eq!(eval::text(&memos[7]), None, "a fuel name is not a number");
}

#[test]
fn the_operators_take_the_precedence_the_parser_gives_them() {
    for (src, want) in [
        ("1-2*3", -5.0),
        ("2*(3+4)", 14.0),
        ("-(1+2)", -3.0),
        ("+2", 2.0),
        ("10/4", 2.5),
        (".5*2", 1.0),
        ("0.07+0.03", 0.1),
    ] {
        assert_eq!(eval::text(src), Some(want), "{src}");
    }
}

#[test]
fn the_power_and_the_comparisons_evaluate_as_the_language_states() {
    for (src, want) in [
        ("2^3", 8.0),
        ("2^3^2", 512.0),
        ("2*3^2", 18.0),
        ("1<2", 1.0),
        ("1>2", 0.0),
        ("2<=2", 1.0),
        ("2>=3", 0.0),
        ("2=2", 1.0),
        ("2<>2", 0.0),
    ] {
        assert_eq!(eval::text(src), Some(want), "{src}");
    }
    // A name is a name: the standalone evaluator has no year to answer with.
    assert_eq!(eval::text("year"), None);
}

#[test]
fn the_percent_function_divides_by_a_hundred() {
    // @F010 is the registry's `%`, `_pc`, and the decompiled body at 0x1bcf430 is a single
    // division by 100.0. The corpus stores it wrapped in @F001, as `@F001(@F010(3))`, which is
    // the shape a three per cent rate is written in.
    assert_eq!(eval::text("@F010(3)"), Some(0.03));
    assert_eq!(eval::text("@F010(2*4)"), Some(0.08));
    assert_eq!(eval::text("1+@F010(50)"), Some(1.5));
    assert!(NX1_EXPRESSIONS
        .iter()
        .any(|(_, _, _, text)| *text == "@F001(@F010(3))"));

    // The wrong number of arguments is not an evaluation this port will do.
    assert_eq!(eval::text("@F010(1,2)"), None);
    assert_eq!(eval::text("@F010"), None);
}

#[test]
fn what_the_port_cannot_value_comes_back_none_rather_than_a_guess() {
    // Every other code the stored expressions use evaluates through a function that reads the
    // area's model, and this port has no resolver for those.
    for text in [
        "@F001(1)",
        "@F007(\u{a4}2050,600\u{a4})",
        "@F008(2020)",
        "@F037(1,2,3,4,5,6,7,8)",
        "@F041(1,2,3,4,5,6,7,8,9)",
        "@F043(1,2)",
        "@V(606,2040,-99,-99,0,0,0,0)",
        "@C0004/@C0003",
        "@F176*(1-@F185)*(@C0004/@C0003)",
    ] {
        assert_eq!(eval::text(text), None, "{text}");
    }

    // And the codes the port does not value are the ones the area actually stores: the two
    // arithmetic-only expressions it holds are handfuls, so this is a start rather than a claim
    // to evaluate the model.
    let mut codes: Vec<u32> = Vec::new();
    for (_, _, _, text) in NX1_EXPRESSIONS {
        if let Ok(parsed) = expr::parse(text) {
            collect_codes(&parsed, &mut codes);
        }
    }
    codes.sort_unstable();
    codes.dedup();
    assert_eq!(codes, vec![1, 7, 8, 10, 37, 41, 43, 176, 185]);
    let ported: Vec<u32> = eval::PORTED.iter().map(|(code, ..)| *code).collect();
    assert_eq!(ported, vec![1, 7, 8, 10, 29, 30, 37, 41, 43, 69], "ten ported codes");
}

fn collect_codes(expr: &expr::Expr, out: &mut Vec<u32>) {
    match expr {
        expr::Expr::Func { code, args } => {
            out.push(*code);
            if let Some(args) = args {
                for arg in args {
                    collect_codes(arg, out);
                }
            }
        }
        expr::Expr::Var { args } => {
            if let Some(args) = args {
                for arg in args {
                    collect_codes(arg, out);
                }
            }
        }
        expr::Expr::Unary { expr, .. } => collect_codes(expr, out),
        expr::Expr::Paren(inner) => collect_codes(inner, out),
        expr::Expr::Binary { lhs, rhs, .. } => {
            collect_codes(lhs, out);
            collect_codes(rhs, out);
        }
        _ => {}
    }
}

// The growth family and the annualized cost: golden tests.
//
// The expected values below come from hand arithmetic on the semantics read out of
// the decompiled evaluator bodies (FUN_01be8250 for the growth family, FUN_01bbc620
// for the annualized cost), not from running this port. The first group needs no
// vendor area; the second evaluates real stored expressions from the shipped area
// through the resolver, and prints a note and passes when LEAP is not installed.

fn assert_close(got: Option<f64>, want: f64, rel: f64, what: &str) {
    let got = got.unwrap_or_else(|| panic!("{what}: got None, wanted {want}"));
    let tol = rel * want.abs().max(1.0);
    assert!(
        (got - want).abs() <= tol,
        "{what}: got {got}, wanted {want} (tolerance {tol})"
    );
}

#[test]
fn growth_compounds_the_rate_year_by_year_from_the_base_value() {
    // V(base) = base, V(y) = V(y-1) * (1 + r): 100 at 5% from 2020 is 105 in
    // 2021 and 100 * 1.05 * 1.05 = 110.25 in 2022.
    assert_eq!(eval::growth_value(100.0, 0.05, 2020, 2020), Some(100.0));
    assert_eq!(eval::growth_value(100.0, 0.05, 2020, 2021), Some(105.0));
    assert_close(eval::growth_value(100.0, 0.05, 2020, 2022), 110.25, 1e-12, "two years at 5%");
    // A year before the base year has no value rather than a guess.
    assert_eq!(eval::growth_value(100.0, 0.05, 2020, 2019), None);
}

#[test]
fn interp_lerps_between_points_and_holds_flat_past_the_ends() {
    // 2030 -> 28 through 2050 -> 50: the midpoint 2040 is 39, the ends hold.
    let points = expr::parse_series("2030,28, 2050,50").expect("hand-written series parses");
    assert_eq!(eval::interp_value(&points, 2027), Some(28.0));
    assert_eq!(eval::interp_value(&points, 2030), Some(28.0));
    assert_eq!(eval::interp_value(&points, 2040), Some(39.0));
    assert_eq!(eval::interp_value(&points, 2050), Some(50.0));
    assert_eq!(eval::interp_value(&points, 2060), Some(50.0));
    // A single point is flat everywhere.
    let one = expr::parse_series("2050,400").expect("a single point parses");
    assert_eq!(eval::interp_value(&one, 2027), Some(400.0));
}

#[test]
fn step_holds_each_value_until_the_next_year() {
    // 2030 -> 1000, 2040 -> 0: 2035 still reads 1000, 2040 reads 0, and a year
    // before the first point holds the first value.
    let points = expr::parse_series("2030, 1000, 2040, 0").expect("hand-written series parses");
    assert_eq!(eval::step_value(&points, 2027), Some(1000.0));
    assert_eq!(eval::step_value(&points, 2035), Some(1000.0));
    assert_eq!(eval::step_value(&points, 2040), Some(0.0));
    assert_eq!(eval::step_value(&points, 2060), Some(0.0));
}

#[test]
fn annualized_cost_spreads_the_cost_at_the_discount_rate() {
    // 100 over 5 years at 5% is 100 * CRF(5%, 5) = 23.09748...; over 1 year at
    // 5% with 10 of other cost it is 100 * 1.05 + 10 = 115.
    assert_close(eval::annualized_value(100.0, 5.0, 0.05, 0.0), 23.09748, 1e-4, "100 over 5 at 5%");
    // 100 * CRF(5%, 1) + 10 is 115 up to the last floating-point bit
    // (CRF(5%, 1) divides 0.05 * 1.05 by 0.05, which rounds down one ulp).
    assert_close(eval::annualized_value(100.0, 1.0, 0.05, 10.0), 115.0, 1e-12, "100 over 1 at 5% plus 10");
    // A zero life returns the cost itself; a zero rate splits evenly.
    assert_eq!(eval::annualized_value(100.0, 0.0, 0.05, 0.0), Some(100.0));
    assert_eq!(eval::annualized_value(100.0, 4.0, 0.0, 0.0), Some(25.0));
    // A negative life, a negative rate, or a fractional life is refused.
    assert_eq!(eval::annualized_value(100.0, -1.0, 0.05, 0.0), None);
    assert_eq!(eval::annualized_value(100.0, 5.0, -0.05, 0.0), None);
    assert_eq!(eval::annualized_value(100.0, 2.5, 0.05, 0.0), None);
}

#[test]
fn growth_as_scales_the_base_by_the_reference_movement() {
    // own 40, reference 40 -> 41 with elasticity 1: 40 * 41/40 = 41.
    assert_eq!(eval::growth_as_value(40.0, 41.0, 40.0, 1.0), Some(41.0));
    assert_close(eval::growth_as_value(40.0, 42.025, 40.0, 1.0), 42.025, 1e-12, "two years at 2.5%");
    // A reference that starts at zero, or moves against itself, reads zero.
    assert_eq!(eval::growth_as_value(40.0, 41.0, 0.0, 1.0), Some(0.0));
    assert_eq!(eval::growth_as_value(40.0, -41.0, 40.0, 1.0), Some(0.0));
}

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

/// The resolver over the shipped area, or nothing when LEAP is not installed.
fn shipped_resolver() -> Option<resolve::Resolver> {
    let (scenariodata, years, scenarios, constants, areadata) = (
        member("scenariodata")?,
        member("years")?,
        member("scenarios")?,
        member("constants")?,
        member("areadata")?,
    );
    Some(resolve::Resolver::new(&scenariodata, &years, &scenarios, &constants, &areadata))
}

/// Evaluate a stored expression for one branch, variable, region and scenario at a year.
fn stored(resolver: &resolve::Resolver, branch: i64, variable: i64, region: i64, scenario: i64, year: i32) -> Option<f64> {
    let text = resolver.expression(branch, variable, region, scenario)?;
    eval::text_in_context(resolver, &text, branch, variable, region, scenario, year)
}

#[test]
fn stored_growth_expressions_compound_from_the_current_accounts_base() {
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, stored growth test skipped");
        return;
    };
    // (2,2027): Baseline grows 3% from the Current Accounts base 8, so 2027 is
    // 8 * 1.03^7 = 9.8389909...; (32,2027): Baseline grows at the rate (556,2027)
    // names -- 3.5% -- from the base 3, so 2027 is 3 * 1.035^7 = 3.8168378....
    assert_close(stored(&resolver, 2, 2027, 1, 2, 2027), 9.8389909234, 1e-9, "(2,2027,s2) at 2027");
    assert_close(stored(&resolver, 32, 2027, 1, 2, 2027), 3.8168377883, 1e-9, "(32,2027,s2) at 2027");
    // The base year reads the base itself, and a year before it reads nothing.
    assert_eq!(stored(&resolver, 2, 2027, 1, 2, 2020), Some(8.0));
    assert_eq!(stored(&resolver, 2, 2027, 1, 2, 2019), None);
}

#[test]
fn stored_interp_and_step_expressions_read_their_series() {
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, stored interp/step test skipped");
        return;
    };
    // (48,2027,s2): 2030 -> 28 through 2050 -> 50, headed by the Current
    // Accounts 25 at the 2020 base year, so 2020 reads 25, 2027 lerps to
    // 25 + 3 * 7/10 = 27.1 and 2040 lerps to 39;
    // (244,804,s2): the single point 2050 -> 400, headed by the Current
    // Accounts 300, so 2020 reads 300 and later years lerp between the two:
    // 2027 is 300 + 100 * 7/30 = 970/3.
    assert_eq!(stored(&resolver, 48, 2027, 1, 2, 2020), Some(25.0));
    assert_close(stored(&resolver, 48, 2027, 1, 2, 2027), 27.1, 1e-9, "(48,2027,s2) at 2027");
    assert_eq!(stored(&resolver, 48, 2027, 1, 2, 2040), Some(39.0));
    assert_eq!(stored(&resolver, 244, 804, 1, 2, 2020), Some(300.0));
    assert_close(stored(&resolver, 244, 804, 1, 2, 2027), 970.0 / 3.0, 1e-9, "x");
    // (65,2145,s2): 2030 -> 1000, 2040 -> 0, headed by the Current Accounts
    // 2500, so 2020 and 2027 read 2500, 2035 still reads 1000 and 2040 reads
    // 0; (582,2027,s2): 2025 -> 500, 2030 -> 600, headed by the Current
    // Accounts 400, so 2020 reads 400, 2027 reads 500 and 2030 reads 600;
    // (842,2145,s12): the single point 2031 -> 30 with no Current Accounts
    // row, so the series rules on its own and 2027 reads 30.
    assert_eq!(stored(&resolver, 65, 2145, 1, 2, 2020), Some(2500.0));
    assert_eq!(stored(&resolver, 65, 2145, 1, 2, 2027), Some(2500.0));
    assert_eq!(stored(&resolver, 65, 2145, 1, 2, 2035), Some(1000.0));
    assert_eq!(stored(&resolver, 65, 2145, 1, 2, 2040), Some(0.0));
    assert_eq!(stored(&resolver, 582, 2027, 1, 2, 2020), Some(400.0));
    assert_eq!(stored(&resolver, 582, 2027, 1, 2, 2027), Some(500.0));
    assert_eq!(stored(&resolver, 582, 2027, 1, 2, 2030), Some(600.0));
    assert_eq!(stored(&resolver, 842, 2145, 1, 12, 2027), Some(30.0));
}

#[test]
fn stored_annualized_cost_expressions_use_the_stated_discount_rate() {
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, stored annualized test skipped");
        return;
    };
    // (40,776): 1*5 over 1 year at the stated 5% is 5 * CRF(5%, 1) = 5.25, up to
    // the last floating-point bit, as above;
    // (677,776): 100 over 10 years is 100 * CRF(5%,10) = 12.9504574...;
    // (676,776): 6*5 over 3 years is 30 * CRF(5%,3) = 11.0162569....
    assert_close(stored(&resolver, 40, 776, 1, 1, 2027), 5.25, 1e-12, "(40,776) at 2027");
    assert_close(stored(&resolver, 677, 776, 1, 1, 2027), 12.95046, 1e-4, "(677,776) at 2027");
    assert_close(stored(&resolver, 676, 776, 1, 1, 2027), 11.01626, 1e-4, "(676,776) at 2027");
}

#[test]
fn stored_growth_as_follows_the_reference_variable() {
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, stored growth-as test skipped");
        return;
    };
    // (579,2027,s2) grows as (294,2027), which Baseline reads as 8 * 1.025^years
    // times 5 from the Current Accounts 8 * 5 = 40: own base 40, so 2020 is 40,
    // 2021 is 40 * 1.025 = 41 and 2022 is 40 * 1.025^2 = 42.025.
    assert_eq!(stored(&resolver, 579, 2027, 1, 2, 2020), Some(40.0));
    assert_close(stored(&resolver, 579, 2027, 1, 2, 2021), 41.0, 1e-9, "(579,2027,s2) at 2021");
    assert_close(stored(&resolver, 579, 2027, 1, 2, 2022), 42.025, 1e-9, "(579,2027,s2) at 2022");
    // (595,2027,s2) is GrowthAs with elasticity, but its Current Accounts memo is
    // one stray byte rather than a base value, so it reads nothing, not a guess.
    assert_eq!(stored(&resolver, 595, 2027, 1, 2, 2027), None);
}

#[test]
fn variable_and_constant_references_resolve_through_the_area() {
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, reference test skipped");
        return;
    };
    // @V(556,2027,-99,-99,0,0,0,0) in Baseline inherits the Current Accounts 3.5.
    let tree = expr::parse("@V(556,2027,-99,-99,0,0,0,0)").expect("@V parses");
    let ctx = eval::Context::new(&resolver, 1, 2, 32, 2027);
    assert_eq!(eval::at(&ctx, &tree, 2027), Some(3.5));
    // @C0004/@C0003 is the sulfur ratio the constants state: 64.063/32.064.
    let tree = expr::parse("@C0004/@C0003").expect("the sulfur ratio parses");
    assert_eq!(eval::at(&ctx, &tree, 2027), Some(64.063 / 32.064));
    // Selectors outside the area -- region 0, scenario -1 -- read nothing.
    let tree = expr::parse("@F037(32,2027,0,-1,0,0,0,0)").expect("explicit selectors parse");
    assert_eq!(eval::at(&ctx, &tree, 2027), None);
    let tree = expr::parse("0.1 * @V(-12,1538,0,-1,0,0,0,0)").expect("the stored odd reference parses");
    assert_eq!(eval::at(&ctx, &tree, 2027), None);
}
#[test]
fn the_entry_point_values_a_stored_expression_in_context() {
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, entry point test skipped");
        return;
    };
    // One way in: an expression's text plus branch, variable, region, scenario
    // and year gives a value or nothing. The Growth row (2,2027,s2) compounds
    // the Current Accounts 8 at 3% to 8 * 1.03^7 in 2027.
    let text = resolver.expression(2, 2027, 1, 2).expect("Baseline (2,2027) row");
    assert_eq!(text, "@F001(@F010(3))");
    assert_close(eval::text_in_context(&resolver, text, 2, 2027, 1, 2, 2027), 9.8389909234, 1e-9, "entry point on (2,2027)");
    // The Interp text heads the Current Accounts 25 at the base year.
    assert_eq!(eval::text_in_context(&resolver, "@F007(\u{a4}2030,28, 2050,50\u{a4})", 48, 2027, 1, 2, 2020), Some(25.0));
    // What is not arithmetic, or names a row the area never states, reads nothing.
    assert_eq!(eval::text_in_context(&resolver, "not arithmetic", 2, 2027, 1, 2, 2027), None);
    assert_eq!(eval::text_in_context(&resolver, "@V(842,1,-99,-99,0,0,0,0)", 840, 991, 1, 12, 2027), None);
    // The context-free path is unchanged: it values what needs no area.
    assert_eq!(eval::text("1+@F010(50)"), Some(1.5));
    assert_eq!(eval::text("@F001(1)"), None);
}
#[test]
fn the_base_year_override_heads_a_late_starting_series() {
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, override test skipped");
        return;
    };
    // (48,2027,s2) states Current Accounts 25, so a series starting in 2030
    // gains the base-year point up front.
    let points = expr::parse_series("2030,28, 2050,50").expect("hand-written series parses");
    let ctx = eval::Context::new(&resolver, 1, 2, 48, 2027);
    assert_eq!(eval::base_year_override(&ctx, &points), vec![expr::SeriesPoint { year: 2020, value: 25.0 }, expr::SeriesPoint { year: 2030, value: 28.0 }, expr::SeriesPoint { year: 2050, value: 50.0 }]);
    // A series that already reaches the base year rules on its own ...
    let old = expr::parse_series("2010,14.3, 2020,23.9").expect("hand-written series parses");
    let ctx = eval::Context::new(&resolver, 1, 1, 829, 991);
    assert_eq!(eval::base_year_override(&ctx, &old), old);
    // ... as does one with no Current Accounts row to head it.
    let one = expr::parse_series("2031,30").expect("hand-written series parses");
    let ctx = eval::Context::new(&resolver, 1, 12, 842, 2145);
    assert_eq!(eval::base_year_override(&ctx, &one), one);
}
#[test]
fn stored_series_between_base_and_first_point_lerp_from_current_accounts() {
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, mid-lerp test skipped");
        return;
    };
    // (624,2147,s2): 2030 -> 5 through 2050 -> 20 from Current Accounts 0, so
    // 2020 reads 0, 2025 lerps to 2.5 and 2040 lerps to 12.5.
    assert_eq!(stored(&resolver, 624, 2147, 1, 2, 2020), Some(0.0));
    assert_eq!(stored(&resolver, 624, 2147, 1, 2, 2025), Some(2.5));
    assert_eq!(stored(&resolver, 624, 2147, 1, 2, 2040), Some(12.5));
    // (664,2145,s2): 2030 -> 14 through 2050 -> 23 from Current Accounts 6.
    assert_eq!(stored(&resolver, 664, 2145, 1, 2, 2020), Some(6.0));
    // (829,991,s1): the 2010-2020 history already reaches the base year, so no
    // point is headed: 2015 reads 19 and 2020 reads 23.9.
    assert_eq!(stored(&resolver, 829, 991, 1, 1, 2015), Some(19.0));
    assert_eq!(stored(&resolver, 829, 991, 1, 1, 2020), Some(23.9));
}
#[test]
fn million_and_billion_scale_by_powers_of_ten() {
    // _million is FUN_01bcf370 (param * 10^6) and _billion is FUN_01bcf3b0
    // (param * 10^9), both through the integer power FUN_0053a590.
    assert_eq!(eval::million_value(1.0), 1e6);
    assert_eq!(eval::billion_value(1.0), 1e9);
    assert_eq!(eval::text("@F029(65)"), Some(65e6));
    assert_close(eval::text("@F029(36)/@F030(1.8)"), 0.02, 1e-12, "36 million over 1.8 billion");
    assert_eq!(eval::text("@F029(1,2)"), None);
    // The stored ratio (583,2040,s1) is that same division.
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, stored million test skipped");
        return;
    };
    assert_close(stored(&resolver, 583, 2040, 1, 1, 2027), 0.02, 1e-12, "(583,2040,s1) at 2027");
    assert_eq!(stored(&resolver, 838, 1538, 1, 1, 2027), Some(65e6));
}
#[test]
fn stored_baseline_value_reads_the_baseline_scenario() {
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, baseline value test skipped");
        return;
    };
    // (583,2040,s10) is @F069 times Interp(2020 -> 1, 2050 -> 0.7): the
    // BaselineValue reads (583,2040) in Baseline (s2), which states the
    // million/billion ratio 0.02, so 2020 is 0.02 and 2035 is 0.02 * 0.85.
    assert_close(stored(&resolver, 583, 2040, 1, 10, 2020), 0.02, 1e-9, "(583,2040,s10) at 2020");
    assert_close(stored(&resolver, 583, 2040, 1, 10, 2035), 0.017, 1e-9, "(583,2040,s10) at 2035");
    // In Baseline itself the engine falls back to Current Accounts, which states
    // the same ratio here; in Current Accounts there is no baseline value.
    assert_close(eval::text_in_context(&resolver, "@F069", 583, 2040, 1, 2, 2035), 0.02, 1e-9, "@F069 in Baseline");
    assert_eq!(eval::text_in_context(&resolver, "@F069", 583, 2040, 1, 1, 2035), None);
    // (840,991,s12) subtracts a variable reference the area never states, so it
    // reads nothing rather than a partial value.
    assert_eq!(stored(&resolver, 840, 991, 1, 12, 2027), None);
}
#[test]
fn the_share_of_stored_expressions_that_evaluate() {
    let Some(resolver) = shipped_resolver() else {
        eprintln!("note: {AREA} not found, share test skipped");
        return;
    };
    // Every stored expression at 2027 in its own row context: 1009 rows, of
    // which 861 evaluate. The rest refuse for a stated reason each.
    let bytes = member("scenariodata").expect("scenariodata ships with the area");
    let exprs = resolve::scenario_expressions(&bytes);
    assert_eq!(exprs.len(), 1009);
    let ported: Vec<u32> = eval::PORTED.iter().map(|(code, ..)| *code).collect();
    let (mut some, mut parse_fail, mut unsettled, mut unresolvable) = (0, 0, 0, 0);
    for row in &exprs {
        let value = eval::text_in_context(&resolver, &row.text, row.branch, row.variable, row.region, row.scenario, 2027);
        if value.is_some() {
            some += 1;
            continue;
        }
        match expr::parse(&row.text) {
            Err(_) => parse_fail += 1,
            Ok(parsed) => {
                let mut codes = Vec::new();
                collect_codes(&parsed, &mut codes);
                if codes.iter().any(|code| !ported.contains(code)) {
                    unsettled += 1;
                } else {
                    unresolvable += 1;
                }
            }
        }
    }
    assert_eq!(some, 861, "stored expressions evaluating at 2027");
    // Ten of the texts that used to refuse to parse are a single name, and a name is now a
    // token: they parse and have no value, so they count as unresolvable rather than as text
    // the reader cannot take. The rest are padded property refs, unit strings and noted
    // memos, which still do not parse.
    assert_eq!(parse_fail, 59, "padded property refs, unit strings and noted memos");
    assert_eq!(unsettled, 67, "fuel properties, Remainder and YearlyShape");
    assert_eq!(unresolvable, 22, "missing rows, unknown constants, junk bases and names");
}
