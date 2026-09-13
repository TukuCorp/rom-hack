// models.js: original high-detail battlers from raw triangles (11-float
// verts: pos + color + normal + uv) lit by the gl.js cel shader via
// drawTrisNT (textured + rim), with guarded drawTrisN (uv stripped,
// pixel-identical) and drawTris fallbacks so boot never breaks
// mid-migration.
// Foe Nibble (small blue rodent) on FOE_SPOT: deep forward-lunging crouch,
// barrel low over the haunches, rounded skull dropped forward-down on a neck
// pivot with a rigid lunge shift, forepaws splayed ahead, tail lashed high.
// Player Embercub (orange cub) on ME_SPOT: coiled spring crouch, weight sunk
// back over the haunches, head turned 3/4 back over the shoulder on a neck
// pivot with a rigid coil settle, tail carried high with a flickering flame.
// Surfacing: smooth analytic normals on every round mass (sphere gradient,
// taper-corrected tube walls), crisp face normals on planes (wedge snout,
// stripes, inner-ear blades); color zones pre-separated as raw vertex
// colors (belly / inner-ear / paw creams, stepped flank shades) for the
// cel shader to tone, multiplied by a subtle near-white procedural detail
// texture (fur micro-noise, belly/chest wash, stripe bands) so untextured
// hues survive intact. Texture alpha carries specular strength (fur 0.15,
// belly 0.10, gloss patch 0.90); eyes / nose / claws sample the gloss patch
// via remapped UVs, flame stays on the unlit path (never specular).
// Emissive bits (eye glints, flame) use zero-length normals so the shader's
// unlit path keeps them fullbright. Seams are buried under transition
// geometry (neck ruffs, haunch blends, ear-base collars, tail cuffs); no
// floating-ball joints. Outline parts (heads, ears, tails, haunches, jaws)
// build at ~2x segments via the HI density flag.
// UVs are spherical-planar per part (u around, v along); flat pieces use
// planar corner maps, discs a small centered circle. Idle bob (sin t) +
// breathing scale. White hit-flash via state.flashFoe / state.flashMe
// (0..1). Lunge 0..1 as z-offset toward opponent, sink 0..1 as y-offset,
// faint pose via state.fainted. Reads only; decay owned by battle.js
// scene(). Pair ~10k tris (budget 15k).
import { drawTris, mat4mul } from "./gl.js";

// drawTrisN / drawTrisNT / createTex / rim setter arrive via one-directional
// guarded dynamic import (gl.js never imports models) so a mid-write gl.js
// never breaks boot; until they land, the drawTris 6-float path below keeps
// every frame rendering.
let drawTrisN = null;
let drawTrisNT = null;
let createTex = null;
let setRim = null;
try {
  import("./gl.js")
    .then((m) => {
      if (m && typeof m.drawTrisN === "function") drawTrisN = m.drawTrisN;
      if (m && typeof m.drawTrisNT === "function") drawTrisNT = m.drawTrisNT;
      if (m && typeof m.createTex === "function") createTex = m.createTex;
      // Rim strength setter: accept whatever name the gl pass chose.
      if (m) {
        for (const k of ["setRim", "setRimStrength", "setUrim", "setRimAmount"]) {
          if (typeof m[k] === "function") { setRim = m[k].bind(m); break; }
        }
      }
    })
    .catch(() => {});
} catch {}

// Battler spots: arena.js FOE_SPOT/ME_SPOT are canonical. Guarded
// dynamic import (one-directional: arena never imports models) so a
// mid-write arena.js never breaks boot; defaults match arena values.
const SPOTS = { foe: [0, 0, -7], me: [0, 0, 2.5] };
import("./arena.js").then((m) => {
  if (m) {
    if (m.FOE_SPOT) SPOTS.foe = m.FOE_SPOT;
    if (m.ME_SPOT) SPOTS.me = m.ME_SPOT;
  }
}).catch(() => {});

// ---- column-major mat4 helpers (match gl.js convention) ----
function translation(x, y, z) {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}
function scaling(sx, sy, sz) {
  return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]);
}
function rotY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}
function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}
function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
function xform(M, x, y, z) {
  return [
    M[0] * x + M[4] * y + M[8] * z + M[12],
    M[1] * x + M[5] * y + M[9] * z + M[13],
    M[2] * x + M[6] * y + M[10] * z + M[14],
  ];
}
// Normal transform: upper-3x3 (rotation + near-uniform model scale and
// breathing) then normalize. Adequate: model scale is uniform, breathing
// within 3%.
function xformN(M, x, y, z) {
  const nx = M[0] * x + M[4] * y + M[8] * z;
  const ny = M[1] * x + M[5] * y + M[9] * z;
  const nz = M[2] * x + M[6] * y + M[10] * z;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  return [nx / l, ny / l, nz / l];
}
// Head sub-pose: yaw/pitch about a neck pivot (parts stay authored in
// body-local coords, so yaw/pitch 0 reproduces the unposed build).
function headMat(M, px, py, pz, yaw, pitch) {
  let H = mat4mul(M, translation(px, py, pz));
  if (yaw) H = mat4mul(H, rotY(yaw));
  if (pitch) H = mat4mul(H, rotX(pitch));
  H = mat4mul(H, translation(-px, -py, -pz));
  return H;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function flashCol(col, f) {
  if (!f) return col;
  const k = clamp01(f);
  return [col[0] + (1 - col[0]) * k, col[1] + (1 - col[1]) * k, col[2] + (1 - col[2]) * k];
}
const C = (col) => () => col;
const UNLIT = [0, 0, 0];
// Spec-gloss UV patch: corner rect of each 128px texture painted near-white
// with high alpha (0.9) so glossy parts (eyes, nose, claws) keep their vertex
// hue under base*texel while sampling the specular term the gl.js pass reads
// from texel.a. Fur elsewhere stays matte (0.15) / belly (0.1). Pass as the
// trailing UVP arg of ellipsoid/cone/discFan; default (absent) is identity.
const GLOSS = [0.80, 0.80, 0.97, 0.97];
function uvMap(t, box) {
  if (!box) return t;
  return [box[0] + (box[2] - box[0]) * t[0], box[1] + (box[3] - box[1]) * t[1]];
}

function norm3(x, y, z) {
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / l, y / l, z / l];
}

// Core emitter: one 11-float vertex (pos, color, normal, uv). uv defaults
// to texture-center so missed callers sample flat detail (pixel-identical
// hues under the near-white detail textures).
const UV0 = [0.5, 0.5];
function pushV(arr, M, p, n, col, uv) {
  const P = xform(M, p[0], p[1], p[2]);
  const N = n === UNLIT ? UNLIT : xformN(M, n[0], n[1], n[2]);
  const T = uv || UV0;
  arr.push(P[0], P[1], P[2], col[0], col[1], col[2], N[0], N[1], N[2], T[0], T[1]);
}

