#!/usr/bin/env bash
# Calculate each case-study area from an unpacked copy with every regression and results file
# removed, and hold the claimed variables to LEAP's definitive results. Run from the repo root.
set -euo pipefail
LEAP="C:/Program Files/LEAP"
ROOT="$(pwd)"
export RUSTFLAGS='-C linker=rust-lld'
export CARGO_TARGET_DIR="$ROOT/.verify/checks/probe/target"
~/.cargo/bin/cargo.exe +stable-x86_64-pc-windows-gnu build --release --target x86_64-pc-windows-gnu \
  --manifest-path "$ROOT/.verify/checks/probe/Cargo.toml" 2>&1 | tail -n 3
PROBE="$CARGO_TARGET_DIR/x86_64-pc-windows-gnu/release/verify-probe.exe"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
status=0
for area in "Freedonia" "Transport Exercise"; do
  test -f "$LEAP/$area.zip" || { echo "FAIL: $LEAP/$area.zip missing"; exit 1; }
  unzip -q "$LEAP/$area.zip" -d "$TMP/x"
  dir="$TMP/x/$area"
  removed=$(find "$dir" -iname '*regression*' -o -iname 'results.nx1' -o -iname 'writtenresults.nx1' \
    -o -iname 'aggresultscache.nx1' -o -iname 'envresults.nx1' | wc -l)
  rm -rf "$dir/_RegressionTests"
  find "$dir" \( -iname '*regression*' -o -iname 'results.nx1' -o -iname 'writtenresults.nx1' \
    -o -iname 'aggresultscache.nx1' -o -iname 'envresults.nx1' \) -exec rm -rf {} +
  echo "$area: removed $removed regression/results entries from the inputs"
  "$PROBE" calc "$dir" "$LEAP/$area.zip" "$LEAP/_dictionaryNX.zip" "$area" || status=1
  rm -rf "$TMP/x"
done
exit $status
