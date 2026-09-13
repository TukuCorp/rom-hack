// battle.js: scripted demo battle state machine. Owns turn order, damage,
// HP flow. Reads MONS from data inline (original species). Also owns scene
// composition: builds viewProj via getCamera (fallback when camera.js is
// absent mid-flight), then drawArena / drawMons / drawFx, each guarded so
// the demo boots with or without piece files present.
import { setFoe, setMe, say, askMove } from "./hud.js";
import { mat4mul, perspective, lookAt } from "./gl.js";

const MONS = {
  embercub: { name: "Embercub", lv: 12, max: 34, atk: 16, def: 12, moves: ["Tackle", "Ember", "Growl", "Leer"] },
  nibble: { name: "Nibble", lv: 10, max: 30, atk: 14, def: 11, moves: ["Tackle", "Growl"] },
};
const POWER = { Tackle: 40, Ember: 40, Growl: 0, Leer: 0 };

export const state = {
  me: { ...MONS.embercub, cur: MONS.embercub.max },
  foe: { ...MONS.nibble, cur: MONS.nibble.max },
  fx: [],          // effects.js queue (array); triggerFx appends here
  scene: null,     // set below: fn(ctx, state, t) drawing the 3D scene
  camShake: 0,     // trauma-style shake, decayed per frame in scene()
  flashFoe: 0,     // 0..1 hit-flash, read by models.js
  flashMe: 0,      // 0..1 hit-flash, read by models.js
  lungeMe: 0,      // 0..1 attack lunge, read by models.js
  lungeFoe: 0,     // 0..1 attack lunge, read by models.js
  sinkFoe: 0,      // 0..1 faint sink, eased to 1 for the loser
  sinkMe: 0,       // 0..1 faint sink, eased to 1 for the loser
  fainted: null,   // null | "foe" | "me"
};

// ---- Optional piece builders: dynamic import each, guarded so a missing
// file mid-flight never breaks boot. Statically imported above: hud.js,
// gl.js (both exist). Pieces below may or may not exist yet.
let getCamera = null, drawArena = null, drawMons = null;
let triggerFx = null, drawFx = null;

async function loadPieces() {
  try { const m = await import("./camera.js"); if (m && typeof m.getCamera === "function") getCamera = m.getCamera; } catch {}
  try { const m = await import("./arena.js"); if (m && typeof m.drawArena === "function") drawArena = m.drawArena; } catch {}
  try { const m = await import("./models.js"); if (m && typeof m.drawMons === "function") drawMons = m.drawMons; } catch {}
  try {
    const m = await import("./effects.js");
    if (m && typeof m.triggerFx === "function") triggerFx = m.triggerFx;
    if (m && typeof m.drawFx === "function") drawFx = m.drawFx;
  } catch {}
}
loadPieces();

const FALLBACK_CAM = { eye: [2.5, 3.2, 9.5], at: [0, 1.2, -2], fovy: 0.62 };

let lastT = -1;
function scene(ctx, st, t) {
  // Per-frame decay (frame-rate independent).
  const dt = lastT < 0 ? 0.016 : Math.min(0.05, Math.max(0, t - lastT));
  lastT = t;
  // Hit-flash holds at 1 for 120ms post-hit, then decays to 0 by ~300ms.
  if (t < (st.flashFoeHold || 0)) st.flashFoe = 1;
  else st.flashFoe = Math.max(0, st.flashFoe - dt * 5.6);
  if (t < (st.flashMeHold || 0)) st.flashMe = 1;
  else st.flashMe = Math.max(0, st.flashMe - dt * 5.6);
  st.lungeMe = Math.max(0, st.lungeMe - dt * 3.0);
  st.lungeFoe = Math.max(0, st.lungeFoe - dt * 3.0);
  st.camShake = Math.max(0, st.camShake - dt * 14);
  // Ease the loser down to a full sink of 1 on faint.
  if (st.fainted === "foe") st.sinkFoe = Math.min(1, st.sinkFoe + dt * 1.4);
  else if (st.fainted === "me") st.sinkMe = Math.min(1, st.sinkMe + dt * 1.4);

  let cam = FALLBACK_CAM;
  if (getCamera) {
    try {
      const c = getCamera(st, t);
      if (c && Array.isArray(c.eye) && Array.isArray(c.at)) cam = c;
    } catch {}
  }
  const fovy = (cam && typeof cam.fovy === "number") ? cam.fovy : FALLBACK_CAM.fovy;
  const viewProj = mat4mul(perspective(fovy, 16 / 10, 0.1, 100), lookAt(cam.eye, cam.at, [0, 1, 0]));
  if (drawArena) { try { drawArena(ctx, viewProj, t); } catch {} }
  if (drawMons) { try { drawMons(ctx, viewProj, st, t); } catch {} }
  if (drawFx) { try { drawFx(ctx, viewProj, st, t); } catch {} }
}
state.scene = scene;

function damage(att, def, move) {
  const p = POWER[move] || 40;
  if (!p) return 0;
  const stab = move === "Ember" ? 1.5 : 1;
  return Math.max(1, Math.floor((((2 * att.lv / 5 + 2) * p * att.atk / def.def) / 50 + 2) * stab));
}

function paint() {
  setFoe(state.foe.name, state.foe.lv, state.foe.cur / state.foe.max);
  setMe(state.me.name, state.me.lv, state.me.cur / state.me.max, state.me.cur, state.me.max);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Damaging hit on one side: flash + lunge + shake + particle fx.
function doHit(victim, kind) {
  if (!Array.isArray(state.fx)) state.fx = [];
  const hold = performance.now() / 1000 + 0.12;
  if (victim === "foe") { state.flashFoe = 1; state.flashFoeHold = hold; state.lungeMe = 1; }
  else { state.flashMe = 1; state.flashMeHold = hold; state.lungeFoe = 1; }
  state.camShake = kind === "ember" ? 3.5 : 6;
  if (triggerFx) { try { triggerFx(state, kind); } catch {} }
}

function doFaint(loser) {
  state.fainted = loser;
  if (!Array.isArray(state.fx)) state.fx = [];
  if (triggerFx) { try { triggerFx(state, "faint"); } catch {} }
}

export async function runBattle() {
  paint();
  await say(`Wild ${state.foe.name} appeared!`);
  await say(`Go! ${state.me.name}!`);
  for (;;) {
    const i = await askMove(state.me.moves);
    const mv = state.me.moves[i];
    await say(`${state.me.name} used ${mv}!`);
    if (POWER[mv]) {
      doHit("foe", mv === "Ember" ? "ember" : "tackle");
      state.foe.cur = Math.max(0, state.foe.cur - damage(state.me, state.foe, mv));
      paint();
      await wait(550);
    } else {
      state.lungeMe = 0.6;
      await wait(250);
    }
    if (state.foe.cur <= 0) {
      doFaint("foe");
      await say(`Foe ${state.foe.name} fainted!`);
      await wait(800);
      return true;
    }
    const foeMv = state.foe.moves[Math.floor(Math.random() * state.foe.moves.length)];
    await say(`Foe ${state.foe.name} used ${foeMv}!`);
    if (POWER[foeMv]) {
      doHit("me", "tackle");
      state.me.cur = Math.max(0, state.me.cur - damage(state.foe, state.me, foeMv));
      paint();
      await wait(550);
    } else {
      state.lungeFoe = 0.6;
      await wait(250);
    }
    if (state.me.cur <= 0) {
      doFaint("me");
      await say(`${state.me.name} fainted!`);
      await wait(800);
      return false;
    }
  }
}
