// Turn-based battle: Gen III-V damage/XP/catch formulas, original content.
import { MOVES, SPECIES, effectiveness } from "./data.js";
import { W, H, textbox, Menu, drawPanel, text, pressedEdge, measure } from "./engine.js";
import { MON_FRONT, MON_BACK, blit } from "./sprites.js";
import { sfx } from "./audio.js";

const IV = 15;
export function calcStats(spId, lv) {
  const b = SPECIES[spId].base;
  const st = (base) => Math.floor(((2 * base + IV) * lv) / 100) + 5;
  return {
    maxhp: Math.floor(((2 * b[0] + IV) * lv) / 100) + lv + 10,
    atk: st(b[1]), def: st(b[2]), spa: st(b[3]), spd: st(b[4]), spe: st(b[5]),
  };
}

export function makeMon(spId, lv) {
  const st = calcStats(spId, lv);
  const learn = SPECIES[spId].learn.filter(([l]) => l <= lv).map(([, m]) => m).slice(-4);
  return {
    sp: spId, lv, exp: lv * lv * lv, gd: Math.random() < 0.5 ? "M" : "F",
    moves: learn.map((id) => ({ id, pp: MOVES[id].pp })),
    hp: st.maxhp, ...st, status: null, stages: { atk: 0, def: 0 },
  };
}

export function stageMult(s) { return s >= 0 ? (2 + s) / 2 : 2 / (2 - s); }

export function damage(att, def, moveId) {
  const mv = MOVES[moveId];
  const crit = Math.random() < 1 / 16;
  const A = (mv.type === "Fire" || mv.type === "Water" || mv.type === "Grass")
    ? att.spa * stageMult(0) : att.atk * stageMult(att.stages.atk);
  // burn halves physical attack
  const atkVal = (mv.type !== "Fire" && mv.type !== "Water" && mv.type !== "Grass" && att.status === "brn")
    ? Math.floor(A / 2) : Math.floor(A);
  const D = (mv.type === "Fire" || mv.type === "Water" || mv.type === "Grass")
    ? def.spd : def.def * stageMult(def.stages.def);
  const base = Math.floor(Math.floor(Math.floor((2 * att.lv) / 5 + 2) * mv.pow * atkVal / Math.max(1, D)) / 50) + 2;
  const stab = mv.type === SPECIES[att.sp].t1 || mv.type === SPECIES[att.sp].t2 ? 1.5 : 1;
  const mult = effectiveness(mv.type, SPECIES[def.sp].t1, SPECIES[def.sp].t2);
  const rand = 0.85 + Math.random() * 0.15;
  const dmg = Math.max(1, Math.floor(base * stab * mult * (crit ? 2 : 1) * rand));
  return { dmg, crit, mult };
}

const xpNeed = (lv) => lv * lv * lv;
export function xpYield(base, lv) { return Math.floor((base * lv) / 7) * 3; } // x3 slice pace

function catchChance(foe, ball = 1, statusMult = 1) {
  const m = foe.maxhp, h = foe.hp, rate = SPECIES[foe.sp].rate;
  const a = ((3 * m - 2 * h) * rate * ball) / (3 * m) * statusMult;
  if (a >= 255) return { a, auto: true };
  const b = Math.floor(1048560 / Math.sqrt(Math.sqrt(16711680 / Math.max(1, a))));
  return { a, b, auto: false };
}

