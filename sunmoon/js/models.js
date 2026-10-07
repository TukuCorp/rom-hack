// models.js — procedural creature + prop models. Owned by: models builder.
//
// API (do not rename; arena.js and battle.js call these):
//   makeLitten(), makePopplio(), makeAlolanExeggutor() -> Model   (battlers, feet at y=0, facing +Z)
//   makePalmTree(opts), makeRock(opts), makeShell(opts), makeGrassTuft(opts), makeCloud(opts) -> Model
//   makeSolgaleo(), makeLunala() -> Model                          (altar scene, optional)
//
// Model = { parts: Part[], update?(dt, t, state, entity) }
// Part  = { geo, col, p, r, s, bone?, ...gl.js flags }
//
// Animation contract: battle.js sets `entity.anim = { name, t }` with
//   name in idle | enter | attack | hit | faint | recall | flee | victory  (t resets to 0)
// and main.js advances `entity.anim.t` each frame. Models read entity.anim to pose.
// Base pose = idle. Facing: the model's forward is +Z; entity.rot[1] aims it at the foe.
//
// How the models are built (all original geometry — no ROM data):
//   * Geometry is authored in model space and *baked* into the mesh (metres, +Y up,
//     forward +Z, lowest vertex at y=0). Every part therefore starts with an identity
//     transform and one part == one draw call. Repeated details (eyes, paws, fronds,
//     head cluster) are baked separately and `geo.merge`d into a single part.
//   * Colour is baked into vertex colours (`geo.colorize`); the part's `col` stays
//     white so the renderer multiplies by 1 and mixed-material merges work.
//   * Motion is driven by a tiny bone rig: `rig(model, [{name, pivot, parent}])` plus
//     `pose(model, {root, head, neck, tail, flame, ...})`, which writes each part's
//     p/r/s from a rest-identity transform. Parts that declare no bone ride the root.
//     A "bone" is a rotation/scale/translation about a pivot in model space, so the
//     trunk of the Exeggutor can bend about the base while the neck bends about the
//     shoulder — no per-frame allocation, a handful of mat4 ops per model per frame.
//   * `settle(model)` measures the finished mesh, drops the model so it stands exactly
//     on y=0, and publishes `height` / `shadowR` (ground-contact radius). Battlers write
//     `entity.shadow.r = model.shadowR` so contact shadows match the real footprint
//     (battle.js's hard-coded radii are per-slot, not per-species).

import { geo, tex, M } from './gl.js';

const WHITE = [1, 1, 1];
const Z3 = [0, 0, 0];

function part(geometry, col = WHITE, opts = {}) { return { geo: geometry, col, ...opts }; }

/* ---------------------------------------------------------- mesh helpers */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

/** Lumpy ellipsoid with half-extents (hx,hy,hz), centred on the origin. */
function ellip(hx, hy, hz, ws = 16, hs = 12, amp = 0.05, seed = 1) {
  return geo.bake(geo.blob(1, ws, hs, amp, seed), { s: [hx, hy, hz] });
}

/** Rotate/translate/scale a mesh in place (bake the placement into the vertices). */
function place(m, p, r, s) {
  return geo.bake(m, { p: p || Z3, r: r || Z3, s: s != null ? s : 1 });
}

function tint(m, c) { return geo.colorize(m, c); }

/** Deep copy of a mesh (geo.bake / geo.colorize mutate in place). */
function dup(m) {
  return geo.mesh(new Float32Array(m.pos), new Float32Array(m.nrm),
                  new Float32Array(m.col), new Float32Array(m.uv), new Uint32Array(m.idx));
}

/** Rebuild smooth vertex normals from the faces (a vertex-level deform leaves
 *  the authored normals stale, and the toon ramp reads the normal directly). */
function renorm(m) {
  const n = new Float32Array(m.nrm.length);
  const pos = m.pos, idx = m.idx;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (let k = 0; k < 3; k++) { const o = idx[t + k] * 3; n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  m.nrm = n;
  return m;
}

/** Keep only the triangles of `m` whose centroid passes `keep` (shared vertices
 *  are emitted once, winding preserved). */
function cut(m, keep) {
  const { pos, nrm, col, uv, idx } = m;
  const posA = [], nrmA = [], colA = [], uvA = [], idxA = [];
  const seen = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const cx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
    const cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
    const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    if (!keep(cx, cy, cz)) continue;
    for (const v of [a, b, c]) {
      let n = seen.get(v);
      if (n === undefined) {
        n = posA.length / 3; seen.set(v, n);
        posA.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        nrmA.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
        colA.push(col[v * 3], col[v * 3 + 1], col[v * 3 + 2]);
        uvA.push(uv[v * 2], uv[v * 2 + 1]);
      }
      idxA.push(n);
    }
  }
  return geo.mesh(posA, nrmA, colA, uvA, idxA);
}

/**
 * Surface marking: the triangles of `src` (scaled by `grow`, then pushed `off`
 * along their own normals) that fall inside the volume `inside` describes.
 * Paint stays glued to the curved surface instead of floating over it.
 */
function decal(src, grow, inside, col, off = 0.0018) {
  const g = dup(src);
  geo.bake(g, { s: grow });
  const patch = cut(g, inside);
  const p = patch.pos, n = patch.nrm;
  for (let i = 0; i < p.length; i += 3) {
    p[i] += n[i] * off; p[i + 1] += n[i + 1] * off; p[i + 2] += n[i + 2] * off;
  }
  return tint(patch, col);
}

/** Flat band the vertex colours per triangle: `fn(cx,cy,cz)` returns a colour, or
 *  null to keep `fallback`. Gives crisp marking edges a smooth vertex ramp cannot. */
function paintFaces(m, fn, fallback) {
  const { pos, nrm, col, uv, idx } = m;
  const posA = new Float32Array(idx.length * 3), nrmA = new Float32Array(idx.length * 3);
  const colA = new Float32Array(idx.length * 3), uvA = new Float32Array(idx.length * 2);
  const idxA = new Uint32Array(idx.length);
  for (let t = 0; t < idx.length; t += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k];
      cx += pos[v * 3]; cy += pos[v * 3 + 1]; cz += pos[v * 3 + 2];
    }
    const c = fn(cx / 3, cy / 3, cz / 3) || fallback;
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k], o = t + k;
      posA[o * 3] = pos[v * 3]; posA[o * 3 + 1] = pos[v * 3 + 1]; posA[o * 3 + 2] = pos[v * 3 + 2];
      nrmA[o * 3] = nrm[v * 3]; nrmA[o * 3 + 1] = nrm[v * 3 + 1]; nrmA[o * 3 + 2] = nrm[v * 3 + 2];
      colA[o * 3] = c[0]; colA[o * 3 + 1] = c[1]; colA[o * 3 + 2] = c[2];
      uvA[o * 2] = uv[v * 2]; uvA[o * 2 + 1] = uv[v * 2 + 1];
      idxA[o] = o;
    }
  }
  return geo.mesh(posA, nrmA, colA, uvA, idxA);
}

/** Union test over axis-aligned boxes [cx,cy,cz,hx,hy,hz]. */
function inBoxes(x, y, z, boxes, pad = 0) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (Math.abs(x - b[0]) < b[3] + pad && Math.abs(y - b[1]) < b[4] + pad && Math.abs(z - b[2]) < b[5] + pad) return true;
  }
  return false;
}

/** Tapered spike (claw, fur tuft, cheek horn): base at `p`, aimed along `d`. */
function spike(p, d, len, r, flat = 0.6, seg = 6) {
  const m = geo.cylinder(0.0006, r, len, seg, true);
  place(m, [0, len / 2, 0]);
  if (flat !== 1) place(m, null, null, [flat, 1, 1]);
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const dx = d[0] / l, dy = d[1] / l, dz = d[2] / l;
  place(m, null, [Math.acos(clamp(dy, -1, 1)), Math.atan2(dx, dz), 0]);
  return place(m, p);
}

/** Mirror a mesh across x=0 (positions, normals and winding all flip). */
function mirrorX(m) {
  const n = m.pos.length / 3;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
  const col = new Float32Array(m.col), uv = new Float32Array(m.uv);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = -m.pos[i * 3]; pos[i * 3 + 1] = m.pos[i * 3 + 1]; pos[i * 3 + 2] = m.pos[i * 3 + 2];
    nrm[i * 3] = -m.nrm[i * 3]; nrm[i * 3 + 1] = m.nrm[i * 3 + 1]; nrm[i * 3 + 2] = m.nrm[i * 3 + 2];
  }
  const idx = new Uint32Array(m.idx.length);
  for (let i = 0; i < m.idx.length; i += 3) { idx[i] = m.idx[i]; idx[i + 1] = m.idx[i + 2]; idx[i + 2] = m.idx[i + 1]; }
  return geo.mesh(pos, nrm, col, uv, idx);
}

/** Build the +x copy and its mirror image as one mesh. */
function bothSides(m) { return geo.merge(m, mirrorX(m)); }

