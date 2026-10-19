# Brief, round 3: what sets the 28 measured strides (agent name: `leapstride`)

Read `common-rules.md` in this folder first and follow it. Read your round-2 report,
`docs/goal-report-2026-10-19-leapstride.md`, too.

**You own:**
- `src/records.rs` and `tools/capture_nx1_records.py`
- `src/oracle_records.rs` (regenerated only)
- the tests `tests/nx1_records_typed.rs`, `tests/nx1_area_sweep.rs`, `tests/nx1_records.rs` and
  `tests/nx1_schema.rs`

## Background

Round 2 showed the 28 strides aren't derived from the dictionary, the file header or the block
headers, and that the padding past the engine's formula is all zeros. It looked at LEAP's own
field accounting (`FUN_012ec9e0`/`FUN_012eb790`). It did not look at the NexusDB storage engine
itself.

## Items, in order

1. **Find the code that sets the stride when it writes a record.**
   - Look in the decompiled storage engine: NexusDB's record-buffer / data-block code in
     `../leap-decompiled/` (or whichever binary or DLL carries the `NXDH`/`NXSH` writers).
   - Find the function that writes or allocates a data block's records, and trace where its
     record length comes from.
   - Candidates:
     - a length stored in a table-descriptor structure the dictionary stream doesn't spell
       directly (for example, a max-record-size or restructure-history value)
     - a version-dependent rule
     - the record length the table was *created* with, kept across later restructures that
       narrowed fields
2. **If you find the source:** read it out of the file, replace `MEASURED_STRIDE` with it (both
   the reader and the tool, kept consistent), and prove it on every table with the area sweep.
   - Keep round 2's sweep tests green.
   - Done when no stride is looked up by table name.
3. **If you don't:** keep the measurements and record what you traced and where it stopped (the
   function addresses), so a later round can continue. Don't re-run round 2's negative checks.
4. **The block-header word at 0x1c is still unclaimed.** Settle what it holds if the engine code
   you read on the way shows it, and test it on every block.
5. Update `README.md` and `PORTING.md` for your changes, following the shared-file rules.
