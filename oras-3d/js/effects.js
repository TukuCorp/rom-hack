// effects.js: hit-FX particle system. OWNS state.fx (array): triggerFx pushes,
// drawFx sweeps/draws. READS flashFoe/flashMe, lungeMe/lungeFoe, sinkFoe/sinkMe,
// fainted, camShake, mePos/foePos — NEVER writes or decays them (scene() owns
// billboards), analytic motion with gravity, sub-0.9s lives. Fire draws with
// real additive blending (SRC_ALPHA, ONE) and smoke with normal alpha blend;
// drawFx symmetrically saves/restores blend func + depth mask every call, so
// arena/model frames never leak state. fx draws last in scene order.
import { drawTris } from "./gl.js";

// Fallback battler anchors (chest height). Canonical spots live in arena.js
// (FOE/ME); BattleBuilder's state.mePos / state.foePos win when published.
export const HOME_ME = [0, 0.7, 2.8];
export const HOME_FOE = [0, 1.1, -6];

const MAX_P = 450;
const LIFE = 0.6;

// Guarded arena import: arena.js is mid-pivot, so any load failure (missing
// file, half-written edit) settles to null and HOME_* covers. Accepts FOE/ME,
// else lifts the older FOE_SPOT/ME_SPOT ground spots to chest height.
let ARENA = null;
import("./arena.js").then((m) => { ARENA = m; }, () => { ARENA = null; });
// Guarded GL handle for drawFx blending: same pattern as ARENA (any failure
// falls back to plain drawTris with no state changes). Namespace reads are
// live, so GLMOD.gl tracks the real context after initGL.
let GLMOD = null;
import("./gl.js").then((m) => { GLMOD = m; }, () => { GLMOD = null; });
const LIFT_ME = 0.7, LIFT_FOE = 1.1; // chest heights matching HOME_*
function arenaAnchor(who) {
  if (!ARENA) return null;
  const direct = who === "me" ? ARENA.ME : ARENA.FOE;
  if (Array.isArray(direct) && direct.length >= 3) return direct;
  const spot = who === "me" ? ARENA.ME_SPOT : ARENA.FOE_SPOT;
  if (Array.isArray(spot) && spot.length >= 3) return [spot[0], spot[1] + (who === "me" ? LIFT_ME : LIFT_FOE), spot[2]];
  return null;
}
function home(state, who) {
  const p = who === "me" ? state.mePos : state.foePos;
  if (Array.isArray(p) && p.length >= 3) return p;
  return arenaAnchor(who) || (who === "me" ? HOME_ME : HOME_FOE);
}

// Direction inference for 2-arg triggerFx(state, kind) calls. Ember/emberfly
// are always player -> foe (foe Nibble has no Ember). Tackle reads the live
// lunge field the scene just set; faint reads state.fainted. Throw always
// lands on me, dust always on foe. opts { from, to } overrides.
function dir(state, kind, opts) {
  if (kind === "ember" || kind === "emberfly") return [opts.from || "me", opts.to || "foe"];
  if (kind === "throw") return [opts.from || null, opts.to || "me"];
  if (kind === "dust") return [opts.from || null, opts.to || "foe"];
  if (kind === "faint") {
    const to = opts.to || state.fainted || "foe";
    return [opts.from || null, to];
  }
  const from = opts.from
    || (state.lungeMe >= 0.5 ? "me" : state.lungeFoe >= 0.5 ? "foe" : "me");
  return [from, opts.to || (from === "me" ? "foe" : "me")];
}

function ensureQueue(state) {
  if (!Array.isArray(state.fx)) state.fx = [];
  return state.fx;
}

function cap(q) {
  if (q.length > MAX_P) q.splice(0, q.length - MAX_P);
}

