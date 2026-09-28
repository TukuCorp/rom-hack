# Graphics pipeline: new cast sprites + buildings (phase 2)

Applies after `make check` passes on the dialogue-only build.
Standard town NPC = 16x32, 9 frames (`overworld_frame(pic, 2, 4, i)`).

## New NPC sprite (e.g. PROF. PALM from ProfBirch)

1. Draw `graphics/object_events/pics/people/prof_palm.png` (+ `.pal`),
   same sheet layout as the sprite it clones (Birch: 16x32 x9).
2. Pic table: clone `sPicTable_ProfBirch` in
   `src/data/object_events/object_event_pic_tables.h` -> `sPicTable_ProfPalm`.
3. GraphicsInfo: clone `gObjectEventGraphicsInfo_ProfBirch` in
   `src/data/object_events/object_event_graphics_info.h`, new palette slot
   (`PALSLOT_NPC_*` free slot) + matching `OBJ_EVENT_PAL_TAG_*`.
4. New id: append `OBJ_EVENT_GFX_PROF_PALM` in
   `include/constants/event_objects.h` + pointer in
   `object_event_graphics_info_pointers.h`.
5. Point map.json `graphics_id`s at the new id (town, lab, route).
6. `make check` must stay byte-identical EXCEPT the intended graphics
   (matching build changes only where content changed).

## New buildings / environment tiles

- Visual work in Porymap block editor on `data/tilesets/primary|secondary`
  (source art under `graphics/tilesets/`).
- New town buildings = new blocks using existing + extended tiles;
  coral-sand route band = new ground blocks on Route 101's layout
  (`data/layouts/`).
- Porymap rewrites map/layout JSON for you; keep `map.json` event coords
  in sync (doors/signs/NPC positions).

## Order

1. Dialogue-only build plays town -> lab -> starter -> Kai.
2. Palm sprite (Birch stand-in), then Kai/rival sprite.
3. Buildings/tiles, then wild-encounter draft, then playtest + `.ups`.

