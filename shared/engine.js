// ============================================================
// PACIFIC CHASE — moteur de simulation partagé (client/serveur)
// Pures fonctions déterministes : aucun accès réseau, DOM ni fs.
// Référence : document de design v3 + proto Canvas React.
// Unités : 1 degré = 60 NM ; 1 NM = 1,852 km ; cartes 60° de côté.
// ============================================================

export const MAP = 60; // degres
export const DEG_NM = 60; // 1 degre = 60 milles nautiques
export const KM_PER_NM = 1.852;
export const KM_PER_DEG = DEG_NM * KM_PER_NM;
export const PULSE_MIN = 30; // pulsation radio toutes les 30 min de jeu
export const CAPTURE_R_NM = 500 / 1000 / KM_PER_NM; // capture à 500 m
export const DELIVERY_R_NM = 500 / 1000 / KM_PER_NM; // livraison à 500 m

// ---------- Utilitaires ----------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const distNm = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) * DEG_NM;
export const bearingTo = (ax, ay, bx, by) =>
  ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360;
export const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
// Distance (NM) d'un point P au segment [A,B] — évite de traverser une zone
// (capture, livraison) lors d'un grand pas de simulation.
export function segDistNm(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return distNm(px, py, ax, ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return distNm(px, py, bx, by);
  const t = c1 / c2;
  return distNm(px, py, ax + t * vx, ay + t * vy);
}
function inPoly(px, py, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i][0], yi = verts[i][1];
    const xj = verts[j][0], yj = verts[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Rayon d'une île (polygone radial) dans une direction (radians, 0 = nord)
function isleRadAt(i, brg) {
  const radii = i.radii;
  const n = radii.length;
  let a = brg % (Math.PI * 2); if (a < 0) a += Math.PI * 2;
  const step = (Math.PI * 2) / n;
  const k = Math.floor(a / step) % n;
  const f = (a - k * step) / step;
  const r0 = radii[k].rad, r1 = radii[(k + 1) % n].rad;
  return r0 + (r1 - r0) * f;
}
export { isleRadAt };
// Distance d'un point à une polyligne (unités des points)
export function distToLine(px, py, pts) {
  let best = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const ax = pts[k][0], ay = pts[k][1], bx = pts[k + 1][0], by = pts[k + 1][1];
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

// ---------- Raretés des balises ----------
export const RARITY_STYLE = {
  commune: { color: "#4ade80", pts: 1 },
  rare: { color: "#38bdf8", pts: 3 },
  legendaire: { color: "#facc15", pts: 8 },
  inconnue: { color: "#c084fc", pts: 5 },
};
export const RARITY_LABEL = { legendaire: "légendaire" };

// ---------- Génération du monde ----------
// Toute la géométrie (continent, port, îles, avant-postes, balises) est
// dérivée d'une graine — rejouable à l'identique serveur et client.
export function buildWorld(seed) {
  const rng = mulberry32(seed);
  let CONTINENT, PORT, ISLANDS, isLand, BEACONS, OUTPOSTS, COAST;

  const c = 6 + rng() * 4;
  const corner = Math.floor(rng() * 4);
  const east = corner % 2 === 0;
  const highY = corner >= 2;
  CONTINENT = east
    ? { x0: 0, y0: highY ? MAP - c : 0, x1: c, y1: highY ? MAP : c }
    : { x0: MAP - c, y0: highY ? MAP - c : 0, x1: MAP, y1: highY ? MAP : c };
  const cAmp = c * 0.25;
  const mkOff = (f1, f2, ph) => (t) =>
    cAmp * (0.65 * Math.sin(f1 * t * Math.PI * 2 + ph) + 0.35 * Math.sin(f2 * t * Math.PI * 2 + ph * 1.7));
  const offV = mkOff(1 + Math.floor(rng() * 2), 3 + Math.floor(rng() * 2), rng() * Math.PI * 2);
  const offH = mkOff(1 + Math.floor(rng() * 2), 3 + Math.floor(rng() * 2), rng() * Math.PI * 2);
  const xv = east ? CONTINENT.x1 : CONTINENT.x0;
  const yh = highY ? CONTINENT.y0 : CONTINENT.y1;
  const xFar = east ? CONTINENT.x0 : CONTINENT.x1;
  const yStart = highY ? CONTINENT.y1 : CONTINENT.y0;
  const K = [xv + offV(1), yh + offH(0)];
  const mainCoast = Array.from({ length: 9 }, (_, j) => {
    const t = j / 8;
    return j === 8 ? K : [xv + offV(t), yStart + (yh - yStart) * t];
  });
  const secCoast = Array.from({ length: 9 }, (_, j) => {
    const t = j / 8;
    return j === 0 ? K : [xv + (xFar - xv) * t, yh + offH(t)];
  });
  COAST = [...mainCoast, ...secCoast.slice(1)];
  CONTINENT.verts = [[xFar, yStart], ...mainCoast, ...secCoast];

  const pj = 3 + Math.floor(rng() * 3);
  PORT = { x: mainCoast[pj][0], y: mainCoast[pj][1] };

  const blob = (cx, cy, base, n) => {
    const amp = 0.2 + rng() * 0.15;
    const ph1 = rng() * Math.PI * 2, ph2 = rng() * Math.PI * 2;
    const h1 = 2 + Math.floor(rng() * 2), h2 = 5 + Math.floor(rng() * 3);
    const radii = Array.from({ length: n }, (_, k) => {
      const ang = (k / n) * Math.PI * 2;
      const rad = Math.max(0.3, base * (1 + amp * (0.6 * Math.sin(h1 * ang + ph1) + 0.4 * Math.sin(h2 * ang + ph2))));
      return { ang, rad };
    });
    const verts = radii.map((p) => [cx + Math.sin(p.ang) * p.rad, cy + Math.cos(p.ang) * p.rad]);
    return { verts, radii };
  };

  ISLANDS = (() => {
    const out = [];
    let guard = 0;
    while (out.length < 7 && guard++ < 2000) {
      let best = null, bestScore = -1;
      for (let k = 0; k < 12; k++) {
        const x = 12 + rng() * 46;
        const y = 12 + rng() * 46;
        const r = 1.2 + rng() * 2;
        const cDist = Math.max(
          Math.max(CONTINENT.x0 - cAmp - x, 0, x - CONTINENT.x1 - cAmp),
          Math.max(CONTINENT.y0 - cAmp - y, 0, y - CONTINENT.y1 - cAmp)
        );
        if (cDist < r * 1.4 + 0.3) continue;
        const b = blob(x, y, r, 12);
        const score = out.length === 0 ? Infinity : Math.min(...out.map((i) => distNm(i.x, i.y, x, y)));
        if (score > bestScore) {
          bestScore = score;
          best = { x, y, r, verts: b.verts, radii: b.radii, maxR: Math.max(...b.radii.map((p) => p.rad)) };
        }
      }
      if (bestScore > 200) out.push(best);
    }
    return out;
  })();

  OUTPOSTS = (() => {
    const out = [];
    const taken = [];
    let guard = 0;
    while (out.length < Math.min(3, ISLANDS.length) && guard++ < 200) {
      const idx = Math.floor(rng() * ISLANDS.length);
      if (taken.includes(idx)) continue;
      const i = ISLANDS[idx];
      const brg = rng() * Math.PI * 2;
      const rr = isleRadAt(i, brg);
      taken.push(idx);
      out.push({ island: idx, x: i.x + Math.sin(brg) * rr * 0.995, y: i.y + Math.cos(brg) * rr * 0.995 });
    }
    return out;
  })();

  isLand = (x, y) =>
    (x >= CONTINENT.x0 - cAmp && x < CONTINENT.x1 + cAmp && y >= CONTINENT.y0 - cAmp && y < CONTINENT.y1 + cAmp && inPoly(x, y, CONTINENT.verts)) ||
    ISLANDS.some((i) => Math.hypot(i.x - x, i.y - y) < i.maxR && inPoly(x, y, i.verts));

  BEACONS = (() => {
    const out = [];
    const place = (minD, maxD) => {
      let best = null, bestScore = -1;
      for (let i = 0; i < 400; i++) {
        const x = 2 + rng() * 56;
        const y = 2 + rng() * 56;
        if (isLand(x, y)) continue;
        const d = distNm(x, y, PORT.x, PORT.y);
        if (d < 6 * DEG_NM || d < minD || d > maxD) continue;
        if (out.some((b) => distNm(b.x, b.y, x, y) < 100)) continue;
        const score = out.length === 0 ? 1 : Math.min(...out.map((b) => distNm(b.x, b.y, x, y)));
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
      return best || { x: MAP / 2, y: MAP / 2 };
    };
    const bands = { commune: [500, 1600], rare: [900, 2200], legendaire: [2200, 3400], inconnue: [1600, 2600] };
    const counts = { commune: 10, rare: 6, legendaire: 4, inconnue: 1 };
    for (const [rarity, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        const p = place(bands[rarity][0], bands[rarity][1]);
        out.push({ id: `${rarity[0]}${i}`, x: p.x, y: p.y, rarity, pts: RARITY_STYLE[rarity].pts, active: true, phase: Math.floor(rng() * PULSE_MIN) });
      }
    }
    return out;
  })();

  return { seed, CONTINENT, PORT, ISLANDS, OUTPOSTS, BEACONS, COAST, isLand };
}

// ---------- Météo ----------
export const ARCHETYPES = [
  { name: "Soleil calme", clouds: 10, wind: 6, rain: 0, vis: 13.5, temp: 4, storm: false, fog: false },
  { name: "Brouillard", clouds: 55, wind: 3, rain: 0, vis: 0.32, temp: 1, storm: false, fog: true },
  { name: "Soleil venteux", clouds: 20, wind: 20, rain: 0, vis: 10.8, temp: 2, storm: false, fog: false },
  { name: "Nuageux", clouds: 70, wind: 12, rain: 0, vis: 6.5, temp: 0, storm: false, fog: false },
  { name: "Nuageux pluie faible", clouds: 85, wind: 16, rain: 35, vis: 4.3, temp: -2, storm: false, fog: false },
  { name: "Pluie forte", clouds: 95, wind: 26, rain: 80, vis: 2.2, temp: -3, storm: false, fog: false },
  { name: "Orage", clouds: 98, wind: 44, rain: 100, vis: 0.81, temp: -5, storm: true, fog: true },
];
export const DOUGLAS_LABEL = ["calme", "belle", "peu agitée", "agitée", "forte", "très forte", "grosse", "très grosse", "énorme", "monstrueuse"];
export const douglasOf = (hs) =>
  hs < 0.1 ? 0 : hs < 0.5 ? 1 : hs < 1.25 ? 2 : hs < 2.5 ? 3 : hs < 4 ? 4 : hs < 6 ? 5 : hs < 9 ? 6 : hs < 14 ? 7 : hs < 20 ? 8 : 9;

const hash2 = (x, y, s) => {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
};
const vnoise = (x, y, s) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x, y, s) =>
  0.6 * vnoise(x, y, s) + 0.3 * vnoise(x * 2.1, y * 2.1, s + 1.3) + 0.1 * vnoise(x * 4.3, y * 4.3, s + 2.7);

// Météo à (x, y) au temps tMin (minutes de jeu). Champs fBm 3 octaves avec
// advection ouest→est, remappage quantile vers les archétypes. Déterministe :
// identique serveur/client. Le brouillard est uniquement l'archétype dédié.
export function weatherAt(x, y, tMin, seed) {
  const p = seed || 0;
  const h = tMin / 60;
  const xs = (x - 0.2 * h) / 13;
  const ys = (y + 0.03 * h) / 13;
  const uq = clamp(fbm(xs, ys, p), 0, 1);
  const UBP = [0, 0.366, 0.387, 0.509, 0.618, 0.689, 0.766];
  let n = 6;
  for (let i = 0; i < 6; i++) {
    if (uq < UBP[i + 1]) { n = i + (uq - UBP[i]) / (UBP[i + 1] - UBP[i]); break; }
  }
  const i0 = Math.floor(n);
  const i1 = Math.min(i0 + 1, ARCHETYPES.length - 1);
  const f = n - i0;
  const A = ARCHETYPES[i0], B = ARCHETYPES[i1];
  const mix = (a, b) => a + (b - a) * f;
  const clouds = clamp(mix(A.clouds, B.clouds) + 6 * Math.sin(x * 0.3 + h * 0.1 + p), 0, 100);
  const windSpd = Math.max(0, mix(A.wind, B.wind) + 3 * Math.sin(h * 0.5 + x * 0.25 + y * 0.2 + p * 1.3));
  const rain = clamp(mix(A.rain, B.rain), 0, 100);
  let visibility = Math.max(0.3, mix(A.vis, B.vis));
  const storm = mix(A.storm ? 1 : 0, B.storm ? 1 : 0) > 0.5;
  const fog = visibility < 0.8 && !storm;
  const windDir = (220 + 120 * Math.sin(x * 0.08 + y * 0.06 + h * 0.05 + p * 1.7) + 360) % 360;
  const temp = 22 + 6 * Math.sin(y * 0.1) + mix(A.temp, B.temp);
  const curDir = (x * 7 + y * 13 + h * 1.2) % 360;
  const curSpd = 1.2 + Math.abs(Math.sin(x * 0.3 + y * 0.2));
  const u = windSpd * 0.514;
  const hs = Math.round(0.0212 * u * u * 10) / 10;
  const period = Math.round(Math.min(14, Math.max(2, 0.7 * u)) * 10) / 10;
  const douglas = douglasOf(hs);
  return {
    windSpd: Math.round(windSpd * 10) / 10, windDir: Math.round(windDir), clouds: clamp(Math.round(clouds), 0, 100),
    storm, rain: Math.round(rain), fog, visibility: Math.round(visibility * 10) / 10,
    temp: Math.round(temp), curDir: Math.round(curDir), curSpd: Math.round(curSpd * 10) / 10,
    hs, period, douglas,
    name: f < 0.5 ? A.name : B.name,
  };
}

// ---------- Vision ----------
export const VIS_BASE = { ile: 40, continent: 30, port: 20, poste: 15, balise: 9 };
export const VIS_NUIT = { ile: 3, continent: 3, port: 15, poste: 10, balise: 11 };
export const detectKm = (kind, visKm, night) => Math.min(visKm, night ? VIS_NUIT[kind] : VIS_BASE[kind]);

// ---------- Voile ----------
export const SAIL_POLAR = [[0, 0.8], [45, 0.75], [90, 1.0], [135, 0.9], [160, 0.3], [180, 0]];
export function sailPolarFactor(angle) {
  for (let i = 0; i < SAIL_POLAR.length - 1; i++) {
    const [a0, f0] = SAIL_POLAR[i];
    const [a1, f1] = SAIL_POLAR[i + 1];
    if (angle >= a0 && angle <= a1) return f0 + ((angle - a0) / (a1 - a0)) * (f1 - f0);
  }
  return 0;
}

// ---------- Radio ----------
export const signalStrengthKm = (dKm) => Math.max(0, Math.round(100 * (1 - dKm / 2000)));
export const dirSensitivity = (antBeam) => 1 + ((antBeam - 1) / 179) * 49;
export function dirEffSensitivity(antBeam, diff, sens) {
  const ratio = clamp(diff / (antBeam / 2), 0, 1);
  return 100 - (100 - sens) * (1 - 0.2 * ratio);
}

// Détection d'une émission par les capteurs radio du navire.
export function detectBeacon(st, b, world) {
  const d = distNm(st.x, st.y, b.x, b.y);
  const dKm = d * KM_PER_NM;
  const strength = signalStrengthKm(dKm);
  const brg = bearingTo(st.x, st.y, b.x, b.y);
  let got = null;
  if (strength >= 75) got = { t: st.t, beaconId: b.id, bearing: null, strength, source: "omni" };
  const sens = dirSensitivity(st.antBeam);
  const antHeading = (st.heading + st.antOrient + 720) % 360;
  const signedDiff = angDiff(brg, antHeading);
  const diff = Math.abs(signedDiff);
  const effSens = dirEffSensitivity(st.antBeam, diff, sens);
  if (strength >= effSens && diff <= st.antBeam / 2) {
    const side = diff < 1
      ? "centre"
      : signedDiff > 0
        ? (diff < st.antBeam / 4 ? "D1" : "D2")
        : (diff < st.antBeam / 4 ? "G1" : "G2");
    got = { t: st.t, beaconId: b.id, bearing: Math.round(antHeading), beam: st.antBeam, side, strength, source: "dir" };
  }
  return got;
}

// ---------- État du joueur ----------
// tMin : minutes de jeu écoulées depuis le départ de la course (référence
// partagée par tous les joueurs — même horloge de course).
export function newPlayerState(world, opts = {}) {
  const eastCoast = world.CONTINENT.x1 <= MAP / 2;
  const sx = eastCoast ? world.PORT.x + 0.0027 : world.PORT.x - 0.0027;
  return {
    t: 0, x: sx, y: world.PORT.y, heading: eastCoast ? 90 : 270,
    sail: 0.8, engine: 0.8,
    estX: sx, estY: world.PORT.y, unc: 0,
    navFix: { active: false, startT: 0, doneNight: null, lastTryT: null },
    location: "surface", mast: false, engineOn: false, electricOn: false, periscope: false, vkn: 0,
    fuel: 100, battery: 100, food: 100, score: 0, codes: [],
    antBeam: 45, antOrient: 0, signals: [], notifications: [], notifSeq: 0,
    grounded: false, wasStorm: false, warnedFood: false, warnedFuel: false, warnedBatt: false,
    ffEvents: [], travelledNm: 0, dailyNm: 0, dayIdx: 0,
    weatherSeed: opts.weatherSeed ?? Math.floor(Math.random() * 1000), weatherName: null,
    sawIsland: false, sawBeaconId: null, sawPort: false, sawCont: false, sawOutpostIds: [], pins: [], measures: [],
    seaDouglas: null,
    // Défauts d'instruments fixes pour toute la course, inconnus du navigateur
    compDev: (0.3 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1),
    logErr: (0.5 + Math.random()) * (Math.random() < 0.5 ? -1 : 1),
  };
}

function notify(st, text, kind, cat) {
  st.notifSeq = (st.notifSeq || 0) + 1;
  st.notifications.unshift({ id: st.notifSeq, t: st.t, text, kind, cat: cat || "navire" });
  if (st.notifications.length > 150) st.notifications.pop();
}
function ev(st, kind, text, cat) {
  st.ffEvents.push({ kind, text });
  notify(st, text, kind === "signal" ? "info" : "warn", cat);
}

function speedKn(st, w) {
  let kn = 0;
  if (st.location === "surface") {
    if (st.mast) {
      const windTo = (w.windDir + 180) % 360;
      const angle = Math.abs(angDiff(st.heading + (st.compDev || 0), windTo));
      const wf = clamp(w.windSpd / 20, 0, 1.1);
      kn += 17 * wf * st.sail * sailPolarFactor(angle);
    }
    if (st.engineOn && st.fuel > 0) kn += 15 * st.engine;
    kn = Math.min(kn, 20);
  } else {
    if (st.electricOn && st.battery > 0) kn += (st.periscope ? 6 : 4) * st.engine;
  }
  return kn;
}

// Un tick = dtMin minutes de jeu. Le monde (balises actives) est partagé
// entre joueurs : toute capture par un joueur désactive la balise pour tous.
export function tick(st, dtMin, world) {
  const prevT = st.t;
  st.t += dtMin;
  const w = weatherAt(st.x, st.y, st.t, st.weatherSeed);
  if (st.weatherName && st.weatherName !== w.name) {
    notify(st, `Situation météo : ${st.weatherName} → ${w.name}.`, "info", "meteo");
  }
  st.weatherName = w.name;
  const hour = (st.t / 60) % 24;
  const daylight = hour >= 6 && hour < 20;

  // Consommations
  if (st.location === "surface" && st.engineOn) st.fuel = Math.max(0, st.fuel - 1.2 * st.engine * (dtMin / 60));
  if (st.location === "underwater" && st.electricOn)
    st.battery = Math.max(0, st.battery - (st.periscope ? 2.0 : 1.4) * st.engine * (dtMin / 60));
  if (st.location === "surface" && daylight)
    st.battery = Math.min(100, st.battery + 5 * (1 - w.clouds / 130) * (dtMin / 60));
  st.food = Math.max(0, st.food - 0.22 * (dtMin / 60));

  // Mouvement + inertie
  const target = speedKn(st, w);
  const accel = st.location === "surface" ? 3.0 : 1.0;
  const decel = st.location === "surface" ? 1.5 : 0.8;
  if (st.vkn < target) st.vkn = Math.min(target, st.vkn + accel * dtMin);
  else st.vkn = Math.max(target, st.vkn - decel * dtMin);
  const rad = (st.heading * Math.PI) / 180;
  const radT = ((st.heading + st.compDev) * Math.PI) / 180;
  const cdr = (w.curDir * Math.PI) / 180;
  const through = (st.vkn / 3600) * dtMin;
  const throughT = through * (1 + st.logErr / 100);
  const drift = (w.curSpd / 3600) * dtMin;
  const moored = st.location === "surface" &&
    (distNm(st.x, st.y, world.PORT.x, world.PORT.y) < DELIVERY_R_NM ||
     world.OUTPOSTS.some((o) => distNm(st.x, st.y, o.x, o.y) < DELIVERY_R_NM));
  const driftEff = moored ? 0 : drift;
  const prevX = st.x, prevY = st.y;
  const nx = st.x + Math.sin(radT) * throughT + Math.sin(cdr) * driftEff;
  const ny = st.y + Math.cos(radT) * throughT + Math.cos(cdr) * driftEff;
  st.travelledNm += st.vkn * (dtMin / 60);
  const day = Math.floor(st.t / 1440);
  if (day !== st.dayIdx) { st.dayIdx = day; st.dailyNm = 0; }
  st.dailyNm += st.vkn * (dtMin / 60);
  if (nx < 0.2 || nx > MAP - 0.2 || ny < 0.2 || ny > MAP - 0.2) {
    if (!st.grounded) notify(st, "Limite de la zone de course — cap bloqué.", "warn", "alertes");
    st.grounded = true;
    st.vkn = 0;
  } else if (world.isLand(nx, ny)) {
    if (!st.grounded) ev(st, "land", "⚠️ Terre détectée — navigation stoppée (risque d'échouement). Changez de cap.", "alertes");
    st.grounded = true;
    st.vkn = 0;
  } else {
    st.x = nx; st.y = ny; st.grounded = false;
    st.estX += Math.sin(rad) * through;
    st.estY += Math.cos(rad) * through;
    st.unc += 0.025 * (st.vkn * KM_PER_NM * dtMin / 60) + 0.278 * (dtMin / 60) + drift * KM_PER_DEG;
  }

  // Orages
  if (w.storm && !st.wasStorm) {
    ev(st, "storm", "⚡ Tempête signalée sur votre zone", "meteo");
    st.sail = Math.min(st.sail, 0.3);
    notify(st, "⚡ Tempête : voilure automatiquement réduite à 30 % par l'équipage.", "warn", "meteo");
  }
  if (!w.storm && st.wasStorm) notify(st, "La tempête s'éloigne. Conditions améliorées.", "good", "meteo");
  st.wasStorm = w.storm;

  if (st.seaDouglas != null) {
    if (w.douglas >= 5 && st.seaDouglas < 5)
      ev(st, "sea", `🌊 Mer ${DOUGLAS_LABEL[w.douglas]} : houle ${w.hs} m, période ${w.period} s.`, "meteo");
    if (w.douglas < 5 && st.seaDouglas >= 5) notify(st, "🌊 La mer s'apaise.", "good", "meteo");
  }
  st.seaDouglas = w.douglas;

  // Point aux étoiles
  const night = hour < 6 || hour >= 20;
  const dayIdx = Math.floor(st.t / 1440);
  const nightIdx = (st.t % 1440) >= 20 * 60 ? dayIdx : dayIdx - 1;
  const navOk = st.location === "surface" && !w.storm && !w.fog && w.clouds <= 50;
  if (st.navFix.active) {
    if (st.t - st.navFix.startT >= 120) {
      if (navOk) {
        const newUnc = Math.max(1.5, 1.5 + 0.2 * w.clouds + 1.5 * w.hs + 0.4 * Math.max(0, 10 - w.visibility * KM_PER_NM));
        if (newUnc < st.unc) {
          const fa = Math.random() * Math.PI * 2;
          const fr = Math.sqrt(Math.random()) * (newUnc / KM_PER_DEG);
          st.estX = st.x + Math.cos(fa) * fr;
          st.estY = st.y + Math.sin(fa) * fr;
          st.unc = newUnc;
          ev(st, "nav", `🔭 Point aux étoiles réussi : incertitude ± ${newUnc.toFixed(1)} km.`, "nav");
        } else {
          notify(st, `🔭 Point aux étoiles réalisé (± ${newUnc.toFixed(1)} km) — sans gain.`, "info", "nav");
        }
        st.navFix = { active: false, doneNight: nightIdx, lastTryT: st.t };
      } else {
        st.navFix = { active: false, doneNight: st.navFix.doneNight, lastTryT: st.t };
        notify(st, "🔭 Point aux étoiles échoué — nouvel essai dans 2 h.", "warn", "nav");
      }
    }
  } else if (night && navOk && st.navFix.doneNight !== nightIdx
    && (st.navFix.lastTryT == null || st.t - st.navFix.lastTryT >= 120)) {
    st.navFix = { active: true, startT: st.t, doneNight: st.navFix.doneNight, lastTryT: st.navFix.lastTryT };
    notify(st, "🔭 Le navigateur commence un point aux étoiles (durée : 2 h).", "info", "nav");
  }

  // Alertes ressources
  if (st.food < 15 && !st.warnedFood) { ev(st, "res", "Vivres < 15%", "alertes"); st.warnedFood = true; }
  if (st.fuel < 15 && st.engineOn && !st.warnedFuel) { ev(st, "res", "Carburant < 15%", "alertes"); st.warnedFuel = true; }
  if (st.battery < 15 && !st.warnedBatt) { ev(st, "res", "Batteries < 15%", "alertes"); st.warnedBatt = true; }
  if (st.food > 30) st.warnedFood = false;
  if (st.fuel > 30) st.warnedFuel = false;
  if (st.battery > 30) st.warnedBatt = false;

  // Radio : pulsations par balise (phase aléatoire propre à chaque balise)
  const radioOk = (st.location === "surface" || (st.location === "underwater" && st.periscope)) && st.battery > 0;
  if (radioOk) {
    for (const b of world.BEACONS) {
      if (!b.active) continue;
      const pulsed = Math.floor((st.t + b.phase) / PULSE_MIN) !== Math.floor((prevT + b.phase) / PULSE_MIN);
      if (!pulsed) continue;
      const got = detectBeacon(st, b);
      if (got) {
        st.signals.unshift(got);
        if (st.signals.length > 30) st.signals.pop();
        const dEst = Math.round(2000 * (1 - got.strength / 100));
        const txt = got.source === "omni"
          ? `📡 Balise ${b.id} — signal ${got.strength}% (distance estimée : ${dEst} ± ${Math.round(dEst * 0.2)} km, omnidirectionnelle, azimut inconnu)`
          : `📡 Balise ${b.id} — azimut ${got.bearing}°, signal ${got.strength}% (distance estimée : ${dEst} ± ${Math.round(dEst * 0.2)} km), partie ${got.side} du cône (ouverture ${got.beam}°)`;
        notify(st, txt, "info", "radio");
      }
    }
  }

  // Observations visuelles + points visuels
  const night2 = !daylight;
  const canSee = st.location === "surface" || st.periscope;
  const visKm = w.visibility * KM_PER_NM;
  const azTo = (x, y) => Math.round((Math.atan2(x - st.x, y - st.y) * 180) / Math.PI + 360) % 360;
  const kmOf = (x, y) => (distNm(st.x, st.y, x, y) / DEG_NM) * KM_PER_DEG;
  const nearIsl = world.ISLANDS.reduce(
    (best, i) => {
      const c = kmOf(i.x, i.y) - isleRadAt(i, Math.atan2(st.x - i.x, st.y - i.y)) * KM_PER_DEG;
      return c < best.c ? { i, c } : best;
    },
    { i: world.ISLANDS[0], c: 1e9 }
  );
  const islandVis = canSee && nearIsl.c <= detectKm("ile", visKm, night2);
  if (islandVis && !st.sawIsland) {
    notify(st, `🏝️ Île en vue : ~${Math.round(nearIsl.c)} km, azimut ${azTo(nearIsl.i.x, nearIsl.i.y)}°.`, "info", "vision");
    if (st.unc > 8) { st.unc = 8; notify(st, "🔭 Point visuel sur l'île : incertitude ± 8 km.", "good", "nav"); }
  }
  st.sawIsland = islandVis;
  const bVis = canSee ? world.BEACONS.map((b) => ({ b, km: kmOf(b.x, b.y) })).find((e) => e.b.active && e.km <= detectKm("balise", visKm, night2)) : null;
  if (bVis && st.sawBeaconId !== bVis.b.id) {
    notify(st, night2
      ? `🔦 Feu de balise en vue (${bVis.b.id}) : ${Math.round(bVis.km)} km, azimut ${azTo(bVis.b.x, bVis.b.y)}°.`
      : `📍 Balise en vue (${bVis.b.id}) : ${Math.round(bVis.km)} km, azimut ${azTo(bVis.b.x, bVis.b.y)}°.`, "info", "vision");
    if (st.unc > 3.7) { st.unc = 3.7; notify(st, "🔭 Point visuel sur la balise : incertitude ± 3,7 km.", "good", "nav"); }
  }
  st.sawBeaconId = bVis ? bVis.b.id : null;
  const portKm = kmOf(world.PORT.x, world.PORT.y);
  const portVis = canSee && portKm <= detectKm("port", visKm, night2);
  if (portVis && !st.sawPort) {
    notify(st, `🏛️ Port en vue : ${Math.round(portKm)} km, azimut ${azTo(world.PORT.x, world.PORT.y)}°.`, "info", "vision");
    if (st.unc > 0.9) { st.unc = 0.9; notify(st, "🔭 Point visuel sur le port : incertitude ± 0,9 km.", "good", "nav"); }
  }
  st.sawPort = portVis;
  const contKm = distToLine(st.x, st.y, world.COAST) * KM_PER_DEG;
  const contVis = canSee && contKm <= detectKm("continent", visKm, night2);
  if (contVis && !st.sawCont) {
    notify(st, `🏞️ Côte en vue : ~${Math.round(contKm)} km.`, "info", "vision");
    if (st.unc > 10) { st.unc = 10; notify(st, "🔭 Point visuel sur la côte : incertitude ± 10 km.", "good", "nav"); }
  }
  st.sawCont = contVis;
  world.OUTPOSTS.forEach((o, idx) => {
    const km = kmOf(o.x, o.y);
    if (canSee && km <= detectKm("poste", visKm, night2) && !st.sawOutpostIds.includes(idx)) {
      st.sawOutpostIds.push(idx);
      notify(st, `🏕️ Avant-poste en vue : ${Math.round(km)} km, azimut ${azTo(o.x, o.y)}°.`, "info", "vision");
      if (st.unc > 3.7) { st.unc = 3.7; notify(st, "🔭 Point visuel sur l'avant-poste : incertitude ± 3,7 km.", "good", "nav"); }
    }
  });

  // Capture (surface ou immersion périscope) — balise partagée : première
  // capture gagne, désactivée pour tous les joueurs.
  if (st.location === "surface" || (st.location === "underwater" && st.periscope)) {
    for (const b of world.BEACONS) {
      if (!b.active) continue;
      if (segDistNm(b.x, b.y, prevX, prevY, st.x, st.y) < CAPTURE_R_NM) {
        b.active = false;
        st.codes.push({ id: b.id, rarity: b.rarity, pts: b.pts });
        ev(st, "capture", `📦 Code de la balise ${b.id} (${RARITY_LABEL[b.rarity] || b.rarity}, ${b.pts} pts) enregistré. Balise désactivée.`, "balises");
      }
    }
  }

  // Livraison au port
  if (segDistNm(world.PORT.x, world.PORT.y, prevX, prevY, st.x, st.y) < DELIVERY_R_NM && st.codes.length > 0) {
    const pts = st.codes.reduce((a, c) => a + c.pts, 0);
    st.score += pts;
    const ids = st.codes.map((c) => c.id).join(", ");
    st.codes = [];
    ev(st, "delivery", `🏁 ${pts} points marqués ! Codes livrés : ${ids}. Score total : ${st.score}.`, "balises");
  }
}

// Avance rapide (debug serveur / sauts) : pas d'au plus 1 minute pour ne pas
// manquer les pulsations radio.
export function advance(st, minutes, world) {
  const endT = st.t + minutes;
  while (st.t < endT) tick(st, Math.min(1, endT - st.t), world);
}

// ---------- Vue du pont (calculée par le serveur, position vraie) ----------
// Retourne uniquement ce que le joueur voit : objets détectés avec distance
// et azimut (au-delà de l'horizon : indicateur de bord). Ne contient jamais
// la position vraie du navire — le client dessine autour de son estimé.
export function computeView(st, world) {
  const w = weatherAt(st.x, st.y, st.t, st.weatherSeed);
  const hour = (st.t / 60) % 24;
  const night = hour < 6 || hour >= 20;
  const canSee = st.location === "surface" || st.periscope;
  const visKm = w.visibility * KM_PER_NM;
  const HORIZON = 20; // km, horizon géographique depuis le pont
  const azTo = (x, y) => Math.round((Math.atan2(x - st.x, y - st.y) * 180) / Math.PI + 360) % 360;
  const kmOf = (x, y) => (distNm(st.x, st.y, x, y) / DEG_NM) * KM_PER_DEG;
  const det = (kind) => (canSee ? detectKm(kind, visKm, night) : -1);

  const islands = [];
  world.ISLANDS.forEach((i) => {
    const c = kmOf(i.x, i.y) - isleRadAt(i, Math.atan2(st.x - i.x, st.y - i.y)) * KM_PER_DEG;
    if (c <= det("ile")) islands.push({ verts: i.verts, km: c, az: azTo(i.x, i.y), beyond: c > HORIZON });
  });
  const outposts = [];
  world.OUTPOSTS.forEach((o, idx) => {
    const km = kmOf(o.x, o.y);
    if (km <= det("poste")) outposts.push({ idx, x: o.x, y: o.y, km, az: azTo(o.x, o.y), beyond: km > HORIZON });
  });
  const beacons = [];
  world.BEACONS.forEach((b) => {
    if (!b.active) return;
    const km = kmOf(b.x, b.y);
    if (km <= det("balise")) beacons.push({ id: b.id, rarity: b.rarity, x: b.x, y: b.y, km, az: azTo(b.x, b.y), beyond: km > HORIZON });
  });
  const portKm = kmOf(world.PORT.x, world.PORT.y);
  const port = portKm <= det("port") ? { km: portKm, az: azTo(world.PORT.x, world.PORT.y), beyond: portKm > HORIZON } : null;
  const contKm = distToLine(st.x, st.y, world.COAST) * KM_PER_DEG;
  const coast = contKm <= det("continent");

  const antHeading = (st.heading + st.antOrient + 720) % 360;
  return {
    night, canSee, visKm, horizonKm: HORIZON,
    islands, outposts, beacons, port, coast,
    continentVerts: coast ? world.CONTINENT.verts : null,
    antHeading,
    windDir: w.windDir, windSpd: w.windSpd,
  };
}