function spawnEmber(q, now, a, b) {
  const mx = a[0], my = a[1] + 0.4, mz = a[2];
  let dx = b[0] - mx, dy = b[1] + 0.3 - my, dz = b[2] - mz;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;
  const speed = len / (LIFE * 0.9); // head of the cone reaches the defender at end of life
  const palette = [
    [1, 0.55, 0.22], [1, 0.65, 0.28], [1, 0.75, 0.35],
    [1, 0.88, 0.5], [1, 0.96, 0.78], [1, 1, 0.92],
  ];
  // Heat gradient by speed fraction: slow lingerers at the white-hot base,
  // mid-speeds through orange, fastest tips deep red.
  const basePal = [[1, 0.8, 0.45], [1, 0.85, 0.55], [1, 0.9, 0.65]];
  const tipPal = [[1, 0.55, 0.22], [1, 0.62, 0.25], [1, 0.7, 0.3]];
  for (let i = 0; i < 120; i++) {
    const sp = speed * (0.7 + Math.random() * 0.6);
    const sf = sp / speed;
    const cc = sf < 0.9 ? basePal[(Math.random() * basePal.length) | 0]
      : sf < 1.08 ? palette[(Math.random() * palette.length) | 0]
      : tipPal[(Math.random() * tipPal.length) | 0];
    q.push({
      x: mx, y: my, z: mz,
      vx: dx * sp + (Math.random() - 0.5) * 2.6,
      vy: dy * sp + (Math.random() - 0.5) * 2.6 + 0.7,
      vz: dz * sp + (Math.random() - 0.5) * 2.6,
      g: -4.5,
      born: now,
      life: LIFE * (0.92 + Math.random() * 0.5),
      c: cc,
      size: 0.04 + Math.random() * 0.05,
      soft: 1,
    });
  }
  // White-hot beam core (Dragon_Pulse grammar): fast, tight, near-white.
  for (let i = 0; i < 14; i++) {
    const sp = speed * (0.95 + Math.random() * 0.3);
    q.push({
      x: mx, y: my, z: mz,
      vx: dx * sp + (Math.random() - 0.5) * 0.7,
      vy: dy * sp + (Math.random() - 0.5) * 0.7 + 0.4,
      vz: dz * sp + (Math.random() - 0.5) * 0.7,
      g: -3,
      born: now,
      life: LIFE * (0.92 + Math.random() * 0.5),
      c: [1, 0.9, 0.6],
      size: 0.06 + Math.random() * 0.06,
      soft: 1,
    });
  }
  // Radiating spark streaks: thin tall slivers, gold-white, long reach.
  for (let i = 0; i < 10; i++) {
    const sp = speed * (0.6 + Math.random() * 0.7);
    q.push({
      x: mx, y: my, z: mz,
      vx: dx * sp + (Math.random() - 0.5) * 4,
      vy: dy * sp + (Math.random() - 0.5) * 4 + 1.2,
      vz: dz * sp + (Math.random() - 0.5) * 4,
      g: -5,
      born: now,
      life: LIFE * (0.92 + Math.random() * 0.5),
      c: [1, 0.9, 0.55],
      size: 0.06 + Math.random() * 0.05,
      w: 0.35, h: 2.6,
    });
  }
  // White-hot impact core at the defender: near-white concentric shell that
  // pops to full size in ~80ms (grow), holds through the hit beat, then
  // shrinks. Zero gravity, hangs on the impact point.
  const ix = b[0], iy = b[1] + 0.3, iz = b[2] + 0.3;
  for (let i = 0; i < 9; i++) {
    q.push({
      x: ix + (Math.random() - 0.5) * 0.6,
      y: iy + (Math.random() - 0.5) * 0.6,
      z: iz + (Math.random() - 0.5) * 0.2,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      vz: (Math.random() - 0.5) * 0.6,
      g: 0,
      born: now,
      life: 0.7 + Math.random() * 0.15,
      c: [1, 1, 0.96],
      size: 0.3 + Math.random() * 0.2,
      soft: 1,
      grow: 0.08,
      hold: 0.45,
    });
  }
  // Expanding fireball shell: bright yellow-orange, slow radial 3D spread for
  // a volumetric bloom read. Color only, no blending changes.
  const shellCols = [[1, 0.78, 0.3], [1, 0.87, 0.45], [1, 0.7, 0.28], [1, 0.93, 0.6]];
  for (let i = 0; i < 40; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    const sp = 1.2 + Math.random() * 1.6;
    q.push({
      x: ix, y: iy, z: iz,
      vx: Math.sin(ph) * Math.cos(th) * sp,
      vy: Math.abs(Math.cos(ph)) * sp * 0.8 + 0.3,
      vz: Math.sin(ph) * Math.sin(th) * sp,
      g: -1.5,
      born: now,
      life: 0.7 + Math.random() * 0.15,
      c: shellCols[(Math.random() * shellCols.length) | 0],
      size: 0.07 + Math.random() * 0.05,
      soft: 1,
      grow: 0.12,
      hold: 0.45,
    });
  }
  // Volume fill: bright fire quads distributed THROUGHOUT a sphere around the
  // impact point (not shell/cone surfaces) for full-body encasement. Color by
  // spawn radius: white-hot heart through orange to deep-red skin. Color only.
  const volCols = [[1, 1, 0.95], [1, 0.8, 0.4], [1, 0.68, 0.3], [1, 0.55, 0.22]];
  for (let i = 0; i < 70; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    const rr = 2.2 * Math.cbrt(Math.random());
    const band = rr < 0.73 ? 0 : rr < 1.32 ? 1 : rr < 1.76 ? 2 : 3;
    q.push({
      x: ix + Math.sin(ph) * Math.cos(th) * rr,
      y: iy + Math.cos(ph) * rr * 0.8,
      z: iz + Math.sin(ph) * Math.sin(th) * rr,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5 + 0.3,
      vz: (Math.random() - 0.5) * 0.5,
      g: -1,
      born: now,
      life: 0.6 + Math.random() * 0.25,
      c: volCols[band],
      size: 0.1 + Math.random() * 0.08,
      soft: 1,
      grow: 0.08,
      hold: 0.4,
    });
  }
  // Floor light-pool: flat warm ellipse decal at the impact's ground point,
  // popping in with the hit and gone by ~450ms. One queue entry, fanned flat.
  q.push({
    x: b[0], y: 0.05, z: b[2], vx: 0, vy: 0, vz: 0, g: 0,
    born: now, life: 0.5, c: [1, 0.72, 0.38], size: 0.55,
    grow: 0.06, fan: 8,
  });
  // Small high gray smoke wisps, drawn with normal alpha blending for a
  // translucent read (alpha comes from the shader at 1.0, so small + few +
  // high keeps them wisp-thin against the dark arena).
  for (let i = 0; i < 8; i++) {
    q.push({
      x: ix + (Math.random() - 0.5) * 0.7,
      y: iy + 0.8 + Math.random() * 0.3,
      z: iz + (Math.random() - 0.5) * 0.5,
      vx: (Math.random() - 0.5) * 0.7,
      vy: 1.4 + Math.random() * 0.8,
      vz: (Math.random() - 0.5) * 0.7,
      g: 0.4,
      born: now, life: 0.9 + Math.random() * 0.1,
      c: [0.4, 0.36, 0.33],
      size: 0.1 + Math.random() * 0.08,
      soft: 1,
      grow: 0.25,
      smoke: 1,
    });
  }
  // Tiny bright ember sparks: fast, small, long-lived yellow-white.
  for (let i = 0; i < 28; i++) {
    const sa = Math.random() * Math.PI * 2;
    const ss = 4 + Math.random() * 5;
    q.push({
      x: ix, y: iy, z: iz,
      vx: Math.cos(sa) * ss,
      vy: Math.random() * 3 + 1,
      vz: Math.sin(sa) * ss,
      g: -6,
      born: now, life: 0.7 + Math.random() * 0.2,
      c: [1, 0.96, 0.72],
      size: 0.04 + Math.random() * 0.03,
    });
  }
}

