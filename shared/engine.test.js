import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorld, newPlayerState, tick, weatherAt,
  distNm, CAPTURE_R_NM, DELIVERY_R_NM, KM_PER_NM, sailPolarFactor,
} from "./engine.js";

test("monde déterministe : même graine = même géométrie", () => {
  const a = buildWorld(12345);
  const b = buildWorld(12345);
  assert.deepEqual(a.PORT, b.PORT);
  assert.equal(a.BEACONS.length, b.BEACONS.length);
  assert.equal(a.BEACONS[3].x, b.BEACONS[3].x);
});

test("18 balises, séparées de 100 NM, hors terre, à >222 NM du port", () => {
  const w = buildWorld(777);
  assert.equal(w.BEACONS.length, 21); // 10 communes + 6 rares + 4 légendaires + 1 inconnue (proto)
  for (let i = 0; i < w.BEACONS.length; i++) {
    const a = w.BEACONS[i];
    assert.equal(w.isLand(a.x, a.y), false, `balise ${a.id} sur terre`);
    assert.ok(distNm(a.x, a.y, w.PORT.x, w.PORT.y) > 220, `balise ${a.id} trop près du port`);
    for (let j = i + 1; j < w.BEACONS.length; j++) {
      assert.ok(distNm(a.x, a.y, w.BEACONS[j].x, w.BEACONS[j].y) >= 99.9);
    }
  }
});

test("capture et livraison à 500 m", () => {
  assert.ok(Math.abs(CAPTURE_R_NM * KM_PER_NM - 0.5) < 1e-9);
  assert.ok(Math.abs(DELIVERY_R_NM * KM_PER_NM - 0.5) < 1e-9);
});

test("météo déterministe", () => {
  const a = weatherAt(30, 30, 1000, 42);
  const b = weatherAt(30, 30, 1000, 42);
  assert.deepEqual(a, b);
});

