# leap-rs goal report - 2026-10-19 round 3 - leapblob

Brief: `leap-rs/docs/goal-briefs/round3/blobs.md` (agent `leapblob`), after
`common-rules.md` in full. Round-2 report `docs/goal-report-2026-10-19-leapblob.md`
read first. Baseline: full suite green (GNU toolchain + rust-lld, own target dir
`target-leapblob`). Nothing committed or pushed; the tree is left as the working
changes, per the brief.

## Item outcomes

### 1. Content-guessed encoding replaced with a rule -- done

The kind byte states how a memo reads, and for kind 4 the blob field states the width:

- kind 0: empty (`Some("")`), 3 memos of twelve zero bytes, all live-referenced.
- kind 3: counted short string, always thirteen payload bytes (2,607). The trailing
  LE u16 counts the text -- odd for that many narrow bytes, even for half as many wide
  units -- with zero padding between text and count. The count, not the content, decides:
  51 five-unit texts (`Water`, `False`, `13.75`, `@F` values) have no NUL unit, which is
  where the guess truncated them to one unit. Fifty read wide, one narrow ten-char value
  reads narrow and agrees with the guess.
- kind 4: terminated text in the field width -- `nxtBlob`/`nxtBlobMemo` narrow,
  `nxtBlobWideMemo` wide. All 4,547 live references agree (1,214 narrow, 467 wide,
  plus 2,607 counted, 256 binary, 3 empty). Wide past ASCII is exactly `U+00A4` (the
  separator in sixty `@F007(2030,90)`-style expressions) and `0x0b`/`0x0e`/`0x0f` trailing
  dirt (six memos: `Dollars`, `Ammonia`, `Benzene`, `Toluene`, `Methane`).
- kind 5: binary, `None` (449, shape-proved below).
- 222 superseded memos keep kind and allocation with the first payload byte zeroed;
  zero live rows point at them, and the walk skips the byte to read the text they held.

Proof on all 5,505: the rule equals the old guess on 5,363 memos (4,433 live + 930 dead);
the 142 overrides are the 50 five-unit counted texts, 64 live + 1 dead wide-past-ASCII
texts, and 26 binary triples opening with whitespace -- each class asserted with its
members. The guess survives only as a test-local oracle measuring the rule.
`Memo::text` now takes a `Width`; `expression_text` reads it off the `Expression` field;
`resolve`/`resolve_at` signatures are unchanged. No rule was found in the decompiled
binary: `NXHD` appears in none of its 344 chunks, so the NexusDB segment reader is
external to leap.exe and the rule is proved on the vendor bytes instead.

### 2. Kind-5 memos decoded as far as settled -- done

Settled and tested on all 449 (950 triples): shape (k triples + NUL, most often one in
thirteen bytes); every offset splits as chunk x 4059 (the longest memo content) + remainder
(max chunk 16); segment numbers run per table in creation order (constants 5-15 through
scenarioeffects/tedeffects 6-260, low numbers repeating across tables); op 1 is plain and
op 2 current, higher ops sit in superseded memos (live A: 199x1, 191x2; dead: 304x1 plus
a tail to 170); 188 of 192 live op-2 entries shadow a dead op-1 entry with the same
numbers (3 scenarios-table exceptions, plus one twice-superseded dead memo keeping a
current entry and one live op-3-only memo). The two named rows hold `(2,19,126)` (branch
595 `Passenger`, variable 2027, Current Accounts) and `(2,25,252)` (branch 831 `HFC125`,
variable 991) beside Baseline siblings reading `@F041(32,2027,-99,-99,0,...)` (35 chars)
and `@F037(32,2027,-99,-99,0,...)` (30 chars) and dead shadows `(170,13,61)+(1,19,126)`
and `(114,21,213)+(1,25,252)` -- versioned segment directories, not evaluable expressions,
so they stay `None` from `expression_text` as before. Ruled out with numbers:
(branch,variable,scenario) (components mismatch the owning rows), (table,record,field)
(offsets to 66,898 pass any row/field id, ops to 170 pass the 86-table count), and text /
deflate / image-magic readings. The leading reading is rich-text segment runs at chunked
text offsets, undecoded: no run semantics and no text store were found.

### 3. Embedded graphics -- done, cheap, no renderer

Scenario-effects blocks 157 and 161 (mirrored in tedeffects) hold one dead max-size narrow
memo each (4,059 chars): 157 is hex digits and line breaks decoding to a binary with wide
map labels (`North America`, `96 [5%]`, `Central America`, `63 [25%].`), 161 is a hex head
with an RTF tail citing a soil map (`Oldeman, van Engelen, and Pulles, 1990`). No WMF/EMF/
BMP/PNG/GIF/zip/gzip magic after hex-decode, not a deflate stream: hex-encoded binary,
format named, no renderer built, per the brief.

