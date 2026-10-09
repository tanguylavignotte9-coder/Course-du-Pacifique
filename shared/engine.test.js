import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorld, newPlayerState, tick, weatherAt, computeView,
  distKm, CAPTURE_R_KM, DELIVERY_R_KM, WP_R_KM, DEG_KM, LONG_DECAY_KM, VMAX_KMH, DIESEL_SPD_KMH,
  sailAutoDrive, apparentWind, SAIL_SPD_KMH, clamp, callPosition, RARITY_MIN, bearingTo, segDistKm,
  longStrengthKm, strengthKm, SHORT_DECAY_KM, recvCapture, detectBeacon, onProximityPing,
  proxPingIntervalS, captureBeacon, beaconLockTick, beaconLockSteer, pushBeaconSignal, SIGNAL_LOG_MAX, PROX_ARM_KM, ANCHOR_DROP_KM,
  scrambledIntercept, WX_HORIZON_H, AUTOGUIDE_MODES, AUTOGUIDE_DEFAULT,
  sonarPing, sonarPassiveHear, shipNoisy, nearestOnLine, soundTravelMin,
  SOUND_KMH, SOUND_DECAY_KM, SONAR_RANGE_KM, SONAR_PING_BATTERY_COST, SONAR_ECHO_PERSIST_S,
  generateNpcs, npcsTick, npcNoisy, npcBackPos, nextNpcEventMin, npcFishermanTick,
  NPC_FISHERMEN, NPC_CARGOS, NPC_WHALES, FISHER_RANGE_KM, FISHER_MIN_OFF_KM,
  FISHER_SPOT_R_KM, FISHER_FISH_MIN, FISHER_FISH_SPAN_MIN, CARGO_SPD_KMH,
  WHALE_SPD_KMH, NPC_TICK_MAX_MIN, NPC_SUBSTEP_MIN, FISHER_CHAT_MEAN_MIN,
  CARGO_MSG_MEAN_MIN, WHALE_SONG_MEAN_MIN,
  beastSpawn, beastTick, makeFisherman, makeCargo, makeWhale,
  BEAST_SPAWN_MIN_PORT_KM, BEAST_SPD_KMH, BEAST_HUNGER_MIN, BEAST_STRIKE_KM,
  BEAST_TICK_MAX_MIN, BEAST_TRACE_PERSIST_MIN, detectKm,
  estimateZone, bearingCross, patrolTick, beastFlee, patrolDetectPerMin,
  ESTIMATE_MIN_R_KM, ESTIMATE_MAX_R_KM, ESTIMATE_GROWTH_KMH,
  ESTIMATE_HALF_LIFE_MIN, EXCLUSION_BULLETIN_MIN, BEACON_HEAR_KM,
  PATROL_SPD_KMH, PATROL_ENGAGE_MIN, PATROL_CANNON_EVERY_MIN,
  PATROL_DETECT_COOLDOWN_MIN, PATROL_DETECT_R_KM, PATROL_TICK_MAX_MIN,
  CANNON_DECAY_KM,
} from "./engine.js";

// Navire de test en pleine eau (loin du port et des terres), pleine vitesse.
function shipAtSea(w, { heading = 90, order = 90 } = {}) {
  const st = newPlayerState(w);
  st.x = 30; st.y = 30; st.estX = 30; st.estY = 30; // milieu de l'océan
  st.anchored = false; // un navire en mer a levé l'ancre
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
  st.anchored = false; // lève l'ancre pour naviguer
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
  st.anchored = false; // lève l'ancre pour naviguer
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
  st.anchored = false; // en navigation : le verrou peut s'engager
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
  st.anchored = false; // en navigation : le verrou peut s'engager
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
  st.anchored = false; // en navigation : le verrou peut s'engager
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
  st.heading = 0; st.headingOrder = (wpBrg + 90) % 360; // consigne de départ ≠ visée du point
  tick(st, 1 / 60, w);
  const lockBrg = Math.round(bearingTo(st.x, st.y, b.x, b.y));
  assert.equal(Math.round(st.headingOrder), lockBrg,
    "le pilote de route n'écrase pas le verrou : la consigne suit la balise (poursuite continue)");
  assert.notEqual(Math.round(st.headingOrder), Math.round(wpBrg),
    "et non le waypoint du pilote de route");
});

test("rayon de veille : PROX_ARM_KM émergent = force 75 % en famille courte", () => {
  assert.ok(Math.abs(PROX_ARM_KM - 125) < 1e-9, `125 km attendus (obtenu ${PROX_ARM_KM})`);
  assert.equal(strengthKm(PROX_ARM_KM, SHORT_DECAY_KM), 75, "à PROX_ARM_KM, l'omni capte exactement");
});

test("verrou : poursuite continue — cap et antenne recalculés à chaque tick", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y - 40 / DEG_KM;
  st.heading = 137; st.antOrient = 0; st.headingOrder = 137;
  st.beaconLock = b.code;
  beaconLockSteer(st, w);
  const brg = Math.round(bearingTo(st.x, st.y, b.x, b.y));
  assert.equal(st.headingOrder, brg, "cap remis sur la balise");
  assert.equal(st.lockBrg, brg, "azimut du verrou à jour");
  assert.equal(st.antOrient, Math.round(((brg - st.heading + 540) % 360) - 180), "antenne sur la source");
});

