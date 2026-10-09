// ============================================================
// PACIFIC CHASE — moteur de simulation partagé (client/serveur)
// Pures fonctions déterministes : aucun accès réseau, DOM ni fs.
// Référence : document de design v3 + proto Canvas React.
// Unités : 1 degré = 50 km (échelle fictive) ; cartes 60° = 3000 km de côté.
// ============================================================

export const MAP = 60; // degres
export const DEG_KM = 50; // 1° = 50 km -> carte 3000x3000 km (échelle fictive)
export const PULSE_MIN = 60; // pulsation radio horaire
export const CAPTURE_R_KM = 0.5;  // capture à 500 m
export const DELIVERY_R_KM = 0.5; // livraison à 500 m
export const WP_R_KM = 0.1;       // validation des points de passage : 100 m

// Vitesses et propulsion (équilibrage validé)
export const VMAX_KMH = 45;          // vitesse max de coque (km/h)
export const SAIL_SPD_KMH = 67;       // voile pleine à vent de référence (~40 km/h au largue par vent fort)
export const DIESEL_SPD_KMH = 30;     // moteur thermique
export const SCOPE_SPD_KMH = 15;      // électrique en périscope
export const SUB_SPD_KMH = 20;        // électrique en plongée (> périscope : voulu)
export const WIND_REF_KMH = 50;       // vent donnant la pleine puissance de voile
export const ACCEL_SURF = 11;         // inertie : km/h gagnés par minute de jeu (surface)
export const ACCEL_SUB = 4;           // idem en plongée
export const DECEL_SURF = 5.556;      // inertie : km/h perdus par minute (surface)
export const DECEL_SUB = 2.9632;      // idem en plongée

// Radio — taxonomie : deux familles de propagation (critère = cadence)
export const LONG_DECAY_KM = 1000;  // famille LONGUE : 0 % à 1000 km (pulsations, réponses, émissions de navire)
export const SHORT_DECAY_KM = 500; // famille COURTE : 0 % à 500 km (pulsations rapides : proximité)
export const RADIO_EDGE_MALUS = 0.2;    // malus de bord faisceau (réception)
export const RADIO_MIN_STRENGTH = 1;    // sous 1 % : silence radio total (écoute des stations)
export const OMNI_DETECT_PCT = 75;      // canal omni de réception : capte à ≥ 75 % (sans azimut)

// Balise-vigie — signal de proximité (famille courte)
export const PROX_PING_MAX_KM = 100;   // ancrage haut de la courbe d'accélération
export const PROX_PING_MAX_S = 30;     // intervalle à ≥ 100 km
export const PROX_PING_MIN_KM = 0.1;   // 100 m : ancrage bas
export const PROX_PING_MIN_S = 10;     // intervalle à ≤ 100 m
export const ANCHOR_DROP_KM = 0.05;    // 50 m : coupure du verrou + ancre automatique
export const SIGNAL_LOG_MAX = 10;       // journal : les 10 derniers pings de balise (longs et courts)
export const PROX_ARM_KM = SHORT_DECAY_KM * (1 - OMNI_DETECT_PCT / 100); // rayon de VEILLE émergent : armée ⇔ un navire à ≤ ~125 km (force omni 75 %)

// Monde et gameplay
export const ISLAND_SEP_KM = 200;         // séparation minimale entre îles
export const BEACON_MAX_TRIES = 200000;   // garde-fou placement balises
export const RES_WARN_PCT = 15;           // seuil alerte ressources
export const RES_WARN_RESET_PCT = 30;     // seuil réarmement alertes
export const CODE_POOL = 10000;           // pool codes radio (0000-9999)
export const MS_PER_MIN = 60000;          // millisecondes réelles par minute de jeu
export const WX_HORIZON_H = 48;           // horizon des prévisions météo (h) — port, avant-postes et NETWORK

// Autoguidage balise-vigie : quelles balises peuvent ENGAGER le verrou du
// pilote. Filtre à l'engagement uniquement — un verrou déjà engagé tient.
export const AUTOGUIDE_MODES = ["disabled", "active", "all"];
export const AUTOGUIDE_DEFAULT = "active"; // défaut : seules les balises non capturées verrouillent

// Navigation à l'estime — défauts d'instruments et courant (équilibrage validé)
export const COMP_DEV_MIN_DEG = 0.15;  // déviation de compas min (°)
export const COMP_DEV_MAX_DEG = 0.5;   // déviation de compas max (°)
export const LOG_ERR_MIN_PCT = 0.25;   // erreur de loch min (%)
export const LOG_ERR_MAX_PCT = 0.75;   // erreur de loch max (%)
export const CUR_SPD_MIN_KMH = 1.1;    // courant min (km/h)
export const CUR_SPD_MAX_KMH = 2.05;   // courant max (km/h)
export function randomCode() {
  return String(Math.floor(Math.random() * CODE_POOL)).padStart(4, "0");
}

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
export const distKm = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by) * DEG_KM;
export const bearingTo = (ax, ay, bx, by) =>
  ((Math.atan2(bx - ax, by - ay) * 180) / Math.PI + 360) % 360;
