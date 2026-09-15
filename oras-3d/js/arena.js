// arena.js: ORAS stadium arena (Freeze_VI staging). Sole owner: ArenaBuilder.
// Contract: export function drawArena(ctx, viewProj, t).
// Glossy teal floor with concentric fading glow bands under each battler,
// faint triangle inlays + hex response pattern, long specular streak decals,
// and a blue stadium wall with halo-backed glowing arches (bloom-spill fake)
// under a bright top beam, graded into a fog skirt at the wall base.
// front-left plus distance fog grading the floor toward the wall. Baked wash
// stays in the vertex colors; flat/+Y/zero normals ride a 9-float channel so
// the gl.js cel shader can model the architecture (see tri/triV below).
// Hand-built flat-shaded triangles via gl.js drawTrisN (guarded fallback to
// drawTris). Static soup built once (~510 tris, under the 600 budget).
import * as GL from "./gl.js";

// Battler ground spots, shared with models.js / effects.js. FROZEN.
export const FOE_SPOT = [0, 0, -5.2];
export const ME_SPOT = [0, 0, 2.5];

let cache9 = null, cache6 = null;
// STATIC atmosphere overlay (round 6): div#atmo over #stage but below #hud
// (inserted before #hud in tree order, z-index 0). CSS-only bloom fake the
// WebGL geometry cannot sell: cyan haze glowing top-center fading down,
// dark vignette edges, faint warm floor-glow band. Created once, lazily.
function ensureAtmo() {
  try {
    if (typeof document === "undefined") return;
    if (document.getElementById("atmo")) return;
    const stage = document.getElementById("stage");
    if (!stage) return;
    const el = document.createElement("div");
    el.id = "atmo";
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.pointerEvents = "none";
    el.style.zIndex = "0";
    el.style.background =
      "radial-gradient(ellipse 90% 55% at 50% 0%, rgba(90,180,255,0.38) 0%, rgba(90,180,255,0) 70%)," +
      "linear-gradient(to bottom, rgba(100,180,255,0.14) 0%, rgba(100,180,255,0) 30%)," +
      "linear-gradient(to bottom, rgba(0,0,0,0) 62%, rgba(255,178,105,0.10) 82%, rgba(255,150,80,0.06) 100%)," +
      "radial-gradient(ellipse 120% 110% at 50% 45%, rgba(0,0,0,0) 52%, rgba(2,6,16,0.58) 100%)";
    stage.insertBefore(el, document.getElementById("hud"));
  } catch (_) { /* non-DOM GL harness: overlay simply never exists */ }
}
ensureAtmo();

// Normal channel for the cel pass (data9 = [x,y,z, r,g,b, nx,ny,nz]).
// tri/triV default to +Y (floor decals, rings, pool, sky); wall planes pass
// FACE (+Z); pure-emissive pieces (beam, hot cores, moon, stars) pass zeros
// to stay fullbright (unlit path in the shader).
const FACE = [0, 0, 1];
function tri(out, ax, ay, az, bx, by, bz, cx, cy, cz, r, g, b, nx = 0, ny = 1, nz = 0) {
  out.push(ax, ay, az, r, g, b, nx, ny, nz, bx, by, bz, r, g, b, nx, ny, nz, cx, cy, cz, r, g, b, nx, ny, nz);
}
function triV(out, a, b, c, n) {
  const nx = n ? n[0] : 0, ny = n ? n[1] : 1, nz = n ? n[2] : 0;
  out.push(a[0], a[1], a[2], a[3], a[4], a[5], nx, ny, nz);
  out.push(b[0], b[1], b[2], b[3], b[4], b[5], nx, ny, nz);
  out.push(c[0], c[1], c[2], c[3], c[4], c[5], nx, ny, nz);
}

// Cool-blue key wash from front-left: ~+/-0.2 brightness across the arena,
// with a blue-channel lift on the lit side.
function washF(x, z) {
  return 1 + 0.006 * (-x * 0.6 + z * 0.8);
}
function coolLift(x) {
  const k = Math.max(0, Math.min(1, (-x + 20) / 40));
  return [0, 0.015 * k, 0.035 * k];
}

