// effects.js — battle VFX: move projectiles, impacts, dust, heal sparkles, Z-Move cinematics.
// Owned by: effects builder.
//
// API:
//   init(state, ctx)                        build atlas + one dynamic sprite mesh + DOM overlay
//   update(state, dt, t)                     advance movers/particles, rebuild the mesh, paint overlay
//   spawn(state, kind, opts) -> { promise }  promise resolves on the effect's own simulation time
//   setCinematic(state, mode, opts)          full-frame overlay: undefined = resync, null = clear
//
// kinds: projectile | impact | miss | dash | return | heal | faintDust | recall | ball |
//        encounter | fleeDust | statDrop | zPose | zStrike | sandkick
//
// Rendering: every sprite is a quad with an atlas cell, written into ONE dynamic mesh
// (additive, unlit, depth-tested, one draw call for hundreds of sprites). Per-sprite
// alpha is folded into the vertex colour, which is what additive blending wants.
// Darkening elements (vignette, letterbox, fire-sky wash, flash) live in a DOM overlay
// inside #topui — that layer composites over the 3D and can genuinely darken.

import { geo, tex } from './gl.js';
import { TYPE_COLORS } from './data.js';

/* ------------------------------------------------------------------ config */

const CAP = 1100;                 // sprite pool (≈900 live during the Z-Strike fire phase)
const ATLAS = 512, CELL = 128, CPAD = 12;

const TAU = Math.PI * 2;
const rr = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;

/* --------------------------------------------------------------- atlas art */

const CELLS = ['glow', 'flame', 'puff', 'smoke', 'spark', 'star', 'ring', 'ripple',
               'slash', 'dust', 'bubble', 'seed', 'shard', 'chevron', 'ball', 'bokeh'];
const CI = {};
CELLS.forEach((n, i) => { CI[n] = i; });

let seeded = 12345;
const srnd = () => (seeded = (seeded * 16807) % 2147483647) / 2147483647;

/** Soft radial blob (greyscale white) at cell-local coordinates. */
function blob(g, x, y, r, a, soft = 0.45) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(255,255,255,${a})`);
  gr.addColorStop(soft, `rgba(255,255,255,${a * 0.5})`);
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Build the 4x4 sprite atlas (all original procedural art). */
function buildAtlas() {
  return tex.canvas(ATLAS, ATLAS, (g) => {
    g.clearRect(0, 0, ATLAS, ATLAS);
    const ox = i => (i % 4) * CELL, oy = i => ((i / 4) | 0) * CELL;
    const at = i => ({ x: ox(i), y: oy(i) });

    // 0 — glow: hot soft disc
    {
      const { x, y } = at(CI.glow);
      const gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, 56);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.16, 'rgba(255,255,255,0.94)');
      gr.addColorStop(0.42, 'rgba(255,255,255,0.36)');
      gr.addColorStop(0.72, 'rgba(255,255,255,0.09)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x + 6, y + 6, 116, 116);
    }

    // 1 — flame: lobed fire silhouette (bar: Ember_VII.png / Inferno_Overdrive_VII.png)
    {
      const { x, y } = at(CI.flame);
      const lobes = [[64, 98, 34], [44, 90, 27], [84, 90, 27], [56, 74, 25], [74, 72, 23],
                     [64, 52, 19], [52, 36, 13], [76, 34, 12], [64, 18, 7]];
      for (const [lx, ly, lr] of lobes) blob(g, x + lx, y + ly, lr, 0.5);
      for (let i = 0; i < 7; i++) blob(g, x + 64 + rr(-30, 30), y + rr(50, 104), rr(10, 18), 0.35);
      blob(g, x + 64, y + 96, 26, 1.0, 0.6);
      blob(g, x + 62, y + 78, 15, 1.0, 0.6);
    }

    // 2 — puff: soft cloud (smoke-free: used for generic bursts)
    {
      const { x, y } = at(CI.puff);
      const lobes = [[48, 70, 30], [80, 68, 30], [64, 52, 28], [58, 86, 26],
                     [88, 90, 22], [40, 92, 20], [64, 98, 17], [74, 40, 15], [50, 44, 15]];
      for (const [lx, ly, lr] of lobes) blob(g, x + lx, y + ly, lr, 0.36);
    }

    // 3 — smoke: broader, softer, darker-burning cloud
    {
      const { x, y } = at(CI.smoke);
      const lobes = [[46, 74, 34], [82, 70, 34], [64, 50, 32], [56, 92, 28],
                     [92, 94, 24], [36, 96, 22], [68, 104, 20], [78, 36, 18], [46, 38, 18]];
      for (const [lx, ly, lr] of lobes) blob(g, x + lx, y + ly, lr, 0.24, 0.75);
    }

    // 4 — spark: ember with short rays (fire trails, thrown sparks)
    {
      const { x, y } = at(CI.spark);
      g.save(); g.translate(x + 64, y + 64);
      for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
        g.save(); g.rotate(a); g.scale(3.4, 1); blob(g, 0, 0, 18, 0.42); g.restore();
      }
      g.restore();
      blob(g, x + 64, y + 64, 19, 1.0, 0.55);
    }

    // 5 — star: four-point sparkle (heal, Z-power, pop bursts)
    {
      const { x, y } = at(CI.star);
      g.save(); g.translate(x + 64, y + 64);
      for (const a of [0, Math.PI / 2]) {
        g.save(); g.rotate(a); g.scale(4.6, 1); blob(g, 0, 0, 15, 0.72); g.restore();
      }
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        g.save(); g.rotate(a); g.scale(2.5, 1); blob(g, 0, 0, 13, 0.5); g.restore();
      }
      g.restore();
      blob(g, x + 64, y + 64, 15, 1.0, 0.6);
    }

    // 6 — ring: shock ring
    {
      const { x, y } = at(CI.ring);
      const gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, 58);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.50, 'rgba(255,255,255,0)');
      gr.addColorStop(0.62, 'rgba(255,255,255,0.55)');
      gr.addColorStop(0.72, 'rgba(255,255,255,1)');
      gr.addColorStop(0.82, 'rgba(255,255,255,0.42)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x + 6, y + 6, 116, 116);
    }

    // 7 — ripple: three concentric psychic rings
    {
      const { x, y } = at(CI.ripple);
      for (const [r, a, w] of [[50, 0.9, 4], [36, 0.6, 4], [22, 0.35, 4]]) {
        const gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, r + w);
        gr.addColorStop(0, 'rgba(255,255,255,0)');
        gr.addColorStop(Math.max(0, (r - w) / (r + w)), 'rgba(255,255,255,0)');
        gr.addColorStop(r / (r + w), `rgba(255,255,255,${a})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x + 8, y + 8, 112, 112);
      }
    }

    // 8 — slash: elongated needle (power slashes, speed lines, motion smear)
    {
      const { x, y } = at(CI.slash);
      g.save(); g.translate(x + 64, y + 64); g.scale(1, 0.115);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 56);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.25, 'rgba(255,255,255,0.85)');
      gr.addColorStop(0.62, 'rgba(255,255,255,0.35)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 56, 0, TAU); g.fill();
      g.restore();
      g.save(); g.translate(x + 64, y + 64); g.scale(1, 0.05);
      const gr2 = g.createRadialGradient(0, 0, 0, 0, 0, 40);
      gr2.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr2.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr2; g.beginPath(); g.arc(0, 0, 40, 0, TAU); g.fill();
      g.restore();
    }

    // 9 — dust: irregular ground cloud
    {
      const { x, y } = at(CI.dust);
      const lobes = [[52, 74, 24], [78, 72, 22], [64, 60, 22], [60, 88, 19],
                     [86, 90, 16], [42, 90, 15], [68, 46, 14]];
      for (const [lx, ly, lr] of lobes) blob(g, x + lx, y + ly, lr, 0.34, 0.7);
    }

    // 10 — bubble: water bead with a rim
    {
      const { x, y } = at(CI.bubble);
      blob(g, x + 64, y + 64, 44, 0.16, 0.85);
      const gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, 46);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.70, 'rgba(255,255,255,0)');
      gr.addColorStop(0.85, 'rgba(255,255,255,0.95)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x + 12, y + 12, 104, 104);
      blob(g, x + 46, y + 44, 13, 0.75);
    }

    // 11 — seed: tumbling pod / leaf (grass projectiles, grass kick-up)
    {
      const { x, y } = at(CI.seed);
      g.save(); g.translate(x + 64, y + 64); g.rotate(-0.62);
      const gr = g.createLinearGradient(-42, 0, 42, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.10)');
      gr.addColorStop(0.45, 'rgba(255,255,255,0.85)');
      gr.addColorStop(1, 'rgba(255,255,255,0.12)');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(0, 0, 42, 17, 0, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(-36, 0); g.lineTo(34, 0); g.stroke();
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(40, -3); g.lineTo(52, -8); g.stroke();
      g.restore();
    }

    // 12 — shard: tapered spike (dragon / ice / rock energy)
    {
      const { x, y } = at(CI.shard);
      const gr = g.createLinearGradient(0, y + 12, 0, y + 112);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.6)');
      gr.addColorStop(1, 'rgba(255,255,255,0.04)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(x + 64, y + 10); g.lineTo(x + 44, y + 112);
      g.lineTo(x + 84, y + 112); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + 64, y + 12); g.lineTo(x + 46, y + 108); g.stroke();
    }

    // 13 — chevron: stat change arrow (points up; roll = PI for a drop)
    {
      const { x, y } = at(CI.chevron);
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const [dy, a, w] of [[0, 0.95, 17], [26, 0.55, 15]]) {
        g.strokeStyle = `rgba(255,255,255,${a})`;
        g.lineWidth = w;
        g.beginPath();
        g.moveTo(x + 32, y + 84 + dy); g.lineTo(x + 64, y + 40 + dy); g.lineTo(x + 96, y + 84 + dy);
        g.stroke();
      }
    }

    // 14 — ball: Poké Ball (original procedural sphere, thrown on switch / recall)
    {
      const { x, y } = at(CI.ball);
      const cx = x + 64, cy = y + 64, R = 50;
      g.save();
      g.beginPath(); g.arc(cx, cy, R, 0, TAU);
      const gr = g.createRadialGradient(cx - 18, cy - 20, 6, cx, cy, R);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.62, 'rgba(228,228,228,1)');
      gr.addColorStop(1, 'rgba(120,120,128,1)');
      g.fillStyle = gr; g.fill();
      g.clip();
      g.fillStyle = '#e63232'; g.fillRect(cx - R, cy - R, R * 2, R - 3);
      g.fillStyle = '#20242c'; g.fillRect(cx - R, cy - 11, R * 2, 22);
      g.restore();
      g.beginPath(); g.arc(cx, cy, 13, 0, TAU);
      g.fillStyle = '#f2f2f2'; g.fill();
      g.lineWidth = 5; g.strokeStyle = '#20242c'; g.stroke();
      blob(g, cx - 20, cy - 24, 16, 0.5);
    }

    // 15 — bokeh: cinematic background flare disc
    {
      const { x, y } = at(CI.bokeh);
      const gr = g.createRadialGradient(x + 64, y + 64, 0, x + 64, y + 64, 54);
      gr.addColorStop(0, 'rgba(255,255,255,0.30)');
      gr.addColorStop(0.62, 'rgba(255,255,255,0.20)');
      gr.addColorStop(0.86, 'rgba(255,255,255,0.75)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x + 8, y + 8, 112, 112);
    }
  });
}

/** Pre-computed UV rects (u0, v0, u1, v1) per atlas cell, padded against mip bleed. */
const UV = CELLS.map((_, i) => {
  const c = i % 4, r = (i / 4) | 0;
  return [(c * CELL + CPAD) / ATLAS, (r * CELL + CPAD) / ATLAS,
          ((c + 1) * CELL - CPAD) / ATLAS, ((r + 1) * CELL - CPAD) / ATLAS];
});

/* ------------------------------------------------------------ type palettes */

const PAL_DEFAULT = { hot: [1.45, 1.42, 1.35], main: [0.85, 0.84, 0.78],
                      ember: [0.8, 0.79, 0.72], dust: [0.62, 0.58, 0.46], fx: 'puff' };
const PAL = {
  fire:     { hot: [1.62, 1.30, 0.62], main: [1.35, 0.42, 0.06], ember: [1.20, 0.26, 0.03], dust: [0.52, 0.40, 0.30], fx: 'flame' },
  grass:    { hot: [1.20, 1.60, 0.80], main: [0.38, 0.98, 0.34], ember: [0.70, 1.05, 0.35], dust: [0.50, 0.58, 0.32], fx: 'seed' },
  water:    { hot: [0.90, 1.35, 1.70], main: [0.30, 0.66, 1.25], ember: [0.55, 0.90, 1.35], dust: [0.48, 0.58, 0.68], fx: 'bubble' },
  psychic:  { hot: [1.55, 0.95, 1.45], main: [1.15, 0.35, 0.85], ember: [0.85, 0.42, 1.25], dust: [0.48, 0.40, 0.54], fx: 'ripple' },
  dragon:   { hot: [0.95, 0.95, 1.75], main: [0.55, 0.30, 1.30], ember: [0.45, 0.38, 1.35], dust: [0.38, 0.36, 0.50], fx: 'shard' },
  electric: { hot: [1.75, 1.62, 0.90], main: [1.40, 1.12, 0.22], ember: [1.25, 1.02, 0.32], dust: [0.50, 0.48, 0.36], fx: 'spark' },
  ice:      { hot: [1.10, 1.55, 1.70], main: [0.55, 0.98, 1.18], ember: [0.72, 1.15, 1.25], dust: [0.54, 0.60, 0.66], fx: 'shard' },
  fairy:    { hot: [1.60, 1.15, 1.40], main: [1.05, 0.55, 0.90], ember: [1.10, 0.70, 1.05], dust: [0.54, 0.48, 0.52], fx: 'star' },
  normal:   { hot: [1.40, 1.38, 1.30], main: [0.90, 0.88, 0.72], ember: [0.80, 0.78, 0.68], dust: [0.60, 0.57, 0.46], fx: 'puff' },
  fighting: { hot: [1.55, 0.85, 0.75], main: [1.00, 0.25, 0.20], ember: [0.95, 0.32, 0.26], dust: [0.55, 0.42, 0.34], fx: 'puff' },
  dark:     { hot: [1.10, 0.85, 1.20], main: [0.45, 0.32, 0.55], ember: [0.75, 0.45, 0.95], dust: [0.34, 0.30, 0.32], fx: 'puff' },
  ghost:    { hot: [1.20, 0.95, 1.55], main: [0.55, 0.36, 0.85], ember: [0.72, 0.48, 1.10], dust: [0.40, 0.36, 0.50], fx: 'bokeh' },
  rock:     { hot: [1.45, 1.28, 0.85], main: [0.85, 0.72, 0.35], ember: [0.78, 0.68, 0.40], dust: [0.62, 0.55, 0.40], fx: 'shard' },
  ground:   { hot: [1.55, 1.32, 0.90], main: [0.95, 0.78, 0.42], ember: [0.88, 0.72, 0.42], dust: [0.72, 0.62, 0.42], fx: 'dust' },
  steel:    { hot: [1.30, 1.35, 1.50], main: [0.72, 0.76, 0.88], ember: [0.80, 0.86, 0.98], dust: [0.52, 0.54, 0.60], fx: 'shard' },
  flying:   { hot: [1.35, 1.30, 1.65], main: [0.70, 0.62, 1.05], ember: [0.76, 0.70, 1.15], dust: [0.50, 0.48, 0.60], fx: 'slash' },
  bug:      { hot: [1.35, 1.50, 0.70], main: [0.72, 0.85, 0.18], ember: [0.78, 0.92, 0.26], dust: [0.50, 0.56, 0.30], fx: 'puff' },
  poison:   { hot: [1.45, 0.90, 1.45], main: [0.85, 0.28, 0.85], ember: [0.80, 0.36, 0.95], dust: [0.46, 0.36, 0.48], fx: 'bubble' },
};
/** Palette for a type; unknown types derive one from the shared type colour table. */
function pal(type) {
  if (PAL[type]) return PAL[type];
  const c = TYPE_COLORS[type] || [0.85, 0.84, 0.78];
  return { hot: [Math.min(1.7, 0.6 + c[0]), Math.min(1.7, 0.6 + c[1]), Math.min(1.7, 0.6 + c[2])],
           main: [c[0] * 1.2, c[1] * 1.2, c[2] * 1.2],
           ember: [c[0] * 1.1, c[1] * 1.05, c[2] * 1.0],
           dust: [c[0] * 0.7, c[1] * 0.68, c[2] * 0.58], fx: 'puff' };
}

/* -------------------------------------------------------------- sprite pool

   Two layers, one dynamic mesh each, both drawn with additive blending:
     L0 LIT   — bright fire/energy, positive vertex colour (adds light)
     L1 SMOKE — negative vertex colour, so inside an additive pass a puff
                *subtracts* light and reads as a dark silhouette/smoke bank over
                both the arena and the fire (a second blend mode is not needed,
                and per-sprite alpha keeps working through the vertex colour). */