test("verrou : arrivée par segment (saut de temps) — ancre au point de franchissement", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  const prevX = b.x, prevY = b.y - 5 / DEG_KM;  // départ du pas : 5 km au sud
  st.x = b.x; st.y = b.y + 1 / DEG_KM;          // fin du pas : 1 km au nord — la balise est franchie
  st.beaconLock = b.code;
  beaconLockTick(st, w, prevX, prevY);
  assert.equal(st.anchored, true, "ancre automatique au franchissement");
  assert.ok(distKm(st.x, st.y, b.x, b.y) <= ANCHOR_DROP_KM,
    `arrêt ≤ 50 m de la balise (obtenu ${Math.round(distKm(st.x, st.y, b.x, b.y) * 1000)} m)`);
  assert.equal(st.beaconLock, null, "verrou libéré");
});

// ---------- Balises désactivées persistantes + autoguidage + NETWORK ----------
test("verrou : ancre déployée — le guidage automatique ne s'engage pas", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y - 40 / DEG_KM;
  st.heading = 90; st.headingOrder = 90;
  st.anchored = true; // ancre déployée : signal fort, mode par défaut — aucun verrou
  onProximityPing(st, b, { strength: 92, source: "dir", bearing: 0, side: "centre" });
  assert.equal(st.beaconLock, null, "ancre déployée : pas d'engagement du verrou");
  assert.equal(st.headingOrder, 90, "consigne de cap intacte");
  assert.equal(st.signals[st.signals.length - 1].kind, "prox", "le ping reste journalisé");
  // lever l'ancre : le ping suivant peut engager le verrou
  st.anchored = false;
  onProximityPing(st, b, { strength: 92, source: "dir", bearing: 0, side: "centre" });
  assert.equal(st.beaconLock, b.code, "ancre levée : le verrou s'engage au ping suivant");
});

test("WX_HORIZON_H : horizon des prévisions = 48 h (constante importée, pas figée)", () => {
  assert.equal(WX_HORIZON_H, 48);
});

test("autoguidage : 3 positions, défaut = actives seules", () => {
  assert.deepEqual(AUTOGUIDE_MODES, ["disabled", "active", "all"]);
  assert.equal(AUTOGUIDE_DEFAULT, "active");
});

test("balise capturée : elle continue d'émettre « ping désactivé » (pulsation horaire)", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.location = "surface"; st.battery = 100;
  st.x = b.x; st.y = b.y - 10 / DEG_KM; st.estX = st.x; st.estY = st.y;
  st.heading = 0; st.headingOrder = 0;
  st.anchored = true; // figé à 10 km : la balise est capturée par un TIER
  b.active = false;
  for (let i = 0; i < 60; i++) tick(st, 1, w); // 60 min : au moins une pulsation de b
  const n = st.notifications.find((x) => x.text.includes(`Ping désactivé ${b.code}`));
  assert.ok(n, `le ping de la balise capturée arrive, mention « désactivé »`);
  assert.ok(!st.notifications.some((x) => x.text.includes(`Ping ${b.code} — signal`) && !x.text.includes("désactivé")),
    "jamais de ping « actif » pour une balise capturée");
  assert.ok(st.signals.some((s) => s.beaconId === b.code && s.off), "journal : flag off sur le ping de la balise capturée");
});

test("balise capturée : pas de re-capture, mais callPosition répond toujours", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.location = "surface"; st.battery = 100;
  st.x = b.x; st.y = b.y;
  assert.ok(captureBeacon(st, w).ok, "capture manuelle");
  assert.equal(captureBeacon(st, w).ok, false, "déjà capturée : pas de re-capture");
  // la station capturée répond toujours à « Position ? »
  st.antBeam = 180; st.heading = 0; st.antOrient = 0; st.headingOrder = 0;
  const answered = callPosition(st, b.code, w);
  assert.ok(answered, "la balise capturée répond sur les ondes");
  assert.ok(st.notifications.some((x) => x.text.includes(`Position de ${b.code}`)), "réponse lisible à portée");
  assert.ok(st.pins.some((p) => p.label === b.code), "punaise automatique posée");
});

test("verrou : une balise capturée reste pilotable — le verrou survit à la capture par un tiers", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.x = b.x; st.y = b.y - 40 / DEG_KM;
  st.autoguide = "all";
  st.anchored = false; // en navigation : le verrou peut s'engager
  onProximityPing(st, b, { strength: 92, source: "dir", bearing: 0, side: "centre" });
  assert.equal(st.beaconLock, b.code, "verrou engagé sur balise active (mode toutes)");
  // un TIER capture la balise pendant la poursuite : le verrou tient
  b.active = false;
  beaconLockSteer(st, w);
  assert.equal(st.beaconLock, b.code, "le verrou survit à la capture de sa cible");
  const brg = Math.round(bearingTo(st.x, st.y, b.x, b.y));
  assert.equal(st.headingOrder, brg, "la poursuite continue vers la balise capturée");
});

