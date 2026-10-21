# X/Y browser battle

Standalone implementation in `xy-battle/`. Do not read or reuse ORAS or Sun/Moon source or assets. Existing untracked `critique/` and `sunmoon/` are user work and remain untouched.

## Plan
- [ ] Obtain actual Pokémon X/Y battle imagery and document the comparison reference.
- [ ] Write failing tests for an isolated turn-based battle engine, confirm red, then implement until green.
- [ ] Build the X/Y-styled scene, move selection, attack effects, HP animation, fainting and replay.
- [ ] Maintain a browser-readable progress page.
- [ ] Run browser playthroughs, responsive checks and independent criticism of the actual output.
- [ ] Address identified gaps and record verified results and honest limits.

## Review/results
Work started. The visual bar is actual X/Y footage, not prior projects. No claim of beating that bar without independent evidence.

## 2026-10-19 — leap-rs review follow-up (steps 1–3)

Review findings: docs out of sync with the tests (59 vs 67 tests, 130/127 vs 132 archives, 80 vs 82
tables), two sentences cut off, the "trio" placement rule and the dictionary page seam present in the
Python capture tool but not in `src/records.rs` (switched on by table name), and `live_records` ignoring
the live count the block header states. Smaller items deferred: heap kind-byte comment vs code, `decode_utf16`,
`decode` size guards, memo-walk caching.

### Plan
- [x] 1. Docs: correct counts in README/PORTING/records.rs, drop the duplicate README bullet, finish the
      cut-off sentences, update PORTING "Out of scope".
- [x] 2. tedtechdata: failing test first, then port the dictionary page-seam stream (detected, not by
      name) and the trio placement rule into `records.rs` and the tool; regen oracle; target 83 tables.
- [x] 3. Live slots: test first, then read the header used-slot bitmap at 0x20 (count at 0x1e) and use it
      in `live_records`, checked against the six confirmed counts; expect the 5 freed structure rows gone.

### Review/results
Done 2026-10-19. 74 tests pass across 12 suites (was 67/11), no warnings, GNU toolchain + rust-lld.

- Step 2: the Rust reader had only run on 4 fixture dictionaries; the new `tests/nx1_area_sweep.rs`
  runs it on all 86 tables. Root cause of the tedtechdata/areadata/fuels trouble: a dictionary page is a
  32-byte lead + stream + 4-byte trailer, and the old helper stripped only 24 bytes. The leftover 12 bytes
  explained the "trio", the areadata fallback, fuels' "slack" (actually the lost field ImageIndex) and the
  "class name in stream data". All three workarounds are removed and replaced by one seam rule in the tool
  and `records::dictionary_stream`. Result: 83 layouts, fuels has 45 fields, every dictionary tiles with no gap.
- Step 3: `records::geometry` (0x20 header + slot bitmap + records tiling back from 4092) reproduces every
  base measured by hand and corrects years to 0x54/334. `records::slot_map` is exact in all 2190 blocks
  except 6 tables with a wrong derived record size. `live_records` reads through the map. The structure
  table now reads 434 branches, all named; regions has 1 row; a deleted units record is excluded.
  writtenresults' stride was measured at 12, the engine formula's value.
- Step 1: README, PORTING (with a dated correction section), and the module docs in records.rs, model.rs
  and the tool now match the code.
- Not committed (the auto-backup job will pick it up unless committed first).
- Next: 8 KiB-page geometry (PluginProperties, Plugins, uservardata); replace the 4032-divisor record-size
  rule (wrong for RegressionResults, balcat2-4, refs, timeslices, writtenresults), with the slot map's
  stated-count check as the test; then the seventh blob block and the evaluator.

## 2026-10-19 - leap-rs goal follow-up (record size, 8 KiB pages, blob block, heap fixes)

Brief: `%TEMP%\claude\...\scratchpad\leap-goal-brief.md`. Baseline was 74 tests, all green.

