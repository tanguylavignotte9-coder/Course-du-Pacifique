import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorld, newPlayerState, tick, weatherAt,
  distKm, CAPTURE_R_KM, DELIVERY_R_KM, WP_R_KM, DEG_KM, RADIO_DECAY_KM, VMAX_KMH, DIESEL_SPD_KMH,
  sailAutoDrive, apparentWind, SAIL_SPD_KMH, clamp, callPosition, RARITY_MIN, bearingTo, segDistKm,
} from "./engine.js";

// Navire de test en pleine eau (loin du port et des terres), pleine vitesse.
function shipAtSea(w, { heading = 90, order = 90 } = {}) {
  const st = newPlayerState(w);
  st.x = 30; st.y = 30; st.estX = 30; st.estY = 30; // milieu de l'océan
  st.engineOn = true; st.engine = 1; // moteur : vitesse cible DIESEL_SPD_KMH
  st.vkmh = DIESEL_SPD_KMH;
  st.heading = heading;
  st.headingOrder = order;
  return st;
}

test("monde déterministe : même graine = même géométrie", () => {
  const a = buildWorld(12345);
  const b = buildWorld(12345);
  assert.deepEqual(a.PORT, b.PORT);
  assert.equal(a.BEACONS.length, b.BEACONS.length);
  assert.equal(a.BEACONS[3].x, b.BEACONS[3].x);
  assert.equal(a.BEACONS[3].code, b.BEACONS[3].code);
});

test("40 balises (20/10/5/5), 10 îles, 5 avant-postes sur 5 îles distinctes", () => {
  const w = buildWorld(777);
  const counts = {};
  w.BEACONS.forEach((b) => counts[b.rarity] = (counts[b.rarity] || 0) + 1);
  assert.deepEqual(counts, { commune: 20, rare: 10, legendaire: 5, inconnue: 5 });
  assert.equal(w.ISLANDS.length, 10);
  assert.equal(w.OUTPOSTS.length, 5);
  assert.equal(new Set(w.OUTPOSTS.map((o) => o.island)).size, 5);
});

test("contraintes de placement des balises (km, seuil le plus strict)", () => {
  const w = buildWorld(4242);
  for (const b of w.BEACONS) {
    assert.equal(w.isLand(b.x, b.y), false, `${b.id} sur terre`);
    const m = RARITY_MIN[b.rarity];
    assert.ok(distKm(b.x, b.y, w.PORT.x, w.PORT.y) >= m.port, `${b.id} trop près du port`);
    for (const o of w.OUTPOSTS) {
      assert.ok(distKm(b.x, b.y, o.x, o.y) >= m.outpost, `${b.id} trop près d'un avant-poste`);
    }
  }
  for (let i = 0; i < w.BEACONS.length; i++) {
    for (let j = i + 1; j < w.BEACONS.length; j++) {
      const a = w.BEACONS[i], b = w.BEACONS[j];
      const min = Math.max(RARITY_MIN[a.rarity].beacon, RARITY_MIN[b.rarity].beacon);
      assert.ok(distKm(a.x, a.y, b.x, b.y) >= min - 0.01, `paire ${a.id}/${b.id} trop proche`);
    }
  }
});

test("capture et livraison à 500 m (km)", () => {
  assert.ok(Math.abs(CAPTURE_R_KM - 0.5) < 1e-9);
  assert.ok(Math.abs(DELIVERY_R_KM - 0.5) < 1e-9);
  assert.ok(Math.abs(WP_R_KM - 0.1) < 1e-9);
});

test("météo déterministe, en km/h et km", () => {
  const a = weatherAt(30, 30, 1000, 42);
  const b = weatherAt(30, 30, 1000, 42);
  assert.deepEqual(a, b);
  assert.ok(a.windSpd > 3 && a.windSpd < 90, "vent en km/h plausible");
  assert.ok(a.visibility <= 25, "visibilité en km");
});

test("tick : navire au moteur avance et consomme", () => {
  const w = buildWorld(42);
  const st = newPlayerState(w);
  st.heading = w.CONTINENT.x1 <= 30 ? 90 : 270; // vers le large
  st.engineOn = true;
  st.engine = 1;
  const fuel0 = st.fuel;
  for (let i = 0; i < 600; i++) tick(st, 1, w); // 10 h de jeu
  assert.ok(st.travelledKm > 50, `distance parcourue : ${st.travelledKm} km`);
  assert.ok(st.fuel < fuel0, "le carburant doit diminuer");
  assert.equal(st.grounded, false);
});