const LCAP = [900, 320];
const live = [[], []];            // [lit, smoke]
const free = [];                  // recycled records

function claim() {
  const p = free.pop() || {};
  p.layer = 0;
  p.cell = 0;
  p.x = p.y = p.z = 0;
  p.vx = p.vy = p.vz = 0;
  p.life = 0.5; p.max = 0.5; p.hold = 0;
  p.s0 = 0.3; p.s1 = null; p.spin = 0;
  p.r0 = 1; p.g0 = 1; p.b0 = 1; p.r1 = 1; p.g1 = 1; p.b1 = 1;
  p.a0 = 1; p.a1 = 0; p.fade = 2; p.fadeIn = 0;
  p.grav = 0; p.drag = 1; p.turb = 0; p.seed = 0;
  p.roll = 0; p.stretch = 0; p.flat = 0;
  p.tx = 0; p.ty = 0; p.tz = 0; p.tk = 0;
  p.em = 0; p.emN = 0; p.emAcc = 0;
  return p;
}

function put(p) {
  const a = live[p.layer];
  if (a.length >= LCAP[p.layer]) { const o = a.shift(); o.life = 0; free.push(o); }
  a.push(p);
}

/** Emission config scratch — set fields, then Emit() (no per-particle allocation). */
const E = {};
function Ereset() {
  E.cell = 0; E.x = E.y = E.z = 0; E.vx = E.vy = E.vz = 0;
  E.life = 0.5; E.s0 = 0.3; E.s1 = null;
  E.r = 1; E.g = 1; E.b = 1; E.r1 = null; E.g1 = null; E.b1 = null;
  E.a0 = 1; E.a1 = 0; E.fade = 2; E.fadeIn = 0; E.hold = 0;
  E.grav = 0; E.drag = 1; E.turb = 0; E.roll = 0; E.spin = 0;
  E.stretch = 0; E.flat = 0; E.em = 0; E.emN = 0;
  E.tx = E.ty = E.tz = 0; E.tk = 0;
  E.layer = 0;
}
Ereset();

/** Flush the scratch config into a live sprite. */
function Emit() {
  const p = claim();
  p.layer = E.layer;
  p.cell = E.cell;
  p.x = E.x; p.y = E.y; p.z = E.z;
  p.vx = E.vx; p.vy = E.vy; p.vz = E.vz;
  p.life = p.max = E.life; p.hold = E.hold;
  p.s0 = E.s0; p.s1 = E.s1 == null ? E.s0 : E.s1;
  p.r0 = E.r; p.g0 = E.g; p.b0 = E.b;
  p.r1 = E.r1 == null ? E.r : E.r1; p.g1 = E.g1 == null ? E.g : E.g1; p.b1 = E.b1 == null ? E.b : E.b1;
  p.a0 = E.a0; p.a1 = E.a1; p.fade = E.fade; p.fadeIn = E.fadeIn;
  p.grav = E.grav; p.drag = E.drag; p.turb = E.turb; p.seed = Math.random() * 20;
  p.roll = E.roll; p.spin = E.spin; p.stretch = E.stretch; p.flat = E.flat ? 1 : 0;
  p.tx = E.tx; p.ty = E.ty; p.tz = E.tz; p.tk = E.tk;
  p.em = E.em; p.emN = E.emN; p.emAcc = 0;
  put(p);
  Ereset();
  return p;
}

/* ------------------------------------------------------- mesh + overlay init */

let state_ = null;
let meshPart = null, smokePart = null, fxEnt = null;
const overlay = {};

function ensureOverlay() {
  if (overlay.root && overlay.root.parentNode) return overlay.root;
  const host = document.getElementById('topui') || document.body;
  let root = document.getElementById('cinema');
  if (!root) {
    root = document.createElement('div');
    root.id = 'cinema';
    host.appendChild(root);
  }
  root.innerHTML = '';
  root.className = 'on';
  root.setAttribute('style',
    'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6;opacity:1;' +
    'transition:none;background:none;');
  const sub = (css) => { const d = document.createElement('div'); d.setAttribute('style', css); root.appendChild(d); return d; };
  overlay.root = root;
  overlay.wash = sub('position:absolute;inset:0;opacity:0;');
  overlay.sky = sub('position:absolute;inset:0;opacity:0;mix-blend-mode:multiply;');
  overlay.vig = sub('position:absolute;inset:0;opacity:0;');
  overlay.flash = sub('position:absolute;inset:0;opacity:0;background:#fff;');
  overlay.barT = sub('position:absolute;left:0;right:0;top:0;height:0;background:#05060a;');
  overlay.barB = sub('position:absolute;left:0;right:0;bottom:0;height:0;background:#05060a;');
  return root;
}

const WASH = {
  zPose: 'radial-gradient(ellipse 66% 62% at 50% 52%, rgba(255,255,255,0.34) 0%,' +
         ' rgba(176,246,255,0.34) 16%, rgba(52,160,240,0.44) 40%, rgba(12,38,96,0.78) 72%,' +
         ' rgba(2,7,22,0.9) 100%)',
  // Strike: dark warm edges, a low-alpha warm centre so the 3D fire (not the overlay)
  // supplies the structure (bar: Inferno_Overdrive_VII.png).
  zStrike: 'linear-gradient(to bottom, rgba(4,1,0,0.9) 0%, rgba(34,6,0,0.74) 18%,' +
           ' rgba(104,24,2,0.44) 40%, rgba(158,52,4,0.3) 58%, rgba(70,14,0,0.68) 84%,' +
           ' rgba(3,1,0,0.94) 100%),' +
           ' radial-gradient(ellipse 62% 54% at 46% 60%, rgba(255,236,196,0.26) 0%,' +
           ' rgba(255,148,40,0.16) 28%, rgba(150,28,0,0.06) 56%, rgba(0,0,0,0) 80%)',
  fire: 'radial-gradient(ellipse 72% 64% at 50% 60%, rgba(255,150,40,0.16) 0%, rgba(240,86,10,0.5) 32%,' +
        ' rgba(150,30,0,0.8) 68%, rgba(12,2,0,0.94) 100%)',
  heal: 'radial-gradient(ellipse 60% 50% at 50% 62%, rgba(210,255,220,0.34) 0%, rgba(30,160,90,0.12) 60%, rgba(0,0,0,0) 100%)',
};
/* Fire sky: black smoke overhead, a hot band at the horizon, black ground under it —
   the `Inferno_Overdrive_VII_2.png` composition. Multiplied under the fire sprites. */
const SKY_FIRE = 'linear-gradient(to bottom, rgba(12,3,0,0.95) 0%, rgba(56,10,1,0.88) 26%,' +
                 ' rgba(206,62,6,0.6) 46%, rgba(255,156,48,0.3) 58%, rgba(255,220,150,0.16) 66%,' +
                 ' rgba(104,20,0,0.84) 84%, rgba(6,1,0,0.96) 100%)';
/* Charge sky: the ally reads against a bright, bleached sky while power gathers. */
const SKY_CHARGE = 'linear-gradient(to bottom, rgba(210,248,255,0.5) 0%, rgba(120,206,246,0.4) 34%,' +
                   ' rgba(26,74,140,0.5) 62%, rgba(6,14,34,0.72) 100%)';
const SKY = { fire: SKY_FIRE, charge: SKY_CHARGE };
const VIG = 'radial-gradient(ellipse 80% 76% at 50% 52%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.55) 76%, rgba(0,0,0,0.94) 100%)';

const ov = { wash: 0, washT: 0, washMode: null, sky: 0, skyT: 0, skyMode: 'fire',
             vig: 0, vigT: 0, flash: 0, bars: 0, barsT: 0 };

function setFlash(a, col) {
  ov.flash = Math.max(ov.flash, a);
  if (overlay.flash && col) overlay.flash.style.background = col;
}
function setWash(mode, a) { ov.washMode = mode; ov.washT = a; }
function setVig(a) { ov.vigT = a; }
function setSky(a, mode) { ov.skyT = a; if (mode) ov.skyMode = mode; }
function setBars(a) { ov.barsT = a; }

/* --------------------------------------------------- battlefield fire "set" */

/**
 * While the Z-Strike burns, the arena itself is inside the firestorm: distance fog
 * lifts to a fire-orange wall (so the beach and palms dissolve instead of showing
 * through the glow), the key light turns to firelight and the clear colour goes to
 * ember black. All three are borrowed and put back untouched — nothing else writes
 * them, and sprite quads are unlit, so the fire is immune to the fog it creates.
 */
const envSave = { on: false, fog: null, light: null, clear: null };

function enterFireEnv(state) {
  if (envSave.on) return;
  envSave.on = true;
  envSave.fog = state.fog; envSave.light = state.light; envSave.clear = state.clearColor;
  const dir = (state.light && state.light.dir) || [-0.45, 0.82, 0.35];
  state.fog = { col: [1.0, 0.34, 0.07], near: 0.5, far: 13 };
  state.light = { dir, col: [1.25, 0.5, 0.18], sky: [0.6, 0.2, 0.06], gnd: [0.3, 0.09, 0.03], rim: 0.5 };
  state.clearColor = [0.09, 0.022, 0.006];
}

function exitFireEnv(state) {
  if (!envSave.on) return;
  envSave.on = false;
  state.fog = envSave.fog; state.light = envSave.light; state.clearColor = envSave.clear;
  envSave.fog = envSave.light = envSave.clear = null;
}

/** Fade the whole screen overlay back out after `delay` seconds (simulation time). */
function clearOverlayAfter(delay) {
  timers.push({ t: delay, res: () => {
    setWash(null, 0); setSky(0); setVig(0); setBars(0);
    if (state_) { exitFireEnv(state_); state_.flash = 0; }
  } });
}

export function init(state, ctx) {
  state_ = state;
  const gl = ctx || state.ctx;
  const atlas = gl.texture(buildAtlas());
  const litMat = { col: [1, 1, 1], unlit: true, blend: 'add', doubleSided: true,
                   cull: 'none', texMode: 1, tex: atlas, toon: 0 };
  meshPart = Object.assign({ geo: geo.dynMesh(LCAP[0] * 4, LCAP[0] * 6) }, litMat);
  smokePart = Object.assign({ geo: geo.dynMesh(LCAP[1] * 4, LCAP[1] * 6) }, litMat);
  fxEnt = { model: { parts: [smokePart, meshPart] }, pos: [0, 0, 0], transient: true, fx: true };
  state.add(fxEnt);
  ensureOverlay();
  live[0].length = 0; live[1].length = 0; free.length = 0;
  timers.length = 0; movers.length = 0;
  cine.mode = null; cine.step = null; cine.ambient = null;
  state.fx = { live: 0, cap: CAP, movers: 0, cine: null };
}

/* ------------------------------------------------------------------ rebuild */

const RB = { f: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0] };

/** Write one layer's live sprites into its dynamic mesh as camera-facing (or flat) quads. */
function rebuildLayer(state, list, part) {
  const g = part.geo;
  const [f0, f1, f2] = RB.f, [r0, r1, r2] = RB.r, [u0, u1, u2] = RB.u;
  const pos = g.pos, nrm = g.nrm, col = g.col, uv = g.uv, idx = g.idx;
  let vi = 0, ii = 0, qi = 0;

  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const alive = p.max - p.life;
    const span = p.max - p.hold;
    let u = span > 0.0001 ? (alive - p.hold) / span : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const w = 1 - u;
    let f;
    switch (p.fade) {
      case 0: f = 1; break;
      case 1: f = w; break;
      case 3: f = w * w * w; break;
      case 4: f = w * w * w * w; break;
      default: f = w * w;
    }
    let a = (p.a0 + (p.a1 - p.a0) * u) * f;
    if (p.fadeIn > 0 && alive < p.fadeIn) a *= alive / p.fadeIn;
    if (a <= 0.0025) continue;
    const s = lerp(p.s0, p.s1, u);
    if (s <= 0.0008) continue;

    let e1x, e1y, e1z, e2x, e2y, e2z;
    if (p.flat) {
      const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
      e1x = cr; e1y = 0; e1z = sr;
      e2x = -sr; e2y = 0; e2z = cr;
    } else if (p.stretch > 0) {
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      if (sp > 0.05) {
        const pr = p.vx * r0 + p.vy * r1 + p.vz * r2;
        const pu = p.vx * u0 + p.vy * u1 + p.vz * u2;
        const pl = Math.hypot(pr, pu) || 1;
        e1x = (r0 * pr + u0 * pu) / pl; e1y = (r1 * pr + u1 * pu) / pl; e1z = (r2 * pr + u2 * pu) / pl;
        e2x = (r0 * pu - u0 * pr) / pl; e2y = (r1 * pu - u1 * pr) / pl; e2z = (r2 * pu - u2 * pr) / pl;
      } else {
        const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
        e1x = r0 * cr + u0 * sr; e1y = r1 * cr + u1 * sr; e1z = r2 * cr + u2 * sr;
        e2x = u0 * cr - r0 * sr; e2y = u1 * cr - r1 * sr; e2z = u2 * cr - r2 * sr;
      }
    } else if (p.roll !== 0) {
      const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
      e1x = r0 * cr + u0 * sr; e1y = r1 * cr + u1 * sr; e1z = r2 * cr + u2 * sr;
      e2x = u0 * cr - r0 * sr; e2y = u1 * cr - r1 * sr; e2z = u2 * cr - r2 * sr;
    } else {
      e1x = r0; e1y = r1; e1z = r2;
      e2x = u0; e2y = u1; e2z = u2;
    }

    const L = s * (1 + p.stretch) * 0.5, W = s * 0.5;
    const cr = lerp(p.r0, p.r1, u) * a, cg = lerp(p.g0, p.g1, u) * a, cb = lerp(p.b0, p.b1, u) * a;
    const rect = UV[p.cell];
    const b = vi;
    for (let k = 0; k < 4; k++) {
      const sx = (k === 0 || k === 3) ? -1 : 1;
      const sy = (k < 2) ? -1 : 1;
      vi = b + k;
      pos[vi * 3] = p.x + e1x * sx * L + e2x * sy * W;
      pos[vi * 3 + 1] = p.y + e1y * sx * L + e2y * sy * W;
      pos[vi * 3 + 2] = p.z + e1z * sx * L + e2z * sy * W;
      nrm[vi * 3] = -f0; nrm[vi * 3 + 1] = -f1; nrm[vi * 3 + 2] = -f2;
      col[vi * 3] = cr; col[vi * 3 + 1] = cg; col[vi * 3 + 2] = cb;
      uv[vi * 2] = sx > 0 ? rect[2] : rect[0];
      uv[vi * 2 + 1] = sy < 0 ? rect[3] : rect[1];
    }
    vi = b + 4;
    idx[ii++] = b; idx[ii++] = b + 1; idx[ii++] = b + 3;
    idx[ii++] = b + 1; idx[ii++] = b + 2; idx[ii++] = b + 3;
    qi++;
  }

  if (vi === 0) { g.count = 0; g.idxCount = 0; }
  else { g.count = vi; g.idxCount = ii; }
  const m = state.ctx.sync(part, vi);
  if (m) m.idxCount = ii;
  return qi;
}

/** Write every live sprite into its layer's dynamic mesh (one draw call per layer). */
function rebuild(state) {
  if (!meshPart) return 0;
  const cam = state.cam;
  let f0 = cam.look[0] - cam.pos[0], f1 = cam.look[1] - cam.pos[1], f2 = cam.look[2] - cam.pos[2];
  const fl = Math.hypot(f0, f1, f2) || 1;
  f0 /= fl; f1 /= fl; f2 /= fl;
  let r0 = f2, r2 = -f0;
  const rl = Math.hypot(r0, r2) || 1;
  r0 /= rl; r2 /= rl;
  RB.f[0] = f0; RB.f[1] = f1; RB.f[2] = f2;
  RB.r[0] = r0; RB.r[1] = 0; RB.r[2] = r2;
  RB.u[0] = f1 * r2; RB.u[1] = f2 * r0 - f0 * r2; RB.u[2] = -f1 * r0;
  return rebuildLayer(state, live[0], meshPart) + rebuildLayer(state, live[1], smokePart);
}

/* ------------------------------------------------------------------- update */

const timers = [];
const movers = [];
const cine = { mode: null, t: 0, dur: 0, step: null, ambient: null };

function after(sec) { return new Promise(res => timers.push({ t: sec, res })); }

