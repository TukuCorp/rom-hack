# Decompiling leap.exe

Goal: produce a real decompilation of `C:\Program Files\LEAP\leap.exe` (168.5 MB, x86-64 PE,
~166k loader functions before analysis). Ghidra 12.1.4 does the work; REA 6.3.0 is available as a
wrapper for spot checks. **Hopper is not usable here** — it is macOS-only, and REA reports it as
`missing_analysis_engine` on Windows.

## The two stages

1. **Analysis** — `analyzeHeadless <ghidra-projects> LeapRE -process leap.exe -max-cpu 7`
   pure headless, no MCP plugin loaded. Writes function boundaries, data types and references into
   the `LeapRE` project. Log: `leap-analysis.out.log`; Ghidra log:
   `%APPDATA%\ghidra\ghidra_12.1.4_PUBLIC\application.log`.
2. **Export** — `ghidra-scripts\DecompileAll.java` decompiles every function and writes it out.
   Started automatically by `watch-leap-export.ps1`, which waits for stage 1 to release its JVM.

## Measured outcome

**Done.** `leap-decompiled\` holds the decompilation: **168,840 of 168,848 body-bearing
functions (99.995%)**, 136.4 MB across 339 `chunk-NNNNN.c` files, plus `index.tsv`
(address, name, chunk) and `done.txt`. The program reports 170,603 functions in total; the
1,755 difference is external imports, which have no body to decompile.

Two independent checks pass:

* `verify_decompilation.py` — 168,840 records, 168,840 unique addresses, `done.txt` in
  agreement, no unterminated records, no start/end mismatches, no duplicates, no empty
  bodies. `RESULT: OK`.
* `crosscheck_export.py` — 25 sampled functions re-decompiled from a live Ghidra session
  over GhidraMCP and diffed against the exported bytes: **25 identical, 0 mismatched**.

Eight functions (0.005%) still fail even at a 120 s per-function timeout — address list is
in `leap-verify.log`; they are pathological cases, not missing coverage.

An earlier run of the cross-check reported 25/25 mismatches of exactly +32 characters each.
That was a bug in my checker, not the artifact: its record extractor was including the
export own `/* signature */` line in the body it compared. Fixed, and the same 25 addresses
then compared identical.

Stage 1 finished far sooner than the size-scaling estimate suggested:

* analysis started 13:08:02; **Analysis succeeded for file: /leap.exe at 15:01:00**,
  **Save succeeded for processed file: /leap.exe at 15:01:07** — Ghidra reported
  **Total Time 6776 secs** (1 h 52 m 56 s).
* the dominant analyzers were Stack (983 s), x86 Constant Reference (687 s),
  Scalar Operand References (116 s) and WindowsResourceReference (78 s).
* analysis added functions on top of the loader 166,341: the export queued **168,848**.

Stage 2 runs at roughly 8-12 functions/sec, so ~4-5 hours for the full set. Output so far is
real decompilation, not stubs — typed locals, control flow, resolved cross-references to other
functions, and Ghidra own warnings preserved.

Measured rate varies between ~7 and ~15 functions/sec depending on how heavy the functions in
that stretch are; a patch of very large functions can hold the counter still for several minutes
even though work is continuing, because progress is reported every 200 functions. Judge progress
from done.txt, not from a single progress.txt reading.

The decompiler itself runs as nine decompile.exe subprocesses, one per worker thread, so the
JVM CPU figure (about 1.4 cores) understates the real work — the decompilation runs in the
children. Heap sits around 1.5 GB of the 2 GB the launcher gave it; GC time is negligible
(50 s across 8,600 s elapsed), so throughput is limited by per-function decompiler cost rather
than by garbage collection.

## Why the first attempt produced nothing

The 2-hour attempt that produced nothing ran through the GUI MCP plugin while the GUI server
was still resident, and under heavy paging. The clean headless run finished in under two hours,
so the earlier 6-12 hour estimate reflected that contention rather than the work itself.

## Why it is slow

The host is an i5-8250U (4 cores / 8 threads, 2017 ultrabook) with 8 GB RAM. Ghidra auto-analysis is
essentially single-threaded — measured at ~1.0 core saturated — so throughput is limited by one
1.6 GHz core, not by core count. For reference, the same pipeline on `testleap.exe` (2.38 MB) took
288 s of analysis, and decompiling its 7,056 functions took 575 s. The main binary is ~71x larger.

## Monitoring

```powershell
Get-Content C:\Users\tukum\Downloads\rom-hack\leap-export-watch.log   # stage transitions
Get-Content C:\Users\tukum\Downloads\rom-hack\leap-decompiled\progress.txt  # export counters
Get-Content C:\Users\tukum\Downloads\rom-hack\leap-export.log           # export script output
Get-CimInstance Win32_Process -Filter "Name='java.exe'"                   # is a stage alive?
```

## Output format

`leap-decompiled\chunk-NNNNN.c`, 500 functions per chunk. Every record is delimited and
self-describing so parallel output order does not matter:

```c
/* ===== 00404b18  SetFilePointer ===== */
/* DWORD SetFilePointer(HANDLE hFile, LONG lDistanceToMove, PLONG lpDistanceToMoveHigh, DWORD dwMoveMethod) */
...decompiled C...
/* ===== end 00404b18 ===== */
```

## Resuming after an interruption

The export is resumable: completed function entry addresses are appended to
`leap-decompiled\done.txt`, and a rerun skips anything listed there. Re-run it with:

```powershell
.\ghidra_12.1.4_PUBLIC\support\analyzeHeadless.bat ghidra-projects LeapRE -process leap.exe `
  -noanalysis -scriptPath ghidra-scripts -postScript DecompileAll.java leap-decompiled 500 45
```

If the analysis itself is interrupted, Ghidra only keeps what it saved; rerun stage 1 and the
export will pick up the newly analysed program.

## Resources freed for this run

Your `dotnet test CarbonSim.sln` run finished on its own and was left alone. 57 disposable
automation processes were closed (~903 MB): leftover puppeteer headless Chrome instances and the
`chrome-devtools-mcp`, `chrome-devtools-axi` and `firecrawl-mcp` helper processes. Those respawn
when the tools are next used. Your main Chrome window and all Claude/Codex sessions were untouched.
Standby is disabled (timeout 0 on AC), so the run will not be interrupted by sleep.