### Plan
- [x] 1. Record size: replace the 4032-divisor rule with the engine's own (FUN_012ec9e0) and carry the
      strides the blocks refute as measurements. Done when MAP_SHORT is empty.
- [x] 2. 8 KiB pages: generalise the block size, `geometry`, data-block discovery and the tool to the page
      the file states. Done when the big-page tables place and their live rows match the header counts.
- [x] 3. The seventh blob block: the framing the oversized first memo breaks, so every blob block of
      `scenariodata.nx1` reads to its stated count.
- [x] 4. Small heap/records fixes: kind byte at +2 vs +3, `decode_utf16`, decode size guards, memo caching.
- [x] 5. Only if 1-4 land: a tested subset of the expression evaluator.
- [x] Reporting: `leap-rs/docs/goal-report-2026-10-19.md`, then one `herdr agent prompt` to w2Z:p1.

### Review/results

- Step 1 done. `records::record_size` is now the engine's rule (summed field sizes rounded to four, plus a
  null-bitmap word per 32 fields) and `records::MEASURED_STRIDE` carries the 28 tables whose records were
  written from a wider dictionary than the file now holds. The 4032-divisor rule was refuted by the bytes:
  RegressionResults 40 (not 42), writtenresults 12 (not 9), balcat2-4 300, timeslices 768, maccreport 76,
  datanames 576, fuels 1280 and others are neither divisor nor rule. Each override is pinned by its block:
  the pitch of consecutive records' wide strings (timeslices' names 0x300 apart, tags' and summaryreports'
  0x600, fuels' 0x500, taggroups' 0x540), the free-list number in the free slots (areadata's 3, 4, 5 at
  800 apart; variabledata's two `0` expressions 3072 apart), or the count the header states.
- The free-list number turned out to be `slot index + 2`, not the slot index, which `slot_is_unwritten`
  had wrong in both the reader and the tool. Corrected against the years block (slot 31 holds 33, slot 100
  holds 102, the last slot 0) and areadata/regions; the corrected signature agrees with the header count in
  2099 of 2191 blocks where the old one managed 2062, and the units block freed from the middle stays the
  case it cannot see.
- Step 2 done. `records::page_size` reads the usable size at 0x14 (+4): five tables state 0x1ffc for
  8192-byte pages -- PluginProperties, Plugins, emissionmappings, refs and uservardata -- and the rest
  0x0ffc. `geometry_in`, `data_blocks_in` and the tool's `page_size`/`geometry`/`data_blocks` take that
  page, and the three big-page dictionaries that had no layout now place (PluginProperties 4768, Plugins
  5604, emissionmappings 2592, all one slot per 8 KiB page). refs reads at 3584 and uservardata at 6144,
  both measured from their own fields' positions; registered, so the sweep now covers 2191 data blocks
  with no table short: `MAP_SHORT` is gone and the sweep asserts the slot map accounts for every one.
- Tests were 74 across 15 binaries at that point, no warnings. Not committed; the auto-backup job
  will pick the tree up.
- Step 3 done. The memo record is `round_up_to_four(allocation + 2)`, not `+3`. The fifth blob block's
  first memo has an allocation one byte past what its text needs, so the wider stride put its second
  record on the zeros in the middle of a real header (allocation 25, kind 5) and the walk stopped one
  memo in; at the narrower stride all seven blocks of `scenariodata.nx1` read to their stated counts
  (190, 199, 149, 170, 152, 114, 41). The test now asserts 152 and names the record at 0x58; the
  stop-rather-than-hunt behaviour is kept as a truncated-block test.
- Step 4 done. `heap::record` keys the text start off the byte *after* the kind byte, which is what the
  bytes say (two records -- the first of blocks 5 and 7 -- carry a zero there and read one byte later,
  turning 0x2000 into a space and 0x3900 into '9'); the doc had said "that byte" of the kind byte.
  `heap::text` and `records::wide_string` decode with `char::decode_utf16`, so a surrogate pair comes
  back whole; `records::decode` returns `Unset` for a field narrower than its type instead of indexing
  a short slot; and `heap::memo` walks the record headers only, decoding just the memo asked for, and
  has no memo past the count the block states.
- Step 5 done as a clean subset. `src/eval.rs` values the numbers the area spells, `+ - * /` with the
  parser's precedence, and `@F010` -- the registry's `%`/`_pc`, whose decompiled body FUN_01bcf430 is
  `param_1 / 100.0`. The tests use the seven memo texts the first blob block really holds (0.2, 5,
  1000, 5, 0, 1, 2040) and assert `None` for Growth, Interp, Step, GrowthAs, AnnualizedCost, `@V`,
  `@C` and series literals: those evaluators read the area's model through functions this port cannot
  resolve yet.
- Final state: 82 tests across 13 suites, no warnings; README and PORTING carry the counts and a dated
  second-pass correction. Report at `leap-rs/docs/goal-report-2026-10-19.md`.

## 2026-10-19 - leap-rs resolver round (agent leapeval)

Brief: `leap-rs/docs/goal-briefs/resolver.md` plus `common-rules.md`. Owns `src/eval.rs`,
`tests/eval.rs`, `src/expr.rs`, `tests/nx1_expr.rs`, `src/functions.rs`, `tests/functions.rs`,
plus new `src/resolve.rs` / `tests/resolve.rs`. Baseline: 82 tests green (GNU + rust-lld,
`target-leapeval`).

### Plan
- [x] 1. Series literal grammar: typed `parse_series` in `expr.rs`, tested against all 35 area
      literals (the 44-expr corpus missed 19 unterminated ones); malformed refused.
- [x] 2. Resolver (`src/resolve.rs`): years 2020-2050 from years table, 1,009 scenario
      expressions, 17 constants, discount 0.05, `@V`/`@C` addressing with inheritance.
- [x] 3. Growth family + annualized cost in `eval.rs`: pure `growth_value`/`interp_value`/
      `step_value`/`annualized_value`/`growth_as_value` plus `Context`/`at`/`eval_var`;
      10 new golden tests (14/14 in eval suite), full tree green.
- [x] 4. README.md + PORTING.md updates, report at
      `leap-rs/docs/goal-report-2026-10-19-leapeval.md`, scratch + `target-leapeval`
      deleted. Final: 112 tests over 15 suites green, no warnings.

## 2026-10-19 - leap-rs stride round (agent leapstride)

Brief: `leap-rs/docs/goal-briefs/stride.md` plus `common-rules.md`. Owns `src/records.rs`,
`tools/capture_nx1_records.py`, `tests/nx1_records_typed.rs`, `tests/nx1_area_sweep.rs`,
`tests/nx1_records.rs`, `tests/nx1_schema.rs`. Baseline: suite green (`target-leapstride`).

### Plan
- [x] 1. Stride rule: tried the brief's lines (declared vs placed sizes, string alloc, blob
      size, index/dictionary sections, page-fraction and power-of-two rounding, the create-table
      record-size code at `FUN_012ec9e0`/`FUN_012eb790`). No rule derives all 28 strides;
      measurements stand for all 28. Evidence: one engine rule (both branches current-field
      derived, `+0x58` a cached recompute), no stored stride anywhere, `OriginalFieldCount` ==
      placed count, zeroed padding past the rule in every slot of every block.
