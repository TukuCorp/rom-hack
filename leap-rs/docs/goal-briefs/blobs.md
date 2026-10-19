# Brief: blob fields beyond the scenario memos (agent name: `leapblob`)

Read `common-rules.md` in this folder first and follow it.

**You own:**
- `src/heap.rs`
- `src/model.rs`
- `tests/model.rs`
- any new files you create, such as `src/blobs.rs` and `tests/blobs.rs`

Read `records.rs` through its public API only; another agent owns it and the capture tool. If
the tool needs a change to emit a blob oracle, write the request into your report.

## Items, in order

1. **Survey.** List every Blob/Memo/Graphic field in the area's placed tables (`NX1_RECORD_LAYOUT`)
   and every table whose file carries blob/heap blocks. Record, for each table, what the in-record
   blob field holds (block and position, length, inline bytes) and how many heap blocks there
   are. Put the survey in your report.
2. **Read every table's blob/heap blocks to their stated counts.**
   - The scenario memos already read to their counts with the `round_up_to_four(allocation + 2)`
     framing. Check whether that framing holds for the other tables' heap blocks.
   - Add an area-wide sweep test: every heap block of every table reads to the count it states.
     Write the sweep before any fix, and confirm which blocks it fails on.
3. **Join records to their blobs.**
   - Resolve a record's blob field to the memo or bytes it points at.
   - Prove the join with content that can be checked independently, such as branch notes,
     expression texts that parse with `expr`, or names that also appear in other tables.
   - Identify what the non-text blobs are (for example, compressed streams that `deflate`
     inflates, or images by their magic bytes). Decode them only where that is cheap and
     testable.
4. Update `README.md` and `PORTING.md` for your changes, following the shared-file rules.
