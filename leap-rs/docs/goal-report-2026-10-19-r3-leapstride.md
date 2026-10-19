# leap-rs goal report 2026-10-19 round 3 -- leapstride (stride rule + block word 0x1c)

Brief: `leap-rs/docs/goal-briefs/round3/stride.md` plus `common-rules.md`. Agent `leapstride`.
Baseline: 112 tests across 15 suites, all passing. Nothing committed or pushed; the working
tree carries the changes, per the brief.

## Item 1: find the code that sets the stride -- stopped, measurements kept (item-3 fallback)

No stride source was found. `MEASURED_STRIDE` and `measured_stride` stay, every lookup keyed on
a table name stays with them, and the two round-2 sweep tests stay green (verified below).
Two attempts were made, per the two-attempt limit; what follows is the trace and where it stopped.

Attempt A -- the dictionary engine's record-length lifecycle (decompiled `leap.exe`).

- `FUN_012ec9e0` (chunk-00122.c:6691) still has exactly one rule: with `+0x40 == 0` it derives
  from the field list the file carries now (rounded running total at `+0x50`, or the maintained
  rounded total at `+0x54` via `FUN_012ec810`, chunk-00122.c:6378), plus `4 * ceil(count / 32)`;
  with `+0x40 != 0` it reads back the cached `+0x58`.
- The cache writer `FUN_012ec2e0` (chunk-00122.c:6277) recomputes `+0x58 = FUN_012ec9e0(param_1)`
  and rebuilds the `+0x80` key structures -- but it has NO direct caller anywhere in the binary
  (only its definition and index entry match). It is reached, if at all, indirectly. There is no
  second stride rule hiding in the cache path.
- `FUN_012eb790` (chunk-00122.c:5799) is add-field accounting: it maintains the running total at
  `+0x50`/`+0x54` as fields are added, still current-dictionary derived.
- `FUN_012ed8a0` (chunk-00122.c:6555) shows what the `+0x40` flag means: nonzero selects cached
  structures (a field index out of the `+0x80` object), zero walks the field list. It is the same
  flag `FUN_012ec9e0` branches on.
- Writers of record-descriptor `+0x58` other than `FUN_012ec2e0`: none (a `0x58` sweep of
  chunk-00122.c shows only line 6284 inside `FUN_012ec2e0` and the read at 6721).
- Where it stopped: the file/block engine that CONSUMES the record length when formatting and
  writing `NXDH` data blocks -- the code that turns the length into block capacity and record
  bases -- was not reached. The binary is stripped (index.tsv carries Ghidra-default `FUN_`
  names only, no `Tnx` symbols), the record-length callers fan out across a dozen chunks
  (00122/00124/00128/00145/00147/00150/00152-00156/00162/00168/00169/00176/00177) with indirect
  calls throughout, and block-magic constants do not appear literally in the decompile.
Attempt B -- the file as a stored-length witness (real vendor bytes, throwaway Python outside
the repo; nothing committed).

- Stride-as-u16/u32 sweep over every table file: for each of the 28 measured tables the stride
  value was searched as LE u16 and u32 in the region before the first `NXDH` block. Result:
  21 tables carry no occurrence at all. The 7 that do (fuels, regioncategories, scenarioeffects,
  summaryreports, tags, tedeffects, timeslices, plus uservardata u16-only at offsets 7/8199) are
  coincidental stream content: the same value (e.g. u32 1536) occurs in the dictionary regions of
  RULE tables too (scenarios, masterstructure carry it), and the hit contexts are page framing
  (`NXSH`) or descriptor numerics, never a length field.
- Property-name census: all length/size/record/version/restructure/block/engine/dictionary
  strings in the spliced dictionary streams. No length-like or history-like property names exist
  in any table. `OriginalFieldCount=N` equals the placed field count everywhere it appears,
  including `OriginalFieldCount=37` in scenarioeffects, tedeffects and uservardata (all measured).
- File headers (`NX!2` + 0x40 bytes) are identical in shape across measured and rule tables:
  same magic, same page-size word, same table-index/time words, zeros from +0x28 on. No
  version-dependent signal distinguishes the 28.
- Block headers carry no stride or capacity word either (full 0x00-0x20 decode on balcat,
  datanames, years, units first blocks): `+0x04` is the block's own page number, `+0x1e` the live
  count, `+0x1c` the free-list head (item 4); `+0x08..+0x0e` are file-level stamps; `+0x10` varies
  per block (e.g. 8..1000 across RegressionResults blocks) and is NOT claimed here -- out of scope.

Conclusion for items 1-3: the stride is neither computed from the current dictionary (attempt A)
nor stored in the file (attempt B). What remains is the creation-time hypothesis the shipped bytes
can neither confirm nor rule out: data blocks written when the fields were wider, then narrowed
by a later restructure (consistent with `OriginalFieldCount` staying equal, zeroed padding, and
uniform per-table stride). The old widths are gone from the file, so a later round must come at
it from the block-writer code side. Round 2's negative checks were not re-run; its two tests
stay green (below).

