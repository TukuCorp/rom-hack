// Overworld: tile maps, player, NPCs, warps, encounters, story events.
import { MAPS, DIALOG, STARTERS, RIVAL_PICK, WILD_R29, RIVAL_TEAM, GYM_TRAINER, GYM_LEADER, SPECIES } from "./data.js";
import { W, H, TILE, input, pressedEdge, textbox, fmtPages, Menu, text } from "./engine.js";
import { drawTile, HERO, NPC, blit } from "./sprites.js";
import { Battle, makeMon } from "./battle.js";
import { playSong } from "./audio.js";
import { sfx } from "./audio.js";

const SOLID = new Set(["#", "T", "W", "H", "R", "C", "L", "O", "B", "S", "P", "="]);
const TALL = new Set(["G"]);
// ---- Overworld tile painters (owned here): textured 16px procedural art ----
// Deterministic per-tile hash so speckle varies tile-to-tile without shimmer.
const INDOOR = new Set(["house", "lab", "center", "violethouse", "gym", "violetgate"]);
const GRASSY = new Set([",", "G", "F", "T", "S", "=", "#"]);
const WALKY = new Set([".", "~", "D", "+"]);
function hash2(x, y) {
  let h = ((x | 0) * 374761393 + (y | 0) * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}
function tileAt(m, x, y) {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return null;
  return m.rows[y][x];
}
// Full-bleed paint entry. (dx,dy) = screen px, (tx,ty) = tile coords, m = map def.
function paintTile(g, t, dx, dy, frame, tx, ty, m, map) {
  const R = (cx, cy, w, h, c) => { g.fillStyle = c; g.fillRect(dx + cx, dy + cy, w, h); };
  const P = (cx, cy, c) => { g.fillStyle = c; g.fillRect(dx + cx, dy + cy, 1, 1); };
  let seed = hash2(tx, ty);
  const RND = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const grassSpeckle = () => {
    R(0, 0, 16, 16, ((tx + ty) & 1) ? "#57a05c" : "#5da862");
    for (let i = 0; i < 12; i++) {
      const sx = RND(16), sy = RND(16);
      P(sx, sy, i % 3 === 0 ? "#6cba70" : "#4f9a55");
      if (i % 4 === 0) P((sx + 1) % 16, sy, "#4f9a55");
    }
    // blade ticks break the flat grid
    for (let i = 0; i < 3; i++) {
      const sx = RND(15), sy = RND(14);
      R(sx, sy, 1, 2, "#3f8a46"); P(sx, sy, "#6cba70");
    }
  };
  // House seating: a wall/door/roof tile directly above meadow ground is
  // a footprint row. Its base gets a 2px darkened ground-shadow (meadow
  // side) + 1px dark foundation strip (wall base) so houses sit instead
  // of floating. Art above row 13 is untouched. D/+ stay excluded: they
  // are interior walkables, so wall-over-door stacking never seats.
  // Returns true when seated.
  const seatFootprint = () => {
    const below = tileAt(m, tx, ty + 1);
    const meadow = below === "," || below === "G" || below === "F" ||
      below === "." || below === "~";
    if (!meadow) return false;
    R(0, 13, 16, 2, "#3f8a46");
    for (let x = 0; x < 16; x += 3) {
      const hh = hash2(tx * 16 + x, ty * 7 + 1);
      P((x + (hh % 2)) % 16, 13 + ((hh >>> 2) % 2), "#35702f");
    }
    R(0, 15, 16, 1, "#3a2010");
    return true;
  };
  // House perimeter: dark brown dithered outline + corner posts around the
  // H/R wall/roof mass. Neighbor-aware: an edge outlines only where the
  // neighbor is not H/R, so merged wall/roof interiors stay seamless and
  // the R-over-H eave shadow never gets an outline. Side edges stop above
  // the seating rows when seated so the footprint shadow + foundation
  // strip keep grounding the base; the bottom edge outlines only where
  // seating did not already ground it. Art inside the 1px edge is untouched.
  const houseEdge = (seated) => {
    const isMass = (c) => c === "H" || c === "R";
    const uO = !isMass(tileAt(m, tx, ty - 1));
    const dO = !isMass(tileAt(m, tx, ty + 1));
    const lO = !isMass(tileAt(m, tx - 1, ty));
    const rO = !isMass(tileAt(m, tx + 1, ty));
    const D = "#3a2010", L = "#5e3a18";
    const dith = (x, y) => (hash2(tx * 16 + x, ty * 16 + y) % 3 === 0 ? L : D);
    const y1 = seated ? 13 : 16;
    const y0 = tileAt(m, tx, ty - 1) === "R" ? 2 : 0;
    if (lO) for (let y = y0; y < y1; y++) P(0, y, dith(0, y));
    if (rO) for (let y = y0; y < y1; y++) P(15, y, dith(15, y));
    if (uO) for (let x = 0; x < 16; x++) P(x, 0, dith(x, 0));
    if (dO && !seated) for (let x = 0; x < 16; x++) P(x, 15, dith(x, 15));
    if (lO && uO && !y0) { R(0, 0, 2, 2, D); P(1, 1, L); }
    if (rO && uO && !y0) { R(14, 0, 2, 2, D); P(14, 1, L); }
    if (lO && dO && !seated) { R(0, 14, 2, 2, D); P(1, 14, L); }
    if (rO && dO && !seated) { R(14, 14, 2, 2, D); P(14, 14, L); }
  };
  switch (t) {
    case ",": {
      grassSpeckle();
      // plain-grass blooms: white/pink/red stemmed clusters only (no lone pixels)
      const h = hash2(tx * 3 + 1, ty * 5 + 2);
      const heads = ["#ffffff", "#f4a8c0", "#e03030"];
      const centers = ["#f8d838", "#ffffff", "#f8d838"];
      const clusters = 1 + (h % 2);
      for (let i = 0; i < clusters; i++) {
        const hh = hash2(tx * 7 + i * 13 + 5, ty * 11 + i * 17 + 3);
        const cx = 2 + (hh % 11), cy = 2 + ((hh >>> 3) % 9);
        const head = heads[(hh >>> 5) % heads.length];
        const ctr = centers[(hh >>> 5) % centers.length];
        R(cx, cy + 2, 1, 2, "#38a048");
        R(cx - 1, cy, 3, 2, head);
        P(cx, cy, ctr); P(cx, cy + (head === "#ffffff" ? 1 : 0), ctr);
      }
      break;
    }
    case ".": {
      // dirt path: warm sand + pebble speckle
      R(0, 0, 16, 16, "#d8b878");
      for (let i = 0; i < 10; i++) {
        const sx = RND(16), sy = RND(16);
        P(sx, sy, i % 3 === 0 ? "#b89058" : (i % 3 === 1 ? "#e8c890" : "#c8a868"));
      }
      P(RND(16), RND(16), "#b8b8c8"); P(RND(16), RND(16), "#8a8a9a");
      P(RND(16), RND(16), "#e8c890"); P(RND(16), RND(16), "#a88050");
      // rounded grass edges where the path meets grass
      const nb = (x, y) => { const c = tileAt(m, x, y); return c === null ? "." : c; };
      const up = nb(tx, ty - 1), dn = nb(tx, ty + 1), lf = nb(tx - 1, ty), rt = nb(tx + 1, ty);
      const isG = (c) => GRASSY.has(c);
      if (isG(up)) {
        R(0, 0, 16, 2, "#5da862");
        if (isG(lf) || isG(nb(tx - 1, ty - 1))) { P(0, 0, "#5da862"); P(0, 1, "#5da862"); P(1, 0, "#5da862"); P(1, 1, "#d8b878"); }
        else { P(0, 0, "#d8b878"); P(0, 1, "#d8b878"); }
        if (isG(rt) || isG(nb(tx + 1, ty - 1))) { P(15, 0, "#5da862"); P(15, 1, "#5da862"); P(14, 0, "#5da862"); P(14, 1, "#d8b878"); }
        else { P(15, 0, "#d8b878"); P(15, 1, "#d8b878"); }
        R(0, 2, 16, 1, "#c8a868");
      }
      if (isG(dn)) {
        R(0, 14, 16, 2, "#5da862");
        if (isG(lf) || isG(nb(tx - 1, ty + 1))) { P(0, 15, "#5da862"); P(0, 14, "#5da862"); P(1, 15, "#5da862"); P(1, 14, "#d8b878"); }
        else { P(0, 15, "#d8b878"); P(0, 14, "#d8b878"); }
        if (isG(rt) || isG(nb(tx + 1, ty + 1))) { P(15, 15, "#5da862"); P(15, 14, "#5da862"); P(14, 15, "#5da862"); P(14, 14, "#d8b878"); }
        else { P(15, 15, "#d8b878"); P(15, 14, "#d8b878"); }
        R(0, 13, 16, 1, "#c8a868");
      }
      if (isG(lf)) { R(0, 0, 2, 16, "#5da862"); R(2, 0, 1, 16, "#c8a868"); }
      if (isG(rt)) { R(14, 0, 2, 16, "#5da862"); R(13, 0, 1, 16, "#c8a868"); }
      break;
    }
    case "~": {
      R(0, 0, 16, 16, "#c8a060");
      R(0, 0, 16, 1, "#d8b070"); R(0, 7, 16, 2, "#b89058"); R(0, 15, 16, 1, "#a88050");
      for (let i = 0; i < 9; i++) { P(RND(16), RND(16), i % 2 ? "#b89058" : "#e0c080"); }
      P(RND(16), RND(16), "#8a8a9a");
      break;
    }
    case "G": {
      // tall grass: dark bed + animated swaying blades
      R(0, 0, 16, 16, "#4c9448");
      for (let i = 0; i < 8; i++) P(RND(16), RND(16), "#3d7d3a");
      const o = frame % 2;
      const blades = [[1, 5, 9], [5, 3, 11], [9, 4, 10], [13, 5, 8]];
      for (const [bx, by, bh] of blades) {
        const sway = ((bx + frame) % 3 === 0) ? o : -o;
        R(bx + sway, by, 2, bh, "#35702f");
        R(bx + sway, by, 1, bh - 2, "#3d7d3a");
        P(bx + sway, by - 1 >= 0 ? by - 1 : by, "#6cba70");
        P(bx + sway + 1, by + 1, "#6cba70");
      }
      R(0, 14, 16, 2, "#35702f");
      P(RND(16), 15, "#6cba70"); P(RND(16), 14, "#6cba70");
      // Feathered borders: neighbor-aware ground fringe + overhanging tips.
      // Tall-to-tall sides stay full-bleed dark bed so patches merge.
      const nbG = (x, y) => tileAt(m, x, y);
      const isTallG = (c) => c === "G";
      const isFringeG = (c) => c === null || c === "," || c === "F" || c === "." || c === "~" || c === "D" || c === "+";
      const upG = nbG(tx, ty - 1), dnG = nbG(tx, ty + 1);
      const lfG = nbG(tx - 1, ty), rtG = nbG(tx + 1, ty);
      // [edgeRow, innerRow]: the outer row matches the neighbor's rendered
      // edge (path tiles bleed a meadow lip toward tall grass), the inner
      // row carries the neighbor ground tone.
      const fringeCols = (c) => {
        if (c === ".") return ["#5da862", "#d8b878"];
        if (c === "~") return ["#c8a060", "#c8a060"];
        if (c === "D" || c === "+") return ["#d8b878", "#d8b878"];
        return ["#5da862", "#5da862"];
      };
      const fringeSpeck = (c) => c === "#d8b878" || c === "#c8a060"
        ? ["#b89058", "#e8c890"] : ["#4f9a55", "#6cba70"];
      const featherH = (up) => {
        const n = up ? upG : dnG;
        if (!isFringeG(n)) return;
        const [edgeC, inC] = fringeCols(n);
        const yE = up ? 0 : 15, yI = up ? 1 : 14, yJ = up ? 2 : 13;
        const x0 = isTallG(lfG) ? 2 : 0, x1 = isTallG(rtG) ? 14 : 16;
        const BED = "#4c9448";
        const [spD, spL] = fringeSpeck(inC);
        // Tuft clustering: low-frequency cluster gate (global px quantized
        // 4px, edge-row separated) shared by edge/inner/j picks at this
        // x so fringe dots clump into tufts with gaps, not even static.
        for (let x = x0; x < x1; x++) {
          // outer row sparse (~1/3) so tufts read as dots, never a lip;
          // inner row denser (~1/2) to root each tuft.
          const he = hash2(tx * 16 + x, ty * 29 + (up ? 7 : 8));
          const cl = hash2((tx * 16 + x) >> 2, (ty << 2) + (up ? 7 : 8));
          const heF = (he % 3 === 0) && (cl % 3 !== 0);
          P(x, yE, heF ? edgeC : BED);
          const hi = hash2(tx * 16 + x, ty * 29 + (up ? 9 : 10));
          P(x, yI, (hi % 2 === 0 || (cl % 3 === 0)) ? BED : inC);
          const j = hash2(tx * 16 + x, ty * 7 + (up ? 1 : 2)) % 3;
          if (j === 0 && (cl % 3 !== 0)) P(x, yJ, inC);
          // sparse sun-catch on fringe pixels only; hashed so it never lines up
          if (heF && (hash2(tx * 11 + x, ty * 13 + (up ? 21 : 22)) % 7 === 0))
            P(x, yE, (x % 2 ? spD : spL));
        }
        // overhanging blade tips root in the bed, lean outward with sway
        for (let k = 0; k < 3; k++) {
          const hx = hash2(tx * 5 + k * 7 + 3, ty * 3 + k + (up ? 0 : 40));
          const w = x1 - x0;
          if (w <= 0) break;
          let tx2 = x0 + (hx % w) + (frame % 2 ? (k % 2 ? 1 : 0) : (k % 2 ? 0 : -1));
          if (tx2 < x0) tx2 = x0; if (tx2 >= x1) tx2 = x1 - 1;
          if (up) { R(tx2, 0, 1, 3, "#35702f"); P(tx2, 0, "#6cba70"); }
          else { R(tx2, 13, 1, 3, "#35702f"); P(tx2, 15, "#6cba70"); }
        }
      };
      const featherV = (left) => {
        const n = left ? lfG : rtG;
        if (!isFringeG(n)) return;
        const [edgeC, inC] = fringeCols(n);
        const xE = left ? 0 : 15, xI = left ? 1 : 14, xJ = left ? 2 : 13;
        const y0 = isTallG(upG) ? 2 : 0, y1 = isTallG(dnG) ? 14 : 16;
        const BED = "#4c9448";
        const [spD, spL] = fringeSpeck(inC);
        // Tuft clustering: low-frequency cluster gate (global py quantized
        // 4px, edge-side separated) shared by edge/inner/j picks at this
        // y so fringe dots clump into tufts with gaps, not even static.
        for (let y = y0; y < y1; y++) {
          // outer row sparse (~1/3) so tufts read as dots, never a lip;
          // inner row denser (~1/2) to root each tuft.
          const he = hash2(tx * 29 + (left ? 7 : 8), ty * 16 + y);
          const cl = hash2((tx << 2) + (left ? 7 : 8), (ty * 16 + y) >> 2);
          const heF = (he % 3 === 0) && (cl % 3 !== 0);
          P(xE, y, heF ? edgeC : BED);
          const hi = hash2(tx * 7 + (left ? 1 : 2), ty * 16 + y);
          P(xI, y, (hi % 2 === 0 || (cl % 3 === 0)) ? BED : inC);
          const j = hash2(tx * 13 + (left ? 21 : 22), ty * 11 + y) % 3;
          if (j === 0 && (cl % 3 !== 0)) P(xJ, y, inC);
          // sparse sun-catch on fringe pixels only; hashed so it never lines up
          if (heF && (hash2(tx * 13 + (left ? 21 : 22), ty * 11 + y + 5) % 7 === 0))
            P(xE, y, (y % 2 ? spD : spL));
        }
        for (let k = 0; k < 3; k++) {
          const hy = hash2(tx * 3 + k + (left ? 0 : 40), ty * 5 + k * 7 + 3);
          const h = y1 - y0;
          if (h <= 0) break;
          let ty2 = y0 + (hy % h) + (frame % 2 ? (k % 2 ? 1 : 0) : (k % 2 ? 0 : -1));
          if (ty2 < y0) ty2 = y0; if (ty2 >= y1) ty2 = y1 - 1;
          if (left) { R(0, ty2, 3, 1, "#35702f"); P(0, ty2, "#6cba70"); }
          else { R(13, ty2, 3, 1, "#35702f"); P(15, ty2, "#6cba70"); }
        }
      };
      featherH(true); featherH(false); featherV(true); featherV(false);
      break;
    }
    case "F": {
      grassSpeckle();
      // stemmed blooms: white daisy + pink + yellow buds
      R(4, 7, 1, 3, "#38a048"); R(3, 3, 3, 3, "#f4f4f4"); P(4, 4, "#f8d838"); R(4, 3, 1, 1, "#ffffff");
      R(11, 11, 1, 3, "#38a048"); R(10, 8, 3, 3, "#e86a8a"); P(11, 9, "#f8d838"); R(10, 8, 1, 1, "#f49aac");
      const h = hash2(tx * 7 + 3, ty * 11 + 5);
      const dots = ["#f8d838", "#ffffff", "#f4a8c0", "#e03030"];
      P(1 + (h % 13), 12 + (h % 3), dots[h % dots.length]);
      P(13 - (h % 6), 2 + (h % 4), dots[(h >>> 2) % dots.length]);
      break;
    }
    case "T": {
      // canopy tree: neighbor-aware crowns merge into continuous canopy
      grassSpeckle();
      // canopy-continuous neighbors: forest trees, wall mass, and OOB edge
      const isCanopy = (c) => c === "T" || c === "#" || c === null;
      const nbT = (x, y) => isCanopy(tileAt(m, x, y));
      const lT = nbT(tx - 1, ty), rT = nbT(tx + 1, ty);
      const uT = nbT(tx, ty - 1), dT = nbT(tx, ty + 1);
      const tv = hash2(tx, ty) % 3;
      // horizontal bleed bounds for the canopy mid-band (no grass gutter)
      const lx = lT ? 0 : 2, rx = rT ? 16 : 14;
      if (tv === 0) {
        // round crown, sun highlight top-left
        if (uT) { R(5, 0, 6, 4, "#388e3c"); R(4, 0, 3, 3, "#4caf50"); P(5, 0, "#7ddb84"); P(4, 1, "#7ddb84"); }
        else { R(5, 2, 6, 3, "#388e3c"); R(4, 3, 3, 2, "#4caf50"); P(5, 2, "#7ddb84"); P(4, 4, "#7ddb84"); }
        R(4, 4, 8, 7, "#2e7d32");
        R(lx, 6, rx - lx, 3, "#2e7d32");
        R(3, 5, 4, 2, "#388e3c");
        P(3, 5, "#4caf50");
        P(9, 6, "#4caf50"); P(10, 5, "#7ddb84");
        R(9, 8, 4, 2, "#256b28"); R(11, 6, 2, 3, "#256b28");
        P(12, 9, "#1e5a20"); P(5, 9, "#1e5a20");
        if (dT) R(4, 11, 8, 5, "#2e7d32");
        else R(4, 11, 8, 1, "#1e5a20");
      } else if (tv === 1) {
        // tall crown shifted right, highlight top-right
        if (uT) { R(6, 0, 5, 3, "#388e3c"); R(9, 0, 3, 3, "#4caf50"); P(10, 0, "#7ddb84"); P(9, 1, "#7ddb84"); P(11, 1, "#7ddb84"); }
        else { R(6, 1, 5, 3, "#388e3c"); R(9, 2, 3, 2, "#4caf50"); P(10, 1, "#7ddb84"); P(9, 3, "#7ddb84"); P(11, 3, "#7ddb84"); }
        R(4, 3, 8, 8, "#2e7d32");
        R(lx, 6, rx - lx, 3, "#2e7d32");
        R(9, 4, 4, 2, "#388e3c");
        P(5, 5, "#4caf50"); P(4, 4, "#7ddb84");
        R(3, 8, 4, 2, "#256b28"); R(3, 6, 2, 3, "#256b28");
        P(3, 9, "#1e5a20"); P(10, 9, "#1e5a20");
        if (dT) R(4, 11, 8, 5, "#2e7d32");
        else R(4, 11, 8, 1, "#1e5a20");
      } else {
        // wide flat crown, highlight center-left
        if (uT) { R(4, 0, 8, 3, "#388e3c"); R(5, 0, 3, 3, "#4caf50"); P(6, 0, "#7ddb84"); P(5, 1, "#7ddb84"); P(7, 1, "#7ddb84"); }
        else { R(4, 3, 8, 2, "#388e3c"); R(5, 4, 3, 2, "#4caf50"); P(6, 3, "#7ddb84"); P(5, 5, "#7ddb84"); P(7, 4, "#7ddb84"); }
        R(3, 5, 10, 6, "#2e7d32");
        R(lx, 7, rx - lx, 2, "#2e7d32");
        R(3, 5, 3, 2, "#388e3c"); R(10, 5, 3, 2, "#388e3c");
        P(11, 6, "#4caf50"); P(4, 7, "#4caf50");
        R(10, 8, 3, 2, "#256b28"); R(11, 6, 2, 3, "#256b28");
        P(12, 9, "#1e5a20"); P(6, 9, "#1e5a20");
        if (dT) R(3, 11, 10, 5, "#2e7d32");
        else R(4, 11, 8, 1, "#1e5a20");
      }
      // side walls bleed to the tile edge when merged; stretch full height
      // toward canopy neighbors so interior reads as one crown mass
      const sy = tv === 2 ? 5 : 4, sh = tv === 2 ? 6 : 7;
      if (lT) R(0, uT ? 0 : sy, 2, sh + (uT ? sy : 0) + (dT ? 16 - sy - sh : 0), "#2e7d32");
      if (rT) R(14, uT ? 0 : sy, 2, sh + (uT ? sy : 0) + (dT ? 16 - sy - sh : 0), "#2e7d32");
      // corners close only where both edges are canopy-continuous
      if (uT && lT) R(0, 0, 4, 4, "#2e7d32");
      if (uT && rT) R(12, 0, 4, 4, "#2e7d32");
      if (dT && lT) R(0, 11, 4, 5, "#2e7d32");
      if (dT && rT) R(12, 11, 4, 5, "#2e7d32");
      // HGSS-scale fringe tree: full-bleed crown + ellipse shadow on every
      // south fringe; 4px trunk stub only where the tile below is walkable
      // in-bounds ground (grass/path). Wall, water, edge, and OOB fringe
      // stays pure crown. Interior mass stays trunkless.
      if (!dT) {
        const below = tileAt(m, tx, ty + 1);
        const southGround = below !== null && (below === "," || below === "G" ||
          below === "F" || below === "." || below === "~" || below === "D" || below === "+");
        // ellipse ground shadow on the grass below the skirt
        R(1, 13, 14, 1, "#3f8a46"); R(0, 14, 16, 1, "#3f8a46"); R(1, 15, 14, 1, "#35702f");
        R(3, 14, 10, 1, "#2f6b33"); R(4, 13, 8, 1, "#35702f"); R(4, 15, 8, 1, "#2a5a2e");
        // 4px stub rising from the tile base; the skirt drawn next hides its top
        if (southGround) {
          R(6, 9, 4, 7, "#8a5a28");
          R(6, 10, 1, 6, "#c8a068");
          R(9, 10, 1, 6, "#5e3a18");
          P(8, 14, "#5e3a18");
        }
        // wide crown: force full-bleed mid-band + skirt to the tile edges
        R(0, 6, 4, 5, "#2e7d32"); R(12, 6, 4, 5, "#2e7d32");
        R(0, 10, 16, 3, "#2e7d32");
        R(0, 6, 1, 5, "#388e3c"); R(15, 6, 1, 5, "#388e3c");
        P(1, 7, "#4caf50"); P(14, 8, "#4caf50"); P(2, 9, "#388e3c"); P(13, 7, "#388e3c");
        R(0, 10, 16, 1, "#388e3c");
        R(0, 12, 16, 1, "#256b28");
        P(3, 10, "#4caf50"); P(12, 10, "#4caf50"); P(5, 12, "#1e5a20"); P(10, 12, "#1e5a20");
      }
      break;
    }
    case "W": {
      R(0, 0, 16, 16, "#3d7dc8");
      for (let i = 0; i < 6; i++) P(RND(16), RND(16), "#2e6ab0");
      const o = frame % 2 ? 2 : 0;
      R(2 + o, 4, 5, 1, "#7db8e8"); R(9 - o, 10, 5, 1, "#7db8e8");
      R(4, 13, 4, 1, "#7db8e8"); R(2 + o, 3, 2, 1, "#c8e8f8"); R(9 - o, 9, 2, 1, "#c8e8f8");
      break;
    }
    case "#": {
      if (INDOOR.has(map)) {
        R(0, 0, 16, 16, "#3a2412");
        for (let i = 0; i < 6; i++) P(RND(16), RND(16), "#4a2c12");
        R(0, 0, 16, 1, "#5e3a18");
      } else {
        // out-of-bounds forest wall: seeded blob layout hides the 16px stamp
        const h = hash2(tx, ty);
        R(0, 0, 16, 16, "#256b28");
        // canopy-continuous neighbors bleed with no grass gutter
        const isCan = (c) => c === "#" || c === "T" || c === null;
        const uC = isCan(tileAt(m, tx, ty - 1)), dC = isCan(tileAt(m, tx, ty + 1));
        const lC = isCan(tileAt(m, tx - 1, ty)), rC = isCan(tileAt(m, tx + 1, ty));
        // edge-anchored masses: blobs always touch shared canopy edges
        if (uC) R(0, 0, 16, 3, "#2e7d32");
        if (dC) R(0, 13, 16, 3, "#2e7d32");
        if (lC) R(0, 0, 3, 16, "#2e7d32");
        if (rC) R(13, 0, 3, 16, "#2e7d32");
        if (uC && lC) R(0, 0, 5, 5, "#2e7d32");
        if (uC && rC) R(11, 0, 5, 5, "#2e7d32");
        if (dC && lC) R(0, 11, 5, 5, "#2e7d32");
        if (dC && rC) R(11, 11, 5, 5, "#2e7d32");
        // seeded interior blobs, each touching at least one tile edge so
        // adjacent tiles merge into masses instead of stamped stripes
        const b1x = (h % 2) ? 0 : 1 + (h % 2), b1y = 0;
        const b1w = 7, b1h = 5 + ((h >>> 2) % 2);
        const b2x = 9 - ((h >>> 4) % 2), b2y = 0;
        const b2w = 7 + ((h >>> 4) % 2), b2h = 5;
        const b3left = (h >>> 8) % 2 === 0;
        const b3x = b3left ? 0 : 8 - ((h >>> 8) % 3), b3y = 7 + ((h >>> 10) % 3);
        const b3w = b3left ? 8 : 16 - b3x - ((h >>> 6) % 2), b3h = 6;
        R(b1x, b1y, b1w, b1h, "#2e7d32"); R(b2x, b2y, b2w, b2h, "#2e7d32"); R(b3x, b3y, b3w, b3h, "#2e7d32");
        R(b1x, b1y, 5 - (h % 2), 2, "#388e3c"); R(b2x + 1, b2y + 1, 3, 2, "#388e3c");
        P(b1x + 1 + (h % 3), b1y + 1, "#4caf50"); P(b1x + 2, b1y + 2 - (h % 2), "#7ddb84");
        P(b2x + 2 - ((h >>> 3) % 2), b2y + 1, "#4caf50"); P(b3x + 1 + ((h >>> 5) % 4), b3y + 1, "#4caf50");
        P(b3x + 2, b3y + 2, "#7ddb84"); P(b1x + 4, b3y + 3, "#1e5a20");
        // low shade as seeded edge-anchored blobs, never a full-width band
        const s1w = 6 + ((h >>> 12) % 3), s1y = 12 + ((h >>> 3) % 2);
        const s2w = 5 + ((h >>> 14) % 3), s2y = 12 + ((h >>> 5) % 2);
        R(0, s1y, s1w, 16 - s1y, "#1e5a20");
        R(16 - s2w, s2y, s2w, 16 - s2y, "#1e5a20");
        P(RND(16), RND(16), "#388e3c"); P(RND(16), RND(16), "#1e5a20"); P(RND(16), RND(16), "#2e7d32");
      }
      break;
    }
    case "H": {
      R(0, 0, 16, 16, "#f2e2c0");
      for (let sx = 1; sx < 16; sx += 4) R(sx, 2, 2, 11, "#e9cf9e");
      P(3, 5, "#e9cf9e"); P(11, 9, "#e9cf9e"); P(7, 11, "#e9cf9e");
      R(0, 0, 16, 2, "#c8a878"); R(0, 0, 16, 1, "#a88050");
      R(0, 13, 16, 3, "#8a5a28"); R(0, 13, 16, 1, "#c8a068");
      // Eave drop-shadow: wall row directly under a roof overhang sits in
      // its shadow. Overhang lip color extends 1px onto the wall, then a
      // 1px warm falloff row, so R-over-H reads as overhang, not flat seam.
      if (tileAt(m, tx, ty - 1) === "R") {
        R(0, 0, 16, 1, "#5e1408");
        R(0, 1, 16, 1, "#7a3a20");
        for (let x = 0; x < 16; x++) {
          const hh = hash2(tx * 16 + x, ty * 3 + 1);
          if (hh % 4 === 0) P(x, 1, "#5e1408");
        }
      }
      houseEdge(seatFootprint());
      break;
    }
    case "R": {
      // Pitched 3/4 roof: ridge cap along the top, stepped courses with
      // alternating sun/shade faces down the slope, dark gable triangles
      // closing open run ends, tiled eave lip. Neighbor-aware: the ridge
      // caps only an exposed top, the eave lips only an exposed bottom,
      // gables close only open ends, so merged R runs stay seamless.
      const upR = tileAt(m, tx, ty - 1) === "R";
      const dnR = tileAt(m, tx, ty + 1) === "R";
      const lfR = tileAt(m, tx - 1, ty) === "R";
      const rtR = tileAt(m, tx + 1, ty) === "R";
      R(0, 0, 16, 16, "#c03828");
      let y = 0;
      if (!upR) {
        R(0, 0, 16, 1, "#f08070");
        R(0, 1, 16, 1, "#e05848");
        R(0, 2, 16, 1, "#982818");
        y = 3;
      }
      const eaveY = dnR ? 16 : 14;
      let course = 0;
      while (y + 4 <= eaveY) {
        const shade = false; // uniform faces: HGSS slopes lack zebra banding
        R(0, y, 16, 1, "#e05848");
        R(0, y + 1, 16, 2, shade ? "#a82818" : "#c03828");
        R(0, y + 3, 16, 1, "#982818");
        const off = (course % 2) * 4 + (hash2(tx * 5 + course, ty * 3 + 1) % 2);
        for (let jx = 2 + off; jx < 16; jx += 8)
          R(jx, y + 1, 1, 2, shade ? "#701808" : "#a82818");
        y += 4; course++;
      }
      if (y < eaveY) {
        // partial course: sun lip + face, step shadow on its last row
        const shade = false; // uniform faces (see full courses above)
        R(0, y, 16, 1, "#e05848");
        if (y + 1 < eaveY) R(0, y + 1, 16, eaveY - y - 2, shade ? "#a82818" : "#c03828");
        R(0, eaveY - 1, 16, 1, "#982818");
      }
      // dark gable triangles closing open run ends: wide at the eave,
      // tapering toward the ridge, with a darker rising edge
      const gTop = upR ? 0 : 3, gBot = dnR ? 15 : 13;
      const gable = (left) => {
        for (let gy = gTop; gy <= gBot; gy++) {
          const t = (gBot - gy) / Math.max(1, gBot - gTop);
          const w = 1 + Math.round((1 - t) * 4);
          for (let gx = 0; gx < w; gx++)
            P(left ? 1 + gx : 14 - gx, gy, "#701808");
          P(left ? 1 + w : 14 - w, gy, "#5e1408");
        }
      };
      if (!lfR) gable(true);
      if (!rtR) gable(false);
      if (!dnR) {
        // eave: sun lip + dark under-shadow with staggered tile joints
        R(0, 14, 16, 1, "#e05848");
        R(0, 15, 16, 1, "#5e1408");
        const off = hash2(tx, ty) % 4;
        for (let x = off; x < 16; x += 4) P(x, 14, "#a82818");
      }
      houseEdge(seatFootprint());
      break;
    }
    case "D": {
      R(0, 0, 16, 16, "#8a5a28");
      R(2, 0, 12, 14, "#6e4520");
      R(2, 0, 12, 1, "#c8a068"); R(2, 0, 12, 2, "#a87848");
      R(4, 3, 3, 4, "#542f14"); R(9, 3, 3, 4, "#542f14");
      R(4, 8, 3, 4, "#542f14"); R(9, 8, 3, 4, "#542f14");
      R(4, 3, 3, 1, "#8a5a28"); R(9, 3, 3, 1, "#8a5a28");
      R(4, 8, 3, 1, "#8a5a28"); R(9, 8, 3, 1, "#8a5a28");
      R(11, 7, 2, 2, "#f8d838"); P(11, 7, "#fff8d0");
      R(0, 14, 16, 2, "#d8b878"); R(0, 14, 16, 1, "#e8c890");
      // seated door keeps a worn sandy step centered on its shadow
      if (seatFootprint()) R(4, 14, 8, 1, "#d8b878");
      break;
    }
    case "C": {
      R(0, 0, 16, 16, "#5e3a18");
      R(1, 1, 14, 14, "#8a5a28");
      R(1, 1, 14, 3, "#c8a068"); R(1, 1, 14, 1, "#e8c088");
      R(3, 5, 10, 6, "#202028");
      R(3, 5, 10, 1, "#8a8aa8"); R(3, 5, 1, 6, "#8a8aa8"); R(3, 10, 10, 1, "#585868"); R(12, 5, 1, 6, "#585868");
      R(4, 6, 2, 3, "#585868"); P(4, 6, "#8a8aa8");
      if (frame % 2) { P(10, 7, "#48c8e0"); P(8, 8, "#48c8e0"); } else { P(9, 7, "#48c8e0"); P(11, 8, "#48c8e0"); }
      R(1, 12, 14, 1, "#5e3a18");
      R(2, 13, 4, 2, "#704828"); R(10, 13, 4, 2, "#704828");
      P(13, 13, "#e03030");
      break;
    }
    case "L": {
      R(0, 0, 16, 16, "#5e3a18");
      R(1, 0, 14, 6, "#c8a068");
      R(1, 0, 14, 1, "#e8c088");
      R(1, 2, 14, 1, "#b89058"); R(1, 4, 14, 1, "#b89058");
      P(4, 3, "#b89058"); P(11, 5, "#b89058");
      R(5, 1, 4, 3, "#f4f4f4"); R(5, 3, 4, 1, "#4858a8"); R(5, 1, 4, 1, "#ffffff");
      R(1, 6, 14, 1, "#8a5a28");
      R(1, 7, 14, 8, "#8a5a28");
      R(2, 8, 5, 6, "#a87848"); R(9, 8, 5, 6, "#a87848");
      R(2, 8, 5, 1, "#c8a068"); R(9, 8, 5, 1, "#c8a068");
      R(2, 14, 5, 1, "#5e3a18"); R(9, 14, 5, 1, "#5e3a18");
      P(4, 11, "#f8d838"); P(11, 11, "#f8d838");
      break;
    }
    case "O": {
      R(0, 0, 16, 16, "#5e3a18");
      R(1, 8, 14, 7, "#888898"); R(1, 8, 14, 1, "#d8d8e8");
      R(1, 14, 14, 1, "#585868");
      R(1, 10, 14, 1, "#6e6e7e");
      R(2, 4, 3, 4, "#e03030"); R(2, 6, 3, 2, "#f4f4f4"); P(2, 4, "#f46a6a"); P(3, 5, "#181820");
      R(6, 4, 3, 4, "#e8a018"); R(6, 6, 3, 2, "#f4f4f4"); P(6, 4, "#f8d838"); P(7, 5, "#181820");
      R(10, 4, 3, 4, "#38a048"); R(10, 6, 3, 2, "#f4f4f4"); P(10, 4, "#6cd878"); P(11, 5, "#181820");
      R(1, 1, 14, 2, "#c8a068"); R(1, 1, 14, 1, "#e8c088");
      break;
    }
    case "B": {
      R(0, 0, 16, 16, "#4a2c12");
      R(1, 1, 14, 14, "#704828");
      const vols = ["#a84848", "#4858a8", "#48a858", "#c8a038", "#9848c8", "#c86818", "#48a8a8"];
      for (let s = 0; s < 3; s++) {
        const by = 2 + s * 5;
        for (let i = 0; i < 7; i++) {
          const bx = 2 + i * 2, c = vols[(i + s * 3 + RND(2)) % vols.length];
          R(bx, by, 1, 2, c); P(bx, by, "#f8e8c8");
        }
        R(1, by + 3, 14, 1, "#c8a068");
      }
      R(0, 0, 16, 1, "#8a5a28"); R(0, 0, 1, 16, "#8a5a28");
      break;
    }
    case "S": {
      grassSpeckle();
      R(3, 13, 10, 2, "#3f8a46");
      R(7, 7, 2, 9, "#6e4520"); R(7, 7, 1, 9, "#a87848"); P(7, 7, "#c8a068");
      R(2, 1, 12, 7, "#5e3a18");
      R(3, 2, 10, 5, "#c8a068"); R(3, 2, 10, 1, "#e8c088");
      R(4, 3, 8, 1, "#5e3a18"); R(4, 5, 6, 1, "#5e3a18");
      P(3, 2, "#fff4e0"); R(2, 7, 12, 1, "#3a2010");
      P(3, 2, "#8a5a28"); P(13, 2, "#8a5a28");
      break;
    }
    case "P": {
      R(0, 0, 16, 16, "#cfa15e");
      R(0, 7, 16, 1, "#a87848"); R(0, 15, 16, 1, "#a87848");
      P(2, 3, "#bd8a4e"); P(13, 11, "#e0aa68"); P(8, 12, "#bd8a4e");
      R(3, 12, 10, 2, "#b89058");
      R(5, 5, 6, 4, "#207038");
      R(3, 6, 2, 3, "#207038"); R(11, 6, 2, 3, "#207038");
      R(6, 3, 4, 6, "#38a048"); R(4, 6, 2, 2, "#38a048"); R(10, 6, 2, 2, "#38a048");
      R(6, 2, 3, 2, "#4caf50");
      P(6, 3, "#6cd878"); P(8, 5, "#6cd878"); P(5, 6, "#6cd878"); P(11, 6, "#6cd878");
      P(7, 7, "#207038"); P(9, 4, "#207038");
      R(4, 9, 8, 2, "#8a3a20"); R(4, 9, 8, 1, "#e08050");
      R(5, 11, 6, 4, "#a8542c"); R(5, 11, 1, 4, "#d87848"); R(10, 11, 1, 4, "#703318");
      break;
    }
    case "=": {
      grassSpeckle();
      R(0, 3, 16, 3, "#c8b898"); R(0, 3, 16, 1, "#fff4e0"); R(0, 5, 16, 1, "#8a7a5e");
      R(0, 10, 16, 3, "#c8b898"); R(0, 10, 16, 1, "#fff4e0"); R(0, 12, 16, 1, "#8a7a5e");
      R(2, 0, 3, 16, "#a8906a"); R(2, 0, 2, 16, "#c8b898"); R(2, 0, 1, 16, "#e8d8b8");
      R(11, 0, 3, 16, "#a8906a"); R(11, 0, 2, 16, "#c8b898"); R(11, 0, 1, 16, "#e8d8b8");
      R(2, 0, 3, 1, "#fff4e0"); R(11, 0, 3, 1, "#fff4e0");
      P(2, 4, "#8a7a5e"); P(11, 11, "#8a7a5e");
      break;
    }
    case "_": {
      // warm oak plank floor: staggered joints + seeded grain lines
      R(0, 0, 16, 16, "#cfa15e");
      R(0, 4, 16, 4, "#c89c58"); R(0, 12, 16, 4, "#c89c58");
      R(0, 0, 16, 1, "#e8c088");
      R(0, 3, 16, 1, "#a87848"); R(0, 7, 16, 1, "#a87848");
      R(0, 11, 16, 1, "#a87848"); R(0, 15, 16, 1, "#a87848");
      const j0 = 5 + (hash2(tx, 0) % 7), j1 = 2 + (hash2(0, ty) % 9);
      R(j0 % 16, 0, 1, 3, "#a87848"); R((j0 + 6) % 16, 0, 1, 3, "#a87848");
      R(j1 % 16, 4, 1, 3, "#a87848"); R((j1 + 7) % 16, 4, 1, 3, "#a87848");
      R((j0 + 3) % 16, 8, 1, 3, "#a87848"); R((j0 + 10) % 16, 8, 1, 3, "#a87848");
      R((j1 + 5) % 16, 12, 1, 3, "#a87848"); R((j1 + 11) % 16, 12, 1, 3, "#a87848");
      // grain: short horizontal dashes seeded per tile
      for (let i = 0; i < 6; i++) {
        const gx = RND(13), gy = RND(16);
        if (gy % 4 === 3) continue;
        R(gx, gy, 2, 1, i % 2 ? "#bd8a4e" : "#e0aa68");
      }
      break;
    }
    case ":": {
      R(0, 0, 16, 16, "#b8b8d0");
      R(0, 0, 8, 8, "#d0d0e8"); R(8, 8, 8, 8, "#d0d0e8");
      R(0, 0, 16, 1, "#e4e4f4"); R(7, 0, 1, 16, "#9898b8"); R(0, 7, 16, 1, "#9898b8");
      R(15, 0, 1, 16, "#9898b8"); R(0, 15, 16, 1, "#9898b8");
      P(3, 3, "#ffffff"); P(11, 11, "#ffffff");
      break;
    }
    case "+": {
      R(0, 0, 16, 16, "#f2e8d0");
      R(0, 0, 16, 2, "#c03828"); R(0, 14, 16, 2, "#c03828");
      R(0, 0, 2, 16, "#c03828"); R(14, 0, 2, 16, "#c03828");
      R(2, 2, 12, 1, "#e08080"); R(2, 13, 12, 1, "#e08080");
      R(2, 2, 1, 12, "#e08080"); R(13, 2, 1, 12, "#e08080");
      R(7, 3, 2, 10, "#c03828"); R(3, 7, 10, 2, "#c03828");
      R(7, 7, 2, 2, "#f8d838"); P(7, 7, "#fff8d0");
      P(4, 4, "#c03828"); P(11, 4, "#c03828"); P(4, 11, "#c03828"); P(11, 11, "#c03828");
      break;
    }
    default:
      R(0, 0, 16, 16, "#ff00ff");
  }
}

function sub(s, game) {
  return s.replace("{name}", game.name).replace("{rival}", game.rivalName).replace("{mon}", game.lastMon || "");
}

export class Overworld {
  constructor(game) {
    this.game = game;
    const p = game.pos;
    this.map = p.map; this.x = p.x; this.y = p.y; this.dir = p.dir || "down";
    this.px = this.x * TILE; this.py = this.y * TILE;
    this.moving = false; this.stepT = 0; this.walkFrame = 0;
    this.event = false; // event lock
    this.menu = null;
    this.frame = 0;
    this.npcs = this.buildNpcs(this.map);
    playSong(this.map === "gym" ? "gym" : "town");
  }
  buildNpcs(map) {
    const G = this.game, F = G.flags, list = [];
    const add = (x, y, spr, id) => list.push({ x, y, spr, id });
    if (map === "house") add(3, 1, NPC.mom, "mom");
    if (map === "lab") {
      add(4, 1, NPC.elm, "elm");
      add(6, 1, NPC.aide, "aide");
    }
    if (map === "center") add(4, 1, NPC.nurse, "nurse");
    if (map === "violet" && !F.badge1) add(17, 13, NPC.guide, "guide");
    if (map === "gym" && !F.beat_sam) add(4, 4, NPC.sam, "sam");
    if (map === "gym") add(4, 1, NPC.harlan, "harlan");
    if (map === "violethouse") add(2, 1, NPC.guide, "neighbor");
    if (this.map === map && F.rival_out && !F.beat_rival && map === "newbark") add(12, 14, NPC.rival, "rival");
    return list;
  }
  goto(map, x, y) {
    this.map = map; this.x = x; this.y = y; this.px = x * TILE; this.py = y * TILE;
    this.moving = false;
    this.npcs = this.buildNpcs(map);
    this.game.pos = { map, x, y, dir: this.dir };
    playSong(map === "gym" ? "gym" : "town");
    sfx.confirm();
  }
  tile(x, y) {
    const m = MAPS[this.map];
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return "#";
    return m.rows[y][x];
  }
  solid(x, y) {
    if (this.npcs.some((n) => n.x === x && n.y === y)) return true;
    const t = this.tile(x, y);
    if (t === "D" && !(MAPS[this.map].warps && MAPS[this.map].warps[`${x},${y}`])) return true;
    return SOLID.has(t);
  }
  facing() {
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[this.dir];
    return [this.x + d[0], this.y + d[1]];
  }
  update(dt, frame) {
    this.frame = frame;
    if (textbox.open) {
      if (pressedEdge("a") || pressedEdge("start")) { sfx.blip(); textbox.advance(); }
      return;
    }
    if (this.menu) {
      const c = this.menu.update();
      if (c === "__cancel") this.menu = null;
      else if (c && this.menuCb) { const cb = this.menuCb; this.menu = null; this.menuCb = null; cb(c); }
      return;
    }
    if (this.event) return;
    // movement
    let dx = 0, dy = 0, dir = null;
    if (input.up()) { dy = -1; dir = "up"; }
    else if (input.down()) { dy = 1; dir = "down"; }
    else if (input.left()) { dx = -1; dir = "left"; }
    else if (input.right()) { dx = 1; dir = "right"; }
    if (dir) {
      this.dir = dir;
      if (!this.moving) {
        const nx = this.x + dx, ny = this.y + dy;
        if (!this.solid(nx, ny)) {
          this.moving = true; this.stepT = 0;
          this.fromX = this.x; this.fromY = this.y; this.x = nx; this.y = ny;
          this.walkFrame ^= 1;
        }
      }
    }
    if (this.moving) {
      this.stepT += dt * 4.2;
      if (this.stepT >= 1) {
        this.stepT = 0; this.moving = false;
        this.px = this.x * TILE; this.py = this.y * TILE;
        this.afterStep();
      }
    }
    this.game.pos = { map: this.map, x: this.x, y: this.y, dir: this.dir };
    if (pressedEdge("a")) this.interact();
    if (pressedEdge("start")) this.openPause();
  }
  afterStep() {
    const t = this.tile(this.x, this.y);
    // warps
    const key = `${this.x},${this.y}`;
    const w = MAPS[this.map].warps && MAPS[this.map].warps[key];
    if ((t === "D" || w) && w) {
      const [m, x, y] = w.split(","); this.goto(m, +x, +y); return;
    }
    // rival trigger outside lab
    if (this.map === "newbark" && this.game.flags.got_starter && !this.game.flags.beat_rival &&
        this.x >= 7 && this.x <= 11 && (this.y === 13 || this.y === 14)) {
      if (!this.game.flags.rival_out) {
        this.game.flags.rival_out = true;
        this.npcs = this.buildNpcs(this.map);
      }
      return;
    }
    // wild encounters
    if (TALL.has(t) && this.hasConscious()) {
      if (Math.random() < 0.12) this.startWild();
    }
  }
  hasConscious() { return this.game.party.some((m) => m.hp > 0); }
  openPause() {
    sfx.confirm();
    this.menu = new Menu(["PARTY", "BAG", "SAVE", "QUIT"], W - 84, 24, 76);
    this.menuCb = (c) => {
      if (c === "PARTY") this.showParty();
      else if (c === "BAG") this.showBag();
      else if (c === "SAVE") { this.game.save(); textbox.say(["Progress saved!"]); sfx.confirm(); }
      else if (c === "QUIT") { window.location.reload(); }
    };
  }
  showParty() {
    const lines = this.game.party.map((m) => `${SPECIES[m.sp].name} LV${m.lv} ${m.hp}/${m.maxhp}`);
    textbox.say([lines.join("\n") || "(empty)"]);
  }
  showBag() {
    const b = this.game.bag;
    textbox.say([`ORBIT BALL x${b.orbit}\nPOTION x${b.potion}`]);
  }
  interact() {
    const [fx, fy] = this.facing();
    const npc = this.npcs.find((n) => n.x === fx && n.y === fy);
    const t = this.tile(fx, fy);
    const G = this.game;
    if (npc) return this.talk(npc.id);
    if (t === "S") {
      const s = MAPS[this.map].signs && MAPS[this.map].signs[`${fx},${fy}`];
      textbox.say(fmtPages(sub(s || DIALOG.locked, G))); sfx.blip(); return;
    }
    if (t === "O") return this.starterEvent();
    if (t === "D") { textbox.say(["It's locked."]); return; }
    if (t === "C") { textbox.say(fmtPages("It's the counter.")); return; }
    if (t === "B") { textbox.say(fmtPages(sub(DIALOG.books, G))); return; }
    if (t === "P") { textbox.say(fmtPages(sub(DIALOG.plant, G))); return; }
    if (t === "L") { textbox.say(fmtPages(sub(DIALOG.machine, G))); return; }
  }
  talk(id) {
    const G = this.game, F = G.flags;
    const say = (key, done) => textbox.say(fmtPages(sub(DIALOG[key], G)), done);
    switch (id) {
      case "mom":
        this.heal();
        if (G.bag.potion < 3) {
          G.bag.potion = 3;
          textbox.say(["MOM: Take these POTIONS,\nsweetie. Be careful!",
            ...fmtPages(sub(DIALOG[F.got_starter ? "mom_after" : "mom_before"], G))]);
        }
        else say(F.got_starter ? "mom_after" : "mom_before");
        break;
      case "elm":
        if (!F.got_starter) say("elm_intro");
        else if (!F.got_balls) {
          F.got_balls = true; G.bag.orbit += 5; G.bag.potion += 3; G.save();
          say("elm_balls");
        }
        else say("elm_after_pick");
        break;
      case "aide": say("aide"); break;
      case "nurse":
        this.heal(); say("center_nurse"); break;
      case "guide": say("guide"); break;
      case "neighbor": textbox.say(["It's a quiet house.\nSomeone lives here."]); break;
      case "rival":
        if (!F.beat_rival && F.got_starter) this.rivalBattle();
        else say("rival_after");
        break;
      case "sam":
        this.event = true;
        textbox.say(fmtPages(sub(DIALOG.trainer_sam, G)), () => {
          this.startBattle(GYM_TRAINER, { trainer: { name: "REY" } }, (win) => {
            this.event = false;
            if (win) { F.beat_sam = true; this.npcs = this.buildNpcs(this.map); this.healSilent(); }
            else this.faintReset();
          });
        });
        break;
      case "harlan":
        if (F.badge1) { textbox.say(["CORA: With that badge,\nyou can go far."]); break; }
        this.event = true;
        textbox.say(fmtPages(sub(DIALOG.harlan_before, G)), () => {
          this.startBattle(GYM_LEADER, { trainer: { name: "HARLAN", after: DIALOG.harlan_after } }, (win) => {
            this.event = false;
            if (win) {
              F.badge1 = true; G.badges = 1; G.save(); sfx.badge();
              textbox.say(fmtPages(sub(DIALOG.badge_get, G)));
              this.healSilent();
            } else this.faintReset();
          });
        });
        break;
    }
  }
  starterEvent() {
    const G = this.game;
    if (G.flags.got_starter) { textbox.say(["The machine hums quietly."]); return; }
    this.event = true;
    const names = STARTERS.map((s) => SPECIES[s].name.toUpperCase());
    this.menu = new Menu(names, 40, 60, 110);
    this.menuCb = (c) => {
      if (c === "__cancel") { this.event = false; return; }
      const idx = names.indexOf(c);
      const sp = STARTERS[idx];
      const mon = makeMon(sp, 5);
      G.party.push(mon); G.flags.got_starter = sp; G.lastMon = SPECIES[sp].name.toUpperCase();
      G.save(); sfx.catch_();
      textbox.say([`You chose ${SPECIES[sp].name}!`, ...fmtPages(sub(DIALOG.elm_after_pick, G))],
        () => { this.event = false; });
    };
  }
  rivalBattle() {
    const G = this.game;
    this.event = true;
    const team = [{ sp: RIVAL_PICK[G.flags.got_starter], lv: 4 }];
    textbox.say(fmtPages(sub(DIALOG.rival_before, G)), () => {
      this.startBattle(team, { trainer: { name: G.rivalName } }, (win) => {
        if (win) {
          G.flags.beat_rival = true; G.save();
          this.npcs = this.buildNpcs(this.map);
          textbox.say(fmtPages(sub(DIALOG.rival_after, G)), () => {
            this.event = false;
            // Elm runs out with supplies
            textbox.say(fmtPages(sub(DIALOG.elm_balls, G)), () => {
              G.flags.got_balls = true; G.bag.orbit += 5; G.bag.potion += 3; G.save();
            });
          });
        } else { this.event = false; this.faintReset(); }
      });
    });
  }
  startWild() {
    // pick encounter
    const total = WILD_R29.reduce((a, e) => a + e.w, 0);
    let r = Math.random() * total, pick = WILD_R29[0];
    for (const e of WILD_R29) { r -= e.w; if (r <= 0) { pick = e; break; } }
    const lv = pick.min + Math.floor(Math.random() * (pick.max - pick.min + 1));
    this.startBattle([{ sp: pick.sp, lv }], {}, (win) => { if (!win) this.faintReset(); });
  }
  startBattle(foes, opts, cb) {
    import("./main.js").then((m) => {
      playSong("battle");
      const { setScreen } = m.engine;
      setScreen(new Battle(this.game.party, foes, {
        trainer: opts.trainer || null,
        onEnd: (win) => {
          playSong(this.map === "gym" ? "gym" : "town");
          if (win) this.game.save();
          setScreen(m.overworld());
          cb(win);
        },
      }));
    });
  }
  heal() { for (const m of this.game.party) { m.hp = m.maxhp; m.status = null; m.moves.forEach((mv) => { const d = { tackle: 35 }; }); } this.healSilent(); sfx.heal(); }
  healSilent() {
    import("./battle.js").then(({ MOVES }) => {
      for (const m of this.game.party) { m.hp = m.maxhp; m.status = null; m.stages = { atk: 0, def: 0 }; m.moves.forEach((mv) => { mv.pp = MOVES[mv.id].pp; }); }
    });
  }
  faintReset() {
    // wipe to last center/heal: respawn at mom's house with healed party
    this.healSilent();
    for (const m of this.game.party) m.hp = m.maxhp;
    textbox.say(["You hurry home to heal..."], () => this.goto("house", 3, 3));
  }
  draw(g) {
    const m = MAPS[this.map];
    const indoor = INDOOR.has(this.map);
    // full-bleed base: never black void (grass outdoors, oak indoors)
    g.fillStyle = indoor ? "#cfa15e" : "#5da862"; g.fillRect(0, 0, 256, 192);
    const mw = m.w * TILE, mh = m.h * TILE;
    // center small maps; clamp scrolling maps to their edges
    const ox = mw <= W ? -Math.floor((W - mw) / 2)
      : Math.max(0, Math.min(mw - W, Math.floor(this.px + 8 - W / 2)));
    const oy = mh <= H ? -Math.floor((H - mh) / 2)
      : Math.max(0, Math.min(mh - H, Math.floor(this.py + 8 - H / 2)));
    const frame = Math.floor(this.frame / 30);
    const x0 = Math.floor(ox / TILE), y0 = Math.floor(oy / TILE);
    for (let y = y0; y <= y0 + H / TILE; y++) {
      for (let x = x0; x <= x0 + W / TILE; x++) {
        const dx = x * TILE - ox, dy = y * TILE - oy;
        let t;
        if (x < 0 || y < 0 || x >= m.w || y >= m.h) t = indoor ? "_" : ",";
        else t = m.rows[y][x];
        paintTile(g, t, dx, dy, frame, x, y, m, this.map);
      }
    }
    const drawChar = (sx, sy, art) => {
      g.save(); g.translate(Math.floor(sx - ox), Math.floor(sy - oy)); blit(g, art, 0, 0); g.restore();
    };
    const ents = [...this.npcs.map((n) => ({ y: n.y, f: () => drawChar(n.x * TILE, n.y * TILE - 4, n.spr) })),
      {
        y: this.y + 0.01, f: () => {
          const set = HERO[this.game.gender];
          const art = this.dir === "up" ? set.up[this.moving ? this.walkFrame : 0]
            : this.dir === "down" ? set.down[this.moving ? this.walkFrame : 0]
            : set.side[this.moving ? this.walkFrame : 0];
          const bob = this.moving && this.frame % 12 < 6 ? -1 : 0;
          g.save(); g.translate(Math.floor(this.px - ox), Math.floor(this.py - oy - 4 + bob));
          if (this.dir === "left") { g.translate(16, 0); g.scale(-1, 1); }
          blit(g, art, 0, 0); g.restore();
        },
      }];
    ents.sort((a, b) => a.y - b.y).forEach((e) => e.f());
    if (this.menu) this.menu.draw(g);
    // debug handle for automated verification
    window.__ow = { map: this.map, x: this.x, y: this.y, event: this.event, menu: !!this.menu,
      npcs: this.npcs.map((n) => [n.x, n.y]), rows: MAPS[this.map].rows };
  }
}
