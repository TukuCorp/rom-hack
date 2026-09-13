// models.js: original high-detail battlers from raw triangles (9-float
// verts: pos + color + normal) lit by the gl.js cel shader via drawTrisN,
// with a guarded drawTris fallback so boot never breaks mid-migration.
// Foe Nibble (small blue rodent) on FOE_SPOT: rearing lunging crouch,
// rounded skull + tapered muzzlepitched forward-down on a neck pivot,
// tail kinked up behind. Player Embercub (orange cub) on ME_SPOT: battle
// crouch, head turned 3/4 back toward the camera on a neck pivot so the
// snout reads in profile over the shoulder, tail arcing with a
// flickering flame.
// Surfacing: smooth analytic normals on every round mass (sphere gradient,
// taper-corrected tube walls), crisp face normals on planes (wedge snout,
// stripes, inner-ear blades); color zones pre-separated as raw vertex
// colors (belly / inner-ear / paw creams, stepped flank shades) for the
// cel shader to tone. Emissive bits (eye glints, flame) use zero-length
// normals so the shader's unlit path keeps them fullbright.
// Idle bob (sin t) + breathing scale. White hit-flash via
// state.flashFoe / state.flashMe (0..1). Lunge 0..1 as z-offset toward
// opponent, sink 0..1 as y-offset, faint pose via state.fainted.
// Reads only; decay owned by battle.js scene(). Pair ~2.8k tris.
import { drawTris, mat4mul } from "./gl.js";

// drawTrisN arrives via one-directional guarded dynamic import (gl.js never
// imports models) so a mid-write gl.js never breaks boot; until it lands,
// the drawTris 6-float path below keeps every frame rendering.
let drawTrisN = null;
try {
  import("./gl.js")
    .then((m) => {
      if (m && typeof m.drawTrisN === "function") drawTrisN = m.drawTrisN;
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

function norm3(x, y, z) {
  const l = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / l, y / l, z / l];
}

// Core emitter: one 9-float vertex (pos, color, normal).
function pushV(arr, M, p, n, col) {
  const P = xform(M, p[0], p[1], p[2]);
  const N = n === UNLIT ? UNLIT : xformN(M, n[0], n[1], n[2]);
  arr.push(P[0], P[1], P[2], col[0], col[1], col[2], N[0], N[1], N[2]);
}

// Flat triangle: face normal from local-space winding (author CCW outward).
function pushTriN(arr, M, a, b, c, col, n) {
  let N = n;
  if (!N) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    N = norm3(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  pushV(arr, M, a, N, col);
  pushV(arr, M, b, N, col);
  pushV(arr, M, c, N, col);
}

// Crisp quad (two tris, single face normal): stripes, glints, ear blades.
function pushQuad(arr, M, a, b, c, d, col, n) {
  pushTriN(arr, M, a, b, c, col, n);
  pushTriN(arr, M, a, c, d, col, n);
}
// Round glossy glint: flat radial fan with zero normals (shader fullbright
// path), tangent to the eyeball so the rim tucks into the ball and the
// round silhouette reads instead of a square pixel.
function glintDisc(arr, M, cx, cy, cz, r, nx, ny, nz, col, radial) {
  const n = norm3(nx, ny, nz);
  const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm3(up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]);
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const segs = radial || 8;
  const ring = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ring.push([cx + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * r,
      cy + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * r,
      cz + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * r]);
  }
  for (let i = 0; i < segs; i++) {
    pushV(arr, M, [cx, cy, cz], UNLIT, col);
    pushV(arr, M, ring[i], UNLIT, col);
    pushV(arr, M, ring[(i + 1) % segs], UNLIT, col);
  }
}
// Lit color disc (flat analytic normal -> cel-toned): iris.
function irisDisc(arr, M, cx, cy, cz, r, nx, ny, nz, col, radial) {
  const n = norm3(nx, ny, nz);
  const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm3(up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]);
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const segs = radial || 8;
  const ring = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ring.push([cx + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * r,
      cy + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * r,
      cz + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * r]);
  }
  for (let i = 0; i < segs; i++) {
    pushV(arr, M, [cx, cy, cz], n, col);
    pushV(arr, M, ring[i], n, col);
    pushV(arr, M, ring[(i + 1) % segs], n, col);
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
    pushTriN(arr, M, v[a], v[b], v[c], col, n);
    pushTriN(arr, M, v[a], v[c], v[d], col, n);
  }
}

