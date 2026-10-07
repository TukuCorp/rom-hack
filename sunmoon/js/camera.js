// camera.js — battle camera rig (Gen VII framing: low, behind the player's ally, foe to the right).
// Owned by: camera builder. Reads state.events + state.cam.{mode,opts}; writes state.cam.{pos,look,fov,up}.
//
// Modes: idle | intro | allyAttack | foeAttack | zPose | zStrike | faint | victory | defeat | flee
// Knobs read from state.cam.opts: {focus:[x,y,z], side:'player'|'foe', snap:bool}
//
// Every shot is authored in the battler basis, so it survives layout tweaks:
//   axis  = ally -> foe direction (XZ, normalised). axis*- is behind the ally, axis*+ toward the foe.
//   right = axis turned -90 deg about Y = screen-right when the camera looks along axis.
// Gen VII read: ally sits low-left (right*+ offset pushes it left of frame), foe sits mid-right and
// recedes, the horizon rides high because the eye is low (about waist height) with a shallow pitch.
//
// Motion: a critically damped spring (dt-correct, no overshoot) drives eye/look/fov from the shot
// target; handheld drift, breathing, trauma shake and impact FOV punch are layered on top of the
// spring's own state so nothing feeds back and no frame-rate dependent jitter can appear.

const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = V.len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOut = k => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
const smooth = k => { const x = clamp(k, 0, 1); return x * x * (3 - 2 * x); };

/** Critically damped scalar spring step (Unity-style SmoothDamp); stable for any dt. */
function damp(cur, target, vel, smoothTime, dt) {
  const om = 2 / Math.max(0.0001, smoothTime);
  const x = om * dt;
  const ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (vel + om * change) * dt;
  return [target + (change + temp) * ex, (vel - om * temp) * ex];
}

/* ------------------------------------------------------------------ layout */

function spot(state, side) {
  const f = state.field || {};
  return side === 'player' ? (f.playerSpot || [-2.6, 0, 2.2]) : (f.foeSpot || [3.6, 0, -1.6]);
}

/** Battler root position (entity when live, field spot otherwise). */
function rootPos(state, side) {
  const u = state.units && state.units[side];
  if (u && u.entity && u.entity.pos) return u.entity.pos;
  return spot(state, side);
}

/** Aim point on a battler: `k` = fraction of its focus height (1 = the standard focus). */
function aimPoint(state, side, k = 1) {
  const p = rootPos(state, side);
  const u = state.units && state.units[side];
  const fh = (u && u.focusHeight) || (side === 'player' ? 0.5 : 3);
  return [p[0], p[1] + fh * k, p[2]];
}

/** Ally->foe basis plus facing directions. */
function basis(state) {
  const a = [-2.6, 0, 2.2], b = [3.6, 0, -1.6];
  const sa = state.field && state.field.playerSpot ? state.field.playerSpot : a;
  const sb = state.field && state.field.foeSpot ? state.field.foeSpot : b;
  let ax = [sb[0] - sa[0], 0, sb[2] - sa[2]];
  const l = Math.hypot(ax[0], ax[2]) || 1;
  ax = [ax[0] / l, 0, ax[2] / l];
  const right = [-ax[2], 0, ax[0]];
  const yaw = (state.field && state.field.playerFace) || 0.95;
  const facing = [Math.sin(yaw), 0, Math.cos(yaw)];
  return { axis: ax, right, facing, player: sa, foe: sb };
}

/** Compose an offset from `origin`: origin + axis*along + right*side + up*height. */
function off(b, origin, along, side, height) {
  return [
    origin[0] + b.axis[0] * along + b.right[0] * side,
    height,
    origin[2] + b.axis[2] * along + b.right[2] * side,
  ];
}

/* -------------------------------------------------------------- foe framing */

/**
 * The foe's crown: the top of its head cluster / frond fan, on the head's forward lean. Battlers
 * are modelled at true scale, so an Alolan Exeggutor carries its head the better part of ten
 * metres up; a rig that aims at the trunk alone frames a bare neck with the head off the top.
 * Every shot that has to show the foe reads this point and fits the frame to it.
 */