test("tick : estime diverge de la position vraie (dérive du courant)", () => {
  const w = buildWorld(42);
  const st = newPlayerState(w);
  st.heading = w.CONTINENT.x1 <= 30 ? 90 : 270;
  st.engineOn = true;
  st.engine = 1;
  for (let i = 0; i < 300; i++) tick(st, 1, w); // 5 h
  assert.notEqual(st.x, st.estX);
  assert.ok(st.unc > 0, "l'incertitude doit croître");
});

test("capture de balise : usage unique, partagée entre navires", () => {
  const w = buildWorld(4242);
  const alice = newPlayerState(w, { weatherSeed: 1 });
  const bob = newPlayerState(w, { weatherSeed: 1 });
  const b = w.BEACONS.find((x) => x.active);
  alice.x = b.x + 0.001; alice.y = b.y;
  tick(alice, 1, w);
  assert.equal(b.active, false);
  assert.equal(alice.codes.length, 1);
  bob.x = b.x; bob.y = b.y;
  tick(bob, 1, w);
  assert.equal(bob.codes.length, 0, "balise déjà éteinte : usage unique");
});

test("livraison au port marque les points", () => {
  const w = buildWorld(4242);
  const st = newPlayerState(w);
  const b = w.BEACONS[0];
  st.codes = [{ id: b.id, rarity: b.rarity, pts: b.pts }];
  st.x = w.PORT.x + 0.001; st.y = w.PORT.y;
  tick(st, 1, w);
  assert.ok(st.score > 0, "les points doivent rentrer");
  assert.equal(st.codes.length, 0);
});

test("voile auto : no-go vent debout, largue optimal, fuite plus lente", () => {
  const W = { windDir: 0, windSpd: 50, storm: false };
  const speed = (h, v) => {
    const { drive, aw } = sailAutoDrive({ heading: h, vkmh: v, compDev: 0 }, W);
    return Math.min(VMAX_KMH, SAIL_SPD_KMH * clamp(aw / 50, 0, 1.1) * drive);
  };
  assert.equal(speed(0, 0), 0, "vent debout : zone no-go, aucun réglage ne pousse");
  assert.ok(speed(20, 0) < 8, "à 20° du vent : poussée résiduelle minuscule");
  assert.ok(speed(45, 10) > 3, "près serré : le navire avance");
  const travers = speed(90, 25), largue = speed(120, 30), fuite = speed(180, 25);
  assert.ok(largue > travers && largue > fuite, "le largue serré est l'allure reine");
  assert.ok(travers > fuite, "le travers dépasse la fuite (le vent apparent s'effondre)");
});

test("voile auto : ~40 km/h au largue par vent fort (point fixe)", () => {
  const W = { windDir: 0, windSpd: 50, storm: false };
  const st = { heading: 120, vkmh: 0, compDev: 0 };
  for (let i = 0; i < 200; i++) {
    const { drive, aw } = sailAutoDrive(st, W);
    const target = Math.min(VMAX_KMH, SAIL_SPD_KMH * clamp(aw / 50, 0, 1.1) * drive);
    st.vkmh = st.vkmh + 0.2 * (target - st.vkmh);
  }
  assert.ok(st.vkmh > 36 && st.vkmh < 44, `largue par vent 50 : ~40 km/h (obtenu ${st.vkmh.toFixed(1)})`);
});

test("voile auto : tempête = rendement réduit à 30 %", () => {
  const st = () => ({ heading: 120, vkmh: 25, compDev: 0 });
  const calme = sailAutoDrive(st(), { windDir: 0, windSpd: 50, storm: false }).drive;
  const tempete = sailAutoDrive(st(), { windDir: 0, windSpd: 50, storm: true }).drive;
  assert.ok(Math.abs(tempete - 0.3 * calme) < 1e-9, `tempête : ${tempete} vs ${0.3 * calme}`);
});

test("vent apparent : monte au près, s'effondre en fuite", () => {
  const W = { windDir: 0, windSpd: 50, storm: false };
  const pres = apparentWind({ heading: 45, vkmh: 20, compDev: 0 }, W);
  const fuite = apparentWind({ heading: 180, vkmh: 20, compDev: 0 }, W);
  assert.ok(pres.aw > 50 && pres.g < 45, "au près le vent apparent monte et vient de l'avant");
  assert.ok(fuite.aw < 50 && fuite.g > 160, "en fuite le vent apparent s'effondre");
});

test("inertie surface : convergence vers la vitesse cible", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  for (let i = 0; i < 180; i++) tick(st, 1, w); // 3 h de jeu
  assert.ok(st.vkmh > 0, "le navire doit avoir pris de la vitesse");
});