// Flat triangle: face normal from local-space winding (author CCW outward).
// Optional corner uvs (ua, ub, uc); default planar map keeps it simple.
function pushTriN(arr, M, a, b, c, col, n, uvs) {
  let N = n;
  if (!N) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    N = norm3(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  const T = uvs || [UV0, UV0, UV0];
  pushV(arr, M, a, N, col, T[0]);
  pushV(arr, M, b, N, col, T[1]);
  pushV(arr, M, c, N, col, T[2]);
}

// Crisp quad (two tris, single face normal): stripes, glints, ear blades.
// Corner-planar UVs (a=(0,0) b=(1,0) c=(1,1) d=(0,1)) unless overridden.
function pushQuad(arr, M, a, b, c, d, col, n, uvs) {
  const T = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
  pushTriN(arr, M, a, b, c, col, n, [T[0], T[1], T[2]]);
  pushTriN(arr, M, a, c, d, col, n, [T[0], T[2], T[3]]);
}
// Round glossy glint: flat radial fan with zero normals (shader fullbright
// path), tangent to the eyeball so the rim tucks into the ball and the
// round silhouette reads instead of a square pixel.
function glintDisc(arr, M, cx, cy, cz, r, nx, ny, nz, col, radial) {
  discFan(arr, M, cx, cy, cz, r, nx, ny, nz, col, radial, UNLIT);
}
// Lit color disc (flat analytic normal -> cel-toned): iris.
function irisDisc(arr, M, cx, cy, cz, r, nx, ny, nz, col, radial, UVP) {
  discFan(arr, M, cx, cy, cz, r, nx, ny, nz, col, radial, null, UVP);
}
// Shared disc fan: UVs map a small centered circle (radius 0.12 texels)
// so the disc samples near-flat detail and keeps its vertex hue.
function discFan(arr, M, cx, cy, cz, r, nx, ny, nz, col, radial, litN, UVP) {
  const n = norm3(nx, ny, nz);
  const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm3(up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]);
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const segs = radial || 8;
  const N = litN || n;
  const ring = [];
  const ringT = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    ring.push([cx + (u[0] * ca + w[0] * sa) * r,
      cy + (u[1] * ca + w[1] * sa) * r,
      cz + (u[2] * ca + w[2] * sa) * r]);
    ringT.push(uvMap([0.5 + ca * 0.12, 0.5 + sa * 0.12], UVP));
  }
  const ctrT = uvMap([0.5, 0.5], UVP);
  for (let i = 0; i < segs; i++) {
    pushV(arr, M, [cx, cy, cz], N, col, ctrT);
    pushV(arr, M, ring[i], N, col, ringT[i]);
    pushV(arr, M, ring[(i + 1) % segs], N, col, ringT[(i + 1) % segs]);
  }
}

// Crisp box centered (cx,cy,cz), size (sx,sy,sz): 12 tris, face normals.
function pushBox(arr, M, cx, cy, cz, sx, sy, sz, raw, F) {
  const col = flashCol(raw, F);
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [[0, 2, 1, 3], [0, 0, -1]], [[5, 6, 4, 7], [0, 0, 1]],
    [[4, 7, 0, 3], [-1, 0, 0]], [[1, 2, 5, 6], [1, 0, 0]],
    [[3, 6, 2, 7], [0, 1, 0]], [[4, 1, 5, 0], [0, -1, 0]],
  ];
  for (const [[a, b, c, d], n] of faces) {
    pushQuad(arr, M, v[a], v[b], v[c], v[d], col, n);
  }
}

// Smooth ellipsoid centered c, radii r: nLat x nLon x 2 tris, analytic
// normals (sphere gradient). colFn(u, v, theta, phi) -> raw rgb.
// SEG scales both axes (~2x tris) for the high-segment pass. UVs are
// spherical-planar (u around, v along).
const SEG = 1.45;
function ellipsoid(arr, M, cx, cy, cz, rx, ry, rz, nLat, nLon, colFn, F, range, DM, UVP) {
  const dm = DM || 1;
  nLat = Math.max(3, Math.round(nLat * SEG * dm));
  nLon = Math.max(3, Math.round(nLon * SEG * dm));
  const t0 = (range && range.t0) || 0, t1 = (range && range.t1) || Math.PI;
  const p0 = (range && range.p0) || 0, p1 = (range && range.p1) || Math.PI * 2;
  const grid = [];
  for (let j = 0; j <= nLat; j++) {
    const th = t0 + (t1 - t0) * (j / nLat);
    const st = Math.sin(th), ct = Math.cos(th);
    const row = [];
    for (let i = 0; i <= nLon; i++) {
      const ph = p0 + (p1 - p0) * (i / nLon);
      const sp = Math.sin(ph), cp = Math.cos(ph);
      const p = [cx + rx * st * cp, cy + ry * ct, cz + rz * st * sp];
      const n = norm3((st * cp) / rx, ct / ry, (st * sp) / rz);
      const col = flashCol(colFn(i / nLon, j / nLat, th, ph), F);
      row.push({ p, n, col, t: uvMap([i / nLon, j / nLat], UVP) });
    }
    grid.push(row);
  }
  for (let j = 0; j < nLat; j++) {
    for (let i = 0; i < nLon; i++) {
      const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
      pushV(arr, M, a.p, a.n, a.col, a.t);
      pushV(arr, M, d.p, d.n, d.col, d.t);
      pushV(arr, M, c.p, c.n, c.col, c.t);
      pushV(arr, M, a.p, a.n, a.col, a.t);
      pushV(arr, M, c.p, c.n, c.col, c.t);
      pushV(arr, M, b.p, b.n, b.col, b.t);
    }
  }
}

// Tapered tube p0(r0) -> p1(r1): radial x segs x 2 smooth side tris with
// taper-corrected wall normals, plus flat end caps. colFn(s, ringT).
function tube(arr, M, p0, p1, r0, r1, radial, segs, colFn, F, caps, DM) {
  radial = Math.max(3, Math.round(radial * (DM || 1)));
  segs = Math.max(1, Math.round(segs * (DM || 1)));
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const ax = [dx / len, dy / len, dz / len];
  const up = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = norm3(
    up[1] * ax[2] - up[2] * ax[1],
    up[2] * ax[0] - up[0] * ax[2],
    up[0] * ax[1] - up[1] * ax[0]
  );
  const w = norm3(
    ax[1] * u[2] - ax[2] * u[1],
    ax[2] * u[0] - ax[0] * u[2],
    ax[0] * u[1] - ax[1] * u[0]
  );
  const slope = (r1 - r0) / len;
  const rings = [];
  for (let j = 0; j <= segs; j++) {
    const s = j / segs;
    const cx = p0[0] + dx * s, cy = p0[1] + dy * s, cz = p0[2] + dz * s;
    const r = r0 + (r1 - r0) * s;
    const ring = [];
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const dir = [
        u[0] * Math.cos(a) + w[0] * Math.sin(a),
        u[1] * Math.cos(a) + w[1] * Math.sin(a),
        u[2] * Math.cos(a) + w[2] * Math.sin(a),
      ];
      const p = [cx + dir[0] * r, cy + dir[1] * r, cz + dir[2] * r];
      const n = norm3(dir[0] - ax[0] * slope, dir[1] - ax[1] * slope, dir[2] - ax[2] * slope);
      ring.push({ p, n, col: flashCol(colFn(s, i / radial), F), t: [i / radial, s] });
    }
    rings.push(ring);
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < radial; i++) {
      const a = rings[j][i], b = rings[j][i + 1], c = rings[j + 1][i + 1], d = rings[j + 1][i];
      pushV(arr, M, a.p, a.n, a.col, a.t);
      pushV(arr, M, b.p, b.n, b.col, b.t);
      pushV(arr, M, c.p, c.n, c.col, c.t);
      pushV(arr, M, a.p, a.n, a.col, a.t);
      pushV(arr, M, c.p, c.n, c.col, c.t);
      pushV(arr, M, d.p, d.n, d.col, d.t);
    }
  }
  if (caps === undefined || caps[0]) {
    const n0 = [-ax[0], -ax[1], -ax[2]];
    const c0 = flashCol(colFn(0, 0.5), F);
    const ctr = { p: p0.slice(), n: n0, col: c0, t: [0.5, 0] };
    for (let i = 0; i < radial; i++) {
      pushV(arr, M, ctr.p, ctr.n, ctr.col, ctr.t);
      pushV(arr, M, rings[0][i + 1].p, n0, rings[0][i + 1].col, rings[0][i + 1].t);
      pushV(arr, M, rings[0][i].p, n0, rings[0][i].col, rings[0][i].t);
    }
  }
  if (caps === undefined || caps[1]) {
    const n1 = ax.slice();
    const c1 = flashCol(colFn(1, 0.5), F);
    const ctr = { p: p1.slice(), n: n1, col: c1, t: [0.5, 1] };
    const last = rings[segs];
    for (let i = 0; i < radial; i++) {
      pushV(arr, M, ctr.p, ctr.n, ctr.col, ctr.t);
      pushV(arr, M, last[i].p, n1, last[i].col, last[i].t);
      pushV(arr, M, last[i + 1].p, n1, last[i + 1].col, last[i + 1].t);
    }
  }
}

