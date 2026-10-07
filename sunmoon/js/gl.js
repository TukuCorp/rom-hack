// gl.js — tiny forward renderer for the Sun & Moon battle scene.
//
// Owned by: Main (integration). Builders only *use* this file.
//
// Contract (see CONTRACT.md):
//   MeshData : { pos:Float32Array, nrm:Float32Array, col:Float32Array, uv:Float32Array, idx:Uint16Array|Uint32Array }
//   Part     : { geo:MeshData, col?, p?:[x,y,z], r?:[x,y,z], s?:number|[x,y,z], parent?:number,
//                emis?, spec?, shine?, rim?, alpha?, tex?, texMode?:0|1|2, blend?:'alpha'|'add',
//                unlit?:bool, doubleSided?:bool, billboard?:bool, cull?:'back'|'front'|'none' }
//   Model    : { parts:Part[], update?(dt,t,state,entity) }
//   Entity   : { model:Model, pos:[x,y,z], rot?:[x,y,z], scale?, shadow?:{r,alpha}, ttl?, update?(dt,t,state) }

export const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ mat4 */

export const M = {
  id() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); },
  mul(a, b, out = new Float32Array(16)) { // out = a * b
    for (let c = 0; c < 4; c++) {
      const b0 = b[c*4], b1 = b[c*4+1], b2 = b[c*4+2], b3 = b[c*4+3];
      out[c*4+0] = a[0]*b0 + a[4]*b1 + a[8]*b2  + a[12]*b3;
      out[c*4+1] = a[1]*b0 + a[5]*b1 + a[9]*b2  + a[13]*b3;
      out[c*4+2] = a[2]*b0 + a[6]*b1 + a[10]*b2 + a[14]*b3;
      out[c*4+3] = a[3]*b0 + a[7]*b1 + a[11]*b2 + a[15]*b3;
    }
    return out;
  },
  compose(p = [0,0,0], r = [0,0,0], s = 1, out = new Float32Array(16)) {
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
    const cx = Math.cos(r[0]), sxr = Math.sin(r[0]);
    const cy = Math.cos(r[1]), syr = Math.sin(r[1]);
    const cz = Math.cos(r[2]), szr = Math.sin(r[2]);
    // R = Rz * Ry * Rx
    const m00 = cz*cy, m01 = cz*syr*sxr - szr*cx, m02 = cz*syr*cx + szr*sxr;
    const m10 = szr*cy, m11 = szr*syr*sxr + cz*cx, m12 = szr*syr*cx - cz*sxr;
    const m20 = -syr,   m21 = cy*sxr,               m22 = cy*cx;
    out[0]=m00*sx; out[1]=m10*sx; out[2]=m20*sx; out[3]=0;
    out[4]=m01*sy; out[5]=m11*sy; out[6]=m21*sy; out[7]=0;
    out[8]=m02*sz; out[9]=m12*sz; out[10]=m22*sz; out[11]=0;
    out[12]=p[0]; out[13]=p[1]; out[14]=p[2]; out[15]=1;
    return out;
  },
  persp(fovYDeg, aspect, near, far, out = new Float32Array(16)) {
    const f = 1 / Math.tan(fovYDeg * DEG / 2), nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  },
  lookAt(eye, target, up = [0,1,0], out = new Float32Array(16)) {
    let zx = eye[0]-target[0], zy = eye[1]-target[1], zz = eye[2]-target[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx/=l; zy/=l; zz/=l;
    let xx = up[1]*zz - up[2]*zy, xy = up[2]*zx - up[0]*zz, xz = up[0]*zy - up[1]*zx;
    l = Math.hypot(xx, xy, xz) || 1; xx/=l; xy/=l; xz/=l;
    const yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
    out[0]=xx; out[1]=yx; out[2]=zx; out[3]=0;
    out[4]=xy; out[5]=yy; out[6]=zy; out[7]=0;
    out[8]=xz; out[9]=yz; out[10]=zz; out[11]=0;
    out[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);
    out[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);
    out[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
    out[15]=1;
    return out;
  },
  // normal matrix (inverse-transpose of upper 3x3) as mat3
  normal3(m, out = new Float32Array(9)) {
    const a=m[0],b=m[1],c=m[2], d=m[4],e=m[5],f=m[6], g=m[8],h=m[9],i=m[10];
    const A=e*i-f*h, B=f*g-d*i, C=d*h-e*g;
    let det = a*A + b*B + c*C; if (Math.abs(det) < 1e-12) det = 1e-12;
    const id = 1/det;
    // inverse of 3x3 -> we want transpose(inverse)
    out[0]=A*id;            out[3]=B*id;            out[6]=C*id;
    out[1]=(c*h-b*i)*id;    out[4]=(a*i-c*g)*id;    out[7]=(b*g-a*h)*id;
    out[2]=(b*f-c*e)*id;    out[5]=(c*d-a*f)*id;    out[8]=(a*e-b*d)*id;
    return out;
  },
};

/* ------------------------------------------------------------- geometry */

const _v = { x:0, y:0, z:0 };

function mesh(pos, nrm, col, uv, idx) {
  const posA = pos instanceof Float32Array ? pos : new Float32Array(pos);
  const idxA = packIdx(idx, posA.length / 3);
  const m = {
    pos: posA,
    nrm: nrm instanceof Float32Array ? nrm : new Float32Array(nrm),
    col: col instanceof Float32Array ? col : new Float32Array(col),
    uv: uv instanceof Float32Array ? uv : new Float32Array(uv),
    idx: idxA,
  };
  fixWinding(m);
  return m;
}

/** Every triangle is re-wound to agree with its vertex normals (back-face culling safety). */
export function fixWinding(m) {
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i]*3, b = m.idx[i+1]*3, c = m.idx[i+2]*3;
    const ux = m.pos[b]-m.pos[a], uy = m.pos[b+1]-m.pos[a+1], uz = m.pos[b+2]-m.pos[a+2];
    const vx = m.pos[c]-m.pos[a], vy = m.pos[c+1]-m.pos[a+1], vz = m.pos[c+2]-m.pos[a+2];
    const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    if (nx*nx + ny*ny + nz*nz < 1e-20) continue;                    // degenerate / unused slot
    const vnx = m.nrm[a] + m.nrm[b] + m.nrm[c];
    const vny = m.nrm[a+1] + m.nrm[b+1] + m.nrm[c+1];
    const vnz = m.nrm[a+2] + m.nrm[b+2] + m.nrm[c+2];
    if (nx*vnx + ny*vny + nz*vnz < 0) { const t = m.idx[i+1]; m.idx[i+1] = m.idx[i+2]; m.idx[i+2] = t; }
  }
  return m;
}