test("tick : navire au moteur avance et consomme", () => {
  const w = buildWorld(42);
  const st = newPlayerState(w);
  st.heading = w.CONTINENT.x1 <= 30 ? 90 : 270; // vers le large
  st.engineOn = true;
  st.engine = 1;
  const fuel0 = st.fuel;
  for (let i = 0; i < 600; i++) tick(st, 1, w); // 10 h de jeu
  assert.ok(st.travelledNm > 50, `distance parcourue: ${st.travelledNm}`);
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

test("capture de balise désactivée pour tous (état partagé)", () => {
  const w = buildWorld(4242);
  const st = newPlayerState(w);
  const b = w.BEACONS.find((x) => x.active);
  st.x = b.x + 0.001; st.y = b.y; // < 500 m
  st.location = "surface";
  tick(st, 1, w);
  assert.equal(b.active, false);
  assert.equal(st.codes.length, 1);
  assert.equal(st.score, 0, "score uniquement à la livraison");
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

test("point aux étoiles : réussit la nuit sous ciel clair et réduit l'incertitude", () => {
  const w = buildWorld(7);
  // conditions claires la nuit (seed 0, position 45,45, t=1500 = 1h)
  const st = newPlayerState(w, { weatherSeed: 0 });
  st.t = 1500; st.x = 45; st.y = 45; st.heading = 90;
  st.unc = 25;
  for (let i = 0; i < 200; i++) tick(st, 1, w);
  assert.ok(st.unc < 25, `l'incertitude doit diminuer (actuel: ${st.unc})`);
  const navNotifs = st.notifications.filter((n) => n.cat === "nav").map((n) => n.text);
  assert.ok(navNotifs.some((t) => t.includes("Point aux étoiles")), "une notif point aux étoiles doit exister");
});

test("polaire de voile : le vent arrière reste viable, le travers optimal", () => {
  assert.equal(sailPolarFactor(90), 1.0);
  assert.equal(sailPolarFactor(160), 0.6);
  assert.equal(sailPolarFactor(180), 0.5);
  // le choix tactique VMG : zigzag à 135° > cap direct à 180°
  assert.ok(sailPolarFactor(135) * Math.cos((45 * Math.PI) / 180) > sailPolarFactor(180));
});

test("inertie surface : convergence ~2,8 min vers la vitesse cible", () => {
  const w = buildWorld(42);
  const st = newPlayerState(w);
  st.heading = w.CONTINENT.x1 <= 30 ? 90 : 270;
  st.mast = true;
  st.sail = 1;
  // simulateur : la vitesse tend vers la cible à 6 kn/min (surface)
  for (let i = 0; i < 180; i++) tick(st, 1, w); // 3 h de jeu
  // après 3 h la vitesse doit être stabilisée proche de sa cible
  assert.ok(st.vkn > 0, "le navire doit avoir pris de la vitesse");
});


// Navire de test en pleine eau (loin du port et des terres), pleine vitesse.
function shipAtSea(w, { heading = 90, order = 90 } = {}) {
  const st = newPlayerState(w);
  st.x = 30; st.y = 30; st.estX = 30; st.estY = 30; // milieu de l'océan
  st.engineOn = true; st.engine = 1; // moteur : vitesse cible 15 kn
  st.vkn = 15;
  st.heading = heading;
  st.headingOrder = order;
  return st;
}

test("giration : consigne +90° à pleine vitesse atteinte en ~20 s, sans dépassement", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 0, order: 90 });
  st.vkn = 20; // pleine vitesse pour le taux plein (test giration pure)
  let ticks = 0;
  let maxHeading = 0;
  while (st.heading !== 90 && ticks < 60) {
    tick(st, 1 / 60, w); // 1 s de jeu par tick
    ticks++;
    maxHeading = Math.max(maxHeading, st.heading);
  }
  assert.equal(st.heading, 90);
  assert.equal(ticks, 20, `90° à 270°/min = 20 s (actuel: ${ticks})`);
  assert.ok(maxHeading <= 90, "jamais de dépassement");
});

test("giration : plus court chemin à travers le nord (10° → 350° = −20°)", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 10, order: 350 });
  st.vkn = 20;
  tick(st, 1, w); // 1 min : le chemin court (−20°) est couvert
  // après 1 tick de 1 min la rotation est au plus 270° : le cap doit être
  // passé par le chemin court (vers 350, pas vers +340 de l'autre sens)
  const diff = ((350 - st.heading + 540) % 360) - 180;
  assert.ok(Math.abs(diff) < 180, "le navire a tourné par le plus court chemin");
  // petit pas : vérifions le sens sur 1 s
  const st2 = shipAtSea(w, { heading: 10, order: 350 });
  st2.vkn = 20;
  tick(st2, 1 / 60, w);
  assert.ok(Math.abs(st2.heading - 5.5) < 0.01, `1 s à 4,5°/s : 10 → 5,5 (actuel: ${st2.heading})`);
  assert.ok(st2.heading < 10, "giration par le plus court chemin : sens négatif (à travers le nord)");
});

test("anti-deadlock : navire échoué (vkn=0) vire quand même à 25 % du taux", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 0, order: 90 });
  st.vkn = 0;
  st.grounded = true; // simulé : navire échoué, barre seule disponible
  tick(st, 1 / 60, w); // 1 s
  // 270 × 0.25 = 67.5 °/min = 1.125 °/s
  assert.ok(Math.abs(st.heading - 1.125) < 0.01, `1,125° attendu après 1 s (actuel: ${st.heading})`);
});

test("migration : état sans headingOrder → aucune giration intempestive", () => {
  const w = buildWorld(42);
  const st = newPlayerState(w);
  delete st.headingOrder;
  const capAvant = st.heading;
  tick(st, 1, w);
  assert.equal(st.heading, capAvant, "cap inchangé au premier tick");
  assert.equal(st.headingOrder, capAvant, "consigne migrée = cap courant");
});

test("grands pas : rotation totale bornée par le taux, trajectoire cohérente", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 0, order: 90 });
  st.vkn = 20;
  const x0 = st.x, y0 = st.y;
  tick(st, 5, w); // 5 min d'un coup : 270°/min × 5 = 1350° possibles
  assert.equal(st.heading, 90, "consigne atteinte, pas de tours complets");
  // le navire a avancé pendant le virage (trajectoire d'arc), pas sur place
  const moved = Math.hypot(st.x - x0, st.y - y0);
  assert.ok(moved > 0, "position intégrée pendant la giration");
});

// ---------- Pilote automatique / planificateur ----------
import { WP_R_NM, bearingTo, KM_PER_DEG, callPosition } from "./engine.js";