// Distance fog toward the wall (camera sits near z~+9.5, wall at z=-26).
const FOG = [0.07, 0.15, 0.28];
function fogK(z) {
  const k = Math.max(0, Math.min(1, (-z + 9.5) / 40));
  return Math.pow(k, 1.5) * 0.85;
}

// Floor teal: lighter toward arena heart, deep toward the rim, lit by the
// wash, cooled on the lit side, fogged with distance toward the wall.
const FLOOR_HI = [0.06, 0.30, 0.34];
const FLOOR_LO = [0.015, 0.14, 0.17];
function floorCol(x, z) {
  const r = Math.hypot(x, z);
  const k = Math.min(r / 31, 1);
  const f = k * k;
  const sheen = 0.06 * Math.max(0, 1 - Math.abs(r - 6) / 6);
  const w = washF(x, z);
  const cl = coolLift(x);
  let cr = (FLOOR_HI[0] + (FLOOR_LO[0] - FLOOR_HI[0]) * f + sheen * 0.4) * w;
  let cg = (FLOOR_HI[1] + (FLOOR_LO[1] - FLOOR_HI[1]) * f + sheen) * w + cl[1];
  let cb = (FLOOR_HI[2] + (FLOOR_LO[2] - FLOOR_HI[2]) * f + sheen) * w + cl[2];
  const fk = fogK(z);
  return [cr + (FOG[0] - cr) * fk, cg + (FOG[1] - cg) * fk, cb + (FOG[2] - cb) * fk];
}
function fVert(x, z) {
  const c = floorCol(x, z);
  return [x, 0, z, c[0], c[1], c[2]];
}

function buildFloor(out) {
  const RADII = [0, 3, 6.5, 11, 17, 24, 31];
  const SEC = 12;
  for (let j = 0; j < RADII.length - 1; j++) {
    for (let i = 0; i < SEC; i++) {
      const a0 = (i / SEC) * Math.PI * 2;
      const a1 = ((i + 1) / SEC) * Math.PI * 2;
      if (j === 0) {
        triV(out, fVert(0, 0),
          fVert(Math.cos(a0) * RADII[1], Math.sin(a0) * RADII[1]),
          fVert(Math.cos(a1) * RADII[1], Math.sin(a1) * RADII[1]));
      } else {
        const r0 = RADII[j], r1 = RADII[j + 1];
        const p00 = fVert(Math.cos(a0) * r0, Math.sin(a0) * r0);
        const p01 = fVert(Math.cos(a1) * r0, Math.sin(a1) * r0);
        const p10 = fVert(Math.cos(a0) * r1, Math.sin(a0) * r1);
        const p11 = fVert(Math.cos(a1) * r1, Math.sin(a1) * r1);
        triV(out, p00, p10, p11);
        triV(out, p00, p11, p01);
      }
    }
  }
}