/** Physics + self-emission for one sprite. */
function stepSprite(p, dt, t) {
  if (p.tk > 0) {
    const k = Math.min(1, p.tk * dt);
    p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.z += (p.tz - p.z) * k;
    p.vx *= 0.94; p.vy *= 0.94; p.vz *= 0.94;
  } else {
    if (p.turb > 0) {
      const s = p.seed;
      p.vx += Math.sin(t * 3.1 + s) * p.turb * dt;
      p.vy += Math.cos(t * 2.7 + s * 1.7) * p.turb * dt;
      p.vz += Math.sin(t * 2.3 + s * 2.3) * p.turb * dt;
    }
    if (p.drag !== 1) { const d = Math.pow(p.drag, dt * 60); p.vx *= d; p.vy *= d; p.vz *= d; }
    if (p.grav) p.vy += p.grav * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
  }
  if (p.spin) p.roll += p.spin * dt;

  if (p.em && p.emN > 0) {
    const rate = p.em === 1 ? 1 / 55 : 1 / 40;
    p.emAcc += dt;
    while (p.emAcc >= rate && p.emN > 0) {
      p.emAcc -= rate;
      p.emN--;
      const u = 1 - p.life / p.max;
      if (p.em === 1) {                        // fire: ember flecks + warm smoke
        if (Math.random() < 0.72) {
          E.cell = CI.spark; E.x = p.x + rr(-0.25, 0.25) * p.s0; E.y = p.y + rr(-0.2, 0.35) * p.s0;
          E.z = p.z + rr(-0.25, 0.25) * p.s0;
          E.vx = rr(-1.6, 1.6); E.vy = rr(0.4, 3.4); E.vz = rr(-1.6, 1.6);
          E.life = rr(0.5, 1.3); E.s0 = rr(0.05, 0.13); E.s1 = 0.01;
          const c = p.r0 > p.b0 ? [1.5, 0.62, 0.16] : [lerp(p.r0, p.r1, u) * 2, lerp(p.g0, p.g1, u) * 1.6, lerp(p.b0, p.b1, u) * 1.2];
          E.r = c[0]; E.g = c[1]; E.b = c[2];
          E.a0 = 0.9; E.a1 = 0; E.fade = 2; E.drag = 0.94; E.grav = -1.4; E.stretch = 1.4;
          Emit();
        } else {
          E.cell = CI.smoke; E.x = p.x + rr(-0.4, 0.4); E.y = p.y + rr(0, 0.6); E.z = p.z + rr(-0.4, 0.4);
          E.vx = rr(-0.3, 0.3); E.vy = rr(0.5, 1.5); E.vz = rr(-0.3, 0.3);
          E.life = rr(0.7, 1.4); E.s0 = p.s0 * 0.7; E.s1 = p.s0 * 2.4;
          E.r = 0.34; E.g = 0.22; E.b = 0.14; E.a0 = 0.18; E.a1 = 0; E.fade = 2; E.drag = 0.96;
          Emit();
        }
      }
    }
  }
  return p.life;
}

export function update(state, dt, t) {
  state_ = state;
  if (!meshPart) return;
  if (state.entities.indexOf(fxEnt) < 0) state.add(fxEnt);   // battle.js softReset drops transients

  for (let i = timers.length - 1; i >= 0; i--) {
    const T = timers[i];
    T.t -= dt;
    if (T.t <= 0) { timers.splice(i, 1); T.res(); }
  }

  for (let i = movers.length - 1; i >= 0; i--) {
    const m = movers[i];
    m.t += dt;
    if (m.step(dt)) {
      movers.splice(i, 1);
      if (m.end) m.end();
      if (m.res) m.res();
    }
  }

  if (cine.step) { cine.t += dt; cine.step(dt); }

  if (state.flash > 0) {                       // full-frame 3D flash, decayed in sim time
    state.flash *= Math.exp(-9 * dt);
    if (state.flash < 0.004) state.flash = 0;
  }

  for (let L = 0; L < live.length; L++) {
    const list = live[L];
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); free.push(p); continue; }
      stepSprite(p, dt, t);
    }
  }

  const n = rebuild(state);
  if (cine.ambient && state.cinematic === cine.mode) cine.ambient(dt);

  paintOverlay(dt);
  state.fx = { live: n, cap: CAP, movers: movers.length, cine: state.cinematic || null,
               cineT: cine.step ? cine.t : 0, phase: cine.phase || null };
}

/* ------------------------------------------------------------------ overlay */

function paintOverlay(dt) {
  if (!overlay.root) return;
  const k = 1 - Math.exp(-7 * dt);
  ov.wash += (ov.washT - ov.wash) * k;
  ov.sky += (ov.skyT - ov.sky) * (1 - Math.exp(-3.4 * dt));
  ov.vig += (ov.vigT - ov.vig) * (1 - Math.exp(-5 * dt));
  ov.bars += (ov.barsT - ov.bars) * (1 - Math.exp(-4 * dt));
  ov.flash *= Math.exp(-9.5 * dt);
  if (ov.flash < 0.002) ov.flash = 0;

  if (ov.washMode && overlay.wash.dataset.mode !== ov.washMode) {
    overlay.wash.style.background = WASH[ov.washMode] || 'none';
    overlay.wash.dataset.mode = ov.washMode;
  }
  overlay.wash.style.opacity = ov.wash.toFixed(3);
  overlay.sky.style.opacity = ov.sky.toFixed(3);
  if (overlay.sky.dataset.mode !== ov.skyMode) {
    overlay.sky.style.background = SKY[ov.skyMode] || SKY_FIRE;
    overlay.sky.dataset.mode = ov.skyMode;
  }
  overlay.vig.style.opacity = ov.vig.toFixed(3);
  if (overlay.vig.dataset.mode !== 'v') {
    overlay.vig.style.background = VIG;
    overlay.vig.dataset.mode = 'v';
  }
  overlay.flash.style.opacity = ov.flash.toFixed(3);
  overlay.barT.style.height = `${(ov.bars * 9).toFixed(2)}%`;
  overlay.barB.style.height = `${(ov.bars * 9).toFixed(2)}%`;
}

/** Cue other modules (hud/camera may read state.events). */
function cue(state, kind, data) { state.emit(kind, data); }

/* --------------------------------------------------------------- positioning */

const posOf = (state, side) => {
  const u = state.units[side === 'player' ? 'player' : 'foe'];
  return u && u.entity ? u.entity.pos : [0, 0, 0];
};
const heightOf = (state, side) => (state.units[side] && state.units[side].focusHeight) || 0.6;
const groundOf = state => (state.groundY != null ? state.groundY : 0);

/**
 * Where a hit visually lands on a battler. Tall species (Alolan Exeggutor, 9 m) would
 * put the burst above the frame on `focusHeight` alone, so the contact point is clamped
 * into the framed band while the shock column still climbs the full body.
 */
const hitOffset = h => (h > 2 ? Math.min(h, 2.6) : h * 0.9);

/* ----------------------------------------------------------- small emitters */

/** Radial burst of stretched streaks. */
function sparks(x, y, z, n, spd, col, life, size, grav) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, e = rr(-0.35, 1.1), s = spd * rr(0.45, 1.2);
    E.cell = CI.spark; E.x = x + rr(-0.15, 0.15); E.y = y + rr(-0.15, 0.15); E.z = z + rr(-0.15, 0.15);
    E.vx = Math.cos(a) * Math.cos(e) * s; E.vy = Math.sin(e) * s; E.vz = Math.sin(a) * Math.cos(e) * s;
    E.life = life * rr(0.6, 1.25); E.s0 = size * rr(0.55, 1.25); E.s1 = size * 0.25;
    E.r = col[0] * 1.5; E.g = col[1] * 1.5; E.b = col[2] * 1.5;
    E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.92; E.grav = grav; E.stretch = 1.7;
    Emit();
  }
}

/** Soft smoke / haze puffs. */
function smoke(x, y, z, n, spread, rise, col, alpha, s0, s1, life) {
  for (let i = 0; i < n; i++) {
    E.cell = CI.smoke;
    E.x = x + rr(-spread, spread); E.y = y + rr(-spread * 0.4, spread * 0.6); E.z = z + rr(-spread, spread);
    E.vx = rr(-0.5, 0.5); E.vy = rise * rr(0.5, 1.3); E.vz = rr(-0.5, 0.5);
    E.life = life * rr(0.7, 1.3); E.s0 = s0 * rr(0.7, 1.2); E.s1 = s1 * rr(0.8, 1.4);
    E.r = col[0]; E.g = col[1]; E.b = col[2];
    E.a0 = alpha * rr(0.7, 1.15); E.a1 = 0; E.fade = 2; E.drag = 0.95; E.turb = 0.5;
    Emit();
  }
}

/** Ground dust kicked up at the feet of a battler (scales with the target's size). */
function dustKick(x, z, n, rad, scale, tint, spd) {
  const gy = groundOf(state_) + 0.05;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, s = spd * rr(0.5, 1.2);
    E.cell = CI.dust;
    E.x = x + Math.cos(a) * rad * rr(0, 0.7); E.y = gy + rr(0, 0.18 * scale); E.z = z + Math.sin(a) * rad * rr(0, 0.7);
    E.vx = Math.cos(a) * s; E.vy = rr(0.25, 1.2) * scale; E.vz = Math.sin(a) * s;
    E.life = rr(0.55, 1.05); E.s0 = 0.22 * scale * rr(0.7, 1.2); E.s1 = 0.95 * scale * rr(0.8, 1.4);
    E.r = tint[0]; E.g = tint[1]; E.b = tint[2];
    E.a0 = 0.85 * rr(0.7, 1.1); E.a1 = 0; E.fade = 2; E.drag = 0.9; E.grav = -0.5;
    Emit();
  }
}

/** Flat ring on the ground plane. */
function groundRing(x, z, s0, s1, col, life, alpha, y) {
  E.cell = CI.ring; E.flat = 1;
  E.x = x; E.y = (y != null ? y : groundOf(state_) + 0.045); E.z = z;
  E.s0 = s0; E.s1 = s1; E.life = life; E.r = col[0]; E.g = col[1]; E.b = col[2];
  E.a0 = alpha; E.a1 = 0; E.fade = 1; E.hold = 0.03;
  Emit();
}

/** Camera-facing expanding ring. */
function airRing(x, y, z, s0, s1, col, life, alpha) {
  E.cell = CI.ring; E.x = x; E.y = y; E.z = z;
  E.s0 = s0; E.s1 = s1; E.life = life; E.r = col[0]; E.g = col[1]; E.b = col[2];
  E.a0 = alpha; E.a1 = 0; E.fade = 1; E.hold = 0.03;
  Emit();
}

/* ------------------------------------------------------------------ projectiles */

/** Trajectory + trail personality per type. */
function projCfg(type, arc) {
  const p = pal(type);
  switch (p.fx) {
    case 'flame':  return { head: CI.flame, size: 0.95, glow: 2.1, dur: 0.62, lob: arc ? 2.2 : 0.42, lat: arc ? 0.8 : 0.18,
                            step: 0.014, col: p.main, hot: p.hot, ember: p.ember, spin: 2.2, em: 0 };
    case 'seed':   return { head: CI.seed,  size: 0.38, glow: 1.2, dur: 0.86, lob: arc ? 2.6 : 0.5, lat: arc ? 0.85 : 0.2,
                            step: 0.02, col: p.main, hot: p.hot, ember: p.ember, spin: 13, em: 0 };
    case 'bubble': return { head: CI.bubble, size: 0.40, glow: 1.4, dur: 0.60, lob: arc ? 1.6 : 0.85, lat: 0.25,
                            step: 0.016, col: p.main, hot: p.hot, ember: p.ember, spin: 0, em: 0 };
    case 'ripple': return { head: CI.ripple, size: 0.58, glow: 1.6, dur: 0.74, lob: 0.3, lat: 0.15,
                            step: 0.02, col: p.main, hot: p.hot, ember: p.ember, spin: 3.4, em: 0 };
    case 'shard':  return { head: CI.shard, size: 0.48, glow: 1.4, dur: 0.52, lob: arc ? 1.4 : 0.18, lat: 0.3,
                            step: 0.014, col: p.main, hot: p.hot, ember: p.ember, spin: 8, em: 0 };
    case 'spark':  return { head: CI.spark, size: 0.44, glow: 1.5, dur: 0.5, lob: 0.4, lat: 0.4, step: 0.012,
                            col: p.main, hot: p.hot, ember: p.ember, spin: 6, em: 0 };
    case 'slash':  return { head: CI.slash, size: 0.58, glow: 1.4, dur: 0.52, lob: 0.3, lat: 0.5, step: 0.014,
                            col: p.main, hot: p.hot, ember: p.ember, spin: 5, em: 0 };
    case 'star':   return { head: CI.star, size: 0.48, glow: 1.6, dur: 0.66, lob: 0.9, lat: 0.5, step: 0.016,
                            col: p.main, hot: p.hot, ember: p.ember, spin: 3, em: 0 };
    case 'bokeh':  return { head: CI.bokeh, size: 0.54, glow: 1.5, dur: 0.72, lob: 0.5, lat: 0.3, step: 0.018,
                            col: p.main, hot: p.hot, ember: p.ember, spin: 2, em: 0 };
    case 'dust':   return { head: CI.dust, size: 0.44, glow: 1.3, dur: 0.6, lob: 0.5, lat: 0.2, step: 0.016,
                            col: p.main, hot: p.hot, ember: p.ember, spin: 4, em: 0 };
    default:       return { head: CI.puff, size: 0.46, glow: 1.4, dur: 0.6, lob: 0.55, lat: 0.25, step: 0.016,
                            col: p.main, hot: p.hot, ember: p.ember, spin: 2, em: 0 };
  }
}