function spawnTackleStar(q, now, b) {
  const cx = b[0], cy = b[1] + 0.3, cz = b[2] + 0.4; // popped toward camera so it reads
  const palette = [[1, 1, 1], [1, 1, 1], [1, 0.95, 0.6], [1, 1, 0.85]];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const sp = 3 + Math.random() * 2.2;
    q.push({
      x: cx, y: cy, z: cz,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp + 0.4,
      vz: 1.2 + Math.random() * 1.5,
      g: -2,
      born: now,
      life: 0.32 + Math.random() * 0.2,
      c: palette[(Math.random() * palette.length) | 0],
      size: 0.07 + Math.random() * 0.07,
    });
  }
  // Central white flash: big, slow, short-lived bloom feel.
  for (let i = 0; i < 6; i++) {
    q.push({
      x: cx + (Math.random() - 0.5) * 0.3,
      y: cy + (Math.random() - 0.5) * 0.3,
      z: cz,
      vx: (Math.random() - 0.5) * 1.2,
      vy: (Math.random() - 0.5) * 1.2 + 0.5,
      vz: 0.6 + Math.random() * 0.8,
      g: -1,
      born: now,
      life: 0.22 + Math.random() * 0.12,
      c: [1, 1, 0.95],
      size: 0.16 + Math.random() * 0.1,
    });
  }
  // Impact rays: thin slivers thrown outward past the star.
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + 0.2;
    const sp = 5 + Math.random() * 2;
    q.push({
      x: cx, y: cy, z: cz,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp + 0.5,
      vz: 1 + Math.random(),
      g: -2,
      born: now,
      life: 0.28 + Math.random() * 0.14,
      c: [1, 0.97, 0.8],
      size: 0.08 + Math.random() * 0.05,
      w: 0.3, h: 2.2,
    });
  }
}