// Smooth ellipsoid centered c, radii r: nLat x nLon x 2 tris, analytic
// normals (sphere gradient). colFn(u, v, theta, phi) -> raw rgb.
function ellipsoid(arr, M, cx, cy, cz, rx, ry, rz, nLat, nLon, colFn, F, range) {
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
      row.push({ p, n, col });
    }
    grid.push(row);
  }
  for (let j = 0; j < nLat; j++) {
    for (let i = 0; i < nLon; i++) {
      const a = grid[j][i], b = grid[j][i + 1], c = grid[j + 1][i + 1], d = grid[j + 1][i];
      pushV(arr, M, a.p, a.n, a.col);
      pushV(arr, M, d.p, d.n, d.col);
      pushV(arr, M, c.p, c.n, c.col);
      pushV(arr, M, a.p, a.n, a.col);
      pushV(arr, M, c.p, c.n, c.col);
      pushV(arr, M, b.p, b.n, b.col);
    }
  }
}

// Tapered tube p0(r0) -> p1(r1): radial x segs x 2 smooth side tris with
// taper-corrected wall normals, plus flat end caps. colFn(s, ringT).
function tube(arr, M, p0, p1, r0, r1, radial, segs, colFn, F, caps) {
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
      ring.push({ p, n, col: flashCol(colFn(s, i / radial), F) });
    }
    rings.push(ring);
  }
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < radial; i++) {
      const a = rings[j][i], b = rings[j][i + 1], c = rings[j + 1][i + 1], d = rings[j + 1][i];
      pushV(arr, M, a.p, a.n, a.col);
      pushV(arr, M, b.p, b.n, b.col);
      pushV(arr, M, c.p, c.n, c.col);
      pushV(arr, M, a.p, a.n, a.col);
      pushV(arr, M, c.p, c.n, c.col);
      pushV(arr, M, d.p, d.n, d.col);
    }
  }
  if (caps === undefined || caps[0]) {
    const n0 = [-ax[0], -ax[1], -ax[2]];
    const c0 = flashCol(colFn(0, 0.5), F);
    const ctr = { p: p0.slice(), n: n0, col: c0 };
    for (let i = 0; i < radial; i++) {
      pushV(arr, M, ctr.p, ctr.n, ctr.col);
      pushV(arr, M, rings[0][i + 1].p, n0, rings[0][i + 1].col);
      pushV(arr, M, rings[0][i].p, n0, rings[0][i].col);
    }
  }
  if (caps === undefined || caps[1]) {
    const n1 = ax.slice();
    const c1 = flashCol(colFn(1, 0.5), F);
    const ctr = { p: p1.slice(), n: n1, col: c1 };
    const last = rings[segs];
    for (let i = 0; i < radial; i++) {
      pushV(arr, M, ctr.p, ctr.n, ctr.col);
      pushV(arr, M, last[i].p, n1, last[i].col);
      pushV(arr, M, last[i + 1].p, n1, last[i + 1].col);
    }
  }
}

// Smooth cone: base disc (flat cap normal -axis) + taper-corrected flank
// fan to the apex. radial x 2 + radial tris.
function cone(arr, M, bx, by, bz, r, axx, axy, axz, radial, raw, F, rawApex) {
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
    });
  }
  const apex = [axx, axy, axz];
  for (let i = 0; i < radial; i++) {
    pushV(arr, M, apex, ring[i].n, colA);
    pushV(arr, M, ring[i].p, ring[i].n, colB);
    pushV(arr, M, ring[i + 1].p, ring[i + 1].n, colB);
  }
  const nb = [-ax[0], -ax[1], -ax[2]];
  const ctr = [bx, by, bz];
  for (let i = 0; i < radial; i++) {
    pushTriN(arr, M, ctr, ring[i + 1].p, ring[i].p, colB, nb);
  }
}

