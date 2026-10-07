// scene.js — shared battle state factory + Alola scene presets.
// Owned by: Main. Every module reads this object; nobody redefines it.

import { SCENES, MOVES, makeMon } from './data.js';

export const PLAYER_TEAM = [
  ['litten', 16, ['ember', 'fireFang', 'scratch', 'growl'], { held: 'firiumZ' }],
  ['popplio', 15, ['waterGun', 'disarmingVoice', 'pound', 'growl'], {}],
];

export const WILD = { species: 'alolanExeggutor', level: 12, moves: ['barrage', 'confusion', 'stomp', 'dragonHammer'] };

export function createState(sceneKey = 'exeggutorIsland') {
  const state = {
    sceneKey,
    t: 0, dt: 0, frame: 0,
    entities: [],
    events: [],              // per-frame cue bus: {kind, ...}; cleared by main each frame
    units: { player: null, foe: null },
    party: [],
    active: 0,
    bag: [{ key: 'potion', name: 'Potion', count: 2, heal: 20 }],
    zReady: true,            // Z-Ring available this battle (one Z-Move per battle)
    zArmed: false,           // move menu is in Z-Move mode
    phase: 'intro',          // intro | menu | turn | anim | victory | defeat | fled
    turn: 0,
    busy: true,
    text: '',
    hud: { command: 'fight', commandIndex: 0, moveIndex: 0, mode: 'wait', partyIndex: 0, bagIndex: 0 },
    cam: {
      pos: [0, 3.1, 7.2], look: [0, 1.5, 0], fov: 42, near: 0.1, far: 400,
      mode: 'idle', shake: 0, modeT: 0, opts: {},
    },
    groundY: 0,
    shadows: true,
    // Battle field layout (metres, Y up). Arena props are placed around `ring`.
    field: {
      playerSpot: [-2.6, 0, 2.2], foeSpot: [3.6, 0, -1.6],
      playerFace: 0.95, foeFace: 0.95 + Math.PI,   // yaw, radians
      ring: [0.4, 0, 0.3], ringR: 5.4,
    },
    clearColor: SCENES[sceneKey].clearColor,
    light: SCENES[sceneKey].light,
    fog: SCENES[sceneKey].fog,
    arena: null,
    /** emit a cue for effects/camera/hud this frame */
    emit(kind, data = {}) { state.events.push({ kind, ...data }); },
    /** add an entity to the render list */
    add(e) { state.entities.push(e); return e; },
    /** late-bound modules (set during boot) */
    mods: {},
  };
  for (const [key, level, moves, extra] of PLAYER_TEAM) {
    state.party.push(makeMon(key, level, moves.filter(m => MOVES[m]), extra));
  }
  return state;
}

export function applyScene(state, sceneKey) {
  const s = SCENES[sceneKey] || SCENES.exeggutorIsland;
  state.sceneKey = sceneKey;
  state.light = s.light;
  state.fog = s.fog;
  state.clearColor = s.clearColor;
  return s;
}

export function activeMon(state) { return state.party[state.active]; }
