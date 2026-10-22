//! Tests for the expression reader over the vendor's own stored expressions.
//!
//! Nothing here is a fixture. The corpus in `oracle_nx1_expr` is what the scenario table of
//! the LEAP area carries, captured as UTF-16 text with the byte window each expression was
//! read from, and the tests use both halves: the text for the reader and the window for the
//! scanner. The capture tool implements the same scanning rule in Python, so the window
//! comparison is two independent readers meeting on the vendor's bytes rather than one
//! reader meeting its own output.
//!
//! The round trip is the strongest claim here, and it is worth being exact about it. LEAP
//! is not consistent about whitespace between arguments, so a canonical form cannot equal
//! the source character for character. What is asserted instead is that the token stream
//! covers every non-whitespace byte of the source in order, and that the canonical form is a
//! fixed point: parse it and you get an equal tree which prints the same text.

use leap_rs::expr::{self, BinOp, Expr, UnOp};
use leap_rs::{container, heap, records};
use leap_rs::oracle_nx1_expr::NX1_EXPRESSIONS;

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "hex payload has an odd length");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex payload is not hex"))
        .collect()
}

fn num(text: &str) -> Expr {
    Expr::Number(text.to_string())
}

fn func(code: u32, args: Vec<Expr>) -> Expr {
    Expr::Func {
        code,
        args: Some(args),
    }
}

fn bare_func(code: u32) -> Expr {
    Expr::Func { code, args: None }
}

fn var(args: Vec<Expr>) -> Expr {
    Expr::Var { args: Some(args) }
}

fn binary(op: BinOp, lhs: Expr, rhs: Expr) -> Expr {
    Expr::Binary {
        op,
        lhs: Box::new(lhs),
        rhs: Box::new(rhs),
    }
}

fn neg(inner: Expr) -> Expr {
    Expr::Unary {
        op: UnOp::Neg,
        expr: Box::new(inner),
    }
}

/// The eight-number tail the corpus uses for "not applicable", which is the same in every
/// variable reference.
fn not_applicable() -> Vec<Expr> {
    let mut args = Vec::new();
    for _ in 0..4 {
        args.push(num("0"));
    }
    args
}

#[test]
fn the_corpus_is_the_whole_vendor_area() {
    assert_eq!(NX1_EXPRESSIONS.len(), 44);
    let mut texts: Vec<&str> = NX1_EXPRESSIONS.iter().map(|e| e.3).collect();
    texts.sort_unstable();
    texts.dedup();
    assert_eq!(texts.len(), 44, "the capture holds a duplicate");

    for (table, _, _, text) in NX1_EXPRESSIONS {
        assert_eq!(*table, "scenariodata.nx1");
        assert!(
            ["@F", "@V", "@C"].iter().any(|m| text.contains(m)),
            "{text} carries no reference marker"
        );
    }
    assert!(
        NX1_EXPRESSIONS.iter().any(|e| e.3.contains(expr::SERIES_DELIM)),
        "the corpus should exercise a series literal"
    );
}

#[test]
fn the_scanner_reads_the_vendor_bytes() {
    for (table, at, window, text) in NX1_EXPRESSIONS {
        let bytes = unhex(window);
        let got = expr::scan(&bytes, bytes.len());
        assert_eq!(
            got,
            vec![text.to_string()],
            "{} at {:#x} should read back as one expression",
            table,
            at
        );
    }
}

#[test]
fn a_run_without_a_marker_is_not_an_expression() {
    // The tables also carry URL-encoded HTML, whose @page rule is the trap: it is a wide,
    // NUL-terminated, printable run that looks like arithmetic until the marker is checked.
    let mut buf = Vec::new();
    for c in "%3Cstyle%3E@page".bytes() {
        buf.push(c);
        buf.push(0);
    }
    buf.extend_from_slice(&[0, 0]);
    assert!(expr::scan(&buf, buf.len()).is_empty());

    // A name with no marker is a name.
    let mut name = Vec::new();
    for c in "Electricity".bytes() {
        name.push(c);
        name.push(0);
    }
    name.extend_from_slice(&[0, 0]);
    assert!(expr::scan(&name, name.len()).is_empty());
}