// ---- Nibble: lunging crouch, rounded skull pitched down-forward, tail kinked up ----
function buildNibble(arr, M, F, t, damp) {
  const time = typeof t === "number" ? t : 0;
  const dk = damp === undefined ? 1 : damp;
  const BLUE = [0.26, 0.50, 0.95];
  const FLANK = [0.20, 0.40, 0.80];   // stepped flank shade
  const DARK = [0.15, 0.28, 0.62];    // back / crevice shade
  const CREAM = [0.80, 0.88, 1.0];    // belly, muzzle, paws, inner ear
  const PINK = [0.98, 0.62, 0.70];    // cheeks, ear inners
  const INK = [0.07, 0.07, 0.11];
  const WHITE = [1, 1, 1];

  // Haunches + barrel chest (smooth analytic masses) with a squashed cream
  // belly shell embedded in the chest front (intersection reads as a zone edge).
  ellipsoid(arr, M, 0, 0.42, -0.18, 0.33, 0.27, 0.36, 8, 6, C(FLANK), F);
  ellipsoid(arr, M, 0, 0.55, 0.10, 0.29, 0.24, 0.24, 8, 6, C(BLUE), F);
  ellipsoid(arr, M, 0, 0.40, 0.20, 0.20, 0.18, 0.16, 6, 4, C(CREAM), F);
  // Neck: short tapered tube into the head pivot.
  tube(arr, M, [0, 0.55, 0.18], [0, 0.72, 0.24], 0.20, 0.24, 8, 1, C(DARK), F, [false, false]);

  // Jointed legs: round thigh + tapered shin + ellipsoid foot + cream toes.
  for (const s of [-1, 1]) {
    ellipsoid(arr, M, s * 0.22, 0.26, -0.12, 0.13, 0.17, 0.18, 6, 5, C(BLUE), F);
    tube(arr, M, [s * 0.22, 0.16, -0.02], [s * 0.23, 0.10, 0.10], 0.085, 0.10, 7, 1, C(DARK), F, [false, false]);
    ellipsoid(arr, M, s * 0.23, 0.07, 0.16, 0.11, 0.07, 0.20, 6, 4, C(DARK), F);
    ellipsoid(arr, M, s * 0.23, 0.055, 0.32, 0.10, 0.05, 0.06, 5, 4, C(CREAM), F);
  }
  // Jointed arms reaching forward: tapered upper + cream forearm + paw ball.
  for (const s of [-1, 1]) {
    tube(arr, M, [s * 0.30, 0.62, 0.24], [s * 0.32, 0.44, 0.34], 0.07, 0.055, 7, 1, C(BLUE), F, [false, false]);
    tube(arr, M, [s * 0.32, 0.44, 0.34], [s * 0.32, 0.30, 0.40], 0.055, 0.05, 6, 1, C(CREAM), F, [false, true]);
    ellipsoid(arr, M, s * 0.32, 0.27, 0.41, 0.055, 0.05, 0.06, 5, 4, C(CREAM), F);
    cone(arr, M, s * 0.33, 0.66, 0.24, 0.06, s * 0.38, 0.86, 0.24, 5, BLUE, F);
  }
  // Tail kinked up behind: curved stack of tapering tubes + dark tuft cone,
  // lashed on a base pivot.
  const T = headMat(M, 0, 0.55, -0.40, dk * 0.3 * Math.sin(time * 1.9 + 0.5), dk * 0.12 * Math.sin(time * 2.6 + 1.2));
  tube(arr, T, [0, 0.55, -0.42], [0, 0.58, -0.72], 0.085, 0.07, 7, 1, C(BLUE), F);
  tube(arr, T, [0, 0.58, -0.72], [0, 0.82, -0.78], 0.07, 0.06, 7, 1, C(FLANK), F);
  cone(arr, T, 0, 0.82, -0.78, 0.06, 0, 1.10, -0.74, 6, DARK, F);

  // Head pitched forward-down on the neck pivot (lunge snarl) + slow
  // glance yaw and bob nod on different periods.
  const H = headMat(M, 0, 0.72, 0.20, dk * 0.14 * Math.sin(time * 0.55 + 1.0), 0.28 + dk * 0.05 * Math.sin(time * 1.7));
  // Rounded skull + tapered muzzle + nose ball.
  ellipsoid(arr, H, 0, 1.02, 0.36, 0.32, 0.26, 0.28, 12, 9, C(BLUE), F);
  tube(arr, H, [0, 0.94, 0.50], [0, 0.90, 0.70], 0.15, 0.10, 10, 1, C(CREAM), F, [false, false]);
  ellipsoid(arr, H, 0, 0.97, 0.71, 0.055, 0.045, 0.04, 7, 5, C(INK), F);
  // Jaw shading under the muzzle.
  ellipsoid(arr, H, 0, 0.83, 0.58, 0.11, 0.06, 0.09, 5, 4, C(CREAM), F);
  // ORAS eyes: white sclera spheres + deep-blue iris discs + large glints.
  for (const s of [-1, 1]) {
    const IRIS = [0.12, 0.25, 0.85];
    ellipsoid(arr, H, s * 0.17, 1.09, 0.585, 0.10, 0.11, 0.075, 7, 5, C(WHITE), F);
    irisDisc(arr, H, s * 0.206, 1.124, 0.657, 0.055, s * 0.28, 0.22, 0.94,
      flashCol(IRIS, F), 8);
    glintDisc(arr, H, s * 0.221, 1.144, 0.662, 0.032, s * 0.28, 0.22, 0.94,
      flashCol(WHITE, F), 8);
  }
  // Brow ridges.
  for (const s of [-1, 1]) {
    tube(arr, H, [s * 0.10, 1.21, 0.55], [s * 0.26, 1.20, 0.52], 0.045, 0.04, 5, 1, C(DARK), F);
  }
  // Cheek tufts: small swept cones + pink cheek balls.
  for (const s of [-1, 1]) {
    cone(arr, H, s * 0.30, 0.95, 0.44, 0.07, s * 0.42, 0.98, 0.34, 5, BLUE, F);
    ellipsoid(arr, H, s * 0.315, 0.95, 0.52, 0.035, 0.06, 0.09, 5, 3, C(PINK), F);
  }
  // Tall ears: tapered outer tubes with rounded dark tips, pink inner
  // blades front and back.
  for (const s of [-1, 1]) {
    tube(arr, H, [s * 0.20, 1.24, 0.30], [s * 0.26, 1.62, 0.27], 0.095, 0.055, 7, 1, C(BLUE), F);
    ellipsoid(arr, H, s * 0.26, 1.64, 0.27, 0.055, 0.06, 0.055, 5, 3, C(DARK), F);
    pushQuad(arr, H,
      [s * 0.20 - 0.045, 1.30, 0.375], [s * 0.20 + 0.045, 1.30, 0.375],
      [s * 0.245 + 0.03, 1.56, 0.345], [s * 0.245 - 0.03, 1.56, 0.345],
      flashCol(PINK, F), [0, 0, 1]);
    pushQuad(arr, H,
      [s * 0.20 + 0.045, 1.30, 0.225], [s * 0.20 - 0.045, 1.30, 0.225],
      [s * 0.245 - 0.03, 1.56, 0.255], [s * 0.245 + 0.03, 1.56, 0.255],
      flashCol(PINK, F), [0, 0, -1]);
  }
}

