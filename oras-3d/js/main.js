// main.js: boot + fixed-step loop. Never touches GL directly; gl.render
// draws state.scene (owned by piece builders). Battle runs async alongside.
import { initGL, render, getPerfStats } from "./gl.js";
import { state, runBattle } from "./battle.js";

const canvas = document.getElementById("gl");
const ctx = initGL(canvas);
// Live handles for the sync benchmark (invisible, measurement only).
window.__orasCtx = ctx;

// FPS meter: rAF deltas + render() CPU time over 5s windows. No visual
// change: results go to console + window.__orasFps, never onto canvas/HUD.
const fps = { deltas: [], renderMs: [], wins: 0 };
function summarize(d) {
  const s = [...d].sort((a, b) => a - b);
  const avg = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
  return { avg, p95: s[Math.floor(s.length * 0.95)] || 0 };
}
function reportWindow() {
  const f = summarize(fps.deltas);
  const r = summarize(fps.renderMs.length ? fps.renderMs : [0]);
  fps.wins++;
  window.__orasFps = {
    window: fps.wins, frames: fps.deltas.length,
    avgFps: 1000 / f.avg, avgMs: f.avg, p95Ms: f.p95,
    renderAvgMs: r.avg, gl: getPerfStats(),
  };
  console.log(`[oras-3d] fps ${window.__orasFps.avgFps.toFixed(1)} ` +
    `frame ${f.avg.toFixed(2)}ms p95 ${f.p95.toFixed(2)}ms ` +
    `render ${r.avg.toFixed(2)}ms`, window.__orasFps.gl);
  fps.deltas.length = 0;
  fps.renderMs.length = 0;
}
window.__orasFps = null;

let last = performance.now();
let winStart = last;
function frame(now) {
  const dt = now - last;
  last = now;
  if (dt > 0 && dt < 250) fps.deltas.push(dt); // ignore tab-switch gaps
  const t0 = performance.now();
  const t = now / 1000;
  render(ctx, state, t);
  fps.renderMs.push(performance.now() - t0);
  if (now - winStart >= 5000) { winStart = now; reportWindow(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
runBattle();
