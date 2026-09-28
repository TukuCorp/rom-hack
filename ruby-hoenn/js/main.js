// Entry: game state, title screen, wiring. Exposes window.GAME for battles.
import { W, H, ctx, setScreen, getScreen, loop, bindTouch, textbox, Menu, text, drawPanel, pressedEdge, clearPressed } from "./engine.js";
import { Overworld } from "./overworld.js";
import { SPECIES } from "./data.js";
import { MON_FRONT, blit } from "./sprites.js";
import { ensureAudio, playSong, stopSong, toggleMute, sfx } from "./audio.js";
export * as engine from "./engine.js";

const SAVE_KEY = "rubyhoenn1";

export const GAME = {
  gender: "boy", name: "RUAN", rivalName: "KAI",
  flags: {}, party: [], bag: { orbit: 0, potion: 0 }, badges: 0,
  pos: { map: "house", x: 3, y: 3, dir: "down" }, lastMon: "",
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        gender: this.gender, name: this.name, flags: this.flags,
        party: this.party, bag: this.bag, badges: this.badges, pos: this.pos,
      }));
    } catch (e) { /* storage unavailable */ }
  },
  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s || !s.party) return false;
      Object.assign(this, s);
      if (this.party.length && this.party.every((m) => m.hp <= 0)) {
        for (const m of this.party) m.hp = m.maxhp; // black-out recovery
      }
      return true;
    } catch (e) { return false; }
  },
  registerCaught(foe) {
    if (foe._caught) return true;
    foe._caught = true;
    if (this.party.length >= 6) return false;
    // store a clean copy at current HP
    this.party.push(JSON.parse(JSON.stringify({ ...foe, stages: { atk: 0, def: 0 } })));
    this.save();
    return true;
  },
};
 window.GAME = GAME;

let ow = null;
export function overworld() {
  if (!ow) ow = new Overworld(GAME);
  return ow;
}
export function resetOverworld() { ow = new Overworld(GAME); }

