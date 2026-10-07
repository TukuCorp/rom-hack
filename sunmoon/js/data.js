// data.js — Gen VII (Sun/Moon) battle data: type chart, moves, species, scene presets.
// Original transcription of public game mechanics; contains no ROM data.
// Owned by: Main. Builders read it, never write it.

export const TYPE_COLORS = {
  normal:   [0.659, 0.655, 0.478],
  fire:     [0.933, 0.506, 0.188],
  water:    [0.388, 0.565, 0.941],
  electric: [0.969, 0.816, 0.173],
  grass:    [0.478, 0.780, 0.298],
  ice:      [0.588, 0.851, 0.839],
  fighting: [0.761, 0.180, 0.157],
  poison:   [0.639, 0.243, 0.631],
  ground:   [0.886, 0.749, 0.396],
  flying:   [0.663, 0.561, 0.953],
  psychic:  [0.976, 0.333, 0.529],
  bug:      [0.651, 0.725, 0.102],
  rock:     [0.714, 0.631, 0.212],
  ghost:    [0.451, 0.341, 0.592],
  dragon:   [0.435, 0.208, 0.988],
  dark:     [0.439, 0.341, 0.275],
  steel:    [0.718, 0.718, 0.808],
  fairy:    [0.839, 0.522, 0.678],
};

// Attacking type -> { defending type: multiplier }. Anything absent is 1x.
const CHART = {
  normal:   { rock:.5, ghost:0, steel:.5 },
  fire:     { fire:.5, water:.5, grass:2, ice:2, bug:2, rock:.5, dragon:.5, steel:2 },
  water:    { fire:2, water:.5, grass:.5, ground:2, rock:2, dragon:.5 },
  electric: { water:2, electric:.5, grass:.5, ground:0, flying:2, dragon:.5 },
  grass:    { fire:.5, water:2, grass:.5, poison:.5, ground:2, flying:.5, bug:.5, rock:2, dragon:.5, steel:.5 },
  ice:      { fire:.5, water:.5, grass:2, ice:.5, ground:2, flying:2, dragon:2, steel:.5 },
  fighting: { normal:2, ice:2, poison:.5, flying:.5, psychic:.5, bug:.5, rock:2, ghost:0, dark:2, steel:2, fairy:.5 },
  poison:   { grass:2, poison:.5, ground:.5, rock:.5, ghost:.5, steel:0, fairy:2 },
  ground:   { fire:2, electric:2, grass:.5, poison:2, flying:0, bug:.5, rock:2, steel:2 },
  flying:   { electric:.5, grass:2, fighting:2, bug:2, rock:.5, steel:.5 },
  psychic:  { fighting:2, poison:2, psychic:.5, dark:0, steel:.5 },
  bug:      { fire:.5, grass:2, fighting:.5, poison:.5, flying:.5, psychic:2, ghost:.5, dark:2, steel:.5, fairy:.5 },
  rock:     { fire:2, ice:2, fighting:.5, ground:.5, flying:2, bug:2, steel:.5 },
  ghost:    { normal:0, psychic:2, ghost:2, dark:.5 },
  dragon:   { dragon:2, steel:.5, fairy:0 },
  dark:     { fighting:.5, psychic:2, ghost:2, dark:.5, fairy:.5 },
  steel:    { fire:.5, water:.5, electric:.5, ice:2, rock:2, steel:.5, fairy:2 },
  fairy:    { fire:.5, fighting:2, poison:.5, dragon:2, dark:2, steel:.5 },
};

/** Combined effectiveness of `atkType` against a defender's type list. */
export function typeEffect(atkType, defTypes) {
  let m = 1;
  for (const d of defTypes) m *= CHART[atkType]?.[d] ?? 1;
  return m;
}

export function effectText(m) {
  if (m === 0) return "It doesn't affect the target…";
  if (m >= 4) return "It's super effective!";
  if (m > 1) return "It's super effective!";
  if (m > 0 && m < 1) return "It's not very effective…";
  return null;
}

/* ------------------------------------------------------------------ moves */

