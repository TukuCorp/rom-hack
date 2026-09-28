# Emberleaf on Emerald — first town + route hack plan

Approach: pret `pokeemerald` decomp (cloned at `emerald-decomp/`), per the community guide.
Edit in place; verify with `make check` (sha1-identical build) before and after changes.

## 0. Prerequisites (blocking)

- `emerald-decomp/baserom.gba`: clean US Emerald dump (sha1 must match `rom.sha1`).
- WSL1 + Ubuntu + `arm-none-eabi-gcc`, `make`, `git` (see `emerald-decomp/INSTALL.md`).
- Porymap (Windows GUI) for visual map editing; mGBA for playtesting.
 - Porymap 6.3.1 (Windows GUI, staged at `tools/porymap/porymap.exe`) for visual map editing;
  mGBA 0.10.5 (extracted at `tools/mgba/mGBA-0.10.5-win64/`, archive-tested)
  for playtesting; `tools/7zr.exe` kept for future archives.

## 1. Baseline

- `make check` on a clean tree → byte-identical `pokeemerald.gba`. Commit that state.

## 2. First town (reskin LittlerootTown)

- `data/maps/LittlerootTown/map.json`: new layout blocks (new buildings), object_events
  (new cast: Prof. Palm, rival Kai, townsfolk), warp_events (lab/house doors),
  bg_events (town/lab signs). Keep `MAP_ROUTE101` connection.
- `data/maps/LittlerootTown/scripts.inc`: Palm intro, starter handoff, Kai battle trigger,
  sign texts. New strings need text + electrify into `data/` string tables as needed.
- New building tiles: `graphics/` tileset edits via Porymap; new NPC sprites via
  `graphics/object_events/` (64x64 limit).

## 3. First route (Route101)

- `data/maps/Route101/map.json`: coral-sand band blocks, sign, connection back to town.
- `data/maps/Route101/scripts.inc`: route sign + tutorial + Birch-save replacement beat.
- Wild encounters: map's encounter tables (`data/wild_encounters.json` route entry).

## 4. Verify

- `make` → `pokeemerald.gba`; play in mGBA: title → town → lab → starter → Kai →
  route encounters → Petalport-side gate. Screenshot each beat.
- Distribute as `.ups` patch against clean Emerald, never the ROM.