### 4. README.md + PORTING.md -- done (shared-file local edits only)

- README: `blobs` bullet rewritten for the stated rule (tombstones, directories, the 143
  overrides); suite count line updated to the final green run.
- PORTING: dated round-3 paragraph after the blobs-round note.
- `src/lib.rs` untouched (no new modules). `activeContext.md`: own dated section only.

## Tests

128 tests over 15 suites (18 binaries), all passing, no warnings.

```
blobs 19, calendar_parity 4, container_parity 4, deflate_parity 3, eval 20, functions 9, model 10, nx1_area_sweep 5, nx1_expr 12, nx1_records 4, nx1_records_typed 24, nx1_schema 3, resolve 5, run_parity 3, vendor_e2e 3 -- 128 passed, 0 failed.
```

The `blobs` suite carries the new coverage (19 tests): the sweep and join as before, the
kind-3 counted rule on all 2,607, the field-type width on all 4,547 live references with
full-string spots (`Water`, `@F007` with separators, `Dollars` dirt, `Methane` dirt), the
222 tombstones plus 3 live empties, the rule-vs-guess partition over all 5,505 (live
4,433 + 50 + 64; dead 931 + 26 + 1), the kind-5 shape/chunk/shadow/scenario-row asserts,
and the 157/161 hex blocks. Counts include the other agents in-flight suites, which moved
during this round (eval grew, `resolve` and the area sweep are new).

## Files changed

- `leap-rs/src/blobs.rs` -- the stated rule: `Width`, `width_of`, `field_width`, counted
  kind-3, width-parameterised kind-4 with the documented wide set, `Segment` + `segments`,
  `tombstoned`, width-deducing `expression_text`. Guess dropped.
- `leap-rs/src/heap.rs` -- `tombstoned` helper only; the walk is unchanged.
- `leap-rs/tests/blobs.rs` -- 8 new tests, red/green (the `Water` truncation failed first as
  `Some("W")`), call sites on the new `text(width)`.
- `leap-rs/README.md`, `leap-rs/PORTING.md`, repo-root `activeContext.md` -- dated/local edits.
- Deleted before finishing: scratch `examples/blob{dump,struct,full,rows,dead}.rs` and all
  analysis dumps (they lived under `target-leapblob/`).

## Findings that correct earlier claims

- Round-2 `Memo::text reads by content` is replaced: content decides nothing on the live
  path. Its outputs were wrong on 114 live memos (50 five-unit counted texts, 64
  wide-past-ASCII texts) and 28 dead ones (26 binary it read as whitespace, 2 truncated) -- `False` came back `F`,
  `@F007(...)` came back truncated at the separator, `Water` came back `W`.
- Round-2 `kind 5 is 449 memos of u32 triples plus a NUL byte, most often single` holds,
  and the triples now read as (op, segment, offset-at-4059-chunks) with the version
  lifecycle evidenced; the `(branch,variable,scenario)` and `(table,record,field)` guesses
  from the brief candidate list are ruled out.
- Round-2 `blocks 157 and 161 hold metafile-like memos` is corrected: hex-encoded binary
  with map labels, plus hex/RTF with a soil citation -- not a metafile, no renderer.
- Round-2 `heap wide-decodes every memo` stays true for `heap` (the scenario-table wide
  reader); `blobs` no longer routes through content guessing.

## Requests for changes in files I do not own

- None required. One note for the eval agent: sixty live scenario expressions now resolve
  in full with `U+00A4` separators (e.g. `@F007(2030,90)`-with-separators) where the guess
  truncated them at the separator; `True`/`False`-style letter values and the `0x0b`-dirt
  `Dollars` value still parse to nothing, as before. Full suite green with their code
  untouched. Mid-round the tree decoded masterstructure rows as BranchID -8/-1 (stride
  agent reworking `records.rs`); per the rules I waited, then pinned the branch-notes test
  by memo position instead of row lookup. No action needed from them.

## What remains

- Higher kind-5 op semantics, the segment text store, and the 4059-vs-4096 37-byte gap are
  open; the sweep pins the settled shape.
- The resolver, series grammar internals, remaining functions, and the licence-gated COM
  route are other agents/rounds work, untouched here.
- Nothing committed; the working tree carries the changes.

## Test output summary

```
128 passed, 0 failed; no warnings in the build output.
```
