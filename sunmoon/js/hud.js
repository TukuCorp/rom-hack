// hud.js — Gen VII battle HUD: top-screen battler plates, bottom-screen message + menus.
// Owned by: HUD builder. Owns ui.css. Builds its DOM inside #topui / #bottomui.
//
// Public API (called by battle.js / main.js):
//   init(state, ctx)                 build DOM, install input listeners
//   update(state, t)                 sync DOM to state every frame (plates, cursor, typing)
//   forceMode(state, mode)           'menu' | 'moves' | 'z' | 'party' | 'bag' (capture helper)
//   say(state, text) -> Promise      show a message; resolves on confirm
//   askCommand(state) -> Promise<'fight'|'pokemon'|'bag'|'run'>
//   askMove(state) -> Promise<{move, z}|null>
//   askParty(state, opts) -> Promise<index|-1>   opts: {force, mustBeAlive}
//   askBag(state) -> Promise<index|-1>
//
// Input: arrows/WASD move · Z/Space/Enter confirm · X/Esc back · Enter arms the Z-Move ·
//        H toggles the foe HP numbers · mouse/touch: hover selects, click confirms,
//        tapping the message box advances the text.
// state.auto (window ?auto=1) auto-advances messages and picks moves, for captures.

import { expToLevel, TYPE_COLORS } from './data.js';

const COMMANDS = ['fight', 'pokemon', 'bag', 'run'];
const COMMAND_LABEL = { fight: 'FIGHT', pokemon: 'POKéMON', bag: 'BAG', run: 'RUN' };

// Original CSS-drawn emblems (one Poké Ball per command, Gen VII arrangement).
const EMBLEM = {
  pokemon: '<span class="emblem"><i class="balli"></i></span>',
  bag: '<span class="emblem"><i class="pouch"></i><i class="flap"></i><i class="clasp"></i></span>',
  fight: '<span class="emblem"><i class="fl f1"></i><i class="fl f2"></i><i class="fl f3"></i></span>',
  run: '<span class="emblem runl"><i class="sole"></i></span><span class="emblem runr"><i class="sole"></i></span>',
};

const WEATHER = {
  exeggutorIsland: { key: 'clear', label: 'Clear' },
  altarOfSunne: { key: 'dusk', label: 'Dusk' },
};

let el = {};
const pend = { resolve: null, kind: null, opts: {} };

/* ------------------------------------------------------------------ helpers */

const alive = m => !!(m && !m.fainted && m.hp > 0);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dtSafe = state => Math.min(0.05, state.dt || 0.016);
function rgb(c, k = 1) { return `rgb(${c.map(v => Math.round(Math.min(1, v * k) * 255)).join(',')})`; }
const typeColor = t => rgb(TYPE_COLORS[t] || [0.5, 0.5, 0.5]);
const typeDark = t => rgb(TYPE_COLORS[t] || [0.5, 0.5, 0.5], 0.55);
function hpClass(ratio) { return ratio > 0.5 ? '' : ratio > 0.2 ? 'mid' : 'low'; }

// Gen VII plates print the individual's gender next to the name. Nothing in the demo's roster
// data carries one yet, so the two sides of this battle stand in for it — the plate redraws the
// moment data.js/scene.js start setting mon.gender.
const sexOf = (mon, side) => mon.gender || (side === 'foe' ? 'female' : 'male');

// Held-item label for the plate chip: the roster stores keys ('firiumZ'), the plate prints names.
const ITEM_NAME = { firiumZ: 'Firium Z' };
const itemName = key => ITEM_NAME[key] || key;

/* -------------------------------------------------------------------- build */

function plateHTML(side) {
  const ally = side === 'ally';
  return `<div class="plate ${side} off" id="${side}Plate">
    <div class="ptop">
      <span class="nm"></span><span class="sex" role="img"><i></i></span>
      ${ally ? '<span class="zcry" title="Held item"><i class="gem"></i><span class="zname"></span></span>' : ''}
      <span class="lv"><i>Lv.</i><b></b></span>
    </div>
    <div class="pbarbg"><div class="pinner">
      <span class="track"><span class="ghost"></span><span class="fill"></span></span>
      <span class="ball" title="HP"></span>
      <span class="pnum"></span>
    </div></div>
    ${ally ? '<div class="exptrack"><span class="expfill"></span></div>' : ''}
  </div>`;
}