- [x] 2. Fixed the merged doc comment on `index_of` plus an `records.rs` stale-text pass (83 ->
      all 86 place; wider-dictionary story removed; `stride` doc reworded).
- [x] 3. README.md + PORTING.md (dated stride follow-up note) updated; two new area-sweep tests
      pin the refutation (`OriginalFieldCount`, zeroed padding); full suite green.
- [ ] 4. Write `leap-rs/docs/goal-report-2026-10-19-leapstride.md`, delete `target-leapstride`,
 - [x] 4. Wrote `leap-rs/docs/goal-report-2026-10-19-leapstride.md`, deleted `target-leapstride`,
      herdr notify to w2Z:p1 exactly once. Final: 91 tests green, cargo exit 0.

## 2026-10-19 - leap-rs blobs round (agent leapblob)

Brief: `leap-rs/docs/goal-briefs/blobs.md` plus `common-rules.md`. Owns `src/heap.rs`,
`src/model.rs`, `tests/model.rs`, plus new `src/blobs.rs` / `tests/blobs.rs`. Baseline: 90
tests green (GNU + rust-lld, `target-leapblob`).

### Plan
- [x] 1. Survey: every blob field and every heap block in the area, with what each holds.
- [x] 2. Area-wide sweep: every heap block reads to its stated count; confirm which fail.
- [x] 3. Join records to blobs, with independently checkable content; identify non-text blobs.
- [x] 4. README.md + PORTING.md updates, report, delete `target-leapblob`, herdr notify.