function crownPoint(state) {
  const u = state.units && state.units.foe;
  const e = u && u.entity;
  const p = (e && e.pos) || spot(state, 'foe');
  const h = ((e && e.model && e.model.height) || 9.3) * 0.985;   // a hair under the topmost frond tip
  const yaw = (e && e.rot && e.rot[1]) || 0;
  const lean = h * 0.14;                                        // the head knot sits forward of the trunk
  return [p[0] + Math.sin(yaw) * lean, p[1] + h, p[2] + Math.cos(yaw) * lean];
}

/**
 * On-screen elevation of `p` seen from `eye` aimed horizontally along `dir` (unit XZ), in the
 * perspective projection gl.js uses: the vertical offset is divided by the depth along the aim,
 * so a point off the aim axis reads steeper than its true elevation by 1/cos(horizontal offset).
 */
function aimAngle(eye, dir, p) {
  const dx = p[0] - eye[0], dz = p[2] - eye[2];
  const dh = Math.hypot(dx, dz) || 1e-3;
  const alt = Math.atan2(p[1] - eye[1], dh);
  return Math.atan2(Math.tan(alt), clamp((dx * dir[0] + dz * dir[2]) / dh, 0.25, 1));
}

/** Horizontal aim of an authored eye -> look pair, in radians off the ally -> foe axis. */
function aimYaw(b, eye, look) {
  const dx = look[0] - eye[0], dz = look[2] - eye[2];
  return Math.atan2(dx * b.right[0] + dz * b.right[2], dx * b.axis[0] + dz * b.axis[2]);
}

/** True elevation of an authored eye -> look pair (the pitch the shot was authored with). */
function aimPitch(eye, look) {
  return Math.atan2(look[1] - eye[1], Math.hypot(look[0] - eye[0], look[2] - eye[2]) || 1e-3);
}

/**
 * Fit a shot to the foe's crown. `base` is the authored stance — {a, side, h} metres behind and
 * right of the ally, `yaw` the authored aim in radians off the axis, `fov` / `pitch` the authored
 * lens. The stance backs off along the axis and lifts only as far as the crown demands, and the
 * lens opens no further than `fovMax`, so a short foe keeps the authored look and a tall one
 * trades ally size for a head that stays inside the top edge with air above it.
 *
 * The pitch is clamped into the window that keeps the crown at `top` down the frame and the
 * ally's ground contact inside `foot`: the shot keeps its authored pitch whenever both hold, and
 * is lifted only when the crown would leave the top. If even the widest lens and the longest
 * pull-back cannot hold both, the crown wins — the ally's feet clip rather than the head vanish.
 *
 * Returns { eye, look, fov, pitch }.
 */
function frameFoe(state, b, base) {
  const crown = crownPoint(state);
  const vBase = ((base.fov || 32) * Math.PI) / 360;
  const vMax = ((base.fovMax || 48) * Math.PI) / 360;
  const top = base.top != null ? base.top : 0.075;
  const foot = base.foot != null ? base.foot : 0.99;
  const k = base.yaw || 0;
  const dir = [
    b.axis[0] * Math.cos(k) + b.right[0] * Math.sin(k), 0,
    b.axis[2] * Math.cos(k) + b.right[2] * Math.sin(k),
  ];
  const floor = [b.player[0], state.groundY || 0, b.player[2]];

  // Back off along the axis only while the lens would otherwise breach `fovMax`: the eye's height
  // comes up a little at the same time, which is what keeps the pitch (and so the horizon) sane.
  let a = base.a, h = base.h, eye = off(b, b.player, -a, base.side, h);
  let v = vBase, eCrown = 0, eFeet = 0;
  for (let i = 0; i <= 9; i++) {
    a = base.a + i * 0.55;
    h = base.h + Math.min(0.95, i * 0.13);
    eye = off(b, b.player, -a, base.side, h);
    eCrown = aimAngle(eye, dir, crown);
    eFeet = aimAngle(eye, dir, floor);
    v = Math.max(vBase, (eCrown - eFeet) / 2 + 0.06);            // half the vertical span needed
    if (v <= vMax || i === 9) break;
  }
  v = Math.min(v, vMax);

  const tv = Math.tan(v);
  const lo = eCrown - Math.atan((1 - 2 * top) * tv);             // pitch that seats the crown
  const hi = eFeet - Math.atan((1 - 2 * foot) * tv);             // pitch that keeps the ally's feet
  const pitch = lo <= hi
    ? clamp(base.pitch != null ? base.pitch : (lo + hi) * 0.5, lo, hi)
    : lo;
  const L = 12, c = Math.cos(pitch), s = Math.sin(pitch);
  return {
    eye, fov: (v * 360) / Math.PI, pitch,
    look: [eye[0] + dir[0] * c * L, eye[1] + s * L, eye[2] + dir[2] * c * L],
  };
}

