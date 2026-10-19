# Brief, round 3: finish the evaluator (agent name: `leapeval`)

Read `common-rules.md` in this folder first and follow it. Read your round-2 report,
`docs/goal-report-2026-10-19-leapeval.md`, too.

**You own:**
- `src/eval.rs`, `src/resolve.rs`, `src/expr.rs` and `src/functions.rs`
- their tests: `tests/eval.rs`, `tests/resolve.rs`, `tests/nx1_expr.rs` and `tests/functions.rs`
- any new files you create

## Items, in order

1. **One entry point.**
   - `eval::text` still returns `None` for the growth family and the annualized cost, which only
     run through a `Context`.
   - Give callers a single way to evaluate a stored expression in context: an expression's text
     plus branch, variable, region, scenario and year gives a value or `None`. The context-free
     path must stay correct for what it already values.
   - Test it on stored expressions from the area.
2. **The base-year override for Interp and Step.**
   - Interp and Step read series points only. Work out from the decompiled code (`FUN_01be8250`
     and the Interp/Step entries `functions.rs` gives) how LEAP treats the base year: the value
     stored in Current Accounts, or a series point in the base year.
   - Port that, with goldens that do include the base year.
3. **The remaining function codes.**
   - Rank the codes the area's stored expressions use that still evaluate to `None`, most
     frequent first. Include `@F176` and `@F185`.
   - Port each one whose decompiled body you can settle, with a golden test checked by hand
     arithmetic or values the area states.
   - An unsettled code keeps returning `None`. List each one in the report with the reason.
   - At the end, report the share of the area's stored expressions that now evaluate, and the
     reasons the rest don't.
4. **The discount rate.**
   - The 5% rate comes from an areadata row that looks like template defaults. Look for
     independent corroboration: another table, a scenario or area setting, or the decompiled
     code's default.
   - Record what you find, and change the code only if the evidence says the rate comes from
     somewhere else.
5. Update `README.md` and `PORTING.md` for your changes, following the shared-file rules.
