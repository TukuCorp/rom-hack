# Unblock runbook: Emerald town + route hack

Preconditions: `emerald-decomp/baserom.gba` (clean US Emerald, sha1 = `rom.sha1`),
WSL1 Ubuntu with `arm-none-eabi-gcc`, `make`, `git`. Tree is clean and current.

All commands run inside WSL at the `emerald-decomp/` root unless noted.

## 1. Baseline build (do not skip)

```sh
cp /path/to/clean_US_Emerald.gba baserom.gba
sha1sum baserom.gba   # must match rom.sha1: f3ae088181bf583e55daf962a92bb46f4f1d07b7
make check -j$(nproc)   # expect: byte-identical pokeemerald.gba
```
Commit/tag this state: `git tag baseline-clean`.

## 2. Apply dialogue drafts (zero logic changes)

For each pair, replace ONLY the matching labeled block in the target,
keeping every label, flag, var, and branch:

- `../emerald-town-route/draft/town_dialogs.inc` ->
  `data/maps/LittlerootTown/scripts.inc` (5 text blocks)
- `../emerald-town-route/draft/route_dialogs.inc` ->
  `data/maps/Route101/scripts.inc` (3 text blocks)
- `../emerald-town-route/draft/wild_route101.json` -> `land_mons` of the
  `MAP_ROUTE101` entry in `src/data/wild_encounters.json`
- `../emerald-town-route/draft/env_names.json` -> the two `MAPSEC_*` blocks
  in `src/data/region_map/region_map_sections.json`

```sh
make check -j$(nproc)   # must still pass: text/data-only changes rebuild fine
```

## 3. Lab + cast swaps (draft/cast_and_lab_swaps.md)

`.string` bodies only, nine labeled blocks. Rebuild + `make check`.
Any new mismatch vs baseline must trace to exactly these strings.

## 4. Playtest in mGBA (Windows: `../emerald-town-route/tools/mgba/…/mGBA.exe`)

Load `pokeemerald.gba`, new save, verify in order:
1. Title -> truck -> house -> mom dialogue.
2. Town: MARO / TUAN / LINA talks, town + lab signs read Emberleaf/Palm.
3. Lab: Palm handoff text, starter received, go-see-Kai prompt.
4. Route 101: REY + boy talks, Coral Path sign, wild Wurmple/Poochyena/Zigzagoon/Taillow.
5. Map-name popups: EMBERLEAF TOWN / ROUTE 101 CORAL PATH.
Screenshot each beat; log deviations against this list.

## 5. Graphics phase (draft/graphics_pipeline.md)

Palm sprite -> Kai sprite -> Porymap building/tiles. Rebuild + replay beats 2-4
after each addition.

## 6. Ship

Distribute a `.ups` patch against clean US Emerald (never the ROM).
Keep `baseline-clean` tag so anyone can diff hack vs vanilla.