test("pilote : la consigne vise le point depuis l'estime", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.waypoints = [{ x: 30.1, y: 30 }]; // point plein est
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 1 / 60, w);
  assert.ok(Math.abs(((st.headingOrder - 90 + 540) % 360) - 180) < 1, "consigne ≈ bearing vers le point");
  assert.equal(Math.round(st.headingOrder), Math.round(bearingTo(st.estX, st.estY, 30.1, 30)));
});

test("validation sur trace estimée : wpIdx avance quand le pas traverse les 100 m", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.vkn = 20;
  st.waypoints = [{ x: 30.01, y: 30 }]; // ~0.66 NM à l'est = 1.2 km > 100 m
  st.wpIdx = 0;
  st.autopilot = true;
  // 5 min à 20 kn = 1.67 NM : le pas traverse largement le disque de 100 m
  tick(st, 5, w);
  assert.equal(st.wpIdx, 1, "point validé au passage");
  assert.ok(st.notifications.some((n) => n.text.includes("Point 1/1 atteint")), "notification présente");
});

test("mauvaise navigation légitime : courant traversier — la vraie position diverge, la route se valide à l'estime", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.vkn = 20;
  st.waypoints = [{ x: 30.01, y: 30 }]; // ~0.66 NM : franchi en un pas de 5 min à 15 kn
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 5, w);
  // le point est validé SUR L'ESTIME pendant que la vraie position a divergé
  assert.equal(st.wpIdx, 1, "validé à l'estime");
  const drift = Math.hypot(st.x - st.estX, st.y - st.estY) * KM_PER_DEG;
  assert.ok(drift > 0, `la vraie position a divergé de l'estime (${drift.toFixed(2)} km) — navigation dégradée légitime`);
});

test("enchaînement : deux points proches traversés en un pas de 5 min", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.vkn = 20;
  st.waypoints = [{ x: 30.01, y: 30 }, { x: 30.02, y: 30 }];
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 5, w);
  assert.equal(st.wpIdx, 2, "les deux points sont validés");
});

test("fin d'itinéraire : arrêt du navire", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.vkn = 20;
  st.engineOn = true;
  st.sail = 0.8;
  st.waypoints = [{ x: 30.01, y: 30 }];
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 5, w);
  assert.equal(st.autopilot, false);
  assert.equal(st.engineOn, false);
  assert.equal(st.sail, 0);
  assert.ok(st.notifications.some((n) => n.text.includes("Itinéraire terminé")), "notification de fin");
});

test("échouement : pilote coupé avec notification", () => {
  const w = buildWorld(42);
  // navire en mer PUIS cap vers un point SUR la côte du continent
  const st = shipAtSea(w, { heading: 90, order: 90 });
  // le continent est au coin est (x0=51.6) : posons un point au milieu de la côte
  const coastPt = w.COAST[4]; // un point de la ligne de côte
  st.x = coastPt[0] - 0.3; st.y = coastPt[1]; // 18 NM de la côte
  st.estX = st.x; st.estY = st.y;
  st.heading = 90; st.headingOrder = 90; // cap est, droit sur la côte
  st.waypoints = [{ x: coastPt[0] + 0.5, y: coastPt[1] }]; // point sur la terre
  st.wpIdx = 0;
  st.autopilot = true;
  for (let i = 0; i < 120 && st.autopilot; i++) tick(st, 1, w);
  assert.equal(st.grounded, true, "le navire s'est échoué");
  assert.equal(st.autopilot, false, "pilote coupé");
  assert.ok(st.notifications.some((n) => n.text.includes("pilote automatique coupé")), "notification de coupure");
});

test("estime + sous-pas : grand virage en pas de rattrapage — l'estime intègre les sous-pas", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 0, order: 180 }); // demi-tour
  st.vkn = 20;
  tick(st, 5, w); // 5 min : le virage de 180° prend < 1 min à 270°/min
  // après le demi-tour, le navire file au sud à pleine vitesse : son estime
  // doit être NETTEMENT au sud (mouvement des sous-pas de giration intégré,
  // pas de trou). 5 min à ~15-20 kn ≈ 1.25 NM ≈ 2.3 km, moins le
  // contre-allé du demi-tour (~0.5 km) : au moins 1 km au sud.
  const dy = 30 - st.estY; // degrés au sud (cap 180 = y−)
  assert.ok(dy > 0.01, `l'estime a suivi la giration et la route sud (${(dy * 111.12).toFixed(2)} km parcourus au sud — mouvement des sous-pas intégré)`);
});

