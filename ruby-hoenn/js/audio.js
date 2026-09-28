// Tiny WebAudio synth: SFX + two looping tunes. Original melodies.
let ac = null, muted = false, songTimer = null, songStep = 0, currentSong = null;

export function ensureAudio() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
  if (ac && ac.state === "suspended") ac.resume();
}
export function toggleMute() { muted = !muted; return muted; }

function tone(freq, dur, type = "square", vol = 0.05, when = 0) {
  if (!ac || muted) return;
  const t = ac.currentTime + when;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

// mr = middle C 261.63; note helper
const N = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
            C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
            C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.0, A3: 220.0, B3: 246.94,
            E5b: 622.25, B4b: 466.16, A4b: 415.3, G4b: 415.3 };

export const sfx = {
  blip()  { tone(660, 0.05); },
  confirm() { tone(523.25, 0.07); tone(783.99, 0.09, "square", 0.05, 0.07); },
  hit()   { tone(180, 0.12, "sawtooth", 0.07); tone(120, 0.1, "square", 0.05, 0.02); },
  super() { tone(880, 0.1); tone(1174.66, 0.14, "square", 0.06, 0.08); },
  weak()  { tone(330, 0.12); },
  heal()  { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.12, "triangle", 0.06, i * 0.1)); },
  catch_()   { [392, 523.25, 659.25, 783.99].forEach((f, i) => tone(f, 0.1, "square", 0.05, i * 0.09)); },
  ball()  { tone(700, 0.05); tone(500, 0.05, "square", 0.05, 0.08); tone(350, 0.08, "square", 0.05, 0.16); },
  fanfare() { [523.25, 523.25, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i === 5 ? 0.4 : 0.12, "square", 0.06, i * 0.13)); },
  badge() { [392, 392, 523.25, 659.25, 783.99, 783.99, 1046.5].forEach((f, i) => tone(f, 0.14, "triangle", 0.07, i * 0.12)); },
};

const SONGS = {
  // [note, beats] — original chiptunes
  town: [
    ["E4",1],["G4",1],["C5",2],["B4",1],["A4",1],["G4",2],["E4",1],["D4",1],
    ["C4",2],["D4",1],["E4",1],["G4",2],["E4",1],["D4",1],["C4",4],
  ],
  battle: [
    ["C4",.5],["C4",.5],["D4",.5],["E4",1],["E4",.5],["D4",.5],["C4",1],["G3",1],
    ["A3",.5],["A3",.5],["B3",.5],["C4",1],["B3",.5],["A3",.5],["G3",2],
  ],
  gym: [
    ["E4",.5],["F4",.5],["G4",1],["G4",.5],["F4",.5],["E4",1],["D4",1],
    ["E4",.5],["F4",.5],["G4",1],["A4",1],["G4",2],
  ],
};

export function playSong(name) {
  if (currentSong === name) return;
  stopSong(); currentSong = name; songStep = 0;
  const beat = 60 / 132 * 1000 / 2;
  const seq = SONGS[name];
  songTimer = setInterval(() => {
    if (muted || !ac || document.hidden) { songStep = (songStep + 1) % seq.length; return; }
    const [n, b] = seq[songStep % seq.length];
    if (N[n]) tone(N[n], 0.16, "square", 0.025);
    songStep++;
  }, beat);
}
export function stopSong() { if (songTimer) clearInterval(songTimer); songTimer = null; currentSong = null; }