export const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
// Distance (km) d'un point P au segment [A,B] — évite de traverser une zone
// (capture, livraison) lors d'un grand pas de simulation.
export function segDistKm(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const wx = px - ax, wy = py - ay;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return distKm(px, py, ax, ay);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return distKm(px, py, bx, by);
  const t = c1 / c2;
  return distKm(px, py, ax + t * vx, ay + t * vy);
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

// ---------- Codes d'identification radio ----------
// Chaque système (balise ET navire) possède un code unique à 4 chiffres
// (0000-9999), comme un numéro de téléphone. Les balises tirent leurs codes
// à la création du monde (déterministe par graine), le navire au sien.
export function assignCodes(beacons, rng) {
  const used = new Set();
  const pick = () => {
    let c;
    do { c = String(Math.floor(rng() * CODE_POOL)).padStart(4, "0"); }
    while (used.has(c));
    used.add(c);
    return c;
  };
  for (const b of beacons) b.code = pick();
  return pick; // pour tirer ensuite le code du navire sans collision
}

// ---------- Raretés des balises ----------
export const RARITY_STYLE = {
  commune: { color: "#4ade80", pts: 1 },
  rare: { color: "#38bdf8", pts: 3 },
  legendaire: { color: "#facc15", pts: 8 },
  inconnue: { color: "#c084fc", pts: 5 },
};
export const RARITY_LABEL = { legendaire: "légendaire" };

// Contraintes de placement des balises (km) : port = distance min au port
// principal, outpost = distance min à un avant-poste, beacon = distance
// min à toute autre balise (le seuil le plus strict des deux s'applique).
export const RARITY_MIN = {
  commune: { port: 500, outpost: 200, beacon: 250 },
  rare: { port: 1000, outpost: 300, beacon: 300 },
  legendaire: { port: 1500, outpost: 350, beacon: 350 },
  inconnue: { port: 1000, outpost: 300, beacon: 250 },
};

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
    while (out.length < 10 && guard++ < 2000) {
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
        const score = out.length === 0 ? Infinity : Math.min(...out.map((i) => distKm(i.x, i.y, x, y)));
        if (score > bestScore) {
          bestScore = score;
          best = { x, y, r, verts: b.verts, radii: b.radii, maxR: Math.max(...b.radii.map((p) => p.rad)) };
        }
      }
      if (bestScore > ISLAND_SEP_KM) out.push(best); // séparation minimale entre îles
    }
    return out;
  })();

  OUTPOSTS = (() => {
    const out = [];
    const taken = [];
    const target = Math.min(5, ISLANDS.length);
    // Placement glouton « point le plus éloigné » : chaque nouvel
    // avant-poste est posé sur l'île qui maximise son écart minimal aux
    // avant-postes déjà placés (au port pour le premier → garantit une
    // île à l'opposé du continent). Objectif d'écart 2000 km (non
    // contraignant : à défaut, l'île la plus écartée, jamais du hasard).
    const score = (p) => (out.length === 0
      ? distKm(p.x, p.y, PORT.x, PORT.y)
      : Math.min(...out.map((o) => distKm(o.x, o.y, p.x, p.y))));
    while (out.length < target) {
      let bestIdx = -1, bestP = null, bestScore = -1;
      for (let k = 0; k < ISLANDS.length; k++) {
        if (taken.includes(k)) continue;
        const i = ISLANDS[k];
        const brg = rng() * Math.PI * 2;
        const rr = isleRadAt(i, brg);
        const p = { x: i.x + Math.sin(brg) * rr * 0.995, y: i.y + Math.cos(brg) * rr * 0.995 };
        const sc = score(p);
        if (sc > bestScore) { bestScore = sc; bestIdx = k; bestP = p; }
      }
      taken.push(bestIdx);
      out.push({ island: bestIdx, ...bestP });
    }
    return out;
  })();

  isLand = (x, y) =>
    (x >= CONTINENT.x0 - cAmp && x < CONTINENT.x1 + cAmp && y >= CONTINENT.y0 - cAmp && y < CONTINENT.y1 + cAmp && inPoly(x, y, CONTINENT.verts)) ||
    ISLANDS.some((i) => Math.hypot(i.x - x, i.y - y) < i.maxR && inPoly(x, y, i.verts));

  BEACONS = (() => {
    const out = [];
    // 40 balises : 20 communes, 10 rares, 5 légendaires, 5 inconnues.
    // Tirage aléatoire sur toute la carte ; si une condition échoue
    // (terre, distance au port, à un avant-poste ou à une autre balise),
    // une nouvelle position est tirée. Garde-fou : 200 000 essais.
    // Entre deux balises, le seuil le PLUS STRICT des deux s'applique
    // (une légendaire interdit 350 km à quiconque, même posée en premier).
    const counts = { commune: 20, rare: 10, legendaire: 5, inconnue: 5 };
    const minBcnOf = (r) => RARITY_MIN[r].beacon;
    for (const [rarity, n] of Object.entries(counts)) {
      const m = RARITY_MIN[rarity];
      const minPort = m.port, minOut = m.outpost, minBcn = m.beacon; // km
      for (let i = 0; i < n; i++) {
        let x = 0, y = 0, ok = false, tries = 0;
        while (tries++ < BEACON_MAX_TRIES && !ok) {
          x = 2 + rng() * 56;
          y = 2 + rng() * 56;
          ok = !isLand(x, y)
            && distKm(x, y, PORT.x, PORT.y) >= minPort
            && !OUTPOSTS.some((o) => distKm(x, y, o.x, o.y) < minOut)
            && !out.some((b) => distKm(x, y, b.x, b.y) < Math.max(minBcn, minBcnOf(b.rarity)));
        }
        out.push({ id: `${rarity[0]}${i}`, x, y, rarity, pts: RARITY_STYLE[rarity].pts, active: true, phase: Math.floor(rng() * PULSE_MIN) });
      }
    }
    return out;
  })();
  assignCodes(BEACONS, rng);

  return { seed, CONTINENT, PORT, ISLANDS, OUTPOSTS, BEACONS, COAST, isLand };
}