// Smooth cone: base disc (flat cap normal -axis) + taper-corrected flank
function cone(arr, M, bx, by, bz, r, axx, axy, axz, radial, raw, F, rawApex, UVP) {
  const dx = axx - bx, dy = axy - by, dz = axz - bz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const ax = [dx / len, dy / len, dz / len];
  const up = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = norm3(
    up[1] * ax[2] - up[2] * ax[1],
    up[2] * ax[0] - up[0] * ax[2],
    up[0] * ax[1] - up[1] * ax[0]
  );
  const w = norm3(
    ax[1] * u[2] - ax[2] * u[1],
    ax[2] * u[0] - ax[0] * u[2],
    ax[0] * u[1] - ax[1] * u[0]
  );
  const slope = -r / len;
  const colB = flashCol(raw, F);
  const colA = flashCol(rawApex || raw, F);
  const ring = [];
  for (let i = 0; i <= radial; i++) {
    const a = (i / radial) * Math.PI * 2;
    const dir = [
      u[0] * Math.cos(a) + w[0] * Math.sin(a),
      u[1] * Math.cos(a) + w[1] * Math.sin(a),
      u[2] * Math.cos(a) + w[2] * Math.sin(a),
    ];
    ring.push({
      p: [bx + dir[0] * r, by + dir[1] * r, bz + dir[2] * r],
      n: norm3(dir[0] - ax[0] * slope, dir[1] - ax[1] * slope, dir[2] - ax[2] * slope),
      t: uvMap([i / radial, 0], UVP),
    });
  }
  const apex = [axx, axy, axz];
  const apexT = uvMap([0.5, 1], UVP);
  for (let i = 0; i < radial; i++) {
    pushV(arr, M, apex, ring[i].n, colA, apexT);
    pushV(arr, M, ring[i].p, ring[i].n, colB, ring[i].t);
    pushV(arr, M, ring[i + 1].p, ring[i + 1].n, colB, ring[i + 1].t);
  }
  const nb = [-ax[0], -ax[1], -ax[2]];
  const ctr = [bx, by, bz];
  const ctrT = uvMap([0.5, 0], UVP);
  for (let i = 0; i < radial; i++) {
    pushTriN(arr, M, ctr, ring[i + 1].p, ring[i].p, colB, nb, [ctrT, ring[i + 1].t, ring[i].t]);
  }
}

