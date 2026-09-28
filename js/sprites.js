// Original pixel art: string maps (char -> color) and procedural tiles.
export const PAL = {
  K: "#181820", W: "#f4f4f4", S: "#f8c890", H: "#402818", h: "#c06018",
  R: "#e03030", r: "#e07030", B: "#2850c8", N: "#283060", G: "#38a048",
  g: "#78c878", Y: "#f8d838", O: "#f08018", P: "#9848c8", C: "#48c8e0",
  E: "#b8b8c8", D: "#585868", L: "#704828", M: "#c8a068",
};

// Draw a string-map sprite onto ctx at (dx,dy), each char 1px, optional flip.
export function blit(ctx, art, dx, dy, flip = false) {
  for (let y = 0; y < art.length; y++) {
    const row = art[y];
    for (let x = 0; x < row.length; x++) {
      const ch = flip ? row[row.length - 1 - x] : row[x];
      if (ch === "." || ch === " ") continue;
      const c = PAL[ch];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(dx + x, dy + y, 1, 1);
    }
  }
}

// Hero 16x20: capped kid. R=cap/shirt (swapped per gender), H=hair, S=skin,
// N=backpack straps, M=pants. side frames face right (overworld flips for left).
const HERO_DOWN = [
  "....KKRRRRKK....",
  "...KRRRRRRRRK...",
  "..KRRRRRRRRRRK..",
  "..KWWWWWWWWWWK..",
  "...KSSSSSSMMK...",
  "...KSSKSSKSSK...",
  "...KSSSSSSMMK...",
  "....KSSKKSSK....",
  "....KSSSSMMK....",
  "...KRRNRRNRRK...",
  "..SKRRNRRNRRKS..",
  "..SKRRNRRNRRKS..",
  "..SKRRNRRNRRKS..",
  "...KRRNRRNRRK...",
  "...KMMKMMKMMK...",
  "...KMMKMMKMMK...",
  "...KMMK..KMMK...",
  "...KMMK..KMMK...",
  "...KKKK..KKKK...",
  "...KWWK..KWWK...",
];
const HERO_DOWN2 = [
  "....KKRRRRKK....",
  "...KRRRRRRRRK...",
  "..KRRRRRRRRRRK..",
  "..KWWWWWWWWWWK..",
  "...KSSSSSSMMK...",
  "...KSSKSSKSSK...",
  "...KSSSSSSMMK...",
  "....KSSKKSSK....",
  "....KSSSSMMK....",
  "...KRRNRRNRRK...",
  "..SKRRNRRNRRKS..",
  "..SKRRNRRNRRKS..",
  "..SKRRNRRNRRKS..",
  "...KRRNRRNRRK...",
  "...KMMKMMKMMK...",
  "...KMMKMMKMMK...",
  "....KMMKMMLK....",
  "....KMMK.MMK....",
  "...KKKK...KKK...",
  "...KWWK...KWK...",
];
const HERO_UP = [
  "....KKRRRRKK....",
  "...KRRRRRRRRK...",
  "..KRRRRRRRRRRK..",
  "...KHHHHHHHHK...",
  "...KHHHHHHHHK...",
  "....KHHHHHHK....",
  "....KSSSSMMK....",
  "...KNNNNNNNNK...",
  "..SKNNNNNNNNSK..",
  "..SKNNYNNYNNKS..",
  "..SKNNNNNNNNSK..",
  "..SKNNNNNNNNSK..",
  "...KNNNNNNNNK...",
  "...KNNNNNNNNK...",
  "...KMMKMMKMMK...",
  "...KMMKMMKMMK...",
  "...KMMK..KMMK...",
  "...KMMK..KMMK...",
  "...KKKK..KKKK...",
  "...KWWK..KWWK...",
];
const HERO_UP2 = [
  "....KKRRRRKK....",
  "...KRRRRRRRRK...",
  "..KRRRRRRRRRRK..",
  "...KHHHHHHHHK...",
  "...KHHHHHHHHK...",
  "....KHHHHHHK....",
  "....KSSSSMMK....",
  "...KNNNNNNNNK...",
  "..SKNNNNNNNNSK..",
  "..SKNNYNNYNNKS..",
  "..SKNNNNNNNNSK..",
  "..SKNNNNNNNNSK..",
  "...KNNNNNNNNK...",
  "...KNNNNNNNNK...",
  "...KMMKMMKMMK...",
  "...KMMKMMKMMK...",
  "....KMMKMMLK....",
  "....KMMK.MMK....",
  "...KKKK...KKK...",
  "...KWWK...KWK...",
];
const HERO_SIDE = [
  "....KKRRRRKK....",
  "...KRRRRRRRRK...",
  "..KRRRRRRRRRRK..",
  "...KSSSWWWWWWK..",
  "...KSSMKSSMK....",
  "...KSSSSSMK.....",
  "....KSSMK.......",
  "...KRRNRRRK.....",
  "..KNKRRNRRRK....",
  "..KNKRRNRRLSK...",
  "..KNKRRNRRLSK...",
  "..KNKRRNRRLSK...",
  "..KNKRRNRRLK....",
  "...KRRNRRLK.....",
  "...KMMKMMLK.....",
  "...KMMK.MMK.....",
  "...KMMK..MMK....",
  "..KMMK....KMMK..",
  "..KKKK.....KKK..",
  "..KWWK.....KWK..",
];
const HERO_SIDE2 = [
  "....KKRRRRKK....",
  "...KRRRRRRRRK...",
  "..KRRRRRRRRRRK..",
  "...KSSSWWWWWWK..",
  "...KSSMKSSMK....",
  "...KSSSSSMK.....",
  "....KSSMK.......",
  "...KRRNRRRK.....",
  "..KNKRRNRRRK....",
  "..KNKRRNRRLSK...",
  "..KNKRRNRRLSK...",
  "..KNKRRNRRLSK...",
  "..KNKRRNRRLK....",
  "...KRRNRRLK.....",
  "...KMMKMMLK.....",
  "....KMMK.MMK....",
  "...KMMK..MMK....",
  "...KMMK..KMMK...",
  "...KKKK...KKK...",
  "...KWWK...KWK...",
];

function heroSet(shirt, hair) {
  const swap = (art) => art.map((r) =>
    r.split("").map((c) => (c === "R" ? shirt : c === "H" ? hair : c)).join(""));
  return { down: [swap(HERO_DOWN), swap(HERO_DOWN2)], up: [swap(HERO_UP), swap(HERO_UP2)], side: [swap(HERO_SIDE), swap(HERO_SIDE2)] };
}