/** WebGL1 wants 16-bit indices unless OES_element_index_uint is present. */
function packIdx(idx, vcount) {
  const fits16 = vcount <= 65536;
  if (idx instanceof Uint16Array) return idx;
  if (idx instanceof Uint32Array) return fits16 ? new Uint16Array(idx) : idx;
  return fits16 ? new Uint16Array(idx) : new Uint32Array(idx);
}

/** Allocate an empty mesh with room for `maxVerts` vertices (CPU-refilled each frame). */
export function dynMesh(maxVerts, maxIdx = maxVerts * 2) {
  const m = mesh(new Float32Array(maxVerts*3), new Float32Array(maxVerts*3),
                 new Float32Array(maxVerts*3), new Float32Array(maxVerts*2),
                 new Uint32Array(maxIdx));
  m.dynamic = true; m.capacity = maxVerts; m.count = 0; m.idxCount = 0;
  return m;
}

export const geo = {
  mesh, dynMesh,

  box(w, h, d) {
    const x = w/2, y = h/2, z = d/2;
    const faces = [
      { n:[0,0,1],  v:[[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]] },
      { n:[0,0,-1], v:[[x,-y,-z],[-x,-y,-z],[-x,y,-z],[x,y,-z]] },
      { n:[1,0,0],  v:[[x,-y,z],[x,-y,-z],[x,y,-z],[x,y,z]] },
      { n:[-1,0,0], v:[[-x,-y,-z],[-x,-y,z],[-x,y,z],[-x,y,-z]] },
      { n:[0,1,0],  v:[[-x,y,z],[x,y,z],[x,y,-z],[-x,y,-z]] },
      { n:[0,-1,0], v:[[-x,-y,-z],[x,-y,-z],[x,-y,z],[-x,-y,z]] },
    ];
    const posA = [], nrmA = [], uvA = [], colA = [], idxA = [];
    faces.forEach((f, fi) => {
      const b = fi * 4;
      const uvs = [[0,0],[1,0],[1,1],[0,1]];
      f.v.forEach((v, vi) => {
        posA.push(v[0], v[1], v[2]); nrmA.push(f.n[0], f.n[1], f.n[2]);
        colA.push(1,1,1); uvA.push(uvs[vi][0], uvs[vi][1]);
      });
      idxA.push(b, b+1, b+2, b, b+2, b+3);
    });
    return mesh(posA, nrmA, colA, uvA, idxA);
  },

  quad(w = 1, h = 1) {
    const x = w/2, y = h/2;
    return mesh([-x,-y,0, x,-y,0, x,y,0, -x,y,0],
                [0,0,1, 0,0,1, 0,0,1, 0,0,1],
                [1,1,1, 1,1,1, 1,1,1, 1,1,1],
                [0,0, 1,0, 1,1, 0,1], [0,1,2, 0,2,3]);
  },

  sphere(r = 1, ws = 16, hs = 10) {
    const posA = [], nrmA = [], uvA = [], colA = [], idxA = [];
    for (let i = 0; i <= hs; i++) {
      const phi = Math.PI * i / hs, sp = Math.sin(phi), cp = Math.cos(phi);
      for (let j = 0; j <= ws; j++) {
        const th = 2*Math.PI * j / ws;
        const x = sp*Math.cos(th), y = cp, z = sp*Math.sin(th);
        posA.push(x*r, y*r, z*r); nrmA.push(x, y, z); colA.push(1,1,1);
        uvA.push(j/ws, i/hs);
      }
    }
    for (let i = 0; i < hs; i++) for (let j = 0; j < ws; j++) {
      const a = i*(ws+1)+j, b = a+ws+1;
      idxA.push(a, b, a+1, a+1, b, b+1);
    }
    return mesh(posA, nrmA, colA, uvA, idxA);
  },

  cylinder(rTop = 1, rBot = 1, h = 1, seg = 16, caps = true) {
    const posA = [], nrmA = [], uvA = [], colA = [], idxA = [];
    const y = h/2;
    for (let s = 0; s <= 1; s++) {
      const r = s ? rTop : rBot, yy = s ? y : -y;
      for (let j = 0; j <= seg; j++) {
        const th = 2*Math.PI*j/seg, cx = Math.cos(th), cz = Math.sin(th);
        const slope = (rBot - rTop) / h;
        const ny = slope, nl = Math.hypot(1, ny);
        posA.push(cx*r, yy, cz*r); nrmA.push(cx/nl, ny/nl, cz/nl);
        colA.push(1,1,1); uvA.push(j/seg, s);
      }
    }
    for (let j = 0; j < seg; j++) {
      const a = j, b = j + seg + 1;
      idxA.push(a, b, a+1, a+1, b, b+1);
    }
    if (caps) {
      for (const [rr, yy, ny] of [[rTop, y, 1], [rBot, -y, -1]]) {
        const centre = posA.length/3;
        posA.push(0, yy, 0); nrmA.push(0, ny, 0); colA.push(1,1,1); uvA.push(.5,.5);
        const start = posA.length/3;
        for (let j = 0; j <= seg; j++) {
          const th = 2*Math.PI*j/seg;
          posA.push(Math.cos(th)*rr, yy, Math.sin(th)*rr);
          nrmA.push(0, ny, 0); colA.push(1,1,1);
          uvA.push(Math.cos(th)*.5+.5, Math.sin(th)*.5+.5);
        }
        for (let j = 0; j < seg; j++) {
          if (ny > 0) idxA.push(centre, start+j, start+j+1);
          else idxA.push(centre, start+j+1, start+j);
        }
      }
    }
    return mesh(posA, nrmA, colA, uvA, idxA);
  },

  cone(rBot = 1, h = 1, seg = 16) { return geo.cylinder(0.0001, rBot, h, seg, true); },

  /** Wavy cone (phyllotaxis-free leaf); returns a flattened blade in +Y with `tip` bend. */
  leaf(len = 1, width = .3, thick = .04, seg = 6, tip = .5) {
    const posA = [], nrmA = [], uvA = [], colA = [], idxA = [];
    for (let i = 0; i <= seg; i++) {
      const u = i/seg;
      const y = u*len;
      const w = width * Math.sin(Math.PI * Math.min(1, u*1.15)) * (1 - .55*u);
      const bendZ = tip * u * u * len;
      for (const s of [-1, 1]) {
        posA.push(s*w, y, bendZ); nrmA.push(0, .2, 1); colA.push(1,1,1); uvA.push(u, (s+1)/2);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = i*2;
      idxA.push(a, a+1, a+2, a+1, a+3, a+2);
    }
    const out = mesh(posA, nrmA, colA, uvA, idxA);
    return out;
  },

  /** Flat XZ grid, normal +Y, centred on origin. */
  plane(w = 1, d = 1, sx = 1, sz = 1) {
    const posA = [], nrmA = [], uvA = [], colA = [], idxA = [];
    for (let i = 0; i <= sz; i++) for (let j = 0; j <= sx; j++) {
      posA.push((j/sx - .5)*w, 0, (i/sz - .5)*d);
      nrmA.push(0,1,0); colA.push(1,1,1); uvA.push(j/sx, i/sz);
    }
    for (let i = 0; i < sz; i++) for (let j = 0; j < sx; j++) {
      const a = i*(sx+1)+j, b = a+sx+1;
      idxA.push(a, a+1, b, a+1, b+1, b);
    }
    return mesh(posA, nrmA, colA, uvA, idxA);
  },

  /** Flat XZ disc, normal +Y, uv maps the unit disc (radial textures like shadows). */
  disc(r = 1, seg = 24) {
    const posA = [0,0,0], nrmA = [0,1,0], uvA = [.5,.5], colA = [1,1,1], idxA = [];
    for (let j = 0; j <= seg; j++) {
      const th = 2*Math.PI*j/seg, cx = Math.cos(th), cz = Math.sin(th);
      posA.push(cx*r, 0, cz*r); nrmA.push(0,1,0); colA.push(1,1,1);
      uvA.push(cx*.5+.5, cz*.5+.5);
    }
    for (let j = 0; j < seg; j++) idxA.push(0, j+2, j+1);
    return mesh(posA, nrmA, colA, uvA, idxA);
  },

  torus(R = 1, r = .2, seg = 24, rings = 8) {
    const posA = [], nrmA = [], uvA = [], colA = [], idxA = [];
    for (let i = 0; i <= seg; i++) {
      const u = 2*Math.PI*i/seg, cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j <= rings; j++) {
        const v = 2*Math.PI*j/rings, cv = Math.cos(v), sv = Math.sin(v);
        posA.push((R + r*cv)*cu, r*sv, (R + r*cv)*su);
        nrmA.push(cv*cu, sv, cv*su); colA.push(1,1,1); uvA.push(i/seg, j/rings);
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < rings; j++) {
      const a = i*(rings+1)+j, b = a+rings+1;
      idxA.push(a, b, a+1, a+1, b, b+1);
    }
    return mesh(posA, nrmA, colA, uvA, idxA);
  },

  /** Tube swept along a polyline; `radii` is a number, [r0, r1], a per-point array, or fn(u). */
  tube(points, radii, ringSeg = 12, caps = true) {
    const n = points.length;
    const rr = typeof radii === 'function'
      ? points.map((_, i) => radii(n === 1 ? 0 : i / (n - 1), i))
      : (Array.isArray(radii) && radii.length === n)
        ? radii
        : points.map((_, i) => {
            const [a, b] = Array.isArray(radii) ? radii : [radii, radii];
            return a + (b - a) * (n === 1 ? 0 : i/(n-1));
          });
    const posA = [], nrmA = [], uvA = [], colA = [], idxA = [];
    const frames = [];
    for (let i = 0; i < n; i++) {
      const prev = points[Math.max(0, i-1)], next = points[Math.min(n-1, i+1)];
      let tx = next[0]-prev[0], ty = next[1]-prev[1], tz = next[2]-prev[2];
      const tl = Math.hypot(tx,ty,tz) || 1; tx/=tl; ty/=tl; tz/=tl;
      let ux = 0, uy = 1, uz = 0;
      if (Math.abs(ty) > .95) { ux = 1; uy = 0; }
      let sx = uy*tz - uz*ty, sy = uz*tx - ux*tz, sz = ux*ty - uy*tx;
      const sl = Math.hypot(sx,sy,sz) || 1; sx/=sl; sy/=sl; sz/=sl;
      const bx = ty*sz - tz*sy, by = tz*sx - tx*sz, bz = tx*sy - ty*sx;
      frames.push({ t:[tx,ty,tz], s:[sx,sy,sz], b:[bx,by,bz] });
    }
    for (let i = 0; i < n; i++) {
      const p = points[i], f = frames[i], r = rr[i];
      for (let j = 0; j <= ringSeg; j++) {
        const th = 2*Math.PI*j/ringSeg, c = Math.cos(th), s = Math.sin(th);
        const nx = f.s[0]*c + f.b[0]*s, ny = f.s[1]*c + f.b[1]*s, nz = f.s[2]*c + f.b[2]*s;
        posA.push(p[0]+nx*r, p[1]+ny*r, p[2]+nz*r);
        nrmA.push(nx, ny, nz); colA.push(1,1,1); uvA.push(j/ringSeg, i/(n-1));
      }
    }
    for (let i = 0; i < n-1; i++) for (let j = 0; j < ringSeg; j++) {
      const a = i*(ringSeg+1)+j, b = a+ringSeg+1;
      idxA.push(a, b, a+1, a+1, b, b+1);
    }
    if (caps && n > 1) {
      for (const [idx, ny] of [[0, -1], [n-1, 1]]) {
        const centre = posA.length/3;
        posA.push(points[idx][0], points[idx][1], points[idx][2]);
        nrmA.push(frames[idx].t[0]*ny, frames[idx].t[1]*ny, frames[idx].t[2]*ny);
        colA.push(1,1,1); uvA.push(.5,.5);
        const start = posA.length/3, f = frames[idx], r = rr[idx];
        for (let j = 0; j <= ringSeg; j++) {
          const th = 2*Math.PI*j/ringSeg, c = Math.cos(th), s = Math.sin(th);
          posA.push(points[idx][0] + (f.s[0]*c + f.b[0]*s)*r,
                    points[idx][1] + (f.s[1]*c + f.b[1]*s)*r,
                    points[idx][2] + (f.s[2]*c + f.b[2]*s)*r);
          nrmA.push(frames[idx].t[0]*ny, frames[idx].t[1]*ny, frames[idx].t[2]*ny);
          colA.push(1,1,1); uvA.push(c*.5+.5, s*.5+.5);
        }
        for (let j = 0; j < ringSeg; j++) {
          if (ny > 0) idxA.push(centre, start+j, start+j+1);
          else idxA.push(centre, start+j+1, start+j);
        }
      }
    }
    return mesh(posA, nrmA, colA, uvA, idxA);
  },

  merge(...meshes) {
    const posA=[], nrmA=[], colA=[], uvA=[], idxA=[];
    let off = 0;
    for (const m of meshes) {
      const vc = m.pos.length/3;
      posA.push(...m.pos); nrmA.push(...m.nrm); colA.push(...m.col); uvA.push(...m.uv);
      for (let i = 0; i < m.idx.length; i++) idxA.push(m.idx[i] + off);
      off += vc;
    }
    return mesh(posA, nrmA, colA, uvA, idxA);
  },

  /** Colour a mesh: flat [r,g,b] or fn(x,y,z,mesh) -> [r,g,b]. */
  colorize(m, c) {
    const fn = typeof c === 'function' ? c : null;
    for (let i = 0; i < m.pos.length/3; i++) {
      const v = fn ? fn(m.pos[i*3], m.pos[i*3+1], m.pos[i*3+2], m) : c;
      m.col[i*3] = v[0]; m.col[i*3+1] = v[1]; m.col[i*3+2] = v[2];
    }
    return m;
  },

  /** Bake a transform into the vertices (returns the same mesh). */
  bake(m, { p = [0,0,0], r = [0,0,0], s = 1 } = {}) {
    const mm = M.compose(p, r, s);
    const nm = M.normal3(mm);
    for (let i = 0; i < m.pos.length/3; i++) {
      const x = m.pos[i*3], y = m.pos[i*3+1], z = m.pos[i*3+2];
      m.pos[i*3]   = mm[0]*x + mm[4]*y + mm[8]*z  + mm[12];
      m.pos[i*3+1] = mm[1]*x + mm[5]*y + mm[9]*z  + mm[13];
      m.pos[i*3+2] = mm[2]*x + mm[6]*y + mm[10]*z + mm[14];
      const nx = m.nrm[i*3], ny = m.nrm[i*3+1], nz = m.nrm[i*3+2];
      let ox = nm[0]*nx + nm[3]*ny + nm[6]*nz;
      let oy = nm[1]*nx + nm[4]*ny + nm[7]*nz;
      let oz = nm[2]*nx + nm[5]*ny + nm[8]*nz;
      const l = Math.hypot(ox, oy, oz) || 1;
      m.nrm[i*3] = ox/l; m.nrm[i*3+1] = oy/l; m.nrm[i*3+2] = oz/l;
    }
    return m;
  },

  /** Axis-aligned bounding box of a mesh. */
  bounds(m) {
    let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for (let i = 0; i < m.pos.length/3; i++) for (let k = 0; k < 3; k++) {
      const v = m.pos[i*3+k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
    return { min: mn, max: mx, size: [mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]] };
  },

  /** Recompute smooth normals by area-weighted face averaging. */
  smooth(m) {
    const n = m.pos.length/3;
    m.nrm.fill(0);
    for (let i = 0; i < m.idx.length; i += 3) {
      const a = m.idx[i]*3, b = m.idx[i+1]*3, c = m.idx[i+2]*3;
      const ux = m.pos[b]-m.pos[a], uy = m.pos[b+1]-m.pos[a+1], uz = m.pos[b+2]-m.pos[a+2];
      const vx = m.pos[c]-m.pos[a], vy = m.pos[c+1]-m.pos[a+1], vz = m.pos[c+2]-m.pos[a+2];
      const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      for (const k of [a,b,c]) { m.nrm[k]+=nx; m.nrm[k+1]+=ny; m.nrm[k+2]+=nz; }
    }
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(m.nrm[i*3], m.nrm[i*3+1], m.nrm[i*3+2]) || 1;
      m.nrm[i*3]/=l; m.nrm[i*3+1]/=l; m.nrm[i*3+2]/=l;
    }
    return m;
  },

  /** Soft lumpy sphere (organic bodies): displace by smooth noise. */
  blob(r = 1, ws = 20, hs = 14, amp = .12, seed = 1) {
    const m = geo.sphere(r, ws, hs);
    const s = seed * 12.9898;
    for (let i = 0; i < m.pos.length/3; i++) {
      const x = m.pos[i*3], y = m.pos[i*3+1], z = m.pos[i*3+2];
      const n = Math.sin(x*3.1 + s) * Math.cos(y*2.7 - s) * Math.sin(z*3.4 + s*1.7);
      const k = 1 + amp*n;
      m.pos[i*3] = x*k; m.pos[i*3+1] = y*k; m.pos[i*3+2] = z*k;
    }
    return geo.smooth(m);
  },
};

/* --------------------------------------------------------------- textures */

export const tex = {
  /** Build an HTMLCanvasElement procedurally. */
  canvas(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    draw(g, w, h);
    return c;
  },
  /** White 1x1 fallback. */
  white() { return tex.canvas(1, 1, g => { g.fillStyle = '#fff'; g.fillRect(0, 0, 1, 1); }); },
  /** Radial soft disc (shadow blobs, particle sprites, light pools). */
  softDisc(size = 64, inner = 'rgba(0,0,0,1)', outer = 'rgba(0,0,0,0)', core = .35) {
    return tex.canvas(size, size, (g, w) => {
      const gr = g.createRadialGradient(w/2, w/2, w*core*.5, w/2, w/2, w/2);
      gr.addColorStop(0, inner); gr.addColorStop(1, outer);
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
  },
  /** Speckled surface: base colour + fine grain, tileable. */
  grain(size, base, spots = 220, alpha = .18, radius = 3, seed = 7) {
    let s = seed;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return tex.canvas(size, size, (g, w) => {
      g.fillStyle = base; g.fillRect(0, 0, w, w);
      for (let i = 0; i < spots; i++) {
        const x = rnd()*w, y = rnd()*w, r = radius*(.4 + rnd()*1.6);
        const dark = rnd() > .5;
        g.fillStyle = `rgba(${dark?0:255},${dark?0:255},${dark?0:255},${alpha*rnd()})`;
        g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
      }
    });
  },
  /** Vertical gradient strip (skies, water, gradients on billboards). */
  vgrad(h, stops) {
    return tex.canvas(4, h, (g, w) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
  },
};

/* ---------------------------------------------------------------- render */

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec3 aCol; attribute vec2 aUV;
uniform mat4 uProj, uView, uModel; uniform mat3 uNM;
uniform float uOutline;
varying vec3 vN, vW; varying vec2 vUV; varying vec3 vC;
void main() {
  vec4 local = vec4(aPos + aNrm * uOutline, 1.0);
  vec4 w = uModel * local;
  vW = w.xyz; vN = uNM * aNrm; vUV = aUV; vC = aCol;
  gl_Position = uProj * uView * w;
}`;

const FS = `
precision mediump float;
varying vec3 vN, vW; varying vec2 vUV; varying vec3 vC;
uniform vec3 uColor, uLightDir, uLightCol, uSkyCol, uGndCol, uRimCol, uFogCol, uCamPos, uFlashCol;
uniform float uEmis, uSpec, uShine, uRim, uAlpha, uFogNear, uFogFar, uUnlit, uTexMode;
uniform float uToon, uFlash;
uniform sampler2D uTex;
void main() {
  vec3 base = vC * uColor;
  vec4 t = texture2D(uTex, vUV);
  float a = uAlpha;
  if (uTexMode > 0.5) {
    if (uTexMode < 1.5) { base *= t.rgb; a *= t.a; }
    else { base = uColor; a *= t.a; }
  }
  vec3 outCol;
  if (uUnlit > 0.5) { outCol = base; }
  else {
    vec3 N = normalize(vN);
    vec3 V = normalize(uCamPos - vW);
    vec3 L = normalize(uLightDir);
    float ndl = max(dot(N, L), 0.0);
    vec3 hemi = mix(uGndCol, uSkyCol, N.y * 0.5 + 0.5);
    // Gen VII look: hard stepped diffuse ramp instead of a smooth falloff
    float step1 = smoothstep(0.16, 0.30, ndl);
    float step2 = smoothstep(0.52, 0.64, ndl);
    float ramp = mix(ndl, 0.42 + 0.32 * step1 + 0.36 * step2, uToon);
    vec3 spec = vec3(0.0);
    if (uSpec > 0.0) {
      vec3 H = normalize(L + V);
      float s = max(dot(N, H), 0.0);
      float hard = mix(pow(s, uShine), step(0.72, s) * 0.8, uToon);
      spec = uLightCol * hard * uSpec;
    }
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * uRim;
    outCol = base * (hemi + uLightCol * ramp) + base * rim + spec + base * uEmis;
  }
  float d = length(uCamPos - vW);
  float f = clamp((d - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0) * (1.0 - uUnlit);
  outCol = mix(outCol, uFogCol, f);
  if (uFlash > 0.0) outCol = mix(outCol, uFlashCol, uFlash);
  gl_FragColor = vec4(outCol, a);
}`;

const POST_VS = `
attribute vec2 aP; varying vec2 vUV;
void main() { vUV = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;

const POST_FS = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uColor, uDepth;
uniform vec2 uPx;
uniform float uNear, uFar, uFocus, uRange, uMaxR;
void main() {
  vec4 c = texture2D(uColor, vUV);
  float d = texture2D(uDepth, vUV).r;
  float z = d * 2.0 - 1.0;
  float dz = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  float b = clamp((dz - uFocus) / uRange, 0.0, 1.0);
  b = b * b * (3.0 - 2.0 * b);
  if (b < 0.004) { gl_FragColor = c; return; }
  // two golden-angle rings: a cheap disc blur whose radius scales with defocus
  vec2 r = uPx * (uMaxR * b);
  vec4 sum = c;
  float w = 1.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float a = fi * 2.3999632;
    float rad = (i < 6 ? 0.55 : 1.0);
    vec2 o = vec2(cos(a), sin(a)) * r * rad;
    sum += texture2D(uColor, vUV + o);
    w += 1.0;
  }
  gl_FragColor = sum / w;
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export function initGL(canvas, opts = {}) {
  const gl = canvas.getContext('webgl', {
    antialias: true, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance',
  }) || canvas.getContext('experimental-webgl');
  if (!gl) throw new Error('WebGL unavailable');
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const A = { pos: gl.getAttribLocation(prog, 'aPos'), nrm: gl.getAttribLocation(prog, 'aNrm'),
              col: gl.getAttribLocation(prog, 'aCol'), uv: gl.getAttribLocation(prog, 'aUV') };
  const U = {};
  for (const n of ['uProj','uView','uModel','uNM','uColor','uLightDir','uLightCol','uSkyCol','uGndCol',
                   'uRimCol','uFogCol','uCamPos','uEmis','uSpec','uShine','uRim','uAlpha',
                   'uFogNear','uFogFar','uUnlit','uTexMode','uTex','uOutline','uToon','uFlash','uFlashCol'])
    U[n] = gl.getUniformLocation(prog, n);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0, 0, 0, 1);
  const uint32Ok = !!gl.getExtension('OES_element_index_uint');

  const whiteTex = uploadTexture(gl, tex.white());

  /* ------------------------------------------------ depth-of-field target */
  const depthTexOk = !!gl.getExtension('WEBGL_depth_texture');
  const post = (() => {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, POST_VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, POST_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    return {
      prog, quad,
      aP: gl.getAttribLocation(prog, 'aP'),
      u: {
        color: gl.getUniformLocation(prog, 'uColor'),
        depth: gl.getUniformLocation(prog, 'uDepth'),
        px: gl.getUniformLocation(prog, 'uPx'),
        near: gl.getUniformLocation(prog, 'uNear'),
        far: gl.getUniformLocation(prog, 'uFar'),
        focus: gl.getUniformLocation(prog, 'uFocus'),
        range: gl.getUniformLocation(prog, 'uRange'),
        maxR: gl.getUniformLocation(prog, 'uMaxR'),
      },
    };
  })();

  const fbo = { fb: gl.createFramebuffer(), color: null, depth: null, w: 0, h: 0 };
  function sizeFbo(w, h) {
    if (fbo.w === w && fbo.h === h) return;
    if (fbo.color) gl.deleteTexture(fbo.color);
    if (fbo.depth) gl.deleteTexture(fbo.depth);
    fbo.color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fbo.color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    fbo.depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fbo.depth);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbo.color, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, fbo.depth, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    fbo.w = w; fbo.h = h;
  }
  const dofOk = depthTexOk && !!post
    && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== undefined;

  function uploadTexture(g, src) {
    const t = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, t);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.REPEAT);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.REPEAT);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.generateMipmap(g.TEXTURE_2D);
    return t;
  }

  const ctx = {
    gl, canvas, U, A, prog,
    camPos: [0, 0, 0],
    stats: { entities: 0, parts: 0, tris: 0 },
    perf: { frames: 0, cpuMs: 0 },

    texture(src) { return uploadTexture(gl, src); },
    whiteTex,

    /** Upload a MeshData once. */
    mesh(data) {
      const m = { data, vbo: {}, dynamic: !!data.dynamic, capacity: data.capacity || data.pos.length/3 };
      const n = data.pos.length/3;
      m.count = data.count != null ? data.count : n;
      m.idxCount = data.idx ? (data.idxCount != null ? data.idxCount : data.idx.length) : 0;
      for (const k of ['pos','nrm','col','uv']) {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data[k], data.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
        m.vbo[k] = buf;
      }
      m.ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.idx, data.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      m.uint32 = data.idx instanceof Uint32Array;
      if (m.uint32 && !uint32Ok) throw new Error('mesh needs 32-bit indices but OES_element_index_uint is unavailable');
      return m;
    },

    /** Re-upload a dynamic mesh's vertex data (first `count` vertices) and optional indices. */
    updateMesh(m, data, count) {
      const n = Math.min(m.capacity, count != null ? count : (data.count != null ? data.count : data.pos.length/3));
      m.count = n; data.count = n;
      for (const [k, per] of [['pos',3],['nrm',3],['col',3],['uv',2]]) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo[k]);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data[k].subarray(0, n*per));
      }
      if (data.idx && data.idxCount) {
        m.idxCount = data.idxCount;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, data.idx.subarray(0, data.idxCount));
      }
    },

    /** Ensure a part's mesh exists, then re-upload its (dynamic) geometry. */
    sync(part, count) {
      if (!part.mesh) part.mesh = ctx.mesh(part.geo);
      ctx.updateMesh(part.mesh, part.geo, count != null ? count : part.geo.count);
      return part.mesh;
    },

    resize() {
      const dpr = Math.min(opts.dpr || (window.devicePixelRatio || 1), 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        return true;
      }
      return false;
    },
    primeShadows() { return primeShadows(ctx); },

    /** Prepare (and if needed resize) the depth-of-field target. Returns false when unavailable. */
    beginPost(w, h) {
      if (!dofOk) return false;
      sizeFbo(w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
      return true;
    },

    /** Draw the blurred composite of the offscreen scene to the default framebuffer. */
    endPost(cfg, camera, w, h) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(post.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, post.quad);
      gl.enableVertexAttribArray(post.aP);
      gl.vertexAttribPointer(post.aP, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fbo.color);
      gl.uniform1i(post.u.color, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fbo.depth);
      gl.uniform1i(post.u.depth, 1);
      gl.uniform2f(post.u.px, 1 / w, 1 / h);
      gl.uniform1f(post.u.near, camera.near || 0.1);
      gl.uniform1f(post.u.far, camera.far || 400);
      gl.uniform1f(post.u.focus, cfg.focus);
      gl.uniform1f(post.u.range, cfg.range);
      gl.uniform1f(post.u.maxR, cfg.maxBlur * (h / 480));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.useProgram(ctx.prog);
    },

    hasDOF: dofOk,
  };
  primeShadows(ctx);
  return ctx;
}

