//! Tests for the expression-function registry.
//!
//! The registry is not a reading of the expressions; it is what the vendor's own builder
//! states. So these tests are mostly about agreement between independent artefacts: the codes
//! the stored expressions spell, the marker text the builder constructs, the property
//! numbering a second registration site states, and the evaluator the dispatch points at.

use leap_rs::expr::{self, BinOp, Expr};
use leap_rs::functions;
use leap_rs::oracle_functions::{LEAP_EVALUATORS, LEAP_FUNCTIONS, LEAP_PROPERTIES};
use leap_rs::oracle_nx1_expr::NX1_EXPRESSIONS;

/// Every `@F<code>` in a text, as (as written, code).
fn codes_in_expression(text: &str) -> Vec<(&str, u32)> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 2 < bytes.len() {
        if bytes[i] == b'@' && bytes[i + 1] == b'F' && bytes[i + 2].is_ascii_digit() {
            let mut j = i + 2;
            while j < bytes.len() && bytes[j].is_ascii_digit() {
                j += 1;
            }
            out.push((&text[i..j], text[i + 2..j].parse::<u32>().expect("digits")));
            i = j;
            continue;
        }
        i += 1;
    }
    out
}

fn code_of(expr: &Expr) -> u32 {
    match expr {
        Expr::Func { code, args: None } => *code,
        other => panic!("expected a bare function reference, got {other:?}"),
    }
}

#[test]
fn the_registry_is_complete_and_ordered() {
    assert_eq!(LEAP_FUNCTIONS.len(), 354);
    let mut previous = 0;
    for (code, name, _, short) in LEAP_FUNCTIONS {
        assert!(*code > previous, "codes must ascend: {code} after {previous}");
        previous = *code;
        let name = name.unwrap_or_else(|| panic!("code {code} has no name"));
        assert!(!name.is_empty(), "code {code} has an empty name");
        assert!(short.is_some(), "code {code} has no second name");
    }
    assert_eq!(LEAP_FUNCTIONS[0].0, 1);
    assert_eq!(LEAP_FUNCTIONS[LEAP_FUNCTIONS.len() - 1].0, 406);
}

#[test]
fn the_names_are_the_ones_the_builder_states() {
    for (code, name, short) in [
        (1u32, "Growth", "_gr"),
        (7, "Interp", "_in"),
        (8, "Step", "_sp"),
        (37, "GrowthAs", "_gras"),
        (41, "GrowthAs", "_grasel"),
        (43, "AnnualizedCost", "_AnnualizedCostSimple"),
        (83, "Data", "_Data"),
        (164, "YearlyShape", "_yrsh1"),
        (369, "Tariff", "_tariff"),
    ] {
        assert_eq!(functions::name(code), Some(name), "code {code}");
        assert_eq!(functions::short_name(code), Some(short), "code {code}");
    }
    assert_eq!(functions::lookup(0), None, "no function is registered as zero");
    assert_eq!(functions::name(407), None);
}

/// Every function call in a tree, as (code, how many arguments).
fn calls(expr: &Expr, out: &mut Vec<(u32, usize)>) {
    match expr {
        Expr::Func { code, args } => {
            if let Some(args) = args {
                out.push((*code, args.len()));
                for arg in args {
                    calls(arg, out);
                }
            }
        }
        Expr::Var { args } => {
            if let Some(args) = args {
                for arg in args {
                    calls(arg, out);
                }
            }
        }
        Expr::Binary { lhs, rhs, .. } => {
            calls(lhs, out);
            calls(rhs, out);
        }
        Expr::Unary { expr, .. } => calls(expr, out),
        Expr::Paren(inner) => calls(inner, out),
        Expr::Number(_) | Expr::Const(_) | Expr::Series(_) => {}
    }
}

#[test]
fn every_call_the_vendor_stored_takes_the_number_of_arguments_the_binary_states() {
    // Two independent artefacts: the registration helpers in leap.exe, which state an arity per
    // signature, and the arithmetic the area stores. If either reading is wrong this fails.
    let mut checked = 0;
    let mut codes = std::collections::BTreeSet::new();
    for (table, at, _, text) in NX1_EXPRESSIONS {
        let tree = expr::parse(text).unwrap_or_else(|e| panic!("{table} at {at:#x}: {e}"));
        let mut found = Vec::new();
        calls(&tree, &mut found);
        for (code, count) in found {
            if let Some(arity) = functions::arity(code) {
                assert_eq!(
                    count as u32, arity,
                    "{} at {:#x}: {} takes {} arguments, not {}",
                    table, at, functions::marker(code), arity, count
                );
                codes.insert(code);
                checked += 1;
            }
        }
    }
    assert_eq!(checked, 36, "calls with a stated arity in the corpus");
    assert_eq!(codes, [1u32, 7, 8, 10, 37, 41, 43].into_iter().collect());

    // The numbers are the binary\u0027s, and they line up with the shapes in the corpus.
    assert_eq!(functions::arity(1), Some(1), "Growth takes a value");
    assert_eq!(functions::arity(37), Some(8), "GrowthAs takes a branch, a year and six flags");
    assert_eq!(functions::arity(41), Some(9), "GrowthAs with a rate takes one more");
    assert_eq!(functions::arity(43), Some(2), "annualized cost takes a rate and a life");
    assert_eq!(functions::arity(176), None, "a fuel property is not a function");
}