test("autoguidage (3 positions) : filtre à l'engagement uniquement", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const cap = { strength: 92, source: "dir", bearing: 0, side: "centre" };
  const mk = (mode) => {
    const st = newPlayerState(w, { weatherSeed: 1 });
    st.x = b.x; st.y = b.y - 40 / DEG_KM;
    st.heading = 90; st.headingOrder = 90;
    st.anchored = false; // en navigation : le verrou peut s'engager
    if (mode) st.autoguide = mode;
    return st;
  };
  // défaut (actives) : verrou sur une balise active
  const stDef = mk(null);
  onProximityPing(stDef, b, cap);
  assert.equal(stDef.beaconLock, b.code, "défaut (actives seules) : verrou sur balise active");
  assert.equal(stDef.signals[stDef.signals.length - 1].off, false, "flag off absent");
  // mode désactivées : une balise ACTIVE ne verrouille plus (journal seul)
  const stOff = mk("disabled");
  onProximityPing(stOff, b, cap);
  assert.equal(stOff.beaconLock, null, "mode désactivées : pas de verrou sur une active");
  assert.equal(stOff.headingOrder, 90, "consigne de cap intacte");
  assert.equal(stOff.signals[stOff.signals.length - 1].kind, "prox", "le ping reste journalisé");
  // mode désactivées : une balise CAPTURÉE verrouille
  b.active = false;
  const stDis = mk("disabled");
  onProximityPing(stDis, b, cap);
  assert.equal(stDis.beaconLock, b.code, "mode désactivées : verrou sur balise capturée");
  assert.equal(stDis.signals[stDis.signals.length - 1].off, true, "flag off dans le journal");
  // mode actives : une balise CAPTURÉE ne verrouille plus
  const stAct = mk("active");
  onProximityPing(stAct, b, cap);
  assert.equal(stAct.beaconLock, null, "mode actives : pas de verrou sur une capturée");
  assert.equal(stAct.signals[stAct.signals.length - 1].off, true, "le ping de la capturée reste journalisé");
  // un verrou déjà engagé survit au changement d'interrupteur
  onProximityPing(stDis, b, cap);
  stDis.autoguide = "active";
  onProximityPing(stDis, b, cap);
  assert.equal(stDis.beaconLock, b.code, "verrou engagé : insensible au changement de mode");
});

test("computeView : une balise capturée reste visible (flag off)", () => {
  const w = buildWorld(77);
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  st.location = "surface";
  st.x = b.x; st.y = b.y; // sur la balise : visible quel que soit le temps
  const v1 = computeView(st, w);
  assert.ok(v1.beacons.some((e) => e.id === b.id && !e.off), "active : visible sans flag");
  b.active = false;
  const v2 = computeView(st, w);
  assert.ok(v2.beacons.some((e) => e.id === b.id && e.off), "capturée : toujours visible, flag off");
});

test("segDistKm : distance point-segment", () => {
  // point au-dessus du milieu d'un segment horizontal
  const d = segDistKm(30.001, 30.001, 30, 30, 30.002, 30);
  assert.ok(Math.abs(d - 0.001 * DEG_KM) < 0.001, `distance ~0.05 km (actuel: ${d})`);
});

// ---------- Sonar ----------
const sonarStubWorld = { ISLANDS: [{ x: 30, y: 31 }], BEACONS: [], COAST: [[20, 30], [20, 20]] };
function subAt(w) { // navire de test en plongée, à (30, 30)
  const st = newPlayerState(w);
  st.x = 30; st.y = 30; st.estX = 30; st.estY = 30;
  st.location = "underwater";
  return st;
}

test("sonar : constantes (son 5400 km/h, décroissance 500 km, portée 200 km, coût 1 %)", () => {
  assert.equal(SOUND_KMH, 5400);          // ≈ 1500 m/s
  assert.equal(SOUND_DECAY_KM, 500);
  assert.equal(SONAR_RANGE_KM, 200);
  assert.equal(SONAR_PING_BATTERY_COST, 1);
  assert.equal(SONAR_ECHO_PERSIST_S, 10);
});

test("sonar : retard du son — 200 km ≈ 2,22 min de jeu", () => {
  assert.ok(Math.abs(soundTravelMin(200) - 200 / (SOUND_KMH / 60)) < 1e-9);
  assert.ok(Math.abs(soundTravelMin(200) - 2.222) < 0.01);
});

test("sonarPing : refusé en surface, refusé sans batteries", () => {
  const w = buildWorld(42);
  const st = subAt(w);
  st.location = "surface";
  assert.equal(sonarPing(st, w).ok, false, "surface : refus");
  st.location = "underwater";
  st.battery = 0.5;
  assert.equal(sonarPing(st, w).ok, false, "moins de 1 % : refus");
});