export const HERO = { boy: heroSet("R", "H"), girl: heroSet("r", "h") };

// Generic NPC: coat/body color param.
function npc(shirt, pants, hair, coat = null) {
  const torso = (c) => [
    `..HK${c}${c}${c}${c}${c}${c}${c}${c}KH..`,
    `..HK${c}${c}${c}${c}${c}${c}${c}${c}KH..`,
    `..HK${c}${c}${c}${c}${c}${c}${c}${c}KH..`,
    `..HK${c}${c}${c}${c}${c}${c}${c}${c}KH..`,
    `..HK${c}${c}${c}${c}${c}${c}${c}${c}KH..`,
    `..HK${c}${c}${c}${c}${c}${c}${c}${c}KH..`,
    `..HK${c}${c}${c}${c}${c}${c}${c}${c}KH..`,
  ];
  const art = [
    "....KKHHHKK.....",
    "...KHHHHHHHK....",
    "...KHSSSSSHK....",
    "...KHSKSSKSHK...",
    "...KHSSSSSHK....",
    "....KSSSSSSK....",
    ...(coat ? torso("C") : torso("S")),
    "...KPPKPPKPPK...",
    "...KPPKPPKPPK...",
    "...KPPK..KPPK...",
    "...KPPK..KPPK...",
    "...KKKK..KKKK...",
    "...KWWK..KWWK...",
  ];
  return art;
}

function npcColored(shirt, pants, hair, coat) {
  const base = npc(null, null, null, coat ? true : null);
  return base.map((r) => r.split("").map((c) => {
    if (c === "H") return hair;
    if (c === "C") return coat || c;
    return c;
  }).join("")).map((r, y) => {
    // torso rows (6..12) S->shirt, legs rows (13..16) P->pants
    if (y >= 6 && y <= 12) return r.split("").map((c) => (c === "S" ? shirt : c)).join("");
    if (y >= 13 && y <= 16) return r.split("").map((c) => (c === "P" ? pants : c)).join("");
    return r;
  });
}

// Mom: bun + bob haircut, flared dress with apron — triangular silhouette.
const MOM = [
  ".....KKKK.......",
  "....KhhhhK......",
  "....KKHHHKK.....",
  "...KhHHHHHhK....",
  "...KhSSSSShK....",
  "...KhSKSSKShK...",
  "...KhSSSSShK....",
  "....KSSSSSSK....",
  "...KrrrrrrrrK...",
  "..SKrrrWWrrrKS..",
  "..SKrrrWWrrrKS..",
  "..SKrrrWWrrrKS..",
  ".SKKrrrWWrrrKKS.",
  ".SKrrrrWWrrrrKS.",
  ".SKrrrrWWrrrrKS.",
  "..KrrrrWWrrrrK..",
  "..KrrrrWWrrrrK..",
  "..KSSSSSSSSSSK..",
  "..KKKK....KKKK..",
  "..KWWK....KWWK..",
];

// Elm: bald pate, gray side hair + beard, glasses, wide lab coat — blocky silhouette.
const ELM = [
  "....KKSSSSKK....",
  "...KSSSSSSSSK...",
  "...KEESSSSEEK...",
  "...KKKKKKKKKK...",
  "...KWKWWWWKWK...",
  "...KWKWWWWKWK...",
  "....KWWWWWWK....",
  "..KKWWWWWWWWKK..",
  "..SKWWWWWWWWKS..",
  "..SKWCWWWWCWKS..",
  "..SKWCWWWWCWKS..",
  "..SKWCWWWWCWKS..",
  "..SKWWWWWWWWKS..",
  "...KWWWWWWWWK...",
  "...KNNKNNKNNK...",
  "...KNNKNNKNNK...",
  "...KNNK..KNNK...",
  "...KNNK..KNNK...",
  "...KKKK..KKKK...",
  "...KWWK..KWWK...",
];

export const NPC = {
  mom:    MOM,
  elm:    ELM,
  aide:   npcColored("C", "N", "H", "C"),
  nurse:  npcColored("W", "P", "O", "W"),
  guide:  npcColored("G", "N", "H"),
  sam:    npcColored("P", "N", "Y"),
  harlan: npcColored("C", "W", "O"),
  rival:  npcColored("N", "R", "R"),
};