function spawnProjectile(state, opts) {
  const from = posOf(state, opts.from === 'foe' ? 'foe' : 'player');
  const to = posOf(state, opts.to);
  const cfg = projCfg(opts.type, opts.arc);
  const y0 = from[1] + Math.max(0.35, heightOf(state, opts.from) * 0.55);
  const y1 = to[1] + hitOffset(heightOf(state, opts.to));
  const A = [from[0], y0, from[2]], B = [to[0], y1, to[2]];
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
  const dl = Math.hypot(dx, dz) || 1;
  const sxDir = -dz / dl, szDir = dx / dl;                  // lateral axis
  const latAmp = cfg.lat * Math.min(1, dl / 5);
  const dur = cfg.dur * (0.85 + Math.min(0.35, dl / 24));
  const p = pal(opts.type);
  let acc = 0, pos = [A[0], A[1], A[2]], vel = [0, 0, 0], prev = [A[0], A[1], A[2]];

  const at = (u) => {
    const lob = cfg.lob * 4 * u * (1 - u);
    const wob = Math.sin(u * Math.PI * (opts.arc ? 2.2 : 1.4)) * latAmp;
    return [A[0] + dx * u + sxDir * wob, A[1] + dy * u + lob, A[2] + dz * u + szDir * wob];
  };

  movers.push({
    t: 0, dur, name: 'projectile',
    step(dt) {
      const u = clamp(this.t / dur, 0, 1);
      prev = pos;
      pos = at(u);
      vel = [(pos[0] - prev[0]) / Math.max(dt, 1e-4), (pos[1] - prev[1]) / Math.max(dt, 1e-4), (pos[2] - prev[2]) / Math.max(dt, 1e-4)];
      acc += dt;
      while (acc >= cfg.step) {
        acc -= cfg.step;
        const j = 0.03;
        // fireball head: hot core + soft bloom behind it
        E.cell = cfg.head; E.x = pos[0]; E.y = pos[1]; E.z = pos[2];
        E.vx = vel[0] * 0.06; E.vy = vel[1] * 0.06; E.vz = vel[2] * 0.06;
        E.life = 0.075; E.s0 = cfg.size * rr(0.92, 1.12); E.s1 = cfg.size * 0.9;
        E.r = cfg.hot[0]; E.g = cfg.hot[1]; E.b = cfg.hot[2];
        E.a0 = 1; E.a1 = 0.85; E.fade = 0; E.spin = rr(-3, 3);
        Emit();
        E.cell = CI.glow; E.x = pos[0]; E.y = pos[1]; E.z = pos[2];
        E.vx = vel[0] * 0.04; E.vy = vel[1] * 0.04; E.vz = vel[2] * 0.04;
        E.life = 0.11; E.s0 = cfg.size * cfg.glow * rr(0.9, 1.1); E.s1 = cfg.size * cfg.glow * 0.8;
        E.r = cfg.col[0] * 0.9; E.g = cfg.col[1] * 0.62; E.b = cfg.col[2] * 0.4;
        E.a0 = 0.5; E.a1 = 0.2; E.fade = 0;
        Emit();
        // ribbon: trailing body left behind (no self-emission — this is the tail)
        E.cell = cfg.head;
        E.x = pos[0] + rr(-j, j); E.y = pos[1] + rr(-j, j); E.z = pos[2] + rr(-j, j);
        E.vx = -vel[0] * 0.06; E.vy = rr(-0.15, 0.7) - vel[1] * 0.04; E.vz = -vel[2] * 0.06;
        E.life = rr(0.17, 0.3); E.s0 = cfg.size * rr(0.6, 0.85); E.s1 = cfg.size * 0.2;
        E.r = cfg.col[0] * 1.35; E.g = cfg.col[1] * 1.3; E.b = cfg.col[2] * 1.2;
        E.a0 = 0.85; E.a1 = 0; E.fade = 2; E.drag = 0.86; E.spin = rr(-4, 4);
        Emit();
        // streak smear along velocity
        E.cell = CI.slash; E.x = pos[0]; E.y = pos[1]; E.z = pos[2];
        E.vx = vel[0]; E.vy = vel[1]; E.vz = vel[2];
        E.life = 0.08; E.s0 = cfg.size * 0.8; E.s1 = cfg.size * 0.6;
        E.r = cfg.hot[0] * 1.05; E.g = cfg.hot[1] * 0.72; E.b = cfg.hot[2] * 0.4;
        E.a0 = 0.3; E.a1 = 0; E.fade = 2; E.stretch = 1.6;
        Emit();
        // embers / droplets / motes
        if (p.fx === 'flame') {
          E.cell = CI.spark;
          E.x = pos[0] + rr(-0.12, 0.12); E.y = pos[1] + rr(-0.12, 0.12); E.z = pos[2] + rr(-0.12, 0.12);
          E.vx = -vel[0] * 0.2 + rr(-1.4, 1.4); E.vy = rr(0.4, 2.6); E.vz = -vel[2] * 0.2 + rr(-1.4, 1.4);
          E.life = rr(0.3, 0.7); E.s0 = rr(0.05, 0.11); E.s1 = 0.01;
          E.r = 1.6; E.g = 0.72; E.b = 0.18;
          E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.93; E.grav = -2.4; E.stretch = 1.5;
          Emit();
        } else if (p.fx === 'bubble') {
          E.cell = CI.bubble;
          E.x = pos[0] + rr(-0.16, 0.16); E.y = pos[1] + rr(-0.16, 0.16); E.z = pos[2] + rr(-0.16, 0.16);
          E.vx = -vel[0] * 0.12 + rr(-0.8, 0.8); E.vy = rr(-0.4, 1.2); E.vz = -vel[2] * 0.12 + rr(-0.8, 0.8);
          E.life = rr(0.25, 0.5); E.s0 = rr(0.07, 0.15); E.s1 = 0.03;
          E.r = p.ember[0]; E.g = p.ember[1]; E.b = p.ember[2];
          E.a0 = 0.9; E.a1 = 0; E.fade = 2; E.drag = 0.93; E.grav = -3.2;
          Emit();
        } else if (p.fx === 'seed') {
          E.cell = CI.seed;
          E.x = pos[0] + rr(-0.2, 0.2); E.y = pos[1] + rr(-0.2, 0.2); E.z = pos[2] + rr(-0.2, 0.2);
          E.vx = -vel[0] * 0.1 + rr(-1, 1); E.vy = rr(0, 1.4); E.vz = -vel[2] * 0.1 + rr(-1, 1);
          E.life = rr(0.35, 0.7); E.s0 = rr(0.08, 0.16); E.s1 = 0.03;
          E.r = p.ember[0]; E.g = p.ember[1]; E.b = p.ember[2];
          E.a0 = 0.85; E.a1 = 0; E.fade = 2; E.drag = 0.94; E.grav = -1.8; E.spin = rr(4, 12);
          Emit();
        } else if (p.fx === 'ripple') {
          E.cell = CI.ripple;
          E.x = pos[0]; E.y = pos[1]; E.z = pos[2];
          E.life = 0.3; E.s0 = 0.25; E.s1 = 1.5;
          E.r = p.main[0] * 1.3; E.g = p.main[1] * 1.3; E.b = p.main[2] * 1.3;
          E.a0 = 0.65; E.a1 = 0; E.fade = 2; E.spin = 1.4;
          Emit();
        } else if (p.fx === 'shard') {
          E.cell = CI.shard;
          E.x = pos[0] + rr(-0.2, 0.2); E.y = pos[1] + rr(-0.2, 0.2); E.z = pos[2] + rr(-0.2, 0.2);
          E.vx = -vel[0] * 0.15 + rr(-1.2, 1.2); E.vy = rr(-0.6, 1.6); E.vz = -vel[2] * 0.15 + rr(-1.2, 1.2);
          E.life = rr(0.2, 0.45); E.s0 = rr(0.09, 0.18); E.s1 = 0.02;
          E.r = p.ember[0]; E.g = p.ember[1]; E.b = p.ember[2];
          E.a0 = 0.8; E.a1 = 0; E.fade = 2; E.drag = 0.9; E.stretch = 1.2; E.spin = rr(-8, 8);
          Emit();
        }
        if (p.fx === 'flame' && Math.random() < 0.4) {
          E.cell = CI.smoke;
          E.x = pos[0] + rr(-0.15, 0.15); E.y = pos[1] + rr(-0.1, 0.2); E.z = pos[2] + rr(-0.15, 0.15);
          E.vx = -vel[0] * 0.06 + rr(-0.3, 0.3); E.vy = rr(0.4, 1.2); E.vz = -vel[2] * 0.06 + rr(-0.3, 0.3);
          E.life = rr(0.4, 0.9); E.s0 = 0.16; E.s1 = 0.6;
          E.r = 0.34; E.g = 0.22; E.b = 0.14; E.a0 = 0.2; E.a1 = 0; E.fade = 2; E.drag = 0.95;
          Emit();
        }
      }
      return u >= 1;
    },
    end() {
      if (state.units[opts.to] && state.units[opts.to].entity) {
        cue(state, 'impact', { side: opts.to, type: opts.type, small: true });
      }
      projectileBloom(state, pos, opts.type, cfg);
    },
    res: null,
  });
  return after(dur);
}

/** Small contact bloom at the end of a projectile's flight. */
function projectileBloom(state, at, type, cfg) {
  const p = pal(type);
  E.cell = CI.glow; E.x = at[0]; E.y = at[1]; E.z = at[2];
  E.life = 0.17; E.s0 = cfg.size * 1.1; E.s1 = cfg.size * 4.6;
  E.r = p.hot[0] * 1.25; E.g = p.hot[1] * 1.05; E.b = p.hot[2] * 0.9;
  E.a0 = 1; E.a1 = 0; E.fade = 1; E.hold = 0.04;
  Emit();
  if (p.fx === 'flame') {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * TAU, s = rr(1.2, 3.4);
      E.cell = CI.flame;
      E.x = at[0]; E.y = at[1]; E.z = at[2];
      E.vx = Math.cos(a) * s; E.vy = rr(0.4, 2.6); E.vz = Math.sin(a) * s * 0.7;
      E.life = rr(0.2, 0.42); E.s0 = cfg.size * rr(0.7, 1.15); E.s1 = cfg.size * 0.2;
      E.r = p.main[0] * 1.4; E.g = p.main[1] * 1.3; E.b = p.main[2] * 1.2;
      E.a0 = 1; E.a1 = 0; E.fade = 1; E.drag = 0.88; E.em = 1; E.emN = 4;
      Emit();
    }
    sparks(at[0], at[1], at[2], 10, 3.2, [1.3, 0.6, 0.16], 0.5, 0.09, -4);
    smoke(at[0], at[1] + 0.1, at[2], 3, 0.25, 0.9, [0.34, 0.22, 0.14], 0.22, 0.3, 0.9, 0.8);
    airRing(at[0], at[1], at[2], cfg.size, cfg.size * 3.2, p.main, 0.28, 0.75);
  } else if (p.fx === 'seed') {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU, s = rr(1.4, 3.6);
      E.cell = CI.seed;
      E.x = at[0]; E.y = at[1]; E.z = at[2];
      E.vx = Math.cos(a) * s; E.vy = rr(0.5, 3); E.vz = Math.sin(a) * s;
      E.life = rr(0.4, 0.8); E.s0 = rr(0.1, 0.2); E.s1 = 0.05;
      E.r = p.ember[0]; E.g = p.ember[1]; E.b = p.ember[2];
      E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.92; E.grav = -3.4; E.spin = rr(-10, 10);
      Emit();
    }
    sparks(at[0], at[1], at[2], 9, 3, p.ember, 0.45, 0.08, -3);
  } else if (p.fx === 'bubble') {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * TAU, s = rr(1.6, 4);
      E.cell = CI.bubble;
      E.x = at[0]; E.y = at[1]; E.z = at[2];
      E.vx = Math.cos(a) * s; E.vy = rr(-0.5, 2.4); E.vz = Math.sin(a) * s;
      E.life = rr(0.3, 0.6); E.s0 = rr(0.08, 0.18); E.s1 = 0.03;
      E.r = p.ember[0]; E.g = p.ember[1]; E.b = p.ember[2];
      E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.92; E.grav = -4.2;
      Emit();
    }
    smoke(at[0], at[1], at[2], 4, 0.3, 0.6, [0.55, 0.72, 0.9], 0.18, 0.25, 0.9, 0.7);
    airRing(at[0], at[1], at[2], cfg.size, cfg.size * 3.4, p.hot, 0.3, 0.7);
  } else if (p.fx === 'ripple') {
    for (let i = 0; i < 3; i++) {
      E.cell = CI.ripple;
      E.x = at[0]; E.y = at[1]; E.z = at[2];
      E.life = 0.45 - i * 0.08; E.s0 = 0.4 + i * 0.5; E.s1 = 2.6 + i * 1.2;
      E.r = p.main[0] * 1.4; E.g = p.main[1] * 1.4; E.b = p.main[2] * 1.4;
      E.a0 = 0.8; E.a1 = 0; E.fade = 2; E.spin = i % 2 ? 1.2 : -1.2;
      Emit();
    }
    sparks(at[0], at[1], at[2], 10, 3, p.ember, 0.5, 0.09, -2.5);
  } else {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU, s = rr(1.4, 3.6);
      E.cell = CI.shard;
      E.x = at[0]; E.y = at[1]; E.z = at[2];
      E.vx = Math.cos(a) * s; E.vy = rr(-0.6, 2.2); E.vz = Math.sin(a) * s;
      E.life = rr(0.22, 0.45); E.s0 = rr(0.1, 0.2); E.s1 = 0.03;
      E.r = p.ember[0]; E.g = p.ember[1]; E.b = p.ember[2];
      E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.9; E.stretch = 1.2; E.spin = rr(-9, 9);
      Emit();
    }
    airRing(at[0], at[1], at[2], cfg.size, cfg.size * 3.0, p.main, 0.3, 0.75);
  }
}

/* --------------------------------------------------------------------- impact */

let lastShakeAt = -10;

function impact(state, opts) {
  const type = opts.type || 'normal';
  const p = pal(type);
  const base = opts.pos || [0, 0, 0];
  const h = opts.height || 0.6;
  const z = !!opts.z;
  const K = z ? 2.3 : 1;
  const pw = 1 + Math.min(0.45, (opts.power || 0) / 150);
  const x = base[0], y = base[1] + hitOffset(h), zz = base[2];
  const gy = groundOf(state);
  const groundR = Math.max(1.4, h * 0.55);

  cue(state, 'flash', { alpha: z ? 0.95 : 0.4, type, z });
  setFlash(z ? 1 : 0.42, z ? '#fff2d6' : '#ffffff');
  if (z) {
    setWash('fire', 0.9); setVig(0.55); setBars(0.075); setSky(0.55);
    clearOverlayAfter(1.5);
  } else {
    setVig(Math.max(ov.vigT, 0.18));
  }
  const camMod = state.mods && state.mods.camera;
  if (camMod && state.t - lastShakeAt > 0.1) { camMod.shake(state, z ? 1.25 : 0.22); lastShakeAt = state.t; }
  cue(state, 'hitstop', { dur: z ? 0.16 : 0.07 });

  // bright held core (the "beat" of the hit)
  E.cell = CI.glow; E.x = x; E.y = y; E.z = zz;
  E.life = z ? 0.42 : 0.22; E.hold = z ? 0.13 : 0.07;
  E.s0 = 0.4 * K; E.s1 = (z ? 6.4 : 2.4) * pw;
  E.r = p.hot[0]; E.g = p.hot[1] * 0.95; E.b = p.hot[2] * 0.8;
  E.a0 = 1; E.a1 = 0; E.fade = 1;
  Emit();
  E.cell = p.fx === 'flame' ? CI.flame : CI.puff; E.x = x; E.y = y; E.z = zz;
  E.life = z ? 0.6 : 0.3; E.hold = z ? 0.12 : 0.06;
  E.s0 = 0.55 * K * pw; E.s1 = (z ? 4.6 : 1.9) * pw;
  E.r = p.main[0] * 1.3; E.g = p.main[1] * 1.2; E.b = p.main[2] * 1.1;
  E.a0 = 0.95; E.a1 = 0; E.fade = 1; E.spin = rr(-2, 2);
  Emit();

  // rings: camera-facing + ground shock ring(s)
  airRing(x, y, zz, 0.4 * K, 3.4 * K * pw, p.hot, z ? 0.55 : 0.34, 0.95);
  groundRing(x, zz, 0.6 * K, groundR * (z ? 8.5 : 4.0), p.main, z ? 0.85 : 0.5, 0.8);

  // thrown sparks + streaks
  sparks(x, y, zz, Math.round((18 * K) | 0), 5.4 * K, p.ember, 0.55, 0.11 * K, -7);
  for (let i = 0; i < Math.round(10 * K); i++) {
    const a = Math.random() * TAU, e = rr(-0.3, 0.8), s = rr(3, 8) * K;
    E.cell = CI.slash;
    E.x = x; E.y = y; E.z = zz;
    E.vx = Math.cos(a) * Math.cos(e) * s; E.vy = Math.sin(e) * s; E.vz = Math.sin(a) * Math.cos(e) * s;
    E.life = rr(0.16, 0.34); E.s0 = rr(0.14, 0.3) * K; E.s1 = 0.05;
    E.r = p.hot[0] * 1.4; E.g = p.hot[1] * 1.1; E.b = p.hot[2] * 0.8;
    E.a0 = 0.9; E.a1 = 0; E.fade = 2; E.drag = 0.9; E.stretch = 3.4;
    Emit();
  }

  // type flavour: embers / leaves / droplets / crystals
  if (p.fx === 'flame') {
    for (let i = 0; i < Math.round(26 * K); i++) {
      const a = Math.random() * TAU, s = rr(1.4, 6) * K;
      E.cell = CI.flame;
      E.x = x; E.y = y; E.z = zz;
      E.vx = Math.cos(a) * s * 0.6; E.vy = rr(0.6, 4.4) * K; E.vz = Math.sin(a) * s * 0.6;
      E.life = rr(0.3, 0.8); E.s0 = rr(0.14, 0.34) * K; E.s1 = rr(0.3, 0.8) * K;
      E.r = p.main[0] * 1.35; E.g = p.main[1] * 1.25; E.b = p.main[2] * 1.1;
      E.a0 = 0.9; E.a1 = 0; E.fade = 1; E.drag = 0.9; E.grav = 1.2 * K; E.em = 1; E.emN = 6;
      Emit();
    }
  } else if (p.fx === 'seed') {
    for (let i = 0; i < Math.round(20 * K); i++) {
      const a = Math.random() * TAU, s = rr(1.6, 5) * K;
      E.cell = CI.seed;
      E.x = x; E.y = y; E.z = zz;
      E.vx = Math.cos(a) * s * 0.7; E.vy = rr(0.8, 4) * K; E.vz = Math.sin(a) * s * 0.7;
      E.life = rr(0.5, 1.1); E.s0 = rr(0.1, 0.22) * K; E.s1 = 0.06;
      E.r = p.ember[0]; E.g = p.ember[1]; E.b = p.ember[2];
      E.a0 = 0.95; E.a1 = 0; E.fade = 2; E.drag = 0.93; E.grav = -3.6; E.spin = rr(-14, 14);
      Emit();
    }
  } else if (p.fx === 'bubble') {
    for (let i = 0; i < Math.round(24 * K); i++) {
      const a = Math.random() * TAU, s = rr(2, 6.5) * K;
      E.cell = CI.bubble;
      E.x = x; E.y = y; E.z = zz;
      E.vx = Math.cos(a) * s * 0.75; E.vy = rr(-1, 3.6) * K; E.vz = Math.sin(a) * s * 0.75;
      E.life = rr(0.35, 0.8); E.s0 = rr(0.1, 0.24) * K; E.s1 = 0.04;
      E.r = p.ember[0]; E.g = p.ember[1]; E.b = p.ember[2];
      E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.92; E.grav = -4.6;
      Emit();
    }
  } else if (p.fx === 'ripple') {
    for (let i = 0; i < 4; i++) {
      E.cell = CI.ripple; E.x = x; E.y = y; E.z = zz;
      E.life = 0.55 - i * 0.07; E.s0 = 0.6 + i * 0.8; E.s1 = (3.2 + i * 1.6) * K;
      E.r = p.main[0] * 1.5; E.g = p.main[1] * 1.5; E.b = p.main[2] * 1.5;
      E.a0 = 0.85; E.a1 = 0; E.fade = 2; E.spin = i % 2 ? 1.4 : -1.4;
      Emit();
    }
  } else {
    for (let i = 0; i < Math.round(16 * K); i++) {
      const a = Math.random() * TAU, s = rr(2, 6) * K;
      E.cell = CI.shard;
      E.x = x; E.y = y; E.z = zz;
      E.vx = Math.cos(a) * s * 0.7; E.vy = rr(-1, 3.4) * K; E.vz = Math.sin(a) * s * 0.7;
      E.life = rr(0.25, 0.55); E.s0 = rr(0.12, 0.26) * K; E.s1 = 0.03;
      E.r = p.ember[0]; E.g = p.ember[1]; E.b = p.ember[2];
      E.a0 = 0.9; E.a1 = 0; E.fade = 2; E.drag = 0.9; E.stretch = 1.4; E.spin = rr(-10, 10);
      Emit();
    }
  }

  // dust kicked from the ground under the target + rising smoke
  dustKick(x, zz, Math.round(14 * K), groundR * 0.8, K * (1 + h * 0.25), p.dust, 2.6 * Math.sqrt(K));
  smoke(x, y * 0.6, zz, Math.round(7 * K), 0.5 * K, 1.1 * K, p.fx === 'flame' ? [0.4, 0.26, 0.16] : [0.5, 0.46, 0.4],
        z ? 0.34 : 0.2, 0.5 * K, 2.6 * K, z ? 1.4 : 0.9);

  if (z) {
    // fire column + dust pillars + sky embers (bar: Inferno_Overdrive_VII.png / Rock Z-Move)
    for (let i = 0; i < 14; i++) {
      const t0 = rr(0, 0.5);
      E.cell = CI.flame;
      E.x = x + rr(-2.4, 2.4); E.y = gy + rr(0.3, 2 + i * 1.5); E.z = zz + rr(-2.4, 2.4);
      E.vx = rr(-1, 1); E.vy = rr(3, 11); E.vz = rr(-1, 1);
      E.life = rr(0.7, 1.5) - t0 * 0.2; E.s0 = rr(1.2, 2.4); E.s1 = rr(2.4, 4.6);
      E.r = p.main[0] * 1.25; E.g = p.main[1] * 1.05; E.b = p.main[2] * 0.85;
      E.a0 = 0.6; E.a1 = 0; E.fade = 1; E.drag = 0.94; E.turb = 2.2; E.em = 1; E.emN = 9;
      Emit();
    }
    for (let i = 0; i < 6; i++) {
      const a = rr(0, TAU), d = rr(3, 9);
      E.cell = CI.smoke;
      E.x = x + Math.cos(a) * d; E.y = gy + rr(0, 0.5); E.z = zz + Math.sin(a) * d;
      E.vy = rr(2.4, 5.6); E.vx = Math.cos(a) * rr(0.4, 1.6); E.vz = Math.sin(a) * rr(0.4, 1.6);
      E.life = rr(1.2, 2.2); E.s0 = rr(1.2, 2.2); E.s1 = rr(3.4, 6.5);
      E.r = 0.46; E.g = 0.3; E.b = 0.18; E.a0 = 0.42; E.a1 = 0; E.fade = 1; E.turb = 1.4;
      Emit();
    }
    for (let i = 0; i < 3; i++) {
      groundRing(x, zz, 1.2 + i * 2, 9 + i * 5, p.hot, 0.75 + i * 0.16, 0.7);
    }
    for (let i = 0; i < 40; i++) {
      E.cell = CI.spark;
      E.x = x + rr(-6, 6); E.y = gy + rr(1, 9); E.z = zz + rr(-6, 6);
      E.vx = rr(-1.4, 1.4); E.vy = rr(1.4, 5.5); E.vz = rr(-1.4, 1.4);
      E.life = rr(0.8, 2); E.s0 = rr(0.07, 0.16); E.s1 = 0.01;
      E.r = 1.7; E.g = 0.8; E.b = 0.2;
      E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.97; E.stretch = 1.6; E.turb = 0.8;
      Emit();
    }
  }
  return after(z ? 0.95 : 0.36);
}