export function init(state, ctx) {
  const top = document.getElementById('topui');
  const bottom = document.getElementById('bottomui');

  top.innerHTML = `${plateHTML('foe')}${plateHTML('ally')}<div id="toast"></div>`;
  bottom.innerHTML = `<div class="sc" id="sc" data-mode="hidden">
      <div class="sc-map"></div><div class="sc-swirl a"></div><div class="sc-swirl b"></div>
      <div class="sc-frame"></div>
      <div id="wchip"><span class="wico"></span><span class="wlab">Clear</span></div>
      <div id="pballs"></div>
      <div id="zchip"><span class="zg">Z</span><span class="zlab">Z-POWER</span></div>
      <div class="menu" id="commands">${COMMANDS.map((c, i) => `
        <button class="cmd gplate ${c}" data-i="${i}">
          ${EMBLEM[c]}<span class="lbl">${COMMAND_LABEL[c]}</span>
        </button>`).join('')}</div>
      <div class="menu" id="movemenu"></div>
      <div class="menu" id="party"></div>
      <div class="menu" id="bagmenu"></div>
      <div id="msg" role="button" tabindex="-1"><span id="msgtext"></span><span id="arrow">▼</span></div>
    </div>`;

  const q = (root, sel) => root.querySelector(sel);
  el = {
    sc: q(bottom, '#sc'),
    foePlate: q(top, '#foePlate'), allyPlate: q(top, '#allyPlate'),
    foe: {
      root: q(top, '#foePlate'), nm: q(top, '#foePlate .nm'), sex: q(top, '#foePlate .sex'),
      lv: q(top, '#foePlate .lv b'), fill: q(top, '#foePlate .fill'), ghost: q(top, '#foePlate .ghost'),
      num: q(top, '#foePlate .pnum'), side: 'foe', a: 0, sig: '',
    },
    ally: {
      root: q(top, '#allyPlate'), nm: q(top, '#allyPlate .nm'), sex: q(top, '#allyPlate .sex'),
      lv: q(top, '#allyPlate .lv b'), fill: q(top, '#allyPlate .fill'), ghost: q(top, '#allyPlate .ghost'),
      num: q(top, '#allyPlate .pnum'), side: 'ally', item: q(top, '#allyPlate .zname'),
      exp: q(top, '#allyPlate .expfill'), a: 0, sig: '',
    },
    msg: q(bottom, '#msg'), msgtext: q(bottom, '#msgtext'), arrow: q(bottom, '#arrow'),
    commands: q(bottom, '#commands'), movemenu: q(bottom, '#movemenu'),
    party: q(bottom, '#party'), bagmenu: q(bottom, '#bagmenu'),
    zchip: q(bottom, '#zchip'), pballs: q(bottom, '#pballs'),
    wchip: q(bottom, '#wchip'), wlab: q(bottom, '#wchip .wlab'),
    toast: q(top, '#toast'),
  };

  // --- command plates: hover selects (Gen VII single-tap), click confirms
  el.commands.addEventListener('pointerover', e => {
    const b = e.target.closest('.cmd');
    if (b && state.hud.mode === 'command') state.hud.commandIndex = +b.dataset.i;
  });
  el.commands.addEventListener('click', e => {
    const b = e.target.closest('.cmd');
    if (!b || state.hud.mode !== 'command') return;
    state.hud.commandIndex = +b.dataset.i;
    confirmAction(state);
  });

  // --- move plates
  el.movemenu.addEventListener('pointerover', e => {
    const b = e.target.closest('.mv');
    if (b && state.hud.mode === 'moves') state.hud.moveIndex = +b.dataset.i;
  });
  el.movemenu.addEventListener('click', e => {
    const b = e.target.closest('.mv');
    if (!b || state.hud.mode !== 'moves') return;
    state.hud.moveIndex = +b.dataset.i;
    confirmAction(state);
  });

  // --- party rows (fainted rows are refused unless the switch is forced)
  el.party.addEventListener('pointerover', e => {
    const b = e.target.closest('.pm');
    if (!b || state.hud.mode !== 'party') return;
    const i = +b.dataset.i;
    if (i >= 0 && pend.opts.mustBeAlive && !alive(state.party[i])) return;
    state.hud.partyIndex = i;
  });
  el.party.addEventListener('click', e => {
    const b = e.target.closest('.pm');
    if (!b || state.hud.mode !== 'party') return;
    pickParty(state, +b.dataset.i, b);
  });

  // --- bag rows
  el.bagmenu.addEventListener('pointerover', e => {
    const b = e.target.closest('.bm');
    if (b && state.hud.mode === 'bag') state.hud.bagIndex = +b.dataset.i;
  });
  el.bagmenu.addEventListener('click', e => {
    const b = e.target.closest('.bm');
    if (!b || state.hud.mode !== 'bag') return;
    state.hud.bagIndex = +b.dataset.i;
    confirmAction(state);
  });

  // --- tapping the message box advances dialogue (Gen VII bottom-screen tap)
  el.msg.addEventListener('click', () => { if (state.hud.mode === 'wait') advance(state); });
  el.zchip.addEventListener('click', () => {
    if (state.hud.mode === 'moves') toggleZ(state, true);
  });

  state.hud.mode = 'hidden';
  state.hud.typing = null;
  window.addEventListener('keydown', ev => onKey(state, ev));
}