// ---- creature fronts (32x32): distinct silhouette per species ----
// Embercub: round fire cub, flame-tipped ears, cream muzzle-to-belly blaze, tail flame.
const F_EMBERCUB = [
  "................................",
  "................................",
  "........W..............W........",
  ".......YYY............YYY.......",
  ".......OOO......Y.....OOO.......",
  "......rrrOrOOOYYYYYYrOOrOO......",
  "......OrrrOrYYYYOYOYOOOrrr......",
  ".....OrrrOOOOYYYYOYOOOOOrrr.....",
  ".....rrrrOOOYYYYOYOYOOOOrrO.....",
  "....rOrrOOOOOYYYYOYOOOOOOrrO....",
  ".......rrrrrrYYYOYYrrrrOrr......",
  ".......OOOKKOYYYYYYYKKOOOO......",
  "......OrrKWWKYYYYYYKWWKOrrO.....",
  ".......OOKWKKYYYMYYKWKKOOO......",
  ".......rrKKWKMMWWWMKKWKOrr......",
  ".......OOOKKMMMWWWMMKKOOOO......",
  "........OOOMMMMWKWMMMMOOO.......",
  ".........OOOMMMWWWMMMOOO........",
  "..........OOYMKKKKMMYOO.........",
  "..........rOOMMMWMMYOOr.........",
  ".........rOOYMMWWMMYOOOr........",
  ".........OOOOMMWWMMYOOOOrrYYY...",
  "........OOOOYMMWWMMYYOOOOrYYW...",
  ".........OOOOMMWWMMYOOOOrrYY....",
  ".........rOOYMMWWMMYOOOr........",
  "........OOOOOMMWWMMOOOOO........",
  ".......OOOOOOOYYYYOOOOOOO.......",
  "........OKO........OKO..........",
  "........KKK........KKK..........",
  "........DDD........DDD..........",
  "................................",
  "................................",
];
// Aquapup: teardrop head, long floppy fin ears, close-set eyes, fanged mouth.
const F_AQUAPUP = [
  "................................",
  "................................",
  "................................",
  "................................",
  "................E...............",
  ".....C.......EEEEEEE......B.....",
  "....CBC....BCCEEBEECCB...BDB....",
  "...CBEBC..BCCEEEEBEECCB.BBEBB...",
  "...BBEBB..CCCCEEBEECCCC.CBBBC...",
  "...CBEBC.CCCBBBEEBBBCCCCBBEBB...",
  "...BBEBB.BBCCKEEEEKCCCBBBBEBC...",
  "..BBBEBBBBCCWKKEEWKKCCCBBBEBBC..",
  "...BBEBBCBBCWKKEEWKKCCBBBBEBC...",
  "...CBEBC.CCCKKKEEKKKCCCBBBEBB...",
  "...BBBBB.BBCKKKEEKKKCCBBBBBBC...",
  "...CBBBC.CCCCKEEEEKECCCCBBBBB...",
  "....CBC...CCCCEEEEECCCC..BDB....",
  ".....C....BCCKKKKKKECCB...B.....",
  "...........BCWKKKKWECB..........",
  "...........CCWWKKKKWWCC.........",
  "..........CCCKKKKKKECCC.........",
  "..........BCCKMMMMKECCB.........",
  ".........BBCCKMMMMKECCBB........",
  "..........BCCEEEEEEECCB.........",
  ".........CCCCCEEEEEECCC.........",
  "......CCCCCCCE....ECCCCCCC......",
  ".....CCCCECCCC....CCCCECCCC.....",
  "......CCCCCCC...E..CCCCCCC......",
  "........CCC..........CCC........",
  "........KKK..........KKK........",
  "........DDD..........DDD........",
  "................................",
];
// Leafhog: wide low hog, 3 leaf spikes, high wide eyes, protruding snout, curly tail.
const F_LEAFHOG = [
  "................................",
  "........D.......D.......D.......",
  ".......DgD.....DgD.....DgD......",
  ".......GgG.....GgG.....GgG......",
  "......GGgGG...GGgGG...GGgGG.....",
  ".....GGGgGGG.GGGgGGG.GGGgGGG....",
  ".....DGGgGGD.DGGgGGD.DGGgGGD....",
  "....DGDGDGDGDGDGDGDGDGDGDGDGD...",
  "......GGGGG...GGGGG...GGGGG.....",
  "........D.......D.......D.......",
  "........DGDGDGDgDGDGDGDGD.......",
  "........KKKKGgggggggKKKK........",
  ".......DGWWGggggggggGWWGGD......",
  "......DDGWKgGgggMgggGKWGGDD.....",
  ".....DDGGWKGgMMWWMMMgKWGGGDD....",
  ".....GGDGGGgMMMWWMMMMgGGGDGG....",
  ".....DDGGGGMMMKWWMKMMMGGGGDD....",
  "....DDGDGGGgMMMWWMMMMgGGGDGDD...",
  ".....DDGGGGGgMMWWMMMgGGGGGDD....",
  ".....GGDGGGgGKKKKKKKGgGGGDGG....",
  ".....DDGGGGGgggggggggGGGGGDDGD..",
  "......DDGGGgGggggGgGGGGGGDD.GG..",
  ".......DGGGGggggGgGgGGGGGD..GD..",
  ".........GDgGggggGgGGgDG........",
  "...........DGDGDgDGDGD..........",
  "................D...............",
  "........HWHH........HWHH........",
  "........KKKK........KKKK........",
  "........DDDD........DDDD........",
  "................................",
  "................................",
  "................................",
];
// Skyro: tiny round bird, stubby wings, crest tuft, small beak, stick legs.
const F_SKYRO = [
  "................................",
  "................................",
  "................N...............",
  "................N...............",
  "..............N.E.N.............",
  "..............N.N.N.............",
  ".............NNNNNNN............",
  "............NNNNWNNNN...........",
  "............NEWWWWWEN...........",
  "...........EEWWWWEWEEE..........",
  "......E...EEEEWWWWWEEEE..D......",
  ".....EDE..KKKWWWWWWKKKD.DDD.....",
  "....NDDDEKWWKKWWWWKWWKKDDDDN....",
  "....NDDDDKWWKKWWWWKWWKKDDDDN....",
  "....NDDDDKKKKKWWWWKKKKKDDDDN....",
  "...ENDDDDKKKWKWWWWKKKWKDDDDND...",
  "....NDDDDDKKKEWWWWWKKKDDDDDN....",
  "....NDDDDDEEEWWYYWWWEEEDDDDN....",
  "....EDDDEDDEEEWOOWWEEEDDDDDD....",
  ".....EDE..DEEKKKKKKWEED.DDD.....",
  "......E...EEEEWWWWWEEEE..D......",
  "...........EDWWWWEWWDE..........",
  ".............DWWWWWD............",
  "................W...............",
  ".............O....O.............",
  ".............O....O.............",
  "...........YYKYYYYKYY...........",
  "...........KKK....KKK...........",
  "...........DDD....DDD...........",
  "................................",
  "................................",
  "................................",
];
// Nibble: tall rat, huge upright ears, whisker rows, buck teeth, ground-sweep tail.
const F_NIBBLE = [
  "................................",
  "........N..............N........",
  ".......NN..............NN.......",
  ".......NRN............NRN.......",
  "......NRrN............NrRN......",
  "......NRWrN..........NrWRN......",
  "......NRrrN..........NrrRN......",
  "......NRRRNNPPPPPPPPNNRRRN......",
  "......NRRRNNPPPPPPPPNNRRRN......",
  "......NPNNPPPEEEEEEPPPNNNP......",
  "........PNNKWKEEEEKWKNNP........",
  ".........PPWKKEEEEKKWPP.........",
  "........PNNWKKEEEEKKWNNP........",
  "........PNNKKKEEEEKKKNNP........",
  "........PNNKKKEEEEKKKNNP........",
  "....KEEEPPPKKKEEEEKKKPPPEEEK....",
  "........PNNPPPEEEEPPPNNP........",
  ".........NPPPPKWWKPPPPN.........",
  "...........NPMMWWWMMPN..........",
  "..........NPPMMWWWMMPPN.........",
  "..........NPPMMWWWMMPPN.........",
  "..........NPPMMWWWMMPPN.........",
  "..........NPPMMWWWMMPPN.........",
  "...........NPMMWWWMMPN..........",
  "...........NPMMWWWMMPN..........",
  "...........NPMMWWWMMPNPPPPPP....",
  "........PPPPPPMWWMPPPPPPNNN.....",
  "........KPPPPKEEEEKPPPPK........",
  "........KKKKK.........KKKKK.....",
  "........DD.DD......DD.DD........",
  "................................",
  "................................",
];
// Pinebug: low dome beetle, 3 leg pairs, antennae, stalk eyes + ocelli, shell spots.
const F_PINEBUG = [
  "................................",
  "................................",
  "................................",
  "..........E..........E..........",
  "..........KK........KK..........",
  ".........KWWK......KWWK.........",
  ".........KWKKN....BKWKK.........",
  "..........KK........KK..........",
  "..........NN........NN..........",
  "..........NN....C...NN..........",
  "...........NCCCWWCCCCN..........",
  ".........BNCBCEWECECBCNB........",
  ".......NGBBBCCKWKCKCCBBGBN......",
  "......NGGGBCBCCWWCCCBCGGGNN.....",
  ".....NGGgGGBCCCWWCBCCGGgGGNN....",
  ".....BBGGGBCBCCWWCCBBCGGGNBB....",
  ".....NNBGBBBCCCWWCBCBBBGBBNN....",
  "....NNBNBBBCBCCWWCCBBBBBBNBNN...",
  ".....NNBGBBBCCCWWCCCCBBGBBNN....",
  ".....BBGGGBCKMOYYOMKBCGGGNBB....",
  "..KNNNGGgGGBCCCWWCCCCGGgGGNNNK..",
  "......NGGGBCBCCWWCCBBCGGGNN.....",
  "..KNNN.NGBBBCCCWWCCCCBBGBNNNNK..",
  ".........BNCBCCWWCCBBCNB........",
  "..KNNN.....NCCCWWCCCCN....NNNK..",
  "..KKK...........C..........KKK..",
  "..DDD......................DDD..",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
];
// Gusthawk: broad full-span wings, crest, browed eyes, hooked beak, talons.
const F_GUSTHAWK = [
  "................................",
  "................................",
  "..............C.E.C.............",
  "..............B.B.B.............",
  ".............BBBBBBB............",
  "............BEEEEBEBB...........",
  "............EEEEBEBEE...........",
  "...........EEEEEEBEBEE..........",
  "..........BBBBB..BBBBB..........",
  "...........KKKKEEKKKKE..........",
  "..........EKWKKEEKWKKEE.........",
  "BCBCBCBCBCCKKKKEEKKKKECCBCBCBCBC",
  "CBBBBBBCECCEEEEYYEEEEEECECBBBBBB",
  "BBBBBBCBCCCEEEEYYOEEEECCCBCBBBBC",
  "CBBBBBBCECCCEKKKKKKEECECECBBBBBB",
  "BBBBBBCBCCCECEEEEEEECECBCBCBBBBC",
  "CBBBBBBCECCCEEEEBEBEECECECBBBBBB",
  "BCBCBCBCBCBECEEEEBEECEBCBCBCBCBC",
  "...........BEEEEBEBEBB..........",
  "..........BECEEEEBEECEB.........",
  "...........BEEEEBEBEBB..........",
  "...........ECEEEEBEECE..........",
  "...........BEEEEBEBEBB..........",
  "............BEEEEBEBB...........",
  "............CCCCCCCCC...........",
  "...........YYYYCCYYYY...........",
  "...........KYYK.CKYYK...........",
  "...........DDDD..DDDD...........",
  "................................",
  "................................",
  "................................",
  "................................",
];
// Voltpup: bolt ears, red cheeks, cream muzzle/belly, bolt tail.
const F_VOLTPUP = [
  "................................",
  "................................",
  "......WY................YW......",
  "......YYY..............YYY......",
  ".......YO.......Y......OY.......",
  "......YYY...OYOYYYOY...YYY......",
  "......OY....YYYYOYOY....YO......",
  ".......YY...YYYYYOYY...YY.......",
  "......YY....YYYYOYOY....YY......",
  "........OOOOOrYYYYrOOOYOO.......",
  "........OYYKKYYYYYYKKYYYO.......",
  "........OOKWWKYYYYKWWKYOO.......",
  ".......OOYKWKKYYYYKWKKYYOO......",
  "........OOKKKKYYYYKKKKYOO.......",
  "........YYYKKYYYYYYKKYYY........",
  "........RWRYYYYYYYYYYRWR........",
  "........RRRYYYYYYYYYYRRR........",
  "........RRRYYKKYKKYYYRRR........",
  "...........YYMMWWMMYY...........",
  "...........YYMMWWMMYYY..........",
  "..........YYYMMWWMMYOYY.........",
  "..........OYYMMWWMMYYOO.YY......",
  ".........OYYYMMWWMMYOYOOOYY.....",
  "..........OYYMMWWMMYYOO..OYY....",
  "..........YYYMMWWMMYOYY...O.....",
  "........YYYYYMMWWMMYYYYY........",
  "........YYO..........OYY........",
  "........YYY..........YYY........",
  "........KKK..........KKK........",
  "........DDD..........DDD........",
  "................................",
  "................................",
];