class Title {
  constructor() { this.menu = null; this.t = 0; this.hasSave = GAME.load(); if (this.hasSave) { /* keep loaded */ } }
  enter() { playSong("town"); }
  update(dt) {
    this.t += dt;
    ensureAudio();
    if (textbox.open) {
      if (pressedEdge("a") || pressedEdge("start")) textbox.advance();
      return;
    }
    if (!this.menu) {
      if (pressedEdge("a") || pressedEdge("start") || pressedEdge("z")) {
        ensureAudio(); sfx.confirm();
        const items = this.hasSave ? ["CONTINUE", "NEW GAME"] : ["NEW GAME"];
        this.menu = new Menu(items, W / 2 - 44, 128, 88);
      }
      if (pressedEdge("m")) { const m = toggleMute(); textbox.say([m ? "Muted." : "Sound on."]); }
      return;
    }
    const c = this.menu.update();
    if (c === "__cancel") this.menu = null;
    else if (c === "CONTINUE") { resetOverworld(); setScreen(overworld()); }
    else if (c === "NEW GAME") {
      this.menu = new Menu(["BOY", "GIRL"], W / 2 - 44, 128, 88);
      this.pickGender = true;
    } else if (this.pickGender && (c === "BOY" || c === "GIRL")) {
      GAME.gender = c.toLowerCase();
      GAME.name = c === "BOY" ? "RUAN" : "LINA";
      GAME.flags = {}; GAME.party = []; GAME.bag = { orbit: 0, potion: 0 };
      GAME.badges = 0; GAME.pos = { map: "house", x: 3, y: 3, dir: "down" };
      GAME.save(); resetOverworld(); setScreen(overworld());
    }
  }
  draw(g) {
    const t = this.t;
    const bob = Math.sin(t * 1.6) * 3;
    // --- daytime sky, full bleed: light blue to pale horizon ---
    const sky = g.createLinearGradient(0, 0, 0, 133);
    sky.addColorStop(0, "#2f7fd0");
    sky.addColorStop(0.45, "#5aa8e8");
    sky.addColorStop(0.75, "#a8d8f5");
    sky.addColorStop(1, "#e8f4fc");
    g.fillStyle = sky; g.fillRect(0, 0, W, 133);
    // --- sun glow + core ---
    const halo = g.createRadialGradient(214, 28, 2, 214, 28, 30);
    halo.addColorStop(0, "rgba(255,252,230,0.95)");
    halo.addColorStop(0.35, "rgba(255,244,200,0.45)");
    halo.addColorStop(1, "rgba(255,244,200,0)");
    g.fillStyle = halo; g.fillRect(184, 0, 60, 58);
    g.fillStyle = "#fffdf0";
    g.beginPath(); g.arc(214, 28, 11, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#ffe9a8"; g.lineWidth = 1;
    g.beginPath(); g.arc(214, 28, 11, 0, Math.PI * 2); g.stroke();
    // --- slow day clouds (white with soft shade) ---
    const c1 = ((t * 3) % (W + 80)) - 40;
    g.fillStyle = "rgba(255,255,255,0.92)";
    g.fillRect(Math.floor(W - c1) - 40, 44, 62, 5);
    g.fillRect(Math.floor(W - c1) - 30, 41, 44, 4);
    g.fillRect(Math.floor(c1) - 20, 92, 70, 5);
    g.fillRect(Math.floor(c1) - 8, 89, 46, 4);
    g.fillStyle = "rgba(160,200,235,0.7)";
    g.fillRect(Math.floor(W - c1) - 40, 49, 62, 1);
    g.fillRect(Math.floor(c1) - 20, 97, 70, 1);
    // --- original soaring guardian silhouette (day rim-lit, not a ROM sprite) ---
    const cx = 128, cy = 86 + bob;
    const flap = Math.sin(t * 2.1) * 4;
    g.fillStyle = "#1c2a52";
    g.strokeStyle = "#1c2a52"; g.lineWidth = 1;
    // left wing: swept blade from shoulder to tip
    g.beginPath();
    g.moveTo(cx - 6, cy - 2);
    g.quadraticCurveTo(cx - 38, cy - 22, cx - 72, cy - 40 + flap);
    g.quadraticCurveTo(cx - 44, cy - 12, cx - 8, cy + 4);
    g.closePath(); g.fill();
    // right wing mirrored
    g.beginPath();
    g.moveTo(cx + 6, cy - 2);
    g.quadraticCurveTo(cx + 38, cy - 22, cx + 72, cy - 40 - flap);
    g.quadraticCurveTo(cx + 44, cy - 12, cx + 8, cy + 4);
    g.closePath(); g.fill();
    // body diamond
    g.beginPath();
    g.moveTo(cx, cy - 12); g.quadraticCurveTo(cx + 10, cy - 2, cx, cy + 14);
    g.quadraticCurveTo(cx - 10, cy - 2, cx, cy - 12);
    g.fill();
    // head + beak spike + rear spike
    g.beginPath(); g.arc(cx, cy - 15, 6, 0, Math.PI * 2); g.fill();
    g.beginPath();
    g.moveTo(cx + 4, cy - 17); g.lineTo(cx + 17, cy - 13); g.lineTo(cx + 4, cy - 11);
    g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(cx - 5, cy - 19); g.lineTo(cx - 18, cy - 26); g.lineTo(cx - 3, cy - 14);
    g.closePath(); g.fill();
    // tail streamers
    g.beginPath();
    g.moveTo(cx - 5, cy + 12); g.lineTo(cx - 13, cy + 30); g.lineTo(cx - 2, cy + 14);
    g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(cx + 5, cy + 12); g.lineTo(cx + 11, cy + 31); g.lineTo(cx + 2, cy + 14);
    g.closePath(); g.fill();
    // sun rim light on wing leading edges
    g.strokeStyle = "#fff0b8"; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - 6, cy - 2);
    g.quadraticCurveTo(cx - 38, cy - 22, cx - 72, cy - 40 + flap);
    g.stroke();
    g.beginPath();
    g.moveTo(cx + 6, cy - 2);
    g.quadraticCurveTo(cx + 38, cy - 22, cx + 72, cy - 40 - flap);
    g.stroke();
    // eye glint
    g.fillStyle = "#ffd75e"; g.fillRect(cx + 2, cy - 17, 2, 2);
    g.fillStyle = "#ffffff"; g.fillRect(cx + 2, cy - 17, 1, 1);
    // --- bright mid-blue sea band with sun sparkle ---
    const sea = g.createLinearGradient(0, 132, 0, 151);
    sea.addColorStop(0, "#5aa8e8"); sea.addColorStop(1, "#1f66b8");
    g.fillStyle = sea; g.fillRect(0, 132, W, 19);
    g.fillStyle = "rgba(255,255,255,0.6)";
    for (let sx = 0; sx < 5; sx++) {
      const yy = 135 + sx * 3;
      const ww = 26 - sx * 3;
      g.fillRect(Math.floor(214 - ww / 2 + Math.sin(t * 2 + sx) * 2), yy, ww, 1);
    }
    g.fillStyle = "rgba(255,255,255,0.75)";
    for (let i = 0; i < 24; i++) {
      const x = (i * 47 + 5) % W, y = 134 + ((i * 29) % 14);
      g.fillRect(x, y, 4, 1);
    }
    // --- shoreline strip (march ground) ---
    g.fillStyle = "#c8a068"; g.fillRect(0, 151, W, 11);
    g.fillStyle = "#e0bc80"; g.fillRect(0, 151, W, 2);
    g.fillStyle = "#8a6840";
    for (let i = 0; i < 30; i++) g.fillRect((i * 53 + 3) % W, 155 + ((i * 31) % 5), 2, 1);
    // --- two-line logo: serif display type, centered, never stretched ---
    g.textAlign = "center"; g.textBaseline = "top";
    g.lineJoin = "round";
    g.font = '700 13px Georgia, "Times New Roman", serif';
    g.strokeStyle = "#060a24"; g.lineWidth = 3;
    g.strokeText("E M B E R", W / 2, 10);
    g.fillStyle = "#eef2fc"; g.fillText("E M B E R", W / 2, 10);
    g.font = '900 30px Georgia, "Times New Roman", serif';
    g.lineWidth = 4; g.strokeText("LEAF", W / 2, 24);
    const gold = g.createLinearGradient(0, 24, 0, 54);
    gold.addColorStop(0, "#fff6c8"); gold.addColorStop(0.45, "#f8d838");
    gold.addColorStop(0.75, "#e09018"); gold.addColorStop(1, "#fff0a8");
    g.fillStyle = gold; g.fillText("LEAF", W / 2, 24);
    g.font = '700 7px Verdana, Geneva, sans-serif';
    const ribW = 118;
    g.fillStyle = "#0a1440"; g.fillRect(W / 2 - ribW / 2, 56, ribW, 12);
    g.strokeStyle = "#f8d838"; g.lineWidth = 1;
    g.strokeRect(W / 2 - ribW / 2 + 0.5, 56.5, ribW - 1, 11);
    g.fillStyle = "#f8d838"; g.fillText("★  CORAL EDITION  ★", W / 2, 59);
    g.textAlign = "left";
    // --- marching creatures at native pixel scale on the shoreline ---
    const order = ["skyro", "nibble", "pinebug", "voltpup", "gusthawk"];
    order.forEach((sp, i) => {
      const art = MON_FRONT[sp];
      const x = Math.floor(W - ((t * 22 + i * 58) % (W + 48)));
      const hop = (i + Math.floor(t * 4)) % 2 === 0 ? 0 : -1;
      const y = 151 - (art ? art.length : 16) + hop;
      g.fillStyle = "rgba(40,24,8,0.35)";
      g.fillRect(x + 1, 151 + 8, art ? art[0].length - 2 : 14, 2);
      if (art) blit(g, art, x, y);
    });
    // --- DS-style bottom prompt bar, full bleed ---
    const bar = g.createLinearGradient(0, 162, 0, H);
    bar.addColorStop(0, "#232f52"); bar.addColorStop(0.25, "#141c36"); bar.addColorStop(1, "#0a0f22");
    g.fillStyle = bar; g.fillRect(0, 162, W, H - 162);
    g.fillStyle = "#f8d838"; g.fillRect(0, 162, W, 2);
    g.fillStyle = "#f8f8f8"; g.fillRect(0, 164, W, 1);
    g.textAlign = "center";
    if (!this.menu) {
      if (Math.floor(t * 2) % 2 === 0) {
        g.font = "700 8px Verdana, Geneva, sans-serif";
        g.fillStyle = "#f8d838";
        g.fillText("PRESS Z / TAP TO START", W / 2, 170);
      }
      g.font = "6px Verdana, Geneva, sans-serif"; g.fillStyle = "#8fa0cc";
      g.fillText("ARROWS MOVE · Z CONFIRM · X BACK · M MUTE", W / 2, 181);
    } else this.menu.draw(g);
    g.textAlign = "left"; g.textBaseline = "alphabetic";
    window.__game = { screen: "title", t: this.t };
  }
}

window.addEventListener("pointerdown", ensureAudio, { once: false });
bindTouch();
setScreen(new Title());
requestAnimationFrame(loop);