/* ------------------------------------------------------------------ input */

const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  z: 'ok', Z: 'ok', ' ': 'ok', Enter: 'zring', x: 'back', X: 'back', Escape: 'back', Backspace: 'back',
};

function onKey(state, ev) {
  const act = KEYMAP[ev.key];
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  if (key === 'h') { state.hud.foeNums = !state.hud.foeNums; return; }
  if (!act) return;
  ev.preventDefault();
  const mode = state.hud.mode;
  if (act === 'ok') {
    if (mode === 'wait') return advance(state);
    if (mode === 'command' || mode === 'moves' || mode === 'party' || mode === 'bag') confirmAction(state);
    return;
  }
  if (act === 'zring') {
    if (mode === 'moves') toggleZ(state, true);
    else if (mode === 'wait') advance(state);
    return;
  }
  if (act === 'back') {
    if (mode === 'moves' || mode === 'party' || mode === 'bag') cancelAction(state);
    return;
  }
  if (mode === 'command') moveCursor(state, act, COMMANDS.length, 'commandIndex');
  else if (mode === 'moves') moveCursor(state, act, state.units.player.mon.moves.length, 'moveIndex');
  else if (mode === 'party') moveParty(state, act);
  else if (mode === 'bag') moveCursor(state, act, state.bag.length + 1, 'bagIndex', -1);
}

/** Wait-mode confirm: first press completes the typewriter, second advances. */
function advance(state) {
  if (state.hud.typing != null) { state.hud.typing = null; return; }
  confirmAction(state);
}

/** Cycle a menu cursor; `backIdx` (-1) marks a trailing Back row. */
function moveCursor(state, act, len, key, backIdx) {
  const h = state.hud;
  const total = backIdx === -1 ? len + 1 : len;
  const cur = h[key] === -1 ? len : h[key];
  const step = (act === 'up' || act === 'left') ? -1 : 1;
  let next = (cur + step + total) % total;
  h[key] = next === len && backIdx === -1 ? -1 : next;
}

/** Party cursor: arrows skip fainted members when the switch must be to a living one. */
function moveParty(state, act) {
  const h = state.hud;
  const n = state.party.length + 1;                       // + Back
  const step = (act === 'up' || act === 'left') ? -1 : 1;
  const cur = h.partyIndex === -1 ? state.party.length : h.partyIndex;
  for (let k = 1; k <= n; k++) {
    const i = (cur + step * k + n * 2) % n;
    const idx = i === state.party.length ? -1 : i;
    if (idx === -1 || !pend.opts.mustBeAlive || alive(state.party[idx])) { h.partyIndex = idx; return; }
  }
}