// ---- Nibble: lunging crouch, rounded skull pitched down-forward, tail kinked up ----
function buildNibble(arr, M, F, t, damp) {
  const time = typeof t === "number" ? t : 0;
  const dk = damp === undefined ? 1 : damp;
  const BLUE = [0.20, 0.50, 1.0];
  const FLANK = [0.16, 0.42, 0.88];   // stepped flank shade
  const DARK = [0.12, 0.28, 0.68];    // back / crevice shade
  const CREAM = [0.84, 0.90, 1.0];    // belly, muzzle, paws, inner ear
  const PINK = [0.98, 0.62, 0.70];    // cheeks, ear inners
  const INK = [0.07, 0.07, 0.11];
  const WHITE = [1, 1, 1];

  // Deep forward-lunging crouch: barrel dropped low over the haunches, chest
  // pitched forward; idle bob/breathe continue on top via the root matrix.
  const HI = 1.4; // outline-part density (~2x tris each)
  // Haunches + barrel chest (smooth analytic masses) with a squashed cream
  // belly shell embedded in the chest front (intersection reads as a zone edge).
  ellipsoid(arr, M, 0, 0.35, -0.16, 0.33, 0.27, 0.36, 8, 6, C(FLANK), F, undefined, HI);
  // MACRO MARKING: large dark back patch (partial shell over the rear
  // torso, hard-edged, reads at judgment scale).
  ellipsoid(arr, M, 0, 0.35, -0.16, 0.345, 0.285, 0.375, 2, 8, C(INK), F,
    { t0: 0.6, t1: 1.9, p0: 3 * Math.PI / 2 - 1.0, p1: 3 * Math.PI / 2 + 1.0 });
  ellipsoid(arr, M, 0, 0.47, 0.15, 0.29, 0.24, 0.24, 8, 6, C(BLUE), F);
  // Chest armor: two overlapping plate shells over the chest front.
  ellipsoid(arr, M, 0, 0.47, 0.15, 0.302, 0.252, 0.252, 1, 6, C(DARK), F,
    { t0: 0.9, t1: 1.3, p0: Math.PI / 2 - 1.1, p1: Math.PI / 2 + 1.1 });
  ellipsoid(arr, M, 0, 0.47, 0.15, 0.302, 0.252, 0.252, 1, 6, C(DARK), F,
    { t0: 1.3, t1: 1.7, p0: Math.PI / 2 - 1.1, p1: Math.PI / 2 + 1.1 });
  ellipsoid(arr, M, 0, 0.32, 0.26, 0.20, 0.18, 0.16, 6, 4, C(CREAM), F);
  // Neck: short tapered tube into the head pivot, swallowed by a layered
  // ruff (dark collar ring + blue mane shell) so no ball joint shows.
  tube(arr, M, [0, 0.47, 0.23], [0, 0.62, 0.30], 0.20, 0.24, 8, 1, C(DARK), F, [false, false]);
  tube(arr, M, [0, 0.52, 0.20], [0, 0.60, 0.29], 0.245, 0.27, 8, 1, C(DARK), F, [false, false]);
  ellipsoid(arr, M, 0, 0.56, 0.24, 0.27, 0.15, 0.22, 7, 5, C(BLUE), F);

  // Jointed legs folded into the crouch: thighs low and wide, shins short,
  // feet planted flat (y untouched). Haunch-blend shells melt thigh into
  // torso so the leg reads grown, not socketed.
  for (const s of [-1, 1]) {
    ellipsoid(arr, M, s * 0.22, 0.20, -0.10, 0.13, 0.17, 0.18, 6, 5, C(BLUE), F, undefined, HI);
    ellipsoid(arr, M, s * 0.16, 0.28, -0.16, 0.15, 0.17, 0.22, 5, 4, C(FLANK), F);
    // Calf muscle curve bulging behind the thigh.
    ellipsoid(arr, M, s * 0.22, 0.26, -0.26, 0.10, 0.13, 0.10, 4, 3, C(BLUE), F);
    tube(arr, M, [s * 0.22, 0.14, -0.02], [s * 0.23, 0.10, 0.10], 0.085, 0.10, 7, 1, C(DARK), F, [false, false]);
    ellipsoid(arr, M, s * 0.23, 0.07, 0.16, 0.11, 0.07, 0.20, 6, 4, C(DARK), F);
    ellipsoid(arr, M, s * 0.23, 0.055, 0.32, 0.10, 0.05, 0.06, 5, 4, C(CREAM), F);
    // Knuckle bumps bridging foot and toes.
    ellipsoid(arr, M, s * 0.18, 0.12, 0.28, 0.045, 0.04, 0.05, 3, 3, C(BLUE), F);
    ellipsoid(arr, M, s * 0.28, 0.12, 0.28, 0.045, 0.04, 0.05, 3, 3, C(BLUE), F);
    // White toe claws ahead of the toe caps (gloss UVs -> spec highlights).
    cone(arr, M, s * 0.18, 0.055, 0.36, 0.045, s * 0.18, 0.04, 0.54, 4, WHITE, F, undefined, GLOSS);
    cone(arr, M, s * 0.28, 0.055, 0.36, 0.045, s * 0.28, 0.04, 0.54, 4, WHITE, F, undefined, GLOSS);
  }
  // Jointed arms lunging forward: tapered upper + cream forearm + paw ball,
  // digits splayed ahead of the chest, mid-pounce even frozen.
  for (const s of [-1, 1]) {
    tube(arr, M, [s * 0.30, 0.54, 0.28], [s * 0.32, 0.36, 0.42], 0.07, 0.055, 7, 1, C(BLUE), F, [false, false]);
    tube(arr, M, [s * 0.32, 0.36, 0.42], [s * 0.32, 0.22, 0.50], 0.06, 0.035, 6, 1, C(CREAM), F, [false, true]);
    ellipsoid(arr, M, s * 0.32, 0.19, 0.51, 0.055, 0.05, 0.06, 5, 4, C(CREAM), F);
    // Three-finger hand with a claw cone on each digit.
    for (const dx of [-0.04, 0, 0.04]) {
      tube(arr, M, [s * 0.32 + dx, 0.17, 0.55], [s * 0.32 + dx * 1.5, 0.12, 0.63], 0.025, 0.02, 4, 1, C(CREAM), F, [false, false]);
      cone(arr, M, s * 0.32 + dx * 1.5, 0.12, 0.63, 0.012, s * 0.32 + dx * 1.5, 0.09, 0.68, 4, WHITE, F, undefined, GLOSS);
    }
    cone(arr, M, s * 0.33, 0.58, 0.28, 0.06, s * 0.38, 0.78, 0.28, 8, BLUE, F);
  }
  // Tail lashed high behind: curved stack of tapering tubes + dark tuft
  // cone on a base pivot, cuffed at the root so the joint never gaps.
  const T = headMat(M, 0, 0.55, -0.40, dk * 0.3 * Math.sin(time * 1.9 + 0.5), dk * 0.12 * Math.sin(time * 2.6 + 1.2));
  tube(arr, T, [0, 0.53, -0.38], [0, 0.56, -0.50], 0.115, 0.10, 8, 1, C(DARK), F, [false, false]);
  tube(arr, T, [0, 0.55, -0.42], [0, 0.68, -0.72], 0.085, 0.07, 7, 1, C(BLUE), F, undefined, HI);
  tube(arr, T, [0, 0.68, -0.72], [0, 0.95, -0.72], 0.07, 0.06, 7, 1, C(FLANK), F, undefined, HI);
  cone(arr, T, 0, 0.95, -0.72, 0.06, 0, 1.24, -0.66, 9, DARK, F);
  // MACRO MARKING: dark tail bands (short fat collars ringing the tail).
  tube(arr, T, [0, 0.593, -0.54], [0, 0.627, -0.64], 0.095, 0.095, 7, 1, C(DARK), F, [false, false]);
  tube(arr, T, [0, 0.76, -0.722], [0, 0.86, -0.722], 0.08, 0.08, 7, 1, C(DARK), F, [false, false]);

  // Head low and forward on the neck pivot (deep lunge snarl): stronger base
  // pitch plus a rigid head-local drop/push so the skull leads the chest even
  // frozen; slow glance yaw and bob nod continue on top.
  let H = headMat(M, 0, 0.62, 0.27, dk * 0.14 * Math.sin(time * 0.55 + 1.0), 0.44 + dk * 0.05 * Math.sin(time * 1.7));
  H = mat4mul(H, translation(0, -0.06, 0.10));
  // Rounded skull + tapered muzzle + nose ball.
  ellipsoid(arr, H, 0, 1.02, 0.36, 0.32, 0.26, 0.28, 12, 9, C(BLUE), F, undefined, HI);
  // MACRO MARKING: dark head-mask band across the eyes (partial shell over
  // the skull front, hard-edged; white sclerae pop against it).
  ellipsoid(arr, H, 0, 1.02, 0.36, 0.335, 0.275, 0.295, 2, 8, C(INK), F,
    { t0: 1.05, t1: 1.55, p0: Math.PI / 2 - 0.9, p1: Math.PI / 2 + 0.9 });
  tube(arr, H, [0, 0.94, 0.50], [0, 0.90, 0.70], 0.15, 0.10, 10, 1, C(CREAM), F, [false, false], HI);
  // Tiny upper fangs hanging off the snout front (camera-facing white).
  for (const s of [-1, 1]) {
    cone(arr, H, s * 0.10, 0.84, 0.70, 0.06, s * 0.10, 0.60, 0.71, 6, WHITE, F);
  }
  // Upper tooth row lining the snout (bone white).
  for (const dx of [-0.06, 0, 0.06]) {
    cone(arr, H, dx, 0.86, 0.70, 0.02, dx, 0.79, 0.70, 4, WHITE, F);
  }
  // Thick dark mouth interior so the white fangs pop by contrast.
  ellipsoid(arr, H, 0, 0.79, 0.66, 0.13, 0.05, 0.07, 6, 4, C(INK), F);
  // Articulated lower jaw: hinged bar + lower tooth row + tongue, idly
  // working open/closed on the jaw pivot.
  const J = headMat(H, 0, 0.80, 0.55, 0, 0.10 + dk * 0.08 * Math.sin(time * 0.9 + 0.3));
  tube(arr, J, [0, 0.80, 0.52], [0, 0.74, 0.70], 0.07, 0.05, 6, 1, C(CREAM), F, [false, false], HI);
  for (const dx of [-0.06, 0, 0.06]) {
    cone(arr, J, dx, 0.72, 0.66, 0.02, dx, 0.79, 0.66, 4, WHITE, F);
  }
  ellipsoid(arr, J, 0, 0.75, 0.60, 0.05, 0.025, 0.07, 4, 3, C(PINK), F);
  ellipsoid(arr, H, 0, 0.97, 0.71, 0.055, 0.045, 0.04, 7, 5, C(INK), F, undefined, undefined, GLOSS);
  // Jaw shading under the muzzle.
  ellipsoid(arr, H, 0, 0.83, 0.58, 0.11, 0.06, 0.09, 5, 4, C(CREAM), F);
  // ORAS eyes: white sclera spheres + deep-blue iris discs + large glints.
  for (const s of [-1, 1]) {
    const IRIS = [0.12, 0.25, 0.85];
    ellipsoid(arr, H, s * 0.17, 1.09, 0.585, 0.10, 0.11, 0.075, 7, 5, C(WHITE), F, undefined, undefined, GLOSS);
    irisDisc(arr, H, s * 0.206, 1.124, 0.657, 0.055, s * 0.28, 0.22, 0.94,
      flashCol(IRIS, F), 8, GLOSS);
    glintDisc(arr, H, s * 0.221, 1.144, 0.662, 0.032, s * 0.28, 0.22, 0.94,
      flashCol(WHITE, F), 8);
  }
  // Brow ridges.
  for (const s of [-1, 1]) {
    tube(arr, H, [s * 0.10, 1.21, 0.55], [s * 0.26, 1.20, 0.52], 0.045, 0.04, 5, 1, C(DARK), F);
  }
  // Brow armor plates: crisp slabs capping the brow ridges.
  pushBox(arr, H, -0.18, 1.28, 0.57, 0.20, 0.06, 0.14, DARK, F);
  pushBox(arr, H, 0.18, 1.28, 0.57, 0.20, 0.06, 0.14, DARK, F);
  // Cheek tufts: small swept cones + pink cheek balls.
  for (const s of [-1, 1]) {
    cone(arr, H, s * 0.30, 0.95, 0.44, 0.07, s * 0.42, 0.98, 0.34, 8, BLUE, F);
    ellipsoid(arr, H, s * 0.315, 0.95, 0.52, 0.035, 0.06, 0.09, 5, 3, C(PINK), F);
  }
  // Tall ears: tapered outer tubes with rounded dark tips, pink inner
  // blades front and back.
  for (const s of [-1, 1]) {
    tube(arr, H, [s * 0.20, 1.22, 0.30], [s * 0.215, 1.36, 0.295], 0.115, 0.10, 8, 1, C(BLUE), F, [false, false]);
    tube(arr, H, [s * 0.20, 1.24, 0.30], [s * 0.26, 1.62, 0.27], 0.095, 0.055, 7, 1, C(BLUE), F, undefined, HI);
    pushQuad(arr, H,
      [s * 0.20 - 0.072, 1.22, 0.375], [s * 0.20 + 0.072, 1.22, 0.375],
      [s * 0.245 + 0.05, 1.60, 0.345], [s * 0.245 - 0.05, 1.60, 0.345],
      flashCol(PINK, F), [0, 0, 1]);
    pushQuad(arr, H,
      [s * 0.20 + 0.072, 1.22, 0.225], [s * 0.20 - 0.072, 1.22, 0.225],
      [s * 0.245 - 0.05, 1.60, 0.255], [s * 0.245 + 0.05, 1.60, 0.255],
      flashCol(PINK, F), [0, 0, -1]);
  }
}

