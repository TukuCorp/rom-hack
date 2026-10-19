//! The LEAP expression language: the arithmetic a LEAP area stores as text.
//!
//! A LEAP area keeps its model equations in the scenario table as plain UTF-16 text, so
//! they are readable with no cipher. `crate::oracle_nx1_expr` holds every expression the
//! area that ships with LEAP carries, and this module turns each one into a tree and back
//! into text.
//!
//! The language is small. A reference is `@F<code>` for a function, `@V(...)` for a
//! variable and `@C<code>` for a constant, and an expression is those with numbers,
//! `+ - * /`, parentheses and comma-separated argument lists. Two details are corroborated
//! from inside the vendor binary rather than inferred from the corpus: the function codes
//! are real, because the binary formats `@F007`, `@F039` and `@F083` itself, and its own
//! error strings describe this syntax, including "Separate years and values with the list
//! separator character" for the year/value form.
//!
//! One part of that form is a delimited literal rather than an expression. LEAP writes a
//! time series as a function call whose argument is wrapped in U+00A4, the currency sign,
//! holding a flat run of year and value tokens. This module keeps that run verbatim in
//! `Expr::Series`, so a tree round-trips exactly, and `parse_series` reads the typed
//! year/value pairs out of it: comma-separated, alternating year then value, years strictly
//! ascending, as the decompiled year/value-list validation and LEAP's Interp help page read
//! them.
//!
//! What the codes mean is not established here, and the port does not act on it. `@F001`
//! wraps a value, `@F010` carries what looks like a percentage, `@F007` the series and
//! `@F043` a pair of numbers, but that reading comes from the shapes in the corpus and not
//! from an oracle. Evaluating an expression is a later step; this one is the reader.
//!
//! The grammar is deliberately strict. The binary carries strings such as `convunits(`
//! and `convfuelunits(`, but no stored expression in the corpus uses a named function, so
//! the lexer refuses anything outside the three markers instead of guessing. A form this
//! reader has not seen fails loudly, which is the behaviour a parity port wants.

use std::fmt;

/// The character LEAP wraps a time-series literal in. It is the one non-ASCII character
/// the expression alphabet contains, and a reader that only accepts ASCII drops every
/// expression built on a series.
pub const SERIES_DELIM: char = '\u{a4}';

/// The shortest run `scan` will report. Four is what keeps an incidental pair of bytes in
/// binary data from being read as an expression, and it is the same figure the capture
/// tool uses.
const MIN_RUN: usize = 4;

/// The markers that make a wide string an expression rather than a name or a blob of
/// URL-encoded HTML.
const MARKERS: [&str; 3] = ["@F", "@V", "@C"];

/// A lexed token, as a byte range in the source text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    /// A decimal number, kept as written so `0.07` and `.5` survive a round trip.
    Number,
    /// `@F<code>`, the function reference. The code itself is in the token text.
    FuncRef,
    /// `@V`, always followed by its argument list.
    VarRef,
    /// `@C<code>`, the constant reference.
    ConstRef,
    /// A delimited series literal, kept whole.
    Series,
    Plus,
    Minus,
    Star,
    Slash,
    Comma,
    LParen,
    RParen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinOp {
    Add,
    Sub,
    Mul,
    Div,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnOp {
    Neg,
    Pos,
}

/// A parsed expression.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Expr {
    /// A number, kept as the text the file spells.
    Number(String),
    /// `@F<code>` with an optional argument list, because the corpus has both
    /// `@F176*...` and `@F007(...)`.
    Func { code: u32, args: Option<Vec<Expr>> },
    Var { args: Option<Vec<Expr>> },
    Const(u32),
    /// The text between the delimiters of a series literal, without the delimiters.
    ///
    /// Kept verbatim so a tree round-trips exactly; `parse_series` reads the typed pairs
    /// out of it when the caller needs values rather than text.
    Series(String),
    Binary {
        op: BinOp,
        lhs: Box<Expr>,
        rhs: Box<Expr>,
    },
    Unary {
        op: UnOp,
        expr: Box<Expr>,
    },
    /// Parentheses are kept, because dropping them would change what re-parsing produces.
    Paren(Box<Expr>),
}

