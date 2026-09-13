// gl.js: WebGL bootstrap. Owns context, shaders, frame render.
// Contract: render(state, t) draws the full 3D scene. Piece builders
// implement scene content in models.js / arena.js / camera.js / effects.js
// and call the helpers here. main.js and battle.js never touch GL directly.
export let gl = null;

const VSRC = `
attribute vec3 aPos;
attribute vec3 aCol;
attribute vec3 aNormal;
attribute vec2 aTexUV;
uniform mat4 uMVP;
varying vec3 vCol;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUV;
void main(){ gl_Position = uMVP * vec4(aPos, 1.0); vCol = aCol; vNormal = aNormal; vWorld = aPos; vUV = aTexUV; }`;
const FSRC = `
precision mediump float;
varying vec3 vCol;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUV;
uniform vec3 uLightDir;
uniform sampler2D uTex;
uniform vec3 uCamPos;
uniform float uRim;
uniform float uUseTex;
uniform float uSpec;
void main(){
  // Base: cel lambert when lit, raw vertex color on the unlit path.
  // Old 6-float draws take the unlit branch exactly as before.
  float nl = length(vNormal);
  vec3 base;
  if (nl < 0.01) { base = vCol; }
  else {
    vec3 n = vNormal / nl;
    vec3 l = uLightDir / length(uLightDir);
    float d = max(dot(n, l), 0.0);
    float band = d > 0.66 ? 1.0 : (d > 0.33 ? 0.72 : 0.48);
    base = vCol * band;
  }
  // Detail texture multiplies the base only on the textured path (uUseTex 1).
  // Untextured draws (uUseTex 0) use raw base: byte-identical to the old
  // white-texel multiply (white is exactly 1.0, but this skips the fetch).
  vec3 col;
  vec4 texel = vec4(1.0);
  if (uUseTex > 0.5) { texel = texture2D(uTex, vUV); col = base * texel.rgb; }
  else { col = base; }
  // Blinn-Phong specular: textured + lit path only. H = normalize(L + V),
  // spec = pow(max(dot(N,H),0),24) * texel.a * uSpec, added white.
  // Zero-normal (unlit) callers skip it; uUseTex 0 gates old paths off.
  if (uUseTex > 0.5 && uSpec > 0.0 && nl >= 0.01) {
    vec3 n2 = vNormal / nl;
    vec3 l2 = uLightDir / length(uLightDir);
    vec3 vv2 = uCamPos - vWorld;
    float vl2 = length(vv2);
    if (vl2 > 0.001) {
      vec3 hv = normalize(l2 + vv2 / vl2);
      float s = pow(max(dot(n2, hv), 0.0), 24.0);
      col += vec3(s * texel.a * uSpec);
    }
  }
  // Cool white-blue fresnel rim, only when lit AND uRim != 0.
  if (nl >= 0.01 && uRim != 0.0) {
    vec3 n = vNormal / nl;
    vec3 vv = uCamPos - vWorld;
    float vl = length(vv);
    if (vl > 0.001) {
      vv = vv / vl;
      float f = pow(1.0 - abs(dot(n, vv)), 3.0);
      col += vec3(0.62, 0.78, 1.0) * (f * uRim);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function shader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// One-time GL state + perf counters (additive; existing exports unchanged).
let attribsOn = false;
// Tracks the aNormal array: ON inside drawTrisN, OFF everywhere else so old
// 6-float callers read the disabled-attrib constant (0,0,0,1) -> zero-length
// normal -> unlit fallback, byte-identical pixels to the old shader.
let litOn = false;
// Tracks the aTexUV array: ON only inside the textured path; OFF everywhere
// else so old 6/9-float callers sample the white 1x1 texture (UV value
// irrelevant -> texel always white -> base color unchanged, pixel-identical).
let uvOn = false;
// Last context for immediate setCamPos/setRim uploads; camera default
// matches the battle fallback eye until battle.js calls setCamPos(cam.eye).
let lastCtx = null;
let camPos = [2.5, 3.2, 9.5];
// Default 1x1 white texture: bound in render() and after every textured
// draw, so untextured callers always sample white.
let whiteTex = null;
function makeWhiteTex() {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
 const perf = { staticUploads: 0, staticBytes: 0, staticDraws: 0, streamDraws: 0, streamBytes: 0, dropped: 0 };
 // Snapshot of upload/draw counters for the main.js fps meter.
 export function getPerfStats() { return { ...perf }; }

export function initGL(canvas) {
  gl = canvas.getContext("webgl", { antialias: true });
  if (!gl) throw new Error("WebGL unavailable");
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VSRC));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FSRC));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  gl.enable(gl.DEPTH_TEST);
  const ctx = {
    prog,
    aPos: gl.getAttribLocation(prog, "aPos"),
    aCol: gl.getAttribLocation(prog, "aCol"),
    aNormal: gl.getAttribLocation(prog, "aNormal"),
    aTexUV: gl.getAttribLocation(prog, "aTexUV"),
    uMVP: gl.getUniformLocation(prog, "uMVP"),
    uLightDir: gl.getUniformLocation(prog, "uLightDir"),
    uTex: gl.getUniformLocation(prog, "uTex"),
    uCamPos: gl.getUniformLocation(prog, "uCamPos"),
    uRim: gl.getUniformLocation(prog, "uRim"),
    uUseTex: gl.getUniformLocation(prog, "uUseTex"),
    uSpec: gl.getUniformLocation(prog, "uSpec"),
  };
  // Attribute arrays stay enabled for the life of the context; per-draw code
  // only rebinds + repoints (the bind is what each pointer captures).
  // aNormal stays DISABLED here: old 6-float draws then take the unlit path.
  gl.enableVertexAttribArray(ctx.aPos);
  gl.enableVertexAttribArray(ctx.aCol);
  if (ctx.aNormal >= 0) gl.disableVertexAttribArray(ctx.aNormal);
  if (ctx.aTexUV >= 0) gl.disableVertexAttribArray(ctx.aTexUV);
  attribsOn = true;
  litOn = false;
  uvOn = false;
  lastCtx = ctx;
  whiteTex = makeWhiteTex();
  gl.uniform1i(ctx.uTex, 0);
  gl.uniform3f(ctx.uCamPos, camPos[0], camPos[1], camPos[2]);
  gl.uniform1f(ctx.uRim, 0);
  gl.uniform1f(ctx.uUseTex, 0);
  if (ctx.uSpec) gl.uniform1f(ctx.uSpec, 0.9);
  // A new context invalidates every cached GPU buffer; drop streaming state
  // so re-init (tests, context restore) rebuilds instead of binding dead
  // cross-context buffers (WebGL reports INVALID_OPERATION on those).
  streamBuf = null; scratch = null; streamBufN = null; scratchN = null;
  streamBufNT = null; scratchNT = null;
  return ctx;
}

// ---- Zero-churn mesh helpers: identical pixels, minimal GL state work. ----
// Every mesh here is interleaved [x,y,z, r,g,b], 24-byte stride.
const STRIDE = 24;
// Lit meshes interleave [x,y,z, r,g,b, nx,ny,nz], 36-byte stride.
const STRIDE9 = 36;
// Streaming ceiling: dynamic draws (rebuilt model arrays, fx particles) are
// truncated past this. ~4x headroom over today's worst case (~800 tris idle,
// <=450 capped particles x 1 tri + ~300 model tris in combat), so the cap
// never clips real content; it bounds worst-case upload size. effects.js
// keeps its own MAX_P=450 particle cap; this is the backstop.
export const STREAM_CAP_TRIS = 4096;

function ensureAttribs(ctx) {
  if (!attribsOn) {
    gl.enableVertexAttribArray(ctx.aPos);
    gl.enableVertexAttribArray(ctx.aCol);
    attribsOn = true;
  }
  // Old 6-float path must read the disabled-attrib constant as its normal.
  if (litOn && ctx.aNormal >= 0) {
    gl.disableVertexAttribArray(ctx.aNormal);
    litOn = false;
  }
  // Untextured paths leave aTexUV disabled (white-texel identity).
  if (uvOn && ctx.aTexUV >= 0) {
    gl.disableVertexAttribArray(ctx.aTexUV);
    uvOn = false;
  }
  // Old callers never opt into rim or texture/spec: force both off so a
  // prior textured draw cannot leak fresnel or specular into old pixels.
  if (ctx.uRim) gl.uniform1f(ctx.uRim, 0);
  if (ctx.uUseTex) gl.uniform1f(ctx.uUseTex, 0);
}
// Lit 9-float path: aNormal array ON.
function ensureLitAttribs(ctx) {
  if (!attribsOn) {
    gl.enableVertexAttribArray(ctx.aPos);
    gl.enableVertexAttribArray(ctx.aCol);
    attribsOn = true;
  }
  if (!litOn && ctx.aNormal >= 0) {
    gl.enableVertexAttribArray(ctx.aNormal);
    litOn = true;
  }
  if (uvOn && ctx.aTexUV >= 0) {
    gl.disableVertexAttribArray(ctx.aTexUV);
    uvOn = false;
  }
  if (ctx.uRim) gl.uniform1f(ctx.uRim, 0);
  if (ctx.uUseTex) gl.uniform1f(ctx.uUseTex, 0);
}
// Textured 11-float path: aNormal + aTexUV arrays ON.
function ensureTexAttribs(ctx) {
  if (!attribsOn) {
    gl.enableVertexAttribArray(ctx.aPos);
    gl.enableVertexAttribArray(ctx.aCol);
    attribsOn = true;
  }
  if (!litOn && ctx.aNormal >= 0) {
    gl.enableVertexAttribArray(ctx.aNormal);
    litOn = true;
  }
  if (!uvOn && ctx.aTexUV >= 0) {
    gl.enableVertexAttribArray(ctx.aTexUV);
    uvOn = true;
  }
  // Textured path: sample the bound texture and allow Blinn-Phong specular.
  if (ctx.uUseTex) gl.uniform1f(ctx.uUseTex, 1);
}

function bindMesh(ctx, buf, mvp) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.vertexAttribPointer(ctx.aPos, 3, gl.FLOAT, false, STRIDE, 0);
  gl.vertexAttribPointer(ctx.aCol, 3, gl.FLOAT, false, STRIDE, 12);
  gl.uniformMatrix4fv(ctx.uMVP, false, mvp);
}

// Static mesh: uploaded once (STATIC_DRAW), redrawn with zero re-uploads.
export function createMesh(data) {
  const arr = data instanceof Float32Array ? data : new Float32Array(data);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
  perf.staticUploads++;
  perf.staticBytes += arr.byteLength;
  return { buf, count: arr.length / 6 };
}

export function drawMesh(ctx, mesh, mvp) {
  ensureAttribs(ctx);
  bindMesh(ctx, mesh.buf, mvp);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  perf.staticDraws++;
}

// Streaming path: one shared GPU buffer + one reusable CPU scratch array.
// Re-uploaded per draw (DYNAMIC_DRAW) but never created/deleted per frame.
let streamBuf = null;
let scratch = null;
export function drawDynTris(ctx, data, mvp) {
  ensureAttribs(ctx);
  let count = data.length / 6;
  if (count > STREAM_CAP_TRIS) { perf.dropped += count - STREAM_CAP_TRIS; count = STREAM_CAP_TRIS; }
  if (count <= 0) return;
  const need = Math.ceil(count) * 6;
  if (!scratch || scratch.length < need) scratch = new Float32Array(Math.max(need, 1024));
  if (!streamBuf) streamBuf = gl.createBuffer();
  if (need < data.length) {
    if (data instanceof Float32Array) scratch.set(data.subarray(0, need));
    else for (let i = 0; i < need; i++) scratch[i] = data[i];
  } else {
    scratch.set(data);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, streamBuf);
  gl.bufferData(gl.ARRAY_BUFFER, scratch.subarray(0, need), gl.DYNAMIC_DRAW);
  perf.streamDraws++;
  perf.streamBytes += need * 4;
  gl.vertexAttribPointer(ctx.aPos, 3, gl.FLOAT, false, STRIDE, 0);
  gl.vertexAttribPointer(ctx.aCol, 3, gl.FLOAT, false, STRIDE, 12);
  gl.uniformMatrix4fv(ctx.uMVP, false, mvp);
  gl.drawArrays(gl.TRIANGLES, 0, count);
}

// Static-cache key discipline (no-accumulation proof): the ONLY inputs that
// reach staticCache are Float32Array instances, keyed by object identity in a
// WeakMap. arena.js passes its one stable cached soup (one entry, forever);
// models.js / effects.js build fresh plain Arrays every frame, which take the
// drawDynTris branch below and never touch the cache. A hypothetical fresh
// Float32Array per frame would add one WeakMap entry whose key dies with the
// caller's frame array, making the entry (and its mesh) collectable; the
// FinalizationRegistry then issues gl.deleteBuffer promptly, so GPU memory
// cannot accumulate either. Entries for live keys are never evicted (their
// bytes never change, so re-upload would be pure waste).
const staticCache = new WeakMap();
const meshFinalizer = typeof FinalizationRegistry !== "undefined"
  ? new FinalizationRegistry((buf) => { try { gl.deleteBuffer(buf); } catch {} })
  : null;
// Explicit teardown for builder-owned createMesh meshes (not needed for the
// drawTris cache, which the finalizer covers).
export function dropMesh(mesh) {
  if (!mesh) return;
  try { if (meshFinalizer) meshFinalizer.unregister(mesh); } catch {}
  try { if (mesh.buf) gl.deleteBuffer(mesh.buf); } catch {}
}
// Interleaved [x,y,z, r,g,b] triangles -> drawn with given MVP. Same pixels
// as before; immutable Float32Array inputs (arena's cached soup) upload once
// and redraw from a static VBO, fresh per-frame arrays (models, fx) reuse
// one streaming buffer instead of create/upload/delete per call.
export function drawTris(ctx, data, mvp) {
  if (data instanceof Float32Array) {
    let m = staticCache.get(data);
    if (!m) {
      m = createMesh(data);
      staticCache.set(data, m);
      try { if (meshFinalizer) meshFinalizer.register(m, m.buf, m); } catch {}
    }
    drawMesh(ctx, m, mvp);
    return;
  }
  drawDynTris(ctx, data, mvp);
}

// ---- Lit mesh helpers: interleaved [x,y,z, r,g,b, nx,ny,nz], 36-byte stride. ----
function bindMeshN(ctx, buf, mvp) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.vertexAttribPointer(ctx.aPos, 3, gl.FLOAT, false, STRIDE9, 0);
  gl.vertexAttribPointer(ctx.aCol, 3, gl.FLOAT, false, STRIDE9, 12);
  gl.vertexAttribPointer(ctx.aNormal, 3, gl.FLOAT, false, STRIDE9, 24);
  gl.uniformMatrix4fv(ctx.uMVP, false, mvp);
}

// Static lit mesh: uploaded once (STATIC_DRAW), redrawn with zero re-uploads.
export function createMeshN(data) {
  const arr = data instanceof Float32Array ? data : new Float32Array(data);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
  perf.staticUploads++;
  perf.staticBytes += arr.byteLength;
  return { buf, count: arr.length / 9 };
}

export function drawMeshN(ctx, mesh, mvp) {
  ensureLitAttribs(ctx);
  bindMeshN(ctx, mesh.buf, mvp);
  gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  perf.staticDraws++;
}

// Lit streaming path: separate buffer/scratch from the 6-float path (strides differ).
let streamBufN = null;
let scratchN = null;
export function drawDynTrisN(ctx, data, mvp) {
  ensureLitAttribs(ctx);
  let count = data.length / 9;
  if (count > STREAM_CAP_TRIS) { perf.dropped += count - STREAM_CAP_TRIS; count = STREAM_CAP_TRIS; }
  if (count <= 0) return;
  const need = Math.ceil(count) * 9;
  if (!scratchN || scratchN.length < need) scratchN = new Float32Array(Math.max(need, 1024));
  if (!streamBufN) streamBufN = gl.createBuffer();
  if (need < data.length) {
    if (data instanceof Float32Array) scratchN.set(data.subarray(0, need));
    else for (let i = 0; i < need; i++) scratchN[i] = data[i];
  } else {
    scratchN.set(data);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, streamBufN);
  gl.bufferData(gl.ARRAY_BUFFER, scratchN.subarray(0, need), gl.DYNAMIC_DRAW);
  perf.streamDraws++;
  perf.streamBytes += need * 4;
  gl.vertexAttribPointer(ctx.aPos, 3, gl.FLOAT, false, STRIDE9, 0);
  gl.vertexAttribPointer(ctx.aCol, 3, gl.FLOAT, false, STRIDE9, 12);
  gl.vertexAttribPointer(ctx.aNormal, 3, gl.FLOAT, false, STRIDE9, 24);
  gl.uniformMatrix4fv(ctx.uMVP, false, mvp);
  gl.drawArrays(gl.TRIANGLES, 0, count);
}

// Same cache discipline as drawTris (identity-keyed, finalizer-collected),
// keyed separately so 6-float and 9-float soups never collide.
const staticCacheN = new WeakMap();
// Interleaved [x,y,z, r,g,b, nx,ny,nz] triangles -> cel-lit with given MVP.
// Zero-normals take the unlit fallback (emissive/particles/sky path).
export function drawTrisN(ctx, data, mvp) {
  if (data instanceof Float32Array) {
    let m = staticCacheN.get(data);
    if (!m) {
      m = createMeshN(data);
      staticCacheN.set(data, m);
      try { if (meshFinalizer) meshFinalizer.register(m, m.buf, m); } catch {}
    }
    drawMeshN(ctx, m, mvp);
    return;
  }
  drawDynTrisN(ctx, data, mvp);
}

// ---- Textured mesh helpers: [x,y,z, r,g,b, nx,ny,nz, u,v], 44-byte stride. ----
// aPos doubles as the rim view-vector origin (callers bake world transforms
// into vertices, so it is already world space). tex defaults to the white
// 1x1 (pixel-identical base); uRim is left untouched so a setRim(v) call just
// before each batch applies. Old paths reset uRim to 0 via their ensures.
const STRIDE11 = 44;
let streamBufNT = null;
let scratchNT = null;
export function drawTrisNT(ctx, data11, mvp, tex) {
  ensureTexAttribs(ctx);
  let count = data11.length / 11;
  if (count > STREAM_CAP_TRIS) { perf.dropped += count - STREAM_CAP_TRIS; count = STREAM_CAP_TRIS; }
  if (count <= 0) return;
  const need = Math.ceil(count) * 11;
  if (!scratchNT || scratchNT.length < need) scratchNT = new Float32Array(Math.max(need, 1024));
  if (!streamBufNT) streamBufNT = gl.createBuffer();
  if (need < data11.length) {
    if (data11 instanceof Float32Array) scratchNT.set(data11.subarray(0, need));
    else for (let i = 0; i < need; i++) scratchNT[i] = data11[i];
  } else {
    scratchNT.set(data11);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, streamBufNT);
  gl.bufferData(gl.ARRAY_BUFFER, scratchNT.subarray(0, need), gl.DYNAMIC_DRAW);
  perf.streamDraws++;
  perf.streamBytes += need * 4;
  gl.vertexAttribPointer(ctx.aPos, 3, gl.FLOAT, false, STRIDE11, 0);
  gl.vertexAttribPointer(ctx.aCol, 3, gl.FLOAT, false, STRIDE11, 12);
  gl.vertexAttribPointer(ctx.aNormal, 3, gl.FLOAT, false, STRIDE11, 24);
  gl.vertexAttribPointer(ctx.aTexUV, 2, gl.FLOAT, false, STRIDE11, 36);
  gl.uniformMatrix4fv(ctx.uMVP, false, mvp);
  gl.bindTexture(gl.TEXTURE_2D, tex || whiteTex);
  gl.drawArrays(gl.TRIANGLES, 0, count);
  // Restore white so later untextured draws sample identity regardless of order.
  gl.bindTexture(gl.TEXTURE_2D, whiteTex);
}

// Procedural texture: runs painter(g2d, w, h) on an offscreen canvas, uploads
// as a LINEAR/CLAMP RGBA texture. Painter content is caller-owned original art.
export function createTex(w, h, painter) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  painter(g, w, h);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, whiteTex);
  return tex;
}

// Rim strength for the NEXT drawTrisNT batch (typical ~0.35). Call immediately
// before each textured batch; old paths force uRim back to 0 on their own.
// Tolerates setRim(ctx, v).
export function setRim(v, v2) {
  let val = v;
  let c = lastCtx;
  if (v && typeof v === "object" && typeof v2 === "number") { c = v; val = v2; }
  try { if (c && c.uRim) gl.uniform1f(c.uRim, +val || 0); } catch {}
}

// Camera eye for the rim view vector. Battle convention: setCamPos(cam.eye)
// any time after initGL (uploads immediately and stores for render re-upload).
export function setCamPos(e) {
  if (Array.isArray(e) && e.length >= 3) camPos = [e[0], e[1], e[2]];
  try { if (lastCtx && lastCtx.uCamPos) gl.uniform3f(lastCtx.uCamPos, camPos[0], camPos[1], camPos[2]); } catch {}
}

export function mat4mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
  o[0] = f / aspect; o[5] = f;
  o[10] = (far + near) / (near - far); o[11] = -1;
  o[14] = (2 * far * near) / (near - far);
  return o;
}

export function lookAt(eye, at, up) {
  const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export function render(ctx, state, t) {
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(0.45, 0.72, 0.95, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BIT);
  // Cool key from upper front-left; the fragment shader normalizes it.
  if (ctx.uLightDir) gl.uniform3f(ctx.uLightDir, -0.45, 0.8, 0.55);
  // Frame defaults: white texture on unit 0, stored camera, rim off.
  // Textured batches rebind per draw and restore white after.
  if (ctx.uTex) gl.uniform1i(ctx.uTex, 0);
  gl.bindTexture(gl.TEXTURE_2D, whiteTex);
  if (ctx.uCamPos) gl.uniform3f(ctx.uCamPos, camPos[0], camPos[1], camPos[2]);
  if (ctx.uRim) gl.uniform1f(ctx.uRim, 0);
  if (state.scene) state.scene(ctx, state, t);
}