function toggleZ(state, explicit) {
  const mon = state.units.player && state.units.player.mon;
  if (!mon || !state.zReady) return false;
  const mv = mon.moves[state.hud.moveIndex];
  if (!mv) return false;
  if (mv.type !== 'fire') { state.zArmed = false; return false; }   // Firium Z, this demo's crystal
  state.zArmed = explicit ? !state.zArmed : true;
  return state.zArmed;
}

function confirmAction(state) {
  const h = state.hud;
  if (pend.kind === 'wait') return settle();
  if (pend.kind === 'command') return settle(COMMANDS[h.commandIndex]);
  if (pend.kind === 'moves') {
    const mon = state.units.player.mon;
    const mv = mon.moves[h.moveIndex];
    if (!mv) return;
    if (state.zArmed && mv.type === 'fire') {
      const z = { ...mv, key: 'infernoOverdrive', name: 'Inferno Overdrive', cat: 'z',
                  baseCat: mv.cat, basePower: mv.power, power: 0, pp: 1, maxPP: 1, type: 'fire' };
      return settle({ move: z, z: true });
    }
    return settle({ move: mv, z: false });
  }
  if (pend.kind === 'party') return pickParty(state, h.partyIndex, null);
  if (pend.kind === 'bag') return settle(h.bagIndex);
}

function pickParty(state, i, node) {
  if (i === -1 || i == null) return settle(-1);
  const m = state.party[i];
  if (!m) return;
  // A faint-forced switch asks for a living body (mustBeAlive); other prompts still
  // let `force` pick a fainted row. Everything else is refused, as in Gen VII.
  if (!alive(m) && (pend.opts.mustBeAlive || !pend.opts.force)) {
    flash(state, node, i);
    return;
  }
  state.hud.partyIndex = i;
  return settle(i);
}

/** Nudge a refused row (fainted member) without resolving the prompt. */
function flash(state, node, i) {
  const b = node || el.party.querySelector(`.pm[data-i="${i}"]`);
  if (!b) return;
  b.classList.remove('nope');
  void b.offsetWidth;
  b.classList.add('nope');
  setTimeout(() => b.classList.remove('nope'), 460);
}

function cancelAction(state) {
  if (pend.kind === 'moves') { state.zArmed = false; return settle(null); }
  if (pend.kind === 'party' && !pend.opts.force) return settle(-1);
  if (pend.kind === 'bag') return settle(-1);
}

function settle(value) {
  const r = pend.resolve;
  pend.resolve = null; pend.kind = null; pend.opts = {};
  if (r) r(value);
}

/* ------------------------------------------------------------------- flow */

export async function say(state, text) {
  state.text = text;
  state.hud.mode = 'wait';
  state.hud.typing = 0;                 // 0 -> typing; null -> finished
  await new Promise(res => {
    pend.resolve = res; pend.kind = 'wait'; pend.opts = {};
    if (state.auto) setTimeout(() => { if (pend.kind === 'wait') settle(undefined); }, 700);
  });
}

export function askCommand(state) {
  state.hud.mode = 'command';
  state.hud.commandIndex = state.hud.commandIndex || 0;
  return new Promise(res => { pend.resolve = res; pend.kind = 'command'; pend.opts = {}; });
}

export function askMove(state) {
  state.hud.mode = 'moves';
  state.zArmed = false;
  return new Promise(res => {
    pend.resolve = res; pend.kind = 'moves'; pend.opts = {};
    if (state.auto) setTimeout(() => {
      if (pend.kind !== 'moves') return;
      state.hud.moveIndex = Math.min(1, (state.units.player.mon.moves.length - 1));
      confirmAction(state);
    }, 550);
  });
}

export function askParty(state, opts = {}) {
  state.hud.mode = 'party';
  const h = state.hud;
  if (opts.force) {
    // Forced switch (a faint): open on a living, non-active member.
    let idx = -1;
    for (let i = 0; i < state.party.length; i++) {
      if (alive(state.party[i]) && i !== state.active) { idx = i; break; }
    }
    if (idx === -1) for (let i = 0; i < state.party.length; i++) if (alive(state.party[i])) { idx = i; break; }
    if (idx >= 0) h.partyIndex = idx;
  } else {
    h.partyIndex = state.active;
    if (h.partyIndex < 0 || h.partyIndex >= state.party.length) h.partyIndex = 0;
  }
  return new Promise(res => { pend.resolve = res; pend.kind = 'party'; pend.opts = opts; });
}