/** Flat-shade a mesh (per-face normals) so it reads faceted instead of smooth. */
function faceted(m) {
  const tris = m.idx.length / 3;
  const pos = new Float32Array(tris * 9), nrm = new Float32Array(tris * 9);
  const col = new Float32Array(tris * 9), uv = new Float32Array(tris * 6);
  const idx = new Uint32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const a = m.idx[t * 3], b = m.idx[t * 3 + 1], c = m.idx[t * 3 + 2];
    const ax = m.pos[a * 3], ay = m.pos[a * 3 + 1], az = m.pos[a * 3 + 2];
    const ux = m.pos[b * 3] - ax, uy = m.pos[b * 3 + 1] - ay, uz = m.pos[b * 3 + 2] - az;
    const vx = m.pos[c * 3] - ax, vy = m.pos[c * 3 + 1] - ay, vz = m.pos[c * 3 + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    const tri = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const v = tri[k], o = (t * 3 + k);
      pos[o * 3] = m.pos[v * 3]; pos[o * 3 + 1] = m.pos[v * 3 + 1]; pos[o * 3 + 2] = m.pos[v * 3 + 2];
      nrm[o * 3] = nx; nrm[o * 3 + 1] = ny; nrm[o * 3 + 2] = nz;
      col[o * 3] = m.col[v * 3]; col[o * 3 + 1] = m.col[v * 3 + 1]; col[o * 3 + 2] = m.col[v * 3 + 2];
      uv[o * 2] = m.uv[v * 2]; uv[o * 2 + 1] = m.uv[v * 2 + 1];
      idx[o] = o;
    }
  }
  return geo.mesh(pos, nrm, col, uv, idx);
}

/**
 * Curved double-sided blade — palm frond / Exeggutor frond. The spine rises along
 * +Y and droops forward in +Z by `curl`; the width swells then tapers to a point,
 * and the midrib is lifted into a shallow V so the blade catches the toon ramp
 * instead of reading as a flat quad.
 */
function blade(len, wide, curl = 0.4, fold = 0.25, seg = 7) {
  const posA = [], nrmA = [], colA = [], uvA = [], idxA = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const hw = wide * Math.sin(Math.PI * Math.pow(t, 0.68)) * (1 - 0.30 * t);
    const y = len * t, z = curl * len * t * t;
    const lift = hw * fold;
    posA.push(-hw, y, z, 0, y + lift * 0.34, z + lift, hw, y, z);
    uvA.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i <= seg; i++) nrmA.push(0, 0, 0, 0, 0, 0, 0, 0, 0);
  for (let i = 0; i < seg; i++) {
    const a = i * 3, b = a + 3;
    idxA.push(a, a + 1, b + 1, a, b + 1, b, a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
  }
  const m = geo.mesh(posA, nrmA, colA, uvA, idxA);
  return renorm(tidy(m));
}

/**
 * Swept tube with thin ring seams: every band carries a narrow pair of seam rings
 * sunk by `depth`, so the joint reads as an inked scar line (the Exeggutor's
 * segmentation, a palm's leaf scars) instead of a fat painted stripe.
 * The path must stay planar in Y/Z — the ring frame uses world X as its reference.
 */
function ringedTube(opts) {
  const {
    u0 = 0, u1 = 1, seg = 16, bands = 10, seamW = 0.05, depth = 0.04,
    path, radius, body = [1, 1, 1], seam = [0.7, 0.7, 0.7], tone = null,
    rScale = 1, capStart = false,
  } = opts;
  const rings = [];
  const step = (u1 - u0) / bands;
  for (let b = 0; b < bands; b++) {
    const ub = u0 + step * b, w = step * seamW;
    rings.push([ub, 1, body], [ub + w, 1 - depth, seam], [ub + 2 * w, 1 - depth, seam]);
  }
  rings.push([u1, 1, body]);

  const posA = [], nrmA = [], colA = [], uvA = [], idxA = [];
  const eps = Math.max(1e-4, (u1 - u0) * 0.002);
  for (let i = 0; i < rings.length; i++) {
    const [u, rf, col] = rings[i];
    const p = path(u);
    const pa = path(Math.max(u0 - eps, u - eps)), pb = path(Math.min(u1 + eps, u + eps));
    let tx = pb[0] - pa[0], ty = pb[1] - pa[1], tz = pb[2] - pa[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let sx = -tz, sy = 0, sz = ty;                       // (1,0,0) x tangent
    const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    const bx = ty * sz - tz * sy, by = tz * sx - tx * sz, bz = tx * sy - ty * sx;
    const r = radius(u) * rf * rScale;
    const k = tone ? tone(u) : 1;
    const base = i * (seg + 1);
    for (let j = 0; j <= seg; j++) {
      const th = 2 * Math.PI * j / seg, cs = Math.cos(th), sn = Math.sin(th);
      const nx = sx * cs + bx * sn, ny = sy * cs + by * sn, nz = sz * cs + bz * sn;
      posA.push(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r);
      nrmA.push(nx, ny, nz);
      colA.push(col[0] * k, col[1] * k, col[2] * k);
      uvA.push(j / seg, i / (rings.length - 1));
    }
    if (i > 0) {
      const prev = base - (seg + 1);
      for (let j = 0; j < seg; j++) {
        idxA.push(prev + j, base + j, prev + j + 1, prev + j + 1, base + j, base + j + 1);
      }
    }
  }
  if (capStart) {
    const [u, , col] = rings[0];
    const p = path(u), r = radius(u) * rScale, c = posA.length / 3;
    posA.push(p[0], p[1], p[2]); nrmA.push(0, -1, 0); uvA.push(0.5, 0.5);
    for (let j = 0; j <= seg; j++) {
      const th = 2 * Math.PI * j / seg;
      posA.push(p[0] + Math.cos(th) * r, p[1], p[2] + Math.sin(th) * r);
      nrmA.push(0, -1, 0); uvA.push(0.5 + Math.cos(th) * 0.5, 0.5 + Math.sin(th) * 0.5);
    }
    for (let j = 0; j <= seg; j++) colA.push(col[0], col[1], col[2]);
    for (let j = 0; j < seg; j++) idxA.push(c, c + 1 + j + 1, c + 1 + j);
  }
  return geo.mesh(posA, nrmA, colA, uvA, idxA);
}

/* ---------------------------------------------------------------- rig kit */

const _rootM = new Float32Array(16);
const _tA = new Float32Array(16);
const _tB = new Float32Array(16);
const _tC = new Float32Array(16);
const _scanM = new Float32Array(16);
const IDENT = M.id();

function translation(v, out) { out.set(IDENT); out[12] = v[0]; out[13] = v[1]; out[14] = v[2]; return out; }

/** matrix for one bone offset: T(pivot) · T(p) R(r) S(s) · T(-pivot) */
function boneMatrix(spec, pivot, out) {
  const p = (spec && spec.p) || Z3;
  const r = (spec && spec.r) || Z3;
  const s = spec && spec.s != null ? spec.s : 1;
  M.compose(p, r, s, out);
  if (pivot) {
    translation(pivot, _tA);
    _tA[12] = -pivot[0]; _tA[13] = -pivot[1]; _tA[14] = -pivot[2];
    translation(pivot, _tB);
    M.mul(_tB, out, _tC);        // T(P) · M
    M.mul(_tC, _tA, out);        // … · T(-P)
  }
  return out;
}

/** mat4 -> translation / euler (Rz·Ry·Rx) / scale, written into preallocated arrays. */
function decompose(m, p, r, s) {
  p[0] = m[12]; p[1] = m[13]; p[2] = m[14];
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  s[0] = sx; s[1] = sy; s[2] = sz;
  const m20 = clamp(m[2] / sx, -1, 1), m21 = m[6] / sy, m22 = m[10] / sz;
  const m10 = m[1] / sx, m00 = m[0] / sx;
  r[1] = Math.asin(-m20);
  r[0] = Math.atan2(m21, m22);
  r[2] = Math.atan2(m10, m00);
}

/** Declare a model's bones; parents must appear before their children. */
function rig(model, bones) {
  model._bones = {};
  model._order = [];
  model._root = { p: new Float32Array(3), r: new Float32Array(3), s: new Float32Array([1, 1, 1]) };
  for (const b of bones) {
    const slot = {
      name: b.name, pivot: b.pivot || null, parent: b.parent || null,
      off: new Float32Array(16), m: new Float32Array(16), world: new Float32Array(16),
      p: new Float32Array(3), r: new Float32Array(3), s: new Float32Array([1, 1, 1]),
    };
    model._bones[b.name] = slot;
    model._order.push(slot);
  }
  for (const p of model.parts) if (p.bone && !model._bones[p.bone]) p.bone = null;
  return model;
}

/** Apply a pose (any subset of bones + `alpha`) to every part of the model. */
function pose(model, P) {
  const root = P.root || {};
  boneMatrix(root, null, _rootM);
  for (const slot of model._order) {
    boneMatrix(P[slot.name], slot.pivot, slot.off);
    if (slot.parent) M.mul(model._bones[slot.parent].m, slot.off, slot.m);
    else slot.m.set(slot.off);
    M.mul(_rootM, slot.m, slot.world);
    decompose(slot.world, slot.p, slot.r, slot.s);
  }
  decompose(_rootM, model._root.p, model._root.r, model._root.s);
  const al = P.alpha != null ? P.alpha : 1;
  for (const p of model.parts) {
    const slot = p.bone ? model._bones[p.bone] : model._root;
    p.p = slot.p; p.r = slot.r; p.s = slot.s;
    p.alpha = al;
  }
}

/** Walk every vertex of the model in model space (parts may carry a transform). */
function eachVertex(model, fn) {
  const m = _scanM;
  for (const p of model.parts) {
    M.compose(p.p || Z3, p.r || Z3, p.s != null ? p.s : 1, m);
    const v = p.geo.pos;
    for (let i = 0; i < v.length; i += 3) {
      fn(m[0] * v[i] + m[4] * v[i + 1] + m[8] * v[i + 2] + m[12],
         m[1] * v[i] + m[5] * v[i + 1] + m[9] * v[i + 2] + m[13],
         m[2] * v[i] + m[6] * v[i + 1] + m[10] * v[i + 2] + m[14]);
    }
  }
}

/** Remove zero-area triangles and repair zero-length normals (geo.blob leaves one
 *  at its north pole; geo.leaf leaves a sliver at the blade base) so no part
 *  carries a degenerate vertex into the draw call. */
function tidy(m) {
  const idx = m.idx;
  let keep = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = m.pos[b] - m.pos[a], uy = m.pos[b + 1] - m.pos[a + 1], uz = m.pos[b + 2] - m.pos[a + 2];
    const vx = m.pos[c] - m.pos[a], vy = m.pos[c + 1] - m.pos[a + 1], vz = m.pos[c + 2] - m.pos[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz > 1e-18) { idx[keep++] = idx[t]; idx[keep++] = idx[t + 1]; idx[keep++] = idx[t + 2]; }
  }
  const out = keep === idx.length ? m : geo.mesh(m.pos, m.nrm, m.col, m.uv, idx.slice(0, keep));
  const nrm = out.nrm;
  for (let k = 0; k < nrm.length / 3; k++) {
    if (Math.hypot(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]) > 1e-6) continue;
    const px = out.pos[k * 3], py = out.pos[k * 3 + 1], pz = out.pos[k * 3 + 2];
    const pl = Math.hypot(px, py, pz);
    if (pl > 1e-6) { nrm[k * 3] = px / pl; nrm[k * 3 + 1] = py / pl; nrm[k * 3 + 2] = pz / pl; }
    else nrm[k * 3 + 1] = 1;
  }
  return out;
}