#[test]
fn the_token_stream_covers_every_non_whitespace_byte() {
    for (table, at, _, text) in NX1_EXPRESSIONS {
        let tokens = expr::tokenize(text)
            .unwrap_or_else(|e| panic!("{} at {:#x}: {} in {:?}", table, at, e, text));
        let mut covered = String::new();
        let mut prev = 0usize;
        for t in &tokens {
            let gap = &text[prev..t.start];
            assert!(
                gap.chars().all(char::is_whitespace),
                "unlexed {:?} in {:?}",
                gap,
                text
            );
            covered.push_str(&text[t.start..t.end]);
            prev = t.end;
        }
        let tail = &text[prev..];
        assert!(tail.chars().all(char::is_whitespace));
        // Whitespace inside a token is kept, because a series literal carries the spaces
        // the file wrote between its year and value. What must hold either way is that the
        // tokens carry every non-whitespace character exactly once, in order.
        let carried: String = covered.chars().filter(|c| !c.is_whitespace()).collect();
        let written: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        assert_eq!(carried, written, "tokens miss bytes of {:?}", text);
    }
}

#[test]
fn the_canonical_form_is_a_fixed_point() {
    for (table, at, _, text) in NX1_EXPRESSIONS {
        let tree = expr::parse(text)
            .unwrap_or_else(|e| panic!("{} at {:#x}: {} in {:?}", table, at, e, text));
        let canon = tree.to_string();
        let again = expr::parse(&canon)
            .unwrap_or_else(|e| panic!("{} at {:#x}: {} in the canonical {:?}", table, at, e, canon));
        assert_eq!(again, tree, "canonical form of {:?} changed the tree", text);
        assert_eq!(again.to_string(), canon);
    }
}

#[test]
fn the_shapes_in_the_corpus_parse_as_written() {
    assert_eq!(expr::parse("@F001(@F010(3))").unwrap(), func(1, vec![func(10, vec![num("3")])]));

    assert_eq!(
        expr::parse("@F007(\u{a4}2050, 55\u{a4})").unwrap(),
        func(7, vec![Expr::Series("2050, 55".to_string())])
    );

    assert_eq!(
        expr::parse("@F043(1*5, 1)").unwrap(),
        func(43, vec![binary(BinOp::Mul, num("1"), num("5")), num("1")])
    );

    // A bare function reference is a reference with no argument list, and the two
    // multiplications associate to the left.
    assert_eq!(
        expr::parse("@F176*(1-@F185)*(@C0004/@C0003)").unwrap(),
        binary(
            BinOp::Mul,
            binary(
                BinOp::Mul,
                bare_func(176),
                Expr::Paren(Box::new(binary(BinOp::Sub, num("1"), bare_func(185))))
            ),
            Expr::Paren(Box::new(binary(BinOp::Div, Expr::Const(4), Expr::Const(3))))
        )
    );

    // A negative variable id is a unary minus on a number, not part of the id.
    let mut negative = vec![neg(num("12")), num("1538")];
    negative.push(neg(num("99")));
    negative.push(neg(num("99")));
    negative.extend(not_applicable());
    assert_eq!(
        expr::parse("0.07 * @V(-12,1538,-99,-99,0,0,0,0)").unwrap(),
        binary(BinOp::Mul, num("0.07"), var(negative))
    );

    // The nine-argument form keeps its trailing value, and a surface level function call
    // is just an argument like any other.
    let mut forecast = vec![num("32"), num("2027")];
    forecast.push(neg(num("99")));
    forecast.push(neg(num("99")));
    forecast.extend(not_applicable());
    forecast.push(num("1.1"));
    assert_eq!(expr::parse("@F041(32,2027,-99,-99,0,0,0,0, 1.1)").unwrap(), func(41, forecast));
}

#[test]
fn whitespace_is_normalised_and_nothing_else_is() {
    assert_eq!(
        expr::parse("@V(296,2027,-99,-99,0,0,0,0) * @V(295,2027,-99,-99,0,0,0,0)")
            .unwrap()
            .to_string(),
        "@V(296,2027,-99,-99,0,0,0,0)*@V(295,2027,-99,-99,0,0,0,0)"
    );
    assert_eq!(
        expr::parse("@F001(@F010(.5))").unwrap().to_string(),
        "@F001(@F010(.5))",
        "a leading dot is how the file spells it"
    );
    assert_eq!(
        expr::parse("@F007(\u{a4}2010, 14.3\u{a4})").unwrap().to_string(),
        "@F007(\u{a4}2010, 14.3\u{a4})"
    );
}

#[test]
fn precedence_and_associativity() {
    assert_eq!(
        expr::parse("1+2*3").unwrap(),
        binary(BinOp::Add, num("1"), binary(BinOp::Mul, num("2"), num("3")))
    );
    assert_eq!(
        expr::parse("1-2-3").unwrap(),
        binary(BinOp::Sub, binary(BinOp::Sub, num("1"), num("2")), num("3"))
    );
    assert_eq!(
        expr::parse("8/4/2").unwrap(),
        binary(BinOp::Div, binary(BinOp::Div, num("8"), num("4")), num("2"))
    );
    assert_eq!(
        expr::parse("-(1+2)").unwrap(),
        neg(Expr::Paren(Box::new(binary(BinOp::Add, num("1"), num("2")))))
    );
}