/* ----------------------------------------------------------------------- dash */

function dash(state, opts) {
  const side = opts.side === 'foe' ? 'foe' : 'player';
  const ent = opts.entity || (state.units[side] && state.units[side].entity);
  const from = posOf(state, side);
  const other = side === 'player' ? 'foe' : 'player';
  const to = posOf(state, other);
  const dur = opts.dur || 0.5;
  const orig = ent ? [ent.pos[0], ent.pos[1], ent.pos[2]] : [from[0], from[1], from[2]];
  let dx = to[0] - from[0], dz = to[2] - from[2];
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl; dz /= dl;
  const gap = Math.max(0.9, dl * 0.32);
  const p = pal(opts.type || 'normal');
  const gy = groundOf(state);
  let acc = 0;

  const curve = (k) => {
    if (k < 0.10) return -0.12 * Math.sin((k / 0.10) * Math.PI * 0.5);
    if (k < 0.55) { const q = (k - 0.10) / 0.45; return 1 - Math.pow(1 - q, 3); }
    if (k < 0.70) return 1;
    const q = (k - 0.70) / 0.30;
    return 1 - q * q * (3 - 2 * q);
  };

  // launch scuff
  dustKick(orig[0], orig[2], 14, 0.55, 1, [0.72, 0.66, 0.5], 2.6);
  groundRing(orig[0], orig[2], 0.3, 2.4, [0.8, 0.74, 0.55], 0.4, 0.6);
  smoke(orig[0], gy + 0.15, orig[2], 5, 0.5, 0.9, [0.68, 0.62, 0.5], 0.3, 0.3, 1.2, 0.6);

  movers.push({
    t: 0, dur, name: 'dash',
    step(dt) {
      const k = clamp(this.t / dur, 0, 1);
      const e = curve(k);
      if (ent) {
        ent.pos[0] = orig[0] + dx * gap * e;
        ent.pos[2] = orig[2] + dz * gap * e;
        ent.pos[1] = orig[1] + Math.sin(clamp(k, 0, 1) * Math.PI) * 0.10;
      }
      const cx = orig[0] + dx * gap * e, cz = orig[2] + dz * gap * e;
      acc += dt;
      const moving = k > 0.10 && k < 0.70;
      while (acc >= 0.018) {
        acc -= 0.018;
        if (moving) {
          dustKick(cx, cz, 2, 0.3, 0.85, [0.74, 0.68, 0.52], 1.6);
          // motion smear + speed lines
          E.cell = CI.slash;
          E.x = cx - dx * 0.35; E.y = orig[1] + 0.32; E.z = cz - dz * 0.35;
          E.vx = dx * 6; E.vy = 0.2; E.vz = dz * 6;
          E.life = 0.14; E.s0 = 0.34; E.s1 = 0.2;
          E.r = 0.95; E.g = 0.95; E.b = 0.92;
          E.a0 = 0.5; E.a1 = 0; E.fade = 2; E.stretch = 3.2;
          Emit();
          if (Math.random() < 0.6) {
            const sgn = Math.random() < 0.5 ? 1 : -1;
            E.cell = CI.slash;
            E.x = cx - dz * sgn * rr(0.35, 0.7); E.y = orig[1] + rr(0.15, 0.62); E.z = cz + dx * sgn * rr(0.35, 0.7);
            E.vx = dx * rr(4, 9); E.vy = 0; E.vz = dz * rr(4, 9);
            E.life = rr(0.09, 0.16); E.s0 = rr(0.5, 1.1); E.s1 = 0.2;
            E.r = 1.1; E.g = 1.08; E.b = 1.0;
            E.a0 = 0.35; E.a1 = 0; E.fade = 2; E.stretch = 5;
            Emit();
          }
        }
      }
      if (k >= 0.55 && k < 0.62 && !this.__hit) {
        this.__hit = true;
        groundRing(cx, cz, 0.4, 2.6, p.main, 0.4, 0.7);
        smoke(cx, orig[1] + 0.2, cz, 6, 0.4, 1, [0.7, 0.64, 0.5], 0.34, 0.3, 1.2, 0.6);
      }
      if (k >= 1) {
        if (ent) { ent.pos[0] = orig[0]; ent.pos[1] = orig[1]; ent.pos[2] = orig[2]; }
        dustKick(orig[0], orig[2], 6, 0.4, 0.8, [0.72, 0.66, 0.5], 1.4);
        return true;
      }
      return false;
    },
    res: null,
  });
  return after(dur);
}

function returnLeg(state, opts) {
  const side = opts.side === 'foe' ? 'foe' : 'player';
  const ent = opts.entity || (state.units[side] && state.units[side].entity);
  const dur = opts.dur || 0.35;
  const at = ent ? [ent.pos[0], ent.pos[1], ent.pos[2]] : posOf(state, side);
  let acc = 0, t0 = 0;
  movers.push({
    t: 0, dur, name: 'return',
    step(dt) {
      t0 += dt; acc += dt;
      while (acc >= 0.03) {
        acc -= 0.03;
        const k = 1 - clamp(t0 / dur, 0, 1);
        E.cell = CI.slash;
        E.x = at[0]; E.y = at[1] + 0.3; E.z = at[2];
        E.vx = -0.6; E.vy = 0.4; E.vz = 0.8;
        E.life = 0.16 * k + 0.05; E.s0 = 0.5 * (0.4 + k); E.s1 = 0.2;
        E.r = 0.9; E.g = 0.9; E.b = 0.88;
        E.a0 = 0.3 * k; E.a1 = 0; E.fade = 2; E.stretch = 3;
        Emit();
        dustKick(at[0], at[2], 1, 0.3, 0.8, [0.72, 0.66, 0.5], 1.2);
      }
      if (t0 >= dur) {
        dustKick(at[0], at[2], 5, 0.4, 0.8, [0.72, 0.66, 0.5], 1.3);
        return true;
      }
      return false;
    },
  });
  return after(dur);
}

/* -------------------------------------------------------------- misc effects */

function healFx(state, opts) {
  const at = opts.pos || [0, 0, 0];
  const h = opts.height || 1;
  const gy = groundOf(state);
  groundRing(at[0], at[2], 0.4, 2.2, [0.45, 1.15, 0.6], 0.7, 0.7);
  E.cell = CI.glow; E.x = at[0]; E.y = at[1] + h * 0.6; E.z = at[2];
  E.life = 0.9; E.s0 = 0.7; E.s1 = 1.1;
  E.r = 0.4; E.g = 1.05; E.b = 0.55; E.a0 = 0.3; E.a1 = 0; E.fade = 1; E.turb = 0.3;
  Emit();
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * TAU, rad = rr(0.15, 0.85);
    E.cell = CI.star;
    E.x = at[0] + Math.cos(a) * rad; E.y = at[1] + rr(0.05, 0.4); E.z = at[2] + Math.sin(a) * rad;
    E.vx = Math.cos(a + 1.6) * 0.35; E.vy = rr(0.9, 2.2); E.vz = Math.sin(a + 1.6) * 0.35;
    E.life = rr(0.7, 1.3); E.s0 = rr(0.09, 0.2); E.s1 = 0.03;
    E.r = 0.75; E.g = 1.25; E.b = 0.8;
    E.a0 = 0.95; E.a1 = 0; E.fade = 2; E.drag = 0.97; E.spin = rr(-3, 3); E.turb = 0.6;
    Emit();
  }
  for (let i = 0; i < 8; i++) {
    E.cell = CI.bubble;
    E.x = at[0] + rr(-0.5, 0.5); E.y = gy + rr(0.05, 0.4); E.z = at[2] + rr(-0.5, 0.5);
    E.vy = rr(0.7, 1.6); E.life = rr(0.6, 1); E.s0 = rr(0.08, 0.16); E.s1 = 0.05;
    E.r = 0.6; E.g = 1.15; E.b = 0.7;
    E.a0 = 0.7; E.a1 = 0; E.fade = 2; E.turb = 0.4;
    Emit();
  }
  setFlash(0.16, '#d9ffe2');
  setWash('heal', 0.5);
  setVig(0.16);
  clearOverlayAfter(0.9);
  return after(0.9);
}

function faintDust(state, opts) {
  const at = opts.pos || [0, 0, 0];
  const r = opts.r || 1;
  const gy = groundOf(state);
  groundRing(at[0], at[2], r * 0.6, r * 2.6, [0.82, 0.78, 0.6], 0.85, 0.55);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * TAU, s = rr(0.8, 2.6);
    E.cell = CI.dust;
    E.x = at[0] + Math.cos(a) * r * rr(0.2, 0.7); E.y = gy + rr(0, 0.3);
    E.z = at[2] + Math.sin(a) * r * rr(0.2, 0.7);
    E.vx = Math.cos(a) * s; E.vy = rr(0.3, 1.6); E.vz = Math.sin(a) * s;
    E.life = rr(0.7, 1.3); E.s0 = r * rr(0.12, 0.22); E.s1 = r * rr(0.3, 0.55);
    E.r = 0.8; E.g = 0.75; E.b = 0.6;
    E.a0 = 0.7; E.a1 = 0; E.fade = 2; E.drag = 0.9; E.grav = -0.4;
    Emit();
  }
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * TAU, s = rr(1.2, 3.4);
    E.cell = CI.seed;
    E.x = at[0] + Math.cos(a) * r * 0.3; E.y = gy + 0.1; E.z = at[2] + Math.sin(a) * r * 0.3;
    E.vx = Math.cos(a) * s; E.vy = rr(1.4, 3.4); E.vz = Math.sin(a) * s;
    E.life = rr(0.6, 1.1); E.s0 = 0.14; E.s1 = 0.06;
    E.r = 0.6; E.g = 0.85; E.b = 0.4;
    E.a0 = 0.8; E.a1 = 0; E.fade = 2; E.drag = 0.94; E.grav = -4.5; E.spin = rr(-12, 12);
    Emit();
  }
  for (let i = 0; i < 10; i++) {
    E.cell = CI.smoke;
    E.x = at[0] + rr(-r, r); E.y = gy + rr(0.2, 0.8); E.z = at[2] + rr(-r, r);
    E.vy = rr(0.5, 1.6); E.life = rr(0.9, 1.5); E.s0 = r * 0.2; E.s1 = r * 0.6;
    E.r = 0.5; E.g = 0.44; E.b = 0.36; E.a0 = 0.24; E.a1 = 0; E.fade = 1; E.turb = 0.8;
    Emit();
  }
  return after(0.8);
}

function recallFx(state, opts) {
  const ent = opts.entity || (state.units.player && state.units.player.entity);
  const at = ent ? ent.pos : [0, 0, 0];
  const h = ent && ent === (state.units.foe && state.units.foe.entity) ? 4 : 0.5;
  const cy = at[1] + h * 0.55;
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * TAU, e = rr(-0.6, 0.9), d = rr(0.8, 2.2);
    E.cell = Math.random() < 0.5 ? CI.slash : CI.spark;
    E.x = at[0] + Math.cos(a) * Math.cos(e) * d;
    E.y = cy + Math.sin(e) * d;
    E.z = at[2] + Math.sin(a) * Math.cos(e) * d;
    E.tx = at[0]; E.ty = cy; E.tz = at[2]; E.tk = rr(4, 9);
    E.life = rr(0.22, 0.42); E.s0 = rr(0.1, 0.22); E.s1 = 0.03;
    E.r = 1.5; E.g = 0.35; E.b = 0.35;
    E.a0 = 1; E.a1 = 0; E.fade = 2; E.stretch = 1.4;
    Emit();
  }
  E.cell = CI.glow; E.x = at[0]; E.y = cy; E.z = at[2];
  E.life = 0.45; E.s0 = 0.7; E.s1 = 0.12;
  E.r = 1.4; E.g = 0.3; E.b = 0.3; E.a0 = 1; E.a1 = 0; E.fade = 1; E.hold = 0.1;
  Emit();
  groundRing(at[0], at[2], 0.3, 1.8, [1.2, 0.3, 0.3], 0.4, 0.6);
  timers.push({ t: 0.34, res: () => {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU, s = rr(1, 2.6);
      E.cell = CI.star;
      E.x = at[0]; E.y = cy; E.z = at[2];
      E.vx = Math.cos(a) * s; E.vy = rr(-0.4, 2); E.vz = Math.sin(a) * s;
      E.life = rr(0.25, 0.5); E.s0 = 0.12; E.s1 = 0.02;
      E.r = 1.3; E.g = 0.85; E.b = 0.9;
      E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.9;
      Emit();
    }
  } });
  return after(0.5);
}

