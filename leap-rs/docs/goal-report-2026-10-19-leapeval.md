# leap-rs resolver round: report (agent leapeval, 2026-10-19)

Brief: resolver.md plus common-rules.md. Items 1-2 finished in an earlier session of
this round; item 3 plus docs in this session.

## Item outcomes

1. Series literal grammar: done. Verbatim Expr::Series plus typed parse_series,
tested against all 35 distinct literals the file holds; malformed refused.
tests/nx1_expr.rs 12/12 green.
2. Resolver: done. Years 2020-2050, 1009 scenario expressions, 17 constants,
discount 0.05, parse_var with -99 current, inheritance. tests/resolve.rs 5/5 green.
3. Growth family plus annualized cost: done. Growth (_gr, 0x1be7c10), Interp (_in,
0x1c06d80), Step (_sp, 0x1c014f0), GrowthAs (_gras, 0x1bbe700; _grasel, 0x1bbcac0)
and AnnualizedCost (_annualizedcostsimple, 0x1bbca50) through FUN_01be8250 and
FUN_01bbc620. Pure growth_value (iterative V(base)=base, V(y)=V(y-1)*(1+r)),
interp_value (lerp, flat ends), step_value (right-continuous), annualized_value
(CRF) and growth_as_value, plus contextual Context/at/eval_var with a depth guard
of 32 decremented at row crossings; eval::text still returns None for the family.
Ten new golden tests: pure hand-arithmetic goldens plus stored-expression goldens
((2,2027) 3% from base 8 = 9.8389909234 at 2027; (32,2027) inherited 3.5% from
base 3 = 3.8168377898; (48,2027)/(244,804) Interp incl. 2040 = 39.0;
(65,2145)/(582,2027)/(842,2145) Step; (40,776) = 5.25 and (677,776)/(676,776)
annualized at 5%; (579,2027) GrowthAs following (294,2027): 40/41/42.025; None
for (595,2027) junk-base GrowthAs and the two region-0/scenario--1 rows).
tests/eval.rs 14/14 green. Red confirmed first (32 compile errors for the missing
API), then green. One test-only fix on the way: two assertions used == on
CRF(5%,1) results and caught the last float bit (5.249999999999996 vs 5.25);
loosened to 1e-12 closeness with comments.
4. README plus PORTING dated updates done (eval/resolve bullets, count, stale
no-resolver paragraphs fixed); scratch deleted (tests/recon_tmp.rs, recon_q.py,
recon_corpus.rs, nine recon_out files, target-leapeval-baseline.log); target dir
deleted after the final run.

## Test summary

Final full run: 112 tests over 15 suites, all passing, no warnings
(cargo +stable-x86_64-pc-windows-gnu test --target x86_64-pc-windows-gnu with
rust-lld). Includes eval 14 (4 pre-existing + 10 new), resolve 5, nx1_expr 12.

## Files changed

leap-rs/src/eval.rs (family + cost + Context/at/eval_var + PORTED codes 1/7/8/37/
41/43), leap-rs/tests/eval.rs (10 goldens, ported assertion updated),
leap-rs/src/resolve.rs (parse_var_args added for @F037/@F041; parse_var on top),
leap-rs/README.md, leap-rs/PORTING.md, root activeContext.md (own checkboxes).
expr.rs / nx1_expr.rs / resolve tests / lib.rs carried over from the earlier
session, unchanged. No unowned files touched.

## Findings correcting earlier claims

The 44-expression corpus misses 19 live series literals: the capture tool only
sees NUL-terminated memos while heap framing reads unterminated ones too (all 35
distinct literals parse). The areadata DiscountRate row is otherwise a template
default (BaseYear 2000/EndYear 2030, LastVariableID 27), so the 5% rate is stated,
not corroborated. CRF(5%,1) is one ulp below 1.05 in floating point, so life-1
goldens need closeness.

## Requests for files I do not own

None. The @F037/@F041 reference shape went into the owned resolve.rs instead.

## What remains

Interp/Step read series points only, no base-year override (goldens avoid base
year); Growth bases come from scenario inheritance, not a stored model value;
unsettled codes (@F176/@F185 and the rest) keep returning None; result-level
parity against LEAP stays gated on licensing.
