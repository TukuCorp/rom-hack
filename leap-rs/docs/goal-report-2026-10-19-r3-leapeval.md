# leap-rs evaluator round 3: report (agent leapeval, 2026-10-19)

Brief: `leap-rs/docs/goal-briefs/round3/eval.md` plus `common-rules.md` in the same folder.
Owns `src/eval.rs`, `src/resolve.rs`, `src/expr.rs`, `src/functions.rs` and their tests,
plus new files. Baseline: 112 tests green via `--tests` (the full `cargo test` is red on
another agent's `examples/blobdump.rs`, which does not compile; left alone per the rules).
Nothing was committed or pushed.

## Item outcomes

1. **One entry point: done.** `eval::text_in_context` takes a resolver, an expression's text,
   branch, variable, region, scenario and year, and returns a value or `None`. It parses the
   text and reads it through `at` with the context for that row. The context-free `text` path
   is unchanged for what needs no area. Every stored-expression test now goes through it:
   the `stored()` helper delegates to it, and a dedicated test pins it against the assembled
   pieces on a Growth row, an Interp row at the base year, a variable reference, the sulfur
   ratio, unparseable text and a missing-row reference.
2. **Base-year override for Interp and Step: done, settled for the Current Accounts value.**
   Both entries reach `FUN_01c203c0` through `FUN_01c25af0` with a zero trailing flag (Step
   mode 0 at 0x1c014f0, Interp mode 1 at 0x1c06d80), and on that `param_9 == 0` path the worker
   inserts the Current Accounts value at the base year with the sorted insert `FUN_01bfc500`
   whenever the first series year is past the base year at global 0x7bc (base/end/first-scenario
   confirmed where the constants table registers them by name). The port heads the points with
   the base value when the series starts after the base and a Current Accounts value exists;
   otherwise the series rules on its own -- including in Current Accounts itself, where
   `base_value` reads nothing, matching the engine's guard. Goldens include the base year:
   (48,2027) headed by 25 reads 25 at 2020 and 27.1 at 2027, single-point (244,804) headed by
   300 lerps to 970/3 at 2027, Step (65,2145) headed by 2500 holds it until 2030, (582,2027)
   headed by 400 reads it at 2020, (842,2145) with no Current Accounts row stays series-only,
   the 2010-2020 (829,991) history needs no heading, and mid-range lerps from Current Accounts
   are pinned ((624,2147) 0/2.5/12.5, (664,2145) 6 at 2020). Two round-2 goldens were corrected
   to override values (48 at 2027: 28 to 27.1; 244 at 2027: 400 to a two-point lerp).
3. **Remaining function codes: done.** Ranked by occurrences across all 1,009 stored expressions:
   184x26, 176x21, 185x21, 9x18, 69x3, 164x2, 29x2, 30x1. Ported: 29/30, pure scalings --
   Million is `FUN_01bcf370` (param times 10^6) and Billion is `FUN_01bcf3b0` (param times 10^9),
   both through the integer power `FUN_0053a590`, exact in floating point, evaluated with hand
   arithmetic and the stored (583,2040)/(838,1538) rows -- and 69, BaselineValue, which walks to
   the scenario directly inheriting Current Accounts per `FUN_01bd1c70` (Current Accounts fallback
   in a baseline scenario, refusal in Current Accounts itself) and reads the own branch/variable
   there: (583,2040,s10) at 2035 is 0.02 times 0.85. Unsettled, each keeping `None` with its
   reason: 184 fractionoxidized / 176 sulfurcontent / 185 sulfurretention are fuel properties
   needing a branch-to-fuel join the port does not carry; 9 Remainder is `param_1` minus sibling
   sums (`FUN_01bdeaf0` via `FUN_01be20f0`), needing the branch hierarchy; 164 YearlyShape reads
   shape-profile tables. Share at 2027 in each row's own context: **861 of 1,009 evaluate**.
   The 148 that do not: 69 memos are not arithmetic (37 names/settings, 29 padded property refs,
   3 trailing notes), 67 hold unsettled codes (21 sulfur pairs, 26 oxidized, 18 Remainder, 2
   shape), and 12 are unresolvable -- a junk-byte GrowthAs base (595,2027; 831,991 the same
   shape), a Growth with no Current Accounts row (612,318), an unknown `@C1000` (632,1672),
   references to rows the area never states (672,474; 840/841 in s12 via the missing (842,1)),
   and out-of-area selectors (region 0, scenario -1). A share test pins 861/69/67/12.
4. **Discount rate: done, no code change.** Corroboration, not just the stated row: the area-load
   path writes stored setting 0x895 into the global at 0x698, the code-43 wrapper passes that
   global over 100 with other-cost zero (`FUN_01bbca50`, matching the port exactly, including the
   life-zero/rate-zero arms of `FUN_01bbc620`), and the only other writer is the COM
   `LEAP.DiscountRate` setter -- a runtime override, not a stored source. The scenarios table
   carries no rate column, the GAMS per-technology-region declaration is optimizer export rather
   than evaluator input, and `sysinfo.txt` independently states Base Year 2020 / End Year 2050.
   The resolver note's template-default caveat stands; the rate source is now corroborated.
5. **README.md and PORTING.md: done**, per the shared-file rules (own lines/sections only).

## Test summary

Final full run: **119 tests over 15 suites, all passing, no warnings** (`cargo
  +stable-x86_64-pc-windows-gnu test --target x86_64-pc-windows-gnu --tests --no-fail-fast`
  with `RUSTFLAGS='-C linker=rust-lld'`, `CARGO_TARGET_DIR=target-leapeval`; exit 0). The `--tests`
  qualifier skips examples: another agent's `examples/blobdump.rs` fails to compile (`dump_refs`/
  `dump_kind5` missing) and was left alone. Eval suite 20/20 (was 14): entry point, override
  heads/no-heads, mid-lerps, Million/Billion, BaselineValue incl. fallback and refusal, and the
  share test. Red/green observed throughout: 12 compile errors for the missing API before
  implementing, override goldens failing before the port (two stale expectations corrected to
  override values, plus one of my own hand-arithmetic expectations -- single-point-plus-head is
  a two-point lerp, not flat -- fixed at the first attempt). A fresh `build --tests` after
  touching `src/eval.rs` shows no warnings.