export class Battle {
  // playerParty: array (mutated), foeParty: array of {sp,lv} -> built internally
  // opts: {trainer:null|{name,before,after}, onEnd(win:bool)}
  constructor(playerParty, foeList, opts) {
    this.party = playerParty;
    this.foes = foeList.map((f) => makeMon(f.sp, f.lv));
    this.foeIdx = 0;
    this.active = 0;
    while (this.party[this.active].hp <= 0) this.active++;
    this.trainer = opts.trainer || null;
    this.onEnd = opts.onEnd;
    this.state = "intro";
    this.msgQ = [];
    this.menu = new Menu(["FIGHT", "BAG", "MON", "RUN"], W - 84, H - 88, 76);
    this.moveMenu = null; this.bagMenu = null; this.partyMenu = null;
    this.turnActions = [];
    this.ballShakes = 0;
    this.t = 0;
    this.foe = this.foes[0];
    this.participants = new Set();
    this.msg(this.trainer ? `${this.trainer.name} wants\nto battle!` : `Wild ${SPECIES[this.foe.sp].name}\nappeared!`,
      () => this.msg(this.trainer ? `${this.trainer.name} sent\nout ${nm(this.foe)}!` : null,
        () => this.msg(`Go! ${nm(this.me())}!`, () => { this.state = "menu"; })));
  }
  me() { return this.party[this.active]; }
  msg(t, then) {
    this.msgQ.push({ t: t || null, then });
    if (this.state !== "msg") { this.state = "msg"; this.nextMsg(); }
  }
  nextMsg() {
    if (this.state === "done") { this.msgQ.length = 0; return; }
    while (this.msgQ.length && !this.msgQ[0].t) {
      const m = this.msgQ.shift();
      if (m.then) { m.then(); return; }
    }
    const m = this.msgQ[0];
    if (!m) { this.state = "menu"; return; }
    textbox.say([m.t], () => { this.msgQ.shift(); if (m.then) m.then(); else this.nextMsg(); });
  }
  update(dt) {
    this.t += dt;
    if (this.state === "msg") {
      if (pressedEdge("a") || pressedEdge("start")) { sfx.blip(); textbox.advance(); if (!textbox.open && this.state === "msg") this.nextMsg(); }
      return;
    }
    if (textbox.open) return;
    if (this.state === "menu") {
      const c = this.menu.update();
      if (c === "FIGHT") {
        this.moveMenu = new Menu(this.me().moves.map((m) => `${MOVES[m.id].name} ${m.pp}/${MOVES[m.id].pp}`), W - 120, H - 100, 112);
        this.state = "moves"; sfx.confirm();
      } else if (c === "BAG") {
        const items = [];
        if (window.GAME.bag.orbit > 0) items.push(`ORBITx${window.GAME.bag.orbit}`);
        if (window.GAME.bag.potion > 0) items.push(`POTIONx${window.GAME.bag.potion}`);
        if (!items.length) items.push("(empty)");
        this.bagMenu = new Menu(items, W - 120, H - 100, 112);
        this.state = "bag"; sfx.confirm();
      } else if (c === "MON") {
        this.partyMenu = new Menu(this.party.map((m, i) => `${i === this.active ? "*" : " "}${SPECIES[m.sp].name} ${m.hp}/${m.maxhp}`), 8, 40, 120);
        this.state = "party"; sfx.confirm();
      } else if (c === "RUN") {
        if (this.trainer) { this.msg("No! There's no running\nfrom a TRAINER battle!", () => {}); }
        else { this.msg("Got away safely!", () => this.finish(true)); }
      } else if (c === "__cancel") { /* stay */ }
    } else if (this.state === "moves") {
      const c = this.moveMenu.update();
      if (c === "__cancel") { this.state = "menu"; }
      else if (c) {
        const idx = this.moveMenu.i;
        if (this.me().moves[idx].pp <= 0) { this.msg("No PP left!", () => {}); }
        else { this.turnActions = [{ kind: "move", idx }]; this.foeAction(); this.state = "turn"; this.turnStep = 0; }
      }
    } else if (this.state === "bag") {
      const c = this.bagMenu.update();
      if (c === "__cancel" || c === "(empty)") { this.state = "menu"; }
      else if (c) {
        if (c.startsWith("ORBIT")) {
          if (this.trainer) { this.msg("Can't catch a\nTRAINER's POKéMON!", () => {}); }
          else if (window.GAME.bag.orbit <= 0) { this.state = "menu"; }
          else { window.GAME.bag.orbit--; this.turnActions = [{ kind: "ball" }]; this.foeAction(); this.state = "turn"; this.turnStep = 0; }
        } else if (c.startsWith("POTION")) {
          if (window.GAME.bag.potion <= 0) { this.state = "menu"; }
          else { window.GAME.bag.potion--; this.turnActions = [{ kind: "potion" }]; this.foeAction(); this.state = "turn"; this.turnStep = 0; }
        }
      }
    } else if (this.state === "party") {
      const c = this.partyMenu.update();
      if (c === "__cancel") { this.state = "menu"; }
      else if (c) {
        const idx = this.partyMenu.i;
        if (idx === this.active) { this.state = "menu"; }
        else if (this.party[idx].hp <= 0) { this.msg("It's fainted!", () => {}); }
        else {
          const old = this.active; this.active = idx;
          this.me().stages = { atk: 0, def: 0 };
          this.msg(`Come back!`, () => this.msg(`Go! ${nm(this.me())}!`,
            () => { this.participants.add(this.active); this.turnActions = [{ kind: "pass" }]; this.foeAction(); this.state = "turn"; this.turnStep = 0; }));
        }
      }
    } else if (this.state === "turn") {
      this.resolveTurn();
    } else if (this.state === "ballanim") {
      // handled by timer in resolveTurn chain
    } else if (this.state === "faintpick") {
      const c = this.partyMenu.update();
      if (c && c !== "__cancel") {
        const idx = this.partyMenu.i;
        if (this.party[idx].hp > 0) {
          this.active = idx; this.me().stages = { atk: 0, def: 0 };
          this.msg(`Go! ${nm(this.me())}!`, () => {});
        }
      }
    }
  }
  foeAction() {
    const usable = this.foe.moves.map((m, i) => (m.pp > 0 ? i : -1)).filter((i) => i >= 0);
    const idx = usable.length ? usable[Math.floor(Math.random() * usable.length)] : 0;
    this.turnActions.push({ kind: "foemove", idx, foe: true });
    // order by priority then speed
    const spd = (a) => (a.foe ? this.foe.spe : this.me().spe);
    const pri = (a) => {
      if (a.kind === "ball" || a.kind === "potion" || a.kind === "pass") return 6;
      const mv = MOVES[(a.foe ? this.foe : this.me()).moves[a.idx].id];
      return mv.prio || 0;
    };
    this.turnActions.sort((a, b) => pri(b) - pri(a) || spd(b) - spd(a));
  }
  foeAlive() { return this.foe.hp > 0; }
  resolveTurn() {
    const act = this.turnActions[this.turnStep];
    if (!act) { this.state = "menu"; return; }
    this.turnStep++;
    if (act.kind === "ball") return this.doBall();
    if (act.kind === "potion") {
      const m = this.me();
      m.hp = Math.min(m.maxhp, m.hp + 20);
      sfx.heal();
      this.msg(`Used POTION on\n${SPECIES[m.sp].name}!`, () => this.resolveTurn());
      return;
    }
    if (act.kind === "pass") return this.resolveTurn();
    const user = act.foe ? this.foe : this.me();
    const target = act.foe ? this.me() : this.foe;
    if (user.hp <= 0) return this.resolveTurn();
    const mv = MOVES[user.moves[act.idx].id];
    // paralyze check
    if (user.status === "par" && Math.random() < 0.25) {
      this.msg(`${nm(user)} is\nparalyzed! It can't move!`, () => this.resolveTurn());
      return;
    }
    if (user.moves[act.idx].pp > 0) user.moves[act.idx].pp--;
    this.msg(`${nm(user)} used\n${mv.name}!`, () => {
      if (mv.pow === 0) {
        this.applyEffect(user, target, mv);
        return;
      }
      if (Math.random() * 100 >= mv.acc) { this.msg("But it missed!", () => this.resolveTurn()); return; }
      const { dmg, crit, mult } = damage(user, target, user.moves[act.idx].id);
      target.hp = Math.max(0, target.hp - dmg);
      if (mult > 1) sfx.super(); else if (mult < 1) sfx.weak(); else sfx.hit();
      let extra = "";
      if (crit) extra += "A critical hit! ";
      if (mult > 1) extra += "It's super effective!";
      else if (mult < 1 && mult > 0) extra += "It's not very effective...";
      // burn secondary
      if (mv.effect && mv.effect.burn && target.hp > 0 && !target.status && Math.random() < mv.effect.burn) {
        target.status = "brn"; extra += ` ${nm(target)}\nwas burned!`;
      }
      const after = () => {
        if (target.hp <= 0) return this.onFaint(target, !act.foe);
        this.resolveTurn();
      };
      if (extra) this.msg(extra, after);
      else after();
    });
  }
  applyEffect(user, target, mv) {
    const e = mv.effect;
    if (e.stat) {
      const t = e.self ? user : target;
      const before = t.stages[e.stat];
      t.stages[e.stat] = Math.max(-6, Math.min(6, before + e.stages));
      this.msg(t.stages[e.stat] === before ? "But nothing happened!" :
        `${nm(t)}'s ${e.stat === "atk" ? "ATTACK" : "DEFENSE"} ${e.stages > 0 ? "rose!" : "fell!"}`, () => this.resolveTurn());
    } else if (e.status === "par") {
      if (target.status && target.status !== "par") { this.msg("But it failed!", () => this.resolveTurn()); }
      else { target.status = "par"; this.msg(`${nm(target)} is\nparalyzed!`, () => this.resolveTurn()); }
    } else this.resolveTurn();
  }
  onFaint(target, wasFoe) {
    sfx.hit();
    this.msg(`${nm(target)}\nfainted!`, () => {
      if (wasFoe) {
        // XP to participants
        const gain = xpYield(SPECIES[target.sp].exp, target.lv);
        const parts = [...this.participants, this.active].filter((v, i, a) => a.indexOf(v) === i);
        const share = Math.floor(gain / Math.max(1, parts.length));
        const msgs = [];
        for (const pi of parts) {
          const m = this.party[pi];
          if (m.hp <= 0) continue;
          m.exp += share;
          msgs.push(`${SPECIES[m.sp].name} gained\n${share} EXP!`);
        }
        const nextFoe = this.foes[this.foeIdx + 1];
        if (nextFoe) {
          this.foeIdx++; this.foe = nextFoe;
          this.msg(msgs.length ? msgs.join("\n") : null, () => {
            this.levelChecks(() => this.msg(this.trainer ? `${this.trainer.name} sent\nout ${nm(this.foe)}!` : `Wild ${nm(this.foe)}\nappeared!`,
              () => { this.state = "menu"; }));
          });
        } else {
          this.msg(msgs.length ? msgs.join("\n") : null, () => {
            this.levelChecks(() => {
              if (this.trainer && this.trainer.after) this.msg(this.trainer.after, () => this.finish(true));
              else this.msg(this.trainer ? `You defeated\n${this.trainer.name}!` : null, () => this.finish(true));
            });
          });
        }
      } else {
        // player mon fainted
        if (this.party.every((m) => m.hp <= 0)) {
          this.msg("You have no POKéMON\nleft!", () => this.finish(false));
        } else {
          this.partyMenu = new Menu(this.party.map((m, i) => `${m.hp <= 0 ? "x" : " "}${SPECIES[m.sp].name} ${m.hp}/${m.maxhp}`), 8, 40, 130);
          this.state = "faintpick";
        }
      }
    });
  }
  levelChecks(done) {
    const m = this.party.find((p) => p.hp > 0 && p.exp >= xpNeed(p.lv + 1));
    if (!m) { done(); return; }
    m.lv++;
    const st = calcStats(m.sp, m.lv);
    const gain = st.maxhp - m.maxhp;
    Object.assign(m, st); m.hp = Math.min(m.maxhp, m.hp + gain);
    sfx.confirm();
    // learn new moves
    const nmoves = SPECIES[m.sp].learn.filter(([l]) => l === m.lv).map(([, id]) => id);
    this.msg(`${SPECIES[m.sp].name} grew to\nLV ${m.lv}!`, () => {
      const learnNext = () => {
        const id = nmoves.shift();
        if (!id) return this.levelChecks(done);
        if (m.moves.length < 4) { m.moves.push({ id, pp: MOVES[id].pp }); this.msg(`${SPECIES[m.sp].name} learned\n${MOVES[id].name}!`, learnNext); }
        else { m.moves.shift(); m.moves.push({ id, pp: MOVES[id].pp }); this.msg(`${SPECIES[m.sp].name} learned\n${MOVES[id].name}!`, learnNext); }
      };
      learnNext();
    });
  }
  doBall() {
    sfx.ball();
    this.msg(`You threw an\nORBIT BALL!`, () => {
      const foe = this.foe;
      const sm = foe.status === "par" || foe.status === "brn" ? 1.5 : 1;
      const { auto, b } = catchChance(foe, 1, sm);
      this.ballShakes = 0;
      const shake = () => {
        if (this.ballShakes >= 4) {
          sfx.catch_();
          const kept = window.GAME.registerCaught(foe);
          return this.msg(kept ? `Gotcha! ${nm(foe)}\nwas caught!`
            : `Gotcha! ...but PARTY\nis full! Released.`, () => this.finish(true));
        }
        const ok = auto || Math.floor(Math.random() * 65536) < b;
        this.ballT = 0; this.shaking = true;
        setTimeout(() => {
          this.shaking = false;
          if (!ok) {
            this.msg(`Oh no! It broke free!`, () => this.resolveTurn());
          } else { this.ballShakes++; shake(); }
        }, 600);
      };
      shake();
    });
  }
  finish(win) {
    this.state = "done";
    window.__bt = { state: "done" };
    textbox.open = false; textbox.queue = []; textbox.onDone = null;
    this.onEnd(win);
  }
  draw(g) {
    const sub = this.state === "moves" ? this.moveMenu.i : this.state === "bag" ? this.bagMenu.i
      : this.state === "party" || this.state === "faintpick" ? this.partyMenu.i : -1;
    window.__bt = { state: this.state, foe: this.foe.sp + " L" + this.foe.lv + " " + this.foe.hp + "/" + this.foe.maxhp, me: this.me().sp + " L" + this.me().lv + " " + this.me().hp + "/" + this.me().maxhp, menu: this.state === "menu" ? this.menu.i : -1, sub, php: this.party.map((m) => m.hp), ppp: this.me().moves.map((m) => m.pp) };
    drawBattleBg(g);
    // grass tufts: back tuft grounds the foe, wide front tuft grounds us
    drawPlatform(g, 196, 68, 48, 12);
    drawPlatform(g, 60, 132, 72, 15);
    // foe sprite (32x32 at 3x); feet seated on the mound's back slope.
    // idle bob when alive (shadow lives in tuft)
    const bob = Math.floor(this.t * 2) % 2;
    g.save(); g.translate(148, -6 + (this.foe.hp > 0 ? bob : 0)); g.scale(3, 3);
    blit(g, MON_FRONT[this.foe.sp], 0, 0); g.restore();
    // player back sprite seated on its mound's back slope (feet in the grass)
    const me = this.me();
    g.save(); g.translate(12, 50); g.scale(3, 3);
    blit(g, MON_BACK[me.sp], 0, 0); g.restore();
    if (this.state === "menu" || this.state === "moves" || this.state === "bag") {
      drawPanel(g, 2, H - 44, W - 4, 42);
    }
    // anchored HP plates: enemy top-left, ally bottom-right
    plate(g, 4, 6, this.foe, true);
    plate(g, W - 116, 104, me, false);
    if (this.state === "menu") this.menu.draw(g);
    if (this.state === "moves" && this.moveMenu) this.moveMenu.draw(g);
    if (this.state === "bag" && this.bagMenu) this.bagMenu.draw(g);
    if (this.state === "party" || this.state === "faintpick") {
      if (this.state === "faintpick") text(g, "Choose next!", 8, 44, "#f8f8f8", 8, true);
      this.partyMenu.draw(g);
    }
    if (this.shaking) text(g, "...wobble...", 110, 60, "#181820", 8, true);
  }
}

