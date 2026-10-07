# Sun & Moon Battle Demo — build contract

Browser-playable Gen VII (Sun/Moon) battle scene. **All code and art original**; no ROM assets, no copied
assets. **Independent of `oras-3d/`** — never read or import anything from that folder or from
`soulsilver-web/`; this demo must stand alone in `sunmoon/`.

Visual bar (reference screenshots only, do NOT ship or embed them): `sunmoon/bar/` + `sunmoon/bar/NOTES.md`.
Default baselines: `bar/Ember_VII.png` (top-screen framing + foe plate), `bar/Freeze_VII.png` (battlers on
terrain, contact shadows), `bar/Dragon_Hammer_VII.png` + `bar/Barrage_VII.png` (Alolan Exeggutor),
`bar/Battle_interface_*.png` (bottom-screen command plates), `bar/Inferno_Overdrive_*.png` (Z-Move).

## Run / verify

Server already running: **http://localhost:8123/sunmoon/index.html** (`hub` process name `sm`; restart with
`hub op=start name=sm application=python args=["server.py","8123"] cwd=repo root`).

URL params: `?top=1` top screen only · `?plain=1` hide UI chrome · `?auto=1` auto-play ·
`?ui=menu|moves|party|bag` force that UI state (capture helper) · `?scene=exeggutorIsland|altarOfSunne`.

Drive it with the `browser` object in Eval (`browser.open`), or with keyboard: arrows move, `Z` confirm,
`X` back, `Enter` Z-Ring. Debug handle: `window.__sm = { ctx, state, params }`, fps at `window.__smFps`.

**Every builder must verify visually with real screenshots** (top-screen captures at 800×480 or the whole
console), and state in their report exactly which captures they compared.

## File ownership (one owner per file — never edit another's file)

| File | Owner | Contents |
|---|---|---|
| `js/gl.js` | Main (frozen) | renderer + geometry kit |
| `js/scene.js` | Main (frozen) | state factory, field layout, scene presets |
| `js/data.js` | Main (frozen) | types/chart/moves/species/stat maths |
| `js/battle.js` | Main (frozen) | turn engine (calls your module APIs) |
| `js/main.js` | Main (frozen) | boot + update order |
| `js/camera.js` | camera builder | framing per mode |
| `js/arena.js` | arena builder | world: sky, sea, beach, props |
| `js/models.js` | models builder | creatures + props geometry/animation |
| `js/effects.js` | effects builder | particles + Z-Move cinematics |
| `js/hud.js` + `ui.css` | hud builder | Gen VII plates, message, menus |
| `style.css`, `index.html` | Main (frozen) | page + console shell |

Need a change in a frozen file? Message `Main` via `hub op=send` with the exact diff you want. Do not edit it.

## Frozen API you build against

### `gl.js`

```js
import { geo, tex, M, DEG } from './gl.js';
// geo: box(w,h,d) quad(w,h) sphere(r,ws,hs) cylinder(rTop,rBot,h,seg,caps) cone(rBot,h,seg)
//      plane(w,d,sx,sz) disc(r,seg) torus(R,r,seg,rings) tube(points, radii, ringSeg, caps)  // radii: num | [r0,r1] | fn(u)
//      leaf(len,width,thick,seg,tip) blob(r,ws,hs,amp,seed) merge(...meshes)
//      colorize(mesh, [r,g,b] | (x,y,z)=>[r,g,b])   bake(mesh,{p,r,s})   bounds(mesh)   smooth(mesh)
//      dynMesh(maxVerts, maxIdx) -> MeshData with .capacity/.count/.idxCount for CPU-updated geometry
// tex: canvas(w,h,draw) softDisc(size,inner,outer,core) grain(size,base,spots,alpha,radius,seed) vgrad(h,stops)
```

Part (one draw call):

```js
{ geo, col:[r,g,b], p:[x,y,z], r:[rx,ry,rz], s:num|[sx,sy,sz], parent?:partIndex,
  emis?:0..1, spec?:num, shine?:num, rim?:num, alpha?:0..1, blend?:'alpha'|'add',
  unlit?:bool, doubleSided?:bool, billboard?:bool, cull?:'back'|'front'|'none', tex?:GLTexture, texMode?:0|1|2 }
// texMode 0 = vertex colour only · 1 = colour * texture rgba · 2 = alpha from texture, colour from `col` (shadows)
// billboard: part faces the camera; its `s` is the sprite size (uv must be 0..1 across the quad)
// parent: part transform is applied inside the parent's (parents must come earlier in the array)
```

Model: `{ parts:[Part], update?(dt, t, state, entity) }`. Entity: `{ model, pos:[x,y,z], rot?, scale?, shadow?:{r,alpha}, anim?:{name,t}, update?(dt,t,state), ttl? }`.

Dynamic geometry: rebuild your arrays, then `state.ctx.sync(part, vertexCount)` (uploads in place).
Dynamic index count goes in `part.geo.idxCount`.

### Renderer features added after round 1 (all in `gl.js`, all opt-out-able)