/// One year/value pair of a series literal, as `parse_series` reads it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SeriesPoint {
    pub year: i32,
    pub value: f64,
}

/// The inside of a series literal as year/value pairs.
///
/// The grammar is the flat run the area stores: comma-separated tokens alternating a year
/// and a value, at least one pair, years strictly ascending. That is what the decompiled
/// year/value-list validation reads: `FUN_01c25af0` (`chunk-00338.c`) refuses a first
/// parameter that is not a valid year and years that are not in ascending chronological
/// order, and its error text names the shape -- "Separate years and values with the list
/// separator character". LEAP's Interp help page shows the same run (`Interp(2000, 10,
/// 2010, 16, 2020, 30)`), with linear interpolation between neighbours and no extrapolation
/// past the ends.
///
/// Two things are deliberately strict. The separator is the comma the area holds: the engine
/// reads the Windows list separator, but no stored literal uses anything else, so anything
/// else is refused rather than guessed at. And a trailing odd token is refused even though
/// LEAP documents an optional growth rate after the last pair (`Interp(2000, 100, 2010, 150,
/// 2%)`): the area holds no such tail, so this reader does not model it yet.
///
/// A value is a plain decimal -- an optional sign, digits, an optional fraction -- because
/// that is every value the area spells. Exponents and non-finite text are refused.
pub fn parse_series(inner: &str) -> Result<Vec<SeriesPoint>, Error> {
    let mut points = Vec::new();
    let mut pending: Option<i32> = None;
    let mut at = 0usize;
    for raw in inner.split(',') {
        let start = at;
        at += raw.len() + ','.len_utf8();
        let token = raw.trim();
        if token.is_empty() {
            return Err(Error::new(start, "an empty entry in the series literal"));
        }
        let tok_at = start + (raw.len() - raw.trim_start().len());
        match pending.take() {
            None => match token.parse::<i32>() {
                Ok(year) => pending = Some(year),
                Err(_) => {
                    return Err(Error::new(tok_at, format!("{token:?} is not a year")));
                }
            },
            Some(year) => {
                let Some(value) = parse_series_value(token) else {
                    return Err(Error::new(tok_at, format!("{token:?} is not a value")));
                };
                if points.last().is_some_and(|prev: &SeriesPoint| year <= prev.year) {
                    return Err(Error::new(
                        tok_at,
                        "series years are not in ascending order",
                    ));
                }
                points.push(SeriesPoint { year, value });
            }
        }
    }
    if pending.is_some() {
        return Err(Error::new(
            inner.len(),
            "a year with no value ends the series literal",
        ));
    }
    if points.is_empty() {
        return Err(Error::new(0, "a series literal holds no year/value pair"));
    }
    Ok(points)
}

/// A plain decimal value: an optional sign, digits, an optional fraction, nothing else.
fn parse_series_value(token: &str) -> Option<f64> {
    let digits = token.strip_prefix(['+', '-']).unwrap_or(token);
    let (whole, frac) = match digits.split_once('.') {
        Some((whole, frac)) => (whole, Some(frac)),
        None => (digits, None),
    };
    if whole.is_empty() && frac.is_some_and(str::is_empty) {
        return None;
    }
    if !whole.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if frac.is_some_and(|frac| !frac.bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    if whole.is_empty() && frac.is_none() {
        return None;
    }
    let value: f64 = token.parse().ok()?;
    value.is_finite().then_some(value)
}

/// Where and why a source text is not an expression.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub at: usize,
    pub message: String,
}