/** Drop the model onto y=0 and publish height / ground-contact radius. */
function settle(model) {
  for (const p of model.parts) p.geo = tidy(p.geo);
  let minY = Infinity, maxY = -Infinity;
  eachVertex(model, (x, y, z) => { if (y < minY) minY = y; if (y > maxY) maxY = y; });
  if (Math.abs(minY) > 0.0015) {
    const dy = -minY;
    for (const p of model.parts) {
      geo.bake(p.geo, { p: [0, dy, 0] });
      if (p.p) p.p[1] += dy;
    }
    if (model._bones) for (const k in model._bones) {
      const b = model._bones[k];
      if (b.pivot) b.pivot = [b.pivot[0], b.pivot[1] + dy, b.pivot[2]];
    }
    maxY += dy; minY = 0;
  }
  // ground-contact footprint: the radius where the model's lowest sliver actually
  // touches down (the mode of the low band), so a model's shadow hugs its base
  // instead of being dragged out by a drooping tail frond or whisker.
  const band = Math.min(0.35, (maxY - minY) * 0.08);
  const lows = [];
  let hull = 0;
  eachVertex(model, (x, y, z) => {
    const r = Math.hypot(x, z);
    if (r > hull) hull = r;
    if (y < minY + band) lows.push(r);
  });
  const BUCKET = 0.05;
  const counts = new Map();
  for (const r of lows) {
    const b = Math.round(r / BUCKET);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  let best = 0, bestN = 0;
  for (const [b, n] of counts) if (n > bestN || (n === bestN && b > best)) { bestN = n; best = b; }
  model.height = maxY - minY;
  model.hull = hull;
  model.shadowR = Math.max(0.06, best * BUCKET * 1.8);
  return model;
}

/* -------------------------------------------------- shared battler anims */

const ANIM_DUR = { enter: 0.62, attack: 0.58, hit: 0.5, faint: 1.05, recall: 0.55, flee: 0.55, victory: 1.4 };
const easeOutBack = k => { const c = 1.7, k1 = k - 1; return 1 + (c + 1) * k1 * k1 * k1 + c * k1 * k1; };
const bump = k => Math.sin(Math.PI * clamp(k, 0, 1));

/**
 * One pose for every battler. Layered: a loop-safe idle base, then the action.
 * cfg: { lunge, topple, toppleSign, lift, lean, neck, crown, dur }
 * Bones: root · head · neck · crown · tail · flame (models only declare what they use).
 */
function battlerPose(a, t, cfg = {}) {
  const name = (a && a.name) || 'idle';
  const at = (a && a.t) || 0;
  const lunge = cfg.lunge != null ? cfg.lunge : 0.3;
  const topple = cfg.topple != null ? cfg.topple : 1.35;
  const sign = cfg.toppleSign != null ? cfg.toppleSign : 1;
  const lift = cfg.lift != null ? cfg.lift : 0.06;
  const dur = cfg.dur || ANIM_DUR[name] || 0.6;

  const root = { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
  const head = { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
  const neck = { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
  const crown = { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
  const tail = { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
  const flame = { p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };
  const out = { root, head, neck, crown, tail, flame, alpha: 1 };

  // --- idle base: breathing (scale about the feet => paws never leave y=0)
  const br = Math.sin(t * 2.05), br2 = Math.sin(t * 2.05 + 1.3);
  root.s = [1 - 0.008 * br, 1 + 0.014 * br, 1 - 0.007 * br];
  root.r = [0, 0.02 * Math.sin(t * 0.57), 0.011 * Math.sin(t * 0.93)];
  root.p = [0, 0, 0.004 * br2];
  head.r = [0.022 * Math.sin(t * 1.6 + 0.5), 0.06 * Math.sin(t * 0.47), 0.03 * Math.sin(t * 0.9)];
  tail.r = [0.05 * Math.sin(t * 1.25), 0, 0.10 * Math.sin(t * 0.85)];
  const flick = 1 + 0.15 * Math.sin(t * 9.1) + 0.075 * Math.sin(t * 14.6 + 1.4);
  flame.s = [1 + 0.08 * Math.sin(t * 7.3 + 0.7), flick, 1 + 0.08 * Math.sin(t * 11.1)];
  flame.r = [0.06 * Math.sin(t * 8.2), 0, 0.07 * Math.sin(t * 6.4)];

  if (name === 'enter') {
    const k = clamp(at / dur, 0, 1);
    const s = Math.max(0.02, 0.05 + 0.95 * clamp(easeOutBack(k), 0, 1.08));
    const land = bump(clamp((k - 0.55) / 0.45, 0, 1)) * 0.08;
    root.s = [s * (1 + land * 0.5), s * (1 - land), s * (1 + land * 0.5)];
    root.p[2] = -0.03 * (1 - k);
    head.r = [head.r[0] - 0.12 * (1 - k), head.r[1], head.r[2]];
    flame.s[1] *= 1 + 0.6 * (1 - k);
  } else if (name === 'attack') {
    const k = clamp(at / dur, 0, 1);
    const b = bump(Math.pow(k, 0.8));
    root.p[2] = root.p[2] + lunge * b;
    root.r = [root.r[0] + (cfg.lean || 0.07) * b, root.r[1], root.r[2]];
    root.s = [1 - 0.05 * b, 1 + 0.02 * b, 1 + 0.09 * b];
    head.r = [head.r[0] + 0.14 * b, head.r[1] * (1 - 0.6 * b), head.r[2]];
    neck.r = [(cfg.neck || 0.34) * b, 0, 0];
    crown.r = [(cfg.crown || 0.14) * b, 0, 0];
    tail.r = [tail.r[0], 0, tail.r[2] - 0.25 * b];
    flame.s = [flame.s[0] * (1 + 0.5 * b), flame.s[1] * (1 + 0.8 * b), flame.s[2] * (1 + 0.5 * b)];
  } else if (name === 'hit') {
    const k = clamp(at / dur, 0, 1);
    const b = bump(k);
    const sh = Math.sin(k * Math.PI * 7) * (1 - k);
    root.p[2] -= 0.35 * lunge * b;
    root.r = [root.r[0] - 0.06 * b, root.r[1] + 0.08 * sh, root.r[2] + 0.06 * sh];
    root.s = [1 + 0.05 * b, 1 - 0.06 * b, 1 + 0.05 * b];
    head.r = [head.r[0] - 0.24 * b, head.r[1] + 0.16 * sh, head.r[2] + 0.12 * sh];
    neck.r = [-0.25 * b, 0, 0];
    tail.r = [tail.r[0] + 0.3 * b, 0, tail.r[2]];
    flame.s = [flame.s[0] * (1 - 0.4 * b), flame.s[1] * Math.max(0.2, 1 - 0.7 * b), flame.s[2] * (1 - 0.4 * b)];
  } else if (name === 'faint') {
    const k = clamp(at / dur, 0, 1);
    const e = 1 - Math.pow(1 - k, 2.4);
    const wob = Math.exp(-k * 5) * Math.sin(k * 15) * 0.09;
    const ang = topple * e + wob;
    root.r = [0, 0, ang * sign];
    root.p[1] = lift * e;
    root.p[2] = -0.04 * e + root.p[2];
    head.r = [head.r[0] + 0.3 * e, head.r[1] - 0.35 * e * sign, head.r[2]];
    neck.r = [0.35 * e, 0, 0];
    crown.r = [0.5 * e, 0, 0.2 * e * sign];
    tail.r = [tail.r[0], 0, tail.r[2] + 0.4 * e];
    flame.s[1] *= Math.max(0.15, 1 - e);
  } else if (name === 'recall' || name === 'flee') {
    const k = clamp(at / dur, 0, 1);
    const e = k * k;
    const s = Math.max(0.02, 1 - 0.98 * e);
    root.s = [s, s, s];
    root.p[1] = 0.32 * e;
    root.r = [0, (name === 'flee' ? 0.9 : 0) * e, 0];
    out.alpha = clamp(1 - Math.pow(k, 1.6), 0, 1);
  } else if (name === 'victory') {
    const pulse = Math.max(0, Math.sin(at * 5.4)) * Math.exp(-at * 0.55);
    root.s = [1 + 0.07 * pulse, 1 - 0.11 * pulse, 1 + 0.07 * pulse];
    head.r = [head.r[0] - 0.22 * pulse, head.r[1], head.r[2]];
    tail.r = [tail.r[0], 0, tail.r[2] - 0.3 * pulse];
    flame.s = [flame.s[0] * (1 + 0.6 * pulse), flame.s[1] * (1 + 1.1 * pulse), flame.s[2] * (1 + 0.6 * pulse)];
  }
  return out;
}

/* ================================================================ Litten */

// Palette read off HOME0725 + the official artwork: a charcoal BLUE-slate body
// (never jet black), vermilion markings, a pure-yellow eye. Values are albedo —
// the toon ramp lands the lit faces on the reference's screen colour.
const LIT = {
  fur:   [0.137, 0.177, 0.216],   // #384858 on a lit flank
  furL:  [0.186, 0.228, 0.270],   // lit back / crown / shoulder tops
  furD:  [0.090, 0.122, 0.152],   // jaw, belly, paw undersides
  paw:   [0.120, 0.155, 0.192],   // paws read a shade lighter than the leg shadow
  tuft:  [0.046, 0.054, 0.068],   // tail tuft: the one near-black on the model
  red:   [0.608, 0.196, 0.157],   // #F85040 markings
  redD:  [0.430, 0.128, 0.104],
  eye:   [0.606, 0.556, 0.010],   // #F7E304 iris
  pup:   [0.018, 0.020, 0.026],
  inner: [0.560, 0.548, 0.552],   // pale inner-ear fur
  nose:  [0.235, 0.076, 0.084],
  mouth: [0.140, 0.048, 0.054],
};

const LIT_HEAD = [0, 0.290, 0.182];

/**
 * Litten's skull — a cat head, not a sphere: the cheeks flare on the whisker
 * line, the jaw tucks in below them, the brow flattens into the mask plane and
 * the muzzle pushes forward off the front-bottom of the ball.
 * Authored about its own centre; the mask is cut from this same surface.
 */
function litSkull() {
  const m = geo.blob(1, 26, 18, 0.022, 7);
  const p = m.pos;
  for (let i = 0; i < p.length; i += 3) {
    const x0 = p[i], y0 = p[i + 1], z0 = p[i + 2];
    const jaw = clamp(-y0, 0, 1);                       // 0 at the brow, 1 at the chin
    let x = x0 * 0.090 * (1 - 0.30 * jaw * jaw);        // cheeks wide, jaw tucked
    let y = y0 * 0.079;
    let z = z0 * 0.076;
    const fz = clamp(z0, 0, 1);                         // 1 on the face, 0 at the nape
    z += 0.030 * fz * (1 - 0.42 * jaw);                 // muzzle forward
    y -= 0.012 * jaw * fz;                              // jaw drops at the front
    const pad = Math.exp(-Math.pow((y0 + 0.30) / 0.34, 2)) * fz;   // whisker-line cheek pad
    x *= 1 + 0.22 * pad;
    y += 0.009 * pad;
    p[i] = x; p[i + 1] = y; p[i + 2] = z;
  }
  return renorm(tidy(m));
}

/** The red "mask": brow bar with raised outer points, a stripe down the face, a
 *  cross-bar under the eyes and the muzzle — painted on, not stacked as a slab. */
function litMask(skull) {
  const B = [
    [0.000, 0.006, 0.056, 0.015, 0.058, 0.044],   // vertical stripe down the face
    [0.000, 0.046, 0.046, 0.060, 0.014, 0.052],   // brow bar
    [0.052, 0.064, 0.040, 0.021, 0.016, 0.052],   // brow bar's raised outer points
    [0.000, -0.014, 0.062, 0.066, 0.013, 0.046],  // cross-bar below the eyes
    [0.062, -0.002, 0.054, 0.020, 0.014, 0.046],  // cross-bar's swept outer tips
    [0.000, -0.054, 0.092, 0.040, 0.038, 0.042],  // muzzle + chin
    [0.000, 0.074, 0.020, 0.017, 0.030, 0.056],   // forehead spike over the crown
  ];
  return decal(skull, 1.012, (x, y, z) => z > 0.004 && inBoxes(x, y, z, B), LIT.red, 0.0016);
}

/** One Litten eye: dark rim, yellow almond lens, black slit pupil, white glint.
 *  The rim is geometry, not an outline-pass hull — a 12 mm hull on a 30 mm eye
 *  would swallow the iris. Local to the head. */
function litEye(sx) {
  const q = [0, sx * 0.32, -sx * 0.20];
  const at = (p, s, c) => tint(place(geo.sphere(1, 14, 10), p, q, s), c);
  return geo.merge(
    at([sx * 0.0465, 0.0305, 0.0600], [0.0322, 0.0290, 0.0170], LIT.pup),   // rim
    at([sx * 0.0465, 0.0305, 0.0638], [0.0292, 0.0260, 0.0160], LIT.eye),   // lens
    at([sx * 0.0420, 0.0290, 0.0755], [0.0054, 0.0152, 0.0056], LIT.pup),   // slit pupil
    at([sx * 0.0560, 0.0392, 0.0716], [0.0050, 0.0050, 0.0036], [0.92, 0.93, 0.90]),
    at([sx * 0.0465, 0.0492, 0.0668], [0.0300, 0.0072, 0.0132], LIT.redD),  // red upper lip
  );
}

export function makeLitten() {
  const parts = [];

  // --- torso: low cat crouch — rump high, chest dipped, shoulders slipped forward
  const spine = [
    [0, 0.180, -0.150], [0, 0.186, -0.110], [0, 0.184, -0.064], [0, 0.176, -0.018],
    [0, 0.168, 0.028], [0, 0.159, 0.072], [0, 0.154, 0.112],
  ];
  const torso = geo.tube(spine, [0.050, 0.068, 0.080, 0.086, 0.088, 0.084, 0.072], 14, true);
  place(torso, null, null, [0.94, 0.98, 1]);
  renorm(torso);

  const haunch = place(ellip(0.056, 0.072, 0.082, 16, 12, 0.04, 5), [0.062, 0.142, -0.078]);
  const shoulder = place(ellip(0.050, 0.058, 0.060, 14, 11, 0.04, 9), [0.050, 0.158, 0.070]);
  const neck = geo.tube([[0, 0.150, 0.104], [0, 0.206, 0.148], [0, 0.252, 0.174]],
                        [0.068, 0.058, 0.050], 12, false);
  renorm(neck);

  const body = geo.merge(torso, bothSides(geo.merge(haunch, shoulder)), neck);
  tint(body, (x, y) => {
    const up = clamp((y - 0.088) / 0.110, 0, 1);
    const under = clamp((0.104 - y) / 0.070, 0, 1);
    return mix(mix(LIT.fur, LIT.furL, up), LIT.furD, under * 0.85);
  });
  parts.push(part(body));

  // --- head: skull + mask + muzzle + cheek horns + ears, one draw call
  const skull = litSkull();
  const snout = renorm(place(ellip(0.046, 0.032, 0.030, 14, 11, 0.05, 11), [0, -0.030, 0.086]));
  const nose = place(ellip(0.0135, 0.0090, 0.0100, 10, 7, 0.03, 13), [0, -0.018, 0.116]);
  const mouth = place(ellip(0.020, 0.0054, 0.0075, 10, 7, 0.03, 19), [0, -0.048, 0.106], [0.34, 0, 0]);

  const cheek = [];
  for (const sx of [-1, 1]) {
    cheek.push(spike([sx * 0.086, -0.022, 0.024], [sx * 1, -0.36, -0.30], 0.056, 0.0165, 0.55));
    cheek.push(spike([sx * 0.080, 0.000, 0.028], [sx * 1, 0.10, -0.34], 0.062, 0.0150, 0.55));
  }
  const crest = spike([0, 0.070, 0.034], [0, 1, -0.24], 0.038, 0.017, 0.45);

  const earOut = place(geo.cone(0.044, 0.104, 7), [0.052, 0.074, -0.026], [-0.20, 0, -0.30], [1, 1, 0.46]);
  const earIn = place(geo.cone(0.030, 0.072, 6), [0.055, 0.066, -0.011], [-0.20, 0, -0.30], [1, 1, 0.34]);

  const headGroup = geo.merge(
    skull, litMask(skull), snout, nose,
    tint(mouth, LIT.mouth),
    tint(geo.merge(...cheek, crest), LIT.red),
    tint(bothSides(earOut), LIT.fur),
    tint(bothSides(earIn), LIT.inner),
  );
  place(headGroup, LIT_HEAD);
  parts.push(part(headGroup, WHITE, { bone: 'head' }));

  const eyes = place(geo.merge(litEye(1), litEye(-1)), LIT_HEAD);
  parts.push(part(eyes, WHITE, { bone: 'head', emis: 0.22, outline: false }));

  // --- legs: red bands on the FRONT pair only; dark paws with stubby toes
  const leg = (P0, P1, P2, bands) => {
    const pts = [], rad = [];
    for (let i = 0; i <= 12; i++) {
      const u = i / 12, v = 1 - u;
      pts.push([v * v * P0[0] + 2 * v * u * P1[0] + u * u * P2[0],
                v * v * P0[1] + 2 * v * u * P1[1] + u * u * P2[1],
                v * v * P0[2] + 2 * v * u * P1[2] + u * u * P2[2]]);
      rad.push(0.036 - 0.013 * u);
    }
    const t = renorm(geo.tube(pts, rad, 10, true));
    return paintFaces(t, (x, y) => (bands.some(b => y > b[0] && y < b[1]) ? LIT.red : null), LIT.fur);
  };
  const paw = (px, pz) => {
    const pad = tint(place(ellip(0.029, 0.018, 0.037, 12, 9, 0.04, 21), [px, 0.018, pz]),
                     (x, y) => mix(LIT.paw, LIT.furD, clamp((0.020 - y) / 0.020, 0, 1)));
    const toes = [];
    for (let i = -1; i <= 1; i++) {
      toes.push(place(ellip(0.0115, 0.0125, 0.017, 9, 7, 0.03, 31 + i),
                      [px + i * 0.0165, 0.014, pz + 0.028]));
    }
    return geo.merge(pad, tint(geo.merge(...toes), LIT.paw));
  };

  const fore = leg([0.052, 0.172, 0.056], [0.074, 0.098, 0.104], [0.064, 0.022, 0.146],
                   [[0.085, 0.110], [0.039, 0.060]]);
  const hind = leg([0.066, 0.150, -0.056], [0.086, 0.086, -0.100], [0.072, 0.022, -0.068], []);
  parts.push(part(bothSides(geo.merge(fore, paw(0.064, 0.150)))));
  parts.push(part(bothSides(geo.merge(hind, paw(0.072, -0.068)))));

  // --- tail: long dark curve, red band at the base, 3-pointed black FUR TUFT.
  //     No fire on the model — the flame belongs to the move VFX.
  const tailPts = [[0, 0.176, -0.146], [0, 0.234, -0.194], [0, 0.294, -0.216],
                   [0, 0.348, -0.208], [0, 0.388, -0.184]];
  const tail = renorm(geo.tube(tailPts, [0.026, 0.022, 0.019, 0.016, 0.013], 10, false));
  tint(tail, (x, y) => (y < 0.212 ? LIT.red : (y > 0.352 ? LIT.tuft : LIT.fur)));

  const tuftBase = [0, 0.392, -0.181];
  const tuft = tint(geo.merge(
    spike(tuftBase, [0.34, 0.90, -0.42], 0.058, 0.0145, 0.5),
    spike(tuftBase, [-0.30, 0.92, -0.50], 0.052, 0.0135, 0.5),
    spike(tuftBase, [0, 0.50, -1.00], 0.052, 0.0135, 0.5),
    spike(tuftBase, [0, 0.98, -0.16], 0.056, 0.0130, 0.5),
  ), LIT.tuft);
  parts.push(part(geo.merge(tail, tuft), WHITE, { bone: 'tail' }));

  const model = { parts };
  rig(model, [
    { name: 'head', pivot: [0, 0.244, 0.166] },
    { name: 'tail', pivot: [0, 0.176, -0.146] },
  ]);
  model.update = function (dt, t, state, entity) {
    pose(this, battlerPose(entity.anim, t, { lunge: 0.34, topple: 1.42, lift: 0.055 }));
    if (entity.shadow && entity.shadow.r !== this.shadowR) entity.shadow.r = this.shadowR;
  };
  return settle(model);
}

/* =============================================================== Popplio */

export function makePopplio() {
  const parts = [];
  const BLUE = [0.22, 0.50, 0.88], BLUE_D = [0.16, 0.38, 0.76], CREAM = [0.95, 0.95, 0.97],
        PINK = [0.98, 0.62, 0.68], EYE = [0.09, 0.10, 0.20], GLINT = [1, 1, 1];

  // body: pear-shaped, belly forward
  const body = place(ellip(0.098, 0.108, 0.118, 18, 13, 0.05, 13), [0, 0.152, -0.008]);
  tint(body, (x, y, z) => (z > 0.03 && y < 0.185 ? CREAM : (y < 0.10 ? BLUE_D : BLUE)));
  parts.push(part(body));

  // ruff: two stacked collars plus scallops, sitting above the body as a collar
  const ruffParts = [];
  const r1 = place(geo.torus(0.100, 0.032, 18, 8), [0, 0.252, 0.004], [Math.PI / 2, 0, 0]);
  tint(r1, CREAM);
  const r2 = place(geo.torus(0.086, 0.028, 18, 8), [0, 0.286, 0.004], [Math.PI / 2, 0, 0]);
  tint(r2, [0.92, 0.94, 0.98]);
  ruffParts.push(r1, r2);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const s = place(ellip(0.028, 0.032, 0.028, 10, 8, 0.06, 40 + i),
                    [Math.sin(a) * 0.104, 0.266, Math.cos(a) * 0.104]);
    tint(s, CREAM);
    ruffParts.push(s);
  }
  parts.push(part(geo.merge(...ruffParts)));

  // head
  const head = place(ellip(0.078, 0.076, 0.078, 18, 13, 0.04, 17), [0, 0.318, 0.012]);
  tint(head, (x, y, z) => (z > 0.045 ? CREAM : BLUE));
  parts.push(part(head, WHITE, { bone: 'head' }));

  const nose = place(ellip(0.026, 0.024, 0.024, 12, 9, 0.03, 19), [0, 0.325, 0.088]);
  tint(nose, PINK);
  parts.push(part(nose, WHITE, { bone: 'head' }));

  const eyeMesh = (cx) => {
    const e = place(geo.sphere(1, 12, 9), [cx, 0.336, 0.062], null, [0.022, 0.026, 0.019]);
    tint(e, EYE);
    const g = place(ellip(0.005, 0.006, 0.005, 8, 6, 0.02, 27), [cx + 0.008, 0.345, 0.074]);
    tint(g, GLINT);
    return geo.merge(e, g);
  };
  parts.push(part(geo.merge(eyeMesh(0.040), eyeMesh(-0.040)), WHITE, { bone: 'head', emis: 0.12 }));

  // front flippers: flat blades angled out and down, white tips
  const flip = place(geo.leaf(0.155, 0.062, 0.03, 5, 0.35), [0.085, 0.152, 0.012], [0, 0, -2.05]);
  tint(flip, (x, y, z) => (y > 0.10 ? CREAM : BLUE));
  parts.push(part(bothSides(flip), WHITE, { doubleSided: true }));

  // tail fin + hind flippers
  const tailFin = place(geo.leaf(0.13, 0.085, 0.02, 4, 0.5), [0, 0.088, -0.100], [0, 0, Math.PI + 0.5]);
  tint(tailFin, (x, y, z) => (y > 0.09 ? CREAM : BLUE));
  const tailFin2 = mirrorX(tailFin);
  const hind = place(ellip(0.030, 0.014, 0.040, 10, 7, 0.06, 33), [0.055, 0.020, -0.070]);
  tint(hind, BLUE);
  parts.push(part(geo.merge(tailFin, tailFin2), WHITE, { doubleSided: true, bone: 'tail' }));
  parts.push(part(bothSides(hind)));

  const model = { parts };
  rig(model, [
    { name: 'head', pivot: [0, 0.272, 0.008] },
    { name: 'tail', pivot: [0, 0.100, -0.090] },
  ]);
  model.update = function (dt, t, state, entity) {
    pose(this, battlerPose(entity.anim, t, { lunge: 0.30, topple: 1.40, lift: 0.05, neck: 0.2 }));
    if (entity.shadow && entity.shadow.r !== this.shadowR) entity.shadow.r = this.shadowR;
  };
  return settle(model);
}

/* ====================================================== Alolan Exeggutor */

// Battle scale: ~4 m from the bulb's base to the top of the frond fan, so a
// 0.45 m ally can share the frame with a legible head cluster (Gen VII
// battle-scales tall species the same way). Palette off HOME0103A: the whole
// trunk is BROWN — only the coconuts are cream.
const EX = {
  trunk:  [0.470, 0.352, 0.255],   // #C89870 on a lit face
  trunkD: [0.315, 0.228, 0.160],   // ring seams + shaded flanks
  cream:  [0.548, 0.529, 0.338],   // #E0D88A coconut
  creamD: [0.392, 0.376, 0.228],
  leaf:   [0.169, 0.351, 0.113],   // #458F2E frond
  leafL:  [0.255, 0.480, 0.152],
  claw:   [0.610, 0.600, 0.570],
  mouth:  [0.318, 0.108, 0.092],
  tongue: [0.620, 0.320, 0.290],
  eye:    [0.055, 0.042, 0.042],
  unripe: [0.400, 0.462, 0.286],   // the rear stub's coconut is still green
};

const EX_BASE = 0.30;                       // centreline height of the trunk's root
const EX_H = 2.55;                          // neck climb, base -> crown knot
const EX_KNOT = [0, EX_BASE + EX_H, 0.16];  // crown knot: heads + frond fan sit here

/** Trunk centreline: near-straight, tipping forward a little as it rises. */
function exPath(u) { return [0, EX_BASE + EX_H * u, 0.16 * u * u]; }

/** Fat bulbous base, long thin neck — the canonical Alolan silhouette. */
function exRadius(u) {
  const K = [[0, 0.315], [0.055, 0.400], [0.14, 0.386], [0.26, 0.330], [0.40, 0.268],
             [0.55, 0.219], [0.72, 0.181], [0.86, 0.163], [1, 0.150]];
  for (let i = 1; i < K.length; i++) {
    if (u <= K[i][0]) {
      const k = (u - K[i - 1][0]) / (K[i][0] - K[i - 1][0]);
      return K[i - 1][1] + (K[i][1] - K[i - 1][1]) * k;
    }
  }
  return K[K.length - 1][1];
}

/**
 * One coconut head: a cream skull with a wide open mouth (dark rim, salmon
 * interior, pale lower lip) and two dot eyes. Reading as a face at battle
 * distance is the whole point — the old cluster was a faceless blob.
 * The mouth and eyes are paint cut from the skull's own surface, so they stay
 * glued to the curve instead of hovering as decals.
 */
function exeggutorHead(r, seed = 5, skin = null) {
  const base = skin || [EX.cream, EX.creamD];
  const skull = renorm(geo.blob(r, 18, 14, 0.03, seed));
  const mouthOf = (x, y, z, k) => Math.hypot(x / r, (y / r + 0.26) / 0.62) < k * 0.52;
  const eyeOf = (x, y, z, sx, k) => Math.hypot(x / r - sx * 0.44, (y / r - 0.34) / 0.86) < k * 0.20;
  const m = [
    tint(skull, (x, y) => mix(base[1], base[0], 0.45 + 0.55 * clamp((y / r) * 0.5 + 0.5, 0, 1))),
    decal(skull, 1.010, (x, y, z) => z / r > 0.30 && mouthOf(x, y, z, 1), EX.mouth, 0),
    decal(skull, 1.032, (x, y, z) => z / r > 0.30 && mouthOf(x, y, z, 0.78), EX.tongue, 0),
    decal(skull, 1.022, (x, y, z) => z / r > 0.30 && eyeOf(x, y, z, 1, 1), EX.eye, 0),
    decal(skull, 1.022, (x, y, z) => z / r > 0.30 && eyeOf(x, y, z, -1, 1), EX.eye, 0),
  ];
  // lower lip: a pale bump under the mouth, so the jaw reads as open and not flat
  m.push(tint(place(geo.sphere(1, 10, 7), [0, -0.545 * r, 0.70 * r], null, [0.30 * r, 0.09 * r, 0.22 * r]), base[0]));
  return geo.merge(...m);
}

/** Thin double-sided frond for the Exeggutor's spiky crown. */
function exFrond(len, wide, curl, roll = 0) {
  const m = blade(len, wide, curl, 0.24, 6);
  if (roll) place(m, null, [0, roll, 0]);
  tint(m, (x, y) => mix(EX.leaf, EX.leafL, clamp(y / len * 1.15 - 0.10, 0, 1)));
  return m;
}

export function makeAlolanExeggutor() {
  const parts = [];

  // --- trunk + neck: two overlapping swept pieces so the bend joint stays shut
  const trunk = ringedTube({
    u0: 0, u1: 0.63, seg: 18, bands: 8, seamW: 0.05, depth: 0.030,
    path: exPath, radius: exRadius, body: EX.trunk, seam: EX.trunkD, capStart: true,
    tone: u => 0.90 + 0.10 * Math.min(1, u * 3.2),
  });
  parts.push(part(trunk));

  const neck = ringedTube({
    u0: 0.615, u1: 1, seg: 16, bands: 6, seamW: 0.05, depth: 0.030,
    path: exPath, radius: u => exRadius(u) * 1.02, body: EX.trunk, seam: EX.trunkD,
  });
  parts.push(part(neck, WHITE, { bone: 'neck' }));

  // --- legs, feet and the three pale claws at the base of the trunk
  const legParts = [];
  for (const sx of [-1, 1]) {
    const l = renorm(geo.tube([[sx * 0.180, 0.80, -0.02], [sx * 0.240, 0.44, 0.00],
                               [sx * 0.258, 0.15, 0.02]], [0.215, 0.190, 0.170], 12, true));
    tint(l, (x, y) => mix(EX.trunkD, EX.trunk, clamp((y - 0.15) / 0.55, 0, 1)));
    const foot = place(ellip(0.170, 0.072, 0.200, 14, 10, 0.045, 41 + sx), [sx * 0.258, 0.066, 0.050]);
    tint(foot, (x, y) => mix(EX.trunkD, EX.trunk, clamp((y - 0.01) / 0.10, 0, 1)));
    const claws = [];
    for (let i = -1; i <= 1; i++) {
      claws.push(spike([sx * (0.258 + i * 0.100), 0.062, 0.185 + Math.abs(i) * 0.012],
                       [i * 0.60, -0.22, 1], 0.110, 0.052, 0.74, 7));
    }
    legParts.push(l, foot, tint(geo.merge(...claws), EX.claw));
  }
  parts.push(part(geo.merge(...legParts)));

  // --- crown knot + the three cream coconut heads
  const knot = tint(place(renorm(geo.blob(0.30, 14, 11, 0.05, 53)), EX_KNOT), EX.trunk);
  const heads = [exeggutorHead(0.335, 11), exeggutorHead(0.300, 23), exeggutorHead(0.300, 31)];
  place(heads[0], [0.02, EX_KNOT[1] + 0.17, EX_KNOT[2] + 0.24], [0.16, 0.05, 0]);
  place(heads[1], [-0.44, EX_KNOT[1] + 0.32, EX_KNOT[2] - 0.15], [0.10, -0.88, -0.06]);
  place(heads[2], [0.46, EX_KNOT[1] + 0.30, EX_KNOT[2] - 0.21], [0.10, 0.92, 0.06]);
  parts.push(part(geo.merge(knot, ...heads), WHITE, { bone: 'crown' }));

  // --- fronds: a lower drooping whorl and an upper rising one
  const fan = (list) => geo.merge(...list.map(([len, wide, curl, pitch, azim, roll]) => {
    const sp = Math.sin(pitch);
    const dir = [sp * Math.sin(azim), Math.cos(pitch), sp * Math.cos(azim)];
    const m = exFrond(len, wide, curl, roll);
    place(m, [EX_KNOT[0] + dir[0] * 0.20, EX_KNOT[1] + 0.06 + dir[1] * 0.20, EX_KNOT[2] + dir[2] * 0.20],
          [pitch, azim, 0]);
    return m;
  }));
  const lo = [], hi = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.30;
    lo.push([1.18 + (i % 3) * 0.12, 0.130 + (i % 2) * 0.022, 0.44, 1.28 + (i % 2) * 0.10, a, (i % 2 ? 1 : -1) * 0.5]);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.72;
    hi.push([1.05 + (i % 3) * 0.13, 0.118, 0.26, 0.60 + (i % 3) * 0.17, a, (i % 2 ? -1 : 1) * 0.42]);
  }
  parts.push(part(fan(lo), WHITE, { bone: 'frondsLo', doubleSided: true, outline: false, emis: 0.10 }));
  parts.push(part(fan(hi), WHITE, { bone: 'frondsHi', doubleSided: true, outline: false, emis: 0.10 }));

  // --- rear stub: a fourth, still-green coconut head on a short thick stub
  const stub = ringedTube({
    u0: 0, u1: 1, seg: 12, bands: 4, seamW: 0.06, depth: 0.035,
    path: u => [0, 0.88 - 0.72 * u + 0.50 * u * u, -0.28 - 0.92 * u],
    radius: u => 0.215 - 0.050 * u, body: EX.trunk, seam: EX.trunkD,
  });
  const stubHead = exeggutorHead(0.185, 61, [EX.unripe, [0.300, 0.348, 0.212]]);
  place(stubHead, [0, 0.80, -1.18], [-0.24, Math.PI * 0.94, 0]);
  const stubFronds = [];
  for (let i = 0; i < 3; i++) {
    const m = exFrond(0.44, 0.072, 0.42, (i - 1) * 0.5);
    place(m, [0, 0.86, -1.20], [1.02, Math.PI * 0.94 - 0.72 + i * 0.72, 0]);
    stubFronds.push(m);
  }
  parts.push(part(geo.merge(stub, stubHead, ...stubFronds), WHITE,
                  { bone: 'tail', doubleSided: true, outline: false, emis: 0.06 }));

  const model = { parts };
  rig(model, [
    { name: 'neck', pivot: exPath(0.62) },
    { name: 'crown', pivot: [0, EX_KNOT[1] - 0.06, EX_KNOT[2]], parent: 'neck' },
    { name: 'frondsLo', pivot: [EX_KNOT[0], EX_KNOT[1] + 0.06, EX_KNOT[2]], parent: 'crown' },
    { name: 'frondsHi', pivot: [EX_KNOT[0], EX_KNOT[1] + 0.06, EX_KNOT[2]], parent: 'crown' },
    { name: 'tail', pivot: [0, 0.88, -0.28] },
  ]);
  model.update = function (dt, t, state, entity) {
    const P = battlerPose(entity.anim, t, {
      lunge: 0.30, topple: 1.24, toppleSign: 1, lift: 0.30, lean: 0.05, neck: 0.16, crown: 0.10, dur: 0.7,
    });
    for (let i = 0; i < 2; i++) {                        // ambient frond sway
      const ph = t * (0.75 + i * 0.14) * 2.0 + i * 1.7;
      P[i ? 'frondsHi' : 'frondsLo'] = {
        p: [0, 0, 0],
        r: [0.045 * Math.sin(ph * 0.8), 0.03 * Math.sin(ph * 0.55), 0.05 * Math.sin(ph)],
        s: [1, 1, 1],
      };
    }
    pose(this, P);
    if (entity.shadow && entity.shadow.r !== this.shadowR) entity.shadow.r = this.shadowR;
  };
  return settle(model);
}

/* ================================================================= props */

const PALM_BARK = [0.400, 0.318, 0.216], PALM_BARK_D = [0.268, 0.206, 0.140];
const PALM_LEAF = [0.150, 0.330, 0.108], PALM_LEAF_L = [0.330, 0.560, 0.220];

/** Palm frond: a broad blade built from `blade()`, tinted base-dark to tip-light
 *  with a darker rib, so a whorl of them reads as layers rather than one sheet. */
function palmFrond(len, wide, curl, roll) {
  const m = blade(len, wide, curl, 0.30, 8);
  if (roll) place(m, null, [0, roll, 0]);
  tint(m, (x, y, z) => {
    const t = clamp(y / len, 0, 1);
    const c = mix(mix(PALM_LEAF, PALM_LEAF_L, t * t), PALM_BARK_D, 0);
    const rib = Math.abs(x) < wide * 0.10 && t < 0.85 ? 0.80 : 1;
    return [c[0] * rib, c[1] * rib, c[2] * rib];
  });
  return m;
}

export function makePalmTree({ h = 7, lean = 0.12, seed = 1 } = {}) {
  const rnd = (n => () => ((n = (n * 16807) % 2147483647) / 2147483647))(seed * 977 + 13);
  const sway = (rnd() - 0.5) * 0.5;
  const path = u => [Math.sin(u * 1.25) * lean * h * 0.55, u * h, (Math.sin(u * 2.1 + sway) - 0.2) * 0.09 * h];
  const bands = Math.max(8, Math.round(h * 1.05));
  const parts = [];

  // trunk: tapered sweep with a scar ring every band and a bark tone that jumps
  // band to band (leaf-scar banding, so the shaft is never a smooth cylinder)
  const trunk = ringedTube({
    u0: 0, u1: 1, seg: 12, bands, seamW: 0.055, depth: 0.070,
    path, radius: u => 0.300 - 0.190 * u, body: PALM_BARK, seam: PALM_BARK_D, capStart: true,
    tone: u => {
      const b = Math.floor(u * bands);
      const j = ((b * 37 + seed * 11) % 7) / 7;
      return 0.86 + 0.20 * j;
    },
  });
  parts.push(part(trunk));

  const top = path(1);
  const crown = [];
  const addFrond = (len, wide, curl, pitch, azim, roll) => {
    const sp = Math.sin(pitch);
    const m = palmFrond(len, wide, curl, roll);
    place(m, [top[0] + sp * Math.sin(azim) * 0.26, top[1] + 0.10 * Math.cos(pitch),
              top[2] + sp * Math.cos(azim) * 0.26], [pitch, azim, 0]);
    crown.push(m);
  };
  const nA = 7;
  for (let i = 0; i < nA; i++) {
    const a = (i / nA) * Math.PI * 2 + sway * 3;
    addFrond(2.15 + rnd() * 0.85, 0.40 + rnd() * 0.10, 0.46 + rnd() * 0.16,
             1.34 + rnd() * 0.16, a, (rnd() - 0.5) * 1.0);
  }
  const nB = 6;
  for (let i = 0; i < nB; i++) {
    const a = (i / nB) * Math.PI * 2 + 0.7 + sway * 3;
    addFrond(1.75 + rnd() * 0.65, 0.36 + rnd() * 0.09, 0.28 + rnd() * 0.14,
             0.98 + rnd() * 0.16, a, (rnd() - 0.5) * 1.0);
  }
  const nC = 5;
  for (let i = 0; i < nC; i++) {
    const a = (i / nC) * Math.PI * 2 + 1.25 + sway * 3;
    addFrond(1.35 + rnd() * 0.60, 0.32 + rnd() * 0.08, -0.06 + rnd() * 0.14,
             0.48 + rnd() * 0.20, a, (rnd() - 0.5) * 1.0);
  }
  // crown knot + a couple of coconuts, so the whorls grow out of something
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const k = place(ellip(0.13, 0.12, 0.13, 10, 8, 0.06, 70 + i + seed),
                    [top[0] + Math.sin(a) * 0.13, top[1] - 0.02 + (i % 2) * 0.05, top[2] + Math.cos(a) * 0.13]);
    tint(k, PALM_BARK);
    crown.push(k);
  }
  parts.push(part(geo.merge(...crown), WHITE, { doubleSided: true, outline: false, emis: 0.08 }));

  const model = { parts };
  for (const p of parts) { p.p = [0, 0, 0]; p.r = [0, 0, 0]; }
  return settle(model);
}

export function makeRock({ r = 0.6, seed = 1 } = {}) {
  const rnd = (n => () => ((n = (n * 16807) % 2147483647) / 2147483647))(seed * 7919 + 5);
  const m = geo.sphere(r, 8, 5);
  for (let i = 0; i < m.pos.length / 3; i++) {
    const k = 0.78 + rnd() * 0.42;                       // angular, not spherical
    m.pos[i * 3] *= k * 1.12;
    m.pos[i * 3 + 1] = Math.max(m.pos[i * 3 + 1] * k * 0.86, -r * 0.55);
    m.pos[i * 3 + 2] *= k * 1.05;
  }
  const flat = faceted(m);
  tint(flat, (x, y, z) => {
    const k = 0.72 + 0.38 * clamp(y / (r * 0.9) * 0.5 + 0.5, 0, 1);
    return [0.50 * k, 0.48 * k, 0.46 * k];
  });
  return settle({ parts: [part(flat)] });
}

export function makeShell({ r = 0.2 } = {}) {
  const ribs = [];
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.36;
    const rib = place(ellip(r * 0.16, r * 0.30, r * 0.72, 8, 6, 0.05, 90 + i), [Math.sin(a) * r * 0.5, 0, r * 0.42], [0, a, 0]);
    tint(rib, (x, y, z) => mix([0.99, 0.94, 0.86], [0.94, 0.80, 0.76], clamp(z / (r * 0.9), 0, 1)));
    ribs.push(rib);
  }
  ribs.push(place(ellip(r * 0.34, r * 0.26, r * 0.30, 10, 7, 0.06, 93), [0, 0, -r * 0.32]));
  return settle({ parts: [part(geo.merge(...ribs), WHITE, { doubleSided: true })] });
}

export function makeGrassTuft({ h = 0.5 } = {}) {
  const blades = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4;
    const len = h * (0.62 + ((i * 37) % 10) / 22);
    const m = geo.leaf(len, 0.024, 0.008, 3, 0.42);
    tint(m, (x, y) => mix([0.22, 0.42, 0.15], [0.62, 0.68, 0.28], clamp(y / len, 0, 1)));
    place(m, [Math.sin(a) * 0.012, 0, Math.cos(a) * 0.012], [0.34 + ((i * 13) % 5) * 0.06, a, 0]);
    blades.push(m);
  }
  return settle({ parts: [part(geo.merge(...blades), WHITE, { doubleSided: true, unlit: true })] });
}

export function makeCloud({ w = 6 } = {}) {
  const parts = [];
  const quad = geo.quad(1, 1);
  const puffs = [
    [0, 0, 0, 1.00], [-0.42, 0.06, 0.10, 0.72], [0.44, 0.02, -0.08, 0.78],
    [-0.16, 0.24, -0.06, 0.60], [0.20, 0.20, 0.10, 0.55],
  ];
  for (let i = 0; i < puffs.length; i++) {
    const [dx, dy, dz, ds] = puffs[i];
    parts.push(part(quad, i === 0 ? [1, 1, 1] : [0.98, 0.99, 1], {
      p: [dx * w, dy * w, dz * w], s: ds * w * 0.85,
      billboard: true, unlit: true, texMode: 2, alpha: i < 2 ? 0.95 : 0.88, cull: 'none',
    }));
  }
  const model = { parts };
  model.update = function (dt, t, state) {
    if (!this._tex && state && state.ctx) {
      this._tex = state.ctx.texture(tex.softDisc(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)', 0.28));
      for (const p of this.parts) p.tex = this._tex;
    }
  };
  return model;
}

/* ------------------------------------------------------------ legendaries */
// Altar-of-the-Sunne cameo models (not part of the Exeggutor Island battle).

export function makeSolgaleo() {
  const parts = [];
  const WHITE_F = [0.95, 0.94, 0.92], GOLD = [0.93, 0.75, 0.32], RED = [0.82, 0.24, 0.12], BLUE_E = [0.30, 0.72, 0.95];
  const body = place(ellip(0.55, 0.52, 1.10, 16, 12, 0.05, 101), [0, 1.05, -0.10]);
  tint(body, WHITE_F);
  parts.push(part(body));
  const leg = () => {
    const l = geo.tube([[0.30, 1.05, 0.62], [0.32, 0.50, 0.66], [0.30, 0.05, 0.62]], [0.16, 0.13, 0.11], 8, false);
    tint(l, WHITE_F); return l;
  };
  const legB = () => {
    const l = geo.tube([[0.30, 1.05, -0.62], [0.32, 0.50, -0.70], [0.30, 0.05, -0.60]], [0.17, 0.14, 0.12], 8, false);
    tint(l, WHITE_F); return l;
  };
  parts.push(part(geo.merge(leg(), mirrorX(leg()), legB(), mirrorX(legB()))));
  const mane = [];
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const m = geo.leaf(0.62, 0.20, 0.05, 4, 0.25);
    tint(m, (x, y) => mix(GOLD, [1, 0.96, 0.86], clamp(y / 0.62, 0, 1)));
    place(m, [Math.sin(a) * 0.42, 1.62 + Math.cos(a) * 0.34, 0.78], [1.15, a, 0]);
    mane.push(m);
  }
  parts.push(part(geo.merge(...mane), WHITE, { doubleSided: true, bone: 'head' }));
  const headM = place(ellip(0.36, 0.34, 0.36, 14, 11, 0.05, 103), [0, 1.60, 0.92]);
  tint(headM, WHITE_F);
  const snout = place(ellip(0.20, 0.16, 0.22, 10, 8, 0.05, 107), [0, 1.50, 1.22]);
  tint(snout, [0.90, 0.88, 0.86]);
  const crest = place(geo.cone(0.16, 0.30, 6), [0, 1.90, 0.86], [-0.2, 0, 0]);
  tint(crest, RED);
  const eyesM = geo.merge(
    place(ellip(0.06, 0.055, 0.05, 10, 7, 0.04, 109), [0.17, 1.66, 1.14]),
    place(ellip(0.06, 0.055, 0.05, 10, 7, 0.04, 111), [-0.17, 1.66, 1.14]));
  tint(eyesM, BLUE_E);
  parts.push(part(geo.merge(headM, snout, crest, eyesM), WHITE, { bone: 'head' }));
  const tail = geo.tube([[0, 1.15, -1.15], [0, 1.55, -1.75], [0, 1.85, -1.60]], 0.09, 8, false);
  tint(tail, WHITE_F);
  const tailFan = place(geo.cone(0.26, 0.34, 7), [0, 1.95, -1.58]);
  tint(tailFan, GOLD);
  parts.push(part(geo.merge(tail, tailFan), WHITE, { bone: 'tail' }));
  const model = { parts };
  rig(model, [{ name: 'head', pivot: [0, 1.35, 0.85] }, { name: 'tail', pivot: [0, 1.15, -1.10] }]);
  model.update = function (dt, t, state, entity) {
    pose(this, battlerPose(entity.anim, t, { lunge: 0.7, topple: 1.2, lift: 0.2 }));
    if (entity.shadow) entity.shadow.r = this.shadowR;
  };
  return settle(model);
}

export function makeLunala() {
  const parts = [];
  const BONE = [0.94, 0.93, 0.97], WING = [0.58, 0.45, 0.82], GOLD = [0.94, 0.79, 0.36], EYE = [0.95, 0.35, 0.42];
  const body = place(ellip(0.34, 0.42, 0.62, 16, 12, 0.05, 121), [0, 1.35, 0]);
  tint(body, BONE);
  parts.push(part(body));
  const wing = (side) => {
    const w = place(geo.leaf(1.75, 0.95, 0.05, 6, -0.55), [side * 0.34, 1.45, -0.05], [0, side > 0 ? 1.5 : -1.5, 2.0]);
    tint(w, (x, y) => mix(WING, [0.80, 0.72, 0.95], clamp(y / 1.75, 0, 1)));
    return w;
  };
  parts.push(part(geo.merge(wing(1), wing(-1)), WHITE, { doubleSided: true, bone: 'wing' }));
  const headM = place(ellip(0.27, 0.26, 0.28, 14, 11, 0.05, 123), [0, 1.62, 0.30]);
  tint(headM, BONE);
  const eyesM = geo.merge(
    place(ellip(0.055, 0.06, 0.05, 10, 7, 0.04, 127), [0.12, 1.66, 0.52]),
    place(ellip(0.055, 0.06, 0.05, 10, 7, 0.04, 129), [-0.12, 1.66, 0.52]));
  tint(eyesM, EYE);
  const crescent = place(geo.torus(0.30, 0.06, 16, 7), [0, 1.88, 0.22], [0.5, 0, 0]);
  tint(crescent, GOLD);
  parts.push(part(geo.merge(headM, eyesM, crescent), WHITE, { bone: 'head' }));
  const tail = geo.tube([[0, 1.15, -0.55], [0, 0.92, -1.25], [0, 0.80, -1.85]], [0.12, 0.08, 0.05], 8, false);
  tint(tail, BONE);
  parts.push(part(tail, WHITE, { bone: 'tail' }));
  const model = { parts };
  rig(model, [
    { name: 'head', pivot: [0, 1.42, 0.22] },
    { name: 'wing', pivot: [0, 1.45, -0.05] },
    { name: 'tail', pivot: [0, 1.18, -0.50] },
  ]);
  model.update = function (dt, t, state, entity) {
    const P = battlerPose(entity.anim, t, { lunge: 0.5, topple: 1.1, lift: 0.3 });
    P.wing = { p: [0, 0, 0], r: [0.16 * Math.sin(t * 1.5), 0, 0.10 * Math.sin(t * 1.1)], s: [1, 1, 1] };
    pose(this, P);
    if (entity.shadow) entity.shadow.r = this.shadowR;
  };
  return settle(model);
}