test("point aux étoiles : réussit la nuit sous ciel clair et réduit l'incertitude", () => {
  const w = buildWorld(7);
  const st = newPlayerState(w, { weatherSeed: 0 });
  st.t = 1500; st.x = 45; st.y = 45; st.heading = 90;
  st.unc = 25;
  for (let i = 0; i < 200; i++) tick(st, 1, w);
  assert.ok(st.unc < 25, `l'incertitude doit diminuer (actuel: ${st.unc})`);
  assert.ok(st.notifications.some((n) => n.text.includes("Point aux étoiles")));
});

// ---------- Giration ----------
test("giration : consigne +90° à pleine vitesse atteinte en ~20 s, sans dépassement", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 0, order: 90 });
  st.vkmh = VMAX_KMH; // pleine vitesse pour le taux plein
  let ticks = 0;
  let maxH = 0;
  while (st.heading !== 90 && ticks < 60) {
    tick(st, 1 / 60, w);
    ticks++;
    maxH = Math.max(maxH, st.heading);
  }
  assert.equal(st.heading, 90);
  assert.equal(ticks, 20, `90° à 270°/min = 20 s (actuel: ${ticks})`);
  assert.ok(maxH <= 90, "jamais de dépassement");
});

test("giration : plus court chemin à travers le nord (10° → 350° = −20°)", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 10, order: 350 });
  st.vkmh = VMAX_KMH;
  const st2 = shipAtSea(w, { heading: 10, order: 350 });
  st2.vkmh = VMAX_KMH;
  tick(st2, 1 / 60, w);
  assert.ok(Math.abs(st2.heading - 5.5) < 0.01, "1 s à 4,5°/s : 10 → 5,5 (sens négatif)");
  tick(st, 1, w);
  const diff = ((350 - st.heading + 540) % 360) - 180;
  assert.ok(Math.abs(diff) < 180, "plus court chemin");
});

test("anti-deadlock : navire échoué vire quand même à 25 % du taux", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 0, order: 90 });
  st.vkmh = 0;
  st.grounded = true;
  tick(st, 1 / 60, w);
  assert.ok(Math.abs(st.heading - 1.125) < 0.01, `1,125° attendu (actuel: ${st.heading})`);
});

test("migration : état sans headingOrder → aucune giration intempestive", () => {
  const w = buildWorld(42);
  const st = newPlayerState(w);
  delete st.headingOrder;
  const cap = st.heading;
  tick(st, 1, w);
  assert.equal(st.heading, cap);
  assert.equal(st.headingOrder, cap);
});

test("grands pas : rotation bornée par le taux, trajectoire cohérente", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 0, order: 90 });
  st.vkmh = VMAX_KMH;
  const x0 = st.x, y0 = st.y;
  tick(st, 5, w);
  assert.equal(st.heading, 90, "consigne atteinte, pas de tours complets");
  assert.ok(Math.hypot(st.x - x0, st.y - y0) > 0, "position intégrée pendant la giration");
});

// ---------- Pilote automatique ----------
test("pilote : la consigne vise le point depuis l'estime", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.waypoints = [{ x: 30.1, y: 30 }];
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 1 / 60, w);
  assert.equal(Math.round(st.headingOrder), Math.round(bearingTo(st.estX, st.estY, 30.1, 30)));
});

test("validation sur trace estimée : wpIdx avance quand le pas traverse les 100 m", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.waypoints = [{ x: 30.01, y: 30 }]; // 0,5 km à l'est
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 5, w); // 5 min à ~28 km/h : 2,3 km, traverse le disque de 100 m
  assert.equal(st.wpIdx, 1, "point validé au passage");
  assert.ok(st.notifications.some((n) => n.text.includes("Point 1/1 atteint")));
});

test("mauvaise navigation légitime : la vraie position diverge, la route se valide à l'estime", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.waypoints = [{ x: 30.01, y: 30 }];
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 5, w);
  assert.equal(st.wpIdx, 1, "validé à l'estime");
  const drift = Math.hypot(st.x - st.estX, st.y - st.estY) * DEG_KM;
  assert.ok(drift > 0, `la vraie position a divergé (${drift.toFixed(2)} km)`);
});

test("enchaînement : deux points proches traversés en un pas de 5 min", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.waypoints = [{ x: 30.01, y: 30 }, { x: 30.02, y: 30 }];
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 5, w);
  assert.equal(st.wpIdx, 2, "les deux points validés");
});

test("fin d'itinéraire : arrêt du navire", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.engineOn = true;
  st.mast = true;
  st.waypoints = [{ x: 30.01, y: 30 }];
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 5, w);
  assert.equal(st.autopilot, false);
  assert.equal(st.engineOn, false);
  assert.equal(st.mast, false, "fin d'itinéraire : mât rentré, plus de voile");
  assert.ok(st.notifications.some((n) => n.text.includes("Itinéraire terminé")));
});

