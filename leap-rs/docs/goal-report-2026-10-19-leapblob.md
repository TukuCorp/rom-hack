# leap-rs goal report - 2026-10-19 - leapblob

Brief: `leap-rs/docs/goal-briefs/blobs.md` (agent `leapblob`), after `common-rules.md` in full.
Baseline: 90 tests green (GNU toolchain + rust-lld, own target dir `target-leapblob`).
Nothing was committed or pushed; the tree is left as the working changes, per the brief.

## Item outcomes

### 1. Survey -- done

29 tables carry Blob/Memo/Graphic fields (from `NX1_RECORD_LAYOUT`, field name, type, offset):

- Lines: Notes `nxtBlob` @234, NotesHTML `nxtBlobWideMemo` @279 -- no data blocks (empty table).
- Nodes: Notes `nxtBlob` @254, NotesHTML `nxtBlobWideMemo` @769 -- no data blocks.
- PluginProperties: Purpose @506, Description @514, Prerequisites @2124, all WideMemo -- no data blocks.
- Plugins: Description WideMemo @1585 -- no data blocks.
- areadata: Notes `nxtBlob` @0, NotesHTML `nxtBlobMemo` @765 -- heap pages [6], stated [2].
- branchreferences: Expression WideMemo @10 -- no data blocks.
- changelog: Expression WideMemo @14 -- no data blocks.
- constants: NotesHTML WideMemo @0, Notes WideMemo @114 -- heap [5,6,12,13,14,15], stated [21,6,6,6,6,4].
- diagnostics: Message WideMemo @14 -- heap [5], stated [2].
- emissionmappings: Notes @2565, NotesHTML @2577 -- no data blocks.
- fuels: Notes @294, NotesHTML @946 -- heap 72 pages from 19, 241 memos.
- landtypes: Notes @232, NotesHTML @314 -- rows exist, all blob refs zero, no heap blocks.
- lifecycledata: Notes @116, NotesHTML @177 -- all refs zero, no heap blocks.
- masterstructure: Notes @328, Expression @339, NotesHTML @492 -- heap [6,7], stated [4,2].
- refs: Notes @2154, NotesHTML @3269 (8 KiB pages) -- heap [17,18,63,64,65,66], stated [38,8,10,10,10,3].
- regions: Notes @258, NotesHTML @345 -- all refs zero, no heap blocks.
- scenariodata: Expression WideMemo @10 -- heap [5,6,11,13,19,21,25], stated [190,199,149,170,152,114,41].
- scenarioeffects: Notes @810, NotesHTML @1483 -- heap 187 pages from 6, 425 memos.
- scenarios: Description `nxtBlob` @2, NotesHTML @298 -- heap [13,14,15,16,17,20], stated [12,6,5,3,3,1].
- scenariotemplate: Description WideMemo @245 -- heap [5], stated [3].
- tags: NotesHTML @1272 -- all refs zero (16 rows), no heap blocks.
- tedeffects: Notes @810, NotesHTML @1483 -- heap 187 pages from 6, 425 memos (mirrors scenarioeffects).
- tedenvdata: UncontrolledExpression `nxtBlobMemo` @12 -- heap 11 pages, 2,067 memos.
- tedtechdata: InfoPageURL WideMemo @130, Notes @274 -- heap 63 pages, 1,161 memos.
- timeslices: Notes @562 -- all refs zero (9 rows), no heap blocks.
- tsprofiles: NotesHTML @206, RawData `nxtBlobMemo` @305, NotesHTML @387 -- all refs zero, no heap blocks.
- units: NotesHTML @203 -- all refs zero (179 rows), no heap blocks.
- uservardata: NotesHTML @5533 (8 KiB pages) -- all refs zero, no heap blocks.
- variableshortcuts: Notes @86 -- no data blocks.

In-record blob field holds low word = one-based memo position, high word = heap block page
number in the same file; zero means no blob. Verified for every non-zero reference area-wide
(item 3): the high word is always a heap page of the same file and the low word never exceeds
what that block states.

Heap census (13 files, 550 blocks, 5,505 memos): areadata 1/2, constants 6/49,
diagnostics 1/2, fuels 72/241, masterstructure 2/6, refs 6/79, scenariodata 7/1,015,
scenarioeffects 187/425, scenarios 6/30, scenariotemplate 1/3, tedeffects 187/425,
tedenvdata 11/2,067, tedtechdata 63/1,161.

### 2. Area sweep -- done, no fix needed

The sweep was probed in Python first, before any Rust change: all 550 heap blocks walk to
their stated counts at the `round_up_to_four(allocation + 2)` framing, zero mismatches. So the
scenario-table framing generalizes with no fix, and the Rust sweep in `tests/blobs.rs` pins it:
550 blocks, 5,505 memos, empty shortfall list. The tentative red was the test failing to compile
against the not-yet-existing `blobs` module; the first run with the implementation green was
10/10, including the sweep.

### 3. Join -- done for text; binary identified as far as is cheap

