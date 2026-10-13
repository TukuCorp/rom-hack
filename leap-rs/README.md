# leap-rs

A headless Rust port of LEAP, built function by function out of the shipped binary. Every
ported unit carries its original address and name, and every one is covered by a test that
compares it against output from the original. Nothing here needs a registry, a runtime, or
LEAP itself to build or run.

## What is actually ported

One shipped component, end to end: `testleap.exe`, the file validator that sits beside LEAP.

| original | role | Rust |
|---|---|---|
| `0x0042669c` | `IsLeapYear` | `calendar::is_leap_year` |
| `0x004266d8` | date validate and day-number encode | `calendar::day_number_int`, `day_number` |
| `0x0061a848` | the `.leap` verdict chain in `entry` | `container::decide`, `container::run` |
| `0x0060df1c` | member lookup in the archive | `container::has_member`, `has_pattern` |
| `0x00610058` | opening the archive, zip64 included | `container::entries`, `member_names` |
| `0x00611e78` | the meta check and the meta echo | `container::meta_echo` |
| `0x0060d88c` | reading one member out | `container::read_member`, `deflate::inflate` |

It also builds `testleap`, a drop-in for the vendor binary: same verdicts, same messages, same
exit codes, down to CRLF. The one thing it will not do is delete your files, which the vendor
does on `/C` whatever the verdict, valid archives included. `PORTING.md` carries a warning.

Beside the validator the crate reads the model out of an area. `nx1::dictionary` reads a table
schema, `nx1::wide_strings` reads the names and the arithmetic out of the record area as plain
UTF-16, and `expr` parses that arithmetic, which the scenario table stores as `@F` and
`@V` expressions. None of that has an address in the binary to carry, because it is a file
format rather than a function, so its evidence is the vendor's own area rather than an
emulator.

The codes inside that arithmetic are named as well. `functions` carries what the vendor's own
registry states for each code, together with the address of the function that evaluates it,
read out of the binary rather than inferred from the shape of the expressions.

And the area is readable as numbers, not only as text. `records` reads the offset and size the
dictionary states for every field, works out how long a record is, and decodes the fields by
type, so a table comes back as typed rows: 80 of the 86 tables in the shipped area, of which 26
hold no rows at all. The first data block of `datanames.nx1` decodes to its seven records with
TableID, TableName, FieldID, SetID, Name and Abbreviation. A table whose descriptor stream
cannot be placed comes back empty rather than as a plausible wrong layout, because the fields
have to tile a record with no gap.

The year list reads as well: `years.nx1` comes back as the 31 years 2020 to 2050 -- the base year
the area settings state, through to the year LEAP stops at -- once slots nothing was ever written
to are left out. Without that, the free slots past the live ones read as years 33 and up.

Above the records sits the model itself. `model` reads the structure table into the area's branch
tree -- 439 rows in the shipped area, 434 of them named, each with its parent, level and type --
which is the first thing here that is a model rather than a file format. The tree checks itself:
every named branch has a parent the table also holds, exactly one branch has no parent, and the
links never close into a cycle.

The scenario table reads too, and it is the other half of the model: each row names the branch and
variable it sets, in which region and scenario, and where the expression for it lives. That last
part is a blob reference of two numbers, and the second is the number of a data block inside the
same file -- the seven blocks the scenario table points at are exactly its seven `NXHD` blocks --
while the first is the memo position within that block. So every expression has an address; reading
the memo at that address is what `heap` does.

The memo framing came out of the gaps between memos rather than out of a specification: a memo starts
with a two-byte allocation and a kind byte, the text follows in UTF-16, and the record occupies
`round_up_to_four(allocation + 3)` bytes. With it a scenario row resolves to its expression, and the
first seven rows of the shipped area come out as `0.2`, `5`, `1000`, `5`, `0`, `1` and `2040`,
in the order the rows name them. The eighth has no expression at all.

## How it is checked

Fifty-seven tests over eleven suites, none of which assert against its own implementation:

* `calendar_parity` - 310 leap-year and 487 day-number vectors captured by emulating the
  original, floats compared as raw IEEE-754 bits.
* `container_parity` - 130 real archives across four output modes, exit code and the whole of
  stdout compared byte for byte, which is 520 whole-process comparisons.
* `deflate_parity` - 12 zlib streams against the crate inflater, covering stored blocks and
  back-references out to 32000 bytes.
* `run_parity` - 14 argument lists against the argument loop, including the `-1` verdicts.
* `nx1_schema` - the dictionary reader against three tables from the Freedonia area that
  ships with LEAP. Four of the field names it recovers also appear as keys in the area
  plain-text settings file, which is a different artefact and so real corroboration.
