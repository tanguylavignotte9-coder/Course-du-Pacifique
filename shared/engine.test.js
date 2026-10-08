import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorld, newPlayerState, tick, weatherAt,
  distKm, CAPTURE_R_KM, DELIVERY_R_KM, WP_R_KM, DEG_KM, LONG_DECAY_KM, VMAX_KMH, DIESEL_SPD_KMH,
  sailAutoDrive, apparentWind, SAIL_SPD_KMH, clamp, callPosition, RARITY_MIN, bearingTo, segDistKm,
  longStrengthKm, strengthKm, SHORT_DECAY_KM, recvCapture, detectBeacon, onProximityPing,
  proxPingIntervalS, captureBeacon, beaconLockTick, pushBeaconSignal, SIGNAL_LOG_MAX, PROX_ARM_KM,
  scrambledIntercept,
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

test("capture de balise : MANUELLE, usage unique, partagée entre navires", () => {
  const w = buildWorld(4242);
  const alice = newPlayerState(w, { weatherSeed: 1 });
  const bob = newPlayerState(w, { weatherSeed: 1 });
  const b = w.BEACONS.find((x) => x.active);
  alice.x = b.x + 0.001; alice.y = b.y;
  tick(alice, 1, w);
  assert.equal(b.active, true, "plus de capture automatique au tick");
  assert.equal(alice.codes.length, 0, "rien sans action du joueur");
  const r = captureBeacon(alice, w);
  assert.ok(r.ok, "capture manuelle à portée");
  assert.equal(b.active, false);
  assert.equal(alice.codes.length, 1);
  bob.x = b.x; bob.y = b.y;
  assert.equal(captureBeacon(bob, w).ok, false, "balise déjà éteinte : usage unique");
  assert.equal(bob.codes.length, 0);
  alice.x = 30; alice.y = 30; // loin de toute balise active
  assert.equal(captureBeacon(alice, w).ok, false, "aucune balise à portée : refus");
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
  assert.equal(st.sail, 0, "fin d'itinéraire : voile rentrée");
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
test("familles de décroissance : LONGUE 1000 km, COURTE 500 km", () => {
  assert.equal(longStrengthKm(0), 100);
  assert.equal(longStrengthKm(LONG_DECAY_KM), 0);
  assert.equal(longStrengthKm(500), 50, "50 % à mi-portée longue");
  assert.equal(strengthKm(400, SHORT_DECAY_KM), 20, "famille courte : 20 % à 400 km");
  assert.equal(strengthKm(SHORT_DECAY_KM, SHORT_DECAY_KM), 0, "famille courte : 0 % à 500 km");
});

test("intervalle du ping de proximité : géométrique par décade", () => {
  assert.equal(proxPingIntervalS(100), 30);
  assert.ok(Math.abs(proxPingIntervalS(10) - 20.8) < 0.1, `10 km : ~20,8 s (obtenu ${proxPingIntervalS(10).toFixed(1)})`);
  assert.ok(Math.abs(proxPingIntervalS(1) - 14.4) < 0.1, `1 km : ~14,4 s (obtenu ${proxPingIntervalS(1).toFixed(1)})`);
  assert.equal(proxPingIntervalS(0.1), 10);
  assert.equal(proxPingIntervalS(0.05), 10, "sous 100 m : plancher 10 s");
});

test("réception : omni à 100 km (80 %), refus omni à 130 km, directionnel si pointé", () => {
  const mk = (beam, orient) => ({ heading: 0, antBeam: beam, antOrient: orient });
  const cap100 = recvCapture(mk(5, 90), 0, strengthKm(100, SHORT_DECAY_KM)); // faisceau étroit ailleurs
  assert.ok(cap100 && cap100.source === "omni", "100 km : capture omni (80 %)");
  const cap130 = recvCapture(mk(5, 90), 0, strengthKm(130, SHORT_DECAY_KM)); // faisceau étroit ailleurs
  assert.equal(cap130, null, "130 km (74 %), faisceau ailleurs : silence");
  const cap130dir = recvCapture(mk(5, 0), 0, strengthKm(130, SHORT_DECAY_KM));
  assert.ok(cap130dir && cap130dir.source === "dir", "130 km : capture directionnelle faisceau pointé");
});

test("callPosition : station entend à 995 km, silence total à 1000 km", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y - 995 / DEG_KM; // 995 km : force 1 %
  st.antBeam = 180; st.heading = 0; st.antOrient = 0; st.headingOrder = 0;
  const answered = callPosition(st, b.code, w);
  assert.ok(answered, "la station entend (force >= 1 %) et répond sur les ondes");
  const stFar = newPlayerState(w, { weatherSeed: 1 });
  stFar.x = b.x; stFar.y = b.y - 1000 / DEG_KM; // 1000 km : force 0 %
  stFar.antBeam = 1; stFar.heading = 0; stFar.antOrient = 0; stFar.headingOrder = 0;
  assert.equal(callPosition(stFar, b.code, w), null, "silence total à 1000 km");
  assert.equal(callPosition(st, "9999", w), null, "mauvais numéro : null");
});

test("réponse de balise : lue à 600 km faisceau pointé, silence faisceau opposé, broadcast dans les deux cas", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const mk = (orient) => {
    const st = newPlayerState(w, { weatherSeed: 1 });
    st.x = b.x; st.y = b.y - 600 / DEG_KM; // 600 km : force 40 %
    st.antBeam = 5; st.heading = 0; st.antOrient = orient; st.headingOrder = 0;
    return st;
  };
  const pointed = mk(0);
  const answered = callPosition(pointed, b.code, w);
  assert.ok(answered, "broadcast tiers émis (la balise répond sur les ondes)");
  const resp = pointed.notifications.find((n) => n.text.includes("Position de " + b.code));
  assert.ok(resp, "réponse lue à 600 km, faisceau pointé (dir >= sens)");
  const opposite = mk(180);
  const answered2 = callPosition(opposite, b.code, w);
  assert.ok(answered2, "broadcast tiers émis aussi (la station a entendu)");
  assert.ok(!opposite.notifications.some((n) => n.text.includes("Position de " + b.code)),
    "faisceau opposé : réponse non captée, silence pour l'appelant");
});

