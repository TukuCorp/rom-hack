// main.js — boot, fixed update order, render loop. Owned by: Main.

import { initGL, render } from './gl.js';
import { createState } from './scene.js';
import * as arena from './arena.js';
import * as effects from './effects.js';
import * as hud from './hud.js';
import * as camera from './camera.js';
import { runBattle } from './battle.js';

const params = new URLSearchParams(location.search);
if (params.has('top')) document.body.classList.add('top-only');
if (params.has('plain')) document.body.classList.add('plain');

const canvas = document.getElementById('gl');
const ctx = initGL(canvas);
const state = createState(params.get('scene') || 'exeggutorIsland');
state.params = params;
state.mods = { arena, effects, hud, camera };
state.ctx = ctx;                     // modules needing GL uploads (dynamic meshes) read this

arena.build(state);
effects.init(state, ctx);
hud.init(state, ctx);
runBattle(state);                     // long-running async game loop

let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsT = last, cpuMs = 0;

function frame(now) {
  const raw = Math.min(0.05, Math.max(0, (now - last) / 1000));
  const dt = raw * (window.__smTimeScale || 1);   // capture/debug hook: slow-mo stills
  last = now;
  state.dt = dt;
  state.t = now / 1000;
  state.frame++;

  const cpu0 = performance.now();
  arena.update(state, dt, state.t);
  effects.update(state, dt, state.t);
  for (const e of state.entities) {
    if (e.anim) e.anim.t += dt;
    if (e.update) e.update(dt, state.t, state);
    if (e.model && e.model.update) e.model.update(dt, state.t, state, e);
  }
  hud.update(state, state.t);
  camera.update(state, state.t);
  render(ctx, state, state.t);
  cpuMs += performance.now() - cpu0;

  for (let i = state.entities.length - 1; i >= 0; i--) {
    const e = state.entities[i];
    if (e.ttl != null) { e.ttl -= dt; if (e.ttl <= 0) state.entities.splice(i, 1); }
  }
  state.events.length = 0;

  fpsAcc += dt; fpsN++;
  if (now - fpsT > 1000) {
    window.__smFps = {
      fps: fpsN / fpsAcc, cpuMs: cpuMs / Math.max(1, fpsN),
      parts: ctx.stats.parts, entities: ctx.stats.entities, tris: ctx.stats.tris,
    };
    fpsAcc = 0; fpsN = 0; cpuMs = 0; fpsT = now;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug/capture handle (used by the gauntlet critic).
window.__sm = { ctx, state, params };