// Faint triangle inlays (inherit floor lit/fog color, lifted slightly) +
// soft specular streak up the middle of the floor + faint hex response
// pattern on the mid floor.
function buildInlays(out) {
  const spots = [
    [4.5, -3.5, 2.2, 0.4], [-5.0, -1.0, 1.8, 2.2], [3.0, 4.5, 1.6, 1.1],
    [-3.5, 5.5, 2.0, 4.0], [8.0, -7.0, 2.4, 5.1], [-8.5, -6.0, 2.1, 3.0],
    [0.5, -11.5, 2.6, 0.9], [-1.5, 9.5, 1.7, 2.7],
  ];
  for (const [cx, cz, s, rot] of spots) {
    const base = floorCol(cx, cz);
    const c = [base[0] + 0.07, base[1] + 0.07, base[2] + 0.07];
    const y = 0.012;
    const p = [];
    for (let m = 0; m < 3; m++) {
      const an = rot + (m / 3) * Math.PI * 2;
      p.push([cx + Math.cos(an) * s, cz + Math.sin(an) * s * 0.6]);
    }
    tri(out, p[0][0], y, p[0][1], p[1][0], y, p[1][1], p[2][0], y, p[2][1], c[0], c[1], c[2]);
  }
  // Specular streak: per-vertex lit floor color lifted, so it keeps wash+fog.
  const y = 0.011, L = 0.10;
  const q = (x, z) => { const c = floorCol(x, z); return [x, y, z, c[0] + L, c[1] + L, c[2] + L]; };
  triV(out, q(-1.1, 9), q(1.1, 9), q(0.7, -7));
  triV(out, q(-1.1, 9), q(0.7, -7), q(-0.7, -7));
  triV(out, q(-0.5, 9), q(0.5, 9), q(0.35, -7));
  triV(out, q(-0.5, 9), q(0.35, -7), q(-0.35, -7));
  // Faint hex response cells: flat fan, floor color lifted with a mint tick.
  const hexes = [
    [5.5, -4.5, 1.2, 0.3], [-4.5, -8.5, 1.0, 1.2], [6.5, 1.5, 0.9, 2.0], [-6.5, 3.5, 1.1, 0.8],
  ];
  for (const [cx, cz, s, rot] of hexes) {
    const base = floorCol(cx, cz);
    const c = [base[0] + 0.045, base[1] + 0.05, base[2] + 0.045];
    const yh = 0.014;
    for (let m = 0; m < 6; m++) {
      const a = rot + (m / 6) * Math.PI * 2;
      const b2 = rot + ((m + 1) / 6) * Math.PI * 2;
      tri(out, cx, yh, cz,
        cx + Math.cos(a) * s, yh, cz + Math.sin(a) * s,
        cx + Math.cos(b2) * s, yh, cz + Math.sin(b2) * s,
        c[0], c[1], c[2]);
    }
  }
}

// Long specular streak decal: wide faint blade running from the foreground
// toward the wall base, baked fade (bright near, dissolving far).
function buildStreak(out) {
  const y = 0.016;
  const v = (x, z, lift) => {
    const c = floorCol(x, z);
    return [x, y, z, c[0] + lift, c[1] + lift, c[2] + lift];
  };
  triV(out, v(-5.0, 12, 0.24), v(5.0, 12, 0.24), v(6.0, -23, 0.08));
  triV(out, v(-5.0, 12, 0.24), v(6.0, -23, 0.08), v(-6.0, -23, 0.08));
  // Broad flanking wash: faint wide blade under the main streak.
  const v2 = (x, z, lift) => { const c = floorCol(x, z); return [x, 0.018, z, c[0] + lift, c[1] + lift, c[2] + lift]; };
  triV(out, v2(-7.5, 12, 0.08), v2(7.5, 12, 0.08), v2(9.0, -23, 0.04));
  triV(out, v2(-7.5, 12, 0.08), v2(9.0, -23, 0.04), v2(-9.0, -23, 0.04));
}

// Flat annulus band (outer rx,rz minus inner edge) with one flat color.
function annulus(out, cx, cz, y, rx, rz, ix, iz, r, g, b, SEG) {
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const b2 = ((i + 1) / SEG) * Math.PI * 2;
    const ox0 = cx + Math.cos(a) * rx, oz0 = cz + Math.sin(a) * rz;
    const ox1 = cx + Math.cos(b2) * rx, oz1 = cz + Math.sin(b2) * rz;
    const ix0 = cx + Math.cos(a) * ix, iz0 = cz + Math.sin(a) * iz;
    const ix1 = cx + Math.cos(b2) * ix, iz1 = cz + Math.sin(b2) * iz;
    tri(out, ox0, y, oz0, ox1, y, oz1, ix1, y, iz1, r, g, b);
    tri(out, ox0, y, oz0, ix1, y, iz1, ix0, y, iz0, r, g, b);
  }
}