impl Error {
    fn new(at: usize, message: impl Into<String>) -> Error {
        Error {
            at,
            message: message.into(),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at byte {}", self.message, self.at)
    }
}

impl std::error::Error for Error {}

/// Every expression in `bytes[..end]`, in first-seen order and without repeats.
///
/// This is `nx1::wide_strings` specialised to expressions, and it differs from that reader
/// in two ways that matter. It accepts the series delimiter, so an expression carrying a
/// series is read rather than cut short at that character, and it keeps only the runs that
/// carry one of the `@F`, `@V` or `@C` markers, so the URL-encoded HTML in the same
/// table is not mistaken for arithmetic. The capture tool implements the same rule in
/// Python, and the corpus test holds the two against the original bytes.
pub fn scan(bytes: &[u8], end: usize) -> Vec<String> {
    let end = end.min(bytes.len());
    let mut out: Vec<String> = Vec::new();
    let mut at = 0usize;
    while at + 2 * MIN_RUN + 2 <= end {
        if in_alphabet(bytes[at]) && bytes[at + 1] == 0 {
            let mut n = 0usize;
            while at + 2 * n + 1 < end
                && in_alphabet(bytes[at + 2 * n])
                && bytes[at + 2 * n + 1] == 0
            {
                n += 1;
            }
            if n >= MIN_RUN && bytes.get(at + 2 * n..at + 2 * n + 2) == Some(&[0u8, 0u8][..]) {
                let text: String = (0..n).map(|k| bytes[at + 2 * k] as char).collect();
                let text = text.trim().to_string();
                if !text.is_empty()
                    && MARKERS.iter().any(|m| text.contains(m))
                    && !out.contains(&text)
                {
                    out.push(text);
                }
                at += 2 * n;
                continue;
            }
        }
        at += 1;
    }
    out
}

/// Whether a low byte of a UTF-16 code unit belongs to the expression alphabet:
/// printable ASCII, the space, or the series delimiter.
fn in_alphabet(b: u8) -> bool {
    b == 0xa4 || b.is_ascii_graphic() || b == b' '
}

/// Split `src` into tokens, rejecting any character the language does not have.
pub fn tokenize(src: &str) -> Result<Vec<Token>, Error> {
    let bytes = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        let c = src[i..].chars().next().expect("i is a char boundary");
        if c.is_whitespace() {
            i += c.len_utf8();
            continue;
        }
        let start = i;
        let kind = match c {
            '+' => {
                i += 1;
                TokenKind::Plus
            }
            '-' => {
                i += 1;
                TokenKind::Minus
            }
            '*' => {
                i += 1;
                TokenKind::Star
            }
            '/' => {
                i += 1;
                TokenKind::Slash
            }
            ',' => {
                i += 1;
                TokenKind::Comma
            }
            '(' => {
                i += 1;
                TokenKind::LParen
            }
            ')' => {
                i += 1;
                TokenKind::RParen
            }
            '@' => {
                i = lex_reference(src, start)?;
                match bytes[start + 1] {
                    b'F' => TokenKind::FuncRef,
                    b'V' => TokenKind::VarRef,
                    _ => TokenKind::ConstRef,
                }
            }
            SERIES_DELIM => {
                let rest = &src[start + SERIES_DELIM.len_utf8()..];
                let Some(close) = rest.find(SERIES_DELIM) else {
                    return Err(Error::new(start, "series literal is not closed"));
                };
                i = start + SERIES_DELIM.len_utf8() + close + SERIES_DELIM.len_utf8();
                TokenKind::Series
            }
            c if c.is_ascii_digit() || (c == '.' && peek_digit(src, i + 1)) => {
                i = lex_number(src, start);
                TokenKind::Number
            }
            _ => return Err(Error::new(start, format!("unexpected character {c:?}"))),
        };
        out.push(Token {
            kind,
            start,
            end: i,
        });
    }
    Ok(out)
}

fn peek_digit(src: &str, at: usize) -> bool {
    src.as_bytes().get(at).is_some_and(|b| b.is_ascii_digit())
}