// ---- Embercub: battle crouch, domed head turned 3/4 over the shoulder ----
function buildEmbercub(arr, M, F, t, damp) {
  const time = typeof t === "number" ? t : 0;
  const dk = damp === undefined ? 1 : damp;
  const ORANGE = [1.0, 0.52, 0.13];
  const FLANK = [0.88, 0.44, 0.12];   // stepped flank shade
  const DARK = [0.62, 0.30, 0.10];    // back / crevice shade
  const CREAM = [1.0, 0.90, 0.68];    // chest, muzzle, paws, ear inners
  const INK = [0.10, 0.07, 0.06];
  const FLAME = [1.0, 0.62, 0.08];
  const CORE = [1.0, 0.95, 0.60];
  const WHITE = [1, 1, 1];

  // Coiled spring crouch: weight sunk back over the haunches, torso base
  // shifted rearward, shoulder hump loaded low; idle motion rides on top.
  const HI = 1.4; // outline-part density (~2x tris each)
  // Tapered torso leaning forward + shoulder hump + cream chest shell.
  tube(arr, M, [0, 0.24, -0.20], [0, 1.02, 0.0], 0.50, 0.33, 10, 2, C(ORANGE), F, undefined, HI);
  // MACRO MARKINGS: bold torso rings (floating bands around the torso tube,
  // read as big flank stripes from behind/side).
  tube(arr, M, [0, 0.42, -0.154], [0, 0.52, -0.134], 0.463, 0.443, 10, 1, C(DARK), F, [false, false]);
  tube(arr, M, [0, 0.63, -0.103], [0, 0.73, -0.083], 0.421, 0.40, 10, 1, C(DARK), F, [false, false]);
  ellipsoid(arr, M, 0, 1.08, -0.08, 0.34, 0.16, 0.36, 8, 6, C(ORANGE), F, undefined, HI);
  // Dorsal armor: three overlapping plate shells banding the shoulder hump.
  ellipsoid(arr, M, 0, 1.08, -0.08, 0.352, 0.172, 0.372, 1, 8, C(DARK), F,
    { t0: 0.4, t1: 0.8, p0: 0, p1: Math.PI * 2 });
  ellipsoid(arr, M, 0, 1.08, -0.08, 0.352, 0.172, 0.372, 1, 8, C([0.50, 0.34, 0.22]), F,
    { t0: 0.8, t1: 1.2, p0: 0, p1: Math.PI * 2 });
  ellipsoid(arr, M, 0, 1.08, -0.08, 0.352, 0.172, 0.372, 1, 8, C(DARK), F,
    { t0: 1.2, t1: 1.6, p0: 0, p1: Math.PI * 2 });
  ellipsoid(arr, M, 0, 0.52, 0.28, 0.26, 0.28, 0.20, 8, 5, C(CREAM), F);
  // Back ridge spikes (crisp silhouette from behind).
  cone(arr, M, 0, 1.18, 0.08, 0.07, 0, 1.42, 0.0, 7, DARK, F);
  cone(arr, M, 0, 1.16, -0.22, 0.07, 0, 1.40, -0.30, 7, DARK, F);
  cone(arr, M, 0, 1.10, -0.50, 0.07, 0, 1.32, -0.58, 7, DARK, F);
  cone(arr, M, -0.20, 1.18, -0.17, 0.08, -0.24, 1.50, -0.30, 7, ORANGE, F);
  cone(arr, M, 0.20, 1.18, -0.17, 0.08, 0.24, 1.50, -0.30, 7, ORANGE, F);
  // Neck collar into the head pivot, buried in a layered mane ruff (orange
  // shell + cream bib) so the head never balls on a stick.
  tube(arr, M, [0, 1.02, 0.0], [0, 1.20, 0.08], 0.30, 0.31, 8, 1, C(DARK), F, [false, false]);
  ellipsoid(arr, M, 0, 1.10, 0.0, 0.37, 0.17, 0.33, 8, 6, C(ORANGE), F);
  ellipsoid(arr, M, 0, 1.0, 0.22, 0.24, 0.18, 0.16, 7, 5, C(CREAM), F);
  // Deep neck groove ringing the throat under the skull: separates skull
  // mass from torso at a glance.
  tube(arr, M, [0, 1.18, 0.06], [0, 1.28, 0.10], 0.32, 0.30, 10, 1, C(DARK), F, [false, false]);

  // Segmented rear legs loaded under the coil: paws planted flat
  // (y untouched), haunches dropped, blend shells melting leg into torso.
  for (const s of [-1, 1]) {
    ellipsoid(arr, M, s * 0.30, 0.09, 0.10, 0.15, 0.09, 0.30, 7, 5, C(DARK), F);
    // Rear toe digits bridging paw and claws.
    for (const dx of [-0.07, 0, 0.07]) {
      ellipsoid(arr, M, s * 0.30 + dx, 0.07, 0.38, 0.045, 0.04, 0.07, 3, 3, C(DARK), F);
    }
    // White toe claws ahead of the rear paw (gloss UVs -> spec highlights).
    cone(arr, M, s * 0.24, 0.08, 0.38, 0.05, s * 0.24, 0.05, 0.63, 4, WHITE, F, undefined, GLOSS);
    cone(arr, M, s * 0.36, 0.08, 0.38, 0.05, s * 0.36, 0.05, 0.63, 4, WHITE, F, undefined, GLOSS);
    ellipsoid(arr, M, s * 0.50, 0.33, -0.27, 0.14, 0.28, 0.31, 8, 5, C(ORANGE), F, undefined, HI);
    ellipsoid(arr, M, s * 0.44, 0.28, -0.12, 0.17, 0.22, 0.26, 6, 4, C(ORANGE), F);
    // Glute muscle curve capping the haunch rear-top.
    ellipsoid(arr, M, s * 0.50, 0.51, -0.34, 0.14, 0.15, 0.16, 4, 3, C(ORANGE), F);
    tube(arr, M, [s * 0.44, 0.26, -0.08], [s * 0.40, 0.14, 0.02], 0.11, 0.10, 6, 1, C(FLANK), F, [false, false]);
    // Quad muscle mass bulging forward of the haunch.
    ellipsoid(arr, M, s * 0.42, 0.26, 0.12, 0.12, 0.18, 0.14, 4, 3, C(ORANGE), F);
  }
  // Segmented front legs braced: tapered upper + fore + cream paw balls.
  for (const s of [-1, 1]) {
    tube(arr, M, [s * 0.30, 0.58, 0.42], [s * 0.30, 0.30, 0.52], 0.115, 0.095, 7, 2, C(ORANGE), F, undefined, HI);
    // Deltoid muscle curve capping the front upper leg.
    ellipsoid(arr, M, s * 0.30, 0.54, 0.42, 0.13, 0.15, 0.13, 4, 3, C(ORANGE), F);
    tube(arr, M, [s * 0.30, 0.30, 0.52], [s * 0.30, 0.14, 0.56], 0.095, 0.10, 6, 1, C(FLANK), F, [false, true]);
    ellipsoid(arr, M, s * 0.33, 0.08, 0.60, 0.14, 0.09, 0.20, 6, 4, C(CREAM), F);
    // White foreclaw fan ahead of the forepaw.
    for (const dx of [-0.07, 0, 0.07]) {
      cone(arr, M, s * 0.33 + dx, 0.08, 0.74, 0.045, s * 0.33 + dx, 0.04, 0.96, 4, WHITE, F, undefined, GLOSS);
    }
  }

  // Head coiled 3/4 back over the shoulder: deeper base yaw plus a rigid
  // head-local sink/settle so the gaze loads behind the guard, ready to
  // spring; glance yaw and nod continue on top.
  let H = headMat(M, 0, 1.22, 0.08, -0.62 + dk * 0.16 * Math.sin(time * 0.45 + 2.0), dk * 0.04 * Math.sin(time * 1.3 + 0.5));
  H = mat4mul(H, translation(0, -0.05, -0.08));
  // Domed skull + crisp wedge snout + cream muzzle planes + nose.
  ellipsoid(arr, H, 0, 1.50, 0.24, 0.37, 0.32, 0.33, 12, 9, C(ORANGE), F, undefined, HI);
  // MACRO MARKING: cream head blaze (partial shell up the forehead front).
  ellipsoid(arr, H, 0, 1.50, 0.24, 0.382, 0.332, 0.342, 3, 5, C(CREAM), F,
    { t0: 0.35, t1: 1.5, p0: Math.PI / 2 - 0.4, p1: Math.PI / 2 + 0.4 });
  tube(arr, H, [0, 1.40, 0.40], [0, 1.36, 0.66], 0.20, 0.13, 10, 1, C(ORANGE), F, [false, false], HI);
  ellipsoid(arr, H, 0, 1.33, 0.64, 0.14, 0.10, 0.10, 8, 6, C(CREAM), F);
  ellipsoid(arr, H, 0, 1.27, 0.60, 0.10, 0.045, 0.075, 6, 4, C(CREAM), F);
  cone(arr, H, 0, 1.42, 0.70, 0.055, 0, 1.42, 0.80, 6, INK, F, undefined, GLOSS);
  // Cheek ruff: swept cones flaring sideways off the cheeks.
  for (const s of [-1, 1]) {
    cone(arr, H, s * 0.34, 1.36, 0.28, 0.09, s * 0.58, 1.40, 0.12, 8, ORANGE, F);
    cone(arr, H, s * 0.34, 1.30, 0.28, 0.07, s * 0.54, 1.28, 0.16, 7, CREAM, F);
  }
  // ORAS eyes: white sclera spheres + amber iris discs + large glints.
  for (const s of [-1, 1]) {
    const IRIS = [0.95, 0.55, 0.12];
    ellipsoid(arr, H, s * 0.33, 1.56, 0.36, 0.06, 0.11, 0.12, 7, 5, C(WHITE), F, undefined, undefined, GLOSS);
    irisDisc(arr, H, s * 0.379, 1.589, 0.430, 0.05, s * 0.93, 0.16, 0.32,
      flashCol(IRIS, F), 8, GLOSS);
    glintDisc(arr, H, s * 0.390, 1.606, 0.433, 0.028, s * 0.93, 0.16, 0.32,
      flashCol(WHITE, F), 8);
    tube(arr, H, [s * 0.14, 1.70, 0.38], [s * 0.30, 1.69, 0.36], 0.05, 0.045, 5, 1, C(DARK), F);
  }
  // Ears swept slightly back: tapered outer tubes + rounded tips + cream
  // inner blades front and back.
  for (const s of [-1, 1]) {
    tube(arr, H, [s * 0.25, 1.72, 0.10], [s * 0.265, 1.88, 0.06], 0.13, 0.115, 8, 1, C(ORANGE), F, [false, false]);
    tube(arr, H, [s * 0.25, 1.74, 0.10], [s * 0.30, 2.24, -0.02], 0.11, 0.05, 7, 1, C(ORANGE), F, undefined, HI);
    // Groove collar ringing the ear base: separates ear from skull mass.
    tube(arr, H, [s * 0.25, 1.68, 0.10], [s * 0.26, 1.80, 0.07], 0.125, 0.115, 7, 1, C(DARK), F, [false, false]);
    // Ear edge ridge tracing the rear rim.
    tube(arr, H, [s * 0.22, 1.70, 0.02], [s * 0.29, 2.22, -0.06], 0.03, 0.02, 4, 1, C(DARK), F, [false, false]);
    pushQuad(arr, H,
      [s * 0.25 - 0.08, 1.76, 0.20], [s * 0.25 + 0.08, 1.76, 0.20],
      [s * 0.285 + 0.05, 2.18, 0.10], [s * 0.285 - 0.05, 2.18, 0.10],
      flashCol(CREAM, F), [0, 0, 1]);
    pushQuad(arr, H,
      [s * 0.25 + 0.08, 1.76, 0.02], [s * 0.25 - 0.08, 1.76, 0.02],
      [s * 0.285 - 0.05, 2.18, -0.06], [s * 0.285 + 0.05, 2.18, -0.06],
      flashCol(CREAM, F), [0, 0, -1]);
  }

  // Tail carried high with a bend, lashed on a base pivot, cuffed at the
  // root; flame flicker independent so fire and tail move on different
  // periods. Flame cones are UNLIT (emissive fullbright, never specular).
  const T = headMat(M, 0.28, 0.55, -0.70, dk * 0.22 * Math.sin(time * 1.6 + 2.0), 0);
  tube(arr, T, [0.28, 0.55, -0.70], [0.30, 0.66, -0.695], 0.125, 0.115, 8, 1, C(DARK), F, [false, false]);
  tube(arr, T, [0.28, 0.55, -0.70], [0.34, 0.92, -0.66], 0.10, 0.085, 7, 1, C(ORANGE), F, [false, false], HI);
  tube(arr, T, [0.34, 0.92, -0.66], [0.38, 1.22, -0.60], 0.085, 0.07, 6, 1, C(FLANK), F, undefined, HI);
  // Segmented tail bands: dark collars ringing both tail segments.
  tube(arr, T, [0.30, 0.64, -0.69], [0.325, 0.78, -0.675], 0.108, 0.10, 7, 1, C(DARK), F, [false, false]);
  tube(arr, T, [0.355, 1.0, -0.635], [0.365, 1.13, -0.615], 0.093, 0.093, 7, 1, C(DARK), F, [false, false]);
  const fl = 1 + 0.22 * Math.sin(time * 11) + 0.10 * Math.sin(time * 23 + 1);
  const fh = 0.93 * fl;
  const fr = 0.255 * (1 + 0.10 * Math.sin(time * 17 + 0.7));
  coneUnlit(arr, T, 0.38, 1.24, -0.60, fr, 0.38, 1.24 + fh, -0.60, 10, flashCol(FLAME, F));
  coneUnlit(arr, T, 0.38, 1.24, -0.60, fr * 0.5, 0.38, 1.24 + fh * 0.6, -0.58, 8, flashCol(CORE, F));

  // Back stripes: thin crisp slabs over the rear torso.
  pushBox(arr, M, -0.15, 0.94, -0.42, 0.10, 0.06, 0.45, DARK, F);
  pushBox(arr, M, 0.15, 0.94, -0.42, 0.10, 0.06, 0.45, DARK, F);
  pushBox(arr, M, 0, 0.78, -0.54, 0.34, 0.06, 0.30, DARK, F);
}