function spawnFaintPuffs(q, now, b) {
  for (let i = 0; i < 12; i++) {
    q.push({
      x: b[0] + (Math.random() - 0.5) * 0.9,
      y: b[1] + Math.random() * 0.4,
      z: b[2] + (Math.random() - 0.5) * 0.9,
      vx: (Math.random() - 0.5) * 0.8,
      vy: 0.9 + Math.random() * 0.9,
      vz: (Math.random() - 0.5) * 0.8,
      g: -0.6,
      born: now,
      life: 0.5 + Math.random() * 0.3,
      c: [0.85, 0.93, 1.0],
      size: 0.08 + Math.random() * 0.08,
    });
  }
}
// Signature-moment spawners (ORAS intro + traveling Ember). Original
// procedural art only. Future-born particles (born > now) pop on arrival;
// drawFx skips age < 0 without sweeping, so they survive until their beat.
const THROW_T = 0.5; // ball flight seconds, bottom-center -> ME spot
const FLY_T = 0.3; // ember fireball flight seconds, attacker -> defender

function spawnThrow(q, now, me) {
  // Ball arc: starts low near the camera (bottom-center of frame), arcs to
  // the ME chest spot. Lerp + sine lift is resolved in drawFx (p.ball).
  const ex = me[0], ey = me[1] + 0.2, ez = me[2];
  q.push({
    ball: 1, x: me[0] + 0.55, y: 0.1, z: me[2] + 1.1,
    ex, ey, ez, T: THROW_T, arc: 0.9,
    vx: 0, vy: 0, vz: 0, g: 0,
    born: now, life: THROW_T, size: 0.16, c: [1, 0.15, 0.12],
  });
  const at = now + THROW_T; // arrival beat: white open-flash + sparkles
  for (let i = 0; i < 6; i++) {
    q.push({
      x: ex + (Math.random() - 0.5) * 0.3,
      y: ey + (Math.random() - 0.5) * 0.3,
      z: ez + (Math.random() - 0.5) * 0.2,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      vz: (Math.random() - 0.5) * 0.6,
      g: 0, born: at, life: 0.3 + Math.random() * 0.1,
      c: [1, 1, 0.97], size: 0.26 + Math.random() * 0.12,
      grow: 0.06, hold: 0.12,
    });
  }
  const sparkCols = [[1, 1, 1], [1, 0.97, 0.8], [1, 1, 0.9]];
  for (let i = 0; i < 22; i++) {
    const sa = Math.random() * Math.PI * 2;
    const ss = 2 + Math.random() * 3;
    q.push({
      x: ex, y: ey, z: ez,
      vx: Math.cos(sa) * ss, vy: Math.random() * 2.5 + 0.5, vz: Math.sin(sa) * ss,
      g: -5, born: at, life: 0.35 + Math.random() * 0.2,
      c: sparkCols[(Math.random() * sparkCols.length) | 0],
      size: 0.03 + Math.random() * 0.03,
    });
  }
}

