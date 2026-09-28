// All game content: original species, moves, maps, dialogue. No third-party assets.
// Damage/XP/catch mechanics follow the public Gen III-V formulas.

export const TYPES = ["Normal","Fire","Water","Grass","Flying","Bug","Dark"];

// Attacking type -> defending type -> multiplier (abbreviated chart; default 1).
export const CHART = {
  Normal: { Rock: 0.5, Ghost: 0 },
  Fire:   { Fire: 0.5, Water: 0.5, Grass: 2, Bug: 2 },
  Water:  { Fire: 2, Water: 0.5, Grass: 0.5 },
  Grass:  { Fire: 0.5, Water: 2, Grass: 0.5, Flying: 0.5, Bug: 0.5 },
  Flying: { Grass: 2, Bug: 2, Flying: 0.5 },
  Bug:    { Fire: 0.5, Grass: 2, Flying: 0.5 },
  Dark:   { Dark: 0.5 },
};

export function effectiveness(moveType, t1, t2) {
  const row = CHART[moveType] || {};
  let m = row[t1] === undefined ? 1 : row[t1];
  if (t2) m *= row[t2] === undefined ? 1 : row[t2];
  return m;
}

// move: id -> {name,type,pow,acc,pp,prio,effect}
// effect: {stat:'atk'|'def', stages:-1|+1} | {status:'par'} | {burn:0.1}
export const MOVES = {
  tackle:     { name: "Tackle",    type: "Normal", pow: 40, acc: 100, pp: 35 },
  growl:      { name: "Growl",     type: "Normal", pow: 0,  acc: 100, pp: 40, effect: { stat: "atk", stages: -1 } },
  tailwhip:   { name: "Tail Whip", type: "Normal", pow: 0,  acc: 100, pp: 30, effect: { stat: "def", stages: -1 } },
  harden:     { name: "Harden",    type: "Normal", pow: 0,  acc: 100, pp: 30, effect: { stat: "def", stages: 1, self: true } },
  cinder:     { name: "Cinder",    type: "Fire",   pow: 40, acc: 100, pp: 25, effect: { burn: 0.1 } },
  jet:        { name: "Jet",       type: "Water",  pow: 40, acc: 100, pp: 25 },
  vinelash:   { name: "Vine Lash", type: "Grass",  pow: 45, acc: 100, pp: 25 },
  quickattack:{ name: "Quick Jab", type: "Normal", pow: 40, acc: 100, pp: 30, prio: 1 },
  bite:       { name: "Bite",      type: "Dark",   pow: 60, acc: 100, pp: 25 },
  gust:       { name: "Gust",      type: "Flying", pow: 40, acc: 100, pp: 35 },
  peck:       { name: "Peck",      type: "Flying", pow: 35, acc: 100, pp: 35 },
  razorleaf:  { name: "Razor Leaf",type: "Grass",  pow: 55, acc: 95,  pp: 25 },
  thunderwave:{ name: "Zap",       type: "Normal", pow: 0,  acc: 90,  pp: 20, effect: { status: "par" } },
};

