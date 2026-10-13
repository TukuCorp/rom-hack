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