/* --------------------------------------------------------------- shot table */

/**
 * Shot for a mode -> { eye, look, fov, smooth, hand, roll, enter? }
 * `enter` = optional start pose blended to the shot over `dur` seconds (explicit push/pull),
 * so attack cinematics get their snap from the choreography, not from a stiffer spring.
 */
function shot(state, mode, opts, mt) {
  const b = basis(state);
  const followAlly = rootPos(state, 'player');
  const allyLow = aimPoint(state, 'player', 0.55);

  switch (mode) {
    /* ---------------------------------------------------- resting battle shot */
    case 'idle': {
      // Bar (Ember_VII / Freeze_VII): eye just above the ally's own height, ~1.9 m behind it, so
      // the ally fills the lower-left ABOVE the player plate and the foe sits mid-right. The
      // authored aim (-0.29 rad off the axis) pushes the foe right of centre; the lens and pitch
      // are then fitted to the foe's crown, so the head cluster + fronds ride inside the top edge
      // with air above them instead of the species reading as a bare neck.
      const fit = frameFoe(state, b, {
        a: 1.75, side: 1.30, h: 0.46, fov: 34, fovMax: 46, top: 0.115,
        yaw: -0.29, pitch: (-2.3 * Math.PI) / 180,
      });
      return {
        eye: fit.eye, look: fit.look, fov: fit.fov,
        smooth: 0.55, hand: 0.030, roll: 0,
      };
    }

    /* --------------------------------------- encounter push-in, settles to idle */
    case 'intro': {
      const idle = shot(state, 'idle', {}, 0);
      const k = smooth((mt - 0.35) / 2.4);
      return {
        eye: V.lerp(off(b, b.player, -4.6, 3.4, 3.3), idle.eye, k),
        look: V.lerp(aimPoint(state, 'foe', 0.45), idle.look, k),
        fov: 30 + (idle.fov - 30) * k,
        smooth: 0.9, hand: 0.024, roll: 0,
        enter: { eye: off(b, b.player, -8.2, 5.4, 5.6), look: aimPoint(state, 'foe', 0.5), fov: 26, dur: 0.5 },
      };
    }

    /* ------------------------------- over-the-shoulder push, tight and low ---- */
    case 'allyAttack': {
      const foeAim = aimPoint(state, 'foe', 0.23);
      const eye0 = off(b, b.player, -1.80, 1.60, 0.60);
      const look0 = [foeAim[0] - b.right[0] * 1.90, 1.05, foeAim[2] - b.right[2] * 1.90];
      // Same over-the-shoulder push, but the aim is only lifted off the foe's body as far as the
      // crown needs to stay inside the top edge.
      const fit = frameFoe(state, b, {
        a: 1.80, side: 1.60, h: 0.60, fov: 42, fovMax: 50, top: 0.075,
        yaw: aimYaw(b, eye0, look0), pitch: aimPitch(eye0, look0),
      });
      return {
        eye: fit.eye,
        look: fit.look,
        fov: fit.fov, smooth: 0.20, hand: 0.05, roll: -1.4,
        enter: {
          eye: off(b, b.player, -2.70, 2.00, 0.78),
          look: [allyLow[0] + (foeAim[0] - allyLow[0]) * 0.42, 0.9, allyLow[2] + (foeAim[2] - allyLow[2]) * 0.42],
          fov: 42, dur: 0.34,
        },
      };
    }

    /* --------------------------- pull back and low: foe looms, ally small ------ */
    case 'foeAttack': {
      const foeAim = aimPoint(state, 'foe', 0.5);
      const eye0 = off(b, b.player, -3.55, 2.75, 0.85);
      const look0 = [foeAim[0] - b.right[0] * 1.55, foeAim[1], foeAim[2] - b.right[2] * 1.55];
      const fit = frameFoe(state, b, {
        a: 3.55, side: 2.75, h: 0.85, fov: 48, fovMax: 52, top: 0.08,
        yaw: aimYaw(b, eye0, look0), pitch: aimPitch(eye0, look0),
      });
      return {
        eye: fit.eye,
        look: fit.look,
        fov: fit.fov, smooth: 0.30, hand: 0.055, roll: 1.2,
        enter: {
          eye: off(b, b.player, -2.05, 1.55, 0.60),
          look: aimPoint(state, 'foe', 0.55),
          fov: 44, dur: 0.42,
        },
      };
    }

    /* ----------------------------- Z-Power charge: low close-up, sky behind -- */
    case 'zPose': {
      return {
        eye: [followAlly[0] + b.facing[0] * 1.75, 0.24, followAlly[2] + b.facing[2] * 1.75],
        look: [followAlly[0] + b.facing[0] * 0.1, 0.62, followAlly[2] + b.facing[2] * 0.1],
        fov: 32, smooth: 0.34, hand: 0.035, roll: -2.5,
        enter: {
          eye: [followAlly[0] + b.facing[0] * 2.7, 0.45, followAlly[2] + b.facing[2] * 2.7],
          look: [followAlly[0], 0.45, followAlly[2]],
          fov: 38, dur: 0.55,
        },
      };
    }

    /* --------------------------- Z-Move: wide, then whip/punch into the blast - */
    case 'zStrike': {
      const k = easeOut((mt - 0.42) / 1.25);            // continuing punch-in
      const foeAim = aimPoint(state, 'foe', 0.85);
      const base = off(b, b.player, -2.85, 2.45, 1.12);
      return {
        eye: [base[0] + b.axis[0] * 0.75 * k, base[1] - 0.2 * k, base[2] + b.axis[2] * 0.75 * k],
        look: [
          foeAim[0] - b.right[0] * (1.75 - 0.5 * k),
          foeAim[1] - 2.4 * k,
          foeAim[2] - b.right[2] * (1.75 - 0.5 * k),
        ],
        fov: 54 - 7 * k,
        smooth: 0.19, hand: 0.075, roll: 2.4 * k,
        enter: {
          eye: off(b, b.player, -4.1, 4.45, 2.0),
          look: aimPoint(state, 'foe', 0.55),
          fov: 62, dur: 0.4,
        },
      };
    }

    /* --------------------------------------------- low, close on the fainting mon */
    case 'faint': {
      const side = opts.side || 'foe';
      const tgt = rootPos(state, side);
      if (side === 'player') {
        return {
          eye: [tgt[0] + b.facing[0] * 0.9 + b.right[0] * 1.15, 0.5,
                tgt[2] + b.facing[2] * 0.9 + b.right[2] * 1.15],
          look: [tgt[0], tgt[1] + 0.24, tgt[2]],
          fov: 36, smooth: 0.34, hand: 0.05, roll: -5,
          enter: { eye: off(b, b.player, -2.4, 2.4, 1.05), look: aimPoint(state, 'player', 0.6), fov: 42, dur: 0.5 },
        };
      }
      return {
        eye: off(b, tgt, -3.30, 3.40, 1.10),
        look: [tgt[0], tgt[1] + 1.60, tgt[2]],
        fov: 46, smooth: 0.34, hand: 0.05, roll: 4,
        enter: { eye: off(b, b.player, -2.9, 2.6, 1.05), look: aimPoint(state, 'foe', 0.6), fov: 46, dur: 0.5 },
      };
    }

    /* -------------------------------------------------- hero shot on the winner */
    case 'victory': {
      return {
        eye: off(b, followAlly, -1.32, 1.30, 0.72),
        look: [followAlly[0], followAlly[1] + 0.44, followAlly[2]],
        fov: 34, smooth: 0.85, hand: 0.030, roll: -1.6,
      };
    }

    /* ------------------------------------------------------ low angle on the foe */
    case 'defeat': {
      const foeAim = aimPoint(state, 'foe', 0.38);
      return {
        eye: off(b, b.foe, -3.2, 3.4, 0.5),
        look: [foeAim[0] - b.right[0] * 0.9, foeAim[1], foeAim[2] - b.right[2] * 0.9],
        fov: 52, smooth: 0.80, hand: 0.032, roll: 3.2,
      };
    }

    /* ------------------------------------------------- pull back as the ally goes */
    case 'flee': {
      return {
        eye: off(b, b.player, -5.4, 4.0, 1.75),
        look: [b.player[0] + b.axis[0] * 2.4, 0.75, b.player[2] + b.axis[2] * 2.4],
        fov: 50, smooth: 0.55, hand: 0.030, roll: 0,
      };
    }

    default:
      return shot(state, 'idle', {}, mt);
  }
}