test("sonarPing : coût 1 % + écho d'île (az, distance, arrivée = 2 × retard)", () => {
  const w = buildWorld(42);
  const st = subAt(w);
  st.t = 100;
  const bat0 = st.battery;
  const r = sonarPing(st, sonarStubWorld);
  assert.ok(r.ok);
  assert.ok(Math.abs(st.battery - (bat0 - SONAR_PING_BATTERY_COST)) < 1e-9, "coût débité");
  const e = r.echoes.find((x) => x.kind === "ile");
  assert.ok(e, "l'île à 50 km rebondit");
  assert.ok(Math.abs(e.dKm - 50) < 1e-6);
  assert.equal(e.az, 0, "gisement plein nord");
  assert.ok(Math.abs(e.arriveMin - (100 + 2 * soundTravelMin(50))) < 1e-9, "retour = 2 × retard du son");
});

test("sonarPing : rien au-delà de 200 km, navire immergé invisible", () => {
  const w = buildWorld(42);
  const st = subAt(w);
  const far = { ISLANDS: [{ x: 30 + 210 / DEG_KM, y: 30 }], BEACONS: [], COAST: [[20, 30], [20, 20]] };
  assert.ok(!sonarPing(st, far).echoes.some((e) => e.kind === "ile"), "île à 210 km : aucun écho");
  const others = [
    { x: 30.5, y: 30, location: "surface" },     // 25 km, en surface
    { x: 30.4, y: 30, location: "underwater" },   // 20 km, immergé
  ];
  const nav = sonarPing(st, sonarStubWorld, others).echoes.filter((e) => e.kind === "navire");
  assert.equal(nav.length, 1, "un seul navire rebondit");
  assert.ok(Math.abs(nav[0].dKm - 25) < 0.01, "c'est le navire de surface (l'immergé est invisible)");
});

test("sonarPassiveHear : gisement seul, force uniforme, silence à 500 km", () => {
  const w = buildWorld(42);
  const st = subAt(w);
  const h250 = sonarPassiveHear(st, 30, 30 + 250 / DEG_KM);
  assert.ok(h250 && h250.bearing === 0 && h250.strength === 50, "250 km : plein nord, 50 %");
  assert.equal("distKm" in (h250 || {}), false, "aucune distance en passif");
  assert.equal(sonarPassiveHear(st, 30, 30 + 500 / DEG_KM), null, "500 km : silence");
  assert.equal(sonarPassiveHear(st, 30 + 400 / DEG_KM, 30).bearing, 90, "gisement est");
});

test("shipNoisy : moteur diesel en surface seulement", () => {
  const w = buildWorld(42);
  const st = subAt(w);
  assert.equal(shipNoisy(st), false, "plongée : silencieux");
  st.location = "surface"; st.mast = true; st.engineOn = false;
  assert.equal(shipNoisy(st), false, "à la voile : silencieux");
  st.engineOn = true;
  assert.equal(shipNoisy(st), true, "moteur en surface : bruyant");
  st.fuel = 0;
  assert.equal(shipNoisy(st), false, "panne sèche : silencieux");
});

test("nearestOnLine : point le plus proche de la polyligne", () => {
  const p = nearestOnLine(21, 25, [[20, 30], [20, 20]]);
  assert.ok(Math.abs(p[0] - 20) < 1e-9 && Math.abs(p[1] - 25) < 1e-9);
});

// ---------- Vie du monde (NPC v1) ----------
test("npcs : constantes (50 pêcheurs, 3 cargos, 100 baleines)", () => {
  assert.equal(NPC_FISHERMEN, 50);
  assert.equal(NPC_CARGOS, 3);
  assert.equal(NPC_WHALES, 100);
  assert.equal(FISHER_RANGE_KM, 100);
  assert.equal(FISHER_MIN_OFF_KM, 3);
  assert.equal(CARGO_SPD_KMH, 30);
  assert.equal(WHALE_SPD_KMH, 10);
});

test("generateNpcs : population complète, codes uniques, spots en mer", () => {
  const w = buildWorld(42);
  const npcs = generateNpcs(w, [], 1000);
  assert.equal(npcs.fishermen.length, NPC_FISHERMEN);
  assert.equal(npcs.cargos.length, NPC_CARGOS);
  assert.equal(npcs.whales.length, NPC_WHALES);
  const codes = new Set([...npcs.fishermen, ...npcs.cargos].map((n) => n.code));
  assert.equal(codes.size, NPC_FISHERMEN + NPC_CARGOS, "codes radio uniques");
  for (const f of npcs.fishermen)
    assert.ok(!w.isLand(f.x, f.y), "pêcheur en mer");
  for (const wh of npcs.whales)
    assert.ok(!w.isLand(wh.x, wh.y), "baleine en mer");
  for (const f of npcs.fishermen)
    assert.ok(f.nextChatMin > 1000, "timer de bafouillage dans le futur");
});

test("npcNoisy : cargo toujours, pêcheur en transit seulement, baleine jamais", () => {
  assert.equal(npcNoisy({ kind: "cargo" }), true);
  assert.equal(npcNoisy({ kind: "fisher", mode: "transit" }), true);
  assert.equal(npcNoisy({ kind: "fisher", mode: "peche" }), false);
  assert.equal(npcNoisy({ kind: "whale" }), false);
});