### Review/results

- Survey: 29 tables carry blob fields (8 with no data blocks, 8 more with all-zero refs); 13
  files carry the heap, 550 blocks, 5,505 memos. In-record value is low word = memo position,
  high word = heap page; all 4,547 non-zero refs resolve. Kind census: 3: 2,607 text, 4: 2,446
  text, 5: 449 binary triples, 0: 3 empty.
- Sweep: the `allocation + 2` framing holds for all 550 blocks with zero shortfalls, so no
  fix was needed. Pinned by `tests/blobs.rs` (550 blocks, 5,505 memos).
- Join: `src/blobs.rs` resolves any blob value (`heap::record_bytes` added for raw records,
  content-sniffed narrow/wide text in `Memo::text`). Proofs: scenario expressions parse,
  177 info-page paths, branch RTF/HTML notes, parallel effect tables byte-identical. Kind-5
  memos are `u32` triples + NUL, not decoded further; two scenario expressions point at them.
- Full suite green at finish: 109 tests over 16 suites, no warnings in owned targets
  (only `tests/recon_tmp.rs`, another agent's scratch, warns).

## 2026-10-19 - leap-rs stride round 3 (agent `leapstride`)

Brief: `leap-rs/docs/goal-briefs/round3/stride.md` plus `common-rules.md`. Owns `src/records.rs`,
`tools/capture_nx1_records.py`, `tests/nx1_records_typed.rs`, `tests/nx1_area_sweep.rs`,
`tests/nx1_records.rs`, `tests/nx1_schema.rs`. Baseline: 112 tests over 15 suites (`target-leapstride`).

### Plan
- [x] 1. Traced the stride source through the storage engine and the vendor bytes. No source found:
      measurements stand for all 28 tables (item 3 fallback). Engine: `FUN_012ec9e0` one rule,
      its cache write `FUN_012ec2e0` has no direct caller, `+0x40` flag selects cached structures
      (`FUN_012ed8a0`); file: no stored stride (u16/u32 sweep, property census, identical file
      headers). Creation-time-width hypothesis neither confirmed nor ruled out.
- [x] 2. Settled the 0x1c header word: free-list head, one-based, zero when full; every free slot's
      first u16 links the next. New `records::free_list_head` plus area-sweep chain test over all
      2191 blocks (2105 zero heads, 86 chains land exactly on their free sets). Red first (missing
      function), green after.
- [x] 3. README.md + PORTING.md notes (plus repaired a garbled stride sentence in README), report at
      `leap-rs/docs/goal-report-2026-10-19-r3-leapstride.md`, delete `target-leapstride`, herdr notify.
### Review/results
- Owned 4 suites green (36 tests, no warnings); whole-tree `cargo test` green at re-verification
  (126 tests, 19 suites) after the parallel agents landed their fixes -- no change to my files.
## 2026-10-19 - leap-rs evaluator round 3 (agent `leapeval`)

Brief: `leap-rs/docs/goal-briefs/round3/eval.md` plus `common-rules.md`. Owns `src/eval.rs`,
`src/resolve.rs`, `src/expr.rs`, `src/functions.rs` and their tests, plus new files.
Baseline: 112 tests green (`target-leapeval`, `--tests`; another agent's `examples/blobdump.rs`
does not compile, so the full `cargo test` is red on a file I do not own).

### Plan
- [x] 1. One entry point: `eval::text_in_context` (text + branch/variable/region/scenario/year).
- [x] 2. Base-year override for Interp/Step ported (`FUN_01c203c0` flag-0 path, `FUN_01bfc500`
      sorted insert); goldens incl. the base year; two stale goldens corrected.
- [x] 3. Remaining codes ranked (184x26, 176x21, 185x21, 9x18, 69x3, 164x2, 29x2, 30x1); 29/30/69
      ported (Million/Billion pure, BaselineValue via `FUN_01bd1c70`); share 861/1009 at 2027.
- [x] 4. Discount rate corroborated (setting 0x895 -> global 0x698, wrapper /100, COM setter only
      other writer, no scenario column, sysinfo Base Year 2020); no code change.
- [x] 5. README.md + PORTING.md notes; full suite green; report; delete survey + `target-leapeval`.
- [ ] 6. herdr notify to w2Z:p1 exactly once, after the report lands.
- [x] 5. README.md + PORTING.md notes; full suite green (119/15, no warnings); report landed;
      survey deleted; `target-leapeval` delete blocked by sandbox policy (noted in report).
- [x] 6. herdr notify to w2Z:p1 exactly once, after the report lands.

## 2026-10-19 - leap-rs blobs round 3 (agent leapblob)

Brief: `leap-rs/docs/goal-briefs/round3/blobs.md` plus `common-rules.md`. Owns `src/heap.rs`,
`src/model.rs`, `src/blobs.rs`, `tests/model.rs`, `tests/blobs.rs`, plus new files.
Baseline: 128 tests green (GNU + rust-lld, `target-leapblob`).

### Plan
- [x] 1. Encoding rule: kind 3 counted (trailing word, odd narrow / even wide), kind 4
      width off the field type, kind 5 binary, kind 0 empty; guess dropped, proved on
      all 5,505 (rule == guess except 51 + 66 + 26 evidenced overrides).
- [x] 2. Kind-5 directories: shape + 4059-chunk offsets + op-1/op-2 shadows (188/192) +
      the two Current Accounts rows beside Baseline `@F041/`@F037` texts; ruled-outs
      recorded, decompiled search negative (no NXHD reader in leap.exe).
- [x] 3. Blocks 157/161: dead max-size narrow memos, hex map dump with wide labels plus
      hex/RTF soil citation; format named, no renderer.
- [x] 4. README.md + PORTING.md notes; full suite green; report; delete scratch +
      `target-leapblob`; herdr notify to w2Z:p1 exactly once, after the report lands.

### Review/results
- Encoding: `Memo::text(width)`; `expression_text` reads width off the `Expression` field.
- Tombstones: 222 zero-first-byte memos, zero live refs (plus 3 live empty kind-0).
- Churn note: stride-agent `records.rs` rework mid-round misdecoded masterstructure rows
  (BranchID -8/-1); branch-notes test now pins memos by position, join sweep still green.
- Full suite green at finish: 128 tests over 15 suites, no warnings.
## 2026-10-21 - leap-rs: calculation engine to result parity on the public sample areas

Goal (/goal): complete the LEAP Rust rewrite and test it against public case studies until it matches.
Oracle: each sample area SEI ships (`C:/Program Files/LEAP/{Freedonia,Asiana,Transport Exercise,
Optimization Exercise}.zip`) carries `_RegressionTests/Definitive/RegressionResults.nx1`, LEAP's own
results at full double precision keyed (BranchID, VariableID, ScenarioID, RegionID, YearID, ExtraID1,
ExtraID2): Freedonia 57,380 values (45 result vars, scen 2/11), Asiana 578,480 (36 vars), Transport
13,552 (16 vars, stock turnover), Optimization 83,457 (40 vars, NEMO LP). Result variable names and
extra dimensions come from `_dictionaryNX.zip` `ResultDimensions`; input variable names from `Variables`.
Match criterion: |got - want| <= 1e-6 * max(|want|, scale of that variable) (LEAP's own float noise
sits at 1e-10 of the variable's scale).

### Plan
- [x] 0. Stride inference so other areas and the dictionary read (`records::infer_stride`/`stride_of`,
      red/green in `tests/stride_inference.rs`); ShortString/AutoInc/Date decoders.
- [ ] 1. `table` + `area` modules: any table of an area dir or zip as typed rows; dictionary tables.
- [ ] 2. Results oracle reader + comparison harness (per area, per variable match counts).
- [ ] 3. Expression evaluator over the area data model (every code the four areas use).
- [ ] 4. Demand: Activity Level (2027), Final Energy Demand (30), Useful Energy (31).
- [ ] 5. Stock turnover (Transport Exercise: 60-68, 81, 85).
- [ ] 6. Transformation modules, dispatch, capacity (1-13, 16, 22, 42, 43, 46, 65, 77, 82, 89, 126, 127).
- [ ] 7. Supply balances (14, 17, 18, 19, 36, 73, 84, 125, 138).
- [ ] 8. Emissions and GWP (20, 21, 40, 41, 104, 105) and allocation to demands (35).
- [ ] 9. Costs (5, 86, 87, 88, 103).
- [ ] 10. Asiana specifics (InterpFSY, Call, indicators), Optimization Exercise (least-cost LP).
- [ ] 11. E2E tests per case study, docs (README/PORTING), report.

### Progress (2026-10-21, session paused at usage limit)
- [x] 1. `table`, `area`, `data` modules; kind-5 long-memo assembly (`blobs::assemble`/`resolve_text`).
- [x] 2. `results` oracle reader + `examples/compare.rs`; `tests/case_studies.rs` (E2E, red/green).
- [x] 3. `calc::inputs` evaluator (scenario chains, Growth/Interp/Step/Remainder/%/GrowthAs/
      BaselineValue/AnnualizedCost, @C1000.. built-ins from the decompiled registration).
- [x] 4. Demand: Freedonia Final Energy Demand 360/360, Useful Energy 30/30 (FEI, category
      intensity with fuel shares, useful-energy method, physical-unit fuels).
- [~] 5. Stock turnover: Transport Exercise 13,510/13,552 (99.69%); only base-year Device
      Retirements (var 85, 42 values = 0.133799 x base stock) unexplained -- search decompilation.
- Open: scenario multi-inheritance order is an assumption (later entry wins); Freedonia vars
  beyond 30/31 (transformation, supply, emissions, costs), Optimization (LP), Asiana not started.
- Not committed yet (CLAUDE.md wants /verify before commit). Background research agent was
  writing `leap-rs/research/2026-10-21_leap-methodology.md`.

### Progress (2026-10-21, resumed)
- Freedonia 57,370/57,380 (99.98%): transformation (simple/standard modules, historical
  dispatch, merit-order load-curve dispatch, endogenous capacity), resources, emissions incl.
  non-energy, allocation to demands (35/104/105), costs (5/86/88/103) all match. Open: 10 values of
  gasoline-in-litres SO2 (LEAP = ours/1.1).
- Transport 13,510/13,552: open base-year Device Retirements (42).
- Optimization Exercise 89.3%, Asiana 96.8% before area-specific work.
- /verify (independent subagent) -> verified, checks in `.verify/leap-rs-calc.json`.