export function askBag(state) {
  state.hud.mode = 'bag';
  state.hud.bagIndex = Math.min(state.hud.bagIndex || 0, state.bag.length - 1);
  if (state.hud.bagIndex < 0) state.hud.bagIndex = 0;
  return new Promise(res => { pend.resolve = res; pend.kind = 'bag'; pend.opts = {}; });
}

export function forceMode(state, mode) {
  state.forced = mode;
  if (mode === 'moves') { state.hud.mode = 'moves'; toggleZ(state, true); }
  else if (mode === 'menu' || mode === 'command') state.hud.mode = 'command';
  else if (mode === 'party') state.hud.mode = 'party';
  else if (mode === 'bag') state.hud.mode = 'bag';
}

/* ----------------------------------------------------------------- render */

export function update(state, t) {
  const h = state.hud;
  if (state.forced) h.mode = state.forced === 'menu' ? 'command' : state.forced;
  const mode = h.mode || 'hidden';
  if (el.sc.dataset.mode !== mode) el.sc.dataset.mode = mode;

  // Z-Move arming only applies to the Firium Z move
  if (state.zArmed) {
    const mv = state.units.player && state.units.player.mon.moves[h.moveIndex];
    if (!mv || mv.type !== 'fire') state.zArmed = false;
  }

  // --- battler plates (ally keeps HP numbers permanently; foe's are on the H toggle)
  // A Gen VII Z-Move frame carries no HUD at all: the plates fade out for the cinematic and
  // fade back in when effects.js clears state.cinematic.
  const fade = state.cinematic ? 0 : 1;
  syncPlate(state, el.foe, state.units.foe, !!h.foeNums, fade);
  syncPlate(state, el.ally, state.units.player, true, fade);
  el.sc.classList.toggle('cine', !!state.cinematic);
  el.allyPlate.classList.toggle('zready', !!state.zReady);
  el.allyPlate.classList.toggle('zarmed', !!state.zReady && !!state.zArmed);
  if (state.units.player && state.units.player.mon) {
    const mon = state.units.player.mon;
    const label = state.zReady && mon.held ? itemName(mon.held) : '';
    if (el.ally.item.textContent !== label) el.ally.item.textContent = label;
    const need = Math.max(1, expToLevel(mon.level + 1) - expToLevel(mon.level));
    const have = Math.max(0, mon.exp - expToLevel(mon.level));
    const pct = Math.min(100, (have / need) * 100).toFixed(1) + '%';
    if (el.ally.exp.dataset.w !== pct) { el.ally.exp.dataset.w = pct; el.ally.exp.style.width = pct; }
  }

  // --- message + typewriter
  if (h.typing != null && state.text.length) {
    const cps = state.auto ? 90 : 34;
    h.typing = Math.min(state.text.length, (h.typing || 0) + cps * dtSafe(state));
    const n = Math.floor(h.typing);
    if (el.msgtext.dataset.n !== String(n)) { el.msgtext.dataset.n = String(n); el.msgtext.textContent = state.text.slice(0, n); }
    if (h.typing >= state.text.length) h.typing = null;
  } else if (el.msgtext.dataset.full !== state.text) {
    el.msgtext.dataset.full = state.text; el.msgtext.dataset.n = String(state.text.length);
    el.msgtext.textContent = state.text;
  }
  const ready = h.typing == null && mode === 'wait';
  if (el.arrow.dataset.on !== String(ready)) { el.arrow.dataset.on = String(ready); el.arrow.classList.toggle('show', ready); }

  // --- chips
  const w = WEATHER[state.sceneKey] || WEATHER.exeggutorIsland;
  if (el.wchip.dataset.k !== w.key) {
    el.wchip.dataset.k = w.key;
    el.wchip.className = 'w' + w.key;
    el.wlab.textContent = w.label;
  }
  const zState = !state.zReady ? 'used' : state.zArmed ? 'armed' : 'ready';
  if (el.zchip.dataset.st !== zState) { el.zchip.dataset.st = zState; el.zchip.className = `zs-${zState}`; }

  // --- party ball strip (message view, Gen VII)
  if (mode === 'wait' || mode === 'hidden') syncPartyBalls(state);

  // --- menus
  if (mode === 'command') {
    [...el.commands.children].forEach((b, i) => b.classList.toggle('sel', i === h.commandIndex));
  }
  if (mode === 'moves') renderMoves(state);
  if (mode === 'party') renderParty(state);
  if (mode === 'bag') renderBag(state);
}