// species: {name, t1, t2, base:[hp,atk,def,spa,spd,spe], rate (catch), exp (base yield), learn:[[lv,move]]}
export const SPECIES = {
  embercub: { name: "Embercub", t1: "Fire",  base: [45,62,43,60,50,65], rate: 45,  exp: 64,
              learn: [[1,"tackle"],[1,"growl"],[7,"cinder"],[10,"quickattack"]] },
  aquapup:  { name: "Aquapup",  t1: "Water", base: [50,58,55,55,55,50], rate: 45,  exp: 64,
              learn: [[1,"tackle"],[1,"tailwhip"],[7,"jet"],[10,"bite"]] },
  leafhog:  { name: "Leafhog",  t1: "Grass", base: [55,60,60,58,58,45], rate: 45,  exp: 64,
              learn: [[1,"tackle"],[1,"growl"],[7,"vinelash"],[10,"razorleaf"]] },
  skyro:    { name: "Skyro",    t1: "Normal", t2: "Flying", base: [40,45,40,35,35,56], rate: 200, exp: 40,
              learn: [[1,"tackle"],[1,"growl"],[4,"gust"]] },
  nibble:   { name: "Nibble",   t1: "Normal", base: [45,56,35,25,35,72], rate: 255, exp: 40,
              learn: [[1,"tackle"],[1,"tailwhip"],[4,"quickattack"]] },
  pinebug:  { name: "Pinebug",  t1: "Bug",   base: [45,50,60,30,40,35], rate: 255, exp: 40,
              learn: [[1,"tackle"],[1,"harden"]] },
  gusthawk: { name: "Gusthawk", t1: "Flying", base: [65,70,55,60,55,85], rate: 90,  exp: 60,
              learn: [[1,"gust"],[1,"growl"],[6,"quickattack"],[9,"peck"]] },
  voltpup:  { name: "Voltpup",  t1: "Normal", base: [55,60,45,60,50,70], rate: 190, exp: 52,
              learn: [[1,"tackle"],[1,"growl"],[5,"quickattack"],[8,"thunderwave"]] },
};

export const STARTERS = ["embercub", "aquapup", "leafhog"];
// rival takes the type-advantaged starter
export const RIVAL_PICK = { embercub: "aquapup", aquapup: "leafhog", leafhog: "embercub" };

export const WILD_R29 = [
  { sp: "skyro",  min: 2, max: 4, w: 35 },
  { sp: "nibble", min: 2, max: 4, w: 35 },
  { sp: "pinebug",min: 2, max: 3, w: 20 },
  { sp: "voltpup",min: 3, max: 4, w: 10 },
];

export const RIVAL_TEAM = [{ sp: null, lv: 5 }]; // sp filled at event time
export const GYM_TRAINER = [{ sp: "skyro", lv: 7 }];
export const GYM_LEADER = [{ sp: "skyro", lv: 9 }, { sp: "gusthawk", lv: 11 }];