/// Consume one of the three references and return the index just past it.
fn lex_reference(src: &str, start: usize) -> Result<usize, Error> {
    let bytes = src.as_bytes();
    let marker = *bytes
        .get(start + 1)
        .ok_or_else(|| Error::new(start, "a reference ends after its marker"))?;
    let mut i = start + 2;
    match marker {
        b'V' => Ok(i),
        b'F' | b'C' => {
            let digits = i;
            while bytes.get(i).is_some_and(|b| b.is_ascii_digit()) {
                i += 1;
            }
            if i == digits {
                Err(Error::new(
                    start,
                    format!("@{} needs a code of one or more digits", marker as char),
                ))
            } else {
                Ok(i)
            }
        }
        _ => Err(Error::new(
            start,
            format!("unknown reference marker {:?}", marker as char),
        )),
    }
}

/// Consume a decimal number and return the index just past it.
fn lex_number(src: &str, start: usize) -> usize {
    let bytes = src.as_bytes();
    let mut i = start;
    let mut dot = false;
    while let Some(&b) = bytes.get(i) {
        if b.is_ascii_digit() {
            i += 1;
        } else if b == b'.' && !dot {
            dot = true;
            i += 1;
        } else {
            break;
        }
    }
    i
}

/// Parse an expression, requiring the whole text to be one.
pub fn parse(src: &str) -> Result<Expr, Error> {
    let tokens = tokenize(src)?;
    if tokens.is_empty() {
        return Err(Error::new(0, "empty expression"));
    }
    let mut p = Parser {
        src,
        tokens,
        at: 0,
    };
    let expr = p.sum()?;
    if let Some(t) = p.tokens.get(p.at) {
        return Err(Error::new(t.start, "trailing input after the expression"));
    }
    Ok(expr)
}