// ---------- Météo ----------
export const ARCHETYPES = [
  { name: "Soleil calme", clouds: 10, wind: 11.1, rain: 0, vis: 25, temp: 4, storm: false, fog: false },
  { name: "Brouillard", clouds: 55, wind: 5.6, rain: 0, vis: 0.6, temp: 1, storm: false, fog: true },
  { name: "Soleil venteux", clouds: 20, wind: 37.0, rain: 0, vis: 20, temp: 2, storm: false, fog: false },
  { name: "Nuageux", clouds: 70, wind: 22.2, rain: 0, vis: 12, temp: 0, storm: false, fog: false },
  { name: "Nuageux pluie faible", clouds: 85, wind: 29.6, rain: 35, vis: 8, temp: -2, storm: false, fog: false },
  { name: "Pluie forte", clouds: 95, wind: 48.2, rain: 80, vis: 4, temp: -3, storm: false, fog: false },
  { name: "Orage", clouds: 98, wind: 81.5, rain: 100, vis: 1.5, temp: -5, storm: true, fog: true },
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
  const curSpd = CUR_SPD_MIN_KMH + Math.abs(Math.sin(x * 0.3 + y * 0.2)) * (CUR_SPD_MAX_KMH - CUR_SPD_MIN_KMH); // 1,1 à 2,05 km/h
  const u = windSpd / 3.6; // vent en m/s
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

// ---------- Voile (inclinaison automatique) ----------
// Déploiement (st.sail : fraction de voile dressée) : MANUEL, commande joueur.
// Inclinaison (boom/écoute) : AUTOMATIQUE — modèle « vent apparent + incidence »,
// l'équipage règle l'écoute en continu ; la stratégie se joue au placement
// (cap vs vent) et au volume de toile.
// Zéro notion de force : de la géométrie + une courbe de rendement.
// Courbe de rendement de la toile selon l'incidence (angle entre le vent
// apparent et la toile) : fasée sous 5°, bosse max vers 30°, puis
// décrochage progressif (la toile travaille « en sac ») jusqu'à 90°.
export const SAIL_EFF_CURVE = [[5, 0], [15, 0.6], [30, 1], [50, 0.9], [70, 1.0], [90, 1.05]];
export const SAIL_FURL_DEG = 5;        // incidence minimale : voile fasée en dessous
export const STORM_SAIL_MAX = 0.3;     // rendement de voile en tempête (voilure réduite)
export const WIND_FACTOR_CAP = 1.1;    // cap du facteur de vent apparent (survent)

export function sailEff(a) {
  const C = SAIL_EFF_CURVE;
  if (a < C[0][0]) return 0;
  for (let i = 0; i < C.length - 1; i++) {
    const [a0, f0] = C[i];
    const [a1, f1] = C[i + 1];
    if (a >= a0 && a <= a1) return f0 + ((a - a0) / (a1 - a0)) * (f1 - f0);
  }
  return C[C.length - 1][1];
}

// Vent apparent au navire : géométrie pure (vent vrai − vitesse du navire).
// Retourne { aw, g, side } : vitesse apparente (km/h), écart à la proue
// g ∈ [0,180] (0 = vent debout, 180 = vent arrière), côté ("B"|"T").
export function apparentWind(st, w) {
  const capT = ((st.heading + (st.compDev || 0)) * Math.PI) / 180;
  const toRad = ((w.windDir + 180) * Math.PI) / 180; // direction VERS laquelle souffle le vent
  // flux du vent dans le repère du navire (x = proue, y = tribord)
  const fx = w.windSpd * Math.cos(toRad - capT) - st.vkmh;
  const fy = w.windSpd * Math.sin(toRad - capT);
  const aw = Math.hypot(fx, fy);
  const g = (Math.acos(clamp(-fx / (aw || 1), -1, 1)) * 180) / Math.PI;
  const side = fy > 0 ? "B" : "T"; // flux vers tribord = vent venant de bâbord
  return { aw, g, side };
}

// Poussée de voile (rendement 0..~1.1) à l'écoute AUTOMATIQUE optimale.
// Met à jour st.boom (angle d'écoute signé, + = choqué à tribord),
// st.awSpd et st.awRel (vent apparent pour l'UI). Retourne { drive, aw }.
export function sailAutoDrive(st, w) {
  const { aw, g, side } = apparentWind(st, w);
  const dev = Math.min(g, 180 - g); // écart de la ligne de vent à l'axe du navire
  let best = 0, boom = 0;
  for (let beta = 0; beta <= 90; beta += 0.5) {
    const a = Math.abs(dev - beta);
    if (a < SAIL_FURL_DEG) continue; // voile fasée
    const sign = g >= beta ? 1 : -1; // vent devant la toile : poussée à contrevent
    const d = sign * sailEff(a) * Math.sin((beta * Math.PI) / 180);
    if (d > best) { best = d; boom = beta; }
  }
  if (w.storm) best *= STORM_SAIL_MAX; // voilure réduite en tempête
  st.boom = (side === "B" ? 1 : -1) * boom; // écoute choquée sous le vent
  st.awSpd = Math.round(aw * 10) / 10;
  st.awRel = side === "T" ? Math.round(g) : -Math.round(g);
  return { drive: best, aw };
}

// ---------- Détection entre navires (multijoueur) ----------
// Portée de détection de la COQUE d'un navire selon son état (km). Le navire
// observateur doit lui-même être en surface ou au périscope pour voir.
// - surface, mât rétracté : 12 km le jour, 1 km la nuit
// - surface, mât étendu : 18 km le jour, 3 km la nuit
// - surface, phare allumé : 10 km la nuit (le phare ne se voit pas le jour)
// - immersion, périscope sorti : 2 km le jour, 1 km la nuit
// - immersion, périscope rentré : invisible
export const SHIP_VIS_LIGHT = 10;
export function shipVisibleKm(target, night) {
  if (target.location === "underwater") {
    if (!target.periscope) return 0; // plongée profonde : invisible
    return night ? 1 : 2;
  }
  let km = target.mast ? (night ? 3 : 18) : (night ? 1 : 12);
  if (night && target.light) km = Math.max(km, SHIP_VIS_LIGHT);
  return km;
}
// ---------- Dimensions du navire et collision précise ----------
// Coque : 15 m de long, 5 m de large. Collision = rectangles orientés
// (OBB) qui s'intersectent (SAT) — précis au mètre, pas un simple rayon.
export const SHIP_LEN_KM = 0.015; // coque : 15 m
export const SHIP_WID_KM = 0.005; // largeur : 5 m
// Vrai test d'intersection entre les deux coques orientées (deg units).
// SAT sur les 4 axes (2 par rectangle).
export function shipsCollide(ax, ay, aHead, bx, by, bHead) {
  const ha = SHIP_LEN_KM / 2 / DEG_KM; // demi-longueur en degres
  const wa = SHIP_WID_KM / 2 / DEG_KM;
  const dx = bx - ax, dy = by - ay;
  // pré-écart rapide : si les centres sont à plus d'une diagonale, pas de contact
  if (dx * dx + dy * dy > (2 * ha) * (2 * ha) * 1.2) return false;
  const axes = [];
  for (const h of [aHead, bHead]) {
    const r = (h * Math.PI) / 180;
    axes.push([Math.sin(r), Math.cos(r)]); // axe longitudinal
    axes.push([Math.cos(r), -Math.sin(r)]); // axe transversal
  }
  const corners = (x, y, h) => {
    const r = (h * Math.PI) / 180;
    const lx = Math.sin(r) * ha, ly = Math.cos(r) * ha;
    const wx = Math.cos(r) * wa, wy = -Math.sin(r) * wa;
    return [
      [x + lx + wx, y + ly + wy], [x + lx - wx, y + ly - wy],
      [x - lx + wx, y - ly + wy], [x - lx - wx, y - ly - wy],
    ];
  };
  const ca = corners(ax, ay, aHead), cb = corners(bx, by, bHead);
  for (const [ux, uy] of axes) {
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const [cx, cy] of ca) {
      const d = cx * ux + cy * uy;
      aMin = Math.min(aMin, d); aMax = Math.max(aMax, d);
    }
    for (const [cx, cy] of cb) {
      const d = cx * ux + cy * uy;
      bMin = Math.min(bMin, d); bMax = Math.max(bMax, d);
    }
    if (aMax < bMin || bMax < aMin) return false; // axe séparant trouvé
  }
  return true;
}
// Position de spawn d'un navire au port — ROBUSTE : la côte étant ondulée
// (caps, baies), aucun offset fixe n'est fiable. On scanne une spirale
// autour du port par distance croissante et on retient le PREMIER candidat
// valide : en pleine eau (pas terre, pas île), à >= 50 m de la côte, à
// >= 50 m de tout navire déjà placé (taken), de préférence dans la zone
// d'accostage de 500 m. `taken` accumule les positions posées — l'appelant
// fournit la liste (elle est modifiée en place).
export function spawnPosition(world, taken = []) {
  const PORT = world.PORT;
  const okSpot = (x, y) =>
    !world.isLand(x, y) &&
    distToLine(x, y, world.COAST) * DEG_KM >= 0.05 &&
    taken.every((t) => Math.hypot(t.x - x, t.y - y) * DEG_KM >= 0.05);
  const candidate = (x, y) => {
    if (!okSpot(x, y)) return null;
    const pos = { x, y };
    taken.push(pos);
    return pos;
  };
  // spirale : rayon croissant, tous les 10° — ordre = proximité au port,
  // donc les navires se placent naturellement au plus près du quai.
  for (let r = 0.06; r <= 5; r += 0.04) { // rayon en km, du quai jusqu'à 5 km
    const rd = r / DEG_KM;
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const x = PORT.x + Math.sin(rad) * rd;
      const y = PORT.y + Math.cos(rad) * rd;
      const pos = candidate(x, y);
      if (pos) return pos;
    }
  }
  // ne devrait jamais arriver (océan 60x60°) : dernier recours au large
  const fallback = { x: PORT.x, y: PORT.y + 2 };
  taken.push(fallback);
  return fallback;
}

// ---------- Radio ----------
// PRINCIPE D'AFFICHAGE : une position se révèle en clair (coordonnées que
// l'émetteur met lui-même dans son message) ou en gisement (le faisceau du
// récepteur, zone D1/D2/G1/G2/centre) — jamais en azimut imprimé. Exception
// interne assumée : le scan du verrou balise-vigie (onProximityPing) utilise
// l'azimut vrai en interne, sans jamais l'afficher.
// Force d'un signal à la distance dKm pour une famille de décroissance donnée.
export const strengthKm = (dKm, decayKm) => Math.max(0, Math.round(100 * (1 - dKm / decayKm)));
export const longStrengthKm = (dKm) => strengthKm(dKm, LONG_DECAY_KM);
export const shortStrengthKm = (dKm) => strengthKm(dKm, SHORT_DECAY_KM);
export const dirSensitivity = (antBeam) => 1 + ((antBeam - 1) / 179) * 49;
export function dirEffSensitivity(antBeam, diff, sens) {
  const ratio = clamp(diff / (antBeam / 2), 0, 1);
  return 100 - (100 - sens) * (1 - RADIO_EDGE_MALUS * ratio);
}