| Feature | How it works | Knobs |
|---|---|---|
| **Cel shading** | The diffuse term is a hard 2-step ramp (`smoothstep` steps blended by `uToon`), and specular becomes a hard highlight. This is what makes the scene read as Gen VII rather than a smooth WebGL render. | `state.toon` (0 = smooth, 1 = full, default 1) · per part `toon: 0/1` |
| **Inverted-hull outlines** | Every lit, opaque, non-billboard, non-double-sided part is drawn a second time black, front-face-culled, with vertices pushed along their normals. | `state.outlines = false` · `state.outlineW` (model-space width, default 0.012) · per part `outline: false` |
| **Depth of field** | The scene renders into an offscreen colour+depth target; a post pass blurs by linearised depth, so the background softens the way Gen VII battle cameras defocus the backdrop. Falls back to direct rendering if `WEBGL_depth_texture` is missing. | `state.dof = {focus, range, maxBlur}` · `state.dof = false` |
| **Full-frame flash** | `state.flash` (0..1) + `state.flashCol` ([r,g,b]) mix a colour over the whole 3D frame in-shader. | set on `state`, cleared by the owner |

### Cue bus (`state.events`)

`battle.js` pushes cues each frame; every module may react during its own update; `main.js` clears the array
at the end of the frame. Cues available:

```
damage  {side, amount, move, eff}   // side = the side that TOOK the hit; eff = type multiplier
heal    {side, amount}
exp     {side}                      // EXP bar should start filling
levelup {side, level, from}         // level-up flash/pause
```

Camera should add trauma on `damage`, effects may spawn extra sparks, HUD may flash the plate.

### `state` (from `scene.js`)

```js
state.t, state.dt, state.frame, state.events[]            // events cleared every frame
state.entities[]                                          // flat render list; state.add(e) pushes
state.units.player / .foe = { side, mon, entity, focusHeight, shown }
state.party[] (mon objects), state.active, state.bag[], state.zReady, state.zArmed
state.phase ('intro'|'menu'|'turn'|'victory'|'defeat'|'fled'), state.turn, state.text
state.hud { mode, commandIndex, moveIndex, partyIndex, bagIndex }
state.cam { pos, look, fov, near, far, mode, opts, shake, modeT }
state.field { playerSpot, foeSpot, playerFace, foeFace, ring, ringR }
state.groundY, state.light {dir,col,sky,gnd,rim}, state.fog {col,near,far}, state.clearColor
state.ctx                                                 // the GL context
mon = { species, name, form, level, types[], ability, stats{hp,atk,def,spa,spd,spe}, maxHP, hp,
        moves[{key,name,type,cat,power,acc,pp,maxPP,effect}], stages{}, status, fainted, exp }
```

### Module APIs (called by `battle.js` / `main.js` — keep these signatures)

```js
// camera.js
camera.update(state, t)                 // writes state.cam.pos/look/fov every frame
camera.set(state, mode, opts)           // 'idle'|'intro'|'allyAttack'|'foeAttack'|'zPose'|'zStrike'|'faint'|'victory'|'defeat'|'flee'
camera.shake(state, amount)             // 0..1.5 trauma

// arena.js
arena.build(state)                      // push world entities, set state.groundY
arena.update(state, dt, t)              // waves, drift, sway

// models.js — creature models are faces +Z, feet at y=0, sized in metres
models.makeLitten() models.makePopplio() models.makeAlolanExeggutor()
models.makePalmTree({h,lean,seed}) models.makeRock({r,seed}) models.makeShell({r})
models.makeGrassTuft({h}) models.makeCloud({w})

// effects.js
effects.init(state, ctx)
effects.update(state, dt, t)
effects.spawn(state, kind, opts) -> { promise }   // resolves when the effect's timing is done
effects.setCinematic(state, mode, opts)           // null | 'zPose' | 'zStrike' (full-frame overlay)
// kinds + opts used by battle.js:
//   projectile {from:'player'|'foe', to, type, arc}
//   impact {pos:[x,y,z], type, power, z, height}      miss {pos, height}
//   dash {side, target, entity, dur}                  return {side, entity, dur}
//   heal {pos, height}                                faintDust {pos, r}
//   recall {entity}   ball {side, entity}   encounter {pos}   fleeDust {entity}
//   statDrop {pos, height, stat, up}                  sandkick {pos}
//   zPose {side, entity}                              zStrike {side, target, type, entity, name}

// hud.js + ui.css
hud.init(state, ctx) hud.update(state, t) hud.forceMode(state, mode)
hud.say(state, text) -> Promise          hud.askCommand(state) -> Promise<'fight'|'pokemon'|'bag'|'run'>
hud.askMove(state) -> Promise<{move,z}|null>   hud.askParty(state, opts) -> Promise<number>
hud.askBag(state) -> Promise<number>
```

`battle.js` sets `entity.anim = { name, t }` with `name` in
`idle|enter|attack|hit|faint|recall|flee|victory` (models read it; `main.js` advances `.t`).

## Quality bar

* Gen VII reads instantly: low, tight battle camera behind the ally; ally bottom-left, foe upper-right;
  tropical Alola day; plates bottom-left (ally) / top-right (foe); mena on the bottom screen.
* Battlers must read as the species at a glance (colour blocking, silhouette, signature markings), not as
  primitives. No floating/disconnected limbs; feet planted on the ground with contact shadows.
* 60 fps at 800×480 with everything on. Prefer fewer, better parts (a few hundred parts max in view).