function syncPlate(state, dom, unit, showNums, fade = 1) {
  if (!unit || !unit.mon) {
    if (dom.sig !== 'none') { dom.sig = 'none'; dom.root.classList.add('off'); }
    return;
  }
  const mon = unit.mon;
  // Gen VII: the plate fades in as the mon lands and fades out while it is recalled.
  const dt = dtSafe(state);
  const a = unit.entity && unit.entity.anim ? unit.entity.anim : null;
  let target = 1;
  if (!unit.entity) target = 0;
  else if (a && (a.name === 'recall' || a.name === 'flee')) target = 0;
  else if (a && a.name === 'faint') target = a.t > 0.4 ? 0 : 1;
  else if (a && a.name === 'enter') target = Math.min(1, a.t / 0.45);
  dom.a += (target - dom.a) * Math.min(1, dt * 7);
  if (Math.abs(target - dom.a) < 0.004) dom.a = target;
  const vis = dom.a * fade;
  dom.root.style.opacity = vis.toFixed(3);
  dom.root.classList.toggle('off', vis < 0.02);

  // HP drain (fast) with a slower white ghost trailing behind it
  if (unit.shown == null) { unit.shown = mon.hp; unit.ghost = mon.hp; }
  const rate = Math.max(mon.maxHP / 0.9, 1) * dt;
  const diff = unit.shown - mon.hp;
  if (Math.abs(diff) > 0.05) unit.shown -= Math.sign(diff) * Math.min(Math.abs(diff), rate);
  else unit.shown = mon.hp;
  if (unit.ghost == null) unit.ghost = unit.shown;
  if (unit.ghost > unit.shown + 0.05) unit.ghost = Math.max(unit.shown, unit.ghost - Math.max(mon.maxHP / 1.9, 1) * dt);
  else unit.ghost = unit.shown;

  const ratio = Math.max(0, unit.shown) / mon.maxHP;
  const gRatio = Math.max(0, unit.ghost) / mon.maxHP;
  const fillW = (ratio * 100).toFixed(1) + '%';
  const ghostW = (gRatio * 100).toFixed(1) + '%';
  const cls = `fill ${hpClass(ratio)}`;
  const shownNum = `${Math.max(0, Math.round(unit.shown))}/${mon.maxHP}`;
  const sex = sexOf(mon, dom.side);
  const sig = `${mon.name}|${sex}|${mon.level}|${shownNum}|${showNums ? 1 : 0}`;
  if (dom.sig !== sig) {
    dom.sig = sig;
    dom.nm.textContent = mon.name;
    dom.sex.className = `sex ${sex}`;
    dom.sex.title = sex === 'female' ? 'Female' : sex === 'male' ? 'Male' : 'Gender unknown';
    dom.lv.textContent = mon.level;
    dom.num.textContent = showNums ? shownNum : '';
  }
  if (dom.fill.dataset.w !== fillW) { dom.fill.dataset.w = fillW; dom.fill.style.setProperty('--w', fillW); }
  if (dom.fill.className !== cls) dom.fill.className = cls;
  if (dom.ghost.dataset.w !== ghostW) { dom.ghost.dataset.w = ghostW; dom.ghost.style.setProperty('--w', ghostW); }
}

function syncPartyBalls(state) {
  const sig = state.party.map(m => `${Math.round(m.hp * 4 / Math.max(1, m.maxHP))}${m.fainted ? 'f' : ''}`).join('') + '|' + state.active;
  if (el.pballs.dataset.sig === sig) return;
  el.pballs.dataset.sig = sig;
  el.pballs.innerHTML = state.party.map((m, i) => {
    const r = Math.max(0, Math.min(1, m.hp / Math.max(1, m.maxHP)));
    const c = r > 0.5 ? '#6ee24a' : r > 0.2 ? '#ffc02e' : '#ee4b3a';
    return `<span class="pb ${m.fainted ? 'out' : ''} ${i === state.active ? 'act' : ''}"><i style="--hc:${c}"></i></span>`;
  }).join('');
}