test("textes radio : la réponse « Position ? » n'affiche pas d'azimut", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y - 300 / DEG_KM;
  st.antBeam = 5; st.heading = 0; st.antOrient = 0; st.headingOrder = 0;
  callPosition(st, b.code, w);
  const resp = st.notifications.find((n) => n.text.includes("Position de " + b.code));
  assert.ok(resp, "réponse lue à 300 km faisceau pointé");
  assert.ok(!resp.text.includes("azimut"), `sans azimut dans le texte (obtenu : ${resp.text})`);
  assert.ok(resp.text.includes("signal"), "la force du signal reste affichée");
});

test("scrambledIntercept : zone sans azimut (nouvelle signature)", () => {
  const dir = scrambledIntercept(50, "dir", "D1");
  assert.ok(!dir.text.includes("azimut"), `sans azimut (obtenu : ${dir.text})`);
  assert.ok(dir.text.includes("zone D1"), "zone du faisceau affichée");
  const omni = scrambledIntercept(50, "omni");
  assert.ok(!omni.text.includes("azimut"), "sans azimut en omni");
  assert.ok(omni.text.includes("signal 50%"), "force affichée");
});

test("journal des signaux : borné à 10 après 15 pings", () => {
  const st = { signals: [] };
  for (let i = 0; i < 15; i++) pushBeaconSignal(st, { t: i, beaconId: "x" + i });
  assert.equal(st.signals.length, SIGNAL_LOG_MAX, `borné à ${SIGNAL_LOG_MAX}`);
  assert.equal(st.signals[0].beaconId, "x5", "les plus anciens sont éjectés");
  assert.equal(st.signals[9].beaconId, "x14", "le plus récent en dernier");
});

test("ancre : position figée malgré courant et voile", () => {
  const w = buildWorld(42);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = 30; st.y = 30; st.estX = 30; st.estY = 30;
  st.mast = true; st.sail = 1; st.engineOn = true; st.engine = 1;
  st.heading = 90; st.headingOrder = 90;
  st.anchored = true;
  const x0 = st.x, y0 = st.y;
  for (let i = 0; i < 30; i++) tick(st, 1, w);
  assert.equal(st.x, x0); assert.equal(st.y, y0, "ancre : position exactement figée");
  assert.equal(st.vkmh, 0, "vitesse nulle");
  assert.equal(st.travelledKm, 0, "aucune distance parcourue");
});

test("beaconLockTick : à < 50 m -> ancre auto, verrou vidé, barre arrêtée", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y + 0.0005; // 25 m au sud de la balise
  st.heading = 45; st.headingOrder = 45;
  st.beaconLock = b.code; st.lockBrg = 0;
  beaconLockTick(st, w);
  assert.equal(st.anchored, true, "ancre automatique");
  assert.equal(st.beaconLock, null, "verrou vidé");
  assert.equal(st.lockBrg, null);
  assert.equal(st.headingOrder, st.heading, "barre arrêtée");
  assert.ok(st.notifications.some((n) => n.text.includes("Ancre jetée")));
});