function spawnDust(q, now, foe) {
  // Foe encounter dust: tan-gray puffs kicked up at the foe ground spot.
  const gx = foe[0], gz = foe[2];
  const cols = [[0.62, 0.55, 0.45], [0.55, 0.48, 0.4], [0.7, 0.63, 0.52]];
  for (let i = 0; i < 14; i++) {
    q.push({
      x: gx + (Math.random() - 0.5) * 1.0,
      y: 0.06 + Math.random() * 0.15,
      z: gz + (Math.random() - 0.5) * 1.0,
      vx: (Math.random() - 0.5) * 2.4,
      vy: 0.8 + Math.random() * 1.2,
      vz: (Math.random() - 0.5) * 2.4,
      g: -1.2, born: now, life: 0.35 + Math.random() * 0.2,
      c: cols[(Math.random() * cols.length) | 0],
      size: 0.1 + Math.random() * 0.08,
      grow: 0.18, smoke: 1,
    });
  }
}

function spawnEmberFly(q, now, a, b) {
  // Traveling fireball: bright head lerps attacker -> defender in FLY_T
  // (drawFx resolves p.fly), flame-tongue trail pops along its path, impact
  // volume + floor pool spawn in the future (born = now + FLY_T).
  const sx = a[0], sy = a[1] + 0.35, sz = a[2] - 0.2;
  const ex = b[0], ey = b[1] + 0.3, ez = b[2] + 0.3;
  q.push({
    fly: 1, x: sx, y: sy, z: sz, ex, ey, ez, T: FLY_T, arc: 0.25,
    vx: 0, vy: 0, vz: 0, g: 0,
    born: now, life: FLY_T + 0.02, size: 0.22, c: [1, 0.6, 0.2],
  });
  const trailCols = [[1, 0.7, 0.3], [1, 0.8, 0.45], [1, 0.6, 0.22], [1, 0.9, 0.6]];
  for (let i = 0; i < 26; i++) {
    const f = i / 26;
    q.push({
      x: sx + (ex - sx) * f + (Math.random() - 0.5) * 0.16,
      y: sy + (ey - sy) * f + Math.sin(f * Math.PI) * 0.25 + (Math.random() - 0.5) * 0.16,
      z: sz + (ez - sz) * f + (Math.random() - 0.5) * 0.16,
      vx: (Math.random() - 0.5) * 1, vy: 0.5 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 1,
      g: 0.5, born: now + f * FLY_T, life: 0.2,
      c: trailCols[(Math.random() * trailCols.length) | 0],
      size: 0.05 + Math.random() * 0.04, soft: 1,
    });
  }
  const at = now + FLY_T; // impact beat (battle.js lands damage ~250ms in)
  for (let i = 0; i < 8; i++) {
    q.push({
      x: ex + (Math.random() - 0.5) * 0.5,
      y: ey + (Math.random() - 0.5) * 0.5,
      z: ez + (Math.random() - 0.5) * 0.2,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      vz: (Math.random() - 0.5) * 0.6,
      g: 0, born: at, life: 0.5 + Math.random() * 0.1,
      c: [1, 1, 0.95], size: 0.24 + Math.random() * 0.12,
      soft: 1, grow: 0.08, hold: 0.3,
    });
  }
  const shellCols = [[1, 0.78, 0.3], [1, 0.87, 0.45], [1, 0.65, 0.25]];
  for (let i = 0; i < 30; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    const sp = 1.2 + Math.random() * 1.8;
    q.push({
      x: ex, y: ey, z: ez,
      vx: Math.sin(ph) * Math.cos(th) * sp,
      vy: Math.abs(Math.cos(ph)) * sp * 0.8 + 0.3,
      vz: Math.sin(ph) * Math.sin(th) * sp,
      g: -1.5, born: at, life: 0.5 + Math.random() * 0.15,
      c: shellCols[(Math.random() * shellCols.length) | 0],
      size: 0.06 + Math.random() * 0.04, soft: 1, grow: 0.1, hold: 0.3,
    });
  }
  for (let i = 0; i < 16; i++) {
    const sa = Math.random() * Math.PI * 2;
    const ss = 4 + Math.random() * 4;
    q.push({
      x: ex, y: ey, z: ez,
      vx: Math.cos(sa) * ss, vy: Math.random() * 3 + 1, vz: Math.sin(sa) * ss,
      g: -6, born: at, life: 0.4 + Math.random() * 0.2,
      c: [1, 0.95, 0.7], size: 0.035 + Math.random() * 0.025, w: 0.35, h: 2.4,
    });
  }
  for (let i = 0; i < 6; i++) {
    q.push({
      x: ex + (Math.random() - 0.5) * 0.6,
      y: ey + 0.7 + Math.random() * 0.3,
      z: ez + (Math.random() - 0.5) * 0.4,
      vx: (Math.random() - 0.5) * 0.7,
      vy: 1.4 + Math.random() * 0.8,
      vz: (Math.random() - 0.5) * 0.7,
      g: 0.4, born: at, life: 0.65 + Math.random() * 0.1,
      c: [0.42, 0.38, 0.35], size: 0.1 + Math.random() * 0.06,
      soft: 1, grow: 0.25, smoke: 1,
    });
  }
  q.push({
    x: b[0], y: 0.05, z: b[2], vx: 0, vy: 0, vz: 0, g: 0,
    born: at, life: 0.5, c: [1, 0.7, 0.35], size: 0.55, grow: 0.06, fan: 8,
  });
}

