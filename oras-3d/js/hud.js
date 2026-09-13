// hud.js: DOM plates, textbox, move menu. Battle logic drives via setFoe,
// setMe, say (awaitable), askMove. No GL, no game rules here.
const $ = (id) => document.getElementById(id);

// Display-only move metadata styled after the bar move-select capture
// (ORAS_battle_move.png): type pill + PP under each move name.
const MOVE_TYPE = { Tackle: "Normal", Ember: "Fire", Growl: "Normal", Leer: "Normal" };
const MOVE_PP = { Tackle: "35/35", Ember: "25/25", Growl: "40/40", Leer: "30/30" };
const TYPE_COLOR = { Normal: "#b8a684", Fire: "#e3350d" };

function paintHp(plate, frac) {
  const fill = plate.querySelector(".hpfill");
  const f = Math.max(0, Math.min(1, frac));
  fill.style.width = (f * 100).toFixed(1) + "%";
  fill.classList.toggle("low", f < 0.2);
  fill.classList.toggle("mid", f >= 0.2 && f < 0.5);
}

function ensureHpLabel(plate) {
  if (!plate.querySelector(".hplabel")) {
    const s = document.createElement("span");
    s.className = "hplabel";
    s.textContent = "HP";
    plate.insertBefore(s, plate.querySelector(".hpbar"));
  }
}

function ensureExp(plate) {
  let bar = plate.querySelector(".expbar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "expbar";
    const f = document.createElement("div");
    f.className = "expfill";
    bar.appendChild(f);
    plate.appendChild(bar);
  }
  return bar;
}

export function setFoe(name, lv, frac) {
  const p = $("foe-plate");
  p.querySelector(".nm").textContent = name;
  p.querySelector(".lv").textContent = "Lv" + lv;
  ensureHpLabel(p);
  paintHp(p, frac);
}

export function setMe(name, lv, frac, cur, max) {
  const p = $("me-plate");
  p.querySelector(".nm").textContent = name;
  p.querySelector(".lv").textContent = "Lv" + lv;
  ensureHpLabel(p);
  paintHp(p, frac);
  p.querySelector(".hpnum").textContent = `${cur}/${max}`;
  // No exp model in battle.js; show a static thin EXP bar like the ORAS plate.
  ensureExp(p).querySelector(".expfill").style.width = "55%";
}

let advance = null;
window.addEventListener("keydown", (e) => {
  if ((e.key === "z" || e.key === "Z" || e.key === "Enter") && advance) { const f = advance; advance = null; f(); }
});

export function say(line) {
  return new Promise((res) => {
    $("text").textContent = line;
    $("arrow").style.visibility = "visible";
    advance = () => { $("arrow").style.visibility = "hidden"; res(); };
  });
}

export function askMove(moves) {
  return new Promise((res) => {
    const menu = $("movemenu");
    menu.innerHTML = "";
    menu.hidden = false;
    let idx = 0;
    const btns = moves.map((m, i) => {
      const b = document.createElement("button");
      const type = MOVE_TYPE[m] || "Normal";
      b.style.setProperty("--type", TYPE_COLOR[type] || TYPE_COLOR.Normal);
      b.classList.add(i % 2 === 0 ? "mv-left" : "mv-right");
      const nm = document.createElement("span");
      nm.className = "mv-name";
      nm.textContent = m;
      const meta = document.createElement("span");
      meta.className = "mv-meta";
      const pill = document.createElement("span");
      pill.className = "mv-type mv-" + type.toLowerCase();
      pill.textContent = type.toUpperCase();
      const pp = document.createElement("span");
      pp.className = "mv-pp";
      pp.textContent = "PP " + (MOVE_PP[m] || "--/--");
      meta.append(pill, pp);
      b.append(nm, meta);
      b.onclick = () => pick(i);
      menu.appendChild(b);
      return b;
    });
    const paint = () => btns.forEach((b, i) => b.classList.toggle("sel", i === idx));
    const cols = 2;
    const onKey = (e) => {
      if (e.key === "ArrowRight") idx = (idx + 1) % btns.length;
      else if (e.key === "ArrowLeft") idx = (idx + btns.length - 1) % btns.length;
      else if (e.key === "ArrowDown") idx = (idx + cols) % btns.length;
      else if (e.key === "ArrowUp") idx = (idx + btns.length - cols) % btns.length;
      else if (e.key === "z" || e.key === "Z" || e.key === "Enter") { pick(idx); return; }
      else return;
      e.preventDefault(); paint();
    };
    function pick(i) { window.removeEventListener("keydown", onKey); menu.hidden = true; res(i); }
    window.addEventListener("keydown", onKey);
    paint();
  });
}