// Unlit cone (zero normals -> shader's raw-color path): flame, sparks.
function coneUnlit(arr, M, bx, by, bz, r, axx, axy, axz, radial, col) {
  const dx = axx - bx, dy = axy - by, dz = axz - bz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const ax = [dx / len, dy / len, dz / len];
  const up = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm3(
    up[1] * ax[2] - up[2] * ax[1],
    up[2] * ax[0] - up[0] * ax[2],
    up[0] * ax[1] - up[1] * ax[0]
  );
  const w = norm3(
    ax[1] * u[2] - ax[2] * u[1],
    ax[2] * u[0] - ax[0] * u[2],
    ax[0] * u[1] - ax[1] * u[0]
  );
  const ring = [];
  const ringT = [];
  for (let i = 0; i <= radial; i++) {
    const a = (i / radial) * Math.PI * 2;
    ring.push([
      bx + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * r,
      by + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * r,
      bz + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * r,
    ]);
    // Flame samples the texture's bright core wash (near-white) so the
    // emissive orange keeps full saturation under base*texel.
    ringT.push([0.44 + 0.06 * Math.cos(a), 0.06 + 0.03 * Math.sin(a)]);
  }
  const apex = [axx, axy, axz];
  const apexT = [0.5, 0.02];
  for (let i = 0; i < radial; i++) {
    pushV(arr, M, apex, UNLIT, col, apexT);
    pushV(arr, M, ring[i], UNLIT, col, ringT[i]);
    pushV(arr, M, ring[i + 1], UNLIT, col, ringT[i + 1]);
  }
}