// ---- Embercub: battle crouch, domed head turned 3/4 over the shoulder ----
function buildEmbercub(arr, M, F, t, damp) {
  const time = typeof t === "number" ? t : 0;
  const dk = damp === undefined ? 1 : damp;
  const ORANGE = [0.94, 0.50, 0.14];
  const FLANK = [0.82, 0.40, 0.11];   // stepped flank shade
  const DARK = [0.55, 0.28, 0.10];    // back / crevice shade
  const CREAM = [1.0, 0.86, 0.62];    // chest, muzzle, paws, ear inners
  const INK = [0.10, 0.07, 0.06];
  const FLAME = [1.0, 0.60, 0.10];
  const CORE = [1.0, 0.92, 0.50];
  const WHITE = [1, 1, 1];

  // Tapered torso leaning forward + shoulder hump + cream chest shell.
  tube(arr, M, [0, 0.30, -0.12], [0, 1.10, 0.02], 0.50, 0.33, 10, 2, C(ORANGE), F);
  ellipsoid(arr, M, 0, 1.16, -0.06, 0.34, 0.16, 0.36, 8, 6, C(ORANGE), F);
  ellipsoid(arr, M, 0, 0.58, 0.30, 0.26, 0.28, 0.20, 8, 5, C(CREAM), F);
  // Back ridge spikes (crisp silhouette from behind).
  cone(arr, M, 0, 1.26, 0.10, 0.07, 0, 1.50, 0.02, 5, DARK, F);
  cone(arr, M, 0, 1.24, -0.20, 0.07, 0, 1.48, -0.28, 5, DARK, F);
  cone(arr, M, 0, 1.18, -0.48, 0.07, 0, 1.40, -0.56, 5, DARK, F);
  cone(arr, M, -0.20, 1.26, -0.15, 0.08, -0.24, 1.58, -0.28, 5, ORANGE, F);
  cone(arr, M, 0.20, 1.26, -0.15, 0.08, 0.24, 1.58, -0.28, 5, ORANGE, F);
  // Neck collar into the head pivot.
  tube(arr, M, [0, 1.10, 0.02], [0, 1.28, 0.10], 0.28, 0.30, 8, 1, C(DARK), F, [false, false]);

  // Segmented rear legs: planted paw + round haunch + tapered shin.
  for (const s of [-1, 1]) {
    ellipsoid(arr, M, s * 0.30, 0.09, 0.10, 0.15, 0.09, 0.30, 7, 5, C(DARK), F);
    ellipsoid(arr, M, s * 0.50, 0.40, -0.25, 0.14, 0.28, 0.31, 8, 5, C(ORANGE), F);
    tube(arr, M, [s * 0.44, 0.30, -0.08], [s * 0.40, 0.14, 0.02], 0.11, 0.10, 6, 1, C(FLANK), F, [false, false]);
  }
  // Segmented front legs: tapered upper + fore + cream paw balls.
  for (const s of [-1, 1]) {
    tube(arr, M, [s * 0.30, 0.62, 0.42], [s * 0.30, 0.30, 0.50], 0.115, 0.095, 7, 2, C(ORANGE), F);
    tube(arr, M, [s * 0.30, 0.30, 0.50], [s * 0.30, 0.14, 0.54], 0.095, 0.10, 6, 1, C(FLANK), F, [false, true]);
    ellipsoid(arr, M, s * 0.30, 0.08, 0.56, 0.12, 0.08, 0.18, 6, 4, C(CREAM), F);
  }

  // Head turned 3/4 over the shoulder + slow glance yaw and bob nod.
  const H = headMat(M, 0, 1.30, 0.10, -0.5 + dk * 0.16 * Math.sin(time * 0.45 + 2.0), dk * 0.04 * Math.sin(time * 1.3 + 0.5));
  // Domed skull + crisp wedge snout + cream muzzle planes + nose.
  ellipsoid(arr, H, 0, 1.50, 0.24, 0.37, 0.32, 0.33, 12, 9, C(ORANGE), F);
  tube(arr, H, [0, 1.40, 0.40], [0, 1.36, 0.66], 0.20, 0.13, 10, 1, C(ORANGE), F, [false, false]);
  ellipsoid(arr, H, 0, 1.33, 0.64, 0.14, 0.10, 0.10, 8, 6, C(CREAM), F);
  ellipsoid(arr, H, 0, 1.27, 0.60, 0.10, 0.045, 0.075, 6, 4, C(CREAM), F);
  cone(arr, H, 0, 1.42, 0.70, 0.055, 0, 1.42, 0.80, 6, INK, F);
  // Cheek ruff: swept cones flaring sideways off the cheeks.
  for (const s of [-1, 1]) {
    cone(arr, H, s * 0.34, 1.36, 0.28, 0.09, s * 0.58, 1.40, 0.12, 5, ORANGE, F);
    cone(arr, H, s * 0.34, 1.30, 0.28, 0.07, s * 0.54, 1.28, 0.16, 4, CREAM, F);
  }
  // ORAS eyes: white sclera spheres + amber iris discs + large glints.
  for (const s of [-1, 1]) {
    const IRIS = [0.95, 0.55, 0.12];
    ellipsoid(arr, H, s * 0.33, 1.56, 0.36, 0.06, 0.11, 0.12, 7, 5, C(WHITE), F);
    irisDisc(arr, H, s * 0.379, 1.589, 0.430, 0.05, s * 0.93, 0.16, 0.32,
      flashCol(IRIS, F), 8);
    glintDisc(arr, H, s * 0.390, 1.606, 0.433, 0.028, s * 0.93, 0.16, 0.32,
      flashCol(WHITE, F), 8);
    tube(arr, H, [s * 0.14, 1.70, 0.38], [s * 0.30, 1.69, 0.36], 0.05, 0.045, 5, 1, C(DARK), F);
  }
  // Ears swept slightly back: tapered outer tubes + rounded tips + cream
  // inner blades front and back.
  for (const s of [-1, 1]) {
    tube(arr, H, [s * 0.25, 1.74, 0.10], [s * 0.30, 2.24, -0.02], 0.11, 0.05, 7, 1, C(ORANGE), F);
    ellipsoid(arr, H, s * 0.30, 2.26, -0.02, 0.05, 0.06, 0.05, 5, 3, C(DARK), F);
    pushQuad(arr, H,
      [s * 0.25 - 0.05, 1.82, 0.20], [s * 0.25 + 0.05, 1.82, 0.20],
      [s * 0.285 + 0.03, 2.12, 0.10], [s * 0.285 - 0.03, 2.12, 0.10],
      flashCol(CREAM, F), [0, 0, 1]);
    pushQuad(arr, H,
      [s * 0.25 + 0.05, 1.82, 0.02], [s * 0.25 - 0.05, 1.82, 0.02],
      [s * 0.285 - 0.03, 2.12, -0.06], [s * 0.285 + 0.03, 2.12, -0.06],
      flashCol(CREAM, F), [0, 0, -1]);
  }

  // Tail kinking out with a bend, lashed on a base pivot; flame flicker
  // independent so fire and tail move on different periods. Flame cones
  // are UNLIT (emissive fullbright through the shader's unlit path).
  const T = headMat(M, 0.28, 0.55, -0.70, dk * 0.22 * Math.sin(time * 1.6 + 2.0), 0);
  tube(arr, T, [0.28, 0.55, -0.70], [0.34, 0.85, -0.68], 0.10, 0.085, 7, 1, C(ORANGE), F, [false, false]);
  tube(arr, T, [0.34, 0.85, -0.68], [0.38, 1.08, -0.64], 0.085, 0.07, 6, 1, C(FLANK), F);
  const fl = 1 + 0.22 * Math.sin(time * 11) + 0.10 * Math.sin(time * 23 + 1);
  const fh = 0.62 * fl;
  const fr = 0.17 * (1 + 0.10 * Math.sin(time * 17 + 0.7));
  coneUnlit(arr, T, 0.38, 1.10, -0.64, fr, 0.38, 1.10 + fh, -0.64, 10, flashCol(FLAME, F));
  coneUnlit(arr, T, 0.38, 1.10, -0.64, fr * 0.5, 0.38, 1.10 + fh * 0.6, -0.62, 8, flashCol(CORE, F));

  // Back stripes: thin crisp slabs over the rear torso.
  pushBox(arr, M, -0.15, 1.02, -0.40, 0.10, 0.06, 0.45, DARK, F);
  pushBox(arr, M, 0.15, 1.02, -0.40, 0.10, 0.06, 0.45, DARK, F);
  pushBox(arr, M, 0, 0.86, -0.52, 0.34, 0.06, 0.30, DARK, F);
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
  for (let i = 0; i <= radial; i++) {
    const a = (i / radial) * Math.PI * 2;
    ring.push([
      bx + (u[0] * Math.cos(a) + w[0] * Math.sin(a)) * r,
      by + (u[1] * Math.cos(a) + w[1] * Math.sin(a)) * r,
      bz + (u[2] * Math.cos(a) + w[2] * Math.sin(a)) * r,
    ]);
  }
  const apex = [axx, axy, axz];
  for (let i = 0; i < radial; i++) {
    pushV(arr, M, apex, UNLIT, col);
    pushV(arr, M, ring[i], UNLIT, col);
    pushV(arr, M, ring[i + 1], UNLIT, col);
  }
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

export function drawMons(ctx, viewProj, state, t) {
  const time = typeof t === "number" ? t : 0;
  const arr = [];

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
    buildNibble(arr, M, flashFoe, time, damp);
  }

  // Player Embercub on ME_SPOT, faces -z (foe). Phase-shifted bob/breathe.
  // ME_S makes the near battler a close foreground anchor filling
  // bottom-left. Ground-origin scale, so feet stay planted on ME_SPOT.
  {
    const ME_S = 0.50;
    const damp = meFainted ? 0.12 : 1;
    const bob = Math.sin(time * 2.2 + 2.1) * 0.08 * damp;
    const s = Math.sin(time * 2.7 + 1.2) * damp;
    const roll = damp * 0.035 * Math.sin(time * 0.8 + 2.4);
    const lean = damp * 0.03 * Math.sin(time * 1.0 + 3.1);
    // Slight yaw off pure -z: body still squares up to the foe, but the head
    // leads toward frame center so the over-shoulder camera catches snout +
    // near-side eye + flame in 3/4 profile instead of the far flank.
    const M = rootMatrix(SPOTS.me[0], Math.max(0, bob) - sinkMe, SPOTS.me[2] - lungeMe, Math.PI + 0.35,
      [ME_S * (1 + 0.02 * s), ME_S * (1 + 0.03 * s), ME_S * (1 + 0.02 * s)], meFainted, -1, roll, lean);
    buildEmbercub(arr, M, flashMe, time, damp);
  }

  if (!arr.length) return;
  // Emit in tri-boundary chunks: gl.js streams plain Arrays through a
  // capped scratch buffer (STREAM_CAP_TRIS verts/call, remainder dropped),
  // so a whole-pair soup must never go out in one call. Chunking is
  // pixel-identical (opaque depth-tested tris, order-independent).
  const CHUNK_TRIS = 1100; // 3300 verts/call, under the stream cap
  if (drawTrisN) {
    for (let i = 0; i < arr.length; i += CHUNK_TRIS * 27) {
      drawTrisN(ctx, arr.slice(i, i + CHUNK_TRIS * 27), viewProj);
    }
    return;
  }
  // Fallback: strip normals to the legacy 6-float layout so every frame
  // renders (flat vertex colors) even before the migration lands.
  const flat = new Array((arr.length / 9) * 6);
  let j = 0;
  for (let i = 0; i < arr.length; i += 9) {
    flat[j++] = arr[i];
    flat[j++] = arr[i + 1];
    flat[j++] = arr[i + 2];
    flat[j++] = arr[i + 3];
    flat[j++] = arr[i + 4];
    flat[j++] = arr[i + 5];
  }
  for (let i = 0; i < flat.length; i += CHUNK_TRIS * 18) {
    drawTris(ctx, flat.slice(i, i + CHUNK_TRIS * 18), viewProj);
  }
}
