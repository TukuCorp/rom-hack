# Brief: the stride rule (agent name: `leapstride`)

Read `common-rules.md` in this folder first and follow it.

**You own:**
- `src/records.rs`
- `tools/capture_nx1_records.py`
- `src/oracle_records.rs` (regenerated only)
- `tests/nx1_records_typed.rs`
- `tests/nx1_area_sweep.rs`
- `tests/nx1_records.rs`
- `tests/nx1_schema.rs`

## Items, in order

1. **Replace `records::MEASURED_STRIDE` with a rule.**
   - **Background:**
     - 28 tables read at strides that were measured and looked up by table name, because the
       engine's rule (fields rounded up to 4, plus 4 bytes per 32 fields) understates their
       records.
     - The last round's explanation, "written from a wider dictionary than the file now
       carries", is unproven.
     - The values are suspiciously round: 304, 336, 576, 768, 1280, 1344, 1536, 3072, 3584 and
       6144.
   - **Lines to try, all against every placed table:**
     - The declared lengths in the descriptors versus the placed sizes.
     - The string fields' allocation (for example, wide strings allocated at their declared
       length times 2 plus a terminator).
     - Blob and memo fields' in-record size.
     - The index and dictionary sections.
     - Page-fraction or power-of-two rounding.
     - The record-size code the decompiled engine runs when it *creates* a table rather than
       when it adds a field (`../leap-decompiled/`, starting near `FUN_012ec9e0` /
       `FUN_012eb790`).
   - **Done when:** one rule gives every table's stride, the whole area sweep stays green, and
     `MEASURED_STRIDE` and `measured_stride` are gone, along with every lookup keyed on a table
     name in the reader and the tool.
   - **If no rule explains them all:** keep the measurements for the ones it can't explain, and
     report exactly which tables resist and why.
2. Fix the merged doc comment at `src/records.rs` (around line 368, "Where each data block starts
   in a table." runs into "Where a named field sits in a decoded row"). Then check `records.rs`
   for other stale doc text left by the last round.
3. Update `README.md` and `PORTING.md` for your changes, following the shared-file rules.
