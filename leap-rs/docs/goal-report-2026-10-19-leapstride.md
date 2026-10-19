# leap-rs goal report 2026-10-19 -- leapstride (the stride rule)

Brief: `leap-rs/docs/goal-briefs/stride.md` plus `common-rules.md`. Agent `leapstride`.
Baseline: 82 tests across 13 suites, all passing. Nothing committed or pushed; the working
tree carries the changes, per the brief.

## Item 1: one rule for every table's stride -- stopped, measurements kept for all 28

No rule was found. `MEASURED_STRIDE` and `measured_stride` stay, with the values unchanged,
and every lookup keyed on a table name stays with them. The brief's fallback applies: the
measurements are kept for the tables no rule explains, and this section reports which tables
resist and why.

All 28 measured tables resist: areadata, balcat, balcat2-4, constants, datanames, fuels,
landtypes, refs, regioncategories, regioncategories2-4, regions, scenarioeffects,
scenariotemplate, summaryreportrows, summaryreports, taggroups, tags, tedeffects, tedtechdata,
timeslices, units, uservardata, variablecategories, variabledata.

Lines tried, each against every placed table (real vendor bytes, via throwaway Python over the
shipped `Freedonia.zip`, not committed):

- Declared lengths vs placed sizes: no signal. Every placed wide string is exactly
  `declared * 2 + 2` and every null string `declared + 1`; the sizes the dictionary states
  already are the declared-length derivation, so no second derivation exists.
- String allocation (`declared * 2` plus a terminator): identical to the placed sizes above.
  A wider creation-time allocation would have shifted every later offset; the offsets tile
  and the tail padding is zero, so there is no trace of it.
- Blob and memo in-record size: 8 bytes in every dictionary that has one, and ten of the 28
  tables (balcat x4, datanames, summaryreportrows, summaryreports, taggroups,
  variablecategories, variabledata) carry no blob or memo field at all, so no blob-width
  hypothesis can cover them.
- Index and dictionary sections: index counts do not correlate with the slack (fuels 12 indexes
  with slack 252, regions 13 with slack 8, balcat 5 with slack 4); the dictionary stream
  carries no stored stride (LE32 search over the whole stream is empty for every table, and no
  stream offset carries a stride in more than one table); the file header carries no
  stride-shaped field; block-header word `0x1c` does not encode it either.
- Page-fraction and power-of-two rounding: no single alignment works (datanames 532 -> 576
  needs x64, timeslices 756 -> 768 needs x16, balcat 300 -> 304 needs x8, areadata 784 -> 800
  needs x32 while already a multiple of 16). Exact block tiling holds for every stride only
  because `geometry` defines the base from the stride, so it cannot select one.
- The create-table record-size code: `FUN_012ec9e0` has one rule, not two. Both of its
  branches derive from the field list the file carries now (rounded running total at `+0x50`,
  or the maintained rounded total at `+0x54` via `FUN_012ec810`), plus `4 * ceil(count / 32)`.
  The `+0x58` value the nonzero-`+0x40` branch reads is a cached recompute written by
  `FUN_012ec2e0`, not a second rule.
- Stored-length hunt: the stride as LE32 appears nowhere in any dictionary stream, and the
  file's `OriginalFieldCount` is not a witness for a wider dictionary -- it equals the placed
  field count in all 82 tables that state it (including all 28 measured ones).
- Gap bytes: the padding between the rule's end and the measured stride is all zeros in every
  slot of every data block of all 28 tables (4517 slots checked), so the extra is not fields
  the dictionary dropped.

Positive results that make the negative verdict trustworthy rather than a shrug:

- A stride wider than the rule cannot come from the rule plus the page alone: the base the
  geometry gives is defined by the stride, so tiling exactness is tautological and no
  rule-to-stride function through it can exceed the rule. The extra information is not in the
  current dictionary at all.
- One stride fits every block of its table: the area sweep (2191 blocks) accounts for every
  block's stated live count under these strides, so whatever set them did so uniformly.
- The last round's mechanism ("written from a wider dictionary than the one the file now
  carries") is refuted as a field-count story by `OriginalFieldCount` and as a trailing-data
  story by the zeroed padding. Narrowing of individual fields can be neither confirmed nor
  ruled out from the bytes, and is therefore not claimed either way.