test("npcBackPos : retour linéaire sur la route (retard du son)", () => {
  const npc = { x: 30, y: 30, heading: 90, spd: 30 }; // cap est, 30 km/h
  const p = npcBackPos(npc, 60); // 60 min en arrière : 30 km vers l'ouest
  assert.ok(Math.abs(p.x - (30 - 30 / DEG_KM)) < 1e-9);
  assert.ok(Math.abs(p.y - 30) < 1e-9);
  const immobile = npcBackPos({ x: 10, y: 10, heading: 45, spd: 0 }, 120);
  assert.equal(immobile.x, 10); // immobile : la position passée = présente
});

test("nextNpcEventMin : tirage uniforme 0,5×–1,5× la cadence moyenne", () => {
  for (let k = 0; k < 50; k++) {
    const at = nextNpcEventMin(100, WHALE_SONG_MEAN_MIN);
    assert.ok(at >= 100 + Math.round(0.5 * WHALE_SONG_MEAN_MIN) - 1 && at <= 100 + Math.round(1.5 * WHALE_SONG_MEAN_MIN) + 1);
  }
});

test("npcsTick : les NPC avancent, personne ne pose nageoire sur la terre", () => {
  const w = buildWorld(42);
  const npcs = generateNpcs(w, [], 0);
  // force tous les pêcheurs en transit et les baleines proches des terres :
  // le garde-fou doit tenir sur un gros dt.
  for (const f of npcs.fishermen) { f.mode = "transit"; f.fishMin = 0; }
  npcsTick(npcs, NPC_TICK_MAX_MIN, w);
  for (const f of npcs.fishermen)
    assert.ok(!w.isLand(f.x, f.y), `pêcheur ${f.id} en mer`);
  for (const c of npcs.cargos)
    assert.ok(!w.isLand(c.x, c.y), `cargo ${c.id} en mer`);
  for (const wh of npcs.whales)
    assert.ok(!w.isLand(wh.x, wh.y), `baleine ${wh.id} en mer`);
  // sous-pas : un dt borné est consommé entièrement
  const before = npcs.cargos[0].x + npcs.cargos[0].y;
  npcsTick(npcs, NPC_SUBSTEP_MIN, w);
  assert.ok(Math.abs((npcs.cargos[0].x + npcs.cargos[0].y) - before) > 0, "le cargo avance");
});

test("npcFishermanTick : marée finie → transit, arrivé → pêche", () => {
  const w = buildWorld(42);
  const f = { kind: "fisher", id: "ft", code: "FT1", x: 30, y: 30, heading: 0, spd: 0,
    mode: "peche", fishMin: FISHER_FISH_MIN, spotX: 30, spotY: 30, nextChatMin: 0 };
  npcFishermanTick(f, FISHER_FISH_MIN, w);
  assert.equal(f.mode, "transit", "marée finie → transit");
  npcFishermanTick(f, 1, w); // le pas de transit allume le moteur
  assert.equal(f.spd > 0, true, "moteur allumé en transit");
  assert.equal(npcNoisy(f), true, "transit : bruyant");
  // on le pose pile sur son spot : arrivée → pêche, silencieux
  f.x = f.spotX; f.y = f.spotY;
  npcFishermanTick(f, 1, w);
  assert.equal(f.mode, "peche", "arrivé → pêche");
  assert.equal(f.spd, 0, "moteur coupé en pêche");
  assert.equal(npcNoisy(f), false, "pêche : silencieux");
  assert.ok(f.fishMin >= FISHER_FISH_MIN && f.fishMin <= FISHER_FISH_MIN + FISHER_FISH_SPAN_MIN);
});

test("npcsTick : baleine jamais hors carte après un gros pas", () => {
  const w = buildWorld(42);
  const npcs = generateNpcs(w, [], 0);
  for (const wh of npcs.whales) { wh.x = 1; wh.y = 1; wh.heading = 315; } // cap nord-ouest : vers le bord
  npcsTick(npcs, NPC_TICK_MAX_MIN, w);
  for (const wh of npcs.whales) {
    assert.ok(wh.x >= 0 && wh.x <= 60 && wh.y >= 0 && wh.y <= 60, "baleine dans la carte");
    assert.ok(!w.isLand(wh.x, wh.y), "baleine en mer");
  }
});


// ---------- La Bête v1 ----------
const beastStubWorld = { isLand: () => false };

test("bête : constantes (50 km/h, faim 12 h, frappe 2 km, spawn ≥ 1000 km, traces 12 h)", () => {
  assert.equal(BEAST_SPD_KMH, 50);
  assert.equal(BEAST_HUNGER_MIN, 720);
  assert.equal(BEAST_STRIKE_KM, 2);
  assert.equal(BEAST_SPAWN_MIN_PORT_KM, 1000);
  assert.equal(BEAST_TRACE_PERSIST_MIN, 720);
});

test("beastSpawn : pleine eau, à au moins 1000 km du port (plusieurs graines)", () => {
  for (const seed of [1, 42, 777]) {
    const w = buildWorld(seed);
    const b = beastSpawn(w);
    assert.ok(!w.isLand(b.x, b.y), `graine ${seed} : spawn en mer`);
    assert.ok(distKm(b.x, b.y, w.PORT.x, w.PORT.y) >= BEAST_SPAWN_MIN_PORT_KM, `graine ${seed} : ≥ 1000 km du port`);
  }
});

