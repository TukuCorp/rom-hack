# Sun & Moon Battle — Visual Bar (Bulbagarden Archives)

Reference captures for comparison only. **Not assets to ship** — the demo uses original code and original procedural art.
All images are official Pokémon Sun/Moon (Gen VII) 3DS screenshots hosted on Bulbagarden Archives (media repo behind Bulbapedia) under game-screenshot fair use.

Saved to `sunmoon/bar/` on 2026-09-16. Originals downloaded via `media/upload/...` (never the `thumb/` preview); PNG magic + dimensions verified.

## Files

| # | File | Depicted scene | What it fixes for the build | Source | Native res |
|---|---|---|---|---|---|
| 1 | `Ember_VII.png` | Gen VII top-screen battle, Ember hitting a Trubbish on an Alola-style route | **Foe HP plate = top-RIGHT**, dark translucent rounded plate, white bold name, `Lv##` chip, rounded green HP bar with a Poké Ball badge at the right end. Ground: bright Alola grass + roadside props. | https://archives.bulbagarden.net/wiki/File:Ember_VII.png | 400x240 |
| 2 | `Multi_Battle_VII.png` | Gen VII bottom-screen dialogue during a multi battle (Red & Blue, "You are challenged by…") | Message = bottom screen, blue-black gradient bar, white text, bottom-left of the bottom screen, portrait sprites above it. | https://archives.bulbagarden.net/wiki/File:Multi_Battle_VII.png | 400x240 |
| 3 | `SM_Prerelease_SOS_Battle.png` | Gen VII top screen, "Yungoos appeared!" | Wild-encounter framing: foe right of centre + low camera on a rocky/grassy Alola field. | https://archives.bulbagarden.net/wiki/File:SM_Prerelease_SOS_Battle.png | 400x240 |
| 4 | `Battle_interface_harsh_sunlight_SM.png` | Gen VII **bottom screen** command UI in harsh sunlight | The signature Gen VII command plates: cream/tan rounded container; four tilted rounded-square plates — green `POKéMON`, gold `BAG`, red `FIGHT` (largest, right), blue `RUN` — each with a big Poké Ball emblem on top and a white bold label at the bottom; red `▶` cursor on the selected plate; centre shows the arena/trainer map; weather chip top-right. | https://archives.bulbagarden.net/wiki/File:Battle_interface_harsh_sunlight_SM.png | 320x240 |
| 5 | `Battle_interface_rain_SM.png` | Same bottom-screen UI in rain | Non-Battle-Royal variant: same four plates, blue rain tint, `Y` chip top-left, weather cloud chip. | https://archives.bulbagarden.net/wiki/File:Battle_interface_rain_SM.png | 320x240 |
| 6 | `Battle_interface_hail_SM.png` | Same bottom-screen UI in hail | Weather tri-check on the bottom-screen container. | https://archives.bulbagarden.net/wiki/File:Battle_interface_hail_SM.png | 320x240 |
| 7 | `Dragon_Hammer_VII.png` | Alolan Exeggutor in battle (Dragon Hammer) | **Alolan Exeggutor model bar**: pale cream ring-segmented trunk of huge diameter, long arcing neck, fan of broad green fronds, head cluster at the top; body leaves the top of frame because the species is 10.9 m tall. Route/canyon backdrop with tall grass. | https://archives.bulbagarden.net/wiki/File:Dragon_Hammer_VII.png | 400x240 |
| 8 | `Barrage_VII.png` | Alolan Exeggutor using Barrage | Second Exeggutor reference (head/frond read at distance). | https://archives.bulbagarden.net/wiki/File:Barrage_VII.png | 400x240 |
| 9 | `Inferno_Overdrive_VII.png` | Z-Move **Inferno Overdrive** impact | Z-Move cinematic: whole frame becomes fire — orange fireball at left, ember flecks, black vignette, no UI. | https://archives.bulbagarden.net/wiki/File:Inferno_Overdrive_VII.png | 400x240 |
| 10 | `Inferno_Overdrive_VII_2.png` | Z-Move aftermath | Silhouetted user low in frame against a fire-orange sky with dark ridge line — the "after the blast" composition. | https://archives.bulbagarden.net/wiki/File:Inferno_Overdrive_VII_2.png | 400x240 |
| 11 | `Inferno_Overdrive_VII_Pose.png` | Trainer Z-pose cutscene | Z-Move pose cutscene: trainer centred on a bright blue/teal burst backdrop with radial yellow power slashes; UI-free. | https://archives.bulbagarden.net/wiki/File:Inferno_Overdrive_VII_Pose.png | 400x240 |
| 12 | `SM_Prerelease_Rock_Z-Move_2.png` | Z-Move cinematic, press capture | Cinematic scale of Z-Moves: the attack fills the sky (giant rock overhead, dust pillars, silhouette below). | https://archives.bulbagarden.net/wiki/File:SM_Prerelease_Rock_Z-Move_2.png | 1280x720 |
| 13 | `Freeze_VII.png` | Gen VII battler-on-terrain, status condition | Low behind-user camera, battlers on textured terrain with contact shadows — the framing our 3D scene must match. | https://archives.bulbagarden.net/wiki/File:Freeze_VII.png | 822x440 |
| 14 | `SM_Prerelease_menu.png` | Prerelease SM menu capture | Bottom-screen container colour/material reference (cream, soft rounded, dark navy text). | https://archives.bulbagarden.net/wiki/File:SM_Prerelease_menu.png | 1172x935 |

## Layout facts the demo must honour (from the captures + Gen VII behaviour)