/* ------------------------------------------------------------------ safety */

/** Keep an eye point off the ground and out of the battler volumes. */
function guard(state, eye) {
  const floor = (state.groundY || 0) + 0.34;
  if (eye[1] < floor) eye[1] = floor;
  if (eye[1] > 26) eye[1] = 26;
  for (const side of ['player', 'foe']) {
    const p = rootPos(state, side);
    let dx = eye[0] - p[0], dz = eye[2] - p[2];
    const min = side === 'player' ? 1.15 : 1.75;
    let d = Math.hypot(dx, dz);
    if (d < min) {
      if (d < 1e-3) { const r = basis(state).right; dx = r[0]; dz = r[2]; d = 1; }
      const k = min / d;
      eye[0] = p[0] + dx * k;
      eye[2] = p[2] + dz * k;
    }
  }
  // stay on the island: never drift out over the water chasing a wide shot
  const f = state.field || {};
  const c = f.ring || [0.4, 0, 0.3];
  const dx = eye[0] - c[0], dz = eye[2] - c[2];
  const far = 26, dd = Math.hypot(dx, dz);
  if (dd > far) { const k = far / dd; eye[0] = c[0] + dx * k; eye[2] = c[2] + dz * k; }
  return eye;
}

/* ------------------------------------------------------------------ update */

