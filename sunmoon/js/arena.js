// arena.js — Exeggutor Island battlefield: sky dome, ocean, beach, Alola props.
// Owned by: arena builder.
//
// API: build(state) -> void   (push world entities, set state.groundY)
//      update(state, dt, t) -> void  (waves, foam swash, drift, sway, sparkle)
//
// Spatial contract: battle ring centred on state.field.ring (r = ringR), ally at
// state.field.playerSpot, foe at state.field.foeSpot, idle eye ~[-3.1,1.55,6.2]
// looking at ~[0,0.3,0.6]. Nothing taller than ~1.5 m inside that sight corridor;
// the ring interior stays clear apart from low grass (< 0.7 m) and small shells.
//
// World shape: a low tropical island. Terrain is flat sand out to R_PLATEAU, then
// slopes into the lagoon; the ocean is a single opaque plane 0.06 m under it, so
// the waterline is wherever the sand crosses WATER_Y. The sky dome's horizon band
// is painted with the scene fog colour, which is exactly what the fogged sea and
// land fade to, so the sky/sea seam can never read as an edge.
//
// Everything here is procedural: geometry from gl.js, textures drawn to canvas at
// build time, no per-frame geometry churn except two small dynamic meshes (the
// shoreline foam band and the water sparkle field).

import { geo, tex } from './gl.js';
import { SCENES } from './data.js';
import * as models from './models.js';

const TAU = Math.PI * 2;
const WATER_Y = -0.36;        // still-water surface
const SEA_Y = -0.42;          // opaque sea plane
const GLINT_Y = -0.38;        // additive swell glint overlay
const R_PLATEAU = 13;         // flat, dry battle ground out to here
const GLINT_L = 24;           // glint pattern period (m) — wrap is invisible
let CX = 0.4, CZ = 0.3;       // ring centre (set from state.field.ring in build)

/* --------------------------------------------------------------- helpers */

function mulberry(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
function smooth(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
const polar = (az, r) => [CX + Math.cos(az) * r, CZ + Math.sin(az) * r];
const DEG = Math.PI / 180;

/* --- value noise: the sand and the sea need non-repeating structure at metre
   scale, which a tiling texture cannot give. Deterministic, table-free, and only
   ever called at build time (never per frame). */
function hash2(ix, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * ux) * (1 - uz) + (c + (d - c) * ux) * uz;
}
/** 2D fbm in 0..1 (octaves hard-capped: build-time cost only). */
function fbm(x, z, oct = 2) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * vnoise(x * f + i * 13.7, z * f - i * 7.3);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return s / norm;
}

/** Island silhouette radius for an azimuth (m from the ring centre). */
function shoreR(th) {
  return 26 + 2.6 * Math.sin(3 * th + 1.1) + 1.2 * Math.sin(5 * th + 0.4) + 0.7 * Math.sin(7 * th + 2.2);
}

/** Terrain height. Zero (dead flat) across the whole battle ground. */
function terrainY(x, z) {
  const dx = x - CX, dz = z - CZ;
  const r = Math.hypot(dx, dz);
  const th = Math.atan2(dz, dx);
  const outer = shoreR(th) + 5;
  const t = clamp01((r - R_PLATEAU) / (outer - R_PLATEAU));
  let y = -2.6 * (t * t * (3 - 2 * t));
  if (r > outer) y -= (r - outer) * 1.2;
  const k = smooth(12, 21, r);
  y += k * (0.17 * Math.sin(dx * 0.33 + 1.3) * Math.cos(dz * 0.29 - 0.7)
          + 0.075 * Math.sin(dx * 0.87 - 0.4) * Math.sin(dz * 0.79 + 1.9));
  return y;
}

/** Radius at which the sand crosses the waterline for a given azimuth. */
function waterR(th) {
  let lo = 6, hi = shoreR(th) + 6;
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) * 0.5;
    if (terrainY(CX + Math.cos(th) * m, CZ + Math.sin(th) * m) > WATER_Y) lo = m; else hi = m;
  }
  return (lo + hi) * 0.5;
}

/* ------------------------------------------------------- dynamic scene ref */
let A = null;

/* --------------------------------------------------------------- textures */

/** Metres of world covered by one repeat of the sand grain tile. */
const SAND_TILE = 6;

/**
 * Wrap-safe beach grain. Three scales in one tile: damp/dry blotches (read at
 * 1-1.5 m), wind-ripple streaks, and coarse sand grain (reads in the near field).
 * Only blobs that actually cross a tile edge get their wrapped copies drawn, so
 * the 1024px tile stays cheap to build.
 */
function sandTexture() {
  return tex.canvas(1024, 1024, (g, w) => {
    const rnd = mulberry(9137);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, w);
    const blob = (x, y, r, style) => {
      g.fillStyle = style;
      for (let ix = -1; ix <= 1; ix++) for (let iy = -1; iy <= 1; iy++) {
        const cx = x + ix * w, cy = y + iy * w;
        if (cx + r < 0 || cx - r > w || cy + r < 0 || cy - r > w) continue;
        g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      }
    };
    for (let i = 0; i < 150; i++) {         // damp / dry blotches (0.25 - 1.1 m)
      const x = rnd() * w, y = rnd() * w, r = 30 + Math.pow(rnd(), 1.6) * 160;
      blob(x, y, r, rnd() > 0.42
        ? `rgba(172,150,110,${0.03 + rnd() * 0.07})`
        : `rgba(255,252,238,${0.03 + rnd() * 0.07})`);
    }
    for (let i = 0; i < 260; i++) {         // medium patchiness (0.06 - 0.24 m)
      const x = rnd() * w, y = rnd() * w, r = 10 + rnd() * 30;
      blob(x, y, r, rnd() > 0.5
        ? `rgba(158,138,102,${0.04 + rnd() * 0.10})`
        : `rgba(255,253,244,${0.04 + rnd() * 0.09})`);
    }
    for (let i = 0; i < 120; i++) {         // wind ripples: short soft dashes
      const x = rnd() * w, y = rnd() * w, len = 40 + rnd() * 120, hh = 2 + rnd() * 4;
      const a = (rnd() - 0.5) * 0.5;
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = `rgba(168,148,110,${0.03 + rnd() * 0.05})`;
      for (const [dx, dy] of [[0, 0], [-w, 0], [w, 0], [0, -w], [0, w]]) {
        g.beginPath(); g.ellipse(dx, dy, len * 0.5, hh, 0, 0, TAU); g.fill();
      }
      g.restore();
    }
    for (let i = 0; i < 5200; i++) {        // sand grain (1 - 4 px ≈ 0.6 - 2.4 cm)
      const x = rnd() * w, y = rnd() * w, r = 0.8 + Math.pow(rnd(), 1.5) * 2.6;
      blob(x, y, r, rnd() > 0.42
        ? `rgba(146,126,88,${0.07 + rnd() * 0.22})`
        : `rgba(255,253,242,${0.06 + rnd() * 0.22})`);
    }
  });
}

/** Metres of world covered by one repeat of the sea detail tile. */
const SEA_TILE = 12;

