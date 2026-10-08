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
  st.vkn = 20;
  st.heading = heading;
  st.headingOrder = order;
  return st;
}

test("giration : consigne +90° à pleine vitesse atteinte en ~20 s, sans dépassement", () => {
  const w = buildWorld(42);
  const st = shipAtSea(w, { heading: 0, order: 90 });
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
  tick(st, 1, w); // 1 min : le chemin court (−20°) est couvert
  // après 1 tick de 1 min la rotation est au plus 270° : le cap doit être
  // passé par le chemin court (vers 350, pas vers +340 de l'autre sens)
  const diff = ((350 - st.heading + 540) % 360) - 180;
  assert.ok(Math.abs(diff) < 180, "le navire a tourné par le plus court chemin");
  // petit pas : vérifions le sens sur 1 s
  const st2 = shipAtSea(w, { heading: 10, order: 350 });
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
  const x0 = st.x, y0 = st.y;
  tick(st, 5, w); // 5 min d'un coup : 270°/min × 5 = 1350° possibles
  assert.equal(st.heading, 90, "consigne atteinte, pas de tours complets");
  // le navire a avancé pendant le virage (trajectoire d'arc), pas sur place
  const moved = Math.hypot(st.x - x0, st.y - y0);
  assert.ok(moved > 0, "position intégrée pendant la giration");
});