export function update(state, t) {
  const cam = state.cam;
  if (!cam) return;
  const dt = Math.min(0.05, state.dt || 0);
  if (cam.mode !== cam.lastMode) { cam.modeT = 0; cam.lastMode = cam.mode; }
  cam.modeT = (cam.modeT || 0) + dt;
  const rig = cam.rig || (cam.rig = {
    p: (cam.pos || [0, 3, 7]).slice(), l: (cam.look || [0, 1, 0]).slice(),
    vp: [0, 0, 0], vl: [0, 0, 0], fov: cam.fov || 40, vf: 0,
  });
  const opts = cam.opts || {};
  const s = shot(state, cam.mode, opts, cam.modeT);

  // shot target, with the optional enter choreography blended in
  let eye = s.eye, look = s.look, fov = s.fov;
  if (s.enter) {
    const k = easeOut(cam.modeT / (s.enter.dur || 0.4));
    eye = V.lerp(s.enter.eye, s.eye, k);
    look = V.lerp(s.enter.look, s.look, k);
    fov = s.enter.fov + (s.fov - s.enter.fov) * k;
  }
  if (opts.focus) look = opts.focus;
  guard(state, eye);

  if (opts.snap || cam.snap) {
    rig.p = eye.slice(); rig.l = look.slice(); rig.fov = fov;
    rig.vp = [0, 0, 0]; rig.vl = [0, 0, 0]; rig.vf = 0;
    cam.snap = false;
  } else {
    const st = s.smooth || 0.4;
    for (let i = 0; i < 3; i++) {
      const a = damp(rig.p[i], eye[i], rig.vp[i], st, dt); rig.p[i] = a[0]; rig.vp[i] = a[1];
      const c = damp(rig.l[i], look[i], rig.vl[i], st * 1.12, dt); rig.l[i] = c[0]; rig.vl[i] = c[1];
    }
    const f = damp(rig.fov, fov, rig.vf || 0, st, dt); rig.fov = f[0]; rig.vf = f[1];
  }

  // --- impact punch (FOV + a touch of dolly) driven by this frame's cues -----
  if (state.events && state.events.length) {
    for (let i = 0; i < state.events.length; i++) {
      const e = state.events[i];
      if (e.kind !== 'damage' || e.__camPunch) continue;
      e.__camPunch = 1;
      const u = state.units && state.units[e.side];
      const mx = (u && u.mon && u.mon.maxHP) || 40;
      cam.punch = Math.min(1.4, (cam.punch || 0) + clamp(0.4 + (e.amount || 0) / mx, 0, 1.1));
    }
  }
  const punch = cam.punch || 0;
  cam.punch = punch * Math.exp(-5.4 * dt);

  // --- layered life: handheld drift + breathing (both pure functions of t) ---
  const w = s.hand != null ? s.hand : 0.03;
  const hx = w * (Math.sin(t * 0.43 + 1.1) + 0.5 * Math.sin(t * 0.71 + 2.3));
  const hy = w * (Math.sin(t * 0.55 + 0.4) + 0.5 * Math.sin(t * 0.93 + 1.7));
  const hz = w * 0.6 * Math.sin(t * 0.37 + 2.9);
  const bx = w * 0.5 * Math.sin(t * 0.21 + 0.2);              // slow breathing
  const by = w * 0.6 * Math.sin(t * 0.27 + 1.4);

  // --- trauma shake (smooth multi-tone, no white-noise strobe) ---------------
  const tr = cam.shake || 0;
  let sx = 0, sy = 0, sz = 0, lx = 0, ly = 0, sRoll = 0;
  if (tr > 0.0005) {
    const a = tr * tr;
    const q = t * 17;
    sx = a * 0.42 * (Math.sin(q) + 0.55 * Math.sin(q * 2.31 + 1.7) + 0.3 * Math.sin(q * 4.7 + 0.4));
    sy = a * 0.34 * (Math.sin(q * 1.17 + 2.2) + 0.55 * Math.sin(q * 2.73 + 0.6) + 0.3 * Math.sin(q * 5.3 + 2.1));
    sz = a * 0.22 * Math.sin(q * 1.61 + 0.9);
    lx = a * 1.5 * (Math.sin(q * 1.43 + 0.5) + 0.5 * Math.sin(q * 3.1 + 2.4));
    ly = a * 1.3 * (Math.sin(q * 1.07 + 1.9) + 0.5 * Math.sin(q * 2.9 + 0.2));
    sRoll = a * 1.5 * Math.sin(q * 2.1 + 0.7);
    cam.shake = Math.max(0, tr - (0.9 + tr * 3.2) * dt);
  }

  const px = rig.p[0] + hx + bx + sx;
  const py = rig.p[1] + hy + by + sy;
  const pz = rig.p[2] + hz + sz;
  const lkx = rig.l[0] + hx * 0.55 + bx * 0.5 + lx;
  const lky = rig.l[1] + hy * 0.45 + by * 0.6 + ly;
  const lkz = rig.l[2] + hz * 0.5;

  cam.pos = guard(state, [px, py, pz]);
  cam.look = [lkx, lky, lkz];
  cam.fov = clamp(rig.fov * (1 - punch * 0.08), 18, 70);

  // --- roll -> camera up vector (gl.js reads cam.up) -------------------------
  const fwd = V.norm(V.sub(cam.look, cam.pos));
  const rgt = V.norm(V.cross(fwd, [0, 1, 0]));
  const up = V.norm(V.cross(rgt, fwd));
  const roll = (s.roll || 0) + sRoll;
  if (Math.abs(roll) > 0.0005) {
    const r = (roll * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
    cam.up = [up[0] * c + rgt[0] * sn, up[1] * c + rgt[1] * sn, up[2] * c + rgt[2] * sn];
  } else {
    cam.up = [0, 1, 0];
  }
}

/** Set the camera mode. opts: {focus, side, snap, dur}. */
export function set(state, mode, opts = {}) {
  const cam = state.cam;
  if (!cam) return;
  if (cam.mode === mode && JSON.stringify(cam.opts) === JSON.stringify(opts)) return;
  cam.mode = mode;
  cam.opts = opts;
  cam.modeT = 0;
  if (opts.snap) cam.snap = true;
}

/** Add trauma to the camera (0..1.5); decays automatically. */
export function shake(state, amount) {
  if (!state.cam) return;
  state.cam.shake = Math.min(1.5, (state.cam.shake || 0) + amount);
}