/**
 * Multiplicative detail for the sea surface: long swell streaks plus fine chop.
 * Deliberately anisotropic and non-radial — the tonal ramp lives in the vertex
 * colours, this only breaks up the flat plane.
 */
function seaTexture() {
  return tex.canvas(512, 512, (g, w) => {
    const rnd = mulberry(4471);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, w);
    const wrap = (x, y, dx, h, a, rot) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.fillStyle = `rgba(178,214,232,${a})`;
      for (const [ox, oy] of [[0, 0], [-w, 0], [w, 0], [0, -w], [0, w]]) {
        g.beginPath(); g.ellipse(ox, oy, dx, h, 0, 0, TAU); g.fill();
      }
      g.restore();
    };
    for (let i = 0; i < 130; i++) {          // swell streaks
      wrap(rnd() * w, rnd() * w, 30 + rnd() * 150, 2 + rnd() * 6, 0.04 + rnd() * 0.08, (rnd() - 0.5) * 0.3);
    }
    for (let i = 0; i < 180; i++) {          // short chop
      wrap(rnd() * w, rnd() * w, 8 + rnd() * 28, 1.5 + rnd() * 3, 0.025 + rnd() * 0.06, (rnd() - 0.5) * 0.9);
    }
    for (let i = 0; i < 260; i++) {          // light flecks (foam-scale sparkle)
      wrap(rnd() * w, rnd() * w, 1.6 + rnd() * 3.4, 1 + rnd() * 2, 0.02 + rnd() * 0.05, rnd() * 3.14);
    }
  });
}

/**
 * Sky dome gradient. Two constraints: the horizon band must be *exactly* the
 * scene fog colour (so a fogged sea/land can never meet it at an edge), and the
 * ramp must not band when it is stretched over the whole sky.
 */
function skyTexture(P, fogCol) {
  const hex = c => `rgb(${Math.round(clamp01(c[0]) * 255)},${Math.round(clamp01(c[1]) * 255)},${Math.round(clamp01(c[2]) * 255)})`;
  const zen = P.sky.zenith, mid = P.sky.mid, hor = P.sky.horizon;
  const WARM = [1.0, 0.90, 0.68];              // low-sun warmth sitting on the horizon
  return tex.canvas(8, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0.00, hex(zen));
    gr.addColorStop(0.18, hex(mix3(zen, mid, 0.72)));
    gr.addColorStop(0.31, hex(mid));
    gr.addColorStop(0.400, hex(mix3(mid, hor, 0.30)));
    gr.addColorStop(0.450, hex(mix3(mid, hor, 0.58)));
    gr.addColorStop(0.472, hex(mix3(hor, WARM, 0.22)));   // warm band just above the water
    gr.addColorStop(0.487, hex(mix3(hor, WARM, 0.12)));
    gr.addColorStop(0.4965, hex(mix3(hor, fogCol, 0.55)));
    gr.addColorStop(0.503, hex(fogCol));      // exactly the fog colour at the horizon
    gr.addColorStop(1.00, hex(fogCol));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const rnd = mulberry(2213);
    const img = g.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 2.6;
      d[i] = clamp01((d[i] + n) / 255) * 255;
      d[i + 1] = clamp01((d[i + 1] + n) / 255) * 255;
      d[i + 2] = clamp01((d[i + 2] + n) / 255) * 255;
    }
    g.putImageData(img, 0, 0);
  });
}

/**
 * Feathered cumulus puff for the billboard cloud sprites: elliptical soft alpha
 * (no square edge) with a warm-grey underside baked into rgb. The clouds' quads
 * map local +Y to screen up, so the warm end belongs at the *top* of the canvas
 * (v=0), which is what a billboard shows at its bottom.
 */
function cloudPuffTexture() {
  return tex.canvas(64, 64, (g, w) => {
    const c = w / 2;
    g.clearRect(0, 0, w, w);
    g.save(); g.translate(c, c); g.scale(1, 0.74);
    const gr = g.createRadialGradient(0, 0, w * 0.04, 0, 0, c);
    gr.addColorStop(0.00, 'rgba(255,255,255,1)');
    gr.addColorStop(0.50, 'rgba(255,255,255,0.94)');
    gr.addColorStop(0.74, 'rgba(255,255,255,0.55)');
    gr.addColorStop(0.90, 'rgba(255,255,255,0.20)');
    gr.addColorStop(1.00, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, c, 0, TAU); g.fill();
    g.restore();
    g.globalCompositeOperation = 'source-atop';       // tint rgb, keep the soft alpha
    const vg = g.createLinearGradient(0, 0, 0, w);
    vg.addColorStop(0.00, 'rgb(186,178,172)');        // warm grey underside
    vg.addColorStop(0.34, 'rgb(224,221,218)');
    vg.addColorStop(0.72, 'rgb(247,246,245)');
    vg.addColorStop(1.00, 'rgb(255,255,255)');
    g.fillStyle = vg; g.fillRect(0, 0, w, w);
    g.globalCompositeOperation = 'source-over';
  });
}