// category: 'phys' | 'spec' | 'status'
export const MOVES = {
  ember:        { name: 'Ember',        type: 'fire',    cat: 'spec', power: 40, acc: 100, pp: 25, target: 'foe',
                  desc: 'A small flame is launched at the target.' },
  fireFang:     { name: 'Fire Fang',    type: 'fire',    cat: 'phys', power: 65, acc: 95,  pp: 15, target: 'foe',
                  desc: 'May cause a burn or make the target flinch.' },
  scratch:      { name: 'Scratch',      type: 'normal',  cat: 'phys', power: 40, acc: 100, pp: 35, target: 'foe',
                  desc: 'Hard, pointed claws rake the target.' },
  growl:        { name: 'Growl',        type: 'normal',  cat: 'status', power: 0, acc: 100, pp: 40, target: 'foe',
                  desc: "Lowers the target's Attack stat.", effect: { stat: 'atk', stages: -1, who: 'foe' } },
  barrage:      { name: 'Barrage',      type: 'normal',  cat: 'phys', power: 15, acc: 85,  pp: 20, target: 'foe',
                  desc: 'Round objects are hurled at the target.' },
  confusion:    { name: 'Confusion',    type: 'psychic', cat: 'spec', power: 50, acc: 100, pp: 25, target: 'foe',
                  desc: 'A weak telekinetic attack; may confuse.' },
  stomp:        { name: 'Stomp',        type: 'normal',  cat: 'phys', power: 65, acc: 100, pp: 20, target: 'foe',
                  desc: 'The target is stomped with a big foot.' },
  seedBomb:     { name: 'Seed Bomb',    type: 'grass',   cat: 'phys', power: 80, acc: 100, pp: 15, target: 'foe',
                  desc: 'A barrage of hard-shelled seeds.' },
  dragonHammer: { name: 'Dragon Hammer', type: 'dragon', cat: 'phys', power: 90, acc: 100, pp: 15, target: 'foe',
                  desc: 'The user uses its body like a hammer.' },
  // Popplio's early moveset (party backup)
  pound:        { name: 'Pound',        type: 'normal',  cat: 'phys', power: 40, acc: 100, pp: 35, target: 'foe',
                  desc: 'The target is pounded with a long tail, a foreleg, or the like.' },
  waterGun:     { name: 'Water Gun',    type: 'water',   cat: 'spec', power: 40, acc: 100, pp: 25, target: 'foe',
                  desc: 'The target is blasted with a forceful shot of water.' },
  disarmingVoice: { name: 'Disarming Voice', type: 'fairy', cat: 'spec', power: 40, acc: null, pp: 15, target: 'foe',
                  desc: 'A melodious cry that never misses.' },
  // Z-Moves (Gen VII). `z` marks the crystal; power is resolved from the base move.
  infernoOverdrive: { name: 'Inferno Overdrive', type: 'fire', cat: 'z', power: 0, acc: null, pp: 1, target: 'foe',
                  z: true, crystal: 'firiumZ', cinematic: 'inferno',
                  desc: 'The ultimate Fire-type Z-Move, powered by Firium Z.' },
};

/** Gen VII Z-Move power table, keyed off the base move's power. */
export function zPower(basePower) {
  if (basePower <= 55) return 100;
  if (basePower <= 65) return 120;
  if (basePower <= 75) return 140;
  if (basePower <= 85) return 160;
  if (basePower <= 95) return 180;
  if (basePower <= 100) return 190;
  if (basePower <= 110) return 195;
  return 200;
}

/* ---------------------------------------------------------------- species */

export const SPECIES = {
  litten: {
    name: 'Litten', dex: 725, types: ['fire'],
    base: { hp: 45, atk: 65, def: 40, spa: 60, spd: 40, spe: 70 },
    ability: 'Blaze', cry: 'litten',
    scale: 1, heightM: 0.4,
  },
  alolanExeggutor: {
    name: 'Exeggutor', form: 'Alolan Form', dex: 103, types: ['grass', 'dragon'],
    base: { hp: 95, atk: 105, def: 85, spa: 125, spd: 75, spe: 45 },
    ability: 'Frisk', cry: 'exeggutor',
    scale: 1, heightM: 10.9,
  },
  popplio: {
    name: 'Popplio', dex: 728, types: ['water'],
    base: { hp: 50, atk: 54, def: 54, spa: 66, spd: 56, spe: 40 },
    ability: 'Torrent', cry: 'popplio',
    scale: 1, heightM: 0.4,
  },
  // Reserved for the legendary scene (Sun & Moon); data only.
  solgaleo: {
    name: 'Solgaleo', dex: 791, types: ['psychic', 'steel'],
    base: { hp: 137, atk: 137, def: 107, spa: 113, spd: 89, spe: 97 }, ability: 'Full Metal Body',
  },
  lunala: {
    name: 'Lunala', dex: 792, types: ['psychic', 'ghost'],
    base: { hp: 137, atk: 113, def: 89, spa: 137, spd: 107, spe: 97 }, ability: 'Shadow Shield',
  },
};

/* ------------------------------------------------------------- stat maths */

// Demo trainer build: 15 IVs, 0 EVs, neutral nature (Gen VII formulas).
export function statValue(base, level, isHP, iv = 15, ev = 0) {
  if (isHP) return Math.floor((2*base + iv + Math.floor(ev/4)) * level / 100) + level + 10;
  return Math.floor(((2*base + iv + Math.floor(ev/4)) * level) / 100) + 5;
}

