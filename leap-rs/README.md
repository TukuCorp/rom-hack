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

## How it is checked

Forty-one tests over nine suites, none of which assert against its own implementation:

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
* Through the files, which is permission-free and now mostly done. The dictionaries are
  plain text, so an area schema is readable; the record areas are plain UTF-16, so the fuel
  and branch names and, in the scenario table, the **model arithmetic itself** are readable
  too, and that arithmetic now parses into a tree. What is not done is turning those strings
  into typed rows and evaluating the tree: the field offsets inside a record come from the
  dictionary and have not been wired up yet. The codes in the tree are named, and each is tied
  to the address of the function that evaluates it, which is the list of what is left to port.

So the honest state is: one component ported and verified hard, and the model readable but not
yet evaluated. An expression parses, every code in it is named, and the address of the function
that would evaluate it is known; not one of them has a value.

## Build and test

On this machine there is no Windows SDK, so MSVC cannot link. Type checking works on the
default toolchain, but tests need the user-local GNU one:

    cargo check --all-targets
    $env:RUSTFLAGS = '-C linker=rust-lld'
    & $env:USERPROFILE\.cargo\bin\cargo.exe +stable-x86_64-pc-windows-gnu test --target x86_64-pc-windows-gnu

`PORTING.md` has the policy, the scope limits, and the provenance of every vector.
