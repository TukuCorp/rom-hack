# Brief, round 3: memo encoding and the kind-5 memos (agent name: `leapblob`)

Read `common-rules.md` in this folder first and follow it. Read your round-2 report,
`docs/goal-report-2026-10-19-leapblob.md`, too.

**You own:**
- `src/heap.rs`, `src/model.rs` and `src/blobs.rs`
- the tests `tests/model.rs` and `tests/blobs.rs`
- any new files you create

## Items, in order

1. **Replace the content-guessed text encoding with a rule.**
   - `Memo::text` decides between wide and narrow by looking at the bytes. Find what states the
     encoding. Candidates:
     - the memo record's kind byte or flag bits
     - the field type (`nxtBlobMemo` against `nxtBlobWideMemo`) combined with something else
     - the header bytes before the text
     - the decompiled blob reader in `../leap-decompiled/`
   - Prove the rule on all 5,505 memos: it must give the same text as the content check
     everywhere the content check is unambiguous. Then drop the guess.
   - If no rule exists, say so with evidence, and keep the guess documented as one.
2. **Decode the kind-5 memos.**
   - The 449 kind-5 memos are arrays of little-endian `u32` triples plus a NUL byte.
   - Work out what the triples are. Candidates:
     - (branch, variable, scenario) or (table, record, field) references to other tables' ids
     - link/reference lists
     - rich-text or graphics run tables
   - Use the decompiled code that writes or reads that blob kind, and cross-check the numbers
     against the ids in the decoded tables (`records`, `model`).
   - Two scenario Expression rows point at kind-5 memos: branch 595 `Passenger`, variable 2027;
     and branch 831 `HFC125`, variable 991. Explain what those hold.
   - Decode the memos where the meaning is settled and testable. Otherwise record what you
     ruled out.
3. **Embedded graphics (optional, cheap only).** Scenario-effects blocks 157 and 161 hold
   metafile-like memos. Identify the format (by magic bytes or record structure) if that's
   cheap. Don't build a renderer.
4. Update `README.md` and `PORTING.md` for your changes, following the shared-file rules.