test("échouement : pilote coupé avec notification", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  const coastPt = w.COAST[4];
  st.x = coastPt[0] - 0.3; st.y = coastPt[1];
  st.estX = st.x; st.estY = st.y;
  st.waypoints = [{ x: coastPt[0] + 0.5, y: coastPt[1] }];
  st.wpIdx = 0;
  st.autopilot = true;
  for (let i = 0; i < 120 && st.autopilot; i++) tick(st, 1, w);
  assert.equal(st.grounded, true, "échoué");
  assert.equal(st.autopilot, false, "pilote coupé");
  assert.ok(st.notifications.some((n) => n.text.includes("pilote automatique coupé")));
});

test("estime + sous-pas : grand virage — l'estime intègre les sous-pas", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 0, order: 180 });
  st.vkmh = VMAX_KMH;
  tick(st, 5, w);
  const dy = 30 - st.estY;
  assert.ok(dy > 0.01, `l'estime a suivi la giration et la route sud (${(dy * DEG_KM).toFixed(2)} km)`);
});

test("auto-correction étoile→pilote : recentrage → re-visée au tick suivant", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.waypoints = [{ x: 31, y: 30 }];
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 1, w);
  st.estX = 29.9; st.estY = 30.05;
  tick(st, 1, w);
  assert.equal(Math.round(st.headingOrder), Math.round(bearingTo(st.estX, st.estY, 31, 30)));
});

test("migration : état ancien sans waypoints/autopilot → aucun crash", () => {
  const w = buildWorld(42);
  const st = newPlayerState(w);
  delete st.waypoints; delete st.wpIdx; delete st.autopilot;
  const cap = st.heading;
  tick(st, 1, w);
  assert.equal(st.heading, cap);
});

test("déterminisme : même état + mêmes ticks = même trajectoire", () => {
  const w = buildWorld(42);
  const make = () => {
    const st = shipAtSea(w, { heading: 90, order: 90 });
    st.vkmh = VMAX_KMH;
    st.waypoints = [{ x: 30.5, y: 30.5 }, { x: 31, y: 31 }];
    st.wpIdx = 0;
    st.autopilot = true;
    return st;
  };
  const seed = make();
  const run = () => {
    const st = JSON.parse(JSON.stringify(seed));
    const trace = [];
    for (let i = 0; i < 30; i++) { tick(st, 1, w); trace.push(st.x.toFixed(6), st.y.toFixed(6), st.estX.toFixed(6), st.estY.toFixed(6)); }
    return trace.join(",");
  };
  assert.equal(run(), run(), "trajectoire identique au rejeu");
});

// ---------- Radio ----------
test("callPosition : retourne la balise répondue — même si l'appelant n'entend pas", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y - 1500 / DEG_KM; // 1500 km, faisceau 1° (portée 2500 km)
  st.antBeam = 1; st.heading = 0; st.antOrient = 0; st.headingOrder = 0;
  const nAvant = st.notifications.length;
  const answered = callPosition(st, b.code, w);
  assert.ok(answered, "la balise répond sur les ondes");
  assert.equal(answered.x, b.x);
  assert.equal(st.notifications.length, nAvant, "réponse inaudible (> 1000 km) : silence pour l'appelant");
  const st2 = newPlayerState(w, { weatherSeed: 1 });
  st2.x = b.x; st2.y = b.y - 300 / DEG_KM;
  st2.antBeam = 180; st2.heading = 0; st2.antOrient = 0; st2.headingOrder = 0;
  const answered2 = callPosition(st2, b.code, w);
  assert.ok(answered2);
  const resp = st2.notifications.find((n) => n.text.includes("Position de " + b.code));
  assert.ok(resp, "réponse privée complète à 300 km");
  assert.equal(callPosition(st2, "9999", w), null, "mauvais numéro : null");
});

test("radio : décroissance centralisée à 1000 km", async () => {
  const { signalStrengthKm } = await import("./engine.js");
  assert.equal(signalStrengthKm(0), 100);
  assert.equal(signalStrengthKm(RADIO_DECAY_KM), 0);
  assert.ok(signalStrengthKm(500) === 50, "50 % à mi-portée");
});

test("segDistKm : distance point-segment", () => {
  // point au-dessus du milieu d'un segment horizontal
  const d = segDistKm(30.001, 30.001, 30, 30, 30.002, 30);
  assert.ok(Math.abs(d - 0.001 * DEG_KM) < 0.001, `distance ~0.05 km (actuel: ${d})`);
});