Consequence for the code: the stride stays a rule plus block-pinned measurements, and the docs
now say exactly that instead of the wider-dictionary story (`records.rs` module docs,
`MEASURED_STRIDE` docs, the capture tool's module docstring and `BYTE_MEASURED` note, the typed
test's comment, README, PORTING dated note). The per-table block evidence comments are
untouched; the values are untouched.

Red/green note: the two new tests below assert true vendor facts (highest feasible level: real
vendor bytes over the whole area), so they pass on the first run. There is no behavior change
for a failing test to drive; the implementation step is the documentation correction above,
which the tests pin in place.

## Item 2: merged doc comment -- done

- `index_of` carried a stray first line ("Where each data block starts in a table.") that
  belongs to `data_blocks`. Removed; `data_blocks_in`/`data_blocks` already carry their own.
- Stale-text pass over `records.rs`: "83 of the 86 tables place" is now "All 86" (the sweep
  asserts 86 and passes); the wider-dictionary sentences replaced (see item 1); the `stride`
  doc reworded to match. Everything else checked fresh: `record_size`, `geometry`,
  `geometry_in`, `slot_map`, `live_records`, `slot_is_unwritten`, `header_live_count`,
  `page_size`, `decode` guards, UTF-16 handling -- all match the code.

## Item 3: README and PORTING -- done

- README: both wider-dictionary sentences reworded to the established claim (rule plus
  measured, block-pinned strides; cause not established).
- PORTING: dated stride follow-up note appended at the end of the second-pass correction
  section, summarizing the no-rule verdict and its evidence.
- Shared-file rules kept: re-read before each edit, small local edits only, no lines by other
  agents touched.

## Tests

91 tests across 14 integration suites plus unit and doc targets, all passing, cargo exit 0, no
warnings in files this brief owns (the 2 remaining warnings are in another agent's
in-progress `tests/recon_tmp.rs` and were left alone per the shared-tree rules).

Of the 91: 82 baseline (unchanged, green), +2 new sweep tests from this round, +2 in
`nx1_expr` and +5 in `recon_tmp` from the parallel agents' in-progress work.

New tests (both in `tests/nx1_area_sweep.rs`, real vendor bytes over all 86 tables):

- `the_dictionary_states_the_field_count_it_carries`: every table that states
  `OriginalFieldCount` states the placed count; all 28 measured tables state it; exactly
  four tables state none (`MapUpdate`, `PluginProperties`, `branchreferences`, `version`).
- `the_padding_past_the_rule_holds_no_data`: for every measured table, every byte past the
  rule's end is zero in every slot of every data block (28 tables, 4517 slots).

## Files changed

- `leap-rs/src/records.rs`: doc comments only (module docs, `MEASURED_STRIDE`, `stride`,
  `index_of` fix).
- `leap-rs/tools/capture_nx1_records.py`: comments only (module docstring, `BYTE_MEASURED`).
- `leap-rs/tests/nx1_records_typed.rs`: one comment reworded; no test logic touched.
- `leap-rs/tests/nx1_area_sweep.rs`: two new tests; existing tests untouched.
- `leap-rs/README.md`, `leap-rs/PORTING.md`: small rewords plus one dated note.
- `activeContext.md`: new dated `leapstride` section with checkboxes (earlier sections untouched).
- `leap-rs/docs/goal-report-2026-10-19-leapstride.md`: this report (new).
- `src/oracle_records.rs`: regenerated never (nothing it captures changed); not hand-edited.

## Findings that correct earlier claims

- The wider-dictionary explanation for the 28 strides is refuted as a mechanism (count and
  trailing-data variants both); the cause is unknown, and the docs now say so.
- "83 of the 86 tables place" is superseded: all 86 place.
- `FUN_012ec9e0`'s `+0x58` branch is a cached recompute, not a second record-size rule.

## Requests for changes in files I do not own

None.

## What remains

- The 28 measurements stand as the stride source; a future round that finds a rule must beat
  the evidence above and keep the two new sweep tests green.
- The block-header word at `0x1c` is still unclaimed (out of scope for this brief); it does not
  encode the stride.
- Nothing was committed; the working tree carries the changes.
