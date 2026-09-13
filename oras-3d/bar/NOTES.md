# ORAS 3D Battle — Visual Bar (Bulbapedia / Bulbagarden Archives)

Reference captures for comparison only. Not assets to ship — the demo must use original art. All images are official ORAS 3DS screenshots hosted on Bulbagarden Archives (the media repository behind Bulbapedia) under game-screenshot fair use.

Saved to `oras-3d/bar/` on 2026-09-13. All files are original-resolution PNGs (no downscale, no re-encode).

## Files

| # | File | Depicted scene | Category | Source page URL | Direct original image URL | Native resolution | Notes |
|---|---|---|---|---|---|---|---|
| 1 | `Battle_interface_hail_ORAS.png` | Standard 3D trainer battle in hail weather — full dual-screen capture (top 3D battlefield + bottom battle UI with HP bars / move prompts). Representative of a standard trainer/rival battle in ORAS. | Standard trainer/rival battle | https://archives.bulbagarden.net/wiki/File:Battle_interface_hail_ORAS.png (mirror: https://bulbapedia.bulbagarden.net/wiki/File:Battle_interface_hail_ORAS.png) | https://archives.bulbagarden.net/media/upload/8/85/Battle_interface_hail_ORAS.png | 1080 x 812 | High-res composite of both 3DS screens; hail particle overlay visible; used on Bulbapedia Weather/Hail pages. Category: Pokemon Omega Ruby and Alpha Sapphire screenshots. |
| 2 | `Battle_interface_rain_ORAS.png` | Standard 3D battle in normal rain — same dual-screen layout as above with rain weather overlay. Complements (1) and shows the default rain variant before Primal heavy rain. | Standard trainer / weather battle | https://archives.bulbagarden.net/wiki/File:Battle_interface_rain_ORAS.png | https://archives.bulbagarden.net/media/upload/6/6b/Battle_interface_rain_ORAS.png | 1080 x 811 | Pair with (1) to compare weather rendering; rain is Kyogre-adjacent but not yet Primordial Sea. |
| 3 | `Extremely_harsh_sunlight_battle_interface_ORAS.png` | Primal Groudon signature weather — battle interface during **extremely harsh sunlight** (Desolate Land ability). Top-screen 3D battle capture showing the `The sunlight is extremely harsh!` banner. Exclusive to Primal Groudon in ORAS. | Primal Groudon (Primal vs. Primal pair) | https://archives.bulbagarden.net/wiki/File:Extremely_harsh_sunlight_battle_interface_ORAS.png | https://archives.bulbagarden.net/media/upload/7/7b/Extremely_harsh_sunlight_battle_interface_ORAS.png | 320 x 240 | Native 3DS top-screen resolution; together with (4) satisfies the `Primal Groudon vs Primal Kyogre` requirement (the two Primordial weathers are mutually exclusive and define the Primal clash). |
| 4 | `Heavy_rain_battle_interface_ORAS.png` | Primal Kyogre signature weather — battle interface during **heavy rain** (Primordial Sea ability). Top-screen 3D battle capture showing the heavy-rain banner/state. Exclusive to Primal Kyogre in ORAS. | Primal Kyogre (Primal vs. Primal pair) | https://archives.bulbagarden.net/wiki/File:Heavy_rain_battle_interface_ORAS.png | https://archives.bulbagarden.net/media/upload/a/a1/Heavy_rain_battle_interface_ORAS.png | 320 x 240 | Native 3DS top-screen resolution; see note for (3). Also available as wide field variant `Heavy_rain_Field_ORAS.png` (1809x1080) in same category if a field shot is needed. |
| 5 | `ORAS_battle_move.png` | Gym-leader / wild-battle move-selection UI — 3D battle screen showing the four-move selection panel (bottom-screen UI overlaid on top-screen field). Generic enough for any single-battle archetype and useful as a baseline for layout/margin comparison. | Gym-leader or wild-battle scene | https://archives.bulbagarden.net/wiki/File:ORAS_battle_move.png | https://archives.bulbagarden.net/media/upload/1/15/ORAS_battle_move.png | 320 x 240 | Native 3DS resolution; companion files `ORAS_battle_move_desc.png` and `ORAS_battle_summary.png` exist in same category for extended UI. |

## How the contract is satisfied

- **One standard trainer/rival battle scene:** File (1) `Battle_interface_hail_ORAS.png` (and (2) as supporting variant) — full 3D trainer-perspective battle with dual-screen UI.
- **One Primal Groudon vs Primal Kyogre scene if available:** Files (3) + (4) — the two Primal-exclusive primordial weathers. Archives does not host a single composite `Groudon vs Kyogre` battle screenshot, but these two are the canonical Primal battle visuals in ORAS and together represent the Primal clash; they are the closest available official captures.
- **One gym-leader or wild-battle scene:** File (5) `ORAS_battle_move.png` — in-battle move list applicable to any gym-leader, wild, or trainer encounter; shows depth-of-field and 3D model framing used across all battle types.

## Provenance & licensing