// Glow ring as concentric fading bands (no blending state): dim halo,
// bright core, softer inner falloff, faint heart disc.
function glowRing(out, cx, cz, s) {
  const halo = [0.26, 0.68, 0.50];
  const core = [0.75, 1.0, 0.80];
  const mid = [0.42, 0.95, 0.68];
  const heart = [0.55, 1.0, 0.70];
  annulus(out, cx, cz, 0.02, 2.40 * s, 1.45 * s, 1.75 * s, 1.06 * s,
    halo[0], halo[1], halo[2], 12);
  annulus(out, cx, cz, 0.025, 1.75 * s, 1.06 * s, 1.35 * s, 0.82 * s,
    core[0], core[1], core[2], 16);
  annulus(out, cx, cz, 0.03, 1.35 * s, 0.82 * s, 0.90 * s, 0.55 * s,
    mid[0], mid[1], mid[2], 12);
  const SEG = 8;
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const b2 = ((i + 1) / SEG) * Math.PI * 2;
    tri(out, cx, 0.028, cz,
      cx + Math.cos(a) * 0.55 * s, 0.028, cz + Math.sin(a) * 0.35 * s,
      cx + Math.cos(b2) * 0.55 * s, 0.028, cz + Math.sin(b2) * 0.35 * s,
      heart[0], heart[1], heart[2]);
  }
}

// Blue stadium wall at z=-26, washed by the same cool key (left brighter,
// slight top lift): deep band, center floodlight wash, bright top beam,
// ten arches each backed by two halo bands (bloom-spill fake) with a
// near-white trim rim, bright sill + hot core, faint lower triangles,
// fog skirt melting the base into the floor, bright base strip.
function wallLit(base, x, y) {
  const w = (1 + 0.12 * (-x / 34)) * (1 + 0.08 * (y / 7));
  const cl = coolLift(x);
  return [base[0] * w, base[1] * w + cl[1], base[2] * w + cl[2]];
}
function wVert(base, x, y, z) {
  const c = wallLit(base, x, y);
  return [x, y, z, c[0], c[1], c[2]];
}