test("bête : rassasiée immobile (jauge décroît) ; affamée sans bruit, à l'écoute immobile", () => {
  const beast = { x: 30, y: 30, heading: 0, hunger: 1 };
  beastTick(beast, 60, beastStubWorld, [{ x: 31, y: 30, liveX: 31, liveY: 30, ref: {} }]);
  assert.equal(beast.x, 30); assert.equal(beast.y, 30, "rassasiée : immobile malgré une proie audible");
  assert.ok(Math.abs(beast.hunger - (1 - 60 / BEAST_HUNGER_MIN)) < 1e-9, "jauge décroît linéairement");
  beast.hunger = 0;
  beastTick(beast, 60, beastStubWorld, []);
  assert.equal(beast.x, 30); assert.equal(beast.y, 30, "affamée sans source : à l'écoute, immobile");
  assert.equal(beast.hunger, 0);
});

test("bête : affamée, elle file sur la source et mange (jauge pleine, cible renvoyée)", () => {
  const target = { kind: "whale", x: 30, y: 30 + 10 / DEG_KM }; // chante à 10 km au nord
  const beast = { x: 30, y: 30, heading: 0, hunger: 0 };
  const eaten = beastTick(beast, 12, beastStubWorld,
    [{ x: target.x, y: target.y, liveX: target.x, liveY: target.y, ref: target }]);
  assert.equal(eaten, target, "la cible est mangée");
  assert.equal(beast.hunger, 1, "repue : jauge pleine");
  assert.ok(distKm(beast.x, beast.y, target.x, target.y) <= BEAST_STRIKE_KM, "elle est à portée de frappe");
});

test("bête : un chant ancien ne nourrit pas — la baleine a bougé, le silence protège", () => {
  const whale = { kind: "whale", x: 30 + 20 / DEG_KM, y: 30 }; // 20 km à l'est depuis l'émission
  const beast = { x: 30, y: 30, heading: 0, hunger: 0 };
  const eaten = beastTick(beast, 30, beastStubWorld,
    [{ x: 30, y: 30 + 10 / DEG_KM, liveX: whale.x, liveY: whale.y, ref: whale }]); // chant entendu 10 km au nord
  assert.equal(eaten, null, "pas de repas : la baleine n'est plus au point d'émission");
  assert.equal(beast.hunger, 0, "toujours affamée");
  assert.ok(distKm(beast.x, beast.y, 30, 30 + 10 / DEG_KM) <= BEAST_STRIKE_KM,
    "elle a rejoint le point d'émission, puis s'arrête (source morte)");
});

test("computeView : épave et carcasse visibles à portée de trace, jamais au-delà", () => {
  const w = buildWorld(42);
  let st = null;
  for (let seed = 0; seed < 60; seed++) {
    const cand = newPlayerState(w, { weatherSeed: seed });
    cand.x = 30; cand.y = 30; cand.estX = 30; cand.estY = 30;
    cand.location = "surface"; cand.t = 600; // 10 h de jeu : jour
    if (computeView(cand, w, []).visKm >= 15) { st = cand; break; }
  }
  assert.ok(st, "un temps clair trouvé pour la vue");
  const traces = [
    { kind: "epave", x: 30.1, y: 30 },     // 5 km à l'est
    { kind: "carcasse", x: 30, y: 30.2 },  // 10 km au nord
    { kind: "epave", x: 10, y: 10 },        // très loin : hors de vue
  ];
  const v = computeView(st, w, traces);
  assert.ok(v.traces.some((t) => t.kind === "epave" && Math.abs(t.km - 5) < 0.01), "épave à 5 km dans la vue");
  assert.ok(v.traces.some((t) => t.kind === "carcasse" && Math.abs(t.km - 10) < 0.01), "carcasse à 10 km dans la vue");
  assert.ok(v.traces.every((t) => t.km <= 15), "rien au-delà de la portée de trace");
  // plongée : rien à voir
  st.location = "underwater"; st.periscope = false;
  assert.equal(computeView(st, w, traces).traces.length, 0, "immergé sans périscope : aucune trace");
});

test("fabriques NPC : mêmes champs que generateNpcs (respawn à population constante)", () => {
  const w = buildWorld(42);
  const f = makeFisherman(w, "1234", 0);
  const c = makeCargo(w, "2345", 0);
  const wh = makeWhale(w, 0);
  assert.equal(f.kind, "fisher"); assert.equal(f.code, "1234"); assert.equal(f.mode, "peche");
  assert.ok(f.nextChatMin > 0, "timer de bafouillage dans le futur");
  assert.equal(c.kind, "cargo"); assert.equal(c.spd, CARGO_SPD_KMH);
  assert.equal(wh.kind, "whale"); assert.equal(wh.spd, WHALE_SPD_KMH); assert.ok(wh.nextSongMin > 0);
  assert.ok(!w.isLand(f.x, f.y), "pêcheur en mer");
  assert.ok(!w.isLand(c.x, c.y), "cargo en mer");
  assert.ok(!w.isLand(wh.x, wh.y), "baleine en mer");
});

