// camera.js: ORAS-style over-shoulder battle camera. Pure math, no GL.
// Low behind-player framing: ally big in the bottom-left foreground,
// foe centered mid-distance on a diagonal.
export function getCamera(state, t) {
  const time = typeof t === "number" ? t : 0;
  // Slow orbital sway around the default framing (zero at t=0 so the
  // spec numbers read exact on boot; amplitudes tuned for the low eye).
  const swayX = Math.sin(time * 0.4) * 0.08;
  const swayY = (Math.sin(time * 0.53 + 1.3) - Math.sin(1.3)) * 0.08;
  let eye = [1.2 + swayX, 1.15 + swayY, 3.9 + (Math.cos(time * 0.31) - 1) * 0.08];
  const at = [-0.6, 0.95, -2];
  const fovy = 0.61; // ~35deg

  // Push-in while the move menu is open.
  let menuOpen = false;
  try {
    if (typeof document !== "undefined") {
      menuOpen = document.getElementById("movemenu")?.hidden === false;
    }
  } catch (_) { menuOpen = false; }
  if (menuOpen) {
    // Push-in: dolly along the view direction toward the foe.
    const target = [0.85, 1.1, 2.4];
    // Static blend toward the push-in framing (no persistent anim state).
    const k = 0.55;
    eye = [
      eye[0] + (target[0] - eye[0]) * k,
      eye[1] + (target[1] - eye[1]) * k,
      eye[2] + (target[2] - eye[2]) * k,
    ];
  }

  // Impact shake: read once, random offset; decay owned by battle.js.
  const shake = (state && typeof state.camShake === "number") ? state.camShake : 0;
  if (shake) {
    eye = [
      eye[0] + (Math.random() - 0.5) * shake * 0.05,
      eye[1] + (Math.random() - 0.5) * shake * 0.05,
      eye[2] + (Math.random() - 0.5) * shake * 0.05,
    ];
  }

  // Keep the camera above the ground (floor lowered for the low eye).
  if (eye[1] <= 0.8) eye[1] = 0.81;
  // Telemetry for lead framing measurement (no visual effect).
  try { if (typeof window !== "undefined") window.__orasCam = { eye: [...eye], at: [...at], fovy }; } catch (_) {}
  return { eye, at, fovy };
}