function buildWall(out) {
  const Z = -26;
  const X0 = -34, X1 = 34;
  const deep = [0.03, 0.12, 0.24];
  // Base band y 0..7 with baked wash gradient.
  triV(out, wVert(deep, X0, 0, Z), wVert(deep, X1, 0, Z), wVert(deep, X1, 8.4, Z), FACE);
  triV(out, wVert(deep, X0, 0, Z), wVert(deep, X1, 8.4, Z), wVert(deep, X0, 8.4, Z), FACE);
  // Center floodlight wash, cooler and left-biased.
  const wash = [0.09, 0.27, 0.47];
  triV(out,
    wVert(wash, -9, 0, Z + 0.005), wVert(wash, 9, 0, Z + 0.005), wVert(wash, 9, 8.4, Z + 0.005), FACE);
  triV(out,
    wVert(wash, -9, 0, Z + 0.005), wVert(wash, 9, 8.4, Z + 0.005), wVert(wash, -9, 8.4, Z + 0.005), FACE);
  // Top beam: bright cyan strip y 7.5..8.15, lifted for the upper crowd tier.
  const beam = [0.45, 0.90, 1.0];
  const zb = Z + 0.01;
  tri(out, X0, 7.5, zb, X1, 7.5, zb, X1, 8.15, zb, beam[0], beam[1], beam[2], 0, 0, 0);
  tri(out, X0, 7.5, zb, X1, 8.15, zb, X0, 8.15, zb, beam[0], beam[1], beam[2], 0, 0, 0);
  // Arch row with bloom-spill fake: three nested halo fields per arch,
  // near-white trim rim, bright sill strip + hot core, glow body, dark inset.
  const haloO = [0.25, 0.58, 0.82];
  const haloM = [0.45, 0.80, 0.95];
  const haloI = [0.78, 0.97, 1.0];
  const trim = [0.75, 1.0, 1.0];
  const hot = [0.95, 1.0, 1.0];
  const sill = [0.85, 1.0, 1.0];
  const glow = [0.35, 0.85, 1.0];
  const dark = [0.06, 0.22, 0.44];
  for (let k = 0; k < 10; k++) {
    const cx = -22.5 + k * 5;
    const zho = Z + 0.010 + (k % 3) * 0.004, zhm = Z + 0.022 + (k % 2) * 0.004, zhi = Z + 0.030;
    const zt = Z + 0.034, za = Z + 0.038, zi = Z + 0.044, zh = Z + 0.049;
    tri(out, cx - 6.3, 1.8, zho, cx + 6.3, 1.8, zho, cx + 6.3, 6.1, zho, haloO[0], haloO[1], haloO[2], 0, 0, 1);
    tri(out, cx - 6.3, 1.8, zho, cx + 6.3, 6.1, zho, cx - 6.3, 6.1, zho, haloO[0], haloO[1], haloO[2], 0, 0, 1);
    tri(out, cx - 3.6, 2.1, zhm, cx + 3.6, 2.1, zhm, cx + 3.6, 6.1, zhm, haloM[0], haloM[1], haloM[2], 0, 0, 1);
    tri(out, cx - 3.6, 2.1, zhm, cx + 3.6, 6.1, zhm, cx - 3.6, 6.1, zhm, haloM[0], haloM[1], haloM[2], 0, 0, 1);
    tri(out, cx - 2.0, 2.5, zhi, cx + 2.0, 2.5, zhi, cx + 2.0, 6.0, zhi, haloI[0], haloI[1], haloI[2], 0, 0, 1);
    tri(out, cx - 2.0, 2.5, zhi, cx + 2.0, 6.0, zhi, cx - 2.0, 6.0, zhi, haloI[0], haloI[1], haloI[2], 0, 0, 1);
    tri(out, cx - 0.97, 3.28, zt, cx + 0.97, 3.28, zt, cx + 0.97, 5.08, zt, trim[0], trim[1], trim[2], 0, 0, 1);
    tri(out, cx - 0.97, 3.28, zt, cx + 0.97, 5.08, zt, cx - 0.97, 5.08, zt, trim[0], trim[1], trim[2], 0, 0, 1);
    tri(out, cx - 0.97, 5.08, zt, cx + 0.97, 5.08, zt, cx, 5.82, zt, trim[0], trim[1], trim[2], 0, 0, 1);
    tri(out, cx - 1.0, 3.02, za, cx + 1.0, 3.02, za, cx + 1.0, 3.28, za, sill[0], sill[1], sill[2], 0, 0, 1);
    tri(out, cx - 1.0, 3.02, za, cx + 1.0, 3.28, za, cx - 1.0, 3.28, za, sill[0], sill[1], sill[2], 0, 0, 1);
    tri(out, cx - 0.55, 2.98, zh, cx + 0.55, 2.98, zh, cx, 3.55, zh, hot[0], hot[1], hot[2], 0, 0, 0);
    tri(out, cx - 0.8, 3.4, za, cx + 0.8, 3.4, za, cx + 0.8, 5.0, za, glow[0], glow[1], glow[2], 0, 0, 1);
    tri(out, cx - 0.8, 3.4, za, cx + 0.8, 5.0, za, cx - 0.8, 5.0, za, glow[0], glow[1], glow[2], 0, 0, 1);
    tri(out, cx - 0.8, 5.0, za, cx + 0.8, 5.0, za, cx, 5.7, za, glow[0], glow[1], glow[2], 0, 0, 1);
    tri(out, cx - 0.5, 3.6, zi, cx + 0.5, 3.6, zi, cx + 0.5, 4.9, zi, dark[0], dark[1], dark[2], 0, 0, 1);
    tri(out, cx - 0.5, 3.6, zi, cx + 0.5, 4.9, zi, cx - 0.5, 4.9, zi, dark[0], dark[1], dark[2], 0, 0, 1);
    tri(out, cx - 0.5, 4.9, zi, cx + 0.5, 4.9, zi, cx, 5.4, zi, dark[0], dark[1], dark[2], 0, 0, 1);
  }
  // Luminous crowd tiers: speckled emissive spectator flecks below the arches
  // plus one stacked tier above them; dark backing bands keep layered depth.
  buildCrowd(out);
  // Fog skirt: tall bands melting the wall base into the floor haze.
  const zf = Z + 0.045;
  const sk0 = [0.16, 0.30, 0.48];
  const sk1 = [0.10, 0.20, 0.34];
  triV(out,
    [X0, 0, zf, sk0[0], sk0[1], sk0[2]],
    [X1, 0, zf, sk0[0], sk0[1], sk0[2]],
    [X1, 3.2, zf, sk1[0], sk1[1], sk1[2]], FACE);
  triV(out,
    [X0, 0, zf, sk0[0], sk0[1], sk0[2]],
    [X1, 3.2, zf, sk1[0], sk1[1], sk1[2]],
    [X0, 3.2, zf, sk1[0], sk1[1], sk1[2]], FACE);
  // Bright base strip y 0.05..0.35.
  const bs = [0.40, 0.85, 0.95];
  const zs = Z + 0.05;
  tri(out, X0, 0.05, zs, X1, 0.05, zs, X1, 0.35, zs, bs[0], bs[1], bs[2], 0, 0, 1);
  tri(out, X0, 0.05, zs, X1, 0.35, zs, X0, 0.35, zs, bs[0], bs[1], bs[2], 0, 0, 1);
}
// Luminous crowd tiers (round 8): dark backing bands with speckled emissive
// spectator flecks in varied warm/cool tints; dark gaps between the tiers.
function buildCrowd(out) {
  const Z = -26;
  const X0 = -34, X1 = 34;
  const zb = Z + 0.056, zc = Z + 0.060, zbl = Z + 0.052;
  const dark = [0.02, 0.06, 0.13];
  // [row base y, spectator count]
  const tiers = [
    [0.45, 32], [1.35, 32], [2.25, 28], [6.50, 24],
  ];
  const tints = [
    [1.0, 1.0, 1.0], [0.75, 0.95, 1.0], [1.0, 0.90, 0.65], [0.60, 0.85, 1.0],
    [0.70, 1.0, 0.90], [1.0, 0.82, 0.60], [0.85, 0.92, 1.0], [0.95, 0.97, 0.80],
  ];
  for (const [yb, n] of tiers) {
    const bl = [0.40, 0.62, 0.90];
    tri(out, X0, yb - 0.22, zbl, X1, yb - 0.22, zbl, X1, yb + 1.08, zbl, bl[0], bl[1], bl[2], 0, 0, 1);
    tri(out, X0, yb - 0.22, zbl, X1, yb + 1.08, zbl, X0, yb + 1.08, zbl, bl[0], bl[1], bl[2], 0, 0, 1);
    triV(out,
      [X0, yb - 0.15, zb, dark[0], dark[1], dark[2]],
      [X1, yb - 0.15, zb, dark[0], dark[1], dark[2]],
      [X1, yb + 1.0, zb, dark[0], dark[1], dark[2]], FACE);
    triV(out,
      [X0, yb - 0.15, zb, dark[0], dark[1], dark[2]],
      [X1, yb + 1.0, zb, dark[0], dark[1], dark[2]],
      [X0, yb + 1.0, zb, dark[0], dark[1], dark[2]], FACE);
    for (let i = 0; i < n; i++) {
      // Deterministic scatter; ~1/4 slots stay dark silhouettes.
      const h = ((i * 2654435761 + n * 97 + (yb * 13 | 0)) >>> 0) % 100;
      if (h < 25) continue;
      const span = (X1 - X0) - 2;
      const cx = X0 + 1 + (span * ((i * 0.618034 + h * 0.01) % 1));
      const w = 0.30 + ((h * 7) % 10) * 0.035;
      const hh = 0.45 + ((h * 3) % 8) * 0.04;
      const t = tints[h % tints.length];
      const dim = 0.70 + (h % 8) * 0.045;
      const yj = yb + (h % 4) * 0.09;
      tri(out, cx - w, yj, zc, cx + w, yj, zc, cx + (h % 5 - 2) * 0.12, yj + hh, zc,
        t[0] * dim, t[1] * dim, t[2] * dim, 0, 0, 1);
    }
  }
}
// Broad floor POOL wash (round 9): soft bright ellipse connecting the rings
// to the wall base. Per-vertex falloff: bright core fading to floor color.
function buildPool(out) {
  const y = 0.019;
  const fan = (cx, cz, rx, rz, lift, SEG) => {
    const cc = floorCol(cx, cz);
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const b = ((i + 1) / SEG) * Math.PI * 2;
      const ax = cx + Math.cos(a) * rx, az = cz + Math.sin(a) * rz;
      const bx = cx + Math.cos(b) * rx, bz = cz + Math.sin(b) * rz;
      const ca = floorCol(ax, az), cb = floorCol(bx, bz);
      triV(out,
        [cx, y, cz, cc[0] + lift, cc[1] + lift, cc[2] + lift * 1.05],
        [ax, y, az, ca[0], ca[1], ca[2]],
        [bx, y, bz, cb[0], cb[1], cb[2]]);
    }
  };
  fan(0, -8, 13, 15, 0.25, 20);
  fan(0, -8, 6.5, 8, 0.25, 16);
}
// Wet-floor mirror reflections (round 11): bright near-white ellipse core at
// the feet smearing into a long fading streak TOWARD the camera — 3 nested
// bands per battler. The gloss cue the flat wash couldn't sell.
function buildReflection(out, cx, cz, s) {
  const core = [0.85, 1.0, 0.90];
  const b1 = [0.60, 0.95, 0.75];
  const b2 = [0.35, 0.70, 0.55];
  const fan = (fx, fz, rx, rz, y, c, SEG) => {
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const b = ((i + 1) / SEG) * Math.PI * 2;
      tri(out, fx, y, fz,
        fx + Math.cos(a) * rx, y, fz + Math.sin(a) * rz,
        fx + Math.cos(b) * rx, y, fz + Math.sin(b) * rz,
        c[0], c[1], c[2]);
    }
  };
  fan(cx, cz + 0.4 * s, 0.9 * s, 0.6 * s, 0.036, core, 12);
  fan(cx, cz + 1.2 * s, 1.1 * s, 1.6 * s, 0.034, b1, 14);
  fan(cx, cz + 2.6 * s, 1.3 * s, 2.6 * s, 0.032, b2, 14);
}
// Night-sky backdrop (round 7): deep gradient plane above the wall, scattered
// stars, and a pale moon with a faint halo. Wall/floor went dark; these plus
// the full-brightness emissives (halos, rings, streak, beam) carry the night.
function buildSky(out) {
  const Z = -28;
  const X0 = -42, X1 = 42;
  const hor = [0.12, 0.26, 0.46];
  const mid = [0.04, 0.10, 0.24];
  const zen = [0.01, 0.02, 0.08];
  triV(out,
    [X0, 8.1, Z, hor[0], hor[1], hor[2]],
    [X1, 8.1, Z, hor[0], hor[1], hor[2]],
    [X1, 13, Z, mid[0], mid[1], mid[2]]);
  triV(out,
    [X0, 8.1, Z, hor[0], hor[1], hor[2]],
    [X1, 13, Z, mid[0], mid[1], mid[2]],
    [X0, 13, Z, mid[0], mid[1], mid[2]]);
  triV(out,
    [X0, 13, Z, mid[0], mid[1], mid[2]],
    [X1, 13, Z, mid[0], mid[1], mid[2]],
    [X1, 22, Z, zen[0], zen[1], zen[2]]);
  triV(out,
    [X0, 13, Z, mid[0], mid[1], mid[2]],
    [X1, 22, Z, zen[0], zen[1], zen[2]],
    [X0, 22, Z, zen[0], zen[1], zen[2]]);
  // Stars: small bright flecks in the visible band above the wall.
  const zs = Z + 0.1;
  const stars = [
    [-14, 9, 0.28, 0.9], [-8, 11, 0.2, 0.7], [-3, 9.5, 0.24, 0.85],
    [3, 11.5, 0.18, 0.65], [8, 10, 0.26, 0.9], [-16, 11.5, 0.2, 0.7],
    [14, 9, 0.24, 0.8], [6, 12.3, 0.2, 0.7], [-11, 12.2, 0.22, 0.75], [11, 11.8, 0.24, 0.85],
  ];
  for (const [sx, sy, s, b] of stars) {
    tri(out, sx - s, sy - s * 0.6, zs, sx + s, sy - s * 0.6, zs, sx, sy + s * 0.8, zs,
      0.8 * b, 0.88 * b, 1.0 * b, 0, 0, 0);
  }
  // Moon: pale disc + faint halo, upper right where the frame still sees sky.
  const mx = 13.5, my = 10.8, mz = Z + 0.1;
  const mc = [0.82, 0.88, 0.94];
  const SEG = 10;
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const b2 = ((i + 1) / SEG) * Math.PI * 2;
    tri(out, mx, my, mz,
      mx + Math.cos(a) * 1.6, my + Math.sin(a) * 1.6, mz,
      mx + Math.cos(b2) * 1.6, my + Math.sin(b2) * 1.6, mz,
      mc[0], mc[1], mc[2], 0, 0, 0);
  }
  const mh = [0.22, 0.32, 0.48];
  const HS = 6;
  for (let i = 0; i < HS; i++) {
    const a = (i / HS) * Math.PI * 2;
    const b2 = ((i + 1) / HS) * Math.PI * 2;
    tri(out,
      mx + Math.cos(a) * 2.7, my + Math.sin(a) * 2.7, mz,
      mx + Math.cos(b2) * 2.7, my + Math.sin(b2) * 2.7, mz,
      mx + Math.cos(b2) * 1.9, my + Math.sin(b2) * 1.9, mz,
      mh[0], mh[1], mh[2], 0, 0, 0);
    tri(out,
      mx + Math.cos(a) * 2.7, my + Math.sin(a) * 2.7, mz,
      mx + Math.cos(b2) * 1.9, my + Math.sin(b2) * 1.9, mz,
      mx + Math.cos(a) * 1.9, my + Math.sin(a) * 1.9, mz,
      mh[0], mh[1], mh[2], 0, 0, 0);
  }
}

function buildArena() {
  const out = [];
  buildFloor(out);
  buildInlays(out);
  buildStreak(out);
  buildPool(out);
  buildSky(out);
  glowRing(out, FOE_SPOT[0], FOE_SPOT[2], 1.0);
  glowRing(out, ME_SPOT[0] - 1.15, ME_SPOT[2] - 1.1, 0.85);
  buildReflection(out, FOE_SPOT[0], FOE_SPOT[2], 1.0);
  buildReflection(out, ME_SPOT[0] - 1.15, ME_SPOT[2] - 1.1, 0.7);
  buildWall(out);
  return new Float32Array(out);
}

export function drawArena(ctx, viewProj, t) {
  ensureAtmo();
  if (!cache9) cache9 = buildArena();
  if (typeof GL.drawTrisN === "function") { GL.drawTrisN(ctx, cache9, viewProj); return; }
  if (!cache6) {
    const n9 = cache9.length / 9, flat = new Float32Array(n9 * 6);
    for (let v = 0; v < n9; v++) {
      for (let k = 0; k < 6; k++) flat[v * 6 + k] = cache9[v * 9 + k];
    }
    cache6 = flat;
  }
  GL.drawTris(ctx, cache6, viewProj);
}