#[test]
fn every_code_the_vendor_stored_is_registered_and_spelled_the_same_way() {
    let mut seen = 0;
    for (table, at, _, text) in NX1_EXPRESSIONS {
        for (written, code) in codes_in_expression(text) {
            assert!(
                functions::known(code),
                "{} at {:#x}: {} names code {} which neither table names",
                table,
                at,
                written,
                code
            );
            assert_eq!(
                written,
                functions::marker(code),
                "{} at {:#x}: the file spells the code differently from the builder",
                table,
                at
            );
            seen += 1;
        }
    }
    assert_eq!(seen, 38, "the corpus holds this many @F references");

    // The numbering is shared between the function registry and the property table, and the
    // corpus uses both: @F001 is a registered function while @F176 is a fuel property.
    assert!(functions::name(1).is_some() && functions::property(1).is_none());
    assert!(functions::name(176).is_none() && functions::property(176).is_some());
}

#[test]
fn every_marker_parses_back_to_its_code() {
    for (code, _, _, _) in LEAP_FUNCTIONS {
        let text = functions::marker(*code);
        let tree = expr::parse(&text).unwrap_or_else(|e| panic!("{text}: {e}"));
        assert_eq!(
            tree,
            Expr::Func {
                code: *code,
                args: None
            },
            "{text}"
        );
    }
}

#[test]
fn the_property_numbering_agrees_with_the_expression_the_file_stores() {
    // A second registration site states the numbering, and it has to match.
    assert_eq!(functions::property(175), Some("carboncontent"));
    assert_eq!(functions::property(176), Some("sulfurcontent"));
    assert_eq!(functions::property(183), Some("density"));
    assert_eq!(functions::property(185), Some("sulfurretention"));
    assert_eq!(functions::property_code("sulfurcontent"), Some(176));
    assert_eq!(LEAP_PROPERTIES.len(), 16);

    // The stored expression is sulfur content times the unretained fraction times a ratio,
    // which is what a sulfur emission factor is. Reading the two codes out of the tree is
    // the check: they have to be the two properties by name, not merely two numbers.
    let source = "@F176*(1-@F185)*(@C0004/@C0003)";
    assert!(NX1_EXPRESSIONS.iter().any(|e| e.3 == source));
    let tree = expr::parse(source).unwrap();
    let Expr::Binary { op, lhs, .. } = tree else {
        panic!("expected a multiplication at the top")
    };
    assert_eq!(op, BinOp::Mul);
    let Expr::Binary { lhs: left, rhs, .. } = *lhs else {
        panic!("expected the nested multiplication")
    };
    assert_eq!(
        code_of(&left),
        functions::property_code("sulfurcontent").unwrap()
    );
    let Expr::Paren(inner) = *rhs else {
        panic!("expected the parenthesised term")
    };
    let Expr::Binary { op, rhs: sub, .. } = *inner else {
        panic!("expected the parenthesised subtraction")
    };
    assert_eq!(op, BinOp::Sub);
    assert_eq!(
        code_of(&sub),
        functions::property_code("sulfurretention").unwrap()
    );
}

#[test]
fn the_dispatch_says_what_evaluates_each_name() {
    // The dispatch folds case; the registry does not.
    let growth = functions::evaluator("_gr").expect("Growth has an evaluator");
    assert_eq!(growth.short, "_gr");
    assert_eq!(growth.helper, "FUN_01b5c120");
    assert_eq!(growth.address, 0x01be7c10);

    let data = functions::evaluator("_Data").expect("the match folds case");
    assert_eq!(data.short, "_data");
    assert_eq!(functions::evaluator_of(83).map(|e| e.short), Some("_data"));

    // The year shape function is the one the corpus keeps referring to, pinned by both the
    // address and the helper so that a mistaken regeneration shows up here.
    let shape = functions::evaluator_of(164).expect("@F164 is YearlyShape");
    assert_eq!(shape.address, 0x01c16190);
    assert_eq!(shape.helper, "FUN_01b5c120");

    assert_eq!(functions::evaluator("_nonesuch"), None);
    // A property code has no evaluator, because it is not a function.
    assert_eq!(functions::evaluator_of(176), None);
}

#[test]
fn every_evaluator_is_a_real_entry_point_and_the_gaps_are_the_known_ones() {
    assert_eq!(LEAP_EVALUATORS.len(), 332);
    for (name, helper, address) in LEAP_EVALUATORS {
        assert!(!name.is_empty() && name.is_ascii(), "{name}");
        assert!(helper.starts_with("FUN_01b5c"), "{name} was registered by {helper}");
        assert!(*address >= 0x1000, "{name} has no address");
    }

    // The names the dispatch does not cover. They are the plain math functions and the
    // financial ones, evaluated somewhere other than a dispatched function, and the count is
    // pinned so that a registration site going missing is loud.
    let missing: Vec<&str> = LEAP_FUNCTIONS
        .iter()
        .filter_map(|(_, _, _, short)| *short)
        .filter(|short| functions::evaluator(short).is_none())
        .collect();
    assert_eq!(missing.len(), 27, "uncovered second names: {missing:?}");
    for name in ["Abs", "Sqrt", "Round", "_Power", "_Sign", "_Trillion", "_BranchVisible"] {
        assert!(missing.contains(&name), "{name} should be one of the uncovered");
    }
}

#[test]
fn every_function_the_corpus_calls_has_an_evaluator() {
    let mut checked = 0;
    for (_, _, _, text) in NX1_EXPRESSIONS {
        for (_, code) in codes_in_expression(text) {
            if functions::name(code).is_none() {
                continue;
            }
            let evaluator = functions::evaluator_of(code)
                .unwrap_or_else(|| panic!("code {code} is a function with no evaluator"));
            assert!(evaluator.address >= 0x1000);
            checked += 1;
        }
    }
    assert!(checked > 0);
}
