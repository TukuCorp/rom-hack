// gl.js: WebGL bootstrap. Owns context, shaders, frame render.
// Contract: render(state, t) draws the full 3D scene. Piece builders
// implement scene content in models.js / arena.js / camera.js / effects.js
// and call the helpers here. main.js and battle.js never touch GL directly.
export let gl = null;

const VSRC = `
attribute vec3 aPos;
attribute vec3 aCol;
uniform mat4 uMVP;
varying vec3 vCol;
void main(){ gl_Position = uMVP * vec4(aPos, 1.0); vCol = aCol; }`;
const FSRC = `
precision mediump float;
varying vec3 vCol;
void main(){ gl_FragColor = vec4(vCol, 1.0); }`;

function shader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

// One-time GL state + perf counters (additive; existing exports unchanged).
let attribsOn = false;
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
    uMVP: gl.getUniformLocation(prog, "uMVP"),
  };
  // Attribute arrays stay enabled for the life of the context; per-draw code
  // only rebinds + repoints (the bind is what each pointer captures).
  gl.enableVertexAttribArray(ctx.aPos);
  gl.enableVertexAttribArray(ctx.aCol);
  attribsOn = true;
  return ctx;
}

// ---- Zero-churn mesh helpers: identical pixels, minimal GL state work. ----
// Every mesh here is interleaved [x,y,z, r,g,b], 24-byte stride.
const STRIDE = 24;
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

// Placeholder scene: sky clear + ground disc handled by arena.js builder.
// render() stays working at every commit: builders replace pieces, never break boot.
export function render(ctx, state, t) {
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.clearColor(0.45, 0.72, 0.95, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BIT);
  if (state.scene) state.scene(ctx, state, t);
}