function ballFx(state, opts) {
  const side = opts.side === 'foe' ? 'foe' : 'player';
  const ent = opts.entity || (state.units[side] && state.units[side].entity);
  const target = ent ? [ent.pos[0], ent.pos[1], ent.pos[2]] : posOf(state, side);
  const gy = groundOf(state);
  const F = state.field;
  const throwFrom = side === 'player'
    ? [F.playerSpot[0] - 1.9, gy + 1.15, F.playerSpot[2] + 2.6]
    : [F.foeSpot[0] + 2.2, gy + 2.2, F.foeSpot[2] + 2.4];
  const A = throwFrom, B = [target[0], target[1] + 0.28, target[2]];
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
  const dur = 0.44;
  let acc = 0, pos = [A[0], A[1], A[2]], prev = pos;
  movers.push({
    t: 0, dur, name: 'ball',
    step(dt) {
      const u = clamp(this.t / dur, 0, 1);
      const lob = 2.1 * 4 * u * (1 - u);
      prev = pos;
      pos = [A[0] + dx * u, A[1] + dy * u + lob, A[2] + dz * u];
      E.cell = CI.ball;
      E.x = pos[0]; E.y = pos[1]; E.z = pos[2];
      E.life = 0.05; E.s0 = 0.26; E.s1 = 0.26;
      E.r = 1.1; E.g = 1.1; E.b = 1.1;
      E.a0 = 1; E.a1 = 1; E.fade = 0;
      E.roll = this.t * 11;
      Emit();
      acc += dt;
      while (acc >= 0.03) {
        acc -= 0.03;
        E.cell = CI.spark;
        E.x = pos[0] + rr(-0.1, 0.1); E.y = pos[1] + rr(-0.1, 0.1); E.z = pos[2] + rr(-0.1, 0.1);
        E.life = 0.2; E.s0 = 0.07; E.s1 = 0.01;
        E.r = 1.2; E.g = 1.2; E.b = 1.3; E.a0 = 0.7; E.a1 = 0; E.fade = 2;
        Emit();
      }
      if (u >= 1) {
        // pop burst as the mon materialises
        E.cell = CI.star; E.x = B[0]; E.y = B[1]; E.z = B[2];
        E.life = 0.35; E.s0 = 0.4; E.s1 = 1.9;
        E.r = 1.3; E.g = 1.35; E.b = 1.5; E.a0 = 1; E.a1 = 0; E.fade = 1; E.hold = 0.05;
        Emit();
        E.cell = CI.glow; E.x = B[0]; E.y = B[1]; E.z = B[2];
        E.life = 0.4; E.s0 = 0.5; E.s1 = 2.4;
        E.r = 0.9; E.g = 1.0; E.b = 1.3; E.a0 = 0.85; E.a1 = 0; E.fade = 1;
        Emit();
        airRing(B[0], B[1], B[2], 0.3, 2.6, [0.9, 1.0, 1.3], 0.4, 0.85);
        groundRing(B[0], B[2], 0.3, 2.4, [0.85, 0.9, 1.05], 0.45, 0.7);
        for (let i = 0; i < 20; i++) {
          const a = Math.random() * TAU, s = rr(1.6, 4.4);
          E.cell = Math.random() < 0.5 ? CI.star : CI.spark;
          E.x = B[0]; E.y = B[1]; E.z = B[2];
          E.vx = Math.cos(a) * s; E.vy = rr(0.6, 3.6); E.vz = Math.sin(a) * s;
          E.life = rr(0.3, 0.7); E.s0 = rr(0.07, 0.16); E.s1 = 0.02;
          E.r = 1.0; E.g = 1.2; E.b = 1.45; E.a0 = 1; E.a1 = 0; E.fade = 2;
          E.drag = 0.92; E.grav = -3.4; E.spin = rr(-4, 4);
          Emit();
        }
        dustKick(B[0], B[2], 10, 0.7, 0.9, [0.75, 0.7, 0.55], 2.2);
        setFlash(0.18, '#dff0ff');
        return true;
      }
      return false;
    },
  });
  return after(0.62);
}

function encounterFx(state, opts) {
  const at = opts.pos || [0, 0, 0];
  const gy = groundOf(state);
  const r = Math.max(2.2, (opts.r || 3.4));
  E.cell = CI.glow; E.x = at[0]; E.y = gy + 0.6; E.z = at[2];
  E.life = 0.3; E.s0 = 0.8; E.s1 = 4.4;
  E.r = 1.1; E.g = 1.25; E.b = 1.0; E.a0 = 0.8; E.a1 = 0; E.fade = 1; E.hold = 0.04;
  Emit();
  groundRing(at[0], at[2], 0.6, r * 1.9, [0.55, 0.95, 0.4], 0.6, 0.7);
  groundRing(at[0], at[2], 0.4, r * 1.2, [0.85, 0.8, 0.6], 0.5, 0.6);
  dustKick(at[0], at[2], 30, r * 0.5, 1.5, [0.8, 0.74, 0.55], 3.4);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * TAU, s = rr(1.4, 4.2);
    E.cell = CI.seed;
    E.x = at[0] + Math.cos(a) * r * rr(0.1, 0.7); E.y = gy + 0.08;
    E.z = at[2] + Math.sin(a) * r * rr(0.1, 0.7);
    E.vx = Math.cos(a) * s; E.vy = rr(1.8, 4.6); E.vz = Math.sin(a) * s;
    E.life = rr(0.7, 1.4); E.s0 = rr(0.12, 0.24); E.s1 = 0.06;
    E.r = 0.5; E.g = 0.9; E.b = 0.35; E.a0 = 0.95; E.a1 = 0; E.fade = 2;
    E.drag = 0.94; E.grav = -4.4; E.spin = rr(-14, 14);
    Emit();
  }
  return after(0.5);
}

function fleeDust(state, opts) {
  const ent = opts.entity || (state.units.player && state.units.player.entity);
  const at = ent ? ent.pos : posOf(state, 'player');
  const gy = groundOf(state);
  groundRing(at[0], at[2], 0.3, 2.2, [0.8, 0.75, 0.58], 0.5, 0.6);
  dustKick(at[0], at[2], 18, 0.7, 1.1, [0.76, 0.7, 0.54], 2.4);
  for (let i = 0; i < 14; i++) {
    E.cell = CI.seed;
    E.x = at[0] + rr(-0.6, 0.6); E.y = gy + 0.1; E.z = at[2] + rr(-0.6, 0.6);
    E.vx = rr(-1.4, 1.4) - 2.2; E.vy = rr(1.4, 3.4); E.vz = rr(-1.4, 1.4) + 1.2;
    E.life = rr(0.6, 1.2); E.s0 = 0.14; E.s1 = 0.05;
    E.r = 0.5; E.g = 0.85; E.b = 0.38; E.a0 = 0.8; E.a1 = 0; E.fade = 2;
    E.drag = 0.95; E.grav = -4.2; E.spin = rr(-12, 12);
    Emit();
  }
  for (let i = 0; i < 10; i++) {
    E.cell = CI.dust;
    E.x = at[0] + rr(-0.5, 0.5); E.y = gy + rr(0.05, 0.4); E.z = at[2] + rr(-0.5, 0.5);
    E.vx = rr(-3.2, -1); E.vy = rr(0.4, 1.4); E.vz = rr(-1, 2.4);
    E.life = rr(0.5, 0.9); E.s0 = 0.25; E.s1 = 1.1;
    E.r = 0.75; E.g = 0.7; E.b = 0.55; E.a0 = 0.6; E.a1 = 0; E.fade = 2; E.drag = 0.92;
    Emit();
  }
  return after(0.6);
}

function statDropFx(state, opts) {
  const at = opts.pos || [0, 0, 0];
  const h = opts.height || 1;
  const up = !!opts.up;
  const gy = groundOf(state);
  const col = up ? [0.5, 1.2, 0.6] : [1.3, 0.45, 0.45];
  groundRing(at[0], at[2], 0.3, 1.9, col, 0.45, 0.6);
  for (let i = 0; i < 8; i++) {
    const a = rr(0, TAU), rad = rr(0.25, 0.85);
    E.cell = CI.chevron;
    E.x = at[0] + Math.cos(a) * rad;
    E.y = at[1] + h * (up ? 0.5 : 1.25) + i * 0.06 * (up ? 1 : -1);
    E.z = at[2] + Math.sin(a) * rad;
    E.vx = Math.cos(a) * 0.3; E.vy = up ? rr(1.0, 1.8) : rr(-1.6, -0.9); E.vz = Math.sin(a) * 0.3;
    E.life = rr(0.6, 0.95); E.s0 = rr(0.16, 0.26); E.s1 = rr(0.1, 0.16);
    E.r = col[0]; E.g = col[1]; E.b = col[2];
    E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.96; E.roll = up ? 0 : Math.PI;
    Emit();
  }
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * TAU, s = rr(0.8, 2);
    E.cell = CI.spark;
    E.x = at[0]; E.y = at[1] + h * 0.6; E.z = at[2];
    E.vx = Math.cos(a) * s; E.vy = up ? rr(0.6, 2.2) : rr(-2.2, -0.6); E.vz = Math.sin(a) * s;
    E.life = rr(0.35, 0.7); E.s0 = 0.09; E.s1 = 0.01;
    E.r = col[0]; E.g = col[1]; E.b = col[2];
    E.a0 = 0.9; E.a1 = 0; E.fade = 2; E.drag = 0.93;
    Emit();
  }
  return after(0.55);
}

function missFx(state, opts) {
  const at = opts.pos || [0, 0, 0];
  const y = at[1] + (opts.height || 0.6) * 0.9;
  // whiffing swish past the target
  for (let i = 0; i < 3; i++) {
    E.cell = CI.slash;
    E.x = at[0] + rr(-0.6, 0.6); E.y = y + rr(-0.25, 0.35); E.z = at[2] + rr(-0.4, 0.4);
    E.vx = rr(4, 7); E.vy = rr(0.4, 1.4); E.vz = rr(-1.4, 1.4);
    E.life = 0.24; E.s0 = rr(0.6, 1.2); E.s1 = 0.3;
    E.r = 0.95; E.g = 0.96; E.b = 1.0;
    E.a0 = 0.55; E.a1 = 0; E.fade = 2; E.stretch = 4.5;
    Emit();
  }
  for (let i = 0; i < 10; i++) {
    E.cell = CI.puff;
    E.x = at[0] + rr(-0.5, 0.5); E.y = y + rr(-0.4, 0.4); E.z = at[2] + rr(-0.5, 0.5);
    E.vx = rr(1.4, 3.4); E.vy = rr(0.2, 1.2); E.vz = rr(-1, 1);
    E.life = rr(0.35, 0.7); E.s0 = 0.18; E.s1 = 0.75;
    E.r = 0.85; E.g = 0.86; E.b = 0.9; E.a0 = 0.35; E.a1 = 0; E.fade = 2; E.drag = 0.93;
    Emit();
  }
  return after(0.3);
}

function sandkickFx(state, opts) {
  const at = opts.pos || [0, 0, 0];
  const gy = groundOf(state);
  groundRing(at[0], at[2], 0.2, 1.6, [0.95, 0.88, 0.66], 0.45, 0.5);
  for (let i = 0; i < 34; i++) {
    const a = Math.random() * TAU, s = rr(1.2, 3.6);
    E.cell = Math.random() < 0.45 ? CI.dust : CI.spark;
    E.x = at[0] + rr(-0.3, 0.3); E.y = gy + rr(0.02, 0.25); E.z = at[2] + rr(-0.3, 0.3);
    E.vx = Math.cos(a) * s; E.vy = rr(1, 3.4); E.vz = Math.sin(a) * s;
    E.life = rr(0.45, 0.95); E.s0 = rr(0.1, 0.26); E.s1 = rr(0.2, 0.5);
    E.r = 0.98; E.g = 0.92; E.b = 0.7;
    E.a0 = 0.85; E.a1 = 0; E.fade = 2; E.drag = 0.9; E.grav = -5.2;
    Emit();
  }
  for (let i = 0; i < 9; i++) {
    E.cell = CI.dust;
    E.x = at[0] + rr(-0.6, 0.6); E.y = gy + rr(0.05, 0.6); E.z = at[2] + rr(-0.6, 0.6);
    E.vx = rr(-1.6, 1.6); E.vy = rr(0.5, 1.4); E.vz = rr(-1.6, 1.6);
    E.life = rr(0.6, 1.1); E.s0 = 0.3; E.s1 = 1.2;
    E.r = 0.92; E.g = 0.86; E.b = 0.66; E.a0 = 0.5; E.a1 = 0; E.fade = 2; E.drag = 0.92;
    Emit();
  }
  return after(0.45);
}

/* ----------------------------------------------------------- Z-Move cinematics */

const V3 = {
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
};

/** A point `d` metres behind the entity as seen from the camera (so glows sit behind it). */
function behind(state, pos, d, up) {
  const dir = V3.norm(V3.sub(pos, state.cam.pos));
  return [pos[0] + dir[0] * d, pos[1] + (up || 0) + dir[1] * d, pos[2] + dir[2] * d];
}

/* --- camera basis + frame-space helpers ---------------------------------
   The Z-Move is composed in *frame space*: each fire element is placed at an explicit
   depth in front of the camera and at an (x, y) offset measured in half-frames, so
   "the frame is full of fire" is a property of the choreography rather than of the
   shot. Sprite quads are camera-facing, so a lobe at depth d spans frameH(d) metres. */

const B = { pos: [0, 0, 0], f: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], ht: 0.51, aspect: 1.667 };

function camBasis(state) {
  const cam = state.cam || {};
  const p = cam.pos || [0, 0, 0], l = cam.look || [0, 0, 1];
  B.pos[0] = p[0]; B.pos[1] = p[1]; B.pos[2] = p[2];
  let fx = l[0] - p[0], fy = l[1] - p[1], fz = l[2] - p[2];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  let rx = fz, rz = -fx;                       // f x up, flattened
  const rl = Math.hypot(rx, rz);
  if (rl < 1e-5) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
  B.f[0] = fx; B.f[1] = fy; B.f[2] = fz;
  B.r[0] = rx; B.r[1] = 0; B.r[2] = rz;
  B.u[0] = -rz * fy; B.u[1] = rz * fx - rx * fz; B.u[2] = rx * fy;
  B.ht = Math.tan(((cam.fov || 42) * Math.PI) / 360);
  const c = state.ctx && state.ctx.canvas;
  B.aspect = c && c.height ? c.width / c.height : 1.667;
}

const _fp = [0, 0, 0];
/** World point `d` metres in front of the camera at half-frame offset (sx, sy). */
function framePt(d, sx, sy) {
  const hh = d * B.ht, hw = hh * B.aspect;
  _fp[0] = B.pos[0] + B.f[0] * d + B.r[0] * sx * hw + B.u[0] * sy * hh;
  _fp[1] = B.pos[1] + B.f[1] * d + B.r[1] * sx * hw + B.u[1] * sy * hh;
  _fp[2] = B.pos[2] + B.f[2] * d + B.r[2] * sx * hw + B.u[2] * sy * hh;
  return _fp;
}

/** World size of one frame height at depth `d`. */
function frameH(d) { return 2 * d * B.ht; }

/** Project a world point to [halfFrameX, halfFrameY, depth]. */
function toScreen(x, y, z) {
  const dx = x - B.pos[0], dy = y - B.pos[1], dz = z - B.pos[2];
  const d = dx * B.f[0] + dy * B.f[1] + dz * B.f[2];
  const hh = Math.abs(d) * B.ht, hw = hh * B.aspect;
  if (hh < 1e-4) return [0, 0, d];
  return [(dx * B.r[0] + dy * B.r[1] + dz * B.r[2]) / hw,
          (dx * B.u[0] + dy * B.u[1] + dz * B.u[2]) / hh, d];
}

const FLASH_WARM = [1.0, 0.72, 0.42];
const FLASH_COOL = [0.86, 0.96, 1.0];