// Réception — LOI UNIQUE (« lire exige capter ») :
// - canal omni : force ≥ OMNI_DETECT_PCT → existence + force, sans gisement ;
// - canal directionnel : force ≥ sens(faisceau), dans le faisceau, malus de
//   bord → gisement (zone du faisceau du récepteur). Le directionnel l'emporte.
// Les champs bearing/beam restent dans les objets de capture (usage interne,
// ex. verrou) — ils ne sont jamais imprimés dans les textes.
export function recvCapture(st, brg, strength) {
  let got = null;
  if (strength >= OMNI_DETECT_PCT) got = { bearing: null, strength, source: "omni" };
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
    got = { bearing: Math.round(antHeading), beam: st.antBeam, side, strength, source: "dir" };
  }
  return got;
}

// Détection d'une émission de balise (family = décroissance : LONG_DECAY_KM
// pour la pulsation horaire, SHORT_DECAY_KM pour le signal de proximité).
export function detectBeacon(st, b, world, family = LONG_DECAY_KM) {
  const dKm = distKm(st.x, st.y, b.x, b.y);
  const strength = strengthKm(dKm, family);
  const brg = bearingTo(st.x, st.y, b.x, b.y);
  const cap = recvCapture(st, brg, strength);
  return cap ? { t: st.t, beaconId: b.code, ...cap } : null;
}

// Émission — LOI UNIVERSELLE : toute émission de navire (appels, messages,
// SOS) est OMNIDIRECTIONNELLE, famille longue (1000 km). L'antenne
// directionnelle ne sert qu'à l'écoute. Les balises-stations écoutent tout
// message de force ≥ 1 % (≤ ~995 km) ; la balise composée répond en privé,
// famille longue — réponse soumise à la loi de réception de l'appelant :
// au-delà de ~250 km sans faisceau pointé, l'appelant ne capte pas la réponse.
export const CALL_BATTERY_COST = 0.5;
// Traite un appel « Position ? » vers le code composé. Le silence (mauvais
// numéro, hors faisceau, hors de portée, réponse inaudible) EST
// l'information : aucune notification d'échec. Coût : 0,5 % de batteries.
// Traite un appel « Position ? » vers le code composé. Retourne la balise
// répondue ({ x, y } de la balise — capturée ou non, la station répond
// toujours) pour que l'appelant du moteur puisse ÉMETTRE la réponse sur les
// ondes (tiers brouillés) — ou null (silence, mauvais numéro, hors de
// portée). Le contenu privé reste inchangé.
export function callPosition(st, code, world, noCost = false) {
  const radioOk = (st.location === "surface" || (st.location === "underwater" && st.periscope)) && st.battery > 0;
  if (!radioOk) return null;
  if (!noCost) st.battery = Math.max(0, st.battery - CALL_BATTERY_COST);
  const target = world.BEACONS.find((b) => b.code === code); // capturée ou non : la station répond toujours
  if (!target) return null;
  const dKm = distKm(st.x, st.y, target.x, target.y);
  const brg = bearingTo(st.x, st.y, target.x, target.y);
  const strength = longStrengthKm(dKm);           // émission navire : omni, longue
  if (strength < RADIO_MIN_STRENGTH) return null; // la station n'entend pas : silence
  const respStrength = longStrengthKm(dKm);        // réponse : famille longue
  const cap = recvCapture(st, brg, respStrength);  // lire exige capter
  if (cap) {
    st.notifSeq = (st.notifSeq || 0) + 1;
    if (st.pins.length < 26)
      st.pins.push({ label: code, x: target.x, y: target.y });
    st.notifications.unshift({
      id: st.notifSeq, t: st.t,
      text: `📡 Position de ${code} : ${target.y.toFixed(2)}°N ${target.x.toFixed(2)}°E (signal ${respStrength}%).`,
      kind: "good", cat: "radio",
    });
  }
  // La balise a entendu : elle répond SUR LES ONDES (tiers brouillés côté
  // serveur). Le silence pour l'appelant EST l'information.
  return { x: target.x, y: target.y };
}
// Brouillage : un tiers qui capte un message sans en être le destinataire
// détecte une TRANSMISSION BROUILLÉE — force, et zone du faisceau en
// directionnel — mais AUCUN contenu et AUCUN azimut : la direction, c'est le
// geste du joueur (pointer son antenne), pas une donnée du message.
export function scrambledIntercept(strength, source, side) {
  if (source === "dir") {
    return { text: `📡 Transmission brouillée captée (directionnelle) — signal ${strength}%, zone ${side}. Contenu : illisible.`, cat: "radio" };
  }
  return { text: `📡 Transmission brouillée captée (omnidirectionnelle) — signal ${strength}%. Contenu : illisible, origine inconnue.`, cat: "radio" };
}

// ---------- Sonar ----------
// DEUX CANAUX, une seule tuile :
// - ÉCOUTE PASSIVE (hydrophone) : continue, gratuite, en surface comme en
//   plongée. GISEMENT SEUL, aucune distance : icône au bord du cercle. Force
//   UNIFORME pour tous les bruits : 100 % -> 0 % sur SOUND_DECAY_KM.
//   Catalogue v1 : moteur diesel d'un navire en surface ; ping actif d'un
//   autre navire (événement). (Bête et warship : plus tard, même mécanique.)
// - PING ACTIF : UN clic = UN ping (pas de mode continu), plongée uniquement,
//   SONAR_PING_BATTERY_COST % de batterie. Tout ce qui traîne dans
//   SONAR_RANGE_KM rebondit : îles, côte, balises (capturées ou non),
//   navires EN SURFACE. Un navire IMMERGÉ est totalement invisible (et
//   silencieux : il ne se trahit que s'il ping lui-même).
// Les signaux se déplacent à la vitesse du son dans l'eau : bruits et échos
// arrivent avec leur vrai retard (aller-retour 200 km ≈ 4,4 min).
// Un écho/ping entendu s'affiche SONAR_ECHO_PERSIST_S secondes.
export const SOUND_KMH = 5400;            // vitesse du son dans l'eau ≈ 1500 m/s
export const SOUND_DECAY_KM = 500;        // bruits : force uniforme, 0 % à 500 km
export const SONAR_RANGE_KM = 200;        // portée du ping actif
export const SONAR_PING_BATTERY_COST = 1; // % de batterie par ping
export const SONAR_ECHO_PERSIST_S = 10;   // affichage d'un écho/ping entendu (s)

// Retard de propagation : minutes de jeu pour que le son parcoure dKm.
export const soundTravelMin = (dKm) => dKm / (SOUND_KMH / 60);

// Un navire fait du BRUIT (hydrophone des tiers) si son moteur diesel
// tourne en surface. Voile, électrique, ancre : silencieux.
export function shipNoisy(st) {
  return st.location === "surface" && st.engineOn && st.fuel > 0;
}

