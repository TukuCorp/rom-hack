// Engine: canvas, input (keyboard+touch), text box, screen stack, main loop.
export const W = 256, H = 192, TILE = 16;

export const canvas = document.getElementById("screen");
export const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// ---- input ----
export const keys = {};
const pressed = {}; // edge-triggered queue
window.addEventListener("keydown", (e) => {
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
  if (!keys[e.key]) pressed[e.key] = true;
  keys[e.key] = true;
});
window.addEventListener("keyup", (e) => { keys[e.key] = false; });

// logical buttons; also wired to on-screen touch controls + mouse clicks
export const input = {
  up: () => keys.ArrowUp || keys.w || keys.W,
  down: () => keys.ArrowDown || keys.s || keys.S,
  left: () => keys.ArrowLeft || keys.a || keys.A,
  right: () => keys.ArrowRight || keys.d || keys.D,
  a: () => keys.z || keys.Z || keys.j || keys.J,
  b: () => keys.x || keys.X || keys.k || keys.K,
  start: () => keys.Enter,
};
const EDGE_MAP = {};
export function pressedEdge(name) {
  // check raw keys for the mapped physical keys
  const map = {
    up: ["ArrowUp","w","W"], down: ["ArrowDown","s","S"],
    left: ["ArrowLeft","a","A"], right: ["ArrowRight","d","D"],
    a: ["z","Z","j","J"], b: ["x","X","k","K"], start: ["Enter"],
  }[name] || [];
  for (const k of map) {
    if (pressed[k]) { pressed[k] = false; return true; }
  }
  return false;
}
export function clearPressed() { for (const k in pressed) pressed[k] = false; }

// touch buttons set these virtual keys
export function bindTouch() {
  document.querySelectorAll("[data-key]").forEach((el) => {
    const k = el.dataset.key;
    const dn = (e) => { e.preventDefault(); if (!keys[k]) pressed[k] = true; keys[k] = true; };
    const up = (e) => { e.preventDefault(); keys[k] = false; };
    el.addEventListener("pointerdown", dn);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", up);
    el.addEventListener("pointercancel", up);
  });
}

// ---- DS chrome helpers: rounded panels, 1-bit proportional bitmap font ----
// HGSS look: off-white rounded panels, dark-navy outer border + pale-blue
// inner border (double border), soft drop shadow, hand-drawn 5x7-ish 1-bit
// glyphs stamped as crisp fillRect pixels (no smoothing, no canvas text).
// Per-glyph advance widths + 1px letter spacing; measure() shares the draw
// advances so name-plate/padding/clamp math keeps working. Chars absent
// from BIT_G fall back to the canvas font (missing glyphs only).
const DS_FONT = 'Tahoma, Verdana, "DejaVu Sans", sans-serif';
const DS_SIZE = 8;          // HGSS body glyph size (bitmap cap height 7px)
const DS_BASELINE = 7;      // ascent px: top-anchored y -> baseline pixel row
const DS_LINE_H = 10;       // tight HGSS textbox line step (9px glyph + 1px gap)
const DS_MENU_RH = 12;      // tight menu row step
const ARROW_PERIOD = 480;   // ms per blink phase (HGSS ~1Hz arrow blink)