// ---- Procedural detail textures (original art, painted at boot) ----
// Two 128px canvas textures, near-white detail modulators so the vertex
// color zones survive base*texel intact while fur micro-noise, belly/chest
// washes, stripe bands, and ear-inner tints read on the surface. Symmetric
// top/bottom washes so the look holds regardless of texture Y-flip. Created
// lazily on first draw (GL context must exist) via GL.createTex when the
// gl.js pass provides it; absent -> the untextured path below, boot safe.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function speckle(g, rand, w, h, n, cols) {
  for (let k = 0; k < n; k++) {
    const x = (rand() * w) | 0, y = (rand() * h) | 0;
    g.fillStyle = cols[(rand() * cols.length) | 0];
    g.fillRect(x, y, 1, 1);
  }
}
function furStreaks(g, rand, w, h, n, style) {
  g.strokeStyle = style;
  g.lineWidth = 1;
  for (let k = 0; k < n; k++) {
    const x = rand() * w, y = rand() * h, l = 2 + rand() * 5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 1.5, y + l);
    g.stroke();
  }
}
function brightEdges(g, w, h, top, light) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, top);
  grad.addColorStop(0.10, light);
  grad.addColorStop(0.5, light);
  grad.addColorStop(0.90, light);
  grad.addColorStop(1, top);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}