- Repository: Bulbagarden Archives — `Category:Pokemon Omega Ruby and Alpha Sapphire screenshots` (https://archives.bulbagarden.net/wiki/Category:Pok%C3%A9mon_Omega_Ruby_and_Alpha_Sapphire_screenshots) — 31 files at time of fetch.
- All File: pages are `Game screenshot / Game fair use` licensed; contributor asserts fair use.
- Fetch method: `curl -L` of the `media/upload/...` original (not the `thumb/` preview). Verified PNG magic bytes `89 50 4E 47` and dimensions via System.Drawing on 2026-09-13.
- Bulbapedia gallery pages that transclude these files: `Weather` (https://bulbapedia.bulbagarden.net/wiki/Weather), `Hail (weather condition)`, `Rain`, `Hail` etc. For canonical Bulbapedia file mirrors, replace `archives.bulbagarden.net` with `bulbapedia.bulbagarden.net/wiki/File:`.

## Re-creation

```powershell
mkdir -Force oras-3d/bar
curl.exe -L -o oras-3d/bar/Battle_interface_hail_ORAS.png https://archives.bulbagarden.net/media/upload/8/85/Battle_interface_hail_ORAS.png
curl.exe -L -o oras-3d/bar/Battle_interface_rain_ORAS.png https://archives.bulbagarden.net/media/upload/6/6b/Battle_interface_rain_ORAS.png
curl.exe -L -o oras-3d/bar/Extremely_harsh_sunlight_battle_interface_ORAS.png https://archives.bulbagarden.net/media/upload/7/7b/Extremely_harsh_sunlight_battle_interface_ORAS.png
curl.exe -L -o oras-3d/bar/Heavy_rain_battle_interface_ORAS.png https://archives.bulbagarden.net/media/upload/a/a1/Heavy_rain_battle_interface_ORAS.png
curl.exe -L -o oras-3d/bar/ORAS_battle_move.png https://archives.bulbagarden.net/media/upload/1/15/ORAS_battle_move.png
```

---
*Do not copy these captures into the demo — they are visual-bar references only.*

## Additional top-screen 3D battle captures (follow-up — no bottom touch UI)

Gap fix: the initial 5 files all contain the bottom-screen 2D touch UI (FIGHT/BAG/RUN/POKEMON starburst); none isolated the top-screen 3D arena. The 3 files below are top-screen captures with 3D Pokemon models on terrain, low battle camera, arena floor/skybox and VFX visible, and no dominant FIGHT UI — per follow-up leads.

| # | File | Depicted scene | Category | Source page URL | Direct original image URL | Native resolution | Notes |
|---|---|---|---|---|---|---|---|
| 6 | `Heavy_rain_Field_ORAS.png` | Wide 3D field with heavy rain weather — overworld/battle-field terrain rendered in 3D with rain particles and horizon, heavy-rain Primal Kyogre weather visible on ground and sky (no bottom touch UI). Lead-requested wide variant. | Top-screen 3D terrain / Primordial Sea field (lead) | https://archives.bulbagarden.net/wiki/File:Heavy_rain_Field_ORAS.png | https://archives.bulbagarden.net/media/upload/7/75/Heavy_rain_Field_ORAS.png | 1809 x 1080 | Category: Pokemon Omega Ruby and Alpha Sapphire screenshots; same heavy-rain system as battle, but shows full 3D environment at high-res composite. Original verified 89 50 4E 47 PNG, 1165014 bytes. |
| 7 | `Dragon_Pulse_ORAS.png` | Top-screen 3D battle arena — Mega Altaria (and opponent) on textured arena floor firing Dragon Pulse beam, low battle camera, arena terrain and skybox, move VFX trail. No bottom-screen FIGHT UI; pure top-screen model-on-terrain shot. | Top-screen 3D battle model-on-terrain (ORAS-specific) | https://archives.bulbagarden.net/wiki/File:Dragon_Pulse_ORAS.png | https://archives.bulbagarden.net/media/upload/d/d4/Dragon_Pulse_ORAS.png | 400 x 240 | Category: Moves (Generation VI) — ORAS-specific capture (Mega Altaria); native 3DS top-screen resolution; fair-use game screenshot. Verified 89 50 4E 47 PNG, 188 KB. Used on Bulbapedia Dragon Pulse (move) page. |
| 8 | `Freeze_VI.png` | Top-screen 3D battle arena with status — Tyrantrum encased in freeze ice blocks on arena floor vs Greninja, ice shard VFX, 3D models casting shadows on ground, low camera. Shows status ailment rendering on 3D model without touch UI overlay. | Top-screen 3D battle status model-on-terrain | https://archives.bulbagarden.net/wiki/File:Freeze_VI.png | https://archives.bulbagarden.net/media/upload/8/8f/Freeze_VI.png | 734 x 432 | Category: Pokemon Omega Ruby and Alpha Sapphire screenshots + Status ailments; flagged on Archives as "Recapture with HANS" (unsatisfactory) but still native-rendered top-screen battle model with terrain; fair-use. Verified 89 50 4E 47 PNG, 390 KB. Used on Bulbapedia Freeze (status condition). |

**Primary 3D-scene bar: Dragon_Pulse_ORAS.png (initial) — SUPERSEDED 2026-09-13 per Main: primary is now Freeze_VI.png 734x432 (glossy teal arena + glowing rings + wall arches; low behind-player camera).

### Re-creation (new files)

```powershell
curl.exe -L -o oras-3d/bar/Heavy_rain_Field_ORAS.png https://archives.bulbagarden.net/media/upload/7/75/Heavy_rain_Field_ORAS.png
curl.exe -L -o oras-3d/bar/Dragon_Pulse_ORAS.png https://archives.bulbagarden.net/media/upload/d/d4/Dragon_Pulse_ORAS.png
curl.exe -L -o oras-3d/bar/Freeze_VI.png https://archives.bulbagarden.net/media/upload/8/8f/Freeze_VI.png
# verify: PNG magic 89 50 4E 47 + System.Drawing dimensions as above
```