// Point le plus proche sur une polyligne (réflexion de la côte au ping).
export function nearestOnLine(px, py, pts) {
  let best = [pts[0][0], pts[0][1]], bd = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const ax = pts[k][0], ay = pts[k][1], bx = pts[k + 1][0], by = pts[k + 1][1];
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    const qx = ax + t * dx, qy = ay + t * dy;
    const d = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d < bd) { bd = d; best = [qx, qy]; }
  }
  return best;
}

// Écoute passive d'une source : GISEMENT + FORCE seulement (aucune distance).
// `srcX/srcY` = position de la source AU MOMENT DE L'ÉMISSION : le retard de
// propagation est appliqué PAR L'APPELANT (le serveur tient l'historique).
export function sonarPassiveHear(listenerSt, srcX, srcY) {
  const dKm = distKm(listenerSt.x, listenerSt.y, srcX, srcY);
  const strength = strengthKm(dKm, SOUND_DECAY_KM);
  if (strength <= 0) return null;
  return { bearing: Math.round(bearingTo(listenerSt.x, listenerSt.y, srcX, srcY)), strength };
}

// Ping actif : plongée uniquement, coût SONAR_PING_BATTERY_COST.
// Retourne { ok: false, error } ou { ok: true, echoes }. Chaque écho :
// { kind: "ile"|"cote"|"balise"|"navire", x, y, dKm, az, arriveMin } —
// az/dKm FIGÉS au moment du ping ; arriveMin = retour de l'écho
// (minutes de jeu : t + 2 × retard du son). Le serveur n'expose JAMAIS
// x/y au client (azimut + distance seulement).
export function sonarPing(st, world, others = []) {
  if (st.location !== "underwater")
    return { ok: false, error: "Sonar actif disponible en plongée uniquement." };
  if (st.battery < SONAR_PING_BATTERY_COST)
    return { ok: false, error: "Batteries insuffisantes (1 % par ping)." };
  st.battery = Math.max(0, st.battery - SONAR_PING_BATTERY_COST);
  const echoes = [];
  const push = (kind, x, y) => {
    const dKm = distKm(st.x, st.y, x, y);
    if (dKm > SONAR_RANGE_KM || dKm <= 0) return;
    echoes.push({
      kind, x, y, dKm,
      az: Math.round(bearingTo(st.x, st.y, x, y)),
      arriveMin: st.t + 2 * soundTravelMin(dKm),
    });
  };
  for (const i of world.ISLANDS) push("ile", i.x, i.y);
  for (const b of world.BEACONS) push("balise", b.x, b.y); // capturée ou non : l'objet existe
  const coast = nearestOnLine(st.x, st.y, world.COAST);
  push("cote", coast[0], coast[1]);
  for (const o of others) {
    if (o.location !== "surface") continue; // navire immergé : invisible au sonar actif
    push("navire", o.x, o.y);
  }
  return { ok: true, echoes };
}

// ---------- Balise-vigie : signal de proximité + verrou + ancre ----------
// Intervalle du ping de proximité : accélération progressive, géométrique par
// décade — 30 s à ≥ 100 km, 10 s à ≤ 100 m (~21 s à 10 km, ~14 s à 1 km).
export function proxPingIntervalS(dKm) {
  const d = Math.min(Math.max(dKm, PROX_PING_MIN_KM), PROX_PING_MAX_KM);
  const decades = Math.log10(d / PROX_PING_MIN_KM) / Math.log10(PROX_PING_MAX_KM / PROX_PING_MIN_KM);
  return PROX_PING_MIN_S * Math.pow(PROX_PING_MAX_S / PROX_PING_MIN_S, decades);
}

// Journal des signaux de balise : les SIGNAL_LOG_MAX derniers pings (longs et courts).
export function pushBeaconSignal(st, sig) {
  st.signals.push(sig);
  if (st.signals.length > SIGNAL_LOG_MAX)
    st.signals.splice(0, st.signals.length - SIGNAL_LOG_MAX);
  return sig;
}

// Réception d'un ping de proximité capté : journal SYSTÉMATIQUE + verrou de
// l'ordinateur de bord. À CHAQUE ping capté, l'ordinateur re-scanne : antenne
// sur la source, cap sur la source (poursuite d'azimut radio — immune à la
// déviation de compas ; le courant continue de pousser, corrigé au ping
// suivant). Deux gardes :
// - ANTI-BASCULE : le premier verrou tient jusqu'au bout — les pings d'une
//   AUTRE balise sont journalisés mais ignorés par le verrou (cas limite :
//   deux balises dans le rayon de veille, navire entre les deux) ;
// - SIGNAL FORT : l'ordinateur ne verrouille que sur un signal de niveau omni
//   (force ≥ OMNI_DETECT_PCT : navire à ≤ rayon de veille ~125 km). Une
//   capture directionnelle faible (balise armée par un concurrent, au loin
//   dans le faisceau) = journal seul — le pilote n'est jamais happé.
export function onProximityPing(st, b, cap) {
  pushBeaconSignal(st, { t: st.t, beaconId: b.code, kind: "prox", off: !b.active, ...cap });
  if (st.beaconLock && st.beaconLock !== b.code) return; // anti-bascule
  if (!st.beaconLock) {
    if (cap.strength < OMNI_DETECT_PCT) return; // signal faible : journal seul
    if (st.anchored) return; // ancre déployée : le guidage automatique ne s'engage pas (journal seul)
    // AUTOGUIDAGE (3 positions) : filtre AU MOMENT DE L'ENGAGEMENT
    // uniquement — un verrou déjà engagé tient jusqu'au bout, même si
    // l'interrupteur change ou si la balise est capturée en cours de poursuite.
    const mode = st.autoguide || AUTOGUIDE_DEFAULT;
    if (mode !== "all" && (mode === "active") !== b.active) return; // hors mode : journal seul
  }
  const brg = Math.round(bearingTo(st.x, st.y, b.x, b.y));
  const engaged = !st.beaconLock;
  st.beaconLock = b.code;
  st.lockBrg = brg;
  st.antOrient = Math.round(((brg - st.heading + 540) % 360) - 180); // antenne sur la source
  st.headingOrder = brg; // poursuite
  if (engaged) {
    st.autopilot = false; // UN SEUL pilote à la fois : le verrou coupe le pilote de route (waypoints conservés)
    st.notifSeq = (st.notifSeq || 0) + 1;
    st.notifications.unshift({ id: st.notifSeq, t: st.t, kind: "good", cat: "radio",
      text: `🔒 Signal de proximité de ${b.code} — pilote automatique verrouillé sur la balise.` });
  }
}

// Poursuite CONTINUE : à chaque tick, l'ordinateur remet cap et antenne sur la
// balise verrouillée (position VRAIE — exception assumée du scan du verrou,
// jamais affichée). La poursuite ne dépend plus de la cadence des pings :
// elle tient aussi pendant les sauts de temps (pings au rythme temps réel).
export function beaconLockSteer(st, world) {
  if (!st.beaconLock) return;
  const b = world.BEACONS.find((x) => x.code === st.beaconLock); // capturée ou non : le verrou tient
  if (!b) { st.beaconLock = null; st.lockBrg = null; return; }
  st.lockBrg = Math.round(bearingTo(st.x, st.y, b.x, b.y));
  st.antOrient = Math.round(((st.lockBrg - st.heading + 540) % 360) - 180); // antenne sur la source
  st.headingOrder = st.lockBrg; // poursuite
}