## Item 2: replace MEASURED_STRIDE -- not done (no source found)

Nothing to replace; the reader and the tool stay consistent on the rule-plus-measurement split.
## Item 4: the block-header word at 0x1c -- done, claimed and tested on every block

The u16 at 0x1c is the head of the block's free-slot list: one-based (free slot plus one),
zero when the block holds no free slot. Each free slot's first u16 links the next free slot the
same way, and the last link is zero.

Byte evidence (area sweep, 2191/2191 data blocks, before any implementation): 2105 full blocks
all hold head 0; in the other 86 blocks the u16 chain from the head visits EXACTLY the free set
the used-slot map leaves, and terminates at 0. Spot proofs: years (head 32 -> slot 31, the first
free slot after 31 live records); units' last block (head 9 -> slot 8, the deleted Peso record);
resultsstructure's 41 empty blocks (heads 133/144 = most-recently-freed slot + 1, LIFO push order).

Corollaries that correct earlier claims:

- The unwritten-slot signature's `index + 2` is the free-list link to the NEXT slot, not a
  numbering quirk: fresh blocks come pre-chained consecutively, so slot k holds k+2 and the last
  holds 0 where the chain ends. A slot freed from a full block holds 0 because 0 was the null
  head it replaced (units Peso). `slot_is_unwritten` is re-documented without changing its rule.
- The free-list head also corroborates the measured strides independently: the chain walk runs
  at stride geometry, so a wrong stride would misalign the links into garbage.

Red/green: the new sweep test `the_free_list_head_accounts_for_every_free_slot` was written
first against a not-yet-existing `records::free_list_head` and failed to compile (E0425) for
that reason; it passes after the implementation. No mock tests; real vendor bytes throughout.

## Item 5: README.md and PORTING.md -- done

- README: repaired a garbled stride sentence (a leftover wider-dictionary fragment fused with its
  replacement) and added the free-list-head sentence to the live-records paragraph.
- PORTING: appended the dated round-3 note (0x1c claim + stride no-source verdict with the traced
  addresses). Re-read before each edit; small local edits only.

## Tests

Owned suites, full green, no warnings in owned files:

- `nx1_area_sweep`: 5 passed (4 existing incl. the two round-2 refutation tests, +1 new free-list
  chain test: 2191 blocks, 2105 zero heads, 86 chains land exactly on their free sets), 19.69 s.
- `nx1_records_typed`: 24 passed. `nx1_records`: 4 passed. `nx1_schema`: 3 passed.
- Total owned: 36 passed, 0 failed.
- Whole-tree `cargo test` is green at re-verification: 126 passed, 0 failed across 19 suites
  (GNU + rust-lld, `target-leapstride`), no warnings. At first finish the tree did not compile
  in files this brief does not own (parallel agents mid-round-3: `examples/blobdead.rs`
  mismatched delimiter, `tests/eval.rs` ahead of `src/eval.rs`, then `src/eval.rs` mid-rename
  with `blvl_scenario` not in scope); those were left alone per the shared-tree rule and their
  authors landed fixes, after which the full run went green with no change to this brief's files.
## Files changed

- `leap-rs/src/records.rs`: new `free_list_head` reader; doc updates only otherwise
  (`header_live_count` names the 0x1c neighbor; `slot_is_unwritten` explains the link).
- `leap-rs/tests/nx1_area_sweep.rs`: one new test; existing tests untouched.
- `leap-rs/README.md`, `leap-rs/PORTING.md`: small stride/free-list edits (above).
- `activeContext.md`: new dated `leapstride` round-3 section; earlier sections untouched.
- `leap-rs/docs/goal-report-2026-10-19-r3-leapstride.md`: this report (new).
- `src/oracle_records.rs`: untouched (nothing it captures changed; never hand-edited).
- `tools/capture_nx1_records.py`: untouched (no rule change: stride/geometry/map rules identical).

## Findings that correct earlier claims

- 0x1c is the free-list head (was: unclaimed). `slot k holds k+2` is the chain link to slot k+1
  (was: an unexplained numbering); the last slot's zero terminates the chain.
- `FUN_012ec2e0` (the `+0x58` cache rewrite) has no direct caller in this binary -- the cache
  path is not a live second rule by another name.
- The stride is not stored in the file either (u16/u32 sweep, property census, identical file
  headers), extending round 2's dictionary-only verdict to the whole file.

## Requests for changes in files I do not own

None.

## What remains

- The 28 measurements stand as the stride source. The next round's lead: the block-writer/
  file-engine code that consumes the record length (unreached; start from the `FUN_012ec9e0`
  callers in chunks 00124/00128/00145/00147/00150/00152-00156/00162/00168/00169/00176/00177 and
  the free-list push/pop routines the 0x1c head implies), and the creation-time-width
  hypothesis the shipped bytes cannot settle.
- Block-header word `+0x10` varies per block and is unclaimed (out of scope for this brief).
- Nothing was committed; the working tree carries the changes.
