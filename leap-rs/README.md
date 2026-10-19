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
type, so a table comes back as typed rows: all 86 tables in the shipped area, of which 28 hold no
rows at all. Three dictionaries cross a page boundary, and a page is a 32-byte lead, the stream and
a 4-byte trailer, so the reader splices the pages before it reads the stream. A page is 4096 bytes
for most tables and 8192 for five of them, and the file states which at 0x14; the page size a table
states is the page its blocks are read in. The first data block of `datanames.nx1` decodes to its
seven records with
TableID, TableName, FieldID, SetID, Name and Abbreviation. A table whose descriptor stream
cannot be placed comes back empty rather than as a plausible wrong layout, because the fields
have to tile a record with no gap.

The length of a record is the engine's own computation, read out of the binary rather than fitted
to the data: the summed field sizes rounded up to four bytes, plus a four-byte null-bitmap word per
thirty-two fields (`FUN_012ec9e0`, reached from `FUN_012eb790`'s add-field accounting). Most tables
are written at exactly that stride. Twenty-eight are not: their records were written from a wider
are not: the rule stops short of the stride the blocks carry, and their stride is measured from
the block instead -- the pitch of consecutive records' wide strings, or the free-list number the
free slots hold. What sets the wider stride is not established; the dictionary does not derive
it. Each measurement is listed with its evidence in `records::MEASURED_STRIDE`.

Which records are live is the file's own answer. A data block is a 0x20-byte header, a used-slot
bitmap with one bit per slot, and the records tiling back from four bytes short of the page, and
the capacity is the most records that leave room for the header and their bitmap. That one rule
reproduces every record base measured by hand, and the bitmap marks exactly the number of records
each header states, in all 2191 data blocks of the placed tables. The u16 beside the live count,
at 0x1c, heads the block's free-slot list -- one-based, zero when the block is full -- and walking
it visits exactly the slots the bitmap leaves free. The year list comes back as the
31 years 2020 to 2050 -- the base year the area settings
state, through to the year LEAP stops at -- and a units record deleted from the middle of its block
is left out, although its residue looks written to any rule that reads only the record.

Above the records sits the model itself. `model` reads the structure table into the area's branch
tree -- 434 branches in the shipped area, each with its name, parent, level and type --
which is the first thing here that is a model rather than a file format. The tree checks itself:
every branch has a parent the table also holds, exactly one branch has no parent, and the
links never close into a cycle.

The scenario table reads too, and it is the other half of the model: each row names the branch and
variable it sets, in which region and scenario, and where the expression for it lives. That last
part is a blob reference of two numbers, and the second is the number of a data block inside the
same file -- the seven blocks the scenario table points at are exactly its seven `NXHD` blocks --
while the first is the memo position within that block. So every expression has an address; reading
the memo at that address is what `heap` does.

The memo framing came out of the gaps between memos rather than out of a specification: a memo starts
with a two-byte allocation and a kind byte, the text follows in UTF-16, and the record occupies
`round_up_to_four(allocation + 2)` bytes. With it a scenario row resolves to its expression, and the
first seven rows of the shipped area come out as `0.2`, `5`, `1000`, `5`, `0`, `1` and `2040`,
in the order the rows name them. The eighth has no expression at all.

A blob block states in its own header how many memos it holds, and that is what the reader checks
itself against: all seven blocks of the shipped table read to exactly the count they state -- 190,
199, 149, 170, 152, 114 and 41. The stride took a correction to get there. The wider one landed the
fifth block's second record on the zeros in the middle of a real header, ending the walk one memo
into a block that states 152; at the stride the block's own headers show, the record ends where that
header begins.

And the arithmetic has values. `eval` turns a tree into a number where the port can
stand behind it -- the numbers the file spells, `+ - * /` with the parser's precedence, `@F010`,
whose decompiled evaluator `FUN_01bcf430` is a single division by 100.0, `@F029`/`@F030`
(Million/Billion, pure powers of ten), and now the growth family, the annualized cost and the
baseline value: Growth, Interp, Step, GrowthAs and AnnualizedCost evaluate through
`FUN_01be8250` and `FUN_01bbc620`, BaselineValue through `FUN_01bd1c70`, reading the area through
`resolve` -- the years, the scenario expressions with inheritance, the constants and the discount
rate. Interp and Step carry the engine's base-year override: a series starting after the base
year is headed by the Current Accounts value, so the base year reads it. One entry point,
`eval::text_in_context`, values a stored expression's text for a branch, variable, region,
scenario and year; the context-free path stays for what needs no area. Anything else -- the fuel
property references, Remainder, YearlyShape, unknown codes, rows the area does not hold -- comes
back `None` rather than a plausible number. At 2027, 861 of the area's 1,009 stored expressions
evaluate.

## How it is checked

One hundred twenty-eight tests over fifteen suites. None of them asserts against the crate's own output, but
read the `nx1_*` and `model` suites knowing where their expected values come from: the calendar and
container vectors are output of the vendor's own code, while the table oracles come from
`tools/capture_nx1_records.py`, a Python reader written from the same byte-level reading as the
Rust one. A shared misreading would pass both. The checks that do not depend on that reading are
the ones to weight: the year list being 2020 to 2050, fields tiling a record with no gap, the tree
satisfying its links, record bases measured by hand, and the live counts the file itself states.

* `calendar_parity` - 310 leap-year and 487 day-number vectors captured by emulating the
  original, floats compared as raw IEEE-754 bits.
* `container_parity` - 132 inputs across four output modes, exit code and the whole of
  stdout compared byte for byte, which is 528 whole-process comparisons.
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
  or the other and spelled the way the builder spells it. The registration helpers are one per
  signature and each states its own argument count, and that count is held against every call the
  vendor stored: 36 calls across seven codes, and each has to match.
* `model` - the branch tree out of the vendor's structure table. The top level of the area has to
  come back as the eight modules it is made of, Freedonia among them, and the whole tree has to
  satisfy its links: every branch's parent is a branch, one branch has no parent, and the
  chain never closes a cycle. The last data block states two live records and holds residue of
  five freed ones; it has to come back as the two branches its slot map marks.
  The scenario table is read as well, and its keys have to join to the tree: every branch a
  scenario row refers to is a branch of the structure table, the memos it points at are all in the
  file's blob blocks, and the first block numbers them one upwards. `heap` then reads the memo at
 that address, and the first seven rows have to come back as the numbers the file holds. The block
  states its own memo count, and all seven of its blocks read to it; a block whose records are cut
  short comes back short rather than invented, because the walk stops where it meets something that
  is not a record.
* `blobs` - every blob field joined to its heap memo, over the whole shipped area rather than
  the scenario table alone. All 550 heap blocks of the thirteen files that carry them read to
  the count they state, and all 4,547 non-zero blob references resolve. The kind byte states how
  a memo reads: 0 is empty, 3 is a counted short string (the trailing word counts the text,
  odd for narrow bytes and even for wide units), 4 is terminated text in the width its field
  states -- narrow for `nxtBlob` and `nxtBlobMemo`, wide for `nxtBlobWideMemo` -- and 5 is a
  segment directory of little-endian `u32` triples plus a NUL byte. The stated rule matches
  the old content guess on all but 142 memos: 50 five-unit counted texts the guess truncated,
  66 wide texts past ASCII (the expression argument separator and six trailing control
  bytes), and 26 binary triples that open with whitespace. Superseded memos keep kind and
  allocation with the first payload byte zeroed; no live row points at the 222 that carry
  the zero. Scenario rows come back as expressions that parse, info-page memos as paths,
  branch notes as RTF and HTML, while the two scenario expressions that point at directories
  come back as nothing.
* `nx1_records_typed` - the typed-row reader over the vendor's own dictionary bytes and one data
  block. The dictionary has to state a place for every field for the fields to tile a record with
  no gap, and that is the assertion; the record size then has to be the stride the bytes are
 written at, which is checked against 83 tables, and the block geometry has to reproduce every
  record base measured by hand, for every one of the 86 tables. The fuels fixture is the file's own
  pages, so its dictionary is read
  across the page seam, and all 45 fields have to tile. Refusal is the claim in three tests: a field
  moved by one byte, a descriptor unmarked so its field goes missing, and a class name planted inside
  stream data. The year list is the one table whose answer is knowable on its own, and it has to come
  out as exactly 2020..2050; a units block with a record deleted from its middle has to lose exactly
  that record; and every block's live rows have to number what its header states.
* `nx1_area_sweep` - the Rust dictionary reader over all 86 tables of the shipped area, straight
  out of the vendor zip, held field by field against the capture tool's layouts, and the slot map
  over all 2191 data blocks of the placed tables -- the five written in 8 KiB pages included, read
  in the page size their file states. It prints a note and passes when LEAP is not installed.
* `eval` - the evaluated subset, over the area's own expressions: the seven memo texts the
  scenario table's first block holds, through `heap` rather than as fixtures, plus the operators,
  `@F010`/`@F029`/`@F030`, and the growth family with the annualized cost and the baseline value
  through `resolve` -- Growth compounding a Current Accounts base year by year, Interp lerping and
  Step holding across series headed by that base value, GrowthAs following its reference variable,
  costs spread at the stated 5% discount rate, BaselineValue read in the baseline scenario.
  Golden tests hold stored expressions against hand arithmetic, and what the port cannot value --
  fuel properties, Remainder, YearlyShape, rows outside the area, a GrowthAs base that is one
  stray byte -- is asserted to come back `None`.
* `resolve` - what the remaining functions read, out of the vendor area: the years as the bounds of
  the year list (2020 to 2050, the base year the settings state), all 1,009 scenario rows resolved to
  the expressions they point at, the 17 constants as the molecular weights their names say, and the
  discount rate as areadata states it. `@V` references parse to branch, variable and selectors, with
  -99 reading the current region and scenario, and scenario inheritance is checked by reading a
  Current Accounts row through Baseline.
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
  Live records come from the block header's own used-slot map. What is not done is: the block
  geometry is settled -- a table's blocks are read in the page size its file states, 4096 bytes or
  the 8192 five tables use -- and so is the record size, the engine's own rule with a measured
  stride for the twenty-eight tables the rule does not reach, and every heap block area-wide --
  all 550 of the thirteen files that carry them -- reads to its stated memo count, with every
  blob field resolving to the memo or bytes it names. The variables, years and series the functions
  read now resolve -- `resolve` carries the years, the scenario expressions with inheritance, the
  constants and the discount rate -- and Growth, Interp, Step, GrowthAs and AnnualizedCost evaluate
  through `FUN_01be8250` and `FUN_01bbc620` against hand-arithmetic goldens. What is not done is the
  evaluation of everything else the area stores.

So the honest state is: one component ported and verified hard, and the model readable down to its
branch tree, its year list, its keys and, for the first block, its equations. The arithmetic parses,
every code in it is named, the address of the function that would evaluate it is known, the rows it
would read are where the dictionary says they are, and the shipped model's expressions now
come out as text -- 1,009 scenario memos and 2,067 TED environmental ones resolve, of which the
plain numbers parse and evaluate, except the two scenario rows whose memos are binary arrays. Of those, the ones that are plain numbers have values, and ten function codes are ported end to end:
plain arithmetic and `@F010`/`@F029`/`@F030`, the Growth/Interp/Step/GrowthAs family, the annualized
cost and BaselineValue, with stored-expression goldens holding each against hand arithmetic -- 861
of the 1,009 stored expressions evaluate at 2027. The rest of the codes the area stores -- the fuel
property references, Remainder and YearlyShape -- still read `None`, as do names and settings the
table holds alongside the arithmetic.

## Build and test

On this machine there is no Windows SDK, so MSVC cannot link. Type checking works on the
default toolchain, but tests need the user-local GNU one:

    cargo check --all-targets
    $env:RUSTFLAGS = '-C linker=rust-lld'
    & $env:USERPROFILE\.cargo\bin\cargo.exe +stable-x86_64-pc-windows-gnu test --target x86_64-pc-windows-gnu

`PORTING.md` has the policy, the scope limits, and the provenance of every vector.
