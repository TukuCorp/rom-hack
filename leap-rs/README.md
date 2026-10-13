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

## How it is checked

Seventeen tests over five suites, none of which assert against its own implementation:

* `calendar_parity` - 310 leap-year and 487 day-number vectors captured by emulating the
  original, floats compared as raw IEEE-754 bits.
* `container_parity` - 130 real archives across four output modes, exit code and the whole of
  stdout compared byte for byte, which is 520 whole-process comparisons.
* `deflate_parity` - 12 zlib streams against the crate inflater, covering stored blocks and
  back-references out to 32000 bytes.
* `run_parity` - 14 argument lists against the argument loop, including the `-1` verdicts.
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
* Through the files, which is permission-free, and which is two halves. The table
  **dictionaries are plain text**, so the schema of an area, which tables it holds and which
  fields and indexes each carries, is readable today with no cipher work. The table
  **records** are transformed: a small plain-text header per block, then a payload behind a
  Blowfish and RC4 hybrid whose round functions and key schedule have been verified against
  the published vectors but whose block framing is not yet pinned.

So the honest state is: one component ported and verified hard, and the model waiting on a
licence or on several more turns of format work.

## Build and test

On this machine there is no Windows SDK, so MSVC cannot link. Type checking works on the
default toolchain, but tests need the user-local GNU one:

    cargo check --all-targets
    $env:RUSTFLAGS = '-C linker=rust-lld'
    & $env:USERPROFILE\.cargo\bin\cargo.exe +stable-x86_64-pc-windows-gnu test --target x86_64-pc-windows-gnu

`PORTING.md` has the policy, the scope limits, and the provenance of every vector.
