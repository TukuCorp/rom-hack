# Emberleaf — Ruby-style playable demo (original fan demake)

A tiny Hoenn-flavoured slice: **Emberleaf Town** (first town) + **Route 101 Coral Path** (first route),
with new characters, buildings, and environment. All code and pixel art is original — no Nintendo ROM,
assets, or sprites are used or needed.

## Play

Double-click `play-demo.bat`, or manually:

```
cd ruby-hoenn
python ..\server.py 8000
```

then open http://localhost:8000/ in Chrome/Edge.

Keyboard: arrows/WASD move · `Z` confirm · `X` back · `Enter` menu · `M` mute.
On-screen d-pad + A/B buttons work for touch. Progress autosaves in the browser.

## What's new vs the Johto slice it was built from

- **Characters**: Prof. Palm (coral researcher), rival Kai, trainer Rey, gym leader Cora,
  player Ruan/Lina, aide, fisher guide.
- **Buildings**: Palm's solar-roofed coral lab, stilt-house town flavour, Petalport gym.
- **Environment**: Route 101 coral-sand band, Emberleaf town sign, tropical dialogue.
- **Title**: EMBER LEAF · Coral Edition with its own save slot (`rubyhoenn1`).

## Story chain (all playable end to end)

Mom's house → Prof. Palm's lab (pick a starter) → rival Kai battle → Route 101
wild encounters → Petalport town, center, gym trainer Rey, leader Cora.

## Verified

- `node --check` passes on all 7 JS modules.
- Data check: 9 maps rectangular, all warps resolve in-bounds, all 12 dialogue keys
  referenced by the overworld exist, starters/wild species exist, town sign present.
- Headless Chrome: title renders (gold logo + sky), overworld boots at the house with
  floor + NPC pixels on canvas, and the player moves via on-screen controls.

