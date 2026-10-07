// battle.js — Sun/Moon demo battle: turn engine, damage, EXP, faints, Z-Move.
// Owned by: Main. Drives hud/camera/effects through their documented APIs.

import { damage, effectText, expGain, expToLevel, makeMon, statValue, SPECIES, typeEffect } from './data.js';
import { WILD } from './scene.js';
import * as hud from './hud.js';
import * as camera from './camera.js';
import * as effects from './effects.js';
import * as models from './models.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const alive = mon => mon && !mon.fainted && mon.hp > 0;
const other = side => (side === 'player' ? 'foe' : 'player');
const STAT_NAMES = { atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed', acc: 'accuracy', eva: 'evasiveness' };
const PLAYER_LEVELS = { litten: 16, popplio: 15 };

/* ------------------------------------------------------------------ setup */

function spawnUnits(state) {
  const F = state.field;
  const p = state.party[state.active];
  const foe = makeMon(WILD.species, WILD.level, WILD.moves, { wild: true });

  const playerEnt = state.add({
    model: models.makeLitten(),
    pos: [...F.playerSpot], rot: [0, F.playerFace, 0],
    shadow: { r: 0.85, alpha: 0.4 }, anim: { name: 'enter', t: 0 }, name: 'player',
  });
  const foeEnt = state.add({
    model: models.makeAlolanExeggutor(),
    pos: [...F.foeSpot], rot: [0, F.foeFace, 0],
    shadow: { r: 7.5, alpha: 0.34 }, anim: { name: 'enter', t: 0 }, name: 'foe',
  });

  state.units.player = { side: 'player', mon: p, entity: playerEnt, focusHeight: 0.55, shown: p.hp };
  state.units.foe = { side: 'foe', mon: foe, entity: foeEnt, focusHeight: 2.0, shown: foe.hp };
  for (const s of ['player', 'foe']) {
    const m = state.units[s].mon;
    m.__init = { hp: m.hp, stats: { ...m.stats }, moves: m.moves.map(mv => ({ ...mv })) };
  }
  state.playerName = 'Trainer';
}

/** Re-attach a model to a unit when the active monster changes. */
export function setUnitModel(state, side, model) {
  const u = state.units[side];
  if (u.entity) {
    const i = state.entities.indexOf(u.entity);
    if (i >= 0) state.entities.splice(i, 1);
  }
  const F = state.field;
  const spot = side === 'player' ? F.playerSpot : F.foeSpot;
  const face = side === 'player' ? F.playerFace : F.foeFace;
  const shadow = side === 'player' ? { r: 0.8, alpha: 0.4 } : { r: 4.2, alpha: 0.34 };
  u.entity = state.add({ model, pos: [...spot], rot: [0, face, 0], shadow, anim: { name: 'enter', t: 0 }, name: side });
}

function modelFor(speciesKey) {
  switch (speciesKey) {
    case 'litten': return models.makeLitten();
    case 'popplio': return models.makePopplio();
    case 'alolanExeggutor': return models.makeAlolanExeggutor();
    case 'solgaleo': return models.makeSolgaleo ? models.makeSolgaleo() : models.makeLitten();
    case 'lunala': return models.makeLunala ? models.makeLunala() : models.makeLitten();
    default: return models.makeLitten();
  }
}

/* -------------------------------------------------------------- utilities */

async function hit(state, side, move, opts = {}) {
  const attacker = state.units[other(side)].mon;
  const defender = state.units[side].mon;
  const r = opts.forced || damage(attacker, defender, move);
  defender.hp = Math.max(0, defender.hp - r.dmg);
  state.emit('damage', { side, amount: r.dmg, move, eff: r.eff });
  camera.shake(state, opts.z ? 1.15 : Math.min(0.85, 0.3 + r.dmg / defender.maxHP));
  effects.spawn(state, 'impact', {
    pos: state.units[side].entity.pos, type: move.type, power: r.dmg, z: !!opts.z,
    height: state.units[side].focusHeight,
  });
  if (state.units[side].entity) { state.units[side].entity.anim = { name: 'hit', t: 0 }; }
  await wait(opts.z ? 420 : 260);
  if (r.crit) await hud.say(state, 'A critical hit!');
  const txt = effectText(r.eff);
  if (txt) await hud.say(state, txt);
  return r;
}

async function faint(state, side) {
  const u = state.units[side];
  u.mon.fainted = true;
  camera.set(state, 'faint', { side });
  if (u.entity) u.entity.anim = { name: 'faint', t: 0 };
  effects.spawn(state, 'faintDust', { pos: u.entity.pos, r: side === 'foe' ? 3.4 : 0.9 });
  await hud.say(state, `${u.mon.name} fainted!`);
}

async function gainExp(state, foeMon) {
  const u = state.units.player;
  const p = u.mon;
  const amount = expGain(foeMon, p.level);
  const before = p.level;
  p.exp += amount;
  await hud.say(state, `${p.name} gained ${amount} EXP. Points!`);
  while (p.exp >= expToLevel(p.level + 1)) {
    p.level++;
    const sp = SPECIES[p.species];
    for (const k of ['hp','atk','def','spa','spd','spe']) {
      const old = p.stats[k];
      const nv = statValue(sp.base[k], p.level, k === 'hp');
      p.stats[k] = nv;
      if (k === 'hp') { p.hp += nv - old; p.maxHP = nv; }
    }
    state.emit('levelup', { side: 'player', level: p.level, from: before });
    await hud.say(state, `${p.name} grew to Lv. ${p.level}!`);
  }
  state.emit('exp', { side: 'player' });
}

/* ---------------------------------------------------------------- actions */

async function useMove(state, side, move, opts = {}) {
  const u = state.units[side];
  const tgtSide = other(side);
  const tgt = state.units[tgtSide];
  const user = u.mon;
  const spend = user.moves.find(mv => mv.key === move.key || mv.key === move.baseKey);
  if (spend && spend.pp > 0) spend.pp--;

  // accuracy
  const acc = move.acc == null ? 100 : move.acc;
  if (opts.z !== true && move.cat !== 'z' && Math.random() * 100 >= acc) {
    await hud.say(state, `${user.name} used ${move.name}!`);
    camera.set(state, side === 'player' ? 'allyAttack' : 'foeAttack');
    effects.spawn(state, 'miss', { pos: tgt.entity.pos, height: tgt.focusHeight });
    await hud.say(state, `${user.name}'s attack missed!`);
    return;
  }

  if (move.cat === 'z' || opts.z) {
    // --- Gen VII Z-Move sequence: pose cut-scene, power-up line, cinematic strike
    state.zReady = false;
    state.zArmed = false;
    effects.setCinematic(state, 'zPose', { side });
    camera.set(state, 'zPose');
    await hud.say(state, `${user.name} surrounded itself with its Z-Power!`);
    await effects.spawn(state, 'zPose', { side, entity: u.entity }).promise;
    await hud.say(state, `${user.name} unleashed its full force!`);
    effects.setCinematic(state, 'zStrike', { name: move.name });
    camera.set(state, 'zStrike');
    await effects.spawn(state, 'zStrike', {
      side, target: tgtSide, type: move.type, entity: u.entity, name: move.name,
    }).promise;
    const r = await hit(state, tgtSide, { ...move, cat: 'z', baseCat: move.baseCat || 'spec', basePower: move.basePower }, { z: true });
    effects.setCinematic(state, null);
    return r;
  }

  await hud.say(state, `${user.name} used ${move.name}!`);
  if (side === 'player') camera.set(state, 'allyAttack', {});
  else camera.set(state, 'foeAttack', {});

  if (move.cat === 'status') {
    const e = move.effect;
    if (e && e.who === 'foe') {
      const name = STAT_NAMES[e.stat] || e.stat;
      const stages = tgt.mon.stages;
      if (stages[e.stat] <= -6) {
        await hud.say(state, `${tgt.mon.name}'s ${name} won't go any lower!`);
      } else {
        stages[e.stat] = Math.max(-6, stages[e.stat] + e.stages);
        effects.spawn(state, 'statDrop', { pos: tgt.entity.pos, height: tgt.focusHeight, stat: e.stat, up: e.stages > 0 });
        await hud.say(state, `${tgt.mon.name}'s ${name} fell!`);
      }
    }
    return { dmg: 0, eff: 1, crit: false };
  }

  const isContact = move.cat === 'phys' || move.contact;
  if (isContact) {
    await effects.spawn(state, 'dash', { side, target: tgtSide, entity: u.entity, dur: 0.5 }).promise;
  } else {
    await effects.spawn(state, 'projectile', {
      from: side, to: tgtSide, type: move.type,
      arc: move.type === 'grass' ? 1 : 0,
    }).promise;
  }
  const r = await hit(state, tgtSide, move);
  if (isContact) await effects.spawn(state, 'return', { side, entity: u.entity, dur: 0.35 }).promise;
  return r;
}

async function chooseFoeMove(state) {
  const foe = state.units.foe.mon;
  const options = foe.moves.filter(m => m.pp > 0);
  if (!options.length) return foe.moves[0];
  const scored = options.map(m => {
    const eff = typeEffect(m.type, state.units.player.mon.types);
    const stab = foe.types.includes(m.type) ? 1.5 : 1;
    const power = m.power || 0;
    const phys = m.cat === 'phys';
    const A = phys ? foe.stats.atk : foe.stats.spa;
    const D = phys ? state.units.player.mon.stats.def : state.units.player.mon.stats.spd;
    return { m, score: power * eff * stab * (A / D) };
  });
  scored.sort((a, b) => b.score - a.score);
  return Math.random() < 0.72 ? scored[0].m : scored[Math.min(scored.length-1, 1 + Math.floor(Math.random()*2))].m;
}

/* ----------------------------------------------------------- menu actions */

/** Perform the send-out animation + state swap for `state.party[idx]`. */
export async function switchTo(state, idx) {
  const incoming = state.party[idx];
  const out = state.units.player;
  camera.set(state, 'idle');
  await hud.say(state, `${out.mon.name}, that's enough! Come back!`);
  effects.spawn(state, 'recall', { entity: out.entity });
  out.entity.anim = { name: 'recall', t: 0 };
  await wait(520);
  state.active = idx;
  out.mon = incoming;
  out.shown = incoming.hp;
  setUnitModel(state, 'player', modelFor(incoming.species));
  await hud.say(state, `Go! ${incoming.name}!`);
  effects.spawn(state, 'ball', { side: 'player', entity: state.units.player.entity });
  await wait(560);
}

async function partyAction(state) {
  const idx = await hud.askParty(state);
  if (idx < 0 || idx === state.active) return null;
  if (!alive(state.party[idx])) { await hud.say(state, `${state.party[idx].name} has no energy left to battle!`); return null; }
  await switchTo(state, idx);
  return { kind: 'switch' };
}

/** Apply a bag item directly (no prompt); shared by the menu path and auto-play. */
async function useItem(state, idx) {
  const item = state.bag[idx];
  if (!item || item.count <= 0) return null;
  const u = state.units.player;
  if (u.mon.hp >= u.mon.maxHP) { await hud.say(state, `${u.mon.name} is already at full health.`); return null; }
  item.count--;
  await hud.say(state, `You used a ${item.name}!`);
  effects.spawn(state, 'heal', { pos: u.entity.pos, height: u.focusHeight });
  const healed = Math.min(item.heal, u.mon.maxHP - u.mon.hp);
  u.mon.hp += healed;
  state.emit('heal', { side: 'player', amount: healed });
  await hud.say(state, `${u.mon.name} recovered ${healed} HP!`);
  return { kind: 'item' };
}

async function bagAction(state) {
  const idx = await hud.askBag(state);
  if (idx < 0) return null;
  return useItem(state, idx);
}

async function runAction(state) {
  await hud.say(state, 'Got away safely!');
  camera.set(state, 'flee');
  effects.spawn(state, 'fleeDust', { entity: state.units.player.entity });
  state.units.player.entity.anim = { name: 'flee', t: 0 };
  await wait(900);
  state.phase = 'fled';
  return { kind: 'run' };
}

/* ------------------------------------------------------------ turn order */

async function resolveTurn(state, playerAction) {
  state.turn++;
  camera.set(state, 'idle');
  if (playerAction.kind !== 'move') {
    // non-attacking player actions resolve first
    await runPlayerAction(state, playerAction);
    if (state.phase === 'fled') return;
    if (alive(state.units.foe.mon) && alive(state.units.player.mon)) {
      await useMove(state, 'foe', await chooseFoeMove(state));
      await checkFaints(state);
    }
    return;
  }

  const foeMove = await chooseFoeMove(state);
  const pSpe = state.units.player.mon.stats.spe;
  const fSpe = state.units.foe.mon.stats.spe;
  const playerFirst = pSpe === fSpe ? Math.random() < 0.5 : pSpe > fSpe;
  const order = playerFirst ? ['player', 'foe'] : ['foe', 'player'];

  for (const side of order) {
    if (!alive(state.units.player.mon) || !alive(state.units.foe.mon)) break;
    if (side === 'player') await useMove(state, 'player', playerAction.move, { z: playerAction.z });
    else await useMove(state, 'foe', foeMove);
    if (await checkFaints(state)) return;
  }
}

async function runPlayerAction(state, action) {
  if (action.kind === 'run') return runAction(state);
  if (action.kind === 'item') return bagAction(state);
  if (action.kind === 'switch') return partyAction(state);
}

/** Handle faints; returns true when the battle ended or the turn must stop. */
async function checkFaints(state) {
  const foe = state.units.foe.mon;
  const me = state.units.player.mon;
  if (foe.hp <= 0 && !foe.fainted) {
    await faint(state, 'foe');
    await gainExp(state, foe);
    camera.set(state, 'victory');
    await hud.say(state, `You defeated the wild ${foe.name}!`);
    state.phase = 'victory';
    return true;
  }
  if (me.hp <= 0 && !me.fainted) {
    await faint(state, 'player');
    const next = state.party.findIndex(m => alive(m));
    if (next >= 0) {
      await hud.say(state, 'Choose a Pokémon to send out.');
      const idx = state.auto ? next : await hud.askParty(state, { force: true, mustBeAlive: true });
      state.active = (idx >= 0 && alive(state.party[idx])) ? idx : next;
      state.units.player.mon = state.party[state.active];
      state.units.player.shown = state.units.player.mon.hp;
      setUnitModel(state, 'player', modelFor(state.units.player.mon.species));
      await hud.say(state, `Go! ${state.units.player.mon.name}!`);
      effects.spawn(state, 'ball', { side: 'player', entity: state.units.player.entity });
      await wait(560);
      camera.set(state, 'idle');
      return true;
    }
    await hud.say(state, 'You have no more Pokémon that can fight!');
    await hud.say(state, 'You blacked out!');
    state.phase = 'defeat';
    camera.set(state, 'defeat');
    return true;
  }
  return false;
}

/* --------------------------------------------------------------- the loop */

async function intro(state) {
  const foe = state.units.foe.mon;
  camera.set(state, 'intro');
  state.phase = 'intro';
  await wait(420);
  effects.spawn(state, 'encounter', { pos: state.units.foe.entity.pos });
  await hud.say(state, `A wild ${foe.name} appeared!`);
  camera.set(state, 'idle');
  await hud.say(state, `Go! ${state.units.player.mon.name}!`);
  effects.spawn(state, 'ball', { side: 'player', entity: state.units.player.entity });
  await wait(620);
  state.phase = 'menu';
}

function softReset(state) {
  for (const m of state.party) {
    const init = m.__init;
    m.hp = init.hp; m.maxHP = init.hp; m.stats = { ...init.stats };
    m.moves = init.moves.map(mv => ({ ...mv }));
    m.fainted = false; m.exp = 0; m.level = PLAYER_LEVELS[m.species] || m.level;
    m.stages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
  }
  state.zReady = true; state.zArmed = false; state.turn = 0; state.phase = 'intro';
  state.autoUsedZ = false; state.autoUsedPotion = false;
  state.bag = [{ key: 'potion', name: 'Potion', count: 2, heal: 20 }];
  state.active = 0;
  for (const k of ['player', 'foe']) {
    const u = state.units[k];
    const i = state.entities.indexOf(u.entity);
    if (i >= 0) state.entities.splice(i, 1);
  }
  state.entities = state.entities.filter(e => !e.transient);
  state.units.player = null; state.units.foe = null;
  spawnUnits(state);
}

/* ------------------------------------------------------------ auto play */

/**
 * Hands-off showcase plan for `?auto=1` / capture runs. Rotates through the ally's whole
 * move set, spends the Z-Ring on turn 3, drinks a Potion when hurt and switches to the
 * bench when the ally goes down — so a single unattended run exercises the full demo.
 */
function autoPlan(state) {
  const me = state.units.player.mon;
  const foe = state.units.foe.mon;
  const hurt = me.hp / me.maxHP < 0.45;
  if (hurt && state.bag[0].count > 0 && !state.autoUsedPotion) {
    state.autoUsedPotion = true;
    return { kind: 'item' };
  }
  const bench = state.party.findIndex(m => alive(m) && m !== me);
  if (!alive(me)) return { kind: 'switch', index: bench };
  if (state.zReady && state.turn >= 2 && !state.autoUsedZ) {
    const fire = me.moves.findIndex(mv => mv.type === 'fire');   // Firium Z needs a Fire move
    if (fire >= 0) { state.autoUsedZ = true; return { kind: 'fight', move: fire, z: true }; }
  }
  const script = [1, 0, 3, 2];                 // Fire Fang, Ember, Growl, Scratch
  const idx = script[state.turn % script.length];
  return { kind: 'fight', move: Math.min(idx, me.moves.length - 1), z: false };
}

async function autoAct(state) {
  const plan = autoPlan(state);
  state.phase = 'turn';
  if (plan.kind === 'item') {
    state.turn++;
    const acted = await useItem(state, 0);
    if (!acted) return true;
    if (alive(state.units.foe.mon) && alive(state.units.player.mon)) {
      await useMove(state, 'foe', await chooseFoeMove(state));
      await checkFaints(state);
    }
    return true;
  }
  if (plan.kind === 'switch') {
    state.turn++;
    const idx = plan.index >= 0 ? plan.index : 0;
    if (!alive(state.party[idx])) return true;
    await switchTo(state, idx);
    if (alive(state.units.foe.mon) && alive(state.units.player.mon)) {
      await useMove(state, 'foe', await chooseFoeMove(state));
      await checkFaints(state);
    }
    return true;
  }
  state.hud.moveIndex = plan.move;
  const choice = await (async () => {
    const p = hud.askMove(state);          // opens the menu (and clears any armed Z)
    if (plan.z) state.zArmed = true;       // arm after the open, before the auto-confirm fires
    return p;
  })();
  if (!choice) return true;
  await resolveTurn(state, { kind: 'move', move: choice.move, z: choice.z });
  return true;
}

async function oneBattle(state) {
  await intro(state);
  while (state.phase !== 'victory' && state.phase !== 'defeat' && state.phase !== 'fled') {
    if (!alive(state.units.player.mon)) {          // never act with a fainted ally
      if (await checkFaints(state)) continue;
      break;
    }
    if (state.auto) { await autoAct(state); continue; }
    const cmd = await hud.askCommand(state);
    state.phase = 'turn';
    if (cmd === 'fight') {
      const choice = await hud.askMove(state);
      if (!choice) { state.phase = 'menu'; continue; }
      const base = state.units.player.mon.moves.find(mv => mv.key === (choice.move.baseKey || choice.move.key));
      if (base && base.pp <= 0) {
        await hud.say(state, "There's no PP left for this move!");
        state.phase = 'menu';
        continue;
      }
      await resolveTurn(state, { kind: 'move', move: choice.move, z: choice.z });
      continue;
    }
    if (cmd === 'pokemon') {
      const acted = await partyAction(state);
      if (!acted) { state.phase = 'menu'; continue; }
      if (state.units.foe.mon && alive(state.units.foe.mon) && alive(state.units.player.mon)) {
        await useMove(state, 'foe', await chooseFoeMove(state));
        if (await checkFaints(state)) break;
      }
      continue;
    }
    if (cmd === 'bag') {
      const acted = await bagAction(state);
      if (!acted) { state.phase = 'menu'; continue; }
      if (alive(state.units.foe.mon) && alive(state.units.player.mon)) {
        await useMove(state, 'foe', await chooseFoeMove(state));
        if (await checkFaints(state)) break;
      }
      continue;
    }
    if (cmd === 'run') {
      await runAction(state);
      break;
    }
    state.phase = 'menu';
  }
  await hud.say(state, state.phase === 'fled'
    ? 'Press Z to battle again.'
    : state.phase === 'victory' ? 'Press Z to battle again.' : 'Press Z to try again.');
}

export async function runBattle(state) {
  spawnUnits(state);
  state.auto = new URLSearchParams(location.search).has('auto');
  const forced = new URLSearchParams(location.search).get('ui');
  if (forced) hud.forceMode(state, forced);
  while (true) {
    await oneBattle(state);
    softReset(state);
    state.phase = 'intro';
  }
}