function nm(m) { return `${SPECIES[m.sp].name} LV${m.lv}`; }

function plate(g, x, y, m, foe) {
  const w = 108, h = foe ? 34 : 42;
  // detached sharp chrome: 4px screen inset, 2px corners, slanted inner
  // edge (parallelogram lean toward the battler) instead of a wedge tab
  const R = 0, SL = 10;
  const ax = foe ? 0 : x;
  const aw = foe ? x + w : W - x;
  const cw = w + SL;
  const cx = foe ? x : W - 4 - cw;
  const trace = () => {
    g.beginPath();
    if (foe) {
      // slant on the right edge: top (cx+cw-SL, y) -> bottom (cx+cw, y+h)
      g.moveTo(cx + R, y);
      g.lineTo(cx + cw - SL, y);
      g.arcTo(cx + cw - SL, y, cx + cw, y + h, R);
      g.lineTo(cx + cw, y + h);
      g.arcTo(cx + cw, y + h, cx, y + h, R);
      g.lineTo(cx + R, y + h);
      g.arcTo(cx, y + h, cx, y, R);
      g.lineTo(cx, y + R);
      g.arcTo(cx, y, cx + R, y, R);
    } else {
      // mirrored slant on the left edge: top (cx, y) -> bottom (cx+SL, y+h)
      g.moveTo(cx + cw - R, y);
      g.lineTo(cx, y);
      g.arcTo(cx, y, cx + SL, y + h, R);
      g.lineTo(cx + SL, y + h);
      g.arcTo(cx + SL, y + h, cx + cw, y + h, R);
      g.lineTo(cx + cw, y + h);
      g.arcTo(cx + cw, y + h, cx + cw, y, R);
      g.lineTo(cx + cw, y);
      g.arcTo(cx + cw, y, cx, y, R);
    }
    g.closePath();
  };
  g.save();
  g.translate(1, 2);
  trace();
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fill();
  g.restore();
  trace();
  g.fillStyle = "#fbfbf0";
  g.fill();
  g.fillStyle = "rgba(255,255,255,0.8)";
  g.fillRect(cx + R, y + 1, (foe ? cw - SL : cw) - 2 * R, 1);
  g.strokeStyle = "#181820";
  g.lineWidth = 1;
  trace();
  g.stroke();
  const pad = 10;
  // padded name (left) + measured right-aligned level (proportional font)
  text(g, SPECIES[m.sp].name, x + pad, y + 6, "#182028", 8, true);
  text(g, m.gd === "F" ? "♀" : "♂", x + pad + measure(g, SPECIES[m.sp].name, 8, true) + 3, y + 6, m.gd === "F" ? "#e05050" : "#2850c8", 8, true);
  const lv = "Lv" + m.lv;
  const lvw = measure(g, lv, 8, true);
  text(g, lv, ax + aw - 8 - lvw, y + 6, "#14305a", 8, true);
  // HP row: gold label + bordered color-changing continuous bar
  text(g, "HP", x + pad, y + 17, "#a07818", 7, true);
  const bx = x + 26, bw = w - 36, frac = Math.max(0, Math.min(1, m.hp / m.maxhp));
  g.fillStyle = "#283028"; g.fillRect(bx - 1, y + 16, bw + 2, 7);
  const col = frac > 0.5 ? "#48c848" : frac > 0.25 ? "#e8c838" : "#e84038";
  const fill = Math.floor(bw * frac);
  g.fillStyle = col; g.fillRect(bx, y + 17, Math.max(0, fill), 5);
  g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(bx, y + 17, Math.max(0, fill), 1);
  if (!foe) {
    // status pill left, HP numbers right-aligned on the same row
    if (m.status === "brn" || m.status === "par") {
      const lbl = m.status === "brn" ? "BRN" : "PAR";
      g.fillStyle = m.status === "brn" ? "#e87038" : "#e8c838";
      g.fillRect(x + pad, y + 25, 21, 8);
      text(g, lbl, x + pad + 2, y + 26, "#181820", 6, true);
    }
    const hpS = `${m.hp}/${m.maxhp}`;
    const hpw = measure(g, hpS, 7, true);
    text(g, hpS, ax + aw - 8 - hpw, y + 25, "#182028", 7, true);
    // XP bar along the plate foot
    const lo = m.lv * m.lv * m.lv, hi = (m.lv + 1) * (m.lv + 1) * (m.lv + 1);
    const xf = Math.max(0, Math.min(1, (m.exp - lo) / Math.max(1, hi - lo)));
    g.fillStyle = "#283028"; g.fillRect(x + 8, y + h - 6, aw - (x - ax) - 16, 3);
    g.fillStyle = "#58a8e8"; g.fillRect(x + 8, y + h - 6, Math.floor((aw - (x - ax) - 16) * xf), 3);
    g.fillStyle = "rgba(255,255,255,0.5)"; g.fillRect(x + 8, y + h - 6, Math.floor((aw - (x - ax) - 16) * xf), 1);
  } else if (m.status === "brn" || m.status === "par") {
    // foe plate has no XP row: pill sits bottom-left under the HP bar
    const lbl = m.status === "brn" ? "BRN" : "PAR";
    g.fillStyle = m.status === "brn" ? "#e87038" : "#e8c838";
    g.fillRect(x + pad, y + h - 10, 21, 8);
    text(g, lbl, x + pad + 2, y + h - 9, "#181820", 6, true);
  }
}

