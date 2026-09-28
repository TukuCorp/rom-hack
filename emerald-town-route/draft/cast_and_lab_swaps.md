# Cast + lab swaps (phase 2, apply only after `make check` passes)

These touch story logic or graphics, so they wait for a verified build.

## PROF. BIRCH -> PROF. PALM (text-only, low risk)

- In `data/maps/LittlerootTownProfessorBirchsLab/scripts.inc` and
  `data/maps/Route101/scripts.inc`: inside `.string` lines ONLY, replace
  `BIRCH` with `PALM` in dialogue (e.g. `PROF. BIRCH:` -> `PROF. PALM:`).
- NEVER rename script/macro labels (`Route101_EventScript_*`, `LOCALID_*`,
  `FLAG_*`, `VAR_*`) — logic references them across files.
- Map/region names (`MAPSEC_LITTLEROOT_TOWN`, music `MUS_LITTLEROOT`) stay
  until Porymap renames are verified in-game.

## Rival -> KAI (medium risk, needs playtest)

- Intro/rival scripts reference Brendan/May objects, naming screen, and
  gender branches. Rename dialogue first, playtest the full intro,
  then swap overworld graphics.

## New NPC/building sprites (needs graphics pipeline)

- New 64x64 overworld sprites go in `graphics/object_events/` with new
  `OBJ_EVENT_GFX_*` ids; new building tiles via Porymap tileset edits.
- Apply after the dialogue-only build plays start-to-rival cleanly.

## Exact text-label swap list (this turn's finding)

Lab (`LittlerootTown_ProfessorBirchsLab/scripts.inc`), `.string` bodies only:
- `..._Text_LikeYouToHavePokemon` -> Palm voice giving the starter
- `..._Text_MightBeGoodIdeaToGoSeeRival` -> go see KAI
- `..._Text_MayWhereShouldIGoNext` + `..._Text_BrendanWhereShouldIGoNext`
  -> KAI's lab talk (keep both gender branches, same meaning)
- `..._Text_SeriousLookingMachine` -> solar-array flavor
Route (`Route101/scripts.inc`), `.string` bodies only:
- `Route101_Text_HelpMe`, `Route101_Text_PleaseHelp`,
  `Route101_Text_YouSavedMe`, `Route101_Text_DontLeaveMe` -> PALM chased
  by the Zigzagoon (same beats, name swap only)
Do NOT touch: any `EventScript_*`/`LOCALID_*`/`FLAG_*`/`VAR_*` label,
  `VAR_BIRCH_LAB_STATE` flow, `checkplayergender` branches.
KAI's first battle = Route 103 rival scripts + team in
`src/data/trainer_parties.h` (text swap first, team edit at playtest).
Palm/Birch overworld sprite (`OBJ_EVENT_GFX_PROF_BIRCH`) swap waits for
the graphics pipeline (phase 2).