// ---- maps: strings, 16px tiles ----
const T = (rows) => rows;
// legend: # solid border, T tree, W water, . path, , ground, G tall grass,
// F flowers, H house wall, R roof, D door(mat, warp), C counter/TV stand, L desk,
// O ball table, B shelf, S sign, P plant/pot, = fence, _ wood floor, : lab floor,
// ~ path2, + gym mat/rug
export const MAPS = {
  newbark: {
    w: 24, h: 17,
    rows: T([
      "########################",
      "#TTTTTTTTTTTTTTTTTTTTTT#",
      "#TTRRRRRTTTTTTTRRRRRRTT#",
      "#TTHHHHHTTTTTTHHHHHHTTT#",
      "#TTHHHHHTTTTTTHHHHHHTTT#",
      "#TTHHDHHT,,,,,THHDHHTTT#",
      "#TTT,,TTTTTTTTTT,,TTTT,#",
      "#TT,,TTTTTTTTTTTT,,TT,,#",
      "#TT,TTTHHHHHTTTTT,TT,,,#",
      "#TT,,TTHHDHHT,,,,,TTTT,#",
      "#,,,TTTHHHHHT,,TTTTTT,,#",
      "#,,,,TTTHDDHT,,TTTTT,,,#",
      "#,,,,,,THDDHT,,,,,,,,,,#",
      "#GG,,,,,,,,,,,,,,,,,,,S#",
      "#GG,,,,,,,,,,,,,,,TTTT,#",
      "#TTTTTTTTTTTTTTTTTTTTTT#",
      "########################",
    ]),
    warps: { "9,12": "lab,4,6", "10,12": "lab,4,6", "5,5": "house,7,9", "22,10": "route29,1,5" },
    signs: { "22,12": "EMBERLEAF TOWN\nPalm coral lab ahead.\nStilt houses, sea air." },
  },
  house: {
    w: 16, h: 12,
    rows: T([
      "HHHHHHHHHHHHHHHH",
      "HBB____LL__CP_BH",
      "H______________H",
      "H_____++_______H",
      "H_____++_______H",
      "H____LL________H",
      "H_________P____H",
      "H______________H",
      "H______________H",
      "H______________H",
      "H______DD______H",
      "HHHHHHHHHHHHHHHH",
    ]),
    warps: { "7,10": "newbark,5,6", "8,10": "newbark,5,6" },
  },
  lab: {
    w: 16, h: 12,
    rows: T([
      "HHHHHHHHHHHHHHHH",
      "HBCCCCCCB__PP_BH",
      "H::::::::::::::H",
      "H:::LL:::::::::H",
      "H:::LL:::::::::H",
      "H:::OO:::::::::H",
      "H::::::::::::::H",
      "H::::::::::::::H",
      "H::::LL::::::::H",
      "H::::::::::::::H",
      "H______DD______H",
      "HHHHHHHHHHHHHHHH",
    ]),
    warps: { "7,10": "newbark,9,13", "8,10": "newbark,9,13" },
  },
  route29: {
    w: 40, h: 13,
    rows: T([
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
      "T,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,T",
      "T,,GGGG,,,,,,,GGGGGG,,,,,,,GGGGG,,,,,,,T",
      "T,,GGGG,,S,,,,GGGGGG,,,T,,GGGGG,,,,,,,,T",
      "T,,GGGG,,,,,,,GGGGGG,,,T,,,,,,,,,,,,,,,T",
      "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~T",
      ",,,,TTTT,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,T",
      "T,,,,TTTT,,,,,GGGG,,,,,,,,,,,,,,,,,,,,,D",
      "T,,GG,TTTT,,,,GGGG,,,S,,,,,,,,,,,,,,,,,T",
      "T,,GG,,,,,,,,,GGGG,,,,,,,,,,TTTT,,,,,,,T",
      "T,,,,,,,,,,,,,,,,,,,,,,,,,,,,TTT,,,,,,,,",
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
      "TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT",
    ]),
    warps: { "0,5": "newbark,22,10", "0,6": "newbark,22,10", "39,7": "violetgate,0,3" },
    signs: { "9,3": "ROUTE 101 - CORAL PATH\nTo the east:\nPETALPORT" },
  },
  violetgate: {
    w: 16, h: 12,
    rows: T([
      "################",
      "#HHHHHHHHHHHHHH#",
      "#H____________H#",
      "D______________D",
      "#H____________H#",
      "#HHH______HHHHH#",
      "#H____________H#",
      "#H_BB______BB_H#",
      "#H____________H#",
      "#H_____PP_____H#",
      "#HHHHHHHHHHHHHH#",
      "################",
    ]),
    warps: { "0,3": "route29,38,7", "15,3": "violet,0,8" },
  },
  violet: {
    w: 24, h: 17,
    rows: T([
      "########################",
      "#TTTTTTTTTTTTTTTTTTTTTT#",
      "#TTTRRRRRRTTTTRRRRRRRTT#",
      "#TTTHHHHHHTTTTHHHHHHTTT#",
      "#TTTHHHHHHTTTTHHHHHHTTT#",
      "#TTTHHDHHTT,,,THHDHHTTT#",
      "#TTTT,,TTTT,,,TTTT,,TTTT",
      "#,,,,,,,,,,,,,,,,,,,,,,#",
      "D,,,,,,,,,,,,,,,,,,,,,,#",
      "#,,,,,,,,,,,,,,,,,,,,,,#",
      "#TTTT,,TTTRRRRRRTTTT,,T#",
      "#TTTT,,TTTHHHHHHTTT,,T,#",
      "#,,,,,,,TTHHHHHHT,,,,,,#",
      "#,,,,,,,TTHHDHHTT,,S,,,#",
      "#,,,,,,,,,,,,,TTT,,,,,,#",
      "#TTTTTTTTTTTTTTTTTTTTTT#",
      "########################",
    ]),
    // center door (6,5), east house door (17,5), gym door (12,13)
    warps: { "6,5": "center,3,5", "17,5": "violethouse,3,5", "12,13": "gym,4,8", "0,8": "violetgate,6,3" },
    signs: { "19,13": "PETALPORT\nHome of the\nCoral Gym." },
  },
  center: {
    w: 16, h: 12,
    rows: T([
      "HHHHHHHHHHHHHHHH",
      "HBCCCCCB___P__BH",
      "H______________H",
      "H______________H",
      "H______P_______H",
      "H______________H",
      "H______________H",
      "H______________H",
      "H______________H",
      "H______________H",
      "H______DD______H",
      "HHHHHHHHHHHHHHHH",
    ]),
    warps: { "7,10": "violet,6,6", "8,10": "violet,6,6" },
  },
  violethouse: {
    w: 16, h: 12,
    rows: T([
      "HHHHHHHHHHHHHHHH",
      "HB___LL__CP___BH",
      "H______________H",
      "H_____++_______H",
      "H_____++_______H",
      "H______________H",
      "H______________H",
      "H____________P_H",
      "H______________H",
      "H______________H",
      "H______DD______H",
      "HHHHHHHHHHHHHHHH",
    ]),
    warps: { "7,10": "violet,18,6", "8,10": "violet,18,6" },
  },
  gym: {
    w: 16, h: 12,
    rows: T([
      "HHHHHHHHHHHHHHHH",
      "H______________H",
      "H_P__________P_H",
      "H______________H",
      "H____++++______H",
      "H____++++______H",
      "H______________H",
      "H___PP_________H",
      "H______________H",
      "H______________H",
      "H______DD______H",
      "HHHHHHHHHHHHHHHH",
    ]),
    warps: { "7,10": "violet,12,14", "8,10": "violet,12,14" },
  },
};