// Fullscreen warm-white wash: arena-wide light spill faked with a DOM overlay
// (color only, no GL blending). div#flash is created once over #stage, reused
// forever, never removed. No-op outside a DOM page (headless tests).
let flashEl = null, flashTimer = 0;
function pulseWash() {
  if (typeof document === "undefined") return;
  try {
    // Re-sync: a past failed insert leaves flashEl detached, which would
    // silently kill every later wash. Heal by reusing the live node or reset.
    if (flashEl && !flashEl.isConnected) flashEl = document.getElementById("flash");
    if (!flashEl) {
      const stage = document.getElementById("stage");
      if (!stage) return;
      if (typeof getComputedStyle !== "undefined" &&
          getComputedStyle(stage).position === "static") stage.style.position = "relative";
      flashEl = document.createElement("div");
      flashEl.id = "flash";
      flashEl.style.cssText = "position:absolute;inset:0;pointer-events:none;opacity:0;" +
        "background:radial-gradient(ellipse at 50% 55%, rgba(255,250,235,1) 0%," +
        " rgba(255,222,160,0.55) 45%, rgba(255,200,140,0) 75%);";
      const hud = document.getElementById("hud");
      stage.insertBefore(flashEl, hud || null);
    }
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
    flashEl.style.transition = "none";
    flashEl.style.opacity = "0.32";
    void flashEl.offsetWidth; // reflow so the hold + fade replay on retrigger
    flashTimer = setTimeout(() => {
      if (!flashEl) return;
      flashEl.style.transition = "opacity 0.16s";
      flashEl.style.opacity = "0";
      flashTimer = 0;
    }, 100);
  } catch {}
}

export function triggerFx(state, kind, opts = {}) {
  if (kind !== "ember" && kind !== "tackle" && kind !== "faint" &&
      kind !== "throw" && kind !== "dust" && kind !== "emberfly") return;
  const q = ensureQueue(state);
  const now = performance.now() / 1000; // same clock main.js derives t from
  const [from, to] = dir(state, kind, opts);
  if (kind === "ember") { spawnEmber(q, now, home(state, from), home(state, to)); pulseWash(); }
  else if (kind === "emberfly") { spawnEmberFly(q, now, home(state, from), home(state, to)); pulseWash(); }
  else if (kind === "tackle") { spawnTackleStar(q, now, home(state, to)); pulseWash(); }
  else if (kind === "throw") spawnThrow(q, now, home(state, to));
  else if (kind === "dust") spawnDust(q, now, home(state, to));
  else spawnFaintPuffs(q, now, home(state, to));
  cap(q);
}