## Files changed

- `leap-rs/src/eval.rs`: entry point, base-year override, codes 29/30/69, PORTED seven to ten,
  doc updates (override replaces the no-override caveat).
- `leap-rs/tests/eval.rs`: five new tests plus the share test, two goldens corrected to override
  values, `stored()` delegates to the entry point, ported-codes assertion updated.
- `leap-rs/README.md`: eval paragraph/bullet, ten-codes paragraph with the 861/1009 share,
  count line 112 to 119.
- `leap-rs/PORTING.md`: dated evaluator-round note (supersedes the round-2 no-override caveat).
- Root `activeContext.md`: own round-3 section with checkboxes.
- Created and deleted within the round: `leap-rs/tests/r3survey.rs` (temporary area analysis).
  No unowned files touched; `src/resolve.rs`, `src/expr.rs`, `src/functions.rs` and their tests
  unchanged since round 2 (timestamps verified).

## Findings correcting earlier claims

- Round-2 `eval.rs` docs (no base-year override; goldens stay off the base year) superseded.
- Single-point series are flat only without the override; with a Current Accounts head they lerp.
- The 5% rate is corroborated as areadata-sourced (setting 0x895 to global 0x698, /100 at use),
  not merely stated; the row's template-default staleness still stands.
- Base year 2020 corroborated independently by `sysinfo.txt`, beyond the years table.

## Requests for changes in files I do not own

- `examples/blobdump.rs` breaks the full `cargo test` (missing `dump_refs`/`dump_kind5`); please fix
  or remove (presumed leapblob's; left untouched per the rules).
- `PORTING.md` Out-of-scope line that Growth etc. `still need a resolver, which is the next step
  rather than a finished one` is stale after rounds 2-3; suggest an update by whoever owns it.
- `areadata` carries `FirstInterpYear`=2030 (`Second..Fourth`=0); no evaluation link was found in
  the paths read and it is unused -- flagging in case another agent sees a link.

## What remains

- Unsettled codes (fuel-property join, sibling-branch sums, shape profiles) as above.
- Result-level parity against LEAP output: out of scope this round, not attempted.
- The `local_d5` byte in `FUN_01c203c0` is never assigned in the visible decompilation; the port
  uses the guarded rule (first series year past base), the only reading consistent with series
  that already reach the base year.
- The 12 unresolvable and 69 non-arithmetic memos are data shapes, not port gaps, except where
  an unsettled code is involved.

## Deviation: `target-leapeval` left in place

Common-rules asks for the agent target directory to be deleted at the end. The recursive
delete (`Remove-Item -Recurse -Force`) was rejected by the execution sandbox policy, and I
did not work around the block. The directory is build cache only (`leap-rs/target-*/` is
gitignored), unique to this agent, so it affects no other checkout or agent -- it just costs
disk until removed by hand.