export const DIALOG = {
  mom_before: "MOM: {name}! PROF. PALM is\nlooking for you.\nPlease visit her LAB.",
  mom_after: "MOM: Take care out there.\nCome back and rest\nanytime, sweetie.",
  elm_call: "Someone is at the door...\n... ...\nIt's {rival}!\n{rival}: Hmph. Out of my way.\nI'm here for my POKéMON.",
  elm_intro: "PALM: Ah, {name}! There you\nare. I need a favor...\nTake one of these\nPOKéMON with you.",
  elm_after_pick: "PALM: Wonderful! {mon} will\nbe a fine partner.\nCome back if you need\nadvice.",
  elm_balls: "PALM: Oh! I almost forgot.\nTake these ORBIT BALLS\nand POTIONS.",
  rival_before: "{rival}: So PALM gave you a\nPOKéMON too?\nLet me see how strong\nit is. Battle me!",
  rival_after: "{rival}: ...! I lost?!\nMy POKéMON just wasn't\nstrong enough...\nI'll get stronger.\nJust you wait!",
  aide: "AIDE: PROF. PALM regrows\ncoral reefs. Her solar\nroof powers the lab.",
  center_nurse: "NURSE: Welcome! Let me\nheal your POKéMON.\n... ...\nAll better! Come again!",
  guide: "GUIDE: The PETALPORT GYM\nleader CORA uses\nFLYING types.\nELECTRIC or ROCK moves\nwork best. Too bad\nnobody here has those!",
  trainer_sam: "REY: CORA trained me!\nYou won't reach her!\n... ...\nREY: Wow, you're good.\nGo on through.",
  harlan_before: "CORA: I am CORA,\nthe PETALPORT GYM leader!\nMy birds ride the wind!\nShow me your best!",
  harlan_after: "CORA: ...Astonishing!\nTake this CORAL BADGE.\nYou earned it.",
  badge_get: "{name} received the\nCORAL BADGE!\n\n-- SLICE COMPLETE --\nThanks for playing!\nKeep exploring the Coral Coast.",
  locked: "It's locked.",
  pc: "Someone's PC. It is\nturned off.",
  machine: "A strange machine hums.",
  books: "Field notes: coral,\ntides, migration.",
  plant: "A potted palm.\nWatered daily.",
};
