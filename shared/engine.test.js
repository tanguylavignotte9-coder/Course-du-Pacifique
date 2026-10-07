import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWorld, newPlayerState, tick, weatherAt,
  distNm, CAPTURE_R_NM, DELIVERY_R_NM, KM_PER_NM,
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
