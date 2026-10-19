# leap-rs goal report - 2026-10-19

Brief: `C:\Users\tukum\AppData\Local\Temp\claude\C--Users-tukum-Downloads-rom-hack\4ffbb787-a7a5-42bc-82d7-70568577e1a5\scratchpad\leap-goal-brief.md`.
Baseline: 74 tests, 15 binaries, all green. Nothing was committed or pushed; the tree is left as
the working changes, per the brief.

## Steps

### 1. Record size for six tables - done

`records::record_size` is now the engine's own computation, read out of `FUN_012ec9e0` (reached
from `FUN_012eb790`'s add-field accounting) and verified against the blocks: the summed field sizes
rounded up to four bytes, plus a four-byte null-bitmap word per thirty-two fields. The 4032-divisor
rule it replaces is refuted by the vendor bytes -- RegressionResults sits at 40 where it said 42,
writtenresults 12 where it said 9, balcat2-4 300 where it said 336, timeslices 768 where it said
1008, and none of those divides 4032.

The engine's rule is not universal either. Twenty-eight tables were written from a wider dictionary
than the file now carries, so the rule stops short of their records; their stride is measured off
the block and listed in `records::MEASURED_STRIDE` with the evidence for each. The measurements used
three independent kinds of proof: the pitch between consecutive records' wide strings (timeslices
0x300, tags/summaryreports 0x600, fuels 0x500, taggroups 0x540, scenariotemplate 0x1f0, balcat
0x130, datanames 576, landtypes/tedtechdata 336, units 224, variablecategories 576), the free-list
number in the free slots (areadata 800, variabledata 3072), and blocks that are written exactly full
with the count the header states (constants, maccreport, RegressionResults).

`MAP_SHORT` is gone: the sweep now asserts that the slot map accounts for the stated count in every
data block of every placed table, and the two overrides the new rule explains (writtenresults 12,
staticdata 20, scenarios 312) are no longer carried as measurements.

### 2. 8 KiB pages - done

`records::page_size` reads the usable size at 0x14 (+4) and the reader works in that page
throughout: `geometry_in`, `data_blocks_in`, `records`/`live_records` (they measure the block they
are given), and the tool's `page_size`/`geometry`/`data_blocks`. Five tables state 0x1ffc:
PluginProperties, Plugins, emissionmappings, refs and uservardata. All five now have layouts
(4768, 5604, 2592, 3584, 6144), so all 86 tables in the area place; refs and uservardata have data
blocks, and the sweep proves their live rows match their headers block by block.

### 3. The seventh blob block - done

The memo record occupies `round_up_to_four(allocation + 2)` bytes, not `+3`. The fifth blob block's
first memo has an allocation one byte past what its text needs, and at the wider stride the next
record landed on the zeros inside a real header (allocation 25, kind 5), so the walk stopped one
memo into a block stating 152. At the narrower stride all seven blocks of `scenariodata.nx1` read to
their stated counts: 190, 199, 149, 170, 152, 114 and 41. The test asserts 152 and names the record
at 0x58; the stop-rather-than-hunt property is kept by a truncated-block test.

### 4. Small heap/records fixes - done

- Kind byte: the code's rule (the text starts at the byte after the kind byte, or one byte later
  when that byte is zero) is what the bytes support. The doc attributed the choice to the kind byte
  itself and to leading spaces; both were wrong. Two records in the file -- the first of blocks 5
  and 7 -- carry a zero there, and reading one byte later is what makes their texts come out as
  " divided @C1000 total population" and "9, 4, ...".
- `heap::text` and `records::wide_string` decode with `char::decode_utf16`, so a surrogate pair
  comes back as one character. `wide_string` also no longer underflows on a slot narrower than two
  bytes.
- `records::decode` returns `Unset` for a field narrower than its type (Int16 in one byte, a double
  in four, a blob in none) instead of indexing a short slot.
- `heap::memo` walks record headers only and decodes just the memo asked for; a position past the
  count the block states has no memo.

### 5. Expression evaluator - done as a clean, tested subset

`src/eval.rs` values the numbers the file spells, `+ - * /` and unary `+ -` with the parser's
precedence, and `@F010` -- the registry's `%`/`_pc`, whose decompiled body `FUN_01bcf430`
(chunk-00197.c) is `param_1 / 100.0`. That is the one function in the area's stored expressions
whose decompiled source is complete enough to port without a resolver.

