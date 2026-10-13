//! What each function code in the expression language is.
//!
//! `crate::expr` reads arithmetic as `@F<code>` references without knowing what the
//! codes mean. This module supplies the meaning, and it does not come from reading the
//! expressions: the vendor builds one registry at startup, and
//! `tools/capture_function_table.py` reads every entry out of that builder, so the name
//! attached to a code is the name LEAP itself attaches to it.
//!
//! Two things in the registry are worth knowing before reading an expression.
//!
//! The marker text is not a formatting guess. The builder formats `"000%d"` with the
//! code, takes the trailing three characters, and prefixes `"@F"`; `marker`
//! reproduces that, which is why it and the expression parser have to agree on every code.
//!
//! The second name is the more interesting one. Where the first name is localised, the
//! registration still spells the second out as a literal, and that literal is a compressed
//! form of what the function does: `_gr` for Growth, `_in` for Interp, `_Data` for
//! Data, `_gras` for GrowthAs. The fuel and other property codes are numbered in the
//! same space and registered at a different site, which is what makes the corpus expression
//! `@F176*(1-@F185)*(@C0004/@C0003)` checkable rather than merely plausible: 176 is
//! sulfur content and 185 is sulfur retention, so that expression is the sulfur emission
//! factor it looks like.
//!
//! What the registry does not carry is arity. The truth about how many arguments a function
//! takes is in the record fields the builder fills from parameters that the common call
//! sites do not pass, so it is not recoverable from those sites and this module does not
//! pretend otherwise.

use crate::oracle_functions::{LEAP_EVALUATORS, LEAP_FUNCTIONS, LEAP_PROPERTIES};

/// The evaluator behind a second name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Evaluator {
    /// The second name, as the dispatch spells it, which is lower case.
    pub short: &'static str,
    /// The helper the dispatch handed it to, one of the `FUN_01b5c...` family. The helper a
    /// name uses is a statement about the evaluator's signature, which is a later read.
    pub helper: &'static str,
    /// Where the function that evaluates the name starts.
    pub address: usize,
}

/// The evaluator the dispatch registers for a second name.
///
/// The dispatch folds case and the registry does not, so `_Data` there is `_data` here and
/// the match is case-insensitive on purpose. Twenty-seven of the registry's second names are
/// registered nowhere in the dispatch, all of them the plain math functions such as Abs and
/// Sqrt plus the financial ones from Sign to Power; those are a separate read.
pub fn evaluator(short: &str) -> Option<Evaluator> {
    LEAP_EVALUATORS
        .iter()
        .find(|(name, _, _)| name.eq_ignore_ascii_case(short))
        .map(|(name, helper, address)| Evaluator {
            short: name,
            helper: *helper,
            address: *address,
        })
}

/// The evaluator registered for a function code, following its second name.
pub fn evaluator_of(code: u32) -> Option<Evaluator> {
    short_name(code).and_then(evaluator)
}

/// The marker text the vendor builds for a code.
///
/// `FUN_01b90910` formats `"000%d"` with the code, takes the trailing three characters
/// through `FUN_02de09f0(_, _, 3)`, and prefixes the `"@F"` literal at 0x01b908ec. Every
/// registered code is under a thousand, so this is the same text for all of them, and it is
/// written the way the vendor writes it rather than as a format string.
pub fn marker(code: u32) -> String {
    let padded = format!("000{code}");
    format!("@F{}", &padded[padded.len() - 3..])
}

/// The whole row for a code: (code, name, name resource id, second name).
pub fn lookup(
    code: u32,
) -> Option<(u32, Option<&'static str>, Option<u32>, Option<&'static str>)> {
    LEAP_FUNCTIONS
        .binary_search_by(|row| row.0.cmp(&code))
        .ok()
        .map(|i| LEAP_FUNCTIONS[i])
}

/// The name LEAP gives a code, when the registry names it.
pub fn name(code: u32) -> Option<&'static str> {
    lookup(code).and_then(|row| row.1)
}

/// The second name the registration spells out.
pub fn short_name(code: u32) -> Option<&'static str> {
    lookup(code).and_then(|row| row.3)
}

/// The resource id the name came from, when it was not a literal at the call site.
pub fn name_resource(code: u32) -> Option<u32> {
    lookup(code).and_then(|row| row.2)
}

/// The property a code yields, when the vendor maps a property name to it.
pub fn property(code: u32) -> Option<&'static str> {
    LEAP_PROPERTIES
        .iter()
        .find(|(_, c)| *c == code)
        .map(|(name, _)| *name)
}

/// The code a property is expressed as, when the vendor names the property.
pub fn property_code(name: &str) -> Option<u32> {
    LEAP_PROPERTIES
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, code)| *code)
}

/// What the code is called: its function name, or failing that the property it yields.
///
/// The `@F` numbering is shared between the two. A fuel property is written `@F176` in the
/// arithmetic and named by the property table rather than by the function registry, which is
/// why this falls back rather than reporting the code as unknown.
pub fn describe(code: u32) -> Option<&'static str> {
    name(code).or_else(|| property(code))
}

/// Whether either table names the code.
pub fn known(code: u32) -> bool {
    describe(code).is_some()
}