// ---------- Estimation : la carte de la compagnie ----------
test("estimation : constantes (bulletin 6 h, balises 200 km, plancher 40, plafond 800)", () => {
  assert.equal(EXCLUSION_BULLETIN_MIN, 360);
  assert.equal(BEACON_HEAR_KM, 200);
  assert.equal(ESTIMATE_MIN_R_KM, 40);
  assert.equal(ESTIMATE_MAX_R_KM, 800);
  assert.equal(ESTIMATE_GROWTH_KMH, 2);
});

test("bearingCross : croisement à 90° exact, parallèles rejetées", () => {
  // source à (20, 30) : plein nord de A (20,10), plein est de B (5,30)
  const c = bearingCross({ x: 20, y: 10, brg: 0 }, { x: 5, y: 30, brg: 90 });
  assert.ok(c, "croisement à 90°");
  assert.ok(Math.abs(c.x - 20) < 1e-9 && Math.abs(c.y - 30) < 1e-9, "intersection au point source");
  assert.equal(bearingCross({ x: 0, y: 0, brg: 0 }, { x: 5, y: 5, brg: 5 }), null, "quasi-parallèles : pas de triangulation");
});

test("estimateZone : aucune donnée vivante → null", () => {
  assert.equal(estimateZone([], 0), null);
  assert.equal(estimateZone([{ k: "cry", x: 10, y: 10, brg: 45, t: 0 }], 0), null, "un gisement seul ne triangule pas");
  assert.equal(estimateZone([{ k: "cry", x: 10, y: 10, brg: 45, t: 0 }, { k: "cry", x: 20, y: 20, brg: 50, t: 0 }], 0), null, "deux gisements quasi parallèles : null");
});

test("estimateZone : une trace fraîche → zone centrée dessus, rayon plancher", () => {
  const z = estimateZone([{ k: "trace", x: 20, y: 20, t: 0 }], 0);
  assert.ok(Math.abs(z.x - 20) < 1e-9 && Math.abs(z.y - 20) < 1e-9, "centrée sur le point");
  assert.equal(z.rKm, ESTIMATE_MIN_R_KM, "rayon plancher");
});

test("estimateZone : deux gisements croisés → zone près de la source", () => {
  const z = estimateZone([
    { k: "cry", x: 20, y: 10, brg: 0, t: 0 },
    { k: "cry", x: 5, y: 30, brg: 90, t: 0 },
  ], 0);
  assert.ok(Math.abs(z.x - 20) < 1e-6 && Math.abs(z.y - 30) < 1e-6, "triangulation serrée");
  assert.equal(z.rKm, ESTIMATE_MIN_R_KM, "données fraîches et concordantes : plancher");
});

test("estimateZone : la zone regonfle avec l'âge des relevés", () => {
  const z = estimateZone([{ k: "trace", x: 20, y: 20, t: 0 }], 360); // 6 h plus tard
  assert.ok(Math.abs(z.rKm - (ESTIMATE_MIN_R_KM + 6 * ESTIMATE_GROWTH_KMH)) < 1e-6, "+2 km/h depuis le relevé le plus frais");
});

test("estimateZone : relevés trop vieux sont morts → null", () => {
  const old = 10 * ESTIMATE_HALF_LIFE_MIN;
  assert.equal(estimateZone([{ k: "trace", x: 20, y: 20, t: -old }], 0), null);
});

test("estimateZone : relevés dispersés → rayon plafonné", () => {
  const z = estimateZone([
    { k: "trace", x: 10, y: 10, t: 0 },
    { k: "trace", x: 40, y: 40, t: 0 },
  ], 0);
  assert.equal(z.rKm, ESTIMATE_MAX_R_KM, "dispersion énorme : plafond atteint");
});

// ---------- Le Patrouilleur + fuite de la créature ----------
test("patrouilleur : constantes (40 km/h, canon 2 min, engagement 10 min, répit 4 h)", () => {
  assert.equal(PATROL_SPD_KMH, 40);
  assert.equal(PATROL_CANNON_EVERY_MIN, 2);
  assert.equal(PATROL_ENGAGE_MIN, 10);
  assert.equal(PATROL_DETECT_COOLDOWN_MIN, 240);
  assert.equal(PATROL_DETECT_R_KM, 30);
  assert.equal(PATROL_TICK_MAX_MIN, 120);
  assert.equal(CANNON_DECAY_KM, 1000);
});

test("patrolDetectPerMin : effort montant avec la fouille, plafonné", () => {
  assert.equal(patrolDetectPerMin(0), 0.005);
  assert.ok(patrolDetectPerMin(600) > patrolDetectPerMin(0), "ça grimpe à force de fouiller");
  assert.equal(patrolDetectPerMin(1000), 0.1, "plafond 10 %/min");
});

test("patrolTick : sans zone, la frégate reste à quai", () => {
  const w = buildWorld(42);
  const p = { x: 30, y: 30, mode: "quai", searchMin: 0, searchAcc: 0 };
  const ev = patrolTick(p, 120, w, null, { x: 30, y: 30 });
  assert.deepEqual(ev, [], "aucun événement");
  assert.equal(p.mode, "quai");
  assert.equal(p.x, 30, "immobile");
});