// Hand-drawn 1-bit glyphs: "." = empty, "#" = ink. Row 0 is the cap top;
// the last body row sits one pixel above the baseline (y + DS_BASELINE).
// Lowercase x-height glyphs are 5-6 rows (top gap), ascenders 7 rows.
// Glyphs named in BIT_D extend that many rows below the baseline.
const BIT_G = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["...##", "....#", "....#", "....#", "....#", "#...#", ".###."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  a: [".##.", "...#", ".###", "#..#", "#..#", ".##."],
  b: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
  c: [".###.", "#....", "#....", "#....", ".###."],
  d: ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  e: [".###.", "#...#", "#####", "#....", ".###."],
  f: ["..##.", "...#.", "...#.", "####.", "...#.", "...#.", "...#."],
  g: [".####", "#...#", "#...#", ".####", "....#", ".###.", "...#.", ".##.."],
  h: ["#....", "#....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  i: ["#", "", "#", "#", "#", "#", "#"],
  j: [" #", "", " #", " #", " #", " #", " #", "##", "##"],
  k: ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
  l: ["#", "#", "#", "#", "#", "#", "#"],
  m: [".....", "#.#.#", "##.##", "#.#.#", "#.#.#", "#.#.#"],
  n: [".....", "#.##.", "##..#", "#...#", "#...#", "#...#"],
  o: [".###.", "#...#", "#...#", "#...#", ".###."],
  p: ["#....", "#....", "####.", "#...#", "#...#", "####.", "#....", "#...."],
  q: ["....#", "....#", ".####", "#...#", "#...#", ".####", "....#", "....#"],
  r: [".....", "#.##.", "##..#", "#....", "#....", "#...."],
  s: [".####", "#....", ".###.", "....#", "####."],
  t: [".#..", ".#..", "###.", ".#..", ".#..", ".#..", ".##."],
  u: ["#...#", "#...#", "#...#", "#...#", ".###."],
  v: [".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  w: [".....", "#...#", "#...#", "#.#.#", "#.#.#", "##.##"],
  x: [".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", ".#..."],
  z: [".....", "#####", "...#.", "..#..", ".#...", "#####"],
  0: [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  1: ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  2: [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  3: ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  4: ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  5: ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  6: [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  7: ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  8: [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  9: [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  ":": ["", "#", "", "", "", "#", ""],
  ".": ["#"],
  ",": ["#", "#"],
  "!": ["#", "#", "#", "#", "#", "", "#"],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "-": ["", "", "", "####", "", "", ""],
  "/": ["....#", "....#", "...#.", "...#.", "..#..", ".#...", "#...."],
  "%": ["##..#", "##..#", "..#..", "..#..", ".#...", "#..##", "#..##"],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "'": ["#", "#", "", "", "", "", ""],
  "(": ["..#", ".#.", "#..", "#..", "#..", ".#.", "..#"],
  ")": ["#..", ".#.", "..#", "..#", "..#", ".#.", "#.."],
  "\u00e9": ["...#.", "..#..", ".###.", "#...#", "#####", "#....", ".###."],
  ";": ["", "#", "", "", "", "#", "#"],
  "♂": [".###.#", "#.#.#", "#.###", ".###.", "..#.."],
  "♀": [".###.", "#.#.#", ".###.", "..#..", ".###.", "..#.."],
};
const BIT_D = { g: 2, j: 2, p: 2, q: 2, ",": 1, ";": 1, y: 1 };

function dsFont(size, bold) {
  return `${bold ? "bold " : ""}${size}px ${DS_FONT}`;
}

// ink width of a glyph's rows (space = 2px); -1 when the canvas fallback owns it
function bitW(ch) {
  if (ch === " ") return 2;
  const rows = BIT_G[ch];
  if (!rows) return -1;
  let w = 0;
  for (const row of rows) if (row.length > w) w = row.length;
  return w;
}
function rr(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
// variable-width measure through the bitmap advances (never char-count * N)
export function measure(g, s, size = DS_SIZE, bold = false) {
  s = String(s);
  if (!s.length) return 0;
  let w = 0;
  for (const ch of s) {
    const bw = bitW(ch);
    if (bw < 0) {
      // fallback char: canvas width, same +1px spacing as the bitmap path
      g.save();
      g.font = dsFont(size, bold);
      w += Math.ceil(g.measureText(ch).width) + 1;
      g.restore();
      continue;
    }
    w += bw + 1 + (bold ? 1 : 0);
  }
  return w - 1; // drop trailing letter spacing
}
function triR(g, x, y, s, color) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y + s);
  g.lineTo(x + s * 0.9, y + s / 2);
  g.closePath();
  g.fill();
}
function triD(g, cx, y, s, color) {
  // white edge under the red arrow so it reads on the off-white panel
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.moveTo(cx - s / 2 - 1, y - 1);
  g.lineTo(cx + s / 2 + 1, y - 1);
  g.lineTo(cx, y + s + 1);
  g.closePath();
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(cx - s / 2, y);
  g.lineTo(cx + s / 2, y);
  g.lineTo(cx, y + s);
  g.closePath();
  g.fill();
}
function arrowOn(period = ARROW_PERIOD) {
  return Math.floor(performance.now() / period) % 2 === 0;
}
function panelChrome(g, x, y, w, h) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  g.save();
  // drop shadow (offset, translucent, same rounded shape)
  g.fillStyle = "rgba(0,0,0,0.35)";
  rr(g, x + 1, y + 2, w, h, 3); g.fill();
  // off-white face
  g.fillStyle = "#fbfbf0";
  rr(g, x, y, w, h, 3); g.fill();
  // double border: dark navy outer + pale blue inner
  g.lineWidth = 1; g.strokeStyle = "#334f80";
  rr(g, x + 2.5, y + 2.5, w - 5, h - 5, 2); g.stroke();
  g.strokeStyle = "#a9c1e6";
  rr(g, x + 4, y + 4, w - 8, h - 8, 2); g.stroke();
  g.restore();
}

// TextBox line prep: greedy word wrap to the HW body width via measure().
// Box metrics mirror draw(): bw = W - 8 with 10px text pads each side.
const BOX_MAXW = W - 8 - 20;
let _boxMC = null;
function boxMC() {
  if (!_boxMC) _boxMC = document.createElement("canvas").getContext("2d");
  return _boxMC;
}
// Greedy word wrap of one raw line; overlong words break char by char.
// Returns the wrapped lines ([""] for blank input, so explicit \n survive).
function wrapBoxLine(line, maxW) {
  const mc = boxMC();
  const toks = String(line).split(/(\s+)/).filter((t) => t.length);
  if (!toks.length) return [""];
  const out = [];
  const breakWord = (w) => {
    let part = "";
    for (const ch of w) {
      const t = part + ch;
      if (!part.length || measure(mc, t) <= maxW) part = t;
      else { out.push(part); part = ch; }
    }
    return part;
  };
  let cur = "";
  const pushGap = (n) => {
    for (let k = 0; k < n; k++) {
      const trial = cur + " ";
      if (measure(mc, trial) <= maxW) cur = trial;
      else { out.push(cur); cur = ""; }
    }
  };
  for (const t of toks) {
    if (/^\s+$/.test(t)) { pushGap(t.length); continue; }
    const w = t;
    const trial = cur ? cur + " " + w : w;
    if (measure(mc, trial) <= maxW) { cur = trial; continue; }
    if (cur) { out.push(cur); cur = ""; }
    cur = measure(mc, w) <= maxW ? w : breakWord(w);
  }
  out.push(cur);
  return out;
}
// Wrap each explicit \n line of a page; join back so paging stays \n-based.
function wrapBoxPage(page) {
  return String(page).split("\n").flatMap((ln) => wrapBoxLine(ln, BOX_MAXW)).join("\n");
}
// ---- text box ----
export class TextBox {
  constructor() { this.queue = []; this.chars = 0; this.offset = 0; this.open = false; this.onDone = null; this._wkey = null; this._wcache = []; }
  say(pages, onDone = null) {
    // pages: array of strings, \n = newline. Pages are greedily
    // word-wrapped (measure() to the inner box width) on read, so no
    // line overflows the box. The HW message box shows at most 2 body
    // lines; longer pages scroll within the page 2 lines per press-A
    // via offset before the queue shifts.
    this.queue = [...pages]; this.chars = 0; this.offset = 0; this.open = true; this.onDone = onDone;
    this._wkey = null;
  }
  // wrapped pages, cached by queue contents (direct queue edits stay valid)
  wrappedQueue() {
    const key = JSON.stringify(this.queue);
    if (key !== this._wkey) { this._wcache = this.queue.map(wrapBoxPage); this._wkey = key; }
    return this._wcache;
  }
  get text() { return this.wrappedQueue()[0] || ""; }
  get lines() { return this.text.split("\n"); }
  // [start, end) char range of the visible 2-line window within text.
  winRange() {
    const ls = this.lines;
    let s = 0;
    for (let i = 0; i < this.offset && i < ls.length; i++) s += ls[i].length + 1;
    let e = s;
    const n = Math.max(0, Math.min(ls.length - this.offset, 2));
    for (let i = 0; i < n; i++) e += ls[this.offset + i].length + (i < n - 1 ? 1 : 0);
    return [s, e];
  }
  get shown() { const [s] = this.winRange(); return this.text.slice(s, Math.floor(this.chars)); }
  get done() { const [, e] = this.winRange(); return this.chars >= e; }
  update(dt) {
    if (!this.open) return;
    if (!this.done) { const [, e] = this.winRange(); this.chars = Math.min(e, this.chars + dt * 60); }
  }
  // returns true when fully closed (caller should proceed)
  advance() {
    if (!this.open) return true;
    if (!this.done) { const [, e] = this.winRange(); this.chars = e; return false; }
    if (this.offset + 2 < this.lines.length) { this.offset += 2; return false; }
    this.queue.shift(); this.chars = 0; this.offset = 0;
    if (this.queue.length === 0) { this.open = false; const f = this.onDone; this.onDone = null; if (f) f(); return true; }
    return false;
  }
  draw(g) {
    if (!this.open) return;
    const bx = 4, bw = W - 8, bh = 52, by = H - 56;
    panelChrome(g, bx, by, bw, bh);
    // HW body: no speaker plate; "NAME: ..." stays inline, 2 lines visible.
    const lines = this.shown.split("\n");
    lines.slice(0, 2).forEach((ln, i) => text(g, ln, bx + 10, by + 7 + i * DS_LINE_H, "#182028"));
    if (this.done && arrowOn()) triD(g, bx + bw - 14, by + bh - 12, 6, "#c02020");
  }
}
export const textbox = new TextBox();

// ---- screens ----
let screen = null;
export function setScreen(s) { screen = s; if (screen.enter) screen.enter(); clearPressed(); }
export function getScreen() { return screen; }

let last = 0, acc = 0;
const STEP = 1000 / 60;
let frame = 0;
export function loop(t) {
  requestAnimationFrame(loop);
  if (!last) last = t;
  acc += Math.min(100, t - last); last = t;
  while (acc >= STEP) {
    acc -= STEP; frame++;
    if (screen && screen.update) screen.update(1 / 60, frame);
    textbox.update(1 / 60);
  }
  if (screen && screen.draw) { screen.draw(ctx); textbox.draw(ctx); }
}

export function fmtPages(s) {
  // split a dialog string on \n\n into pages
  return s.split("\n\n");
}

export function drawPanel(g, x, y, w, h) {
  panelChrome(g, x, y, w, h);
}

export function text(g, s, x, y, color = "#f8f8f8", size = 8, bold = false) {
  // x/y name the TOP-LEFT of the text run. Bitmap path: each 1-bit glyph
  // is stamped with fillRect (no smoothing); bold double-strikes +1px.
  // Descenders (g, j, p, q, y, comma) render below the baseline instead
  // of clipping, with proportional (variable) advances matching measure().
  // HGSS body text is flat: no shadow/outline pass under the glyphs.
  x = Math.round(x); y = Math.round(y);
  s = String(s);
  if (!s.length) return;
  g.save();
  g.fillStyle = color;
  let px = x, fbFont = false;
  for (const ch of s) {
    if (ch === " ") { px += 3; continue; }
    const rows = BIT_G[ch];
    if (!rows) {
      // fallback: canvas font for missing glyphs only
      if (!fbFont) {
        g.font = dsFont(size, bold);
        g.textBaseline = "alphabetic"; g.textAlign = "left";
        fbFont = true;
      }
      const base = y + (size === DS_SIZE ? DS_BASELINE : Math.round(size * 0.88));
      g.fillText(ch, px, base);
      px += Math.ceil(g.measureText(ch).width) + 1;
      continue;
    }
    const d = BIT_D[ch] || 0;
    const top = y + DS_BASELINE - (rows.length - d);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row.charCodeAt(c) === 35) { // "#"
          g.fillRect(px + c, top + r, 1, 1);
          if (bold) g.fillRect(px + c + 1, top + r, 1, 1);
        }
      }
    }
    px += bitW(ch) + 1 + (bold ? 1 : 0);
  }
  g.restore();
}

// menu helper: items drawn in a panel, index state, returns chosen on A
export class Menu {
  constructor(items, x, y, w = 72) { this.items = items; this.i = 0; this.x = x; this.y = y; this.w = w; }
  update() {
    if (pressedEdge("up")) this.i = (this.i + this.items.length - 1) % this.items.length;
    if (pressedEdge("down")) this.i = (this.i + 1) % this.items.length;
    if (pressedEdge("a") || pressedEdge("start")) return this.items[this.i];
    if (pressedEdge("b")) return "__cancel";
    return null;
  }
  draw(g) {
    const rh = DS_MENU_RH, h = this.items.length * rh + 10;
    // clamp inside the 256x192 frame so panels never clip the screen edge
    const w = Math.min(this.w, W - this.x - 2);
    drawPanel(g, this.x, this.y, w, h);
    this.items.forEach((it, k) => {
      const iy = this.y + 6 + k * rh, sel = k === this.i;
      // HGSS selection is cursor-arrow-only: no row highlight fill.
      if (sel) triR(g, this.x + 7, iy + 2, 7, "#c02020");
      // +2px start pad past the cursor; row top keeps descenders inside
      text(g, it, this.x + 18, iy + 1, "#33405a", DS_SIZE, false);
    });
  }
}