// backs: hand-drawn rear views preserving silhouette; accent colors kept per species
export const MON_FRONT = {
  embercub: F_EMBERCUB, aquapup: F_AQUAPUP, leafhog: F_LEAFHOG,
  skyro: F_SKYRO, nibble: F_NIBBLE, pinebug: F_PINEBUG,
  gusthawk: F_GUSTHAWK, voltpup: F_VOLTPUP,
};
// ---- creature backs (32x32): hand-drawn rear views ----
// True 3/4 rear poses: back-of-head mass, asymmetric ears, dorsal stripe/spots/fin,
// curled tails, cylinder shading with dither, colored dithered outlines, grounded feet.
// No eyes, pupils, mouths, muzzles or whiskers.
const B_EMBERCUB = [
  "................................",
  "................................",
  "..........W.....................",
  ".........YOY..........Y.........",
  "........OOOOO........YOY........",
  "........ROOOR........rOR........",
  ".......ROOOOOR......ROOOR.......",
  "........ROOOOORORRRrOrOOR.......",
  "........OOOOOrOrRrrOrOOOO.......",
  ".........OOOOOrOrrrrOrOR........",
  ".........ROOOrOrRrrOrOOR........",
  ".........ROOOOrOrrrrOrOO........",
  ".........ROOOrOrRrrOrOOR........",
  "........ROOOOOrOrrrrOrOOR.......",
  ".........ROOOrOrRrrOrOOR........",
  ".........ROOOOrOrrrrOrOO........",
  ".........ROOOrOrRrrOrOOR........",
  "..........ROOOrOrrrrOrR.........",
  "..........OOOrOrRrrOrOO...W.....",
  "..........ROOOrOrrrrOrR..YY.....",
  ".........ROOOrOrRrrOrOOR.Y......",
  "..........ROOOrOrrrrOrORRO......",
  "..........OOOrOOYOrOrOO.R.......",
  "..........ROOOrYOYrrOrR.........",
  "...........ROrOrYrrOrR..........",
  ".............ORRrrRR............",
  "................R...............",
  "..........KKK......KKK..........",
  "..........DDD......DDD..........",
  "................................",
  "................................",
  "................................",
];
const B_AQUAPUP = [
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "..............CNNNB.............",
  ".........C..CCBCBBBBN...........",
  "........CCCCCBCBEBBBBNNNN.......",
  "........CCCCCCBCCBBBBNBNN.......",
  ".......CCCCCCBCBEBBBBBNBNN......",
  ".......CCCCCCCBCCBBBBNBNBN......",
  ".......CCCCCCBCBEBBBBBNBNN......",
  ".......CCCCCCCBCCBBBBNBNBN......",
  ".......CCCCCCBCBEBBBBBNBNN......",
  "........CCCCCCBCCBBBBNBNBN......",
  "........CCCCCBCBEBBBBBNBNN......",
  ".........C.CCCBCCBBBBNBNN.......",
  "...........CCBCBEBBBBBNNN.......",
  "...........CCCBCCBBBBN..........",
  "..........CCCBCBEBBBBBN.........",
  "...........CCCBCBBBBBN..........",
  "..........CCCBCBBBBBBN..........",
  ".........C.CCCBCBBBBBN..........",
  "........E...CNCBBBBNB...........",
  ".......EC.....NCNBN.............",
  "................................",
  "...........KKK.....KKK..........",
  "...........DDD.....DDD..........",
  "................................",
  "................................",
  "................................",
];
const B_LEAFHOG = [
  "................................",
  "................................",
  "................................",
  "................D...............",
  ".........D......g...............",
  ".........g......G......D........",
  "........gGg....GgG....gGg.......",
  "........GgG....gGg....GgG.......",
  ".......GgGgG..gGGGg..GgGgG......",
  ".......gGgGgGgGgGGGGGgGgGg......",
  "..........gggGgGDGGGGGG.........",
  ".........gggGgGgGGGGGGGG........",
  ".........ggggGgGDGGGGGGG........",
  "........ggggGgGgGGGGGGGGG.......",
  ".........ggggGgGDGGGGGGG........",
  "........ggggGgGgGGGGGGGGG.......",
  ".......ggggggGgGDGGGGGGGGG......",
  ".......gggggGgGgGGGGGGGGGG......",
  "......gggggggGgGDGGGGGGGGGG.....",
  ".......gggggGgGgGGGGGGGGGG......",
  ".......ggggggGgGDGGGGGGGGG......",
  "........ggggGgGgGGGGGGGGG.GD....",
  ".........ggggGgGDGGGGGGG...GD...",
  "..........ggGgGgGGGGGGG...DG....",
  ".............GgGGGGG............",
  "................................",
  "................................",
  "..........HKK.......HKK.........",
  "..........DDD.......DDD.........",
  "................................",
  "................................",
  "................................",
];
const B_SKYRO = [
  "................................",
  "................................",
  "................................",
  "...............NN...............",
  "..............E.NN..............",
  "...............NE...............",
  "..............ENNNN.............",
  ".............ENENNNN............",
  "............EEENENNNN...........",
  "............EENENNNNN...........",
  "...........EEEENENNNNN..........",
  "...........EEENENNNNNN..........",
  "...........EEEENENNNNN..........",
  "..........EEEENENNNNNNN.........",
  "..........WEEEENENNNNNW.........",
  "..........EEEENENNNNNNN.........",
  "..........WEEEENENNNNNW.........",
  "..........EEEENENNNNNNN.........",
  "...........EEEENENNNNN..........",
  "...........EEENENNNNNN..........",
  "............EEENENNNN...........",
  ".............ENENNNN............",
  "..............ENNNN.............",
  "..............NEEEN.............",
  "...............NEN..............",
  ".............O.....O............",
  ".............O.....O............",
  "............YYY...YYY...........",
  "............KKK...KKK...........",
  "............DDD...DDD...........",
  "................................",
  "................................",
];
const B_NIBBLE = [
  "................................",
  ".........E......................",
  "........EPE.....................",
  ".......EPEPP..........PNP.......",
  ".......PEPEP..........NPN.......",
  ".......EPEPP.........NPNPN......",
  ".......PEPEP....P....PNPNP......",
  ".......EPEPP.PPPPPPP.NPNPN......",
  "........EPE.PPPPNPPPN.NPN.......",
  ".........E.PPPPPPPPPPNPNP.......",
  "...........PPPPPNPPPNP..........",
  "..........PPPPEPPPPPPNP.........",
  "...........PPPPENPPPNP..........",
  "...........PPPEPPPPPPN..........",
  "...........PPPPENPPPNP..........",
  "...........PPPEPPPPPPN..........",
  "..........EPPPPPNPPPNPN.........",
  "..........PPPPEPPPPPPNP.........",
  "..........EPPPPPNPPPNPN.........",
  "..........PPPPEPPPPPPNP.........",
  "..........EPPPPPNPPPNPN.........",
  "...........PPPEPPPPPPN..........",
  "...........PPPPENPPPNP..........",
  "............PPEPPPPPP...........",
  ".............PPPPPPPPPPP........",
  "................PPPPPPPPPNN.....",
  "................................",
  "...........KKK.....KKK..........",
  "...........DDD.....DDD..........",
  "................................",
  "................................",
  "................................",
];
const B_PINEBUG = [
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "...............CEB..............",
  ".............KBBCBBK............",
  "..........K.KBBCEBBBN.K.........",
  ".........B.KBBBBCBBBBN.B........",
  "...........KBBBCEBBBNB..........",
  ".........KBBBBBBCBBBBNBN........",
  "........KBBBBBBCEBBBNBNNN.......",
  ".......KBBBgBBBBCBBBBGBNNN......",
  ".......KBBBBBBBCEBBBNBNNNN......",
  "......BBBBBBBBBBCBBBBNBNNNN.....",
  ".......BBBgBBGBCEBBgNBNNNN......",
  ".......NNBBBBBBBCBBBBNBNN.......",
  "........KBBBBBBCEBBBNBNNN.......",
  ".......NNKBBGBBBCBBBgNBNN.......",
  "...........BKKKCEKKBNK..........",
  ".......NN.......B......NN.......",
  "....DDD..................DDD....",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
  "................................",
];
const B_GUSTHAWK = [
  "................................",
  "................................",
  "...............CE...............",
  "..............E.CC..............",
  "...............EC...............",
  "................E...............",
  "..............EEEEE.............",
  ".............EEEEEEE............",
  "............EEEEBEEBE...........",
  "..........E.EEEEEEEEB...........",
  ".........CEEEEEEBEEBE.BB........",
  ".........BEEEEEEEEEEBEBC........",
  "........ECEEEEEEBEEBEBBB........",
  "........EBEEEEEEEEEEBEBCB.......",
  "........ECEEEEEEBEEBEBBBB.......",
  "........EBEEEEEEEEEEBEBCB.......",
  "........ECEEEEEEBEEBEBBBB.......",
  "........EBEEEEEEEEEEBEBCB.......",
  "........ECEEEEEEBEEBEBBBB.......",
  ".........BEEEEEEEEEEBEBCB.......",
  ".........CEEEEEEBEEBEBBB........",
  "..........E.EEEEEEEEBEBB........",
  ".............EEEEEEB..B.........",
  "..............BYYYB.............",
  "...............BYB..............",
  ".............Y.....Y............",
  ".............Y.....Y............",
  "............YYY...YYY...........",
  "............KKK...KKK...........",
  "............DDD...DDD...........",
  "................................",
  "................................",
];
const B_VOLTPUP = [
  "................................",
  "................................",
  "................................",
  "..........Y.....................",
  "........WYOYY.........Y.........",
  "........YWYYY........YOO........",
  "........WYYYY.......YOOOO.......",
  "........YWYYYYYYYYYYOYOOO.......",
  "........WYYYYYYYYOYOYOOOO.......",
  "..........YYYYYYOYYYOYOO........",
  ".........YYYYYYOYYYOYOOO........",
  ".........WYYYYYYYOYYOYOO........",
  ".........YYYYYYYOYYOYOOO........",
  "........YWYYYYYOYYYYOYOOO.......",
  ".........YYYYYYYYOYOYOOO........",
  ".........WYYYYYYOYYYOYOO........",
  ".........YYYYYYOYYYOYOOO........",
  "..........YYYYYYYOYYOYO.........",
  "..........YYYYYYOYYOYOO.........",
  "..........YYYYYOYYYYOYO.........",
  ".........YYYYYYYYOYOYOOO........",
  "..........RYYYYYOYYYOYRY........",
  "..........YRYYYOYYYOYRO.OY......",
  "..........YYYYYYYYYYOYO...Y.....",
  "...........YYYYYYYYOYO.....OY...",
  ".............YYYYYYY............",
  "................Y...............",
  "..........KKK......KKK..........",
  "..........DDD......DDD..........",
  "................................",
  "................................",
  "................................",
];