test("verrou balise-vigie : engagement, poursuite d'azimut, antenne sur la source", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y - 40 / DEG_KM; // 40 km au sud, balise au nord
  st.heading = 90;
  onProximityPing(st, b, { strength: 92, source: "dir", bearing: 0, side: "centre" });
  assert.equal(st.beaconLock, b.code, "verrou engagé");
  const brg = Math.round(bearingTo(st.x, st.y, b.x, b.y));
  assert.equal(st.headingOrder, brg, "poursuite : consigne = azimut de la source");
  assert.ok(st.notifications.some((n) => n.text.includes("verrouillé")), "notification d'engagement");
  assert.equal(st.signals[st.signals.length - 1].kind, "prox", "ping de proximité journalisé");
  const n = st.notifications.length;
  onProximityPing(st, b, { strength: 95, source: "dir", bearing: 0, side: "centre" });
  assert.equal(st.notifications.length, n, "déjà verrouillé : pas de re-notification");
});

test("verrou : signal faible (balise lointaine) = journal seul, pilote intact", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y - 400 / DEG_KM; // 400 km : 20 %, directionnel pointé
  st.heading = 0; st.headingOrder = 90;
  onProximityPing(st, b, { strength: 20, source: "dir", bearing: 0, side: "centre" });
  assert.equal(st.beaconLock, null, "signal < 75 % : pas de verrou");
  assert.equal(st.headingOrder, 90, "consigne de cap intacte");
  assert.equal(st.signals[st.signals.length - 1].kind, "prox", "le ping reste journalisé");
});

test("verrou : l'engagement coupe le pilote de route (un seul pilote à la fois)", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y - 40 / DEG_KM;
  st.waypoints = [{ x: 30.5, y: 30.5 }]; st.wpIdx = 0;
  st.autopilot = true;
  onProximityPing(st, b, { strength: 92, source: "dir", bearing: 0, side: "centre" });
  assert.equal(st.beaconLock, b.code, "verrou engagé");
  assert.equal(st.autopilot, false, "le verrou coupe le pilote de route");
  assert.equal(st.waypoints.length, 1, "waypoints conservés (inactifs)");
});

test("verrou : anti-bascule — le premier verrou tient, l'autre balise est journalisée", () => {
  const w = buildWorld(77);
  const b1 = w.BEACONS.find((x) => x.active);
  const b2 = w.BEACONS.find((x) => x.active && x.code !== b1.code);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b1.x; st.y = b1.y - 40 / DEG_KM;
  onProximityPing(st, b1, { strength: 92, source: "omni", bearing: null });
  const order = st.headingOrder;
  onProximityPing(st, b2, { strength: 95, source: "omni", bearing: null });
  assert.equal(st.beaconLock, b1.code, "le premier verrou tient");
  assert.equal(st.headingOrder, order, "la consigne n'est pas détournée");
  assert.equal(st.signals[st.signals.length - 1].beaconId, b2.code, "le ping de l'autre balise est journalisé");
});

test("pilote de route vs verrou : le recalcul de consigne respecte le verrou", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y - 40 / DEG_KM; st.estX = st.x; st.estY = st.y;
  st.waypoints = [{ x: 35, y: 30 }]; st.wpIdx = 0;
  st.autopilot = true; // état incohérent (migration à chaud) : verrou SANS coupure
  st.beaconLock = b.code;
  const wpBrg = bearingTo(st.estX, st.estY, 35, 30);
  st.heading = 0; st.headingOrder = (wpBrg + 90) % 360; // consigne du verrou ≠ visée du point
  tick(st, 1 / 60, w);
  assert.equal(Math.round(st.headingOrder), Math.round((wpBrg + 90) % 360),
    "le pilote de route n'écrase pas la consigne du verrou");
});

test("rayon de veille : PROX_ARM_KM émergent = force 75 % en famille courte", () => {
  assert.ok(Math.abs(PROX_ARM_KM - 125) < 1e-9, `125 km attendus (obtenu ${PROX_ARM_KM})`);
  assert.equal(strengthKm(PROX_ARM_KM, SHORT_DECAY_KM), 75, "à PROX_ARM_KM, l'omni capte exactement");
});

test("segDistKm : distance point-segment", () => {
  // point au-dessus du milieu d'un segment horizontal
  const d = segDistKm(30.001, 30.001, 30, 30, 30.002, 30);
  assert.ok(Math.abs(d - 0.001 * DEG_KM) < 0.001, `distance ~0.05 km (actuel: ${d})`);
});