1. **Dual screen.** Top screen: 3D field + battlers + both HP plates. Bottom screen: message text and all menus. (Gen VII top screen is 400x240 at 5:3; bottom is 320x240 at 4:3.)
2. **Foe plate top-right**, **player plate bottom-left** (Gen VII mirrored Gen VI's sides). Player plate adds current/max HP numbers and the cyan EXP bar.
3. **Bottom-screen command plates**: cream container, four tilted rounded plates — green `POKéMON`, gold `BAG`, red `FIGHT`, blue `RUN` — Poké Ball emblem above each label, red `▶` cursor.
4. **Z-Moves are full-frame cinematics** with the arena/UI stripped away (see 9/10/11).

## Re-creation

```powershell
cd sunmoon/bar
curl.exe -sL -o Ember_VII.png https://archives.bulbagarden.net/media/upload/0/00/Ember_VII.png
curl.exe -sL -o Multi_Battle_VII.png https://archives.bulbagarden.net/media/upload/0/09/Multi_Battle_VII.png
curl.exe -sL -o SM_Prerelease_SOS_Battle.png https://archives.bulbagarden.net/media/upload/0/09/SM_Prerelease_SOS_Battle.png
curl.exe -sL -o Battle_interface_harsh_sunlight_SM.png https://archives.bulbagarden.net/media/upload/7/74/Harsh_sunlight_battle_interface_SM.png
curl.exe -sL -o Battle_interface_rain_SM.png https://archives.bulbagarden.net/media/upload/1/1d/Rain_battle_interface_SM.png
curl.exe -sL -o Battle_interface_hail_SM.png https://archives.bulbagarden.net/media/upload/d/d8/Hail_battle_interface_SM.png
curl.exe -sL -o Dragon_Hammer_VII.png https://archives.bulbagarden.net/media/upload/b/bc/Dragon_Hammer_VII.png
curl.exe -sL -o Barrage_VII.png https://archives.bulbagarden.net/media/upload/4/43/Barrage_VII.png
curl.exe -sL -o Inferno_Overdrive_VII.png https://archives.bulbagarden.net/media/upload/6/64/Inferno_Overdrive_VII.png
curl.exe -sL -o Inferno_Overdrive_VII_2.png https://archives.bulbagarden.net/media/upload/0/06/Inferno_Overdrive_VII_2.png
curl.exe -sL -o Inferno_Overdrive_VII_Pose.png https://archives.bulbagarden.net/media/upload/7/79/Inferno_Overdrive_VII_Pose.png
curl.exe -sL -o SM_Prerelease_Rock_Z-Move_2.png https://archives.bulbagarden.net/media/upload/6/62/SM_Prerelease_Rock_Z-Move_2.png
curl.exe -sL -o Freeze_VII.png https://archives.bulbagarden.net/media/upload/4/49/Freeze_VII.png
curl.exe -sL -o SM_Prerelease_menu.png https://archives.bulbagarden.net/media/upload/4/42/SM_Prerelease_menu.png
```

## Species references (added 2026-09-16 — canon check, reference only)

The Gen VII captures above never show our two battlers, so species fidelity could not be judged from them. These three official references settle anatomy, markings and palette. **Reference only — do not ship, trace or embed.**

| File | What it fixes | Source | Native res |
|---|---|---|---|
| `HOME_Litten.png` | Litten's 3D model: charcoal (not jet-black) body; **red face mask** — a red brow bar with a down-the-face stripe and a cross piece; two red cheek-fur spikes each side; **banded red/black front legs**, plain black hind legs; large yellow eyes, black slit pupils, red upper lids; pointed black ears with pale inner fur; **tail ends in a 3-pointed BLACK FUR TUFT, not a flame**; small red nose/muzzle. | https://archives.bulbagarden.net/wiki/File:HOME0725.png | 512x512 |
| `HOME_Alolan_Exeggutor.png` | Alolan Exeggutor's model: fat bulbous **brown** base tapering into a long ring-segmented **brown** neck (cream/pale trunk is wrong); head cluster of **three cream coconut heads** with dot eyes and open mouths; a fan of thin spiky **green palm fronds** radiating from the crown; a fourth small head on a short rear stub; three pale claws at the base of the trunk. | https://archives.bulbagarden.net/wiki/File:HOME0103A.png | 512x512 |
| `Official_Artwork_Litten.png` | Litten's official 2D artwork — marking shapes and proportions at high resolution (2250x2250). | https://archives.bulbagarden.net/wiki/File:0725Litten.png | 2250x2250 |

```powershell
curl.exe -sL -o HOME_Litten.png https://archives.bulbagarden.net/media/upload/a/a9/HOME0725.png
curl.exe -sL -o HOME_Alolan_Exeggutor.png https://archives.bulbagarden.net/media/upload/c/c6/HOME0103A.png
curl.exe -sL -o Official_Artwork_Litten.png https://archives.bulbagarden.net/media/upload/f/ff/0725Litten.png
```

## Provenance & licensing

- Repository: Bulbagarden Archives, `Category:Pokémon Sun and Moon screenshots` (https://archives.bulbagarden.net/wiki/Category:Pok%C3%A9mon_Sun_and_Moon_screenshots), its `Early Pokémon Sun and Moon images` subcategory, and `Category:Moves (Generation VII)`.
- File pages are licensed `Game screenshot / Game fair use`.
- Fetched with the MediaWiki API (`action=query&prop=imageinfo`) for exact original URLs, then `curl -L`. PNG magic bytes and dimensions re-verified with `file`/PIL.
- **Do not copy these captures into the demo** — visual-bar references only.