const DEFAULTS = {
  light: { dir: [-0.45, 0.82, 0.35], col: [0.55, 0.53, 0.46], sky: [0.42, 0.47, 0.55], gnd: [0.20, 0.19, 0.16], rim: 0.22 },
  fog: { col: [0.62, 0.78, 0.86], near: 30, far: 160 },
};

function setUniforms(ctx, part, model, nm, projView) {
  const gl = ctx.gl, U = ctx.U;
  gl.uniformMatrix4fv(U.uModel, false, model);
  gl.uniformMatrix3fv(U.uNM, false, nm);
  gl.uniform3fv(U.uColor, part.col || WHITE3);
  gl.uniform1f(U.uEmis, part.emis || 0);
  gl.uniform1f(U.uSpec, part.spec != null ? part.spec : 0.14);
  gl.uniform1f(U.uShine, part.shine != null ? part.shine : 24);
  gl.uniform1f(U.uRim, part.rim != null ? part.rim : 1);
  gl.uniform1f(U.uAlpha, part.alpha != null ? part.alpha : 1);
  gl.uniform1f(U.uUnlit, part.unlit ? 1 : 0);
  gl.uniform1f(U.uTexMode, part.texMode || 0);
  gl.uniform1f(U.uToon, part.toon != null ? part.toon : (ctx.toon != null ? ctx.toon : 1));
  gl.uniform1i(U.uTex, 0);
}
const WHITE3 = new Float32Array([1, 1, 1]);
const _m = new Float32Array(16);
const _nm = new Float32Array(9);
const _local = new WeakMap();