- `src/blobs.rs` resolves any blob value (`heap_pages`, `split`/`join`, `resolve`/`resolve_at`,
`expression_text`, `Memo::text`). `heap::record_bytes` exposes kind + raw payload; `Memo::text`
reads by content (wide when the units until the terminator are ASCII, narrow when the bytes
are), because encoding is per memo, not per field: `NotesHTML` points at narrow RTF (`Load
Shapes`, `Freedonia`) as well as wide HTML.
- Proofs, each on vendor bytes: scenario rows 1-7 resolve to `0.2`, `5`, `1000`, `5`, `0`, `1`,
`2040`, all parsing with `expr`; tedenvdata memo (1,5) is `68607` and parses; all 177
tedtechdata info-page memos are non-empty paths (`demand.html`, `dmd\\...`, `refs/...`) or http
URLs; `Load Shapes` NotesHTML starts `%3Chtml%3E`, `Freedonia` Notes starts `{\\rtf1`;
scenarioeffects and tedeffects resolve byte-identical memos at (1,6), (2,6), (6,7).
- Non-text: kind 5 is 449 memos of one or more little-endian `u32` triples plus a NUL byte
(single-triple 13-byte form most common; longest is Natural Gas Notes, 6 triples in 73 bytes);
kind 0 is 3 empty memos of twelve zero bytes. Not text, not a deflate stream, no image magic,
and no row or parallel text names their numbers -- including the two scenario Expression rows
(branch 595 `Passenger` var 2027, branch 831 `HFC125` var 991) that point at binary, asserted as
`None` from `expression_text`. Two decode attempts spent (inflate, magic-bytes); stopping there
per the brief. Scenario-effects blocks 157/161 show binary-with-text memos (metafile-like opcodes
beside a `North America` wide fragment), so embedded graphics exist in this area, but the kind-5
arrays themselves are not identified further.

### 4. README.md + PORTING.md -- done (shared-file local edits only)

- README: suite counts, new `blobs` bullet, the not-done list (blob fields removed, heap count
corrected from five blocks to 550 area-wide), honest-state paragraph (1,009 scenario + 2,067 TED
memos resolve).
- PORTING: dated blobs-round note after the stride follow-up (survey, framing, kinds, triples).
- `src/lib.rs`: one `pub mod blobs;` line. `activeContext.md`: own dated section only.

## Tests

109 tests over 16 suites, all passing, no warnings in owned targets (`tests/recon_tmp.rs`,
another agent's scratch file, carries the only 2 warnings).

```
blobs 10, calendar_parity 4, container_parity 4, deflate_parity 3, eval 4, functions 9,
model 10, nx1_area_sweep 4, nx1_expr 11, nx1_records 4, nx1_records_typed 24, nx1_schema 3,
recon_tmp 9, resolve 4, run_parity 3, vendor_e2e 3 -- 109 passed, 0 failed.
```

The `blobs` suite (10 tests) is the new coverage: the 550-block sweep, the 4,547-reference
join sweep, scenario/tedenvdata expressions that parse, 177 info-page paths, branch notes,
the empty memo, Natural Gas binary triples, parallel-table byte equality, and the
narrow/wide/binary content rule. Counts include the other agents' in-flight suites, which moved
during this round (stride finished at 91 green; resolver added `resolve`).

## Files changed

- `leap-rs/src/blobs.rs` (new) -- heap discovery, resolution, kind-aware text.
- `leap-rs/src/heap.rs` -- `record_bytes` added; stale `memos` doc fixed (all seven scenario
blocks read to stated counts); module doc points at `blobs` for non-wide memos.
- `leap-rs/src/model.rs` -- ScenarioRow doc: `blobs::expression_text` resolves rows now.
- `leap-rs/src/lib.rs` -- one `pub mod blobs;` line.
- `leap-rs/tests/blobs.rs` (new) -- the sweep and join tests above.
- `leap-rs/README.md`, `leap-rs/PORTING.md`, repo-root `activeContext.md` -- dated/local edits.

## Findings that correct earlier claims

- `heap::memos` doc said six of seven scenario blocks read to count with the seventh short; all
seven read to stated counts since the stride correction -- doc fixed.
- `model.rs` said resolving a memo `is what this port does not do`; `blobs::expression_text`
does it now.
- `heap` wide-decodes every memo, which misreads narrow memos (areadata notes, most RTF);
`Memo::text` reads by content instead. `heap` stays the scenario-table wide reader.
- README's `five blocks behind the scenario table` is 550 heap blocks in thirteen files.

## Requests for changes in files I don't own

None. `records` (stride agent) and `expr` (resolver agent) are used read-only through their
public APIs. The capture tool needs no change: its blob walk already applies the same
`allocation + 2` rule and fails loudly on shortfall, and the sweep reads the live zip like
`nx1_area_sweep` rather than from a new oracle fixture, so there is no blob oracle to emit.
Mid-round the tree broke for a few minutes on `src/resolve.rs` (resolver agent mid-edit);
waited per the rules and it compiled again with no action needed.

## What remains

- The `u32`-triple binary memos are not decoded (shape documented above).
- The resolver, series grammar internals, the remaining `leap.exe` functions, and the
licence-gated COM route are other agents'/rounds' work, untouched here.
- Nothing was committed; the working tree carries the changes.