function zPose(state, opts) {
  const side = opts.side === 'foe' ? 'foe' : 'player';
  const ent = opts.entity || (state.units[side] && state.units[side].entity);
  const at = ent ? [ent.pos[0], ent.pos[1], ent.pos[2]] : posOf(state, side);
  const h = (state.units[side] && state.units[side].focusHeight) || 0.6;
  const cy = at[1] + h * 0.55;
  const gy = groundOf(state);
  const back = behind(state, [at[0], cy, at[2]], 0.9 + h * 0.4);

  const waves = [0.12, 0.36, 0.60, 0.86, 1.12];

  cine.mode = 'zPose';
  cine.phase = 'charge';
  cine.t = 0;
  cine.step = (dt) => {
    const t = cine.t;
    camBasis(state);

    // --- power gathering: streaks stream IN from the frame edges to the ally, so the
    //     charge reads as an intake and the ally stays lit against the sky behind it.
    cine.__g = (cine.__g || 0) + dt;
    while (cine.__g >= 0.026) {
      cine.__g -= 0.026;
      const a = Math.random() * TAU, rad = rr(1.15, 2.7);
      const q = framePt(rr(2.0, 5.5), Math.cos(a) * rad, Math.sin(a) * rad * 0.62);
      const tx = at[0], ty = cy + rr(-0.35, 0.6), tz = at[2];
      let dx = tx - q[0], dy = ty - q[1], dz = tz - q[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const spd = rr(10, 20);
      E.layer = 0; E.cell = CI.slash;
      E.x = q[0]; E.y = q[1]; E.z = q[2];
      E.vx = dx * spd; E.vy = dy * spd; E.vz = dz * spd;
      E.life = rr(0.26, 0.5); E.s0 = rr(0.4, 0.9); E.s1 = rr(0.1, 0.25);
      const cool = Math.random() < 0.5;
      E.r = cool ? 1.5 : 1.3; E.g = 1.85; E.b = cool ? 1.9 : 0.75;
      E.a0 = 0.95; E.a1 = 0; E.fade = 1; E.drag = 0.9; E.stretch = rr(2.6, 5.5);
      Emit();
    }

    // --- staggered wave beats: a starburst behind the ally + a rising ground ring
    while (cine.__wave < waves.length && t >= waves[cine.__wave]) {
      cine.__wave++;
      const wave = cine.__wave;
      const spin = Math.random() * TAU;
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = spin + (i / n) * TAU + rr(-0.1, 0.1);
        const s = rr(10, 19);
        E.layer = 0; E.cell = CI.slash;
        E.x = at[0]; E.y = cy; E.z = at[2];
        E.vx = Math.cos(a) * s; E.vy = Math.sin(a) * s * 0.45; E.vz = Math.sin(a) * s * 0.6;
        E.life = rr(0.3, 0.5); E.s0 = rr(0.5, 1.1); E.s1 = rr(1.4, 2.6);
        E.r = 1.85; E.g = 1.8; E.b = 0.55;
        E.a0 = 1; E.a1 = 0; E.fade = 1; E.drag = 0.99; E.stretch = rr(2.4, 5.5);
        Emit();
      }
      E.layer = 0; E.cell = CI.star;
      E.x = back[0]; E.y = back[1]; E.z = back[2];
      E.life = 0.5; E.s0 = 2.4 + wave * 0.5; E.s1 = 5.2 + wave * 1.1;
      E.r = 1.9; E.g = 1.75; E.b = 0.5; E.a0 = 1; E.a1 = 0; E.fade = 1;
      E.roll = rr(0, 3); E.spin = rr(-0.7, 0.7);
      Emit();
      E.layer = 0; E.cell = CI.glow;
      E.x = back[0]; E.y = back[1]; E.z = back[2];
      E.life = 0.55; E.s0 = 3.0; E.s1 = 9.5;
      E.r = 0.2; E.g = 0.8; E.b = 1.5; E.a0 = 0.42; E.a1 = 0; E.fade = 1;
      Emit();
      setFlash(wave >= 4 ? 0.8 : 0.35, '#eafaff');
      groundRing(at[0], at[2], 0.5 + wave * 0.2, 5 + wave * 1.5, [0.45, 1.42, 1.7], 0.85, 0.8);
      cue(state, 'zwave', { wave });
    }

    // --- aura + rising motes drawn off the ally
    cine.__acc = (cine.__acc || 0) + dt;
    while (cine.__acc >= 0.028) {
      cine.__acc -= 0.028;
      const a = Math.random() * TAU, rad = rr(0.1, 0.7) * (1 + h);
      E.layer = 0;
      E.cell = Math.random() < 0.55 ? CI.glow : CI.star;
      E.x = at[0] + Math.cos(a) * rad; E.y = at[1] + rr(0, h * 1.5); E.z = at[2] + Math.sin(a) * rad;
      E.vx = Math.cos(a) * 0.2; E.vy = rr(1.2, 3.4); E.vz = Math.sin(a) * 0.2;
      E.life = rr(0.35, 0.9); E.s0 = rr(0.1, 0.3); E.s1 = 0.02;
      E.r = Math.random() < 0.5 ? 1.5 : 0.7; E.g = 1.5; E.b = Math.random() < 0.5 ? 1.5 : 0.6;
      E.a0 = 0.9; E.a1 = 0; E.fade = 2; E.drag = 0.96; E.turb = 0.5;
      Emit();
    }

    // --- peak: everything collapses into the ally, then a hard cut to white
    if (!cine.__peak && t >= 1.42) {
      cine.__peak = true;
      cine.phase = 'cut';
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * TAU, e = rr(-0.7, 0.9), d = rr(3, 9);
        E.layer = 0; E.cell = CI.slash;
        E.x = at[0] + Math.cos(a) * Math.cos(e) * d;
        E.y = cy + Math.sin(e) * d;
        E.z = at[2] + Math.sin(a) * Math.cos(e) * d;
        const dx = at[0] - E.x, dy = cy - E.y, dz = at[2] - E.z;
        const dl = Math.hypot(dx, dy, dz) || 1;
        const spd = rr(14, 30);
        E.vx = dx / dl * spd; E.vy = dy / dl * spd; E.vz = dz / dl * spd;
        E.life = rr(0.16, 0.3); E.s0 = rr(0.5, 1.3); E.s1 = 0.12;
        E.r = 1.9; E.g = 1.85; E.b = 0.8; E.a0 = 1; E.a1 = 0; E.fade = 1;
        E.drag = 0.86; E.stretch = 3.6;
        Emit();
      }
      E.layer = 0; E.cell = CI.glow;
      E.x = at[0]; E.y = cy; E.z = at[2];
      E.life = 0.35; E.hold = 0.16; E.s0 = 2.2; E.s1 = 5.5;
      E.r = 2.6; E.g = 2.5; E.b = 2.2; E.a0 = 1; E.a1 = 0; E.fade = 1;
      Emit();
      state.flash = 1; state.flashCol = FLASH_COOL;
      setFlash(1, '#ffffff');
      setSky(0.85, 'charge'); setWash('zPose', 0.5); setVig(0.25);
      groundRing(at[0], at[2], 0.8, 11, [1.6, 1.9, 2.0], 0.8, 0.9);
      airRing(at[0], cy, at[2], 1.2, 12, [1.7, 1.9, 2.0], 0.5, 0.8);
      cue(state, 'flash', { alpha: 1, type: 'z', z: true });
      const camMod = state.mods && state.mods.camera;
      if (camMod) camMod.shake(state, 0.7);
    }
  };
  cine.ambient = (dt) => {
    cine.__amb = (cine.__amb || 0) + dt;
    while (cine.__amb >= 0.09) {
      cine.__amb -= 0.09;
      const a = Math.random() * TAU;
      E.layer = 0;
      E.cell = Math.random() < 0.5 ? CI.slash : CI.star;
      E.x = at[0]; E.y = cy; E.z = at[2];
      E.vx = Math.cos(a) * rr(5, 11); E.vy = Math.sin(a) * rr(2, 5); E.vz = Math.sin(a) * rr(3, 7);
      E.life = rr(0.3, 0.55); E.s0 = rr(0.3, 0.7); E.s1 = rr(0.6, 1.4);
      E.r = 1.6; E.g = 1.55; E.b = 0.6; E.a0 = 0.8; E.a1 = 0; E.fade = 1;
      E.drag = 0.99; E.stretch = 3.4;
      Emit();
    }
    groundRing(at[0], at[2], 0.4, 7.5, [0.45, 1.35, 1.6], 0.9, 0.4);
  };
  setWash('zPose', 0.74); setSky(0.45, 'charge'); setVig(0.5); setBars(0.06);
  setFlash(0.45, '#dff8ff');
  return after(2.0);
}

/* ------------------------------------------------------------------ zStrike */

const T_DET = 0.42;      // beam lands / detonation
const T_SKY = 1.55;      // fire recedes into the burning sky (afterglow)
const T_END = 3.40;      // cinematic releases

/** One frame-space fire lobe at `d` metres, placed at half-frame (sx, sy). */
function lobe(d, sx, sy, size, col, alpha, life, rise, em) {
  const q = framePt(d, sx, sy);
  E.layer = 0;
  E.cell = Math.random() < 0.7 ? CI.flame : CI.glow;
  E.x = q[0]; E.y = q[1]; E.z = q[2];
  E.vx = rr(-0.7, 0.7); E.vy = rise; E.vz = rr(-0.7, 0.7);
  E.life = life; E.s0 = size * rr(0.7, 1.0); E.s1 = size * rr(1.25, 1.85);
  E.r = col[0]; E.g = col[1]; E.b = col[2];
  E.a0 = alpha; E.a1 = 0; E.fade = 1; E.drag = 0.99; E.turb = 1.1;
  E.roll = rr(0, TAU); E.spin = rr(-0.7, 0.7);
  if (em) { E.em = 1; E.emN = em; }
  Emit();
}

/**
 * Subtractive smoke bank. The sprite pass is additive, so a negative vertex colour
 * *removes* light instead of adding it: the bank blackens whatever is behind it
 * (arena, sky, or the low end of the fire) and gives the blast its silhouettes.
 */
function ash(d, sx, sy, size, k, alpha, life, rise) {
  const q = framePt(d, sx, sy);
  E.layer = 1;
  E.cell = Math.random() < 0.6 ? CI.smoke : CI.puff;
  E.x = q[0]; E.y = q[1]; E.z = q[2];
  E.vx = rr(-0.5, 0.5); E.vy = rise; E.vz = rr(-0.5, 0.5);
  E.life = life; E.s0 = size; E.s1 = size * rr(1.3, 1.9);
  E.r = -k; E.g = -k; E.b = -k;
  E.a0 = alpha; E.a1 = 0; E.fade = 1; E.drag = 0.99; E.turb = 0.45;
  E.roll = rr(0, TAU); E.spin = rr(-0.25, 0.25);
  Emit();
}

/** Streak fired outward along the frame-space direction (dx, dy), in half-frames/sec. */
function streak(d, sx, sy, dx, dy, col, alpha, life, spd, len) {
  const q = framePt(d, sx, sy);
  const hh = d * B.ht, hw = hh * B.aspect;
  E.layer = 0;
  E.cell = CI.slash;
  E.x = q[0]; E.y = q[1]; E.z = q[2];
  E.vx = (B.r[0] * dx * hw + B.u[0] * dy * hh) * spd;
  E.vy = (B.r[1] * dx * hw + B.u[1] * dy * hh) * spd;
  E.vz = (B.r[2] * dx * hw + B.u[2] * dy * hh) * spd;
  E.life = life; E.s0 = len * rr(0.8, 1.2); E.s1 = len * rr(1.4, 2.1);
  E.r = col[0]; E.g = col[1]; E.b = col[2];
  E.a0 = alpha; E.a1 = 0; E.fade = 1; E.drag = 0.925; E.stretch = rr(2.6, 6.2);
  Emit();
}

/** Ember fleck thrown off a world point. */
function emberAt(x, y, z, spd, col, life, size, grav) {
  const a = Math.random() * TAU, e = rr(-0.4, 1.0), s = spd * rr(0.4, 1.3);
  E.layer = 0; E.cell = CI.spark;
  E.x = x + rr(-0.4, 0.4); E.y = y + rr(-0.4, 0.4); E.z = z + rr(-0.4, 0.4);
  E.vx = Math.cos(a) * Math.cos(e) * s; E.vy = Math.sin(e) * s; E.vz = Math.sin(a) * Math.cos(e) * s;
  E.life = life; E.s0 = size * rr(0.7, 1.3); E.s1 = size * 0.12;
  E.r = col[0]; E.g = col[1]; E.b = col[2];
  E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.96;
  E.grav = grav == null ? -1.6 : grav; E.stretch = 1.6; E.turb = 1.4;
  Emit();
}

function zStrike(state, opts) {
  const side = opts.side === 'foe' ? 'foe' : 'player';
  const tgt = opts.target === 'player' ? 'player' : 'foe';
  const ent = opts.entity || (state.units[side] && state.units[side].entity);
  const src = ent ? [ent.pos[0], ent.pos[1], ent.pos[2]] : posOf(state, side);
  const dst = posOf(state, tgt);
  const sh = (state.units[side] && state.units[side].focusHeight) || 0.6;
  const dh = heightOf(state, tgt);
  const hid = dst[1] + hitOffset(dh);
  const gy = groundOf(state);
  const type = opts.type || 'fire';
  const p = pal(type);
  const srcY = src[1] + sh * 0.9;

  cine.mode = 'zStrike';
  cine.phase = 'lance';
  cine.t = 0;
  setWash('zStrike', 0.5); setVig(0.5); setBars(0.075); setSky(0.18, 'fire');
  setFlash(0.55, '#fff0c8');
  cue(state, 'flash', { alpha: 0.7, type, z: true });

  let fired = false;
  let pos = [src[0], srcY, src[2]];
  const acc = { trail: 0, far: 0, mid: 0, near: 0, hot: 0, streak: 0, ember: 0, ash: 0,
                sky: 0, ridge: 0, rain: 0 };
  const ip = [0.35, 0.15, 4];        // impact point in frame space (half-frame units)

  cine.step = (dt) => {
    const t = cine.t;
    camBasis(state);
    const bt = t - T_DET;

    // Screen position of the blast, so streaks and hot lobes radiate from it.
    if (t >= T_DET) {
      const s = toScreen(dst[0], hid, dst[2]);
      if (s[2] > 0.6 && Math.abs(s[0]) < 2.5 && Math.abs(s[1]) < 2.5) {
        ip[0] = clamp(s[0], -1.4, 1.4);
        ip[1] = clamp(s[1], -1.4, 1.4);
        ip[2] = clamp(s[2], 1.4, 9);
      }
    }

    /* ---- A: the Z-beam crosses the field --------------------------------- */
    if (t < T_DET) {
      const u = clamp(t / T_DET, 0, 1);
      const e = u * u * (3 - 2 * u);
      pos = [lerp(src[0], dst[0], e), lerp(srcY, hid, e), lerp(src[2], dst[2], e)];
      acc.trail += dt;
      while (acc.trail >= 0.013) {
        acc.trail -= 0.013;
        const b = rr(0.05, 1.0);
        const bx = pos[0] + (src[0] - pos[0]) * b;
        const by = pos[1] + (srcY - pos[1]) * b;
        const bz = pos[2] + (src[2] - pos[2]) * b;
        E.layer = 0;
        E.cell = Math.random() < 0.55 ? CI.flame : CI.glow;
        E.x = bx + rr(-0.25, 0.25); E.y = by + rr(-0.25, 0.25); E.z = bz + rr(-0.25, 0.25);
        E.vx = rr(-1.6, 1.6); E.vy = rr(0.4, 3.2); E.vz = rr(-1.6, 1.6);
        E.life = rr(0.22, 0.55); E.s0 = rr(0.7, 1.6) * (1 - b * 0.55); E.s1 = rr(1.3, 2.8);
        E.r = p.main[0] * 1.5; E.g = p.main[1] * 1.25; E.b = p.main[2] * 0.9;
        E.a0 = 0.6; E.a1 = 0; E.fade = 1; E.drag = 0.94; E.turb = 1.4;
        Emit();
        if (Math.random() < 0.55) emberAt(bx, by, bz, 7, [1.8, 0.75, 0.2], rr(0.3, 0.8), 0.13, 0.4);
      }
      // white-hot head + flare
      E.layer = 0; E.cell = CI.glow;
      E.x = pos[0]; E.y = pos[1]; E.z = pos[2];
      E.life = 0.22; E.s0 = 1.05; E.s1 = 2.1;
      E.r = 2.2; E.g = 1.6; E.b = 0.75; E.a0 = 1; E.a1 = 0; E.fade = 1;
      Emit();
      E.layer = 0; E.cell = CI.star;
      E.x = pos[0]; E.y = pos[1]; E.z = pos[2];
      E.life = 0.2; E.s0 = 1.5; E.s1 = 3.4;
      E.r = 2.0; E.g = 1.35; E.b = 0.45; E.a0 = 0.85; E.a1 = 0; E.fade = 1;
      E.roll = rr(0, TAU); E.spin = rr(-2, 2);
      Emit();
      E.layer = 0; E.cell = CI.slash;
      E.x = pos[0]; E.y = pos[1]; E.z = pos[2];
      const dl = Math.hypot(dst[0] - src[0], dst[2] - src[2]) || 1;
      E.vx = (dst[0] - src[0]) / dl * 26; E.vy = 0; E.vz = (dst[2] - src[2]) / dl * 26;
      E.life = 0.2; E.s0 = 1.5; E.s1 = 3.4;
      E.r = 2.0; E.g = 1.5; E.b = 0.6; E.a0 = 0.9; E.a1 = 0; E.fade = 1;
      E.drag = 0.9; E.stretch = 5.5;
      Emit();
      // ground streak under the beam
      groundRing(pos[0], pos[2], 0.4, 2.6, [1.7, 1.2, 0.4], 0.4, 0.55);
      cine.ambient = null;
      return;
    }

    /* ---- B: detonation --------------------------------------------------- */
    if (!fired) {
      fired = true;
      cine.phase = 'blast';
      enterFireEnv(state);
      setWash('zStrike', 1); setVig(0.52); setSky(0.4, 'fire');
      detonate(state, dst[0], hid, dst[2], p, gy, dh, type);
    }

    const I = bt < 1.0 ? 1 : Math.max(0, 1 - (bt - 1.0) / 0.7);
    const J = Math.max(0, 1 - (bt - 0.85) / 0.85) * I;      // frame-filling layers

    /* ---- C: layered fire takes the frame --------------------------------- */
    if (I > 0.001) {
      // far bank: deep red sky lobes rolling behind the world silhouette
      acc.far += dt * 11 * I;
      while (acc.far >= 1) {
        acc.far -= 1;
        const d = rr(7, 18);
        lobe(d, rr(-1.35, 1.35), rr(-0.75, 0.95), frameH(d) * rr(0.34, 0.7),
             [0.92, 0.19, 0.03], rr(0.14, 0.26), rr(1.2, 2.3), rr(0.6, 3.0), 0);
      }
      // mid fireball: the mass of the blast, rising off the impact
      acc.mid += dt * 26 * J;
      while (acc.mid >= 1) {
        acc.mid -= 1;
        const d = rr(3.0, 7.2);
        lobe(d, rr(-1.15, 1.15), rr(-0.85, 0.95), frameH(d) * rr(0.2, 0.44),
             [1.35, 0.5, 0.07], rr(0.2, 0.34), rr(0.65, 1.5), rr(2, 6.5), 3);
      }
      // near bank: fast, big, low-alpha lobes that scroll up the lens
      acc.near += dt * 22 * J;
      while (acc.near >= 1) {
        acc.near -= 1;
        const d = rr(1.1, 3.0);
        lobe(d, rr(-1.25, 1.25), rr(-1.0, 1.0), frameH(d) * rr(0.26, 0.55),
             [1.2, 0.6, 0.16], rr(0.1, 0.2), rr(0.4, 0.95), rr(4, 11), 0);
      }
      // hot core lobes around the blast's screen position
      acc.hot += dt * 14 * J;
      while (acc.hot >= 1) {
        const d = rr(2.6, 6.5);
        lobe(d, ip[0] + rr(-0.55, 0.55), ip[1] + rr(-0.5, 0.5), frameH(d) * rr(0.1, 0.26),
             [2.0, 1.35, 0.45], rr(0.2, 0.38), rr(0.35, 0.85), rr(1.5, 5), 0);
      }
      // radial streaks + shock ring beats
      acc.streak += dt * 18 * J;
      while (acc.streak >= 1) {
        acc.streak -= 1;
        const a = Math.random() * TAU;
        const d = rr(2.2, 7);
        streak(d, ip[0] + Math.cos(a) * rr(0, 0.2), ip[1] + Math.sin(a) * rr(0, 0.2),
               Math.cos(a) * 1.5, Math.sin(a) * 1.5,
               [2.0, 1.5, 0.6], rr(0.25, 0.5), rr(0.22, 0.5), rr(0.7, 1.5), frameH(d) * 0.3);
      }
      // embers: flecks off the blast plus sparks streaming past the lens
      acc.ember += dt * 54 * I;
      while (acc.ember >= 1) {
        acc.ember -= 1;
        if (Math.random() < 0.6) {
          emberAt(dst[0], hid, dst[2], rr(6, 20), [1.85, 0.85, 0.22], rr(0.6, 1.6), rr(0.09, 0.2), -1.2);
        } else {
          const d = rr(1.6, 9);
          const q = framePt(d, rr(-1.3, 1.3), rr(-1.1, 1.1));
          E.layer = 0; E.cell = CI.spark;
          E.x = q[0]; E.y = q[1]; E.z = q[2];
          E.vx = rr(-1, 1); E.vy = rr(3, 12); E.vz = rr(-1, 1);
          E.life = rr(0.4, 1.2); E.s0 = rr(0.06, 0.16); E.s1 = 0.01;
          E.r = 1.9; E.g = rr(0.7, 1.1); E.b = 0.25;
          E.a0 = 1; E.a1 = 0; E.fade = 2; E.drag = 0.97; E.stretch = 1.6; E.turb = 1.2;
          Emit();
        }
      }
      // ash banks: silhouette structure in front of and inside the fire
      acc.ash += dt * 15 * I;
      while (acc.ash >= 1) {
        acc.ash -= 1;
        const d = rr(1.6, 6.5);
        ash(d, rr(-1.2, 1.2), rr(-0.9, 1.1), frameH(d) * rr(0.3, 0.75),
            rr(0.45, 1.1), rr(0.22, 0.5), rr(0.5, 1.4), rr(0, 2.2));
      }
    }

    // shock beats: rings + a bright strobe at the wavefronts
    if (!cine.__beat) cine.__beat = 0;
    const beats = [0.34, 0.62, 0.98];
    while (cine.__beat < beats.length && t >= T_DET + beats[cine.__beat]) {
      const i = cine.__beat++;
      airRing(dst[0], hid, dst[2], 1.4 + i * 1.6, 9 + i * 7, i > 1 ? [1.4, 0.7, 0.3] : p.hot, 0.55, 0.7 - i * 0.12);
      groundRing(dst[0], dst[2], 1.6, 12 + i * 9, i > 0 ? [1.5, 0.5, 0.12] : [1.9, 1.7, 0.9], 0.9, 0.8 - i * 0.15);
      if (i < 2) { state.flash = i === 0 ? 0.75 : 0.45; state.flashCol = FLASH_WARM; }
    }

    /* ---- D: afterglow — the burning sky ---------------------------------- */
    if (t >= T_SKY) {
      if (cine.phase !== 'afterglow') {
        cine.phase = 'afterglow';
        setWash('zStrike', 0.82); setVig(0.8); setSky(0.62, 'fire'); setBars(0.09);
        smoke(dst[0], hid, dst[2], 16, 4.5, 1.6, [0.5, 0.3, 0.16], 0.42, 2.4, 7, 2.6);
      }
      // horizon bank: the fire recedes into a band of sky
      acc.sky += dt * 9;
      while (acc.sky >= 1) {
        acc.sky -= 1;
        const d = rr(6, 17);
        lobe(d, rr(-1.4, 1.4), rr(0.05, 0.6), frameH(d) * rr(0.45, 0.85),
             [1.25, 0.42, 0.06], rr(0.1, 0.2), rr(1.3, 2.6), rr(0.3, 1.4), 0);
      }
      // dark ridge + drifting smoke silhouettes along the bottom of the frame
      acc.ridge += dt * 7;
      while (acc.ridge >= 1) {
        acc.ridge -= 1;
        const d = rr(2.4, 7.5);
        ash(d, rr(-1.4, 1.4), rr(0.72, 1.25), frameH(d) * rr(0.5, 0.9),
            rr(0.5, 0.95), rr(0.3, 0.5), rr(1.0, 2.0), rr(-0.2, 0.6));
      }
      // ember rain drifting down across the whole frame
      acc.rain += dt * 16;
      while (acc.rain >= 1) {
        acc.rain -= 1;
        const d = rr(2.2, 10);
        const q = framePt(d, rr(-1.3, 1.3), rr(-1.1, 1.1));
        E.layer = 0; E.cell = CI.spark;
        E.x = q[0]; E.y = q[1]; E.z = q[2];
        E.vx = rr(-0.6, 0.6); E.vy = rr(-2.4, -0.4); E.vz = rr(-0.6, 0.6);
        E.life = rr(0.9, 2.2); E.s0 = rr(0.05, 0.14); E.s1 = 0.01;
        E.r = 1.75; E.g = rr(0.45, 0.85); E.b = 0.16;
        E.a0 = 0.95; E.a1 = 0; E.fade = 2; E.drag = 0.995; E.stretch = 1.5; E.turb = 0.7;
        Emit();
      }
      cine.ambient = null;
    }
  };

  cine.ambient = null;
  clearOverlayAfter(T_END - 0.15);
  return after(T_END);
}