// Arrivée : ancre automatique quand le navire touche le cercle d'ancre — soit
// à sa position (temps réel : pas d'1 s), soit parce que le SEGMENT de
// déplacement du pas l'a traversé (saut de temps : MAX_STEP_MIN = 5 min ≈ 3 km
// de corde à 40 km/h). Dans le second cas, le navire S'ARRÊTE au point du
// segment le plus proche de la balise (à l'intérieur du cercle) au lieu de
// filer 3 km plus loin.
export function beaconLockTick(st, world, prevX = st.x, prevY = st.y) {
  if (!st.beaconLock) return;
  const b = world.BEACONS.find((x) => x.code === st.beaconLock); // capturée ou non : le verrou tient
  if (!b) { st.beaconLock = null; st.lockBrg = null; return; }
  let dKm = distKm(st.x, st.y, b.x, b.y);
  if (dKm > ANCHOR_DROP_KM && segDistKm(b.x, b.y, prevX, prevY, st.x, st.y) <= ANCHOR_DROP_KM) {
    const dx = st.x - prevX, dy = st.y - prevY;
    const len2 = dx * dx + dy * dy;
    if (len2 > 0) {
      const t = Math.max(0, Math.min(1, ((b.x - prevX) * dx + (b.y - prevY) * dy) / len2));
      st.x = prevX + dx * t; // arrêt au point de passage le plus proche (≤ ANCHOR_DROP_KM)
      st.y = prevY + dy * t;
      dKm = distKm(st.x, st.y, b.x, b.y);
    }
  }
  if (dKm <= ANCHOR_DROP_KM) {
    st.beaconLock = null;
    st.lockBrg = null;
    st.headingOrder = st.heading; // barre arrêtée
    st.anchored = true;            // ancre automatique : position figée
    st.notifSeq = (st.notifSeq || 0) + 1;
    st.notifications.unshift({ id: st.notifSeq, t: st.t, kind: "good", cat: "navire",
      text: `⚓ Ancre jetée à ${Math.round(dKm * 1000)} m de la balise ${b.code} — pilote automatique coupé. Capture quand tu veux.` });
  }
}

// Capture MANUELLE d'une balise : action du joueur, à portée CAPTURE_R_KM.
export function captureBeacon(st, world) {
  const b = world.BEACONS.find((x) => x.active && distKm(st.x, st.y, x.x, x.y) <= CAPTURE_R_KM);
  if (!b) return { ok: false, error: "Aucune balise à portée de capture (500 m)." };
  b.active = false;
  st.codes.push({ id: b.id, rarity: b.rarity, pts: b.pts });
  st.notifSeq = (st.notifSeq || 0) + 1;
  st.notifications.unshift({ id: st.notifSeq, t: st.t,
    text: `📦 Code de la balise ${b.id} (${RARITY_LABEL[b.rarity] || b.rarity}, ${b.pts} pts) enregistré. Balise désactivée.`,
    kind: "good", cat: "balises" });
  if (st.beaconLock === b.code) { st.beaconLock = null; st.lockBrg = null; }
  return { ok: true, code: b.code };
}