The tests use the seven memo texts the first blob block actually holds (0.2, 5, 1000, 5, 0, 1,
2040) rather than fixtures, and assert `None` for everything the port cannot value: Growth, Interp,
Step, GrowthAs, AnnualizedCost, `@V`, `@C` and series literals. The other codes evaluate through
functions that read the area's variables, years and series (FUN_01be8250 for the growth family,
FUN_01bbc620 for the annualized cost), which this port has no resolver for.

## Tests

82 tests across 13 suites, all passing, no warnings:

```
calendar_parity 4, container_parity 4, deflate_parity 3, eval 4, functions 9, model 10,
nx1_area_sweep 2, nx1_expr 9, nx1_records 4, nx1_records_typed 24, nx1_schema 3,
run_parity 3, vendor_e2e 3 -- 82 passed, 0 failed.
```

The sweep now covers 2191 data blocks (refs and uservardata joined; uservardata adds one block),
with the slot map accounting for every one of them.

## Files changed

- `leap-rs/src/records.rs` - engine record size, `MEASURED_STRIDE`, `stride`, `page_size`,
  `data_blocks_in`, `geometry_in`, page-aware record counts, decode guards, UTF-16 decoding, the
  free-list number fix in `slot_is_unwritten`.
- `leap-rs/src/heap.rs` - `allocation + 2` framing, the kind-byte doc, header-only `memo`, UTF-16
  decoding.
- `leap-rs/src/eval.rs` (new) - the evaluated subset.
- `leap-rs/src/lib.rs` - `pub mod eval`.
- `leap-rs/src/oracle_records.rs` - regenerated by the tool (all 86 tables, new strides and pages).
- `leap-rs/tools/capture_nx1_records.py` - engine `record_size`, page-aware geometry and block
  discovery, the 28 measured strides with their evidence, and a blob-block walk at the corrected
  stride that now fails loudly if any block of the scenario table comes up short (the fixture is
  picked as the block whose first memo is the longest instead of the one the old stride broke).
- `leap-rs/tests/nx1_area_sweep.rs` - every table placed, page-aware, no table short.
- `leap-rs/tests/nx1_records_typed.rs` - the stride rule and its measurements, page-agnostic
  geometry, the 8 KiB layouts, the free-list numbers, decode guards, surrogate pairs.
- `leap-rs/tests/model.rs` - the full 152-memo walk, the truncated-block test, the memo-position and
  surrogate-pair tests.
- `leap-rs/tests/eval.rs` (new) - the evaluator subset.
- `leap-rs/README.md`, `leap-rs/PORTING.md` (with a dated second-pass correction), `activeContext.md`.

## Findings that corrected earlier claims

- The 4032-divisor record size was wrong for far more than the six tables the brief named, and the
  engine formula that replaces it is wrong for twenty-eight others; the record size is a rule plus
  measured overrides, not one rule.
- `slot_is_unwritten` carried both a wrong number and a wrong sentence: free slots hold their slot
  number *plus two* (years slot 31 holds 33, slot 100 holds 102, the last slot zero; areadata's
  slots 1-3 hold 3, 4, 5). The corrected signature agrees with the header count in 2099 of 2191
  blocks versus 2062 before, and one test that described the old under-filtering was corrected.
- `refs` was in the brief's step 1 list, but it is an 8 KiB-page table; its 3584-byte stride belongs
  to step 2's page work, and only there does its slot map account for its stated count.
- The memo stride's `+3` note was wrong, and the reason it survived is exact: the two formulas
  differ only for allocations congruent to 2 mod 4, and the shipped file has exactly one such record
  before the break.
- The earlier claim that six tables `resist` and that three big-page tables cannot be read is
  superseded: all 86 tables place.
- `char::from_u32(unit)` was not UTF-16 decoding; the area's strings are ASCII so nothing had caught
  it.

## What remains

- The resolver: variables, years and series, so that Growth, Interp, Step, GrowthAs and
  AnnualizedCost can be evaluated. Their decompiled bodies are known (`FUN_01be8250`,
  `FUN_01bbc620`, ...) but read the model through data this port cannot yet address.
- The series literal's internal grammar, which `expr` keeps verbatim.
- The blob fields beyond the scenario memos.
- The remaining 168,8xx functions of `leap.exe`, and the licence-gated COM automation route
  described in PORTING.
- Nothing was committed: the working tree carries the changes.