// Specular alpha: the gl.js pass reads texel.a as the Blinn-Phong strength,
// so the painters bake material gloss into alpha (RGB stays near-white so
// base*texel hues survive): fur matte 0.15, belly/chest wash 0.10, gloss
// patch 0.90. Glossy geometry (eyes, nose, claws) carries UVs remapped into
// the GLOSS corner rect; the current shader ignores alpha (opaque output),
// so this is inert until the lighting pass lands — boot-safe either way.
function glossPatch(g) {
  g.fillStyle = "#ffffff";
  g.fillRect(102, 102, 22, 22);
}
function bakeSpecAlpha(g, w, h) {
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    const edge = (y < h * 0.12 || y >= h * 0.88);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let a = 38; // fur matte 0.15
      if (edge) a = 26; // belly/chest wash 0.10
      if (x >= 102 && x < 124 && y >= 102 && y < 124) a = 230; // gloss 0.90
      d[i + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
}
function paintNibble(g, w, h) {
  const rand = mulberry32(0xB1B1E);
  g.fillStyle = "#e6efff";
  g.fillRect(0, 0, w, h);
  // Cream belly wash toward both v extremes, light blue depth mid-body.
  brightEdges(g, w, h, "rgba(255,253,246,0.85)", "rgba(168,192,250,0.7)");
  // Fur micro-noise: darker blue specks + white flecks (high contrast).
  speckle(g, rand, w, h, 3600, ["rgba(95,125,215,0.95)", "rgba(255,255,255,0.95)", "rgba(75,105,205,0.8)"]);
  // Short vertical fur streaks.
  furStreaks(g, rand, w, h, 520, "rgba(105,135,220,0.7)");
  // Ear-inner pink dusting in one patch (ear quads sweep past it).
  g.fillStyle = "rgba(255,170,185,0.58)";
  g.fillRect(w * 0.70, h * 0.30, w * 0.22, h * 0.22);
  glossPatch(g);
  bakeSpecAlpha(g, w, h);
}
function paintEmbercub(g, w, h) {
  const rand = mulberry32(0xE8BE5);
  g.fillStyle = "#fff3e4";
  g.fillRect(0, 0, w, h);
  // Cream chest wash toward both v extremes.
  brightEdges(g, w, h, "rgba(255,250,238,0.9)", "rgba(255,230,198,0.5)");
  // Dark stripe bands, mirrored top/bottom so Y-flip cannot break them.
  g.fillStyle = "rgba(180,115,50,0.6)";
  for (const y0 of [h * 0.235, h * 0.47, h * 0.705]) {
    g.fillRect(0, y0, w, h * 0.06);
  }
  // MACRO MARKING: bold back badge (diamond outline on the back band,
  // vertically symmetric so Y-flip cannot break it).
  g.strokeStyle = "rgba(120,66,26,0.85)";
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(w * 0.75, h * 0.30);
  g.lineTo(w * 0.90, h * 0.50);
  g.lineTo(w * 0.75, h * 0.70);
  g.lineTo(w * 0.60, h * 0.50);
  g.closePath();
  g.stroke();
  // Fur micro-noise: burnt-orange specks + cream flecks (high contrast).
  speckle(g, rand, w, h, 3600, ["rgba(230,160,80,0.9)", "rgba(255,252,244,0.95)", "rgba(215,140,60,0.75)"]);
  // Short vertical fur streaks.
  furStreaks(g, rand, w, h, 520, "rgba(220,155,80,0.65)");
  glossPatch(g);
  bakeSpecAlpha(g, w, h);
}
let texNibble = null, texEmber = null, texInit = false;
function ensureTex(kind) {
  if (!texInit && createTex) {
    // One attempt once the gl.js pass lands; any failure sticks to null so
    // a missing/broken createTex can never break boot or spam per frame.
    texInit = true;
    try { texNibble = createTex(128, 128, paintNibble) || null; } catch { texNibble = null; }
    try { texEmber = createTex(128, 128, paintEmbercub) || null; } catch { texEmber = null; }
  }
  if (kind === "foe") return texNibble || undefined;
  return texEmber || undefined;
}

function rootMatrix(px, py, pz, faceY, breath, fainted, faintSign, roll, lean) {
  let M = mat4mul(translation(px, py, pz), rotY(faceY));
  if (fainted) M = mat4mul(M, rotZ(faintSign * 1.35));
  // Idle weight shift about the ground origin: upper body sways while the
  // planted feet (near the origin) barely move.
  if (roll) M = mat4mul(M, rotZ(roll));
  if (lean) M = mat4mul(M, rotX(lean));
  M = mat4mul(M, scaling(breath[0], breath[1], breath[2]));
  return M;
}

// Per-battler 11-float soups (pos + color + normal + uv), one texture each.
function stripTo9(arr11) {
  const out = new Array((arr11.length / 11) * 9);
  let j = 0;
  for (let i = 0; i < arr11.length; i += 11) {
    out[j++] = arr11[i]; out[j++] = arr11[i + 1]; out[j++] = arr11[i + 2];
    out[j++] = arr11[i + 3]; out[j++] = arr11[i + 4]; out[j++] = arr11[i + 5];
    out[j++] = arr11[i + 6]; out[j++] = arr11[i + 7]; out[j++] = arr11[i + 8];
  }
  return out;
}
function stripTo6(arr11) {
  const out = new Array((arr11.length / 11) * 6);
  let j = 0;
  for (let i = 0; i < arr11.length; i += 11) {
    out[j++] = arr11[i]; out[j++] = arr11[i + 1]; out[j++] = arr11[i + 2];
    out[j++] = arr11[i + 3]; out[j++] = arr11[i + 4]; out[j++] = arr11[i + 5];
  }
  return out;
}
export function drawMons(ctx, viewProj, state, t) {
  const time = typeof t === "number" ? t : 0;
  const arrFoe = [], arrMe = [];

  const flashFoe = clamp01(state && typeof state.flashFoe === "number" ? state.flashFoe : 0);
  const flashMe = clamp01(state && typeof state.flashMe === "number" ? state.flashMe : 0);
  // Lunge 0..1 toward opponent: foe surges +z, player surges -z.
  const lungeFoe = (state && typeof state.lungeFoe === "number" ? state.lungeFoe : 0) * 1.5;
  const lungeMe = (state && typeof state.lungeMe === "number" ? state.lungeMe : 0) * 1.5;
  // Sink 0..1 on faint: ease body into the ground (read-only).
  const sinkFoe = (state && typeof state.sinkFoe === "number" ? state.sinkFoe : 0) * 0.6;
  const sinkMe = (state && typeof state.sinkMe === "number" ? state.sinkMe : 0) * 0.6;
  const foeFainted = !!(
    (state && (state.fainted === "foe" || state.fainted === "both")) ||
    (state && state.foe && typeof state.foe.cur === "number" && state.foe.cur <= 0)
  );
  const meFainted = !!(
    (state && (state.fainted === "me" || state.fainted === "both")) ||
    (state && state.me && typeof state.me.cur === "number" && state.me.cur <= 0)
  );

  // Foe Nibble on FOE_SPOT, faces +z (camera). Lean/sway cycle + bob +
  // breathe, phase 0. Motion damps to near-stillness when fainted.
  {
    const FOE_S = 1.3;
    const damp = foeFainted ? 0.12 : 1;
    const bob = Math.sin(time * 2.2) * 0.07 * damp;
    const s = Math.sin(time * 3.1) * damp;
    const roll = damp * 0.035 * Math.sin(time * 0.9);
    const lean = damp * 0.03 * Math.sin(time * 1.1 + 0.7);
    const M = rootMatrix(SPOTS.foe[0], Math.max(0, bob) - sinkFoe, SPOTS.foe[2] + lungeFoe, 0,
      [FOE_S * (1 + 0.02 * s), FOE_S * (1 + 0.03 * s), FOE_S * (1 + 0.02 * s)], foeFainted, 1, roll, lean);
    buildNibble(arrFoe, M, flashFoe, time, damp);
  }

  // Player Embercub on ME_SPOT, faces -z (foe). Phase-shifted bob/breathe.
  // ME_S makes the near battler a close foreground anchor filling
  // bottom-left. Ground-origin scale, so feet stay planted on ME_SPOT.
  {
    const ME_S = 0.50;
    const introS = (state && typeof state.introScale === "number") ? state.introScale : 1;
    const damp = meFainted ? 0.12 : 1;
    const bob = Math.sin(time * 2.2 + 2.1) * 0.08 * damp;
    const s = Math.sin(time * 2.7 + 1.2) * damp;
    const roll = damp * 0.035 * Math.sin(time * 0.8 + 2.4);
    const lean = damp * 0.03 * Math.sin(time * 1.0 + 3.1);
    // Slight yaw off pure -z: body still squares up to the foe, but the head
    // leads toward frame center so the over-shoulder camera catches snout +
    // near-side eye + flame in 3/4 profile instead of the far flank.
    const M = rootMatrix(SPOTS.me[0], Math.max(0, bob) - sinkMe, SPOTS.me[2] - lungeMe, Math.PI + 0.35,
      [ME_S * (1 + 0.02 * s) * introS, ME_S * (1 + 0.03 * s) * introS, ME_S * (1 + 0.02 * s) * introS], meFainted, -1, roll, lean);
    buildEmbercub(arrMe, M, flashMe, time, damp);
  }

  if (!arrFoe.length && !arrMe.length) return;
  // Emit in tri-boundary chunks: gl.js streams plain Arrays through a
  // capped scratch buffer (STREAM_CAP_TRIS verts/call, remainder dropped),
  // so a whole-pair soup must never go out in one call. Chunking is
  // pixel-identical (opaque depth-tested tris, order-independent).
  const CHUNK_TRIS = 1100; // 3300 verts/call, under the stream cap
  // Textured path: per-battler soup + its procedural texture, rim armed per
  // batch inside emitNT.
  if (drawTrisNT) {
    try {
      emitNT(ctx, viewProj, arrFoe, ensureTex("foe"));
      emitNT(ctx, viewProj, arrMe, ensureTex("me"));
      return;
    } catch { /* fall through to the untextured path */ }
  }
  if (drawTrisN) {
    const foe9 = stripTo9(arrFoe), me9 = stripTo9(arrMe);
    for (let i = 0; i < foe9.length; i += CHUNK_TRIS * 27) {
      drawTrisN(ctx, foe9.slice(i, i + CHUNK_TRIS * 27), viewProj);
    }
    for (let i = 0; i < me9.length; i += CHUNK_TRIS * 27) {
      drawTrisN(ctx, me9.slice(i, i + CHUNK_TRIS * 27), viewProj);
    }
    return;
  }
  // Fallback: strip normals+uvs to the legacy 6-float layout so every frame
  // renders (flat vertex colors) even before the migration lands.
  const foe6 = stripTo6(arrFoe), me6 = stripTo6(arrMe);
  for (let i = 0; i < foe6.length; i += CHUNK_TRIS * 18) {
    drawTris(ctx, foe6.slice(i, i + CHUNK_TRIS * 18), viewProj);
  }
  for (let i = 0; i < me6.length; i += CHUNK_TRIS * 18) {
    drawTris(ctx, me6.slice(i, i + CHUNK_TRIS * 18), viewProj);
  }
}
function emitNT(ctx, viewProj, arr11, tex) {
  const CHUNK_FLOATS = 1100 * 33; // 11 floats/vert
  for (let i = 0; i < arr11.length; i += CHUNK_FLOATS) {
    // Old paths auto-reset uRim to 0, so arm it immediately before every
    // textured batch; guarded — absent setter skips silently.
    if (setRim) { try { setRim(0.6); } catch {} }
    drawTrisNT(ctx, arr11.slice(i, i + CHUNK_FLOATS), viewProj, tex);
  }
}