export function makeMon(speciesKey, level, moves, extra = {}) {
  const sp = SPECIES[speciesKey];
  const stats = {
    hp: statValue(sp.base.hp, level, true),
    atk: statValue(sp.base.atk, level, false),
    def: statValue(sp.base.def, level, false),
    spa: statValue(sp.base.spa, level, false),
    spd: statValue(sp.base.spd, level, false),
    spe: statValue(sp.base.spe, level, false),
  };
  return {
    species: speciesKey, name: sp.name, form: sp.form, level, types: sp.types, ability: sp.ability,
    stats, maxHP: stats.hp, hp: stats.hp,
    moves: moves.map(k => ({ key: k, ...MOVES[k], pp: MOVES[k].pp, maxPP: MOVES[k].pp })),
    stages: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    status: null, fainted: false, exp: 0,
    ...extra,
  };
}

export function stageMul(stage) { return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage); }

/** Gen VII damage. Returns { dmg, eff, crit, stab }. */
export function damage(attacker, defender, move, rng = Math.random) {
  const eff = typeEffect(move.type, defender.types);
  if (move.cat === 'status' || eff === 0) return { dmg: 0, eff, crit: false, stab: 1 };
  const phys = move.cat === 'phys' || (move.cat === 'z' && move.baseCat === 'phys');
  const crit = rng() < 1/24;
  const a = phys ? attacker.stats.atk * stageMul(attacker.stages.atk)
                 : attacker.stats.spa * stageMul(attacker.stages.spa);
  const d = phys ? defender.stats.def * stageMul(defender.stages.def)
                 : defender.stats.spd * stageMul(defender.stages.spd);
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const power = move.cat === 'z' ? zPower(move.basePower || 40) : move.power;
  const burn = attacker.status === 'burn' && phys ? 0.5 : 1;
  const base = Math.floor(Math.floor(Math.floor(2*attacker.level/5 + 2) * power * a / d) / 50) + 2;
  const mod = stab * eff * (crit ? 1.5 : 1) * burn * (0.85 + rng()*0.15);
  return { dmg: Math.max(1, Math.floor(base * mod)), eff, crit, stab };
}

/** EXP from a Gen VII fainted mon (trainer-less wild formula). */
export function expGain(foe, playerLevel) {
  const b = SPECIES[foe.species].base;
  const baseExp = Math.round((b.hp + b.atk + b.def + b.spa + b.spd + b.spe) * 0.6);
  return Math.max(1, Math.floor(baseExp * foe.level / 7 * (foe.wild ? 1 : 1.5)));
}

export function expToLevel(level) { return Math.floor(4 * Math.pow(level, 3) / 5); }

/* ------------------------------------------------------ scene presets */

// Alola, Exeggutor Island: bright tropical beach, ocean horizon, palms.
export const SCENES = {
  exeggutorIsland: {
    name: 'Exeggutor Island',
    time: 'day',
    sky: {
      zenith: [0.16, 0.45, 0.86], mid: [0.42, 0.70, 0.95], horizon: [0.80, 0.92, 0.97],
      sun: [1.0, 0.96, 0.80], sunDir: [-0.35, 0.62, 0.55],
      clouds: 9,
    },
    fog: { col: [0.80, 0.91, 0.97], near: 46, far: 190 },
    light: { dir: [-0.42, 0.74, 0.52], col: [0.72, 0.70, 0.62], sky: [0.46, 0.55, 0.62], gnd: [0.30, 0.27, 0.21], rim: 0.18 },
    clearColor: [0.62, 0.84, 0.95],
    ground: { sand: [0.94, 0.88, 0.68], wet: [0.80, 0.74, 0.56], grass: [0.42, 0.72, 0.30] },
  },
  altarOfSunne: {
    name: 'Altar of the Sunne',
    time: 'dusk',
    sky: {
      zenith: [0.10, 0.13, 0.36], mid: [0.42, 0.30, 0.52], horizon: [0.98, 0.62, 0.36],
      sun: [1.0, 0.82, 0.52], sunDir: [0.30, 0.34, 0.60],
      clouds: 5,
    },
    fog: { col: [0.72, 0.55, 0.55], near: 40, far: 170 },
    light: { dir: [0.35, 0.42, 0.55], col: [0.66, 0.50, 0.44], sky: [0.36, 0.36, 0.52], gnd: [0.24, 0.19, 0.18], rim: 0.26 },
    clearColor: [0.42, 0.32, 0.48],
    ground: { stone: [0.62, 0.58, 0.62], stoneDark: [0.44, 0.42, 0.48] },
  },
};