function partMatrix(part, out) {
  return M.compose(part.p || ORIGIN, part.r || ORIGIN, part.s != null ? part.s : 1, out);
}
const ORIGIN = [0, 0, 0];

export function render(ctx, state, t) {
  const gl = ctx.gl;
  ctx.resize();
  const W = ctx.canvas.width, H = ctx.canvas.height;

  const dofCfg = state.dof && state.dof !== true
    ? state.dof
    : (state.dof === false ? null : { focus: 9, range: 34, maxBlur: 7 });
  const usePost = !!dofCfg && ctx.beginPost(W, H);
  if (!usePost) gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);

  const L = state.light || DEFAULTS.light;
  const F = state.fog || DEFAULTS.fog;
  const cam = state.cam || { pos: [0, 3, 6], look: [0, 1, 0], fov: 40 };
  ctx.camPos = cam.pos;

  const aspect = ctx.canvas.width / Math.max(1, ctx.canvas.height);
  const proj = M.persp(cam.fov || 40, aspect, cam.near || 0.1, cam.far || 400);
  const view = M.lookAt(cam.pos, cam.look, cam.up || [0, 1, 0]);

  const clear = state.clearColor || [0.55, 0.75, 0.9];
  gl.clearColor(clear[0], clear[1], clear[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);

  gl.useProgram(ctx.prog);
  gl.uniformMatrix4fv(ctx.U.uProj, false, proj);
  gl.uniformMatrix4fv(ctx.U.uView, false, view);
  gl.uniform3fv(ctx.U.uLightDir, L.dir);
  gl.uniform3fv(ctx.U.uLightCol, L.col);
  gl.uniform3fv(ctx.U.uSkyCol, L.sky);
  gl.uniform3fv(ctx.U.uGndCol, L.gnd);
  gl.uniform3f(ctx.U.uRimCol, 1, 1, 1);
  gl.uniform3fv(ctx.U.uFogCol, F.col);
  gl.uniform1f(ctx.U.uFogNear, F.near);
  gl.uniform1f(ctx.U.uFogFar, F.far);
  gl.uniform3fv(ctx.U.uCamPos, cam.pos);
  gl.uniform1f(ctx.U.uFlash, state.flash || 0);
  gl.uniform3fv(ctx.U.uFlashCol, state.flashCol || WHITE3);
  ctx.toon = state.toon != null ? state.toon : 1;
  gl.activeTexture(gl.TEXTURE0);

  gl.disable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  ctx.stats.parts = 0; ctx.stats.entities = 0; ctx.stats.tris = 0;

  // Pre-compute part world matrices (parts may chain via `parent`).
  const drawList = [];
  for (const e of state.entities) {
    if (e.hidden) continue;
    const model = e.model;
    if (!model) continue;
    const world = M.compose(e.pos || ORIGIN, e.rot || ORIGIN,
                            e.scale != null ? e.scale : 1, new Float32Array(16));
    const parts = model.parts;
    let local = _local.get(model);
    if (!local || local.length !== parts.length) {
      local = parts.map(() => new Float32Array(16));
      _local.set(model, local);
    }
    for (let i = 0; i < parts.length; i++) {
      partMatrix(parts[i], local[i]);
    }
    const worlds = new Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const w = new Float32Array(16);
      if (p.parent != null && worlds[p.parent]) M.mul(worlds[p.parent], local[i], w);
      else M.mul(world, local[i], w);
      if (p.billboard) {
        // orientation from camera basis, position+size from the accumulated matrix
        const sz = Math.hypot(w[0], w[1], w[2]);
        w[0] = view[0]*sz; w[1] = view[4]*sz; w[2] = view[8]*sz; w[3] = 0;
        w[4] = view[1]*sz; w[5] = view[5]*sz; w[6] = view[9]*sz; w[7] = 0;
        w[8] = view[2]*sz; w[9] = view[6]*sz; w[10] = view[10]*sz; w[11] = 0;
      }
      worlds[i] = w;
    }
    ctx.stats.entities++;
    // split opaque / transparent, keeps draw order stable
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const transparent = (p.alpha != null && p.alpha < 1) || p.blend;
      drawList.push({ p, m: worlds[i], transparent: !!transparent });
    }
  }

  const drawPart = ({ p, m }) => {
    if (!p.mesh) {
      p.mesh = ctx.mesh(p.geo);
      if (p.geo.dynamic) p.geoHandle = p.mesh;
    }
    const g = p.mesh;
    ctx.stats.parts++; ctx.stats.tris += g.idxCount / 3;
    drawMesh(ctx, g, p, m);
  };

  // --- Gen VII inverted-hull outlines: a second, black, front-face-culled pass with the
  //     vertices pushed along their normals. Skipped for sprites, glows and unlit sheets.
  const outlineW = state.outlineW != null ? state.outlineW : 0.012;
  if (state.outlines !== false && outlineW > 0) {
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.uniform1f(ctx.U.uOutline, outlineW);
    gl.uniform1f(ctx.U.uUnlit, 1);
    gl.uniform1f(ctx.U.uTexMode, 0);
    gl.uniform1f(ctx.U.uEmis, 0);
    gl.uniform1f(ctx.U.uSpec, 0);
    gl.uniform1f(ctx.U.uRim, 0);
    gl.uniform3f(ctx.U.uColor, 0, 0, 0);
    gl.uniform1f(ctx.U.uFlash, 0);
    for (const d of drawList) {
      const p = d.p;
      if (p.unlit || p.blend || p.billboard || p.doubleSided || p.cull === 'none' || p.outline === false) continue;
      if (p.alpha != null && p.alpha < 1) continue;
      if (!p.mesh) p.mesh = ctx.mesh(p.geo);
      drawMesh(ctx, p.mesh, p, d.m, { cull: 'front', noBlend: true });
    }
    gl.uniform1f(ctx.U.uOutline, 0);
    gl.uniform1f(ctx.U.uUnlit, 0);
    gl.uniform1f(ctx.U.uFlash, state.flash || 0);
  }

  for (const d of drawList) if (!d.transparent) drawPart(d);

  // Contact shadows: dark soft discs on the ground plane.
  if (state.shadows !== false) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.uniform1f(ctx.U.uUnlit, 1);
    gl.uniform1f(ctx.U.uTexMode, 2);
    gl.uniform1f(ctx.U.uEmis, 0);
    gl.bindTexture(gl.TEXTURE_2D, ctx.shadowTex || (ctx.shadowTex = ctx.texture(tex.softDisc(64, 'rgba(0,0,0,1)', 'rgba(0,0,0,0)', 0.15))));
    gl.bindBuffer(gl.ARRAY_BUFFER, ctx._shadowQuad.vbo.pos);
    for (const e of state.entities) {
      if (e.hidden || !e.shadow) continue;
      const r = e.shadow.r || 1, a = e.shadow.alpha != null ? e.shadow.alpha : 0.42;
      gl.uniform3f(ctx.U.uColor, 0, 0, 0);
      gl.uniform1f(ctx.U.uAlpha, a);
      M.compose([e.pos[0], (state.groundY != null ? state.groundY : 0) + 0.02, e.pos[2]],
                [0, 0, 0], [r*2, 1, r*2], _m);
      gl.uniformMatrix4fv(ctx.U.uModel, false, _m);
      M.normal3(_m, _nm); gl.uniformMatrix3fv(ctx.U.uNM, false, _nm);
      drawRawMesh(ctx, ctx._shadowQuad);
    }
  }

  for (const d of drawList) if (d.transparent) drawPart(d);

  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.enable(gl.CULL_FACE);
  gl.uniform1f(ctx.U.uUnlit, 0);
  gl.uniform1f(ctx.U.uTexMode, 0);
  gl.uniform1f(ctx.U.uOutline, 0);
  gl.uniform1f(ctx.U.uFlash, 0);

  if (usePost) ctx.endPost(dofCfg, cam, W, H);
}