// Sky-over-R29-meadow backdrop: pale gradient sky, grass base with R29
// meadow speckle (#4f9a55 dark tufts, #6cba70 light blades on #5da862).
function drawBattleBg(g) {
  const HOR = 78; // sky-meadow boundary (soft blend, no seam)
  const sky = g.createLinearGradient(0, 0, 0, HOR + 6);
  sky.addColorStop(0, "#c9f0c9");
  sky.addColorStop(1, "#a5e0ab");
  g.fillStyle = sky; g.fillRect(0, 0, W, HOR + 6);
  const gr = g.createLinearGradient(0, HOR - 6, 0, H);
  gr.addColorStop(0, "#a5e0ab");
  gr.addColorStop(0.2, "#6cba70");
  gr.addColorStop(0.4, "#5da862");
  gr.addColorStop(1, "#478e4d");
  g.fillStyle = gr; g.fillRect(0, HOR - 6, W, H - HOR + 6);
  // grass tufts straddling the boundary break the straight edge
  for (let i = 0; i < 40; i++) {
    const sx = (i * 53 + 7) % W;
    const sy = HOR - 4 + ((i * 29 + 11) % 10);
    g.fillStyle = i % 2 ? "#4f9a55" : "#6cba70";
    g.fillRect(sx, sy, 2, 1);
  }
  // deterministic grass speckle across the whole grass base
  for (let i = 0; i < 150; i++) {
    const sx = (i * 53 + 7) % W;
    const sy = HOR + 4 + ((i * 29 + 11) % (H - HOR - 6));
    if (i % 3 === 0) { g.fillStyle = "#6cba70"; g.fillRect(sx, sy, 1, 1); }
    else { g.fillStyle = i % 3 === 1 ? "#4f9a55" : "#478e4d"; g.fillRect(sx, sy, 2, 1); }
  }
  // short vertical blades for texture
  g.fillStyle = "#3d7d3a";
  for (let i = 0; i < 30; i++) {
    const bx = (i * 71 + 3) % W;
    const by = HOR + 6 + ((i * 37 + 9) % (H - HOR - 10));
    g.fillRect(bx, by, 1, 2);
  }
}