export function drawFx(ctx, viewProj, state, t) {
  const q = ensureQueue(state);
  for (let i = q.length - 1; i >= 0; i--) {
    if (t - q[i].born > q[i].life) q.splice(i, 1);
  }
  cap(q);
  if (typeof window !== "undefined") window.__orasFx = { n: q.length, t };
  if (q.length === 0) return;
  const data = [], dataSmoke = [];
  for (const p of q) {
    const out = p.smoke ? dataSmoke : data;
    const age = t - p.born;
    // Future-born (arrival) particles are SKIPPED, never swept: the sweep
    // above only removes age > life, so age < 0 survives until its beat.
    if (age < 0) continue;
    const k = Math.max(0, 1 - age / p.life);
    // Signature flights (ball arc, traveling fireball): analytic lerp from
    // (x,y,z) to (ex,ey,ez) over T seconds with a sine lift, so the head
    // reads as one body mid-flight regardless of frame rate.
    const glides = (p.ball || p.fly) && p.T;
    let x, y, z;
    if (glides) {
      const f = Math.min(1, age / p.T);
      const lift = (p.arc || 0) * Math.sin(f * Math.PI);
      x = p.x + (p.ex - p.x) * f;
      y = p.y + (p.ey - p.y) * f + lift;
      z = p.z + (p.ez - p.z) * f;
    } else {
      x = p.x + p.vx * age;
      y = p.y + p.vy * age + 0.5 * p.g * age * age;
      z = p.z + p.vz * age;
    }
    let s;
    const fullUntil = p.hold || 0;
    if (p.grow && age < p.grow) s = p.size * (0.3 + 0.7 * (age / p.grow));
    else if (age < fullUntil) s = p.size;
    else if (p.grow) s = p.size * Math.max(0, 1 - (age - fullUntil) / (p.life - fullUntil));
    else s = p.size * (0.4 + 0.6 * k);
    const f = k * k;
    const fade = (p.hold && age < p.hold) ? 1.0 : (p.grow ? 0.8 + 0.2 * f : 0.65 + 0.35 * f);
    // No ember-out darkening: under additive blending dark facets go invisible
    // (that was the sparsity). Floor holds via fade; gradient stays bright.
    const r = Math.min(1, p.c[0] * fade);
    const g = Math.min(1, p.c[1] * fade);
    const bl = Math.min(1, p.c[2] * fade);
    if (p.ball) {
      // Thrown ball: red top dome, white bottom dome, dark equator band +
      // white button glint. Solid colors (no ember fade) so it reads mid-arc.
      out.push(x - s, y, z, 0.85, 0.08, 0.08,
        x + s, y, z, 0.85, 0.08, 0.08, x, y + s, z, 1, 0.16, 0.12);
      out.push(x + s, y, z, 0.95, 0.95, 0.95,
        x - s, y, z, 0.95, 0.95, 0.95, x, y - s, z, 1, 1, 1);
      const bw = s * 0.5, bh = s * 0.12;
      out.push(x - bw, y, z, 0.12, 0.1, 0.12,
        x + bw, y, z, 0.12, 0.1, 0.12, x + bw, y + bh, z, 0.2, 0.18, 0.2);
      out.push(x - bw, y, z, 0.12, 0.1, 0.12,
        x + bw, y + bh, z, 0.2, 0.18, 0.2, x - bw, y + bh, z, 0.2, 0.18, 0.2);
      const gw = s * 0.22;
      out.push(x, y + gw, z, 1, 1, 1, x - gw, y, z, 1, 1, 1, x + gw, y, z, 1, 1, 1);
    } else if (p.fly) {
      // Traveling fireball: orange outer diamond + white-hot inner core.
      const o = s, c = s * 0.45;
      const or_ = Math.min(1, r), og = Math.min(1, g * 0.9), ob = Math.min(1, bl * 0.9);
      out.push(x, y + o, z, or_, og, ob, x - o, y, z, or_, og, ob, x + o, y, z, or_, og, ob);
      out.push(x + o, y, z, or_, og, ob, x - o, y, z, or_, og, ob, x, y - o, z, or_, og, ob);
      out.push(x, y + c, z, 1, 0.98, 0.9, x - c, y, z, 1, 0.98, 0.9, x + c, y, z, 1, 0.98, 0.9);
      out.push(x + c, y, z, 1, 0.98, 0.9, x - c, y, z, 1, 0.98, 0.9, x, y - c, z, 1, 0.98, 0.9);
    } else if (p.fan) {
      const n = p.fan;
      for (let j = 0; j < n; j++) {
        const a0 = (j / n) * Math.PI * 2, a1 = ((j + 1) / n) * Math.PI * 2;
        out.push(x, y, z, r, g, bl,
          x + Math.cos(a0) * s, y, z + Math.sin(a0) * s, r, g, bl,
          x + Math.cos(a1) * s, y, z + Math.sin(a1) * s, r, g, bl);
      }
    } else if (p.soft && !p.smoke) {
      // Flame tongue: tall thin gradient tri rising from the ember — warm
      // cream base through the ember's own hue to a flickering true-red tip.
      // Per-vertex colors do the gradient; tip flickers by age. No quads.
      const ph = p.x * 37.7 + p.y * 17.3 + p.z * 11.1;
      const tw = s * 0.4;
      const th = s * 3.0 * (1 + 0.2 * Math.sin(age * 25 + ph * 1.7));
      const tx = x + Math.sin(age * 30 + ph) * th * 0.22;
      const ty = y + th;
      const heat = 1 - Math.min(1, Math.max(0, age - 0.12) / 0.25);
      const br = Math.min(1, r + 0.45 * heat), bg = Math.min(1, g + 0.5 * heat), bb = Math.min(1, bl + 0.55 * heat);
      const tr = Math.min(1, r * 0.9 + 0.1), tg = g * 0.6 + 0.25, tb = bl * 0.5 + 0.1;
      out.push(x - tw, y, z, br, bg, bb, x + tw, y, z, br, bg, bb, tx, ty, z, tr, tg, tb);
    } else {
      const hw = s * (p.w || 1), top = y + s * (p.h || 1), bot = y - s * 0.7;
      out.push(x, top, z, r, g, bl, x - hw, bot, z, r, g, bl, x + hw, bot, z, r, g, bl);
    }
  }
  // Real blending, symmetrically saved/restored inside drawFx so arena/model
  // frames never leak state: smoke under normal alpha blend, fire additive
  // (SRC_ALPHA, ONE) with depth writes off for true glow; fx already draws
  // last in battle.js scene order. Falls back to plain draws without a GL
  // handle (headless tests).
  const gl = GLMOD && GLMOD.gl ? GLMOD.gl : null;
  if (!gl) {
    if (dataSmoke.length) drawTris(ctx, dataSmoke, viewProj);
    if (data.length) drawTris(ctx, data, viewProj);
    return;
  }
  const wasBlend = gl.isEnabled(gl.BLEND);
  const wasSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB);
  const wasDstRGB = gl.getParameter(gl.BLEND_DST_RGB);
  const wasSrcA = gl.getParameter(gl.BLEND_SRC_ALPHA);
  const wasDstA = gl.getParameter(gl.BLEND_DST_ALPHA);
  const wasMask = gl.getParameter(gl.DEPTH_WRITEMASK);
  const wasTest = gl.isEnabled(gl.DEPTH_TEST);
  try {
    gl.depthMask(false);
    if (dataSmoke.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      drawTris(ctx, dataSmoke, viewProj);
    }
    if (data.length) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.disable(gl.DEPTH_TEST); // burst engulfs IN FRONT: never occluded by the foe body
      drawTris(ctx, data, viewProj);
    }
  } finally {
    if (wasTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    gl.depthMask(wasMask ? true : false);
    if (!wasBlend) gl.disable(gl.BLEND);
    else gl.blendFuncSeparate(wasSrcRGB, wasDstRGB, wasSrcA, wasDstA);
  }
}