/** Bind a mesh's attribute buffers (positions, normals, colours, uv, indices). */
function bindMesh(ctx, g) {
  const gl = ctx.gl, A = ctx.A;
  gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(A.pos);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo.nrm); gl.vertexAttribPointer(A.nrm, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(A.nrm);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo.col); gl.vertexAttribPointer(A.col, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(A.col);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo.uv); gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(A.uv);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.ibo);
}

/** One part, one draw call. `opts.cull` forces a face; `opts.noBlend` keeps it opaque. */
function drawMesh(ctx, g, p, matrix, opts = {}) {
  const gl = ctx.gl;
  const nm = M.normal3(matrix, _nm);
  setUniforms(ctx, p, matrix, nm);
  bindMesh(ctx, g);
  gl.bindTexture(gl.TEXTURE_2D, p.tex || ctx.whiteTex);
  if (opts.cull) { gl.enable(gl.CULL_FACE); gl.cullFace(opts.cull === 'front' ? gl.FRONT : gl.BACK); }
  else if (p.doubleSided || p.cull === 'none') gl.disable(gl.CULL_FACE);
  else { gl.enable(gl.CULL_FACE); gl.cullFace(p.cull === 'front' ? gl.FRONT : gl.BACK); }
  if (opts.noBlend) { gl.disable(gl.BLEND); gl.depthMask(true); }
  else if (p.blend === 'add') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false); }
  else if (p.alpha != null && p.alpha < 1) {
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
  } else { gl.disable(gl.BLEND); gl.depthMask(true); }
  gl.drawElements(gl.TRIANGLES, g.idxCount, g.uint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
}

function drawRawMesh(ctx, m) {
  const gl = ctx.gl;
  bindMesh(ctx, m);
  gl.drawElements(gl.TRIANGLES, m.idxCount, m.uint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
}

/** Install the shared shadow-blob quad on a context (called by initGL wrapper). */
export function primeShadows(ctx) {
  ctx.shadowTex = ctx.texture(tex.softDisc(64, 'rgba(0,0,0,1)', 'rgba(0,0,0,0)', 0.15));
  ctx._shadowQuad = ctx.mesh(geo.disc(0.5, 24));
  return ctx;
}