test("patrolTick : zone → transit vers le centre à 40 km/h", () => {
  const w = buildWorld(42);
  const p = { x: 30, y: 30, mode: "quai", searchMin: 0, searchAcc: 0 };
  patrolTick(p, 60, w, { x: 32, y: 30, rKm: 100 }, null);
  assert.equal(p.mode, "transit", "encore en transit (zone à 100 km)");
  const d = distKm(30, 30, p.x, p.y);
  assert.ok(Math.abs(d - 40) < 1, "60 minutes à 40 km/h : 40 km parcourus");
});

test("patrolTick : détection par effort cumulé quand la créature est à portée", () => {
  const w = buildWorld(42);
  const p = { x: 30, y: 30, mode: "recherche", tgtX: 31, tgtY: 30, searchMin: 5000, searchAcc: 0, cooldownLeftMin: 0 };
  const ev = patrolTick(p, 10, w, { x: 30.5, y: 30, rKm: 100 }, { x: 30.3, y: 30 });
  assert.equal(ev.length, 1, "un contact");
  assert.equal(ev[0].k, "detect", "l'événement est un contact");
  assert.ok(Math.abs(ev[0].x - 30.3) < 1e-9 && Math.abs(ev[0].y - 30) < 1e-9, "position vue incluse");
  assert.equal(p.mode, "engage", "la frégate engage");
});

test("patrolTick : créature hors du rayon de balayage → jamais de contact", () => {
  const w = buildWorld(42);
  const p = { x: 30, y: 30, mode: "recherche", tgtX: 31, tgtY: 30, searchMin: 5000, searchAcc: 0, cooldownLeftMin: 0 };
  const ev = patrolTick(p, 120, w, { x: 30.5, y: 30, rKm: 100 }, { x: 33, y: 30 });
  assert.deepEqual(ev, [], "aucun contact à 150 km");
  assert.notEqual(p.mode, "engage");
});

test("patrolTick : engagement = coups de canon cadencés, puis répit de 4 h", () => {
  const w = buildWorld(42);
  const p = { x: 30, y: 30, mode: "engage", engageLeftMin: PATROL_ENGAGE_MIN, shotClock: 0, cooldownLeftMin: 0, searchAcc: 0, searchMin: 0 };
  const ev = patrolTick(p, 10, w, { x: 30, y: 30, rKm: 100 }, null);
  assert.equal(ev.length, Math.round(PATROL_ENGAGE_MIN / PATROL_CANNON_EVERY_MIN), "un coup de canon par tranche de 2 min");
  assert.ok(ev.every((e) => e.k === "shot"), "que des tirs");
  assert.equal(p.mode, "recherche", "retour en recherche après l'engagement");
  assert.equal(p.cooldownLeftMin, PATROL_DETECT_COOLDOWN_MIN, "répit : la zone regonfle");
});

test("patrolTick : pendant le répit, aucune détection même à portée", () => {
  const w = buildWorld(42);
  const p = { x: 30, y: 30, mode: "recherche", tgtX: 31, tgtY: 30, searchMin: 5000, searchAcc: 0, cooldownLeftMin: PATROL_DETECT_COOLDOWN_MIN };
  const ev = patrolTick(p, 120, w, { x: 30.5, y: 30, rKm: 100 }, { x: 30.3, y: 30 });
  assert.deepEqual(ev, [], "pas de contact pendant le répit");
  assert.equal(p.cooldownLeftMin, PATROL_DETECT_COOLDOWN_MIN - 120, "le répit s'épuise avec le temps");
});

test("beastFlee : deux régimes possibles, cap opposé au patrouilleur", () => {
  const b = { x: 30, y: 35 };
  beastFlee(b, 30, 30);
  const short = b.fleeLeftMin === (50 / BEAST_SPD_KMH) * 60 && b.fleeSpdKmh === BEAST_SPD_KMH;
  const long = b.fleeLeftMin === 240 && b.fleeSpdKmh === 60;
  assert.ok(short || long, "régime court (50 km) ou long (4 h à 60 km/h)");
  assert.ok(b.fleeHeading >= 330 || b.fleeHeading <= 30, "elle fuit vers le nord (opposé au patrouilleur au sud) ± 30°");
});

test("beastTick : en fuite, elle court en ligne droite et ne mange pas", () => {
  const w = buildWorld(42);
  const target = { kind: "fisher", x: 30.05, y: 30 };
  const beast = { x: 30, y: 30, heading: 0, hunger: 0, fleeLeftMin: 60, fleeSpdKmh: BEAST_SPD_KMH, fleeHeading: 0 };
  const eaten = beastTick(beast, 60, w, [{ x: 30.05, y: 30, liveX: target.x, liveY: target.y, ref: target }]);
  assert.equal(eaten, null, "en fuite : pas de repas, même à portée de frappe");
  assert.ok(Math.abs(beast.y - 31) < 1e-6, "50 km vers le nord (1°)");
  assert.equal(beast.fleeLeftMin, 0, "la fuite est consommée");
});