#[test]
fn the_power_and_the_comparisons_bind_as_the_language_states() {
    // `^` is the power, it associates to the right and it binds tighter than `*`.
    assert_eq!(
        expr::parse("2^3^2").unwrap(),
        binary(BinOp::Pow, num("2"), binary(BinOp::Pow, num("3"), num("2")))
    );
    assert_eq!(
        expr::parse("2*3^2").unwrap(),
        binary(BinOp::Mul, num("2"), binary(BinOp::Pow, num("3"), num("2")))
    );
    // A unary minus applies to the power, so `-2^2` is `-(2^2)`.
    assert_eq!(
        expr::parse("-2^2").unwrap(),
        neg(binary(BinOp::Pow, num("2"), num("2")))
    );
    // A comparison is looser than a sum, so `1<2+3` is `1<(2+3)`.
    assert_eq!(
        expr::parse("1<2+3").unwrap(),
        binary(BinOp::Lt, num("1"), binary(BinOp::Add, num("2"), num("3")))
    );
    for (op, text) in [
        (BinOp::Lt, "<"),
        (BinOp::Gt, ">"),
        (BinOp::Le, "<="),
        (BinOp::Ge, ">="),
        (BinOp::Eq, "="),
        (BinOp::Ne, "<>"),
    ] {
        let tree = expr::parse(&format!("1{text}2")).unwrap();
        assert_eq!(tree, binary(op, num("1"), num("2")), "{text}");
        assert_eq!(tree.to_string(), format!("1{text}2"), "{text} prints back as written");
    }
}

#[test]
fn a_name_is_a_token_and_prints_back_as_itself() {
    assert_eq!(expr::parse("year").unwrap(), Expr::Ident("year".to_string()));
    assert_eq!(expr::parse("year").unwrap().to_string(), "year");
    assert_eq!(
        expr::parse("year*2").unwrap(),
        binary(BinOp::Mul, Expr::Ident("year".to_string()), num("2"))
    );
}

#[test]
fn forms_outside_the_language_are_refused() {
    for (src, at) in [
        ("", 0usize),
        ("@F(", 0),
        ("@F", 0),
        ("@Z1", 0),
        ("1+", 2),
        ("(@F001(3)", 9),
        ("@F001(3))", 8),
        ("1 & 2", 2),
        ("\u{a4}12", 0),
    ] {
        let err = expr::parse(src)
            .err()
            .unwrap_or_else(|| panic!("{:?} should not parse", src));
        assert_eq!(err.at, at, "{:?}: {}", src, err);
        assert!(!err.message.is_empty());
    }
    // A named function is real in the binary but never appears stored, so it is refused
    // rather than guessed at.
    assert!(expr::parse("convunits(1,2)").is_err());
}

/// Every series literal the area holds, as its raw inside-the-delimiters text.
fn area_series() -> Vec<String> {
    let mut out = Vec::new();
    for (_, _, _, text) in NX1_EXPRESSIONS {
        let tree = expr::parse(text).expect("the corpus parses");
        collect_series(&tree, &mut out);
    }
    out
}

fn collect_series(tree: &Expr, out: &mut Vec<String>) {
    match tree {
        Expr::Series(inner) => out.push(inner.clone()),
        Expr::Func { args: Some(args), .. } => {
            for arg in args {
                collect_series(arg, out);
            }
        }
        Expr::Var { args: Some(args) } => {
            for arg in args {
                collect_series(arg, out);
            }
        }
        Expr::Binary { lhs, rhs, .. } => {
            collect_series(lhs, out);
            collect_series(rhs, out);
        }
        Expr::Unary { expr, .. } => collect_series(expr, out),
        Expr::Paren(inner) => collect_series(inner, out),
        _ => {}
    }
}