/* --------------------------------------------------------------- menus */

function renderMoves(state) {
  const mon = state.units.player.mon;
  const h = state.hud;
  const sig = `${mon.species}|${mon.moves.map(m => m.pp).join(',')}|${h.moveIndex}|${state.zArmed}|${state.zReady}`;
  if (el.movemenu.dataset.sig === sig) return;
  el.movemenu.dataset.sig = sig;
  el.movemenu.innerHTML = mon.moves.map((mv, i) => {
    const z = state.zArmed && i === h.moveIndex && mv.type === 'fire';
    const name = z ? 'Inferno Overdrive' : mv.name;
    return `<button class="mv gplate ${z ? 'z' : ''} ${i === h.moveIndex ? 'sel' : ''}" data-i="${i}"
      style="--tc:${typeColor(mv.type)};--tcd:${typeDark(mv.type)}">
      <span class="band"></span>
      <span class="mv-name">${esc(name)}</span>
      <span class="mv-meta">
        <span class="mv-type">${z ? 'Z-MOVE' : esc(mv.type.toUpperCase())}</span>
        <span class="mv-pp">PP ${z ? 1 : mv.pp}/${z ? 1 : mv.maxPP}</span>
      </span>
      ${z ? '<span class="zflag">Z</span>' : ''}
    </button>`;
  }).join('');
}

function renderParty(state) {
  const h = state.hud;
  const sig = state.party.map(m => `${m.name}${m.level}${Math.round(m.hp)}/${m.maxHP}${m.fainted ? 'f' : ''}`).join('~')
    + `|${h.partyIndex}|${state.active}|${pend.opts.force ? 'F' : ''}`;
  if (el.party.dataset.sig === sig) return;
  el.party.dataset.sig = sig;
  el.party.innerHTML = state.party.map((m, i) => {
    const out = !alive(m);
    const r = Math.max(0, Math.min(1, m.hp / Math.max(1, m.maxHP))) * 100;
    return `<button class="pm gplate ${out ? 'out' : ''} ${i === h.partyIndex ? 'sel' : ''}" data-i="${i}">
      <span class="pm-top"><span class="pm-name">${esc(m.name)}</span><span class="pm-lv">Lv.${m.level}</span></span>
      <span class="pm-bar"><span class="pm-fill ${hpClass(r / 100)}" style="width:${r.toFixed(1)}%"></span></span>
      <span class="pm-bot">
        <span class="pm-hp">${Math.max(0, Math.round(m.hp))}/${m.maxHP}</span>
        ${i === state.active ? '<span class="pm-act">IN BATTLE</span>' : ''}
        ${out ? '<span class="pm-fnt">FAINTED</span>' : ''}
      </span>
    </button>`;
  }).join('') + `<button class="pm gplate back ${h.partyIndex === -1 ? 'sel' : ''}" data-i="-1">
      <span class="pm-top"><span class="pm-name">Back</span></span>
      <span class="pm-bot"><span class="pm-hp">Return to the battle menu</span></span>
    </button>`;
}

function renderBag(state) {
  const h = state.hud;
  const sig = state.bag.map(it => `${it.name}${it.count}`).join('~') + `|${h.bagIndex}`;
  if (el.bagmenu.dataset.sig === sig) return;
  el.bagmenu.dataset.sig = sig;
  el.bagmenu.innerHTML = state.bag.map((it, i) => `
    <button class="bm gplate ${it.count <= 0 ? 'out' : ''} ${i === h.bagIndex ? 'sel' : ''}" data-i="${i}">
      <span class="bm-ico"><i></i></span>
      <span class="bm-name">${esc(it.name)}</span>
      <span class="bm-n">×${it.count}</span>
    </button>`).join('') + `<button class="bm gplate back ${h.bagIndex === -1 ? 'sel' : ''}" data-i="-1">
      <span class="bm-ico backi"><i></i></span><span class="bm-name">Back</span></button>`;
}