* `nx1_records` - the wide-string reader over the same three tables, checked against the
  reference parser and against what LEAP calls these objects: fuel names such as Electricity
  and Natural Gas, branch names such as Load Shapes and Land Areas, and the model arithmetic
  itself, which the scenario table stores as @F and @V expressions.
* `functions` - the registry the vendor builds at startup, 354 codes with their names and second
  names, the 16 property codes numbered in the same space, and the 332 evaluator entry points
  the dispatch points at. Every code the stored expressions spell has to be named by one table
  or the other and spelled the way the builder spells it.
* `nx1_records_typed` - the typed-row reader over the vendor's own dictionary bytes and one data
* `model` - the branch tree out of the vendor's structure table. The top level of the area has to
  come back as the eight modules it is made of, Freedonia among them, and the whole tree has to
  satisfy its links: every named branch's parent is a branch, one branch has no parent, and the
  chain never closes a cycle. The last data block, which is seven slots deep, pins that a slot
  nothing was written to is left out.
  The scenario table is read as well, and its keys have to join to the tree: every branch a
  scenario row refers to is a branch of the structure table, the memos it points at are all in the
  file's blob blocks, and the first block numbers them one upwards. `heap` then reads the memo at
  that address, and the first seven rows have to come back as the numbers the file holds.
* `nx1_records_typed` - the typed-row reader over the vendor's own dictionary bytes and one data
  block. The dictionary has to state a place for every field for the fields to tile a record with
  no gap, and that is the assertion; the record size then has to be the stride the bytes are
  written at, which is checked against 80 tables. Two tests make the refusal itself the claim: a
  field moved by one byte, and a class name planted inside stream data, both have to change
  nothing. The year list is the one table whose answer is knowable on its own, and it has to come
  out as exactly 2020..2050 with the free slots left out.
* `nx1_expr` - the expression reader over the 44 expressions the vendor area stores, each one
  with the byte window it was read from so the Rust scanner meets the capture tool on the
  original bytes. The round trip is asserted as a fixed point rather than character for
  character, because LEAP is not consistent about the spaces between arguments.
* `vendor_e2e` - the ported binary and the vendor binary run against each other over 55
  argument lists, plus the five sample areas SEI ships, up to twelve megabytes each. Nothing
  pre-recorded.

Beyond the suite, `tools/differential_sweep.py` builds archives nobody chose and diffs the two
binaries over 87 argument lists. It currently reports 0 divergences over 80 archives.

## The two things not yet reachable

The model itself, meaning the arithmetic behind a LEAP area, is not ported, and the two routes
to it are both gated. They are written up in `docs/nx1-reconnaissance.md`.

* Through LEAP, which is the sanctioned route: the install registers a COM automation server
  with `Calculate` and `ExportResultsCSV` on it, which would make result-level parity
  reachable without emulating a single one of the 168,840 functions. It works, it runs
  headlessly, and it refuses every area operation with "not available when a supporting screen
  is open". That screen is a dialog titled Evaluation Mode: LEAP is unlicensed on this
  machine, and dismissing it from a script would be defeating the vendor licensing.
* Through the files, which is permission-free and now most of the way. The dictionaries are
  plain text, so an area schema is readable; the record areas are plain UTF-16, so the fuel and
  branch names and, in the scenario table, the **model arithmetic itself** are readable; that
  arithmetic parses into a tree; the codes in it are named and each is tied to the address of
  the function that evaluates it; and a table now decodes into typed rows rather than strings.
  What is not done is reading the blob fields, six tables whose descriptor stream this reader
  cannot place, filtering a record that was written and then deleted -- the year list is filtered
  by the signature of an unwritten slot rather than by the block header's own map, which is not
  read yet -- and evaluating any of it: an expression still has no value.

So the honest state is: one component ported and verified hard, and the model readable down to its
branch tree, its year list, its keys and, for the first block, its equations. The arithmetic parses,
every code in it is named, the address of the function that would evaluate it is known, the rows it
would read are where the dictionary says they are, and 165 of the shipped model's expressions now
come out as text. Not one of them has a value: the heap walk stops early in one of the seven blob
blocks, and the evaluator is not written.

## Build and test

On this machine there is no Windows SDK, so MSVC cannot link. Type checking works on the
default toolchain, but tests need the user-local GNU one:

    cargo check --all-targets
    $env:RUSTFLAGS = '-C linker=rust-lld'
    & $env:USERPROFILE\.cargo\bin\cargo.exe +stable-x86_64-pc-windows-gnu test --target x86_64-pc-windows-gnu

`PORTING.md` has the policy, the scope limits, and the provenance of every vector.