#[test]
fn every_series_literal_the_area_holds_parses_to_year_value_pairs() {
    // Sixteen stored expressions carry a series literal: fifteen `@F007` and one `@F008`.
    // Each one is a flat run of year then value, comma-separated, years ascending -- the
    // shape the decompiled year/value-list validation reads (`FUN_01c25af0` in
    // `chunk-00338.c`: first parameter a valid year, years in ascending chronological
    // order, error text "Separate years and values with the list separator character").
    let inners = area_series();
    assert_eq!(inners.len(), 16, "every series literal the area holds");
    for inner in &inners {
        let points = expr::parse_series(inner)
            .unwrap_or_else(|e| panic!("{inner:?} should parse as year/value pairs: {e}"));
        assert!(points.len() >= 1, "{inner:?} holds at least one pair");
        for pair in points.windows(2) {
            assert!(pair[0].year < pair[1].year, "{inner:?}: years ascend");
        }
    }

    // Spot checks against the stored text, read by hand: a lone end-year pair, a two-pair
    // run, the eleven-year demand run, and the one Step literal.
    let lone = expr::parse_series("2050,600").unwrap();
    assert_eq!(lone.len(), 1);
    assert_eq!(lone[0].year, 2050);
    assert_eq!(lone[0].value, 600.0);
    let two = expr::parse_series("2030,28, 2050,50").unwrap();
    assert_eq!(
        two.iter().map(|p| (p.year, p.value)).collect::<Vec<_>>(),
        vec![(2030, 28.0), (2050, 50.0)]
    );
    let long = expr::parse_series(
        "2010, 14.3, 2011, 15.4, 2012, 15.9, 2013, 16.9, 2014, 18.2, 2015, 19, 2016, 19.7, 2017, 21, 2018, 21.6, 2019, 22.8, 2020, 23.9",
    )
    .unwrap();
    assert_eq!(long.len(), 11, "one pair per year 2010 to 2020");
    assert_eq!((long[0].year, long[0].value), (2010, 14.3));
    assert_eq!((long[10].year, long[10].value), (2020, 23.9));
    assert!(
        inners.iter().any(|inner| inner == "2031, 30"),
        "the Step literal is one of the sixteen"
    );
    let step = expr::parse_series("2031, 30").unwrap();
    assert_eq!((step[0].year, step[0].value), (2031, 30.0));
}

#[test]
fn every_series_literal_in_the_vendor_file_parses() {
    // The corpus covers the sixteen NUL-terminated series literals, but the area holds
    // more: memos without a terminator are invisible to the capture tool's scan while
    // the heap walk reads them through the record framing ("2050,25" sits
    // unterminated where "2050, 25" is terminated). So this walks every blob block of
    // the shipped scenario table through `heap`, the reader that resolves the rows,
    // and holds every distinct literal it finds against the typed grammar. Like the
    // area sweep, it prints a note and passes when LEAP is not installed.
    const AREA: &str = "C:/Program Files/LEAP/Freedonia.zip";
    let Some(zip) = std::fs::read(AREA).ok() else {
        eprintln!("note: {AREA} not found, series sweep skipped");
        return;
    };
    let names = container::member_names(&zip).expect("the vendor zip lists");
    let full = names
        .iter()
        .find(|name| name.to_lowercase().ends_with("/scenariodata.nx1"))
        .expect("the area holds a scenario table");
    let bytes = container::read_member(&zip, full).expect("a member the zip lists");
    let page = records::page_size(&bytes);
    let mut inners = std::collections::BTreeSet::new();
    for s in 0..bytes.len() / page {
        let block = &bytes[s * page..(s + 1) * page];
        if block.get(..4) != Some(&b"NXHD"[..]) {
            continue;
        }
        for memo in heap::memos(block) {
            let mut rest = memo.as_str();
            while let Some(open) = rest.find(expr::SERIES_DELIM) {
                let after = &rest[open + expr::SERIES_DELIM.len_utf8()..];
                let Some(close) = after.find(expr::SERIES_DELIM) else {
                    break;
                };
                inners.insert(after[..close].to_string());
                rest = &after[close + expr::SERIES_DELIM.len_utf8()..];
            }
        }
    }
    assert_eq!(inners.len(), 35, "every distinct series literal the area holds");
    for inner in &inners {
        let points = expr::parse_series(inner)
            .unwrap_or_else(|e| panic!("{inner:?} should parse as year/value pairs: {e}"));
        for pair in points.windows(2) {
            assert!(pair[0].year < pair[1].year, "{inner:?}: years ascend");
        }
    }
}

#[test]
fn a_malformed_series_is_refused_not_guessed() {
    // Odd token counts (with no growth tail, which the area never uses), empties,
    // non-numbers and years out of order are all refused.
    for inner in [
        "",
        "   ",
        "2050",
        "2050,600,2060",
        "2050,abc",
        "abc,600",
        "2050,",
        ",600",
        "2050,,600",
        "2060,1,2050,2",
        "2050,1,2050,2",
        "2050,1e3",
        "2050,NaN",
    ] {
        assert!(expr::parse_series(inner).is_err(), "{inner:?} should not parse");
    }
}