/** Vertical alpha ramp for the horizon haze wall (peaks at the horizon). */
function hazeWallTexture() {
  return tex.canvas(4, 128, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0.000, 'rgba(255,255,255,0)');     // top of the wall: clear sky
    gr.addColorStop(0.400, 'rgba(255,255,255,0.05)');
    gr.addColorStop(0.600, 'rgba(255,255,255,0.17)');
    gr.addColorStop(0.720, 'rgba(255,255,255,0.40)');  // the horizon itself
    gr.addColorStop(0.800, 'rgba(255,255,255,0.30)');
    gr.addColorStop(0.900, 'rgba(255,255,255,0.12)');
    gr.addColorStop(1.000, 'rgba(255,255,255,0)');     // below the horizon: fades out
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

/** Battle-ring decal: a faint trodden pool plus one soft ring, not a painted circle. */
function ringTexture() {
  return tex.canvas(256, 256, (g, w) => {
    const c = w / 2, R = w / 2;
    g.clearRect(0, 0, w, w);
    let gr = g.createRadialGradient(c, c, 0, c, c, R);
    gr.addColorStop(0.00, 'rgba(255,247,224,0.10)');
    gr.addColorStop(0.55, 'rgba(255,246,222,0.06)');
    gr.addColorStop(0.82, 'rgba(252,242,216,0.01)');
    gr.addColorStop(1.00, 'rgba(252,242,216,0.00)');
    g.fillStyle = gr; g.fillRect(0, 0, w, w);
    gr = g.createRadialGradient(c, c, 0.80 * R, c, c, R * 0.999);
    gr.addColorStop(0.00, 'rgba(112,88,52,0.00)');
    gr.addColorStop(0.40, 'rgba(116,92,56,0.12)');
    gr.addColorStop(0.74, 'rgba(120,96,60,0.10)');
    gr.addColorStop(1.00, 'rgba(126,100,64,0.00)');
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
  });
}

/* ------------------------------------------------------------ prop merging */

function cloneMesh(m) {
  return { pos: m.pos.slice(), nrm: m.nrm.slice(), col: m.col.slice(), uv: m.uv.slice(), idx: m.idx.slice() };
}

/**
 * Collapse a multi-part prop model into a single draw call by baking each part's
 * transform and colour into the vertices. Models whose parts need per-part
 * material state (textures, alpha on lit parts) are left alone.
 */
function flatten(model) {
  const parts = model && model.parts;
  if (!parts || parts.length < 2) return model;
  let unlit = null;
  for (const p of parts) {
    if (p.parent != null || p.tex || p.texMode) return model;
    const u = !!p.unlit;
    if (unlit === null) unlit = u;
    else if (unlit !== u) return model;
  }
  const meshes = parts.map(p => {
    const m = cloneMesh(p.geo);
    if (p.p || p.r || (p.s != null && p.s !== 1)) geo.bake(m, { p: p.p, r: p.r, s: p.s != null ? p.s : 1 });
    const c = p.col || [1, 1, 1];
    for (let i = 0; i < m.col.length; i += 3) {
      m.col[i] *= c[0]; m.col[i + 1] *= c[1]; m.col[i + 2] *= c[2];
    }
    return m;
  });
  const merged = geo.merge(...meshes);
  const first = parts[0];
  const out = { geo: merged, col: [1, 1, 1], spec: first.spec, shine: first.shine };
  if (unlit) out.unlit = true;
  if (first.alpha != null && first.alpha < 1) out.alpha = first.alpha;
  if (first.blend) out.blend = first.blend;
  if (first.doubleSided || parts.some(p => p.doubleSided)) out.doubleSided = true;
  if (first.cull) out.cull = first.cull;
  return { parts: [out] };
}

/* ---------------------------------------------------------------- build */

export function build(state) {
  const P = SCENES[state.sceneKey] || SCENES.exeggutorIsland;
  const FOG = (P.fog && P.fog.col) || [0.80, 0.91, 0.97];
  const ctx = state.ctx;
  const ringAt = state.field.ring, ringR = state.field.ringR;
  CX = ringAt[0]; CZ = ringAt[2];
  const rnd = mulberry(0x5A17);

  /* --- exposure -------------------------------------------------------------
     With the toon ramp a flat, up-facing surface gets hemi + light*1.10 and the
     grazing rim term on top of that — about 1.30x its albedo. Sand authored at
     full brightness therefore clips to flat white and every grain, damp patch and
     ridge disappears. The presets are scaled into that 1.30 budget so the plateau
     lands near 0.83 luminance with the top of the range safely under 1.0. */
  const EXPOS = 0.76;
  const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const SAND = scale3((P.ground && P.ground.sand) || [0.94, 0.88, 0.68], EXPOS);
  const WET = scale3((P.ground && P.ground.wet) || [0.80, 0.74, 0.56], EXPOS);
  const DRY = SAND;
  const DRY_LIT = scale3(SAND, 1.06);        // sunlit crest of a dry patch
  const DAMP = WET;
  const WET_DARK = scale3(WET, 0.72);        // saturated sand at the waterline
  const BED = [0.34, 0.60, 0.58];            // lagoon bed under the last centimetres

  /** Terrain albedo. `wr` (the waterline radius at this vertex's azimuth) may be
   *  passed in by the polar grids to avoid re-solving for it per vertex. */
  function landColor(x, z, y, wr) {
    const dx = x - CX, dz = z - CZ;
    const r = Math.hypot(dx, dz), th = Math.atan2(dz, dx);
    // dry/wet patchwork: 13 m drifts, 4 m blotches, 1.4 m grain — none of it can
    // come from the sand tile (it repeats every 6 m) so the beach never wallpapers.
    const nA = fbm(x * 0.075 + 11.3, z * 0.075 - 4.1, 2);
    const nB = fbm(x * 0.235 - 3.7, z * 0.235 + 9.2, 2);
    const nC = fbm(x * 0.68 + 21.5, z * 0.68 + 2.9, 2);
    let c = mix3(DRY, DRY_LIT, clamp01((nA - 0.36) * 1.75));
    c = mix3(c, DAMP, clamp01((nB - 0.46) * 1.8) * 0.5);
    // swash ridging: shallow ribs roughly parallel to the shoreline, growing in
    // from the plateau edge and dying out before the water
    const dr = r - (wr != null ? wr : waterR(th));
    const band = smooth(-2.2, 0.8, dr) * (1 - smooth(11.0, 17.0, dr));
    if (band > 0) {
      const rib = Math.sin(dr * 2.35 + 1.15 * Math.sin(th * 3.1 + 0.8))
                + 0.55 * Math.sin(dr * 4.9 - 1.35 * Math.sin(th * 5.3 - 1.1));
      const k = 1 + band * rib * 0.055;
      c = [c[0] * k, c[1] * k, c[2] * k];
    }
    // damp -> wet -> glistening margin
    c = mix3(c, DAMP, smooth(0.10, -0.20, y) * 0.6);
    c = mix3(c, WET_DARK, smooth(-0.14, -0.40, y));
    if (y < WATER_Y) c = mix3(c, BED, smooth(WATER_Y, WATER_Y - 1.5, y));
    const k2 = 1 + (nC - 0.5) * 0.075;
    return [c[0] * k2, c[1] * k2, c[2] * k2];
  }

  /* --- ocean: turquoise lagoon -> teal -> deep blue -> distance haze ---------
     Authored for the smooth (non-toon) ramp, which the sea part opts into: the
     tonal ramp is carried in vertex colours so the stepped specular cannot alias
     a hard band across the swell. */
  const SHALLOW = [0.300, 0.730, 0.690];
  const MID = [0.175, 0.530, 0.665];
  const DEEP = [0.070, 0.270, 0.520];
  const SPEC = [0.82, 0.85, 0.87];           // swell specular lane near the horizon
  const HAZE = mix3(FOG, [0.90, 0.95, 1.0], 0.4);
  function seaColor(x, z) {
    const dx = x - CX, dz = z - CZ;
    const d = Math.hypot(dx, dz), th = Math.atan2(dz, dx);
    let c = mix3(SHALLOW, MID, clamp01((d - 22) / 30));
    c = mix3(c, DEEP, clamp01((d - 52) / 58));
    // surface structure at three scales. Nothing here is a function of radius
    // alone: the azimuth terms are what keep the water off concentric rings.
    const st = fbm(x * 0.019 + 8.4, z * 0.082 - 3.2, 2) - 0.5;    // long streaks
    const ch = fbm(x * 0.105 - 4.4, z * 0.098 + 6.1, 2) - 0.5;    // chop
    const ln = fbm(Math.cos(th) * 3.2 + d * 0.017, Math.sin(th) * 3.2 - d * 0.009, 2) - 0.5;
    const k = 1 + st * 0.18 + ch * 0.06 + ln * 0.13;
    c = [c[0] * k, c[1] * k, c[2] * k];
    // bright water near the horizon: the swell's specular lane, broken into
    // fingers by the same long-streak field
    const lane = 0.40 + 0.60 * clamp01(ln * 2.6 + 0.55);
    c = mix3(c, SPEC, smooth(38, 78, d) * (1 - smooth(108, 190, d)) * 0.58 * lane);
    c = mix3(c, HAZE, smooth(58, 300, d) * 0.85);                 // aerial perspective
    return c;
  }
  /** Colour of the wet/dry surface at a point (what the foam band sits on). */
  function surfaceColor(x, z) {
    return terrainY(x, z) > WATER_Y ? landColor(x, z, terrainY(x, z)) : seaColor(x, z);
  }

  A = {
    cx: CX, cz: CZ, ctx, heightAt: terrainY, waterR, shoreR, seaColor, landColor, surfaceColor,
    waterY: WATER_Y, clouds: [], palms: [], glint: null, foam: null, sparkle: null,
    foot: [],                      // ground-occlusion footprints ({x, z, r, k})
  };
  state.arena = A;
  state.groundY = 0;

  const sandTex = ctx ? ctx.texture(sandTexture()) : null;
  const seaTex = ctx ? ctx.texture(seaTexture()) : null;
  const ringTex = ctx ? ctx.texture(ringTexture()) : null;
  const skyTex = ctx ? ctx.texture(skyTexture(P, FOG)) : null;
  const cloudTex = ctx ? ctx.texture(cloudPuffTexture()) : null;
  const hazeTex = ctx ? ctx.texture(hazeWallTexture()) : null;
  const aoTex = ctx ? ctx.texture(tex.softDisc(64, 'rgba(0,0,0,1)', 'rgba(0,0,0,0)', 0.02)) : null;

  /* ------------------------------------------------------------ island */
  const LAND_R = 64, LAND_RINGS = 54, LAND_SEG = 104;
  {
    const geoL = (() => {
      const pos = [], nrm = [], col = [], uv = [], idx = [];
      const wr = new Float32Array(LAND_SEG + 1);       // waterline radius per column
      for (let j = 0; j <= LAND_SEG; j++) wr[j] = waterR(TAU * j / LAND_SEG);
      for (let i = 0; i <= LAND_RINGS; i++) {
        const r = LAND_R * Math.pow(i / LAND_RINGS, 1.9);
        for (let j = 0; j <= LAND_SEG; j++) {
          const th = TAU * j / LAND_SEG;
          const x = CX + Math.cos(th) * r, z = CZ + Math.sin(th) * r;
          const y = terrainY(x, z);
          pos.push(x, y, z);
          const e = 0.7;
          const nx = (terrainY(x - e, z) - terrainY(x + e, z)) / (2 * e);
          const nz = (terrainY(x, z - e) - terrainY(x, z + e)) / (2 * e);
          const nl = Math.hypot(nx, 1, nz);
          nrm.push(nx / nl, 1 / nl, nz / nl);
          const c = landColor(x, z, y, wr[j]);
          col.push(c[0], c[1], c[2]);
          uv.push(x / SAND_TILE, z / SAND_TILE);
        }
      }
      for (let i = 0; i < LAND_RINGS; i++) for (let j = 0; j < LAND_SEG; j++) {
        const a = i * (LAND_SEG + 1) + j, b = a + LAND_SEG + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
      return { pos, nrm, col, uv, idx };
    })();
    const land = geo.mesh(geoL.pos, geoL.nrm, geoL.col, geoL.uv, geoL.idx);
    state.add({
      model: { parts: [{
        geo: land, col: [1, 1, 1], tex: sandTex, texMode: 1,
        spec: 0.03, shine: 10, rim: 0.05, doubleSided: true,
      }] },
      pos: [0, 0, 0],
    });
  }

  /* -------------------------------------------------------------- ocean */
  // Radial grid so resolution concentrates near the shore where the turquoise ->
  // deep gradient and the shoreline foam actually need it.
  function seaDisc(rMax, rings, seg, pow, colFn) {
    const pos = [], nrm = [], col = [], uv = [], idx = [];
    for (let i = 0; i <= rings; i++) {
      const r = rMax * Math.pow(i / rings, pow);
      for (let j = 0; j <= seg; j++) {
        const th = TAU * j / seg;
        const x = CX + Math.cos(th) * r, z = CZ + Math.sin(th) * r;
        pos.push(x, 0, z);
        nrm.push(0, 1, 0);
        const c = colFn(x, z, r, th);
        col.push(c[0], c[1], c[2]);
        uv.push(x / SEA_TILE, z / SEA_TILE);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return geo.mesh(pos, nrm, col, uv, idx);
  }
  const seaGeo = seaDisc(340, 72, 104, 1.8, (x, z) => seaColor(x, z));
  // additive swell glint: vertex colours carry an exactly GLINT_L-periodic pattern,
  // so sliding the part by GLINT_L is invisible — motion with zero CPU geometry work.
  const glintGeo = seaDisc(340, 56, 96, 1.7, (x, z) => {
    const k = TAU / GLINT_L;
    const w1 = Math.sin(x * k * 2 + 0.7) * Math.sin(z * k * 2 - 1.1);
    const w2 = Math.sin(x * k * 3 - 2.0) * Math.sin(z * k * 1 + 0.4);
    const w3 = Math.sin(x * k * 1 + 1.2) * Math.sin(z * k * 3 + 2.3);
    const v = clamp01((w1 * 0.46 + w2 * 0.34 + w3 * 0.2) * 0.5 + 0.5);
    const g = v * v * v * 1.15;
    return [g * 0.30, g * 0.40, g * 0.46];
  });
  // `toon: 0` keeps the swell smooth: the tonal ramp, the specular lane and the
  // haze all live in the vertex colours, so a stepped ramp would only add bands.
  const seaEntity = state.add({
    model: { parts: [
      { geo: seaGeo, col: [1, 1, 1], tex: seaTex, texMode: 1, spec: 0.22, shine: 90, rim: 0.10, toon: 0, doubleSided: true },
      { geo: glintGeo, col: [1, 1, 1], unlit: true, alpha: 0.5, blend: 'add', toon: 0, doubleSided: true, p: [0, GLINT_Y - SEA_Y, 0] },
    ] },
    pos: [0, SEA_Y, 0],
  });
  A.glint = seaEntity.model.parts[1];

  /* ------------------------------------------------- shoreline foam band */
  // One dynamic ring that follows whichever surface is on top (sand on the beach,
  // water offshore) and is tinted with travelling foam. Where the foam amount is
  // zero its colour is exactly the surface colour underneath, so it disappears.
  const FB_SEG = 96, FB_RINGS = 20, FB_RIN = 11, FB_ROUT = 34;
  const FB_VERTS = (FB_RINGS + 1) * (FB_SEG + 1);
  const foamGeo = geo.dynMesh(FB_VERTS + 8, FB_RINGS * FB_SEG * 6 + 8);
  const base = {
    x: new Float32Array(FB_VERTS), z: new Float32Array(FB_VERTS),
    r: new Float32Array(FB_VERTS), th: new Float32Array(FB_VERTS),
    ty: new Float32Array(FB_VERTS), rw: new Float32Array(FB_VERTS),
    rn: new Float32Array(FB_VERTS),
    col: new Float32Array(FB_VERTS * 3),
  };
  {
    const pos = [], nrm = [], col = [], uv = [], idx = [];
    for (let i = 0; i <= FB_RINGS; i++) {
      const r = FB_RIN + (FB_ROUT - FB_RIN) * Math.pow(i / FB_RINGS, 1.45);
      for (let j = 0; j <= FB_SEG; j++) {
        const th = TAU * j / FB_SEG;
        const x = CX + Math.cos(th) * r, z = CZ + Math.sin(th) * r;
        const k = i * (FB_SEG + 1) + j;
        base.x[k] = x; base.z[k] = z; base.r[k] = r; base.th[k] = th;
        base.ty[k] = terrainY(x, z); base.rw[k] = waterR(th);
        base.rn[k] = hash2(i * 131 + 7, j * 977 + 3);
        const wet = base.ty[k] <= WATER_Y;
        const c0 = wet ? seaColor(x, z) : landColor(x, z, base.ty[k], base.rw[k]);
        const c = [c0[0] * 0.965, c0[1] * 0.965, c0[2] * 0.965];   // ≈ the surfaces' texture average
        base.col[k * 3] = c[0]; base.col[k * 3 + 1] = c[1]; base.col[k * 3 + 2] = c[2];
        pos.push(x, Math.max(base.ty[k], WATER_Y) + 0.06, z);
        if (wet) nrm.push(0, 1, 0);
        else {
          const e = 0.7;
          const nx = (terrainY(x - e, z) - terrainY(x + e, z)) / (2 * e);
          const nz = (terrainY(x, z - e) - terrainY(x, z + e)) / (2 * e);
          const nl = Math.hypot(nx, 1, nz);
          nrm.push(nx / nl, 1 / nl, nz / nl);
        }
        col.push(c[0], c[1], c[2]);
        uv.push(j / FB_SEG * 3, i / FB_RINGS);
      }
    }
    for (let i = 0; i < FB_RINGS; i++) for (let j = 0; j < FB_SEG; j++) {
      const a = i * (FB_SEG + 1) + j, b = a + FB_SEG + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    foamGeo.pos.set(pos); foamGeo.nrm.set(nrm); foamGeo.col.set(col); foamGeo.uv.set(uv);
    foamGeo.idx.set(idx); foamGeo.count = FB_VERTS; foamGeo.idxCount = idx.length;
  }
  const foamPart = {
    geo: foamGeo, col: [1, 1, 1], alpha: 0.92, blend: 'alpha',
    spec: 0.06, shine: 30, rim: 0.3, doubleSided: true,
  };
  state.add({ model: { parts: [foamPart] }, pos: [0, 0, 0] });
  A.foam = { part: foamPart, base, seg: FB_SEG, rings: FB_RINGS, verts: FB_VERTS };

  /* -------------------------------------------------------- water sparkle */
  const SP_N = 96;
  const spGeo = geo.dynMesh(SP_N * 4 + 8, SP_N * 6 + 8);
  const spGeoBase = { x: new Float32Array(SP_N), z: new Float32Array(SP_N), ax: new Float32Array(SP_N),
                      az: new Float32Array(SP_N), ph: new Float32Array(SP_N), amp: new Float32Array(SP_N) };
  {
    const pos = [], nrm = [], col = [], uv = [], idx = [];
    for (let i = 0; i < SP_N; i++) {
      const az = rnd() * TAU;
      const r = 24 + Math.pow(rnd(), 0.7) * 76;
      const [x, z] = polar(az, r);
      spGeoBase.x[i] = x; spGeoBase.z[i] = z;
      spGeoBase.ax[i] = 0.5 + rnd() * 2.1;
      spGeoBase.az[i] = 0.22 + rnd() * 0.5;
      spGeoBase.ph[i] = rnd() * TAU;
      spGeoBase.amp[i] = 0.45 + rnd() * 0.75;
      const y = WATER_Y + 0.14;
      pos.push(x - spGeoBase.ax[i], y, z - spGeoBase.az[i], x + spGeoBase.ax[i], y, z - spGeoBase.az[i],
               x + spGeoBase.ax[i], y, z + spGeoBase.az[i], x - spGeoBase.ax[i], y, z + spGeoBase.az[i]);
      for (let k = 0; k < 4; k++) { nrm.push(0, 1, 0); col.push(0, 0, 0); }
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    spGeo.pos.set(pos); spGeo.nrm.set(nrm); spGeo.col.set(col); spGeo.uv.set(uv);
    spGeo.idx.set(idx); spGeo.count = SP_N * 4; spGeo.idxCount = idx.length;
  }
  const spPart = {
    geo: spGeo, col: [1, 1, 1], unlit: true, alpha: 0.75, blend: 'add', doubleSided: true,
    tex: ctx ? ctx.texture(tex.softDisc(64, 'rgba(255,252,236,1)', 'rgba(255,252,236,0)', 0.12)) : null,
    texMode: 1,
  };
  state.add({ model: { parts: [spPart] }, pos: [0, 0, 0] });
  A.sparkle = { part: spPart, base: spGeoBase, n: SP_N };

  /* ------------------------------------------------------------- sun/sky */
  const L = state.light || { dir: [-0.42, 0.74, 0.52] };
  const ld = L.dir || [-0.42, 0.74, 0.52];
  const ll = Math.hypot(ld[0], ld[1], ld[2]) || 1;
  const sunDir = [ld[0] / ll, ld[1] / ll, ld[2] / ll];
  const sunCol = (P.sky && P.sky.sun) || [1.0, 0.96, 0.80];

  const DOME_R = 320;
  {
    const dome = geo.sphere(DOME_R, 56, 36);
    for (let i = 0; i < dome.pos.length / 3; i++) {
      const x = dome.pos[i * 3], y = dome.pos[i * 3 + 1], z = dome.pos[i * 3 + 2];
      const nl = Math.hypot(x, y, z) || 1;
      const d = (x / nl) * sunDir[0] + (y / nl) * sunDir[1] + (z / nl) * sunDir[2];
      const warm = Math.pow(clamp01(d), 4) * 0.85 + Math.pow(clamp01(d), 12) * 0.5;
      // slight haze lift just above the horizon, warm halo around the sun
      const haze = 1 + smooth(0.16, 0.0, Math.abs(y) / DOME_R) * 0.03;
      dome.col[i * 3] = haze + warm * sunCol[0] * 0.42;
      dome.col[i * 3 + 1] = haze + warm * sunCol[1] * 0.30;
      dome.col[i * 3 + 2] = haze + warm * sunCol[2] * 0.10;
    }
    const domeEntity = {
      model: { parts: [{ geo: dome, col: [1, 1, 1], unlit: true, tex: skyTex, texMode: 1, cull: 'none' }] },
      pos: [0, 0, 0],
    };
    // sun disc + halo, placed on the scene light direction so the two agree.
    // Both sprites fade to zero alpha well inside their quads (core 0 = the glow
    // starts falling off at the centre), so neither can ever show a square edge.
    const sunPos = [sunDir[0] * (DOME_R - 42), sunDir[1] * (DOME_R - 42), sunDir[2] * (DOME_R - 42)];
    const sunEntity = {
      model: { parts: [
        { geo: geo.quad(118, 118), col: [sunCol[0] * 0.86, sunCol[1] * 0.72, sunCol[2] * 0.48], unlit: true,
          billboard: true, blend: 'add', alpha: 0.32, cull: 'none', outline: false,
          tex: ctx ? ctx.texture(tex.softDisc(128, 'rgba(255,243,204,0.9)', 'rgba(255,206,142,0)', 0.0)) : null, texMode: 1 },
        { geo: geo.quad(24, 24), col: [1, 1, 1], unlit: true, billboard: true, blend: 'add', alpha: 0.85, cull: 'none', outline: false,
          tex: ctx ? ctx.texture(tex.softDisc(64, 'rgba(255,255,250,1)', 'rgba(255,230,170,0)', 0.35)) : null, texMode: 1 },
      ] },
      pos: sunPos,
    };
    state.add(sunEntity);
    state.add(domeEntity);
  }

  /* --------------------------------------------------- battle ring decal */
  {
    const d = geo.disc(ringR, 72);
    state.add({
      model: { parts: [{
        geo: d, col: [1, 1, 1], tex: ringTex, texMode: 1, alpha: 0.99, blend: 'alpha',
        spec: 0.04, shine: 10, doubleSided: true,
      }] },
      pos: [ringAt[0], 0.035, ringAt[2]],
    });
  }

  /* ----------------------------------------------------- distant islands */
  // Three depth layers. Their colours are pre-hazed by hand toward the horizon
  // colour, growing with distance, so the far ridges sit visibly *behind* the
  // near ones after the scene fog has had its say — the horizon gets depth
  // instead of one crisp line.
  const HAZE_ISLE = mix3(FOG, [0.58, 0.70, 0.78], 0.4);
  function islandEntity(az, dist, R, peak, seed, haze) {
    const [ix, iz] = polar(az, dist);
    const r2 = mulberry(seed);
    const wob = [];
    for (let k = 0; k < 4; k++) wob.push([1 + k, r2() * TAU, 0.10 + r2() * 0.16]);
    const lumps = [];
    for (let k = 0; k < 12; k++) lumps.push([r2() * TAU, Math.pow(r2(), 0.6) * 0.82, 0.16 + r2() * 0.3]);
    const rings = 12, seg = 44;
    const pos = [], nrm = [], col = [], uv = [], idx = [];
    for (let i = 0; i <= rings; i++) {
      const t = Math.pow(i / rings, 1.4);
      for (let j = 0; j <= seg; j++) {
        const th = TAU * j / seg;
        let f = 1;
        for (const [k, ph, am] of wob) f += Math.sin(th * k + ph) * am;
        const r = R * t * f;
        let y = peak * (1 - smooth(0, 1, t)) - t * t * 5 - 1.2;
        if (t < 0.9) {                       // canopy bumps inside the landmass
          for (const [lth, lr, lh] of lumps) {
            const dd = Math.abs(((th - lth + Math.PI * 3) % TAU) - Math.PI);
            const dr = Math.abs(t - lr);
            if (dd < 0.5 && dr < 0.42) y += lh * peak * 0.5 * (1 - dd / 0.5) * (1 - dr / 0.42);
          }
        }
        pos.push(ix + Math.cos(th) * r, y, iz + Math.sin(th) * r);
        nrm.push(0, 1, 0);
        let c = mix3([0.19, 0.33, 0.25], [0.38, 0.44, 0.31], clamp01(y / Math.max(0.4, peak)));
        c = mix3(c, HAZE_ISLE, haze);
        col.push(c[0], c[1], c[2]);
        uv.push(j / seg, i / rings);
      }
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const mesh = geo.mesh(pos, nrm, col, uv, idx);
    state.add({ model: { parts: [{ geo: mesh, col: [1, 1, 1], doubleSided: true, spec: 0.02 }] }, pos: [0, 0, 0] });
  }
  islandEntity(-42 * DEG, 86, 9.0, 4.6, 907, 0.05);      // nearest: readable green ridge
  islandEntity(-21 * DEG, 116, 10.5, 5.2, 313, 0.20);
  islandEntity(-63 * DEG, 132, 12.0, 5.6, 771, 0.38);    // middle layer
  islandEntity(-78 * DEG, 166, 15.0, 6.2, 517, 0.58);    // far: barely a silhouette

  /* -------------------------------------------------------------- props */
  const props = A.props = [];
  const battlers = [state.field.playerSpot, state.field.foeSpot];

  function palmAt(azDeg, r, h, lean, seed, sink = -0.30) {
    const az = azDeg * DEG;
    let rr = r;
    while (rr > 6.5 && terrainY(...polar(az, rr)) < sink) rr -= 0.3;
    const [x, z] = polar(az, rr);
    for (const b of battlers) if (Math.hypot(x - b[0], z - b[2]) < 3.4) return;
    const y = Math.min(terrainY(x, z), 0.02);
    const entity = state.add({
      model: flatten(models.makePalmTree({ h, lean, seed })),
      pos: [x, y, z],
      rot: [0, az + 1.7 + seed * 0.7, 0],
    });
    const sway = { amp: 0.012 + (seed % 3) * 0.006, sp: 0.34 + (seed % 5) * 0.06, ph: seed * 1.31 };
    A.palms.push({ e: entity, base: [0, entity.rot[1], 0], sway });
    if (Math.abs(y) < 0.06) entity.shadow = { r: 0.9 + h * 0.07, alpha: 0.2 };
    A.foot.push({ x, z, r: 0.40 + h * 0.035, k: h > 7 ? 2 : 1 });
  }
  // Framing trees: the shot looks into the -Z/+X quadrant, so the visible beach arc
  // runs roughly az -120..-10. Crowns sit above the frame and the trunks cross the
  // side edges, the way the Alola battle backgrounds frame the arena.
  const PALM_SLOTS = [
    [-119, 12.8, 10.6, 0.28, 1], [-104, 11.8, 8.4, 0.22, 2], [-90, 13.8, 12.0, 0.18, 3],
    [-34, 15.4, 9.6, 0.2, 5], [-21, 16.8, 11.4, 0.16, 6], [-9, 15.0, 8.0, 0.24, 7],
  ];
  for (const [az, r, h, lean, seed] of PALM_SLOTS) palmAt(az, r, h, lean, seed);
  // Young palms down at the damp sand: their crowns land right on the sky/sea line,
  // which is what makes the horizon read as an Alola beach rather than a plain.
  const YOUNG = [
    [-95, 16.0, 5.2, 0.24, 22], [-64, 17.4, 4.9, 0.26, 24],
    [-33, 17.0, 5.4, 0.22, 26], [-11, 17.8, 4.6, 0.28, 28],
  ];
  for (const [az, r, h, lean, seed] of YOUNG) palmAt(az, r, h, lean, seed, -0.14);

  // rocks: scattered over dry sand and the upper beach, never inside the ring
  for (let i = 0; i < 16; i++) {
    const az = (-150 + rnd() * 175) * DEG;
    const r = 10.5 + rnd() * 11.5;
    const [x, z] = polar(az, r);
    if (terrainY(x, z) < -0.8) continue;
    if (Math.hypot(x - state.field.playerSpot[0], z - state.field.playerSpot[2]) < 2.6) continue;
    if (Math.hypot(x - state.field.foeSpot[0], z - state.field.foeSpot[2]) < 2.6) continue;
    const rad = 0.24 + Math.pow(rnd(), 1.7) * 0.95;
    const y = terrainY(x, z) - rad * 0.3;
    const e = { model: models.makeRock({ r: rad, seed: 20 + i }), pos: [x, y, z], rot: [0, rnd() * TAU, 0] };
    if (Math.abs(terrainY(x, z)) < 0.06) e.shadow = { r: rad * 1.5, alpha: 0.26 };
    state.add(e); props.push(e);
    A.foot.push({ x, z, r: rad * 1.3, k: rad > 0.62 ? 2 : 1 });
  }
  // shells: a few small ones in the arena for scale, the rest where shells wash up.
  // In-ring props stay well inside the ring (r <= 3.4): the battle camera eye sits at
  // r ~5.5 and can drop to ~0.4 m, so nothing may loiter in front of the lens.
  for (let i = 0; i < 15; i++) {
    const inside = i < 4;
    const az = rnd() * TAU;
    const r = inside ? 1.4 + rnd() * 2.0 : 13 + rnd() * 6.5;
    const [x, z] = polar(az, r);
    const s = 0.06 + rnd() * 0.07;
    state.add({
      model: models.makeShell({ r: s }), pos: [x, terrainY(x, z) + s * 0.3, z],
      rot: [rnd() * 0.3, rnd() * TAU, rnd() * 0.3],
    });
    A.foot.push({ x, z, r: s * 2.4, k: 0 });
  }
  // grass tufts: ground texture and scale, low enough to stay inside the ring
  for (let i = 0; i < 34; i++) {
    const inside = i < 7;
    const az = rnd() * TAU;
    const r = inside ? 1.8 + rnd() * 1.8 : 8 + rnd() * 12;
    const [x, z] = polar(az, r);
    if (!inside) {
      if (Math.hypot(x - state.field.playerSpot[0], z - state.field.playerSpot[2]) < 3.2) continue;
      if (Math.hypot(x - state.field.foeSpot[0], z - state.field.foeSpot[2]) < 3.2) continue;
      if (terrainY(x, z) < -0.2) continue;
    } else {
      // the camera eye is low (0.4 m) and sits just outside the ring: keep short
      // tufts away from the ally's silhouette
      if (Math.hypot(x - state.field.playerSpot[0], z - state.field.playerSpot[2]) < 3.0) continue;
      if (Math.hypot(x - state.field.foeSpot[0], z - state.field.foeSpot[2]) < 3.0) continue;
    }
    const h = inside ? 0.3 + rnd() * 0.12 : 0.34 + rnd() * 0.3;
    state.add({ model: flatten(models.makeGrassTuft({ h })), pos: [x, terrainY(x, z), z], rot: [0, rnd() * TAU, 0] });
    A.foot.push({ x, z, r: 0.26 + h * 0.3, k: 0 });
  }

  // tight contact occlusion under both battlers: the flat blobs stay as the broad
  // shadow, this is the darkening that touches their feet
  for (const b of battlers) A.foot.push({ x: b[0], z: b[2], r: 0.85, k: 2 });

  /* ------------------------------------------------------------- clouds */
  for (let i = 0; i < (P.sky.clouds || 9); i++) {
    const az = (-96 + rnd() * 74) * DEG;
    const dist = 58 + rnd() * 84;
    const [x, z] = polar(az, dist);
    const y = 6.5 + (dist - 58) * 0.115 + rnd() * 3.5;
    const cloud = models.makeCloud({ w: 9 + rnd() * 8 });
    // models.js builds each puff as a bare billboard quad — with no texture that
    // is a hard-edged white square. Give every puff the feathered, warm-bottomed
    // sprite instead (skipped if the model already carries its own texture).
    if (cloudTex) for (const p of cloud.parts) {
      if (p.billboard && !p.tex) { p.tex = cloudTex; p.texMode = 1; p.outline = false; }
    }
    const c = state.add({ model: flatten(cloud), pos: [x, y, z], rot: [0, rnd() * TAU, 0] });
    c.spd = 0.35 + rnd() * 0.45;
    A.clouds.push(c);
  }

  /* --------------------------------------------------- ground occlusion */
  // Contact darkening under everything that stands on the sand. Each footprint
  // becomes a small fan whose vertices follow terrainY, so the darkening hugs the
  // ground instead of floating like a flat contact blob does on the beach slope.
  // Three strength tiers (grasses/shells, mid props, battlers + big trees).
  {
    const AO_K = [0.15, 0.26, 0.40];
    const tiers = [[], [], []];
    for (const f of A.foot) tiers[f.k].push(f);
    for (let ti = 0; ti < 3; ti++) {
      const list = tiers[ti];
      if (!list.length) continue;
      const SEG = 12, pos = [], nrm = [], col = [], uv = [], idx = [];
      for (const f of list) {
        const c0 = pos.length / 3;
        const cy = terrainY(f.x, f.z) + 0.02;
        pos.push(f.x, cy, f.z); nrm.push(0, 1, 0); col.push(1, 1, 1); uv.push(0.5, 0.5);
        for (let ring = 1; ring <= 2; ring++) {
          const rr = f.r * (ring === 1 ? 0.55 : 1);
          for (let j = 0; j <= SEG; j++) {
            const th = TAU * j / SEG;
            const x = f.x + Math.cos(th) * rr, z = f.z + Math.sin(th) * rr;
            pos.push(x, terrainY(x, z) + 0.02, z);
            nrm.push(0, 1, 0); col.push(1, 1, 1);
            uv.push(0.5 + Math.cos(th) * 0.5 * (ring === 1 ? 0.55 : 1),
                    0.5 + Math.sin(th) * 0.5 * (ring === 1 ? 0.55 : 1));
          }
        }
        const r1 = c0 + 1, r2 = c0 + 1 + (SEG + 1);
        for (let j = 0; j < SEG; j++) idx.push(c0, r1 + j, r1 + j + 1);
        for (let j = 0; j < SEG; j++) idx.push(r1 + j, r2 + j, r1 + j + 1, r1 + j + 1, r2 + j, r2 + j + 1);
      }
      state.add({
        model: { parts: [{
          geo: geo.mesh(pos, nrm, col, uv, idx), col: [0.10, 0.085, 0.062],
          unlit: true, tex: aoTex, texMode: 2, alpha: AO_K[ti], blend: 'alpha',
          cull: 'none', doubleSided: true, outline: false,
        }] },
        pos: [0, 0, 0],
      });
    }
  }

  /* ------------------------------------------------------ horizon haze wall */
  // A ring just beyond the fog's far plane. Its alpha is a soft vertical ramp that
  // peaks at the horizon, so it lifts the swell's last bright lane and veils the
  // sea/sky junction (and anything beyond the islands) instead of leaving the
  // horizon as a drawn line.
  {
    const R = 226, SEG = 72, Y0 = -3.5, Y1 = 9;
    const pos = [], nrm = [], col = [], uv = [], idx = [];
    for (let j = 0; j <= SEG; j++) {
      const th = TAU * j / SEG;
      const x = CX + Math.cos(th) * R, z = CZ + Math.sin(th) * R;
      pos.push(x, Y1, z); nrm.push(0, 1, 0); col.push(1, 1, 1); uv.push(j / SEG * 3, 0);
      pos.push(x, Y0, z); nrm.push(0, 1, 0); col.push(1, 1, 1); uv.push(j / SEG * 3, 1);
    }
    for (let j = 0; j < SEG; j++) {
      const a = j * 2, b = a + 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    state.add({
      model: { parts: [{
        geo: geo.mesh(pos, nrm, col, uv, idx), col: [0.90, 0.95, 0.99],
        unlit: true, tex: hazeTex, texMode: 2, alpha: 1, blend: 'alpha',
        cull: 'none', doubleSided: true, outline: false,
      }] },
      pos: [0, 0, 0],
    });
  }
}

/* --------------------------------------------------------------- update */

export function update(state, dt, t) {
  if (!A) return;
  const A_ = A;

  // cumulus drift (wrap happens well outside the frame)
  for (let i = 0; i < A_.clouds.length; i++) {
    const c = A_.clouds[i];
    c.pos[0] += dt * c.spd;
    if (c.pos[0] > 155) c.pos[0] -= 310;
  }

  // palm sway: the whole tree tilts about its base, so the crowns move
  for (let i = 0; i < A_.palms.length; i++) {
    const p = A_.palms[i], e = p.e, s = p.sway;
    e.rot[2] = p.base[2] + Math.sin(t * s.sp + s.ph) * s.amp + Math.sin(t * s.sp * 2.4 + s.ph * 1.7) * s.amp * 0.35;
    e.rot[0] = p.base[0] + Math.sin(t * s.sp * 1.7 + s.ph * 0.7) * s.amp * 0.5;
    e.rot[1] = p.base[1] + Math.sin(t * s.sp * 0.6 + s.ph) * s.amp * 0.6;
  }

  // swell glint: shift the additive overlay by exactly one pattern period
  if (A_.glint) {
    let gx = A_.glint.p[0] + dt * 0.62;
    if (gx > GLINT_L * 0.5) gx -= GLINT_L;
    A_.glint.p[0] = gx;
    A_.glint.p[1] = (GLINT_Y - SEA_Y) + Math.sin(t * 0.7) * 0.012;
  }

  updateFoam(A_, t);
  updateSparkle(A_, t);
}

/**
 * Travelling waves + swash on the wet sand, painted onto the shore band.
 *
 * Everything here is a function of (r - waterline, azimuth, time) with several
 * crossing frequencies and a per-vertex grain, so the foam arrives in broken sets
 * and tongues instead of the concentric rings a single sin(r) wave train draws.
 * The band is also clamped to the last few metres either side of the waterline —
 * without that, the swash term paints the entire plateau white.
 */
function updateFoam(a, t) {
  const b = a.foam.base, part = a.foam.part, geo_ = part.geo;
  const pos = geo_.pos, col = geo_.col;
  const FOAM = [0.73, 0.76, 0.77];       // lands just under 1.0 after the day light
  for (let k = 0; k < a.foam.verts; k++) {
    const r = b.r[k], th = b.th[k], rw = b.rw[k], ty = b.ty[k], rn = b.rn[k];
    const swell = 0.035 * Math.sin(t * 0.9 + r * 0.34) + 0.02 * Math.sin(t * 1.45 - r * 0.62 + th * 2);
    const surf = WATER_Y + swell;
    pos[k * 3 + 1] = (ty > surf ? ty : surf) + 0.06;

    const dr = r - rw;
    const inside = 1 - smooth(-4, -13, dr);      // the foam band only exists near the water
    // white water: two crossing trains, both sheared around the island
    const w1 = Math.sin(dr * 0.57 + t * 1.02 + 1.55 * Math.sin(th * 4.1 + 0.6) + 0.80 * Math.sin(th * 9.4 - 1.7));
    const w2 = Math.sin(dr * 1.19 - t * 0.71 + 1.25 * Math.sin(th * 2.6 + 2.4) + 0.45 * Math.sin(th * 6.3 + 0.3));
    const crest = clamp01(0.5 + 0.33 * w1 + 0.22 * w2);
    // how much of this stretch is foaming, and how far offshore the white water
    // reaches: both tracked by azimuth, so the seaward edge is ragged
    const patch = clamp01(0.46 + 0.30 * Math.sin(th * 7.3 + dr * 0.19 + t * 0.21)
                               + 0.20 * Math.sin(th * 13.6 - dr * 0.31 - t * 0.13)
                               + 0.26 * (rn - 0.5));
    const reach = 7.0 + 7.0 * patch;
    const near = (1 - smooth(0.6, reach, dr)) * inside;
    const breaking = smooth(0.40, 0.94, crest) * (0.12 + 0.88 * near) * (0.30 + patch) * 1.15;
    // swash: the run-up line walks up and down the sand, split into tongues
    const run = 2.0 + 1.7 * Math.sin(t * 0.47 + th * 3.3) + 0.9 * Math.sin(t * 0.83 - th * 5.9);
    const lace = 0.40 + 1.25 * patch;
    const swash = clamp01((1 - smooth(-1.1, 1.6, dr - run)) * lace) * inside;
    const white = clamp01((1 - smooth(-0.45, 1.9, dr)) * lace) * inside;
    // drying foam left above the run-up line
    const residue = (1 - smooth(1.2, 6.0, dr)) * smooth(0.74, 0.97, patch) * 0.32 * (1 - swash) * inside;
    const foam = clamp01(breaking + swash * 0.85 + white * 0.5 + residue);
    const f = foam * foam * (0.5 + 0.5 * foam) * (0.90 + 0.20 * rn);
    const i3 = k * 3;
    col[i3] = b.col[i3] + (FOAM[0] - b.col[i3]) * f;
    col[i3 + 1] = b.col[i3 + 1] + (FOAM[1] - b.col[i3 + 1]) * f;
    col[i3 + 2] = b.col[i3 + 2] + (FOAM[2] - b.col[i3 + 2]) * f;
  }
  a.ctx.sync(part, a.foam.verts);
}

/** Sun glitter: twinkling additive flecks lying on the water surface. */
function updateSparkle(a, t) {
  const b = a.sparkle.base, part = a.sparkle.part, geo_ = part.geo;
  const pos = geo_.pos, col = geo_.col;
  for (let i = 0; i < a.sparkle.n; i++) {
    const ph = b.ph[i];
    const w = Math.sin(t * 1.35 + ph) * 0.5 + Math.sin(t * 2.7 + ph * 1.9) * 0.25;
    const lit = clamp01(w + 0.25);
    const br = lit * lit * lit * b.amp[i];
    const y = WATER_Y + 0.14 + Math.sin(t * 0.8 + ph * 2) * 0.045;
    for (let k = 0; k < 4; k++) pos[i * 12 + k * 3 + 1] = y;
    const i3 = i * 12;
    for (let k = 0; k < 4; k++) {
      col[i3 + k * 3] = br * 1.0;
      col[i3 + k * 3 + 1] = br * 0.99;
      col[i3 + k * 3 + 2] = br * 0.92;
    }
  }
  a.ctx.sync(part, a.sparkle.n * 4);
}