// Raised perspective mound: deep offset drop shadow grounds it, dark rim
// base peeks below a lifted light crown, denser dark speckle toward the
// back (top) edge sells the far slope; battler feet sit on that back slope.
function drawPlatform(g, cx, cy, rx, ry) {
  cx = Math.round(cx); cy = Math.round(cy);
  // deep offset drop shadow (ground contact, not a hairline)
  g.fillStyle = "rgba(0,0,0,0.30)";
  g.beginPath(); g.ellipse(cx + 3, cy + 7, rx, Math.max(4, ry * 0.62), 0, 0, 7); g.fill();
  g.fillStyle = "rgba(0,0,0,0.20)";
  g.beginPath(); g.ellipse(cx + 2, cy + 5, rx * 0.96, Math.max(3, ry * 0.55), 0, 0, 7); g.fill();
  // dark rim base pushed down so its front lip peeks under the crown
  g.fillStyle = "#3d7d3a";
  g.beginPath(); g.ellipse(cx, cy + 2, rx, ry, 0, 0, 7); g.fill();
  // light crown lifted above the rim
  g.fillStyle = "#63b168";
  g.beginPath(); g.ellipse(cx, cy - 1, rx, ry, 0, 0, 7); g.fill();
  // light catch along the back (top) arc of the crown
  g.strokeStyle = "#86cc80"; g.lineWidth = 1;
  g.beginPath(); g.ellipse(cx, cy - 1, rx - 1, Math.max(2, ry - 1), 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
  // dense dark crown shading toward the back edge (upper half)
  for (let i = 0; i < 30; i++) {
    const px = cx - rx + 2 + ((i * 37 + 11) % Math.max(4, rx * 2 - 4));
    const py = cy - 1 - ry + 2 + ((i * 23 + 5) % Math.max(2, ry - 1));
    const dx = (px - cx) / rx, dy = (py - (cy - 1)) / ry;
    if (dx * dx + dy * dy > 1) continue;
    g.fillStyle = i % 3 === 2 ? "#478e4d" : "#4f9a55";
    g.fillRect(px, py, 2, 1);
  }
  // sparse light blades toward the front slope
  for (let i = 0; i < 12; i++) {
    const px = cx - rx + 3 + ((i * 53 + 9) % Math.max(4, rx * 2 - 6));
    const py = cy + ((i * 31 + 3) % Math.max(2, ry - 1));
    const dx = (px - cx) / rx, dy = (py - (cy - 1)) / ry;
    if (dx * dx + dy * dy > 1) continue;
    g.fillStyle = i % 2 ? "#6cba70" : "#86cc80";
    g.fillRect(px, py, 2, 1);
  }
  // upright blade fringe along the back rim
  const blades = Math.max(8, Math.round(rx / 6));
  g.fillStyle = "#3d7d3a";
  for (let i = 0; i < blades; i++) {
    const px = cx - rx + 4 + ((i * 41 + 7) % Math.max(4, rx * 2 - 8));
    g.fillRect(px, cy - 1 - ry - 1 + (i % 2), 1, 2);
  }
}