test("auto-correction étoile→pilote : recentrage de l'estime → re-visée au tick suivant", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 90, order: 90 });
  st.vkn = 20;
  st.waypoints = [{ x: 31, y: 30 }];
  st.wpIdx = 0;
  st.autopilot = true;
  tick(st, 1, w);
  const orderAvant = st.headingOrder;
  // simule un point aux étoiles : recentrage de l'estime ailleurs
  st.estX = 29.9; st.estY = 30.05;
  tick(st, 1, w);
  const orderApres = Math.round(bearingTo(st.estX, st.estY, 31, 30));
  assert.equal(Math.round(st.headingOrder), orderApres, "la consigne vise depuis la position corrigée");
  assert.notEqual(Math.round(st.headingOrder), Math.round(orderAvant), "la consigne a changé après le recentrage");
});

test("migration : état ancien sans waypoints/autopilot → aucun crash", () => {
  const w = buildWorld(42);
  const st = newPlayerState(w);
  delete st.waypoints; delete st.wpIdx; delete st.autopilot;
  const cap = st.heading;
  tick(st, 1, w); // ne doit pas crasher (undefined traité par les gardes)
  assert.equal(st.heading, cap);
});

test("déterminisme : même état + même route + mêmes ticks = même trajectoire", () => {
  const w = buildWorld(42);
  // UN seul état initial (défauts d'instruments tirés une fois), re-tické
  // depuis des copies profondes : le moteur doit être rejouable à l'identique.
  const make = () => {
    const st = shipAtSea(w, { heading: 90, order: 90 });
    st.vkn = 20;
    st.waypoints = [{ x: 30.5, y: 30.5 }, { x: 31, y: 31 }];
    st.wpIdx = 0;
    st.autopilot = true;
    return st;
  };
  const seedState = make();
  const run = () => {
    const st = JSON.parse(JSON.stringify(seedState)); // copie exacte
    const trace = [];
    for (let i = 0; i < 30; i++) { tick(st, 1, w); trace.push(st.x.toFixed(6), st.y.toFixed(6), st.estX.toFixed(6), st.estY.toFixed(6)); }
    return trace.join(",");
  };
  const a = run();
  const b = run();
  assert.equal(a, b, "trajectoire identique au rejeu");
});

test("callPosition : retourne la balise répondue — même si l'appelant n'entend pas la réponse", () => {
  const w = buildWorld(77);
  // navire A à ~3000 km d'une balise, faisceau 1° (portée ~4950 km : joignable)
  const b = w.BEACONS.find((x) => x.active);
  const st = newPlayerState(w, { weatherSeed: 1 });
  const d2 = 3000 / 111.12;
  st.x = b.x; st.y = b.y - d2;
  st.antBeam = 1; st.heading = 0; st.antOrient = 0; st.headingOrder = 0;
  const nAvant = st.notifications.length;
  const answered = callPosition(st, b.code, w);
  // la balise a entendu (strength >= 1 via le faisceau serré) → elle répond :
  // returned non-null, MAIS l'appelant (> 2000 km) ne lit rien
  assert.ok(answered, "la balise répond sur les ondes");
  assert.equal(answered.x, b.x);
  assert.equal(st.notifications.length, nAvant, "réponse inaudible pour l'appelant : silence total pour lui");
  // à 300 km : l'appelant lit sa réponse privée complète
  const st2 = newPlayerState(w, { weatherSeed: 1 });
  st2.x = b.x; st2.y = b.y - 300 / 111.12;
  st2.antBeam = 180; st2.heading = 0; st2.antOrient = 0; st2.headingOrder = 0;
  const answered2 = callPosition(st2, b.code, w);
  assert.ok(answered2);
  const resp = st2.notifications.find((n) => n.text.includes("Position de " + b.code));
  assert.ok(resp, "l'appelant à 300 km reçoit sa réponse privée complète");
  assert.ok(resp.text.includes("°N"), "coordonnées présentes pour l'appelant");
  // silence : mauvais numéro
  const answered3 = callPosition(st2, "9999", w);
  assert.equal(answered3, null, "mauvais numéro : null, silence");
});
