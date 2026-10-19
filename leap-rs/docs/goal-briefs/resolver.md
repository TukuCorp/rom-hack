# Brief: the resolver and the evaluator (agent name: `leapeval`)

Read `common-rules.md` in this folder first and follow it.

**You own:**
- `src/eval.rs`
- `tests/eval.rs`
- `src/expr.rs` and `tests/nx1_expr.rs`
- `src/functions.rs` and `tests/functions.rs`
- any new files you create, such as `src/resolve.rs` and `tests/resolve.rs`

Read `records.rs`, `heap.rs` and `model.rs` through their public API only. Another agent owns
`heap.rs`/`model.rs`, and a third owns `records.rs`.

## Items, in order

1. **The series literal grammar.**
   - `expr` keeps series literals verbatim. Work out their internal grammar from the stored
     expressions in the area and from the decompiled parser (`../leap-decompiled/`).
   - Parse them into a typed form, and test against every series literal the area holds.
   - Done when every one parses, and a malformed one is refused, not guessed.
2. **A resolver.**
   - It addresses what the remaining functions read: the years (base and end year, from the
     years table), the variables and their values per branch and scenario (`@V`, `@C`
     references), and series.
   - Build it on the decoded tables (`records`, `model`, `heap::memos`). Find which tables and
     fields carry each piece, and prove it with values knowable from the area's own data, such
     as the base year in the area settings.
3. **Evaluate the growth family and the annualized cost.**
   - Covers Growth, Interp, Step, GrowthAs and AnnualizedCost.
   - Port the semantics from the decompiled evaluator: `FUN_01be8250` for the growth family and
     `FUN_01bbc620` for the annualized cost, starting from the registry addresses
     `functions.rs` gives.
   - Tests are golden: real stored expressions from the area, evaluated at given years. The
     expected values must come from something independent of your port: the semantics written
     out in the decompiled code and checked by hand arithmetic, LEAP's own documentation, or
     results the area stores.
   - Stop at a clean, tested subset. Any function you can't settle keeps returning `None`.
4. Update `README.md` and `PORTING.md` for your changes, following the shared-file rules.
