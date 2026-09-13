// models.js: original low-poly battlers from raw triangles.
// Foe Nibble (small blue rodent) on FOE_SPOT: rearing lunging crouch,
// head pitched forward-down on a neck pivot, tail kinked up behind.
// Player Embercub (orange cub) on ME_SPOT: battle crouch, head turned
// 3/4 back toward the camera on a neck pivot so the snout reads in
// profile over the shoulder, tail arcing with a flickering flame.
// Surfacing: quantized 3-tone cel finish on every mass (lit top, mid
// flanks, dark underbelly/back = fake AO), dark crevice bands at neck
// junctions and leg inner sides, faceted pyramid sides, silhouette
// tufts/spikes, white glint pixels on camera-facing eyes.
// Idle bob (sin t) + breathing scale. White hit-flash via
// state.flashFoe / state.flashMe (0..1). Lunge 0..1 as z-offset toward
// opponent, sink 0..1 as y-offset, faint pose via state.fainted.
// Reads only; decay owned by battle.js scene(). Total ~900 tris.
import { drawTris, mat4mul } from "./gl.js";

// Battler spots: arena.js FOE_SPOT/ME_SPOT are canonical. Guarded
// dynamic import (one-directional: arena never imports models) so a
// mid-write arena.js never breaks boot; defaults match arena values.
const SPOTS = { foe: [0, 0, -7], me: [0, 0, 2.5] };
import("./arena.js").then((m) => {
  if (m && Array.isArray(m.FOE_SPOT)) SPOTS.foe = m.FOE_SPOT;
  if (m && Array.isArray(m.ME_SPOT)) SPOTS.me = m.ME_SPOT;
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
// Cel finish: quantize the raw color, then lerp to white by hit-flash
// (shading first so a full flash still reads pure white).
function shade(col, m) {
  return [Math.min(1, col[0] * m), Math.min(1, col[1] * m), Math.min(1, col[2] * m)];
}
function fin(raw, F, m) {
  return flashCol(shade(raw, m === undefined ? 1 : m), F);
}

// 3-tone cel tables: [back(-z), front(+z), left(-x), right(+x), top, bottom].
// Light top, mid flanks, dark back/underbelly.
const SH_STD = [0.6, 0.95, 0.95, 0.95, 1.12, 0.6];
const SH_INNER_R = [0.6, 0.95, 0.95, 0.6, 1.12, 0.6]; // AO on +x (inner) face
const SH_INNER_L = [0.6, 0.95, 0.6, 0.95, 1.12, 0.6]; // AO on -x (inner) face
// Camera-side (local -x, faces the mirrored over-shoulder eye) finish for
// the cub: flank AO deepened one step, pale rim on top edges.
const SH_CUB = [0.6, 0.95, 0.6, 0.95, 1.22, 0.6];
const SH_CUB_LEG_L = [0.6, 0.95, 0.6, 0.6, 1.22, 0.6];
const SH_SEAM = [0.8, 0.8, 0.8, 0.8, 0.85, 0.7]; // dark crevice bands
// Nibble face finish: deeper facial shade steps (bright muzzle front,
// carved dark cheeks/sides, lit crown).
const SH_FACE = [0.6, 1.0, 0.75, 0.75, 1.12, 0.6];

function pushTri(arr, M, a, b, c, col) {
  const A = xform(M, a[0], a[1], a[2]);
  const B = xform(M, b[0], b[1], b[2]);
  const C = xform(M, c[0], c[1], c[2]);
  arr.push(
    A[0], A[1], A[2], col[0], col[1], col[2],
    B[0], B[1], B[2], col[0], col[1], col[2],
    C[0], C[1], C[2], col[0], col[1], col[2]
  );
}

// Shaded box centered (cx,cy,cz), size (sx,sy,sz): 12 tris.
function pushBox(arr, M, cx, cy, cz, sx, sy, sz, raw, F, sh) {
  const s = sh || SH_STD;
  const x0 = cx - sx / 2, x1 = cx + sx / 2;
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const z0 = cz - sz / 2, z1 = cz + sz / 2;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  // [quad, shade-slot]: back, front, left, right, top, bottom.
  const faces = [
    [[0, 1, 2, 3], s[0]], [[5, 4, 7, 6], s[1]], [[4, 0, 3, 7], s[2]],
    [[1, 5, 6, 2], s[3]], [[3, 2, 6, 7], s[4]], [[4, 5, 1, 0], s[5]],
  ];
  for (const [[a, b, c, d], m] of faces) {
    const col = fin(raw, F, m);
    pushTri(arr, M, v[a], v[b], v[c], col);
    pushTri(arr, M, v[a], v[c], v[d], col);
  }
}

// Shaded tapered box: bottom face (sxb,szb), top face (sxt,szt) shifted by
// (dx,dz) for lean: 12 tris with the same 3-tone finish.
function pushWedge(arr, M, cx, cy, cz, sy, sxb, szb, sxt, szt, dx, dz, raw, F, sh) {
  const y0 = cy - sy / 2, y1 = cy + sy / 2;
  const v = [
    [cx - sxb / 2, y0, cz - szb / 2], [cx + sxb / 2, y0, cz - szb / 2],
    [cx + sxb / 2, y0, cz + szb / 2], [cx - sxb / 2, y0, cz + szb / 2],
    [cx + dx - sxt / 2, y1, cz + dz - szt / 2], [cx + dx + sxt / 2, y1, cz + dz - szt / 2],
    [cx + dx + sxt / 2, y1, cz + dz + szt / 2], [cx + dx - sxt / 2, y1, cz + dz + szt / 2],
  ];
  // [tris, shade-slot]: bottom, top, front, back, left, right. Optional sh
  // overrides the 3-tone finish with a [back,front,left,right,top,bottom] set.
  const q = sh || SH_STD;
  const groups = [
    [[[0, 1, 2], [0, 2, 3]], q[5]], [[[4, 5, 6], [4, 6, 7]], q[4]],
    [[[3, 2, 6], [3, 6, 7]], q[1]], [[[1, 0, 4], [1, 4, 5]], q[0]],
    [[[0, 3, 7], [0, 7, 4]], q[2]], [[[2, 1, 5], [2, 5, 6]], q[3]],
  ];
  for (const [[t1, t2], m] of groups) {
    const col = fin(raw, F, m);
    pushTri(arr, M, v[t1[0]], v[t1[1]], v[t1[2]], col);
    pushTri(arr, M, v[t2[0]], v[t2[1]], v[t2[2]], col);
  }
}

// Shaded pyramid: dark base, alternating light/mid facet steps: 6 tris.
function pushPyramid(arr, M, bx, by, bz, h, ax, ay, az, raw, F) {
  const p00 = [bx - h, by, bz - h], p10 = [bx + h, by, bz - h];
  const p11 = [bx + h, by, bz + h], p01 = [bx - h, by, bz + h];
  const ap = [ax, ay, az];
  const base = fin(raw, F, 0.6);
  pushTri(arr, M, p00, p10, p11, base);
  pushTri(arr, M, p00, p11, p01, base);
  const sides = [[p00, ap, p10], [p10, ap, p11], [p11, ap, p01], [p01, ap, p00]];
  sides.forEach(([a, b, c], i) => pushTri(arr, M, a, b, c, fin(raw, F, i % 2 ? 0.95 : 1.12)));
}

// ---- Nibble: lunging crouch, head pitched down-forward, tail kinked up ----
function buildNibble(arr, M, F, t, damp) {
  const time = typeof t === "number" ? t : 0;
  const dk = damp === undefined ? 1 : damp;
  const BLUE = [0.24, 0.48, 0.94];
  const DARK = [0.16, 0.30, 0.66];
  const CREAM = [0.78, 0.87, 1.0];
  const PINK = [0.98, 0.62, 0.70];
  const INK = [0.08, 0.08, 0.12];
  const WHITE = [1, 1, 1];
  // segmented legs: thigh + shin + planted foot
  pushBox(arr, M, -0.20, 0.24, -0.10, 0.22, 0.32, 0.34, BLUE, F, SH_INNER_R);
  pushBox(arr, M, 0.20, 0.24, -0.10, 0.22, 0.32, 0.34, BLUE, F, SH_INNER_L);
  pushBox(arr, M, -0.20, 0.14, 0.06, 0.16, 0.24, 0.22, DARK, F);
  pushBox(arr, M, 0.20, 0.14, 0.06, 0.16, 0.24, 0.22, DARK, F);
  pushBox(arr, M, -0.22, 0.07, 0.12, 0.22, 0.14, 0.40, DARK, F);
  pushBox(arr, M, 0.22, 0.07, 0.12, 0.22, 0.14, 0.40, DARK, F);
  // pale toe caps: paw color breaks on both feet
  pushBox(arr, M, -0.22, 0.06, 0.33, 0.20, 0.10, 0.10, CREAM, F);
  pushBox(arr, M, 0.22, 0.06, 0.33, 0.20, 0.10, 0.10, CREAM, F);
  // coiled body: low rear mass + forward chest mass + belly patch
  pushBox(arr, M, 0, 0.42, -0.18, 0.64, 0.52, 0.70, BLUE, F);
  pushBox(arr, M, 0, 0.55, 0.12, 0.55, 0.45, 0.45, BLUE, F);
  pushBox(arr, M, 0, 0.42, 0.32, 0.38, 0.34, 0.12, CREAM, F);
  // segmented arms reaching forward: upper + pale forearm + shoulder tufts
  pushBox(arr, M, -0.32, 0.55, 0.28, 0.10, 0.26, 0.12, BLUE, F);
  pushBox(arr, M, 0.32, 0.55, 0.28, 0.10, 0.26, 0.12, BLUE, F);
  pushBox(arr, M, -0.32, 0.40, 0.36, 0.09, 0.22, 0.10, CREAM, F);
  pushBox(arr, M, 0.32, 0.40, 0.36, 0.09, 0.22, 0.10, CREAM, F);
  pushPyramid(arr, M, -0.34, 0.66, 0.26, 0.07, -0.39, 0.88, 0.26, BLUE, F);
  pushPyramid(arr, M, 0.34, 0.66, 0.26, 0.07, 0.39, 0.88, 0.26, BLUE, F);
  // tail kinked up behind: rigid lashing assembly on a base pivot
  const T = headMat(M, 0, 0.55, -0.40, dk * 0.3 * Math.sin(time * 1.9 + 0.5), dk * 0.12 * Math.sin(time * 2.6 + 1.2));
  pushBox(arr, T, 0, 0.55, -0.60, 0.15, 0.15, 0.45, BLUE, F);
  pushBox(arr, T, 0, 0.80, -0.74, 0.13, 0.34, 0.13, BLUE, F);
  pushPyramid(arr, T, 0, 0.94, -0.76, 0.08, 0, 1.18, -0.72, DARK, F);
  // neck shadow: dark collar band at the head-torso junction
  pushBox(arr, M, 0, 0.68, 0.24, 0.48, 0.14, 0.44, DARK, F, SH_SEAM);
  // head pitched forward-down on the neck pivot (lunge snarl) + slow
  // glance yaw and bob nod on different periods
  const H = headMat(M, 0, 0.72, 0.20, dk * 0.14 * Math.sin(time * 0.55 + 1.0), 0.28 + dk * 0.05 * Math.sin(time * 1.7));
  pushBox(arr, H, 0, 1.02, 0.38, 0.62, 0.50, 0.55, BLUE, F, SH_FACE);
  pushBox(arr, H, 0, 0.93, 0.68, 0.30, 0.20, 0.12, CREAM, F, SH_FACE);
  pushBox(arr, H, 0, 0.84, 0.62, 0.22, 0.10, 0.10, CREAM, F);
  pushBox(arr, H, 0, 0.99, 0.74, 0.10, 0.08, 0.05, INK, F);
  // eyes + brow planes + white glint pixels
  pushBox(arr, H, -0.18, 1.09, 0.65, 0.15, 0.17, 0.04, INK, F);
  pushBox(arr, H, 0.18, 1.09, 0.65, 0.15, 0.17, 0.04, INK, F);
  pushBox(arr, H, -0.18, 1.22, 0.60, 0.16, 0.07, 0.10, DARK, F);
  pushBox(arr, H, 0.18, 1.22, 0.60, 0.16, 0.07, 0.10, DARK, F);
  pushBox(arr, H, -0.21, 1.13, 0.675, 0.06, 0.07, 0.02, WHITE, F);
  pushBox(arr, H, 0.15, 1.13, 0.675, 0.06, 0.07, 0.02, WHITE, F);
  // cheeks
  pushBox(arr, H, -0.30, 0.95, 0.52, 0.06, 0.10, 0.16, PINK, F);
  pushBox(arr, H, 0.30, 0.95, 0.52, 0.06, 0.10, 0.16, PINK, F);
  // ears with inner faces front AND back, dark tips
  pushPyramid(arr, H, -0.22, 1.27, 0.32, 0.13, -0.28, 1.69, 0.28, BLUE, F);
  pushPyramid(arr, H, 0.22, 1.27, 0.32, 0.13, 0.28, 1.69, 0.28, BLUE, F);
  pushPyramid(arr, H, -0.22, 1.29, 0.40, 0.08, -0.26, 1.55, 0.38, PINK, F);
  pushPyramid(arr, H, 0.22, 1.29, 0.40, 0.08, 0.26, 1.55, 0.38, PINK, F);
  pushPyramid(arr, H, -0.22, 1.29, 0.24, 0.08, -0.26, 1.55, 0.20, PINK, F);
  pushPyramid(arr, H, 0.22, 1.29, 0.24, 0.08, 0.26, 1.55, 0.20, PINK, F);
  pushPyramid(arr, H, -0.28, 1.63, 0.28, 0.07, -0.28, 1.83, 0.28, DARK, F);
  pushPyramid(arr, H, 0.28, 1.63, 0.28, 0.07, 0.28, 1.83, 0.28, DARK, F);
}

// ---- Embercub: battle crouch, head turned 3/4 over the shoulder ----
function buildEmbercub(arr, M, F, t, damp) {
  const time = typeof t === "number" ? t : 0;
  const dk = damp === undefined ? 1 : damp;
  const ORANGE = [0.94, 0.50, 0.14];
  const DARK = [0.55, 0.28, 0.10];
  const CREAM = [1.0, 0.86, 0.62];
  const INK = [0.10, 0.07, 0.06];
  const FLAME = [1.0, 0.72, 0.16];
  const CORE = [1.0, 0.94, 0.55];
  const WHITE = [1, 1, 1];
  // segmented rear legs: planted paw + thigh + shin
  pushBox(arr, M, -0.30, 0.09, 0.10, 0.30, 0.18, 0.60, DARK, F);
  pushBox(arr, M, 0.30, 0.09, 0.10, 0.30, 0.18, 0.60, DARK, F);
  pushBox(arr, M, -0.50, 0.40, -0.25, 0.26, 0.55, 0.60, ORANGE, F, SH_CUB_LEG_L);
  pushBox(arr, M, 0.50, 0.40, -0.25, 0.26, 0.55, 0.60, ORANGE, F, SH_INNER_L);
  pushBox(arr, M, -0.40, 0.22, 0.0, 0.20, 0.32, 0.34, DARK, F, SH_CUB_LEG_L);
  pushBox(arr, M, 0.40, 0.22, 0.0, 0.20, 0.32, 0.34, DARK, F);
  // segmented front legs: upper + fore + pale paw
  pushBox(arr, M, -0.30, 0.45, 0.44, 0.22, 0.55, 0.24, ORANGE, F, SH_CUB_LEG_L);
  pushBox(arr, M, 0.30, 0.45, 0.44, 0.22, 0.55, 0.24, ORANGE, F, SH_INNER_L);
  pushBox(arr, M, -0.30, 0.22, 0.52, 0.19, 0.35, 0.20, ORANGE, F, SH_CUB_LEG_L);
  pushBox(arr, M, 0.30, 0.22, 0.52, 0.19, 0.35, 0.20, ORANGE, F);
  pushBox(arr, M, -0.30, 0.08, 0.55, 0.24, 0.16, 0.36, CREAM, F);
  pushBox(arr, M, 0.30, 0.08, 0.55, 0.24, 0.16, 0.36, CREAM, F);
  // tapered torso leaning forward (top narrower, shifted +z)
  pushWedge(arr, M, 0, 0.72, -0.08, 0.95, 1.00, 1.05, 0.68, 0.80, 0, 0.10, ORANGE, F, SH_CUB);
  pushBox(arr, M, 0, 0.60, 0.44, 0.55, 0.55, 0.14, CREAM, F);
  // shoulder hump + back ridge spikes
  pushBox(arr, M, 0, 1.18, -0.05, 0.66, 0.28, 0.70, ORANGE, F, SH_CUB);
  pushPyramid(arr, M, 0, 1.28, 0.10, 0.08, 0, 1.54, 0.02, DARK, F);
  pushPyramid(arr, M, 0, 1.26, -0.20, 0.08, 0, 1.52, -0.28, DARK, F);
  pushPyramid(arr, M, 0, 1.22, -0.48, 0.08, 0, 1.46, -0.56, DARK, F);
  // shoulder spikes (silhouette from behind)
  pushPyramid(arr, M, -0.20, 1.28, -0.15, 0.09, -0.24, 1.62, -0.28, ORANGE, F);
  pushPyramid(arr, M, 0.20, 1.28, -0.15, 0.09, 0.24, 1.62, -0.28, ORANGE, F);
  // neck shadow: dark collar band at the head-torso junction
  pushBox(arr, M, 0, 1.24, 0.10, 0.60, 0.16, 0.60, DARK, F, SH_SEAM);
  // head turned 3/4 over the shoulder + slow glance yaw and bob nod
  const H = headMat(M, 0, 1.30, 0.10, -0.5 + dk * 0.16 * Math.sin(time * 0.45 + 2.0), dk * 0.04 * Math.sin(time * 1.3 + 0.5));
  // wedge head, snout-ward taper + muzzle planes + chin
  pushWedge(arr, H, 0, 1.48, 0.28, 0.62, 0.74, 0.66, 0.55, 0.50, 0, 0.10, ORANGE, F, SH_CUB);
  pushBox(arr, H, 0, 1.36, 0.66, 0.36, 0.24, 0.22, CREAM, F);
  pushBox(arr, H, 0, 1.28, 0.60, 0.26, 0.10, 0.16, CREAM, F);
  pushBox(arr, H, 0, 1.44, 0.77, 0.12, 0.09, 0.06, INK, F);
  // cheek tufts (sideways pyramids break the head silhouette)
  pushPyramid(arr, H, -0.40, 1.35, 0.30, 0.09, -0.62, 1.40, 0.15, ORANGE, F);
  pushPyramid(arr, H, 0.40, 1.35, 0.30, 0.09, 0.62, 1.40, 0.15, ORANGE, F);
  // side eyes on both flanks, oversized for the long camera distance
  pushBox(arr, H, -0.35, 1.55, 0.38, 0.05, 0.18, 0.20, INK, F);
  pushBox(arr, H, 0.35, 1.55, 0.38, 0.05, 0.18, 0.20, INK, F);
  // glint pixels on both side eyes
  pushBox(arr, H, -0.381, 1.60, 0.42, 0.02, 0.06, 0.07, WHITE, F);
  pushBox(arr, H, 0.381, 1.60, 0.42, 0.02, 0.06, 0.07, WHITE, F);
  // brow planes
  pushBox(arr, H, -0.25, 1.70, 0.40, 0.24, 0.10, 0.22, DARK, F);
  pushBox(arr, H, 0.25, 1.70, 0.40, 0.24, 0.10, 0.22, DARK, F);
  // ears swept slightly back, cream inners front AND back
  pushPyramid(arr, H, -0.27, 1.78, 0.12, 0.16, -0.32, 2.30, -0.02, ORANGE, F);
  pushPyramid(arr, H, 0.27, 1.78, 0.12, 0.16, 0.32, 2.30, -0.02, ORANGE, F);
  pushPyramid(arr, H, -0.27, 1.82, 0.22, 0.08, -0.30, 2.14, 0.12, CREAM, F);
  pushPyramid(arr, H, 0.27, 1.82, 0.22, 0.08, 0.30, 2.14, 0.12, CREAM, F);
  pushPyramid(arr, H, -0.27, 1.82, 0.02, 0.08, -0.30, 2.14, -0.08, CREAM, F);
  pushPyramid(arr, H, 0.27, 1.82, 0.02, 0.08, 0.30, 2.14, -0.08, CREAM, F);
  // tail kinking out with a bend; lashing assembly on a base pivot, flame
  // flicker independent so fire and tail move on different periods
  const T = headMat(M, 0.28, 0.55, -0.70, dk * 0.22 * Math.sin(time * 1.6 + 2.0), 0);
  pushBox(arr, T, 0.28, 0.60, -0.72, 0.20, 0.42, 0.20, ORANGE, F);
  pushBox(arr, T, 0.38, 0.95, -0.66, 0.18, 0.40, 0.18, ORANGE, F);
  const fl = 1 + 0.22 * Math.sin(t * 11) + 0.10 * Math.sin(t * 23 + 1);
  const fh = 0.70 * fl;
  pushPyramid(arr, T, 0.38, 1.12, -0.66, 0.18, 0.38, 1.12 + fh, -0.66, FLAME, F);
  pushPyramid(arr, T, 0.38, 1.12, -0.66, 0.09, 0.38, 1.12 + fh * 0.6, -0.64, CORE, F);
  // back stripes
  pushBox(arr, M, -0.15, 1.10, -0.42, 0.10, 0.06, 0.45, DARK, F);
  pushBox(arr, M, 0.15, 1.10, -0.42, 0.10, 0.06, 0.45, DARK, F);
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

  if (arr.length) drawTris(ctx, arr, viewProj);
}