export const MON_BACK = {
  embercub: B_EMBERCUB, aquapup: B_AQUAPUP, leafhog: B_LEAFHOG,
  skyro: B_SKYRO, nibble: B_NIBBLE, pinebug: B_PINEBUG,
  gusthawk: B_GUSTHAWK, voltpup: B_VOLTPUP,
};

// ---- procedural tiles (16x16): textured 2-3 tone original pixel art ----
export function drawTile(ctx, t, x, y, frame = 0) {
  const R = (cx, cy, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x + cx, y + cy, w, h); };
  const P = (cx, cy, c) => { ctx.fillStyle = c; ctx.fillRect(x + cx, y + cy, 1, 1); };
  switch (t) {
    case ",": { // meadow grass: base + dark tufts + light blades
      R(0, 0, 16, 16, "#5da862");
      for (let i = 0; i < 8; i++) {
        const sx = (i * 5 + 1) % 14, sy = (i * 7 + 2) % 14;
        P(sx, sy, "#4f9a55"); P(sx + 1, sy + 1, "#4f9a55");
      }
      P(2, 3, "#6cba70"); P(9, 2, "#6cba70"); P(13, 8, "#6cba70");
      P(5, 11, "#6cba70"); P(11, 13, "#6cba70"); P(3, 14, "#6cba70");
      P(7, 6, "#3f8a46"); P(12, 11, "#3f8a46"); P(0, 9, "#3f8a46");
      break;
    }
    case ".": { // dirt path: warm sand + pebbles + edge shade
      R(0, 0, 16, 16, "#d8b878");
      R(0, 0, 16, 1, "#e8c890"); R(0, 15, 16, 1, "#c8a868");
      for (let i = 0; i < 7; i++) {
        const sx = (i * 5 + 3) % 14, sy = (i * 9 + 4) % 13 + 1;
        P(sx, sy, "#c8a868");
      }
      P(5, 6, "#b8b8c8"); P(11, 4, "#e8c890"); P(9, 11, "#b8b8c8"); P(3, 10, "#e8c890");
      break;
    }
    case "~": { // packed earth: bands + speckle
      R(0, 0, 16, 16, "#c8a060");
      R(0, 0, 16, 1, "#d8b070"); R(0, 7, 16, 2, "#b89058"); R(0, 15, 16, 1, "#a88050");
      for (let i = 0; i < 7; i++) {
        const sx = (i * 7 + 2) % 14, sy = (i * 5 + 3) % 14;
        P(sx, sy, "#b89058");
      }
      P(4, 2, "#e0c080"); P(12, 5, "#e0c080"); P(7, 11, "#e0c080");
      break;
    }
    case "G": { // tall grass: animated 3-tone blades
      R(0, 0, 16, 16, "#4c9448");
      const o = frame % 2;
      R(1 + o, 4, 3, 9, "#3d7d3a"); R(6 - o, 2, 3, 11, "#3d7d3a"); R(11 + o, 4, 3, 9, "#3d7d3a");
      R(2 + o, 2, 1, 4, "#6cba70"); R(7 - o, 1, 1, 4, "#6cba70"); R(12 + o, 3, 1, 4, "#6cba70");
      R(5 - o, 8, 2, 5, "#35702f"); R(10 + o, 9, 2, 4, "#35702f");
      P(0, 14, "#35702f"); P(15, 13, "#35702f"); P(8, 14, "#6cba70");
      break;
    }
    case "F": { // flower patch: grass + stemmed blooms
      R(0, 0, 16, 16, "#5da862");
      P(1, 2, "#4f9a55"); P(14, 5, "#4f9a55"); P(6, 14, "#4f9a55"); P(12, 13, "#6cba70");
      R(4, 6, 1, 3, "#38a048"); R(3, 3, 3, 3, "#f4f4f4"); P(4, 4, "#f8d838");
      R(4, 3, 1, 1, "#ffffff"); R(11, 11, 1, 3, "#38a048");
      R(10, 8, 3, 3, "#e86a8a"); P(11, 9, "#f8d838"); R(10, 8, 1, 1, "#f49aac");
      break;
    }
    case "T": { // tree: ground shadow, trunk, 3-tone canopy
      R(0, 0, 16, 16, "#5da862");
      P(1, 1, "#4f9a55"); P(14, 2, "#4f9a55");
      R(3, 13, 10, 2, "#4f9a55"); R(4, 14, 8, 1, "#478e4d");
      R(7, 9, 2, 6, "#704828"); R(7, 9, 1, 5, "#8a5a28");
      R(4, 4, 8, 7, "#2e7d32"); R(2, 6, 12, 3, "#2e7d32");
      R(5, 2, 6, 3, "#388e3c"); R(3, 5, 4, 2, "#388e3c");
      R(4, 3, 2, 2, "#4caf50"); R(9, 6, 2, 1, "#4caf50"); R(6, 8, 3, 1, "#388e3c");
      R(2, 8, 12, 1, "#1e5a20"); R(4, 11, 8, 1, "#1e5a20");
      P(12, 4, "#388e3c"); P(3, 9, "#388e3c");
      break;
    }
    case "W": { // water: depth speckle + animated crest
      R(0, 0, 16, 16, "#3d7dc8");
      for (let i = 0; i < 6; i++) {
        const sx = (i * 6 + 1) % 14, sy = (i * 11 + 5) % 15;
        P(sx, sy, "#2e6ab0");
      }
      const o = frame % 2 ? 2 : 0;
      R(2 + o, 4, 5, 1, "#7db8e8"); R(9 - o, 10, 5, 1, "#7db8e8");
      R(4, 13, 4, 1, "#7db8e8"); R(2 + o, 3, 2, 1, "#c8e8f8"); R(9 - o, 9, 2, 1, "#c8e8f8");
      break;
    }
    case "#": // out of bounds: near-black with faint grain
      R(0, 0, 16, 16, "#101018");
      P(3, 4, "#1c1c28"); P(11, 2, "#1c1c28"); P(7, 10, "#1c1c28"); P(13, 13, "#1c1c28"); P(1, 12, "#1c1c28");
      break;
    case "H": { // striped wallpaper: shadow crown + skirting
      R(0, 0, 16, 16, "#f2e2c0");
      for (let sx = 1; sx < 16; sx += 4) R(sx, 2, 2, 11, "#e9cf9e");
      P(3, 5, "#e9cf9e"); P(11, 9, "#e9cf9e"); P(7, 11, "#e9cf9e");
      R(0, 0, 16, 2, "#c8a878"); R(0, 0, 16, 1, "#a88050");
      R(0, 13, 16, 3, "#8a5a28"); R(0, 13, 16, 1, "#c8a068");
      break;
    }
    case "R": { // tiled roof: courses + staggered joints
      R(0, 0, 16, 16, "#c03828");
      R(0, 0, 16, 1, "#e05848");
      R(0, 3, 16, 1, "#982818"); R(0, 7, 16, 1, "#982818");
      R(0, 11, 16, 1, "#982818"); R(0, 15, 16, 1, "#982818");
      R(4, 1, 1, 2, "#a82818"); R(11, 1, 1, 2, "#a82818");
      R(1, 4, 1, 3, "#a82818"); R(8, 4, 1, 3, "#a82818"); R(14, 4, 1, 3, "#a82818");
      R(5, 8, 1, 3, "#a82818"); R(12, 8, 1, 3, "#a82818");
      R(2, 12, 1, 3, "#a82818"); R(9, 12, 1, 3, "#a82818");
      P(6, 2, "#e05848"); P(13, 6, "#e05848"); P(3, 10, "#e05848");
      break;
    }
    case "D": { // paneled wooden door + knob + threshold
      R(0, 0, 16, 16, "#8a5a28");
      R(2, 0, 12, 14, "#6e4520");
      R(2, 0, 12, 1, "#a87848");
      R(4, 2, 3, 4, "#542f14"); R(9, 2, 3, 4, "#542f14");
      R(4, 8, 3, 4, "#542f14"); R(9, 8, 3, 4, "#542f14");
      R(4, 2, 3, 1, "#8a5a28"); R(9, 2, 3, 1, "#8a5a28");
      R(4, 8, 3, 1, "#8a5a28"); R(9, 8, 3, 1, "#8a5a28");
      R(11, 7, 2, 2, "#f8d838"); P(11, 7, "#fff8d0");
      R(2, 12, 12, 1, "#542f14");
      R(0, 14, 16, 2, "#d8b878"); R(0, 14, 16, 1, "#e8c890");
      break;
    }
    case "C": { // TV stand / lab console: wood + glowing screen
      R(0, 0, 16, 16, "#5e3a18");
      R(1, 1, 14, 14, "#8a5a28");
      R(1, 1, 14, 3, "#c8a068"); R(1, 1, 14, 1, "#e8c088");
      R(3, 5, 10, 6, "#202028");
      R(3, 5, 10, 1, "#585868"); R(3, 5, 1, 6, "#585868");
      R(4, 6, 2, 3, "#585868"); P(4, 6, "#8a8aa8");
      if (frame % 2) { P(10, 7, "#48c8e0"); P(8, 8, "#48c8e0"); } else { P(9, 7, "#48c8e0"); P(11, 8, "#48c8e0"); }
      R(1, 12, 14, 1, "#5e3a18");
      R(2, 13, 4, 2, "#704828"); R(10, 13, 4, 2, "#704828");
      P(13, 13, "#e03030");
      break;
    }
    case "L": { // wooden study desk: grain top, panels, paper
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
    case "O": { // monster-ball table: shelf + three balls
      R(0, 0, 16, 16, "#5e3a18");
      R(1, 8, 14, 7, "#888898"); R(1, 8, 14, 1, "#b8b8c8");
      R(1, 14, 14, 1, "#585868");
      R(1, 10, 14, 1, "#6e6e7e");
      R(2, 4, 3, 4, "#e03030"); R(2, 6, 3, 2, "#f4f4f4"); P(2, 4, "#f46a6a"); P(3, 5, "#181820");
      R(6, 4, 3, 4, "#e8a018"); R(6, 6, 3, 2, "#f4f4f4"); P(6, 4, "#f8d838"); P(7, 5, "#181820");
      R(10, 4, 3, 4, "#38a048"); R(10, 6, 3, 2, "#f4f4f4"); P(10, 4, "#6cd878"); P(11, 5, "#181820");
      R(1, 1, 14, 2, "#c8a068");
      break;
    }
    case "B": { // bookshelf: frame + 3 stocked shelves
      R(0, 0, 16, 16, "#4a2c12");
      R(1, 1, 14, 14, "#704828");
      const vols = ["#a84848", "#4858a8", "#48a858", "#c8a038", "#9848c8", "#c86818", "#48a8a8"];
      for (let s = 0; s < 3; s++) {
        const by = 2 + s * 5;
        for (let i = 0; i < 7; i++) {
          const bx = 2 + i * 2, c = vols[(i + s * 3) % vols.length];
          R(bx, by, 1, 2, c); P(bx, by, "#f8e8c8");
        }
        R(1, by + 3, 14, 1, "#c8a068");
      }
      R(0, 0, 16, 1, "#6e4520"); R(0, 0, 1, 16, "#6e4520");
      break;
    }
    case "S": { // wooden signpost
      R(0, 0, 16, 16, "#5da862");
      P(1, 3, "#4f9a55"); P(14, 11, "#4f9a55"); P(5, 14, "#6cba70");
      R(4, 12, 8, 1, "#4f9a55");
      R(7, 7, 2, 9, "#8a5a28"); R(7, 7, 1, 9, "#a87848");
      R(3, 1, 10, 7, "#5e3a18"); R(4, 2, 8, 5, "#c8a068");
      R(5, 3, 6, 1, "#5e3a18"); R(5, 5, 4, 1, "#5e3a18");
      break;
    }
    case "P": { // potted plant on wood floor
      R(0, 0, 16, 16, "#cfa15e");
      R(0, 7, 16, 1, "#a87848"); R(0, 15, 16, 1, "#a87848");
      R(5, 0, 1, 7, "#a87848"); R(11, 8, 1, 7, "#a87848");
      P(2, 3, "#bd8a4e"); P(13, 11, "#e0aa68"); P(8, 12, "#bd8a4e");
      R(3, 12, 10, 2, "#b89058");
      R(5, 5, 6, 4, "#207038");
      R(3, 6, 2, 3, "#207038"); R(11, 6, 2, 3, "#207038");
      R(6, 3, 4, 6, "#38a048"); R(4, 6, 2, 2, "#38a048"); R(10, 6, 2, 2, "#38a048");
      R(6, 2, 3, 2, "#4caf50");
      P(6, 3, "#6cd878"); P(8, 5, "#6cd878"); P(5, 6, "#6cd878"); P(11, 6, "#6cd878");
      P(7, 7, "#207038"); P(9, 4, "#207038");
      R(4, 9, 8, 2, "#8a3a20"); R(4, 9, 8, 1, "#d87848");
      R(5, 11, 6, 4, "#a8542c"); R(5, 11, 1, 4, "#d87848"); R(10, 11, 1, 4, "#703318");
      break;
    }
    case "=": { // ranch fence: posts + lapped rails
      R(0, 0, 16, 16, "#5da862");
      P(6, 1, "#4f9a55"); P(12, 14, "#4f9a55"); P(1, 13, "#6cba70");
      R(0, 3, 16, 3, "#e8d8b8"); R(0, 3, 16, 1, "#fff4e0"); R(0, 5, 16, 1, "#b89878");
      R(0, 10, 16, 3, "#e8d8b8"); R(0, 10, 16, 1, "#fff4e0"); R(0, 12, 16, 1, "#b89878");
      R(2, 0, 3, 16, "#c8b898"); R(2, 0, 1, 16, "#e8d8b8"); R(4, 0, 1, 16, "#a89878");
      R(11, 0, 3, 16, "#c8b898"); R(11, 0, 1, 16, "#e8d8b8"); R(13, 0, 1, 16, "#a89878");
      break;
    }
    case "_": { // warm oak plank floor: staggered joints + grain
      R(0, 0, 16, 16, "#cfa15e");
      R(0, 4, 16, 4, "#c89c58"); R(0, 12, 16, 4, "#c89c58");
      R(0, 0, 16, 1, "#e0b070");
      R(0, 3, 16, 1, "#a87848"); R(0, 7, 16, 1, "#a87848");
      R(0, 11, 16, 1, "#a87848"); R(0, 15, 16, 1, "#a87848");
      R(5, 0, 1, 3, "#a87848"); R(11, 0, 1, 3, "#a87848");
      R(2, 4, 1, 3, "#a87848"); R(9, 4, 1, 3, "#a87848"); R(14, 4, 1, 3, "#a87848");
      R(6, 8, 1, 3, "#a87848"); R(12, 8, 1, 3, "#a87848");
      R(3, 12, 1, 3, "#a87848"); R(10, 12, 1, 3, "#a87848");
      P(1, 1, "#bd8a4e"); P(3, 2, "#bd8a4e"); P(8, 1, "#e0aa68"); P(13, 2, "#bd8a4e");
      P(0, 5, "#bd8a4e"); P(7, 5, "#e0aa68"); P(12, 6, "#bd8a4e"); P(4, 6, "#bd8a4e");
      P(2, 9, "#bd8a4e"); P(10, 9, "#e0aa68"); P(14, 10, "#bd8a4e");
      P(5, 13, "#bd8a4e"); P(11, 14, "#e0aa68"); P(15, 13, "#bd8a4e"); P(8, 13, "#bd8a4e");
      break;
    }
    case ":": { // lab checker tile: grout + sheen
      R(0, 0, 16, 16, "#b8b8d0");
      R(0, 0, 8, 8, "#d0d0e8"); R(8, 8, 8, 8, "#d0d0e8");
      R(0, 0, 16, 1, "#e4e4f4"); R(7, 0, 1, 16, "#9898b8"); R(0, 7, 16, 1, "#9898b8");
      R(15, 0, 1, 16, "#9898b8"); R(0, 15, 16, 1, "#9898b8");
      P(3, 3, "#e4e4f4"); P(11, 11, "#e4e4f4");
      break;
    }
    case "+": { // woven rug / gym mat: bordered medallion
      R(0, 0, 16, 16, "#f2e8d0");
      R(0, 0, 16, 2, "#c03828"); R(0, 14, 16, 2, "#c03828");
      R(0, 0, 2, 16, "#c03828"); R(14, 0, 2, 16, "#c03828");
      R(2, 2, 12, 1, "#e08080"); R(2, 13, 12, 1, "#e08080");
      R(2, 2, 1, 12, "#e08080"); R(13, 2, 1, 12, "#e08080");
      R(7, 3, 2, 10, "#c03828"); R(3, 7, 10, 2, "#c03828");
      R(7, 7, 2, 2, "#f8d838");
      P(4, 4, "#c03828"); P(11, 4, "#c03828"); P(4, 11, "#c03828"); P(11, 11, "#c03828");
      break;
    }
    default:
      R(0, 0, 16, 16, "#ff00ff");
  }
}