// ---------- État du joueur ----------
// tMin : minutes de jeu écoulées depuis le départ de la course (référence
// partagée par tous les joueurs — même horloge de course).
export function newPlayerState(world, opts = {}) {
  const sp = spawnPosition(world, opts.takenSpawns || []);
  const sx = sp.x;
  const eastCoast = world.CONTINENT.x1 <= MAP / 2;
  return {
    t: 0, x: sp.x, y: sp.y, heading: eastCoast ? 90 : 270, headingOrder: eastCoast ? 90 : 270,
    sail: 0.8, engine: 0.8,
    estX: sp.x, estY: sp.y, unc: 0,
    navFix: { active: false, startT: 0, doneNight: null, lastTryT: null },
    location: "surface", mast: false, engineOn: false, electricOn: false, periscope: false, vkmh: 0, light: false,
    boom: 0, awSpd: 0, awRel: 0,
    beaconLock: null, lockBrg: null, anchored: true, // ancre jetée au départ (navire à quai)
    autoguide: AUTOGUIDE_DEFAULT, networked: false,
    fuel: 100, battery: 100, food: 100, score: 0, codes: [],
    waypoints: [], wpIdx: 0, autopilot: false,
    antBeam: 45, antOrient: 0, signals: [], notifications: [], notifSeq: 0,
    grounded: false, wasStorm: false, warnedFood: false, warnedFuel: false, warnedBatt: false,
    ffEvents: [], travelledKm: 0, dailyKm: 0, dayIdx: 0,
    weatherSeed: opts.weatherSeed ?? Math.floor(Math.random() * 1000), weatherName: null,
    code: opts.shipCode ?? randomCode(),
    sawIsland: false, sawBeaconId: null, sawPort: false, sawCont: false, sawOutpostIds: [], pins: [], measures: [],
    seaDouglas: null,
    // Défauts d'instruments fixes pour toute la course, inconnus du navigateur
    compDev: (COMP_DEV_MIN_DEG + Math.random() * (COMP_DEV_MAX_DEG - COMP_DEV_MIN_DEG)) * (Math.random() < 0.5 ? -1 : 1),
    logErr: (LOG_ERR_MIN_PCT + Math.random() * (LOG_ERR_MAX_PCT - LOG_ERR_MIN_PCT)) * (Math.random() < 0.5 ? -1 : 1),
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

function speedKmh(st, w) {
  let v = 0;
  if (st.location === "surface") {
    if (st.mast) {
      const { drive, aw } = sailAutoDrive(st, w);
      const wf = clamp(aw / WIND_REF_KMH, 0, WIND_FACTOR_CAP); // facteur de VENT APPARENT
      v += SAIL_SPD_KMH * wf * drive * st.sail; // st.sail = fraction de voile déployée (commande joueur)
    }
    if (st.engineOn && st.fuel > 0) v += DIESEL_SPD_KMH * st.engine;
    v = Math.min(v, VMAX_KMH);
  } else {
    if (st.electricOn && st.battery > 0) v += (st.periscope ? SCOPE_SPD_KMH : SUB_SPD_KMH) * st.engine;
  }
  return v;
}

// Un tick = dtMin minutes de jeu. Le monde (balises) est partagé entre
// joueurs : toute capture par un joueur désactive la balise pour tous —
// désactivée, elle continue d'exister et d'émettre (« ping désactivé »).
export function tick(st, dtMin, world) {
  // Positions AVANT tout mouvement (giration sous-pas incluse) : la
  // validation des points et la capture des balises font leur détection
  // point-segment sur ces traces complètes.
  const prevX = st.x, prevY = st.y, prevEstX = st.estX, prevEstY = st.estY;
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

  // Pilote automatique : la consigne est RECALCULÉE à chaque tick depuis
  // la position ESTIMÉE (même repère que la validation) — l'auto-correction
  // est gratuite : tout recentrage de l'estime (point aux étoiles) est pris
  // en compte au tick suivant. Le pilote n'est qu'un écrivain de consigne.
  // UN SEUL PILOTE À LA FOIS : si le verrou balise-vigie tient la barre, le
  // pilote de route n'écrit rien (il est coupé à l'engagement du verrou ;
  // garde ceinture+bretelles pour les états migrés à chaud).
  if (st.autopilot && !st.beaconLock && st.wpIdx < st.waypoints.length) {
    const wp = st.waypoints[st.wpIdx];
    st.headingOrder = bearingTo(st.estX, st.estY, wp.x, wp.y);
  }
  // Balise-vigie : poursuite CONTINUE — à chaque tick, l'ordinateur remet cap
  // et antenne sur la balise verrouillée (position VRAIE : exception assumée
  // du scan du verrou, jamais affichée). La poursuite ne dépend plus de la
  // cadence des pings — elle tient aussi pendant les sauts de temps.
  beaconLockSteer(st, world);
  // Giration : le navire converge de son cap réel (heading) vers la
  // CONSIGNE (headingOrder) à un taux borné. À pleine vitesse en surface,
  // 270 °/min : un virage de 90° prend ~20 s de jeu. À l'arrêt, une part de
  // la giration reste disponible (barre/hélice) — un navire échoué ou en
  // collision (vkmh = 0) peut toujours virer pour se dégager.
  const surface = st.location === "surface";
  {
    const order = st.headingOrder ?? st.heading; // migration des états anciens
    const TURN_MAX = surface ? 270 : 90;              // °/min
    const STEER_AT_REST = surface ? 0.25 : 0.15;
    const vRef = surface ? VMAX_KMH : SCOPE_SPD_KMH;
    const rate = TURN_MAX * (STEER_AT_REST + (1 - STEER_AT_REST) * clamp(st.vkmh / vRef, 0, 1));
    // SOUS-DÉCOUPAGE : à haut taux, un grand pas de rattrapage ne doit pas
    // intégrer 1350° d'un coup. Tant que la rotation restante du pas dépasse
    // 45°, on avance par sous-pas (~10 s de jeu), en intégrant la POSITION
    // physique (cap + courant) à chaque sous-pas — trajectoire d'arc fidèle,
    // collisions OBB fondées sur le cap réel en giration. En temps réel
    // (tick 1 s → 4,5°), ce mécanisme reste inactif.
    const integratePos = (minutes) => {
      const rT = ((st.heading + st.compDev) * Math.PI) / 180;
      const cdr = (w.curDir * Math.PI) / 180;
      const rad = (st.heading * Math.PI) / 180; // cap affiché (estime)
      const moored = surface &&
        (distKm(st.x, st.y, world.PORT.x, world.PORT.y) < DELIVERY_R_KM ||
         world.OUTPOSTS.some((o) => distKm(st.x, st.y, o.x, o.y) < DELIVERY_R_KM));
      st.x += Math.sin(rT) * (st.vkmh / 60 / DEG_KM) * minutes * (1 + st.logErr / 100)
            + (moored ? 0 : Math.sin(cdr) * (w.curSpd / 60 / DEG_KM) * minutes);
      st.y += Math.cos(rT) * (st.vkmh / 60 / DEG_KM) * minutes * (1 + st.logErr / 100)
            + (moored ? 0 : Math.cos(cdr) * (w.curSpd / 60 / DEG_KM) * minutes);
      // estime : même convention que le bloc mouvement (cap affiché, sans
      // logErr, sans courant) — l'estime doit couvrir les sous-pas aussi
      st.estX += Math.sin(rad) * (st.vkmh / 60 / DEG_KM) * minutes;
      st.estY += Math.cos(rad) * (st.vkmh / 60 / DEG_KM) * minutes;
    };
    let remaining = dtMin;
    let integrated = 0; // temps de position déjà intégré (sous-pas)
    while (remaining > 1e-9) {
      const diff = angDiff(order, st.heading);
      const rateDeg = rate * remaining;
      if (Math.abs(diff) <= rateDeg) {
        // le pas suffit à finir la giration : rotation résiduelle exacte
        st.heading = ((st.heading + diff) % 360 + 360) % 360;
        remaining = 0;
      } else {
        // rotation bornée au taux, puis intégration de position du sous-pas
        const subMin = Math.min(remaining, Math.max(45 / rate, remaining / 4));
        const step = Math.sign(diff) * rate * subMin;
        st.heading = ((st.heading + step) % 360 + 360) % 360;
        integratePos(subMin);
        integrated += subMin;
        remaining -= subMin;
      }
    }
    st.headingOrder = ((order % 360) + 360) % 360;
    dtMin -= integrated; // le bloc mouvement ci-dessous couvre le reste
  }
  // Mouvement + inertie (sur le temps restant du pas : la position des
  // sous-pas de giration a déjà été intégrée physiquement ci-dessus ; ce
  // bloc gère l'inertie de vitesse, l'estime et l'échouement au cap final)
  // Ancre : position figée — vitesse nulle, AUCUNE intégration (courant inclus)
  if (st.anchored) st.vkmh = 0;
  const target = st.anchored ? 0 : speedKmh(st, w);
  const accel = surface ? ACCEL_SURF : ACCEL_SUB;
  const decel = surface ? DECEL_SURF : DECEL_SUB;
  if (st.vkmh < target) st.vkmh = Math.min(target, st.vkmh + accel * dtMin);
  else st.vkmh = Math.max(target, st.vkmh - decel * dtMin);
  const rad = (st.heading * Math.PI) / 180;
  const radT = ((st.heading + st.compDev) * Math.PI) / 180;
  const cdr = (w.curDir * Math.PI) / 180;
  const through = (st.vkmh / 60 / DEG_KM) * dtMin;
  const throughT = through * (1 + st.logErr / 100);
  const drift = (w.curSpd / 60 / DEG_KM) * dtMin;
  const moored = surface &&
    (distKm(st.x, st.y, world.PORT.x, world.PORT.y) < DELIVERY_R_KM ||
     world.OUTPOSTS.some((o) => distKm(st.x, st.y, o.x, o.y) < DELIVERY_R_KM));
  const driftEff = moored ? 0 : drift;
  const anchored = !!st.anchored;
  const nx = st.x + (anchored ? 0 : Math.sin(radT) * throughT + Math.sin(cdr) * driftEff);
  const ny = st.y + (anchored ? 0 : Math.cos(radT) * throughT + Math.cos(cdr) * driftEff);
  st.travelledKm += st.vkmh * (dtMin / 60);
  const day = Math.floor(st.t / 1440);
  if (day !== st.dayIdx) { st.dayIdx = day; st.dailyKm = 0; }
  st.dailyKm += st.vkmh * (dtMin / 60);
  if (nx < 0.2 || nx > MAP - 0.2 || ny < 0.2 || ny > MAP - 0.2) {
    if (!st.grounded) {
      notify(st, "Limite de la zone de course — cap bloqué.", "warn", "alertes");
      if (st.autopilot) {
        st.autopilot = false;
        notify(st, "⚠️ Limite de zone — pilote automatique coupé, intervention requise.", "warn", "alertes");
      }
    }
    st.grounded = true;
    st.vkmh = 0;
  } else if (world.isLand(nx, ny)) {
    if (!st.grounded) {
      ev(st, "land", "⚠️ Terre détectée — navigation stoppée (risque d'échouement). Changez de cap.", "alertes");
      // le monde réel contredit la croyance : couper le pilote, un joueur
      // absent ne doit pas rester bloqué sans le savoir
      if (st.autopilot) {
        st.autopilot = false;
        notify(st, "⚠️ Échouement — pilote automatique coupé, intervention requise.", "warn", "alertes");
      }
      st.beaconLock = null; st.lockBrg = null; // échouement coupe le verrou
    }
    st.grounded = true;
    st.vkmh = 0;
  } else {
    st.x = nx; st.y = ny; st.grounded = false;
    st.estX += Math.sin(rad) * through;
    st.estY += Math.cos(rad) * through;
    st.unc += 0.025 * (st.vkmh * dtMin / 60) + 0.278 * (dtMin / 60) + drift * DEG_KM;
  }

  // Validation des points de passage (pilote auto) : au plus court sur la
  // trace ESTIMÉE du pas — visée et validation dans le même repère (l'estime).
  // Dépassement possible (validation au passage), enchaînement immédiat.
  while (st.autopilot && st.wpIdx < st.waypoints.length) {
    const wp = st.waypoints[st.wpIdx];
    if (segDistKm(wp.x, wp.y, prevEstX, prevEstY, st.estX, st.estY) >= WP_R_KM) break;
    st.wpIdx++;
    notify(st, `📍 Point ${st.wpIdx}/${st.waypoints.length} atteint (à l'estime).`, "info", "navire");
    if (st.wpIdx < st.waypoints.length) {
      st.headingOrder = bearingTo(st.estX, st.estY, st.waypoints[st.wpIdx].x, st.waypoints[st.wpIdx].y);
    } else {
      // dernier point : ARRÊT DU NAVIRE (mât rentré, voile rentrée)
      st.autopilot = false; st.engineOn = false; st.mast = false; st.sail = 0; st.electricOn = false;
      notify(st, "🏁 Itinéraire terminé — navire à l'arrêt (moteur coupé, mât et voile rentrés).", "good", "navire");
    }
  }

  // Orages
  if (w.storm && !st.wasStorm) {
    ev(st, "storm", "⚡ Tempête signalée sur votre zone", "meteo");
    notify(st, "⚡ Tempête : rendement de la voile réduit à 30 % par l'équipage.", "warn", "meteo");
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
        const newUnc = Math.max(1.5, 1.5 + 0.2 * w.clouds + 1.5 * w.hs + 0.4 * Math.max(0, 10 - w.visibility));
        if (newUnc < st.unc) {
          const fa = Math.random() * Math.PI * 2;
          const fr = Math.sqrt(Math.random()) * (newUnc / DEG_KM);
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
  if (st.food < RES_WARN_PCT && !st.warnedFood) { ev(st, "res", `Vivres < ${RES_WARN_PCT}%`, "alertes"); st.warnedFood = true; }
  if (st.fuel < RES_WARN_PCT && st.engineOn && !st.warnedFuel) { ev(st, "res", `Carburant < ${RES_WARN_PCT}%`, "alertes"); st.warnedFuel = true; }
  if (st.battery < RES_WARN_PCT && !st.warnedBatt) { ev(st, "res", `Batteries < ${RES_WARN_PCT}%`, "alertes"); st.warnedBatt = true; }
  if (st.food > RES_WARN_RESET_PCT) st.warnedFood = false;
  if (st.fuel > RES_WARN_RESET_PCT) st.warnedFuel = false;
  if (st.battery > RES_WARN_RESET_PCT) st.warnedBatt = false;

  // Radio : pulsations par balise (phase aléatoire propre à chaque balise)
  const radioOk = (st.location === "surface" || (st.location === "underwater" && st.periscope)) && st.battery > 0;
  if (radioOk) {
    for (const b of world.BEACONS) {
      // Une balise CAPTURÉE (désactivée) continue d'exister et d'émettre :
      // son ping est identique, seule la mention « désactivé » est ajoutée.
      const pulsed = Math.floor((st.t + b.phase) / PULSE_MIN) !== Math.floor((prevT + b.phase) / PULSE_MIN);
      if (!pulsed) continue;
      const got = detectBeacon(st, b);
      if (got) {
        pushBeaconSignal(st, { ...got, off: !b.active });
        const word = b.active ? "Ping" : "Ping désactivé";
        const txt = got.source === "omni"
          ? `📡 ${word} ${b.code} — signal ${got.strength}% (omnidirectionnelle)`
          : `📡 ${word} ${b.code} — signal ${got.strength}%, zone ${got.side} du cône`;
        notify(st, txt, "info", "radio");
      }
    }
  }

  // Observations visuelles + points visuels
  const night2 = !daylight;
  const canSee = st.location === "surface" || st.periscope;
  const visKm = w.visibility;
  const azTo = (x, y) => Math.round((Math.atan2(x - st.x, y - st.y) * 180) / Math.PI + 360) % 360;
  const kmOf = (x, y) => distKm(st.x, st.y, x, y);
  const nearIsl = world.ISLANDS.reduce(
    (best, i) => {
      const c = kmOf(i.x, i.y) - isleRadAt(i, Math.atan2(st.x - i.x, st.y - i.y)) * DEG_KM;
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
  const bVis = canSee ? world.BEACONS.map((b) => ({ b, km: kmOf(b.x, b.y) })).find((e) => e.km <= detectKm("balise", visKm, night2)) : null; // capturée ou non : l'objet physique existe
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
  const contKm = distToLine(st.x, st.y, world.COAST) * DEG_KM;
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


  // Balise-vigie : arrivée — ancre automatique si le pas de déplacement
  // (prevX/prevY → position) a touché le cercle d'ancre. En temps réel le
  // point suffit ; un saut de temps intègre jusqu'à MAX_STEP_MIN de route
  // d'un seul tenant — le test de segment attrape le franchissement et
  // arrête le navire au plus près de la balise.
  beaconLockTick(st, world, prevX, prevY);
  // Livraison au port
  if (segDistKm(world.PORT.x, world.PORT.y, prevX, prevY, st.x, st.y) < DELIVERY_R_KM && st.codes.length > 0) {
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
  const visKm = w.visibility;
  const HORIZON = 20; // km, horizon géographique depuis le pont
  const azTo = (x, y) => Math.round((Math.atan2(x - st.x, y - st.y) * 180) / Math.PI + 360) % 360;
  const kmOf = (x, y) => distKm(st.x, st.y, x, y);
  const det = (kind) => (canSee ? detectKm(kind, visKm, night) : -1);

  const islands = [];
  world.ISLANDS.forEach((i) => {
    const c = kmOf(i.x, i.y) - isleRadAt(i, Math.atan2(st.x - i.x, st.y - i.y)) * DEG_KM;
    if (c <= det("ile")) islands.push({ verts: i.verts, km: c, az: azTo(i.x, i.y), beyond: c > HORIZON });
  });
  const outposts = [];
  world.OUTPOSTS.forEach((o, idx) => {
    const km = kmOf(o.x, o.y);
    if (km <= det("poste")) outposts.push({ idx, x: o.x, y: o.y, km, az: azTo(o.x, o.y), beyond: km > HORIZON });
  });
  const beacons = [];
  world.BEACONS.forEach((b) => {
    const km = kmOf(b.x, b.y);
    if (km <= det("balise")) beacons.push({ id: b.id, rarity: b.rarity, off: !b.active, x: b.x, y: b.y, km, az: azTo(b.x, b.y), beyond: km > HORIZON });
  });
  const portKm = kmOf(world.PORT.x, world.PORT.y);
  const port = portKm <= det("port") ? { km: portKm, az: azTo(world.PORT.x, world.PORT.y), beyond: portKm > HORIZON } : null;
  const contKm = distToLine(st.x, st.y, world.COAST) * DEG_KM;
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