/** Full-power Z detonation: the held white-hot core, then the blast wave. */
function detonate(state, x, y, z, p, gy, h, type) {
  const camMod = state.mods && state.mods.camera;
  if (camMod) camMod.shake(state, 1.5);
  state.flash = 1; state.flashCol = FLASH_WARM;
  setFlash(1, '#fff6dd');
  cue(state, 'flash', { alpha: 1, type, z: true });
  cue(state, 'hitstop', { dur: 0.22 });

  /* --- held white-hot core: full brightness for ~0.44 s so a capture can land on
         it (bar: Inferno_Overdrive_VII.png), then the shell blows outward. */
  E.layer = 0; E.cell = CI.glow;
  E.x = x; E.y = y; E.z = z;
  E.life = 1.25; E.hold = 0.44; E.s0 = 1.35; E.s1 = 3.6;
  E.r = 3.0; E.g = 2.75; E.b = 2.3; E.a0 = 1; E.a1 = 0; E.fade = 1;
  E.spin = 0.4; Emit();
  E.layer = 0; E.cell = CI.glow;                 // tight inner core, stays white
  E.x = x; E.y = y; E.z = z;
  E.life = 1.15; E.hold = 0.42; E.s0 = 0.75; E.s1 = 2.0;
  E.r = 3.4; E.g = 3.2; E.b = 3.0; E.a0 = 1; E.a1 = 0; E.fade = 1; Emit();
  E.layer = 0; E.cell = CI.ring;                 // bright rim
  E.x = x; E.y = y; E.z = z;
  E.life = 1.1; E.hold = 0.38; E.s0 = 1.5; E.s1 = 4.2;
  E.r = 3.0; E.g = 2.0; E.b = 0.8; E.a0 = 0.95; E.a1 = 0; E.fade = 1;
  E.roll = rr(0, TAU); E.spin = 1.2; Emit();
  E.layer = 0; E.cell = CI.flame;                // flame shell that then expands
  E.x = x; E.y = y; E.z = z;
  E.life = 1.5; E.hold = 0.3; E.s0 = 2.4; E.s1 = 8.0;
  E.r = p.main[0] * 1.45; E.g = p.main[1] * 1.25; E.b = p.main[2] * 0.95;
  E.a0 = 0.95; E.a1 = 0; E.fade = 1; E.em = 1; E.emN = 16; Emit();
  E.layer = 0; E.cell = CI.glow;                 // wide haze halo
  E.x = x; E.y = y; E.z = z;
  E.life = 1.6; E.s0 = 3.2; E.s1 = 13;
  E.r = 1.2; E.g = 0.5; E.b = 0.14; E.a0 = 0.5; E.a1 = 0; E.fade = 1; Emit();

  // shock rings: air + ground, three beats
  for (let i = 0; i < 3; i++) {
    timers.push({ t: i * 0.09, res: () => {
      airRing(x, y, z, 1.5, 9 + i * 6, p.hot, 0.6, 0.8);
      groundRing(x, z, 1.5, 13 + i * 8, i > 0 ? [1.5, 0.5, 0.12] : [1.9, 1.7, 0.9], 0.9, 0.85);
    } });
  }

  // fire column climbing the target
  for (let i = 0; i < 20; i++) {
    E.layer = 0;
    E.cell = Math.random() < 0.72 ? CI.flame : CI.glow;
    E.x = x + rr(-3.2, 3.2); E.y = gy + rr(0.2, 4 + i * 1.7); E.z = z + rr(-3.2, 3.2);
    E.vx = rr(-1.6, 1.6); E.vy = rr(4, 15); E.vz = rr(-1.6, 1.6);
    E.life = rr(0.7, 1.6); E.s0 = rr(1.6, 3.2); E.s1 = rr(3, 5.6);
    E.r = p.main[0] * 1.35; E.g = p.main[1] * 1.1; E.b = p.main[2] * 0.8;
    E.a0 = 0.62; E.a1 = 0; E.fade = 1; E.drag = 0.95; E.turb = 2.6; E.em = 1; E.emN = 10;
    Emit();
  }
  // ember storm
  for (let i = 0; i < 100; i++) emberAt(x, y, z, rr(5, 22), [1.85, 0.8, 0.2], rr(0.7, 1.8), rr(0.09, 0.2), -2.2);
  // thrown flame lobes
  for (let i = 0; i < 44; i++) {
    const a = Math.random() * TAU, e = rr(-0.2, 1.1), s = rr(3, 14);
    E.layer = 0; E.cell = CI.flame;
    E.x = x + rr(-0.8, 0.8); E.y = y + rr(-0.8, 0.8); E.z = z + rr(-0.8, 0.8);
    E.vx = Math.cos(a) * Math.cos(e) * s; E.vy = Math.sin(e) * s * 0.8; E.vz = Math.sin(a) * Math.cos(e) * s;
    E.life = rr(0.4, 1.1); E.s0 = rr(0.8, 1.9); E.s1 = rr(1.4, 3.2);
    E.r = p.main[0] * 1.4; E.g = p.main[1] * 1.2; E.b = p.main[2] * 0.9;
    E.a0 = 0.8; E.a1 = 0; E.fade = 1; E.drag = 0.93; E.grav = 1.2; E.turb = 1.6;
    E.em = 1; E.emN = 6; Emit();
  }
  // ash / dust pillars at the ground
  for (let i = 0; i < 28; i++) {
    const a = rr(0, TAU), d = rr(2, 14);
    E.layer = 1; E.cell = CI.smoke;
    E.x = x + Math.cos(a) * d; E.y = gy + rr(0, 1.2); E.z = z + Math.sin(a) * d;
    E.vy = rr(3, 9); E.vx = Math.cos(a) * rr(0.6, 3); E.vz = Math.sin(a) * rr(0.6, 3);
    E.life = rr(1.2, 2.6); E.s0 = rr(1.6, 3.0); E.s1 = rr(4, 8);
    E.r = -0.55; E.g = -0.55; E.b = -0.55;
    E.a0 = 0.4; E.a1 = 0; E.fade = 1; E.turb = 1.5; Emit();
  }
  dustKick(x, z, 40, 3, 2.6, [0.82, 0.72, 0.5], 9);

  /* --- the blast wave washes over the lens: one frame-space bank that instantly
         replaces the battlefield with fire (composition of `..._VII.png`). */
  camBasis(state);
  for (let i = 0; i < 46; i++) {
    const d = rr(1.2, 6.5);
    lobe(d, rr(-1.3, 1.3), rr(-1.05, 1.05), frameH(d) * rr(0.3, 0.7),
         [1.5, 0.62, 0.12], rr(0.22, 0.42), rr(0.5, 1.5), rr(3, 10), 0);
  }
  for (let i = 0; i < 20; i++) {
    const d = rr(2.2, 9);
    lobe(d, rr(-1.4, 1.4), rr(-0.9, 1.0), frameH(d) * rr(0.4, 0.85),
         [0.95, 0.2, 0.03], rr(0.2, 0.34), rr(1.1, 2.2), rr(1, 3.5), 0);
  }
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * TAU;
    const d = rr(2, 8);
    const s = toScreen(x, y, z);
    const cx = clamp(s[2] > 0.6 ? s[0] : 0.3, -1.3, 1.3);
    const cy = clamp(s[2] > 0.6 ? s[1] : 0.1, -1.3, 1.3);
    streak(d, cx, cy, Math.cos(a) * 1.6, Math.sin(a) * 1.6,
           [2.1, 1.6, 0.65], rr(0.3, 0.6), rr(0.25, 0.6), rr(0.8, 1.8), frameH(d) * 0.32);
  }
  for (let i = 0; i < 16; i++) {
    const d = rr(1.5, 6);
    ash(d, rr(-1.3, 1.3), rr(-0.9, 1.1), frameH(d) * rr(0.35, 0.8),
        rr(0.5, 1.2), rr(0.3, 0.6), rr(0.6, 1.5), rr(0.5, 3));
  }
  // sky embers raining after the blast
  for (let i = 0; i < 60; i++) {
    E.layer = 0; E.cell = CI.spark;
    E.x = x + rr(-14, 14); E.y = gy + rr(6, 20); E.z = z + rr(-14, 14);
    E.vx = rr(-0.8, 0.8); E.vy = rr(-1.6, 0.6); E.vz = rr(-0.8, 0.8);
    E.life = rr(1.4, 3); E.s0 = rr(0.07, 0.18); E.s1 = 0.01;
    E.r = 1.6; E.g = rr(0.4, 0.8); E.b = 0.14; E.a0 = 0.95; E.a1 = 0; E.fade = 2;
    E.drag = 0.99; E.turb = 0.7; E.stretch = 1.4;
    Emit();
  }
}

/* --------------------------------------------------------------------- spawn */

export function spawn(state, kind, opts = {}) {
  state_ = state;
  if (!meshPart) return { promise: Promise.resolve() };
  switch (kind) {
    case 'projectile':
      return { promise: spawnProjectile(state, opts) };
    case 'impact':
      return { promise: impact(state, opts) };
    case 'miss':
      return { promise: missFx(state, opts) };
    case 'dash':
      return { promise: dash(state, opts) };
    case 'return':
      return { promise: returnLeg(state, opts) };
    case 'heal':
      return { promise: healFx(state, opts) };
    case 'faintDust':
      return { promise: faintDust(state, opts) };
    case 'recall':
      return { promise: recallFx(state, opts) };
    case 'ball':
      return { promise: ballFx(state, opts) };
    case 'encounter':
      return { promise: encounterFx(state, opts) };
    case 'fleeDust':
      return { promise: fleeDust(state, opts) };
    case 'statDrop':
      return { promise: statDropFx(state, opts) };
    case 'sandkick':
      return { promise: sandkickFx(state, opts) };
    case 'zPose':
      return { promise: zPose(state, opts) };
    case 'zStrike':
      return { promise: zStrike(state, opts) };
    default:
      return { promise: Promise.resolve() };
  }
}

/* ---------------------------------------------------------------- cinematic */

/** Full-frame Z-Move overlay. undefined = resync only (main.js calls this every frame). */
export function setCinematic(state, mode, opts = {}) {
  if (mode === undefined) { ensureOverlay(); return; }
  if (mode === state.cinematic) return;
  state.cinematic = mode;
  ensureOverlay();
  overlay.root.className = mode ? `on ${mode}` : 'on';
  cine.__wave = 0; cine.__peak = false; cine.__g1 = false; cine.__slow = false;
  cine.__beat = 0;
  if (mode === 'zPose') {
    setWash('zPose', 0.74); setSky(0.45, 'charge'); setVig(0.5); setBars(0.06);
  } else if (mode === 'zStrike') {
    setWash('zStrike', 0.5); setSky(0.18, 'fire'); setVig(0.5); setBars(0.075);
  } else {
    cine.step = null;
    cine.ambient = null;
    cine.mode = null;
    cine.phase = null;
    setWash(null, 0); setSky(0); setBars(0); setVig(0);
    state.flash = 0;
    exitFireEnv(state);
  }
}