struct Parser<'a> {
    src: &'a str,
    tokens: Vec<Token>,
    at: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<TokenKind> {
        self.tokens.get(self.at).map(|t| t.kind)
    }

    fn here(&self) -> usize {
        self.tokens
            .get(self.at)
            .map(|t| t.start)
            .unwrap_or(self.src.len())
    }

    fn text(&self, t: Token) -> &'a str {
        &self.src[t.start..t.end]
    }

    /// `sum := product (('+' | '-') product)*`
    fn sum(&mut self) -> Result<Expr, Error> {
        let mut lhs = self.product()?;
        loop {
            let op = match self.peek() {
                Some(TokenKind::Plus) => BinOp::Add,
                Some(TokenKind::Minus) => BinOp::Sub,
                _ => return Ok(lhs),
            };
            self.at += 1;
            let rhs = self.product()?;
            lhs = Expr::Binary {
                op,
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
            };
        }
    }

    /// `product := unary (('*' | '/') unary)*`
    fn product(&mut self) -> Result<Expr, Error> {
        let mut lhs = self.unary()?;
        loop {
            let op = match self.peek() {
                Some(TokenKind::Star) => BinOp::Mul,
                Some(TokenKind::Slash) => BinOp::Div,
                _ => return Ok(lhs),
            };
            self.at += 1;
            let rhs = self.unary()?;
            lhs = Expr::Binary {
                op,
                lhs: Box::new(lhs),
                rhs: Box::new(rhs),
            };
        }
    }

    /// `unary := ('+' | '-') unary | primary`
    fn unary(&mut self) -> Result<Expr, Error> {
        let op = match self.peek() {
            Some(TokenKind::Minus) => UnOp::Neg,
            Some(TokenKind::Plus) => UnOp::Pos,
            _ => return self.primary(),
        };
        self.at += 1;
        let expr = self.unary()?;
        Ok(Expr::Unary {
            op,
            expr: Box::new(expr),
        })
    }

    fn primary(&mut self) -> Result<Expr, Error> {
        let Some(t) = self.tokens.get(self.at).copied() else {
            return Err(Error::new(self.src.len(), "expression ends too early"));
        };
        self.at += 1;
        match t.kind {
            TokenKind::Number => Ok(Expr::Number(self.text(t).to_string())),
            TokenKind::Series => {
                let inner =
                    &self.src[t.start + SERIES_DELIM.len_utf8()..t.end - SERIES_DELIM.len_utf8()];
                Ok(Expr::Series(inner.to_string()))
            }
            TokenKind::FuncRef => {
                let code = self.code(t, "function")?;
                Ok(Expr::Func {
                    code,
                    args: self.optional_arguments()?,
                })
            }
            TokenKind::ConstRef => {
                let code = self.code(t, "constant")?;
                Ok(Expr::Const(code))
            }
            TokenKind::VarRef => Ok(Expr::Var {
                args: self.optional_arguments()?,
            }),
            TokenKind::LParen => {
                let inner = self.sum()?;
                self.expect(TokenKind::RParen, "a closing parenthesis")?;
                Ok(Expr::Paren(Box::new(inner)))
            }
            other => Err(Error::new(
                t.start,
                format!("expected a value, found {other:?}"),
            )),
        }
    }

    /// The digits of an `@F` or `@C` token, taken from the text after the marker.
    fn code(&self, t: Token, what: &str) -> Result<u32, Error> {
        self.text(t)[2..]
            .parse::<u32>()
            .map_err(|_| Error::new(t.start, format!("{what} code is out of range")))
    }

    /// `'(' (expr (',' expr)*)? ')'`, or nothing at all.
    fn optional_arguments(&mut self) -> Result<Option<Vec<Expr>>, Error> {
        if self.peek() != Some(TokenKind::LParen) {
            return Ok(None);
        }
        self.at += 1;
        let mut args = Vec::new();
        if self.peek() != Some(TokenKind::RParen) {
            loop {
                args.push(self.sum()?);
                if self.peek() == Some(TokenKind::Comma) {
                    self.at += 1;
                    continue;
                }
                break;
            }
        }
        self.expect(TokenKind::RParen, "a closing parenthesis")?;
        Ok(Some(args))
    }

    fn expect(&mut self, kind: TokenKind, what: &str) -> Result<(), Error> {
        if self.peek() == Some(kind) {
            self.at += 1;
            return Ok(());
        }
        Err(Error::new(self.here(), format!("expected {what}")))
    }
}

impl fmt::Display for Expr {
    /// The canonical spelling: no spaces, three digits on a function code, four on a
    /// constant, and a series in its delimiters. Re-parsing this gives an equal tree.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Expr::Number(text) => f.write_str(text),
            Expr::Func { code, args } => {
                write!(f, "@F{code:03}")?;
                if let Some(args) = args {
                    write_args(f, args)?;
                }
                Ok(())
            }
            Expr::Var { args } => {
                f.write_str("@V")?;
                match args {
                    Some(args) => write_args(f, args),
                    None => Ok(()),
                }
            }
            Expr::Const(code) => write!(f, "@C{code:04}"),
            Expr::Series(inner) => write!(f, "{SERIES_DELIM}{inner}{SERIES_DELIM}"),
            Expr::Binary { op, lhs, rhs } => {
                let op = match op {
                    BinOp::Add => '+',
                    BinOp::Sub => '-',
                    BinOp::Mul => '*',
                    BinOp::Div => '/',
                };
                write!(f, "{lhs}{op}{rhs}")
            }
            Expr::Unary { op, expr } => {
                let op = match op {
                    UnOp::Neg => '-',
                    UnOp::Pos => '+',
                };
                write!(f, "{op}{expr}")
            }
            Expr::Paren(inner) => write!(f, "({inner})"),
        }
    }
}

fn write_args(f: &mut fmt::Formatter<'_>, args: &[Expr]) -> fmt::Result {
    f.write_str("(")?;
    for (i, arg) in args.iter().enumerate() {
        if i > 0 {
            f.write_str(",")?;
        }
        write!(f, "{arg}")?;
    }
    f.write_str(")")
}
