import fsSync from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { buildWorld, newPlayerState, tick, weatherAt, computeView, clamp, distKm, DELIVERY_R_KM, CAPTURE_R_KM, WX_HORIZON_H, AUTOGUIDE_MODES, AUTOGUIDE_DEFAULT, shipVisibleKm, shipsCollide, callPosition, scrambledIntercept, longStrengthKm, bearingTo, angDiff, spawnPosition, MAP, CALL_BATTERY_COST, RADIO_MIN_STRENGTH, randomCode, MS_PER_MIN, recvCapture, detectBeacon, onProximityPing, proxPingIntervalS, captureBeacon, SHORT_DECAY_KM, PROX_ARM_KM, sonarPing, sonarPassiveHear, shipNoisy, soundTravelMin, strengthKm, SOUND_DECAY_KM, SONAR_ECHO_PERSIST_S, generateNpcs, npcsTick, npcNoisy, npcBackPos, nextNpcEventMin, FISHER_CHAT_MEAN_MIN, CARGO_MSG_MEAN_MIN, WHALE_SONG_MEAN_MIN } from "../../shared/engine.js";
import { Store } from "./store.js";
import { Auth, hashPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
// Multiplicateur de temps (debug uniquement ; production = temps réel ×1).
const TIME_MULT = process.env.TIME_MULT ? Number(process.env.TIME_MULT) : 1;
const TICK_MS = 1000; // tick serveur : 1 s réelle
const MAX_STEP_MIN = 5; // pas de simulation max 5 min de jeu (design)
const PERSIST_MS = 60000;
const SPAWN_SEP_KM = 0.5; // anti-chevauchement des spawns au port

// Bafouillage des pêcheurs (diffusion) : petites phrases de la vie à bord.
// JAMAIS de coordonnées dans le texte (règle : pas de position vraie dans
// les messages NPC — la position ne se révèle que par le geste du joueur).
const FISHER_CHAT_LINES = [
  "Filets remontés, pas grand-chose dedans…",
  "Banc de maquereaux au nord, ça donne espoir.",
  "La mer est belle ce soir, ça sent la bonne journée.",
  "…et encore un qui a filé avec l'appât, ces bestioles apprennent.",
  "Moteur qui chauffe, on rentre doucement.",
  "Du poisson, du poisson, du poisson !",
  "Par ici la brume, on garde les yeux ouverts.",
  "Ce soir, soupe de poisson pour tout le monde.",
];
const clamp01 = (v) => clamp(v, 0, 1);

// ---------- Persistance & comptes ----------
const store = new Store(path.join(ROOT, "data"));
const auth = new Auth(store);

function readAdminSecret() {
  try {
    return fsSync.readFileSync(path.join(ROOT, "data/admin-secret.txt"), "utf8").trim();
  } catch {
    return null;
  }
}

// ---------- Course ----------
// Une course unique par défaut (solo d'abord). Le temps de jeu est le temps
// réel écoulé depuis `startedAt` (heure de Paris en mémoire, ISO en base),
// accéléré par TIME_MULT pour le debug.
function loadOrCreateRace() {
  let r = store.data.races["default"];
  let fresh = false;
  if (!r) {
    fresh = true;
    // L'horloge de jeu est la VRAIE heure de Paris : l'epoch est minuit
    // local du jour du lancement. t (minutes de jeu) ajouté à l'epoch
    // redonne l'heure réelle affichée au joueur.
    const epoch = new Date();
    epoch.setHours(0, 0, 0, 0);
    // displayEpoch : ancre FIXE (minuit Paris du lancement) pour l'affichage.
    // epoch : ancre de l'invariant t = temps réel écoulé (décalée par les
    // sauts de temps). L'affichage suit t : une seule trame temporelle.
    r = { seed: Math.floor(Math.random() * 1e9), epoch: epoch.getTime(), displayEpoch: epoch.getTime(), startedAt: new Date().toISOString(), players: {} };
    store.data.races["default"] = r;
    store.save();
  }
  const world = buildWorld(r.seed);
  if (!fresh && r.beacons) {
    for (const b of world.BEACONS) {
      const s = r.beacons[b.id];
      if (s && !s.active) b.active = false;
    }
  }
  return { race: r, world };
}
const { race, world } = loadOrCreateRace();
// Journal global du NETWORK (append-only, persisté dans la course) : une
// entrée par connexion ({ t, who, code, place }) — base de la future
// newsletter quotidienne.
if (!Array.isArray(race.network)) race.network = [];

// Zone NETWORK (calculée serveur, jamais déductible côté client : le client
// ne connaît ni sa position vraie ni celle des balises) : port, avant-poste
// ou balise à portée de capture (500 m — capturée ou non). Sert à la
// visibilité du bouton, à la connexion et de garde à chaque requête.
function netZone(st) {
  return st.location === "surface" &&
    (distKm(st.x, st.y, world.PORT.x, world.PORT.y) < DELIVERY_R_KM ||
     world.OUTPOSTS.some((o) => distKm(st.x, st.y, o.x, o.y) < DELIVERY_R_KM) ||
     world.BEACONS.some((b) => distKm(st.x, st.y, b.x, b.y) <= CAPTURE_R_KM));
}

// Minutes de jeu écoulées depuis le départ (temps réel × TIME_MULT)
function gameMinutesNow() {
  // Minutes de jeu = temps réel écoulé depuis minuit Paris du jour du
  // lancement (epoch). ×TIME_MULT pour le debug uniquement.
  const ms = Date.now() - (race.epoch || new Date(race.startedAt).getTime());
  return Math.max(0, ms / MS_PER_MIN) * TIME_MULT;
}

const states = new Map(); // accountId -> player state (engine)
const proxLast = new Map(); // code balise → dernier ping court (ms)

// ---------- Sonar — état éphémère (non persisté) ----------
// Le sonar vit côté serveur : positions vraies, historique pour le retard
// de propagation, files d'échos/pings en transit. Perdu au redémarrage :
// acceptable (les détections sont des événements courts).
const noiseHistory = new Map();       // accountId -> [{ t, x, y }] positions récentes (retard du son)
const sonarPending = new Map();       // accountId -> [{ kind, az, distKm, arriveMin }] échos pas encore revenus
const sonarLive = new Map();          // accountId -> [{ kind, az, distKm, heardMs }] échos revenus (10 s)
const sonarNoisePending = new Map();  // accountId -> [{ bearing, strength, arriveMin }] pings des autres en transit
const sonarHeard = new Map();        // accountId -> [{ bearing, strength, heardMs }] pings entendus (10 s)
const bioPending = new Map();   // accountId -> [{ bearing, strength, arriveMin }] chants en transit
const bioHeard = new Map();     // accountId -> [{ bearing, strength, heardMs }] chants entendus (10 s)

// Position retardée dans un historique : dernière entrée <= tMin.
function posAtT(hist, tMin) {
  if (!hist || hist.length === 0) return null;
  for (let i = hist.length - 1; i >= 0; i--) {
    if (hist[i].t <= tMin) return hist[i];
  }
  return hist[0];
}

// Écoute passive d'un navire : bruits moteurs (positions RETARDÉES) + pings
// entendus. GISEMENT + FORCE seulement — jamais de position.
function sonarPassiveFor(id) {
  const me = states.get(id);
  if (!me) return [];
  const out = [];
  for (const [oid, hist] of noiseHistory) {
    if (oid === id) continue;
    const ost = states.get(oid);
    if (!ost || !shipNoisy(ost)) continue;
    // le bruit entendu MAINTENANT a été émis il y a d / vitesse du son :
    // deux itérations convergent (les navires sont lents à l'échelle du son)
    let d = distKm(me.x, me.y, ost.x, ost.y);
    let p = posAtT(hist, me.t - soundTravelMin(d));
    if (!p) continue;
    d = distKm(me.x, me.y, p.x, p.y);
    p = posAtT(hist, me.t - soundTravelMin(d));
    if (!p) continue;
    const heard = sonarPassiveHear(me, p.x, p.y);
    if (heard) out.push({ kind: "moteur", bearing: heard.bearing, strength: heard.strength });
  }
  // Bruits moteurs des NPC (hydrophone) : cargo en traversée, pêcheur en
  // transit — position RETARDÉE du son (npcBackPos), gisement + force.
  const npcs = race.npcs;
  if (npcs) {
    for (const n of [...npcs.cargos, ...npcs.fishermen]) {
      if (!npcNoisy(n)) continue;
      const d = distKm(me.x, me.y, n.x, n.y);
      const p = npcBackPos(n, soundTravelMin(d));
      const heard = sonarPassiveHear(me, p.x, p.y);
      if (heard) out.push({ kind: "moteur", bearing: heard.bearing, strength: heard.strength });
    }
  }
  for (const ev of (sonarHeard.get(id) || [])) {
    out.push({ kind: "ping", bearing: ev.bearing, strength: ev.strength });
  }
  for (const ev of (bioHeard.get(id) || [])) {
    out.push({ kind: "biologique", bearing: ev.bearing, strength: ev.strength });
  }
  return out;
}

// Passe sonar (boucle 1 Hz) : historique des positions, arrivées des échos
// et des pings entendus, purge des événements expirés.
function sonarPass() {
  const nowMs = Date.now();
  const cut = nowMs - SONAR_ECHO_PERSIST_S * 1000;
  for (const [id, st] of states) {
    let hist = noiseHistory.get(id);
    if (!hist) { hist = []; noiseHistory.set(id, hist); }
    hist.push({ t: st.t, x: st.x, y: st.y });
    while (hist.length > 500) hist.shift(); // ~8 min : couvre le retard max (500 km ≈ 5,6 min)
    const pend = sonarPending.get(id);
    if (pend && pend.length) {
      sonarPending.set(id, pend.filter((e) => {
        if (st.t >= e.arriveMin) {
          const live = sonarLive.get(id) || [];
          live.push({ kind: e.kind, az: e.az, distKm: e.distKm, heardMs: nowMs });
          sonarLive.set(id, live);
          return false;
        }
        return true;
      }));
    }
    const nPend = sonarNoisePending.get(id);
    if (nPend && nPend.length) {
      sonarNoisePending.set(id, nPend.filter((ev) => {
        if (st.t >= ev.arriveMin) {
          const heard = sonarHeard.get(id) || [];
          heard.push({ bearing: ev.bearing, strength: ev.strength, heardMs: nowMs });
          sonarHeard.set(id, heard);
          return false;
        }
        return true;
      }));
    }
    const bPend = bioPending.get(id);
    if (bPend && bPend.length) {
      bioPending.set(id, bPend.filter((ev) => {
        if (st.t >= ev.arriveMin) {
          const heard = bioHeard.get(id) || [];
          heard.push({ bearing: ev.bearing, strength: ev.strength, heardMs: nowMs });
          bioHeard.set(id, heard);
          return false;
        }
        return true;
      }));
    }
    if (sonarLive.has(id)) sonarLive.set(id, sonarLive.get(id).filter((e) => e.heardMs >= cut));
    if (sonarHeard.has(id)) sonarHeard.set(id, sonarHeard.get(id).filter((e) => e.heardMs >= cut));
    if (bioHeard.has(id)) bioHeard.set(id, bioHeard.get(id).filter((e) => e.heardMs >= cut));
  }
}
// Positions de spawn déjà posées au port (anti-chevauchement, ordre d'arrivée)
let takenSpawns = [];
for (const [id, saved] of Object.entries(race.players || {})) {
  if (saved) {
    states.set(id, saved);
    states.get(id).t = gameMinutesNow();
    // migration : un état ancien sans consigne prend son cap actuel
    if (states.get(id).headingOrder == null) states.get(id).headingOrder = states.get(id).heading;
    if (!Array.isArray(states.get(id).waypoints)) {
      states.get(id).waypoints = [];
      states.get(id).wpIdx = 0;
      states.get(id).autopilot = false;
    }
  }
}
// Migration unique des sauvegardes anciennes : deux navires superposés
// NE SONT RE-LOGÉS que s'ils sont tous deux DANS LA ZONE D'ACOSTAGE du port
// (la seule situation « ancienne sauvegarde antérieure aux slots »). Deux
// navires qui se croisent à < 300 m EN MER (régate, rendez-vous) ne sont
// JAMAIS déplacés — ils se débrouillent, la collision est gérable en jeu.
// Marqueur race.migrated : ne s'exécute qu'une fois par course.
if (!race.migrated) {
  race.migrated = true;
  const ids = [...states.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = states.get(ids[i]), b = states.get(ids[j]);
      const bothAtPort =
        distKm(a.x, a.y, world.PORT.x, world.PORT.y) < SPAWN_SEP_KM &&
        distKm(b.x, b.y, world.PORT.x, world.PORT.y) < SPAWN_SEP_KM;
      const dm = distKm(a.x, a.y, b.x, b.y);
      if (dm < 0.05 && bothAtPort) {
        // re-loger via la spirale : le premier garde sa place (ou en trouve
        // une nouvelle), le second est repoussé au prochain point valide.
        const fresh = [];
        const sa = spawnPosition(world, fresh);
        const sb = spawnPosition(world, fresh);
        a.x = sa.x; a.y = sa.y; a.estX = sa.x; a.estY = sa.y;
        b.x = sb.x; b.y = sb.y; b.estX = sb.x; b.estY = sb.y;
        a.collided = false; b.collided = false;
        console.log(`[migration] Navires ${ids[i]} et ${ids[j]} re-logés à 50 m (superposés à quai, sauvegarde antérieure)`);
      }
    }
  }
  store.save();
}

// ---------- Vie du monde : population NPC (pêcheurs, cargos, baleines) ----------
// Générée une fois, PERSISTÉE dans la course (positions + timers vivent dans
// race.npcs → sérialisés à chaque store.save()). Régénérée au reset.
// Les NPC sont exposés aux joueurs UNIQUEMENT par le sonar et la radio —
// jamais dans le snapshot (pas de position vraie).
function ensureNpcs() {
  if (!race.npcs) {
    const used = [...world.BEACONS.map((b) => b.code), ...[...states.values()].map((s) => s.code)];
    race.npcs = generateNpcs(world, used, gameMinutesNow());
    store.save();
  }
}
ensureNpcs();
let lastNpcT = gameMinutesNow();

// Passe NPC (boucle 1 Hz) : déplacement simple + émissions. Le monde vit
// même sans joueur connecté. dt borné par le garde-fou du moteur (les
// sauts de temps super user font vivre les NPC de 120 min au plus).
function npcPass(now) {
  const npcs = race.npcs;
  if (!npcs) return;
  const prev = lastNpcT;
  lastNpcT = now;
  npcsTick(npcs, now - prev, world);
  // Émission radio depuis un NPC vers tous les navires joueurs : LOI DE
  // RÉCEPTION UNIQUE (omni ≥ 75 % / directionnel ≥ sens), famille longue.
  const radioSend = (fromX, fromY, deliver) => {
    for (const [oid, ost] of states) {
      const radioOk = (ost.location === "surface" || (ost.location === "underwater" && ost.periscope)) && ost.battery > 0;
      if (!radioOk) continue;
      const dKm = distKm(ost.x, ost.y, fromX, fromY);
      const strength = longStrengthKm(dKm);
      if (strength < RADIO_MIN_STRENGTH) continue;
      const cap = recvCapture(ost, bearingTo(ost.x, ost.y, fromX, fromY), strength);
      if (!cap) continue; // ne capte pas : silence
      deliver(ost, cap);
    }
  };
  // Bafouillage des pêcheurs : DIFFUSION lisible par tous à portée (avec
  // code radio du pêcheur, aucune coordonnée).
  for (const f of npcs.fishermen) {
    if (now < f.nextChatMin) continue;
    f.nextChatMin = nextNpcEventMin(now, FISHER_CHAT_MEAN_MIN);
    const line = FISHER_CHAT_LINES[Math.floor(Math.random() * FISHER_CHAT_LINES.length)];
    radioSend(f.x, f.y, (ost, cap) => {
      ost.notifSeq = (ost.notifSeq || 0) + 1;
      ost.notifications.unshift({ id: ost.notifSeq, t: ost.t, text: `📻 Navire ${f.code} : « ${line} »`, kind: "info", cat: "radio" });
    });
  }
  // Cargos : message PRIVÉ vers un autre cargo — les joueurs ne sont jamais
  // destinataires : ils ne capent que du BROUILLÉ (scrambledIntercept).
  for (const c of npcs.cargos) {
    if (now < c.nextMsgMin) continue;
    c.nextMsgMin = nextNpcEventMin(now, CARGO_MSG_MEAN_MIN);
    radioSend(c.x, c.y, (ost, cap) => {
      ost.notifSeq = (ost.notifSeq || 0) + 1;
      const info = scrambledIntercept(Math.round(cap.strength), cap.source, cap.side);
      ost.notifications.unshift({ id: ost.notifSeq, t: ost.t, text: info.text, kind: "info", cat: info.cat });
    });
  }
  // Chant de baleine : BRUIT SONAR PASSIF (kind « biologique ») avec le vrai
  // retard de propagation — même mécanique que les bruits moteurs : la
  // position d'émission est retardée, la force suit la décroissance son,
  // et l'arrivée passe par la file d'attente dédiée (bioPending → bioHeard,
  // affiché SONAR_ECHO_PERSIST_S secondes).
  for (const wh of npcs.whales) {
    if (now < wh.nextSongMin) continue;
    wh.nextSongMin = nextNpcEventMin(now, WHALE_SONG_MEAN_MIN);
    for (const [oid, ost] of states) {
      const dKm = distKm(ost.x, ost.y, wh.x, wh.y);
      const strength = strengthKm(dKm, SOUND_DECAY_KM);
      if (strength <= 0) continue;
      const q = bioPending.get(oid) || [];
      q.push({
        bearing: Math.round(bearingTo(ost.x, ost.y, wh.x, wh.y)),
        strength,
        arriveMin: ost.t + soundTravelMin(dKm),
      });
      bioPending.set(oid, q);
    }
  }
}
function persistPlayer(id) {
  race.players[id] = states.get(id);
  store.save();
}
function ensureState(id) {
  if (!states.has(id)) {
    // Météo UNIFORME : le seed météo est celui de la course — tous les
    // joueurs vivent le même ciel aux mêmes positions.
    // Spawn : slot d'amarrage unique par joueur (pas de chevauchement).
    if (!race.spawnOrder) race.spawnOrder = {};
    if (race.spawnOrder[id] == null) {
      race.spawnOrder[id] = Object.keys(race.spawnOrder).length;
      store.save();
    }
    const spawnIdx = race.spawnOrder[id];
    // Code radio du navire : unique, SANS collision avec les codes des
    // balises — un code désigne exactement un système du monde.
    let shipCode;
    do {
      shipCode = randomCode();
    } while (world.BEACONS.some((b) => b.code === shipCode)
      || [...states.values()].some((s) => s.code === shipCode));
    const st = newPlayerState(world, { weatherSeed: race.seed % 1000, shipCode, takenSpawns });
    st.t = gameMinutesNow();
    states.set(id, st);
    persistPlayer(id);
  }
  return states.get(id);
}

// ---------- Boucle de simulation ----------
// Le serveur est AUTORITATIF : chaque seconde réelle, il avance chaque navire
// au temps de course courant, par pas bornés (5 min de jeu max, design).
let lastPersist = 0;
setInterval(() => {
  const now = gameMinutesNow();
  for (const [, st] of states) {
    while (st.t < now) {
      tick(st, Math.min(MAX_STEP_MIN, now - st.t), world);
    }
  }
  multiplayerPass(now);
  npcPass(now);
  sonarPass();
    // NETWORK : coupure automatique dès que le navire quitte la zone —
    // revenir = se RECONNECTER = nouvelle entrée dans le journal global.
    for (const [, st] of states) if (st.networked && !netZone(st)) st.networked = false;
    // — Balise-vigie : signal de proximité (famille courte), accéléré —
    // l'intervalle se règle sur le navire le plus proche de la balise.
    // Une balise CAPTURÉE (désactivée) émet aussi : l'autoguidage du joueur
    // (3 positions) décide seul si elle peut verrouiller son pilote.
    const nowMs = Date.now();
    for (const b of world.BEACONS) {
      let dMin = Infinity;
      for (const st of states.values()) dMin = Math.min(dMin, distKm(st.x, st.y, b.x, b.y));
      if (!isFinite(dMin)) continue; // personne sur l'eau
      // VIGIE ARMÉE : la balise n'émet son signal de proximité que si un
      // navire est dans son rayon de veille (PROX_ARM_KM — tout navire,
      // même plongé : la vigie détecte la coque, pas la radio). Silencieuse
      // sinon, et c'est l'information : une balise qui s'affole au loin
      // dans un faisceau, c'est un concurrent qui approche.
      if (dMin > PROX_ARM_KM) continue;
      const intervalMs = proxPingIntervalS(dMin) * 1000;
      if (nowMs - (proxLast.get(b.code) || 0) < intervalMs) continue;
      proxLast.set(b.code, nowMs);
      for (const st of states.values()) {
        const radioOk = (st.location === "surface" || (st.location === "underwater" && st.periscope)) && st.battery > 0;
        if (!radioOk) continue;
        const cap = detectBeacon(st, b, world, SHORT_DECAY_KM);
        if (cap) onProximityPing(st, b, cap);
      }
    }
  if (Date.now() - lastPersist > PERSIST_MS) {
    lastPersist = Date.now();
    for (const [id] of states) race.players[id] = states.get(id);
    race.beacons = Object.fromEntries(world.BEACONS.map((b) => [b.id, { active: b.active }]));
    store.save();
  }
}, TICK_MS);

// ---------- Passe multijoueur (détection entre navires + collisions) ----------
// Le serveur connaît les positions VRAIES : il décide qui voit qui (les
// interactions reposent toujours sur les positions vraies, jamais sur les
// estimés). Chaque joueur ne reçoit que les navires qu'il DÉTECTE, avec
// azimut et distance depuis sa position vraie.
function shipPassiveKm(target, night) {
  return shipVisibleKm(target, night);
}
function multiplayerPass(now) {
  const ids = [...states.keys()];
  if (ids.length < 2) return;
  const infos = new Map();
  for (const id of ids) {
    const st = states.get(id);
    const w = weatherAt(st.x, st.y, st.t, st.weatherSeed);
    const hour = (st.t / 60) % 24;
    infos.set(id, {
      st, w,
      night: hour < 6 || hour >= 20,
      observerKm: (st.location === "surface" || st.periscope) ? w.visibility : 0,
      seenShips: new Set(),
    });
  }
  // Détection visuelle réciproque : la visibilité météo de l'OBSERVATEUR
  // rabote la portée de la cible.
  for (const [oid, oi] of infos) {
    if (oi.observerKm <= 0) continue;
    for (const [tid, ti] of infos) {
      if (tid === oid) continue;
      const targetRange = shipPassiveKm(ti.st, oi.night);
      if (targetRange <= 0) continue;
      const km = distKm(oi.st.x, oi.st.y, ti.st.x, ti.st.y);
      if (km <= Math.min(oi.observerKm, targetRange)) {
        oi.seenShips.add(tid);
      }
    }
  }
  // Journal : apparition / perte de visuel (catégorie "vision")
  for (const [oid, oi] of infos) {
    const st = oi.st;
    const before = st.sawShips || [];
    const seen = [...oi.seenShips];
    for (const tid of seen) {
      if (!before.includes(tid)) {
        const ti = infos.get(tid).st;
        const km = distKm(st.x, st.y, ti.x, ti.y);
        st.notifSeq = (st.notifSeq || 0) + 1;
        const az = Math.round((Math.atan2(ti.x - st.x, ti.y - st.y) * 180) / Math.PI + 360) % 360;
        st.notifications.unshift({ id: st.notifSeq, t: st.t, text: `⛵ Navire repéré (${infos.get(tid).st.code}) : ~${Math.round(km)} km, azimut ${az}°.`, kind: "info", cat: "vision" });
      }
    }
    for (const tid of before) {
      if (!seen.includes(tid)) {
        st.notifSeq = (st.notifSeq || 0) + 1;
        st.notifications.unshift({ id: st.notifSeq, t: st.t, text: `👁️ Navire ${infos.get(tid).st.code} perdu de vue.`, kind: "info", cat: "vision" });
      }
    }
    st.sawShips = seen;
    if (st.notifications.length > 150) st.notifications.length = 150;
  }
  // Collisions : coques 15 m x 5 m en rectangles ORIENTÉS (OBB/SAT),
  // précises au mètre. La vitesse de chaque navire en contact est stoppée.
  const HIST_KM = 0.03; // ~30 m : hystérésis pour débloquer (une demi-longueur)
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = states.get(ids[i]), b = states.get(ids[j]);
      if (a.location !== b.location) continue; // surface vs plongée : pas de contact
      if (shipsCollide(a.x, a.y, a.heading + (a.compDev || 0), b.x, b.y, b.heading + (b.compDev || 0))) {
        for (const st of [a, b]) {
          if (!st.collided) {
            st.notifSeq = (st.notifSeq || 0) + 1;
            st.notifications.unshift({ id: st.notifSeq, t: st.t, text: "💥 Contact avec un autre navire — vitesse stoppée. Écartez-vous en changeant de cap.", kind: "warn", cat: "alertes" });
          }
          st.collided = true;
          st.vkmh = 0;
        }
      }
    }
  }
  // Levée du blocage dès séparation nette des coques (hystérésis)
  for (const id of ids) {
    const st = states.get(id);
    if (!st.collided) continue;
    let touching = false;
    for (const oid of ids) {
      if (oid === id) continue;
      const o = states.get(oid);
      if (o.location === st.location && distKm(st.x, st.y, o.x, o.y) < HIST_KM) touching = true;
    }
    if (!touching) st.collided = false;
  }
}

// Émission OMNIDIRECTIONNELLE depuis un point (balise répondante) vers tous
// les navires tiers : chacun capte selon la LOI UNIQUE (omni ≥ 75 % / directionnel
// ≥ sens) une TRANSMISSION BROUILLÉE — signal, zone du faisceau si directionnel —
// jamais le contenu, jamais d'azimut. « Émettre, c'exister ».
function broadcastScrambledFrom(fromX, fromY, exceptId) {
  for (const [oid, ost] of states) {
    if (oid === exceptId) continue;
    const otherRadioOk = (ost.location === "surface" || (ost.location === "underwater" && ost.periscope)) && ost.battery > 0;
    if (!otherRadioOk) continue;
    const dKm = distKm(fromX, fromY, ost.x, ost.y);
    const strength = longStrengthKm(dKm);
    if (strength < RADIO_MIN_STRENGTH) continue;
    const brg = bearingTo(ost.x, ost.y, fromX, fromY);
    const cap = recvCapture(ost, brg, strength);
    if (!cap) continue; // ne capte pas : silence
    ost.notifSeq = (ost.notifSeq || 0) + 1;
    const info = scrambledIntercept(Math.round(strength), cap.source, cap.side);
    ost.notifications.unshift({ id: ost.notifSeq, t: ost.t, text: info.text, kind: "info", cat: info.cat });
  }
}

// ---------- HTTP ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, "client/dist")));
app.get("/admin", (req, res) => res.sendFile(path.join(ROOT, "server/public/admin.html")));

function publicSnapshot(id) {
  const st = ensureState(id);
  const w = weatherAt(st.x, st.y, st.t, st.weatherSeed);
  return {
    t: st.t,
    epoch: race.displayEpoch ?? race.epoch ?? new Date(race.startedAt).getTime(),
    isSuper: isSuper(id),
    player: {
      heading: st.heading, headingOrder: st.headingOrder ?? st.heading, sail: st.sail ?? 0.8, engine: st.engine,
      location: st.location, mast: st.mast, engineOn: st.engineOn,
      electricOn: st.electricOn, periscope: st.periscope, vkmh: st.vkmh,
      fuel: st.fuel, battery: st.battery, food: st.food,
      score: st.score, codes: st.codes, unc: st.unc,
      estX: st.estX, estY: st.estY,
      travelledKm: st.travelledKm, dailyKm: st.dailyKm,
      waypoints: st.waypoints || [], wpIdx: st.wpIdx || 0, autopilot: !!st.autopilot,
      navFixActive: st.navFix.active,
      grounded: st.grounded,
      collided: !!st.collided,
      light: !!st.light,
      boom: st.boom ?? 0, awSpd: st.awSpd ?? 0, awRel: st.awRel ?? 0,
      beaconLock: st.beaconLock ?? null, anchored: !!st.anchored,
      autoguide: st.autoguide || AUTOGUIDE_DEFAULT,
      networked: !!st.networked,
      signals: (st.signals || []).slice(-10),
      antBeam: st.antBeam, antOrient: st.antOrient,
      code: st.code,
      notifications: st.notifications.slice(0, 60),
      pins: st.pins, measures: st.measures,
    },
    world: {
      continent: world.CONTINENT.verts,
      port: world.PORT,
      islands: world.ISLANDS.map((i) => i.verts),
      outposts: world.OUTPOSTS,
      activeBeaconIds: world.BEACONS.filter((b) => b.active).map((b) => b.id),
      beaconCodes: world.BEACONS.map((b) => ({ id: b.id, code: b.code, active: b.active })),
      beaconCount: world.BEACONS.length,
    },
    weather: w,
    view: computeView(st, world),
    // NETWORK : zone serveur (bouton + connexion) et journal global, exposé
    // UNIQUEMENT aux joueurs connectés ET encore en zone.
    networkZone: netZone(st),
    networkLog: st.networked && netZone(st) ? race.network : null,
    // Navires détectés : azimut et distance uniquement (jamais la position
    // absolue — le client dessine depuis son estimé, comme pour les îles).
    ships: (st.sawShips || []).map((tid) => {
      const ts = states.get(tid);
      const km = distKm(st.x, st.y, ts.x, ts.y);
      const az = Math.round((Math.atan2(ts.x - st.x, ts.y - st.y) * 180) / Math.PI + 360) % 360;
      return { id: ts.code, km: Math.round(km * 10) / 10, az, light: !!ts.light };
    }),
    sonar: {
      passive: sonarPassiveFor(id),
      echoes: (sonarLive.get(id) || []).map((e) => ({
        kind: e.kind, az: e.az, distKm: e.distKm,
        ageS: (Date.now() - e.heardMs) / 1000,
      })),
    },
  };
}

app.post("/api/login", (req, res) => {
  const { name, password } = req.body || {};
  const token = auth.login(name, password);
  if (!token) return res.status(401).json({ error: "identifiants invalides" });
  const id = auth.accountOf(token);
  ensureState(id);
  res.setHeader("Set-Cookie", `pc_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ token, account: id });
});
app.post("/api/account", (req, res) => {
  const secret = process.env.ADMIN_SECRET || readAdminSecret();
  if (!secret || !req.body || req.body.adminSecret !== secret)
    return res.status(403).json({ error: "secret admin invalide" });
  try {
    const id = auth.createAccount(req.body.name, req.body.password);
    res.json({ account: id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Service météo du NETWORK (prévision parfaite sur WX_HORIZON_H = 48 h).
// Réservé aux joueurs CONNECTÉS au NETWORK et ENCORE EN ZONE (port,
// avant-poste ou balise — capturée ou non). La grille 2° est calculée à
// l'instant demandé (t + h heures).
app.get("/api/wx", (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, "")
    || (req.headers.cookie || "").match(/pc_token=([^;]+)/)?.[1];
  const account = token && auth.accountOf(token);
  if (!account) return res.status(401).json({ error: "auth requise" });
  const st = ensureState(account);
  if (!st.networked || !netZone(st))
    return res.status(403).json({ error: "service réservé aux abonnés du NETWORK connectés en zone" });
  const h = clamp(Number(req.query.h) || 0, 0, WX_HORIZON_H);
  const cells = [];
  for (let gx = 0; gx < 30; gx++)
    for (let gy = 0; gy < 30; gy++) {
      const w = weatherAt(gx * 2 + 1, gy * 2 + 1, st.t + h * 60, st.weatherSeed);
      cells.push({ x: gx * 2 + 1, y: gy * 2 + 1, clouds: w.clouds, rain: w.rain, storm: w.storm, fog: w.fog });
    }
  const here = weatherAt(st.x, st.y, st.t + h * 60, st.weatherSeed);
  res.json({ t: st.t, h, cells, here });
});

// ---------- API d'administration (interface /admin) ----------
// Toutes les routes exigent le secret admin (ADMIN_SECRET ou
// data/admin-secret.txt). Génération automatique au premier usage.
function getAdminSecret() {  const env = process.env.ADMIN_SECRET;
  if (env) return env;
  try {
    return fsSync.readFileSync(path.join(ROOT, "data/admin-secret.txt"), "utf8").trim();
  } catch {
    // Premier lancement : génération du secret (le fichier data/ existe déjà,
    // créé par le Store).
    const s = crypto.randomBytes(12).toString("hex");
    fsSync.writeFileSync(path.join(ROOT, "data/admin-secret.txt"), s + "\n", { mode: 0o600 });
    console.log("Secret admin généré : data/admin-secret.txt — notez-le pour la page /admin");
    return s;
  }
}
function adminGuard(req, res) {
  const secret = getAdminSecret();
  if (!secret || !req.body || req.body.adminSecret !== secret) {
    res.status(403).json({ error: "secret admin invalide" });
    return false;
  }
  return true;
}
app.post("/api/admin/accounts", (req, res) => {
  if (!adminGuard(req, res)) return;
  res.json({
    accounts: Object.keys(store.data.accounts || {}).sort(),
    superusers: Object.keys(store.data.superusers || {}).sort(),
  });
});
app.post("/api/admin/create", (req, res) => {
  if (!adminGuard(req, res)) return;
  try {
    const id = auth.createAccount(req.body.name, req.body.password);
    res.json({ account: id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});
app.post("/api/admin/passwd", (req, res) => {
  if (!adminGuard(req, res)) return;
  const id = String(req.body.name || "").trim().toLowerCase();
  const acc = store.data.accounts[id];
  if (!acc) return res.status(400).json({ error: "compte inconnu" });
  if (!req.body.password || req.body.password.length < 4)
    return res.status(400).json({ error: "mot de passe trop court (4 caractères min.)" });
  const { salt, hash } = hashPassword(req.body.password);
  store.data.accounts[id] = { salt, hash };
  for (const [t, owner] of Object.entries(store.data.tokens || {})) {
    if (owner === id) delete store.data.tokens[t];
  }
  store.save();
  res.json({ ok: true });
});
app.post("/api/admin/delete", (req, res) => {
  if (!adminGuard(req, res)) return;
  const id = String(req.body.name || "").trim().toLowerCase();
  if (!store.data.accounts[id]) return res.status(400).json({ error: "compte inconnu" });
  for (const [t, owner] of Object.entries(store.data.tokens || {})) {
    if (owner === id) delete store.data.tokens[t];
  }
  delete store.data.accounts[id];
  if (store.data.races?.default?.players) delete store.data.races.default.players[id];
  store.save();
  res.json({ ok: true });
});

// Super utilisateurs : déclarent un compte « super user » (outils de temps
// dans le client). Liste persistée dans save.json.
if (!store.data.superusers) store.data.superusers = {};
app.post("/api/admin/super", (req, res) => {
  if (!adminGuard(req, res)) return;
  const id = String(req.body.name || "").trim().toLowerCase();
  if (!store.data.accounts[id]) return res.status(400).json({ error: "compte inconnu" });
  if (req.body.super === false) {
    delete store.data.superusers[id];
    store.save();
    return res.json({ account: id, super: false });
  }
  store.data.superusers[id] = true;
  store.save();
  res.json({ account: id, super: true });
});
const isSuper = (id) => !!store.data.superusers?.[id];

const server = app.listen(PORT, () => {
  console.log(`Pacific Chase — serveur prêt sur http://localhost:${PORT} (×${TIME_MULT})`);
  console.log(`Départ de la course : ${race.startedAt}`);
  console.log(`Interface d'administration : http://localhost:${PORT}/admin`);
  console.log(`Secret admin (page /admin) : ${getAdminSecret()}`);
});
const wss = new WebSocketServer({ server });

const sockets = new Map(); // accountId -> Set<ws>
wss.on("connection", (ws, req) => {
  let token = null;
  const m = (req.headers.cookie || "").match(/pc_token=([^;]+)/);
  if (m) token = m[1];
  const url = new URL(req.url, "http://localhost");
  if (!token) token = url.searchParams.get("token");
  const account = token && auth.accountOf(token);
  if (!account) { ws.close(4401, "auth requise"); return; }
  const id = account;
  ensureState(id);
  if (!sockets.has(id)) sockets.set(id, new Set());
  sockets.get(id).add(ws);

  ws.send(JSON.stringify({ type: "snapshot", data: publicSnapshot(id) }));

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    const st = ensureState(id);
    if (msg.type === "command") {
      const c = msg.data || {};
      // Pilotage par CONSIGNE : le curseur fixe headingOrder, le moteur
      // fait converger le cap réel (giration bornée). L'ancien champ
      // « heading » reste accepté pendant la transition.
      // Reprise en main : toute consigne de cap COUPE le verrou balise-vigie.
      if (typeof c.headingOrder === "number" || typeof c.heading === "number") {
        st.headingOrder = ((Math.round(typeof c.headingOrder === "number" ? c.headingOrder : c.heading) % 360) + 360) % 360;
        if (st.beaconLock) { st.beaconLock = null; st.lockBrg = null; }
      }
      if (typeof c.sail === "number") st.sail = clamp01(c.sail);
      if (typeof c.engine === "number") st.engine = clamp01(c.engine);
      if (typeof c.antBeam === "number") st.antBeam = Math.round(clamp(c.antBeam, 1, 180));
      if (typeof c.antOrient === "number") st.antOrient = Math.round(clamp(c.antOrient, -180, 180));
      if (typeof c.mast === "boolean") st.mast = c.mast;
      if (typeof c.engineOn === "boolean") st.engineOn = c.engineOn;
      if (typeof c.electricOn === "boolean") st.electricOn = c.electricOn;
      if (typeof c.periscope === "boolean") st.periscope = c.periscope;
      if (typeof c.light === "boolean") st.light = c.light;
      // Ancre : mécanique générale, activable / désactivable à la main.
      if (typeof c.anchor === "boolean") st.anchored = c.anchor;
      // Capture de balise : action MANUELLE du joueur.
      if (c.capture === true) {
        const r = captureBeacon(st, world);
        if (!r.ok) {
          st.notifSeq = (st.notifSeq || 0) + 1;
          st.notifications.unshift({ id: st.notifSeq, t: st.t, text: `⚠️ ${r.error}`, kind: "warn", cat: "radio" });
        }
      }
      // Sonar actif : UN clic = UN ping (plongée uniquement, 1 % batterie).
      // Les échos reviennent avec leur vrai retard (vitesse du son) ; le
      // ping est un BRUIT : tous les autres navires l'entendent en passif
      // (gisement + force, décroissance son), avec le même retard.
      if (c.ping === true) {
        // NPC de surface (cargos, pêcheurs) rebondissent comme « navire » ;
        // les baleines comme « biologique ». Aucun n'a de position exposée.
        const npcSurf = race.npcs
          ? [...race.npcs.cargos, ...race.npcs.fishermen].map((n) => ({ x: n.x, y: n.y, location: "surface" }))
          : [];
        const res = sonarPing(
          st, world,
          [...states.values()].filter((o) => o !== st).concat(npcSurf),
          (race.npcs || {}).whales || [],
        );
        if (!res.ok) {
          st.notifSeq = (st.notifSeq || 0) + 1;
          st.notifications.unshift({ id: st.notifSeq, t: st.t, text: `⚠️ Sonar : ${res.error}`, kind: "warn", cat: "sonar" });
        } else {
          const pend = sonarPending.get(id) || [];
          for (const e of res.echoes) pend.push({ kind: e.kind, az: e.az, distKm: e.dKm, arriveMin: e.arriveMin });
          sonarPending.set(id, pend);
          for (const [oid, ost] of states) {
            if (oid === id) continue;
            const d = distKm(ost.x, ost.y, st.x, st.y);
            const strength = strengthKm(d, SOUND_DECAY_KM);
            if (strength <= 0) continue;
            const q = sonarNoisePending.get(oid) || [];
            q.push({
              bearing: Math.round(bearingTo(ost.x, ost.y, st.x, st.y)),
              strength,
              arriveMin: ost.t + soundTravelMin(d),
            });
            sonarNoisePending.set(oid, q);
          }
          st.notifSeq = (st.notifSeq || 0) + 1;
          st.notifications.unshift({ id: st.notifSeq, t: st.t, text: "🔊 Ping émis (1 % batteries).", kind: "info", cat: "sonar" });
        }
      }
      if (c.dive === true) { st.location = "underwater"; st.mast = false; st.engineOn = false; }
      if (c.surface === true) st.location = "surface";
      // Autoguidage balise-vigie (3 positions) : quelles balises peuvent
      // engager le verrou du pilote. Filtre à l'engagement uniquement —
      // un verrou en cours tient, même si l'interrupteur change.
      if (typeof c.autoguide === "string" && AUTOGUIDE_MODES.includes(c.autoguide)) {
        st.autoguide = c.autoguide;
      }
      // NETWORK : connexion depuis la zone d'un port / avant-poste / balise
      // (capturée ou non). Le coût : l'identité et le code du joueur sont
      // révélés et enregistrés dans le journal global, consulté par tous les
      // abonnés (« qui est allé où, quand ») — base de la future newsletter
      // quotidienne. Chaque REconnexion écrit une nouvelle entrée.
      if (c.network === true) {
        if (!netZone(st)) {
          st.notifSeq = (st.notifSeq || 0) + 1;
          st.notifications.unshift({ id: st.notifSeq, t: st.t, text: "⚠️ NETWORK : aucune station à portée (port, avant-poste ou balise à ≤ 500 m).", kind: "warn", cat: "radio" });
        } else if (st.networked) {
          st.notifSeq = (st.notifSeq || 0) + 1;
          st.notifications.unshift({ id: st.notifSeq, t: st.t, text: "🌐 NETWORK : déjà connecté.", kind: "info", cat: "radio" });
        } else {
          st.networked = true;
          let place;
          if (distKm(st.x, st.y, world.PORT.x, world.PORT.y) < DELIVERY_R_KM) {
            place = { kind: "port", id: "port" };
          } else {
            const oi = world.OUTPOSTS.findIndex((o) => distKm(st.x, st.y, o.x, o.y) < DELIVERY_R_KM);
            if (oi >= 0) place = { kind: "avant-poste", id: oi };
            else {
              const b = world.BEACONS.find((x) => distKm(st.x, st.y, x.x, x.y) <= CAPTURE_R_KM);
              place = { kind: "balise", id: b.id, code: b.code };
            }
          }
          race.network.push({ t: st.t, who: id, code: st.code, place });
          store.save();
          st.notifSeq = (st.notifSeq || 0) + 1;
          st.notifications.unshift({ id: st.notifSeq, t: st.t, kind: "good", cat: "radio",
            text: "🌐 Connecté au NETWORK — identité et code enregistrés dans le journal global. Météo 48 h disponible." });
        }
      }
      // Appel « Position ? » : coût batteries, réponse privée de la balise,
      // et TRANSMISSION BROUILLÉE pour tout autre navire qui capte l'émission
      // sans en être destinataire (« émettre, c'exister »).
      // SOS (mode diffusion) : message lisible par TOUS les navires à portée
      // de l'émission double chemin. Le contenu inclut la position ESTIMÉE
      // de l'émetteur (ce qu'il croit — ses instruments, pas la vérité).
      if (c.sos === true) {
        const radioOkSos = (st.location === "surface" || (st.location === "underwater" && st.periscope)) && st.battery > 0;
        if (radioOkSos) {
          st.battery = Math.max(0, st.battery - CALL_BATTERY_COST);
          const sosText = `🆘 SOS du navire ${st.code} — position déclarée : ${st.estY.toFixed(2)}°N ${st.estX.toFixed(2)}°E (±${Math.round(st.unc)} km).`;
          st.notifSeq = (st.notifSeq || 0) + 1;
          st.notifications.unshift({ id: st.notifSeq, t: st.t, text: `${sosText} Diffusion émise.`, kind: "warn", cat: "radio" });
          for (const [oid, ost] of states) {
            if (oid === id) continue;
            const otherRadioOk = (ost.location === "surface" || (ost.location === "underwater" && ost.periscope)) && ost.battery > 0;
            if (!otherRadioOk) continue;
            const dKm = distKm(ost.x, ost.y, st.x, st.y);
            const brg = bearingTo(ost.x, ost.y, st.x, st.y);
            const strength = longStrengthKm(dKm); // émission navire : omni, longue
            if (strength < RADIO_MIN_STRENGTH) continue;
            const cap = recvCapture(ost, brg, strength); // lire exige capter
            if (!cap) continue;
            ost.notifSeq = (ost.notifSeq || 0) + 1;
            ost.notifications.unshift({ id: ost.notifSeq, t: ost.t, text: sosText, kind: "bad", cat: "radio" });
          }
        }
      }
      // Messages entre navires. AUCUNE ACTION AUTOMATIQUE : « Position ? » est
      // une question littérale, « Ma position » est un envoi volontaire de sa
      // position ESTIMÉE (jamais la vraie). Seules les balises répondent
      // automatiquement (c'est leur fonction).
      // shipMsg: { kind: "posq" | "mypos", to?: "1234" } — sans `to` : diffusion.
      if (c.shipMsg && ["posq", "mypos"].includes(c.shipMsg.kind)) {
        const radioOkMsg = (st.location === "surface" || (st.location === "underwater" && st.periscope)) && st.battery > 0;
        if (radioOkMsg) {
          st.battery = Math.max(0, st.battery - CALL_BATTERY_COST);
          const isBroadcast = !c.shipMsg.to;
          const buildText = (recipientEst) => {
            if (c.shipMsg.kind === "posq") return `❓ Navire ${st.code} demande : « Position ? »`;
            return `📍 Navire ${st.code} communique sa position : ${st.estY.toFixed(2)}°N ${st.estX.toFixed(2)}°E (±${Math.round(st.unc)} km)`;
          };
          const text = buildText();
          const label = c.shipMsg.kind === "posq" ? "« Position ? »" : "« Ma position »";
          st.notifSeq = (st.notifSeq || 0) + 1;
          st.notifications.unshift({ id: st.notifSeq, t: st.t, text: `📡 Message ${label} ${isBroadcast ? "diffusé" : `émis vers ${c.shipMsg.to}`} (0,5 % batteries).`, kind: "info", cat: "radio" });
          // « Position ? » adressé : si le code composé est une BALISE, elle
          // l'interprète automatiquement et répond (réponse gratuite : le coût
          // a déjà été débité par l'émission du message). Si c'est un navire,
          // il lit la question — rien d'automatique. La réponse de la balise
          // est ÉMISE sur les ondes : les tiers à portée capte du brouillé.
          if (c.shipMsg.kind === "posq" && !isBroadcast) {
            const answered = callPosition(st, c.shipMsg.to, world, true);
            if (answered) broadcastScrambledFrom(answered.x, answered.y, id);
          }
          for (const [oid, ost] of states) {
            if (oid === id) continue;
            const otherRadioOk = (ost.location === "surface" || (ost.location === "underwater" && ost.periscope)) && ost.battery > 0;
            if (!otherRadioOk) continue;
            const dKm = distKm(ost.x, ost.y, st.x, st.y);
            const brg = bearingTo(ost.x, ost.y, st.x, st.y);
            const strength = longStrengthKm(dKm); // émission navire : omni, longue
            if (strength < RADIO_MIN_STRENGTH) continue;
            const cap = recvCapture(ost, brg, strength); // lire exige capter
            if (!cap) continue;
            ost.notifSeq = (ost.notifSeq || 0) + 1;
            if (isBroadcast) {
              // diffusion : contenu lisible par tous
              ost.notifications.unshift({ id: ost.notifSeq, t: ost.t, text, kind: "info", cat: "radio" });
            } else if (ost.code === c.shipMsg.to) {
              // destinataire : contenu privé lisible
              ost.notifications.unshift({ id: ost.notifSeq, t: ost.t, text, kind: "good", cat: "radio" });
            } else {
              // tiers : transmission brouillée, aucun contenu
              const info = scrambledIntercept(Math.round(strength), cap.source, cap.side);
              ost.notifications.unshift({ id: ost.notifSeq, t: ost.t, text: info.text, kind: "info", cat: info.cat });
            }
          }
        }
      }
      if (c.refuel === true && st.location === "surface") {
        st.fuel = 100; st.food = 100;
        st.notifSeq = (st.notifSeq || 0) + 1;
        st.notifications.unshift({ id: st.notifSeq, t: st.t, text: "🛒 Avitaillement complet : carburant et vivres à 100 %.", kind: "good", cat: "navire" });
      }
      // Planificateur : points de passage (max 30, coordonnées bornées à la
      // carte). Toute modification de route relance la visée au 1er point.
      if (Array.isArray(c.waypoints)) {
        st.waypoints = c.waypoints.slice(0, 30).map((p) => ({ x: clamp(+p.x || 0, 0, MAP), y: clamp(+p.y || 0, 0, MAP) }));
        st.wpIdx = 0;
      }
      // Un seul pilote à la fois : reprendre le pilote de route coupe le
      // verrou balise-vigie (l'inverse est déjà vrai : le verrou coupe le
      // pilote de route à l'engagement).
      if (typeof c.autopilot === "boolean") {
        st.autopilot = c.autopilot;
        if (c.autopilot && st.beaconLock) { st.beaconLock = null; st.lockBrg = null; }
      }
      if (Array.isArray(c.pins)) st.pins = c.pins.slice(0, 26);
      if (Array.isArray(c.measures)) st.measures = c.measures.slice(0, 40);
      // Saut de temps : super utilisateur uniquement. L'horloge de course est
      // PARTAGÉE : le saut est global — l'epoch recule, le serveur simule
      // ensuite chaque minute pour chaque navire (pulsations, détections,
      // points aux étoiles et consommations sont conservés pour tous).
      if (c.timeSkipMin != null && isSuper(id)) {
        const mins = Math.round(clamp(Number(c.timeSkipMin) || 0, 1, 24 * 60));
        race.epoch = (race.epoch || new Date(race.startedAt).getTime()) - mins * MS_PER_MIN / TIME_MULT;
        const now = gameMinutesNow();
        // (displayEpoch reste fixe : l'heure affichée avance avec t)
        for (const [, pst] of states) {
          while (pst.t < now) tick(pst, Math.min(MAX_STEP_MIN, now - pst.t), world);
        }
        store.save();
        st.notifSeq = (st.notifSeq || 0) + 1;
        st.notifications.unshift({ id: st.notifSeq, t: st.t, text: `⏱️ Saut de temps : +${mins} min (super user).`, kind: "info", cat: "navire" });
      }
      // Reset de la course : nouvelle graine (nouveau monde, nouvelles
      // balises), navires remis à neuf, horloge re-synchronisée sur Paris.
      if (c.resetRace === true && isSuper(id)) {
        const epoch = new Date();
        epoch.setHours(0, 0, 0, 0);
        race.seed = Math.floor(Math.random() * 1e9);
        race.epoch = epoch.getTime();
        race.displayEpoch = epoch.getTime();
        race.startedAt = new Date().toISOString();
        race.beacons = undefined;
        race.network = [];      // nouvelle course : journal global réinitialisé
        race.spawnOrder = {};   // réattribué ci-dessous, dans l'ordre actuel
        takenSpawns = [];       // nouvelle course : quai vidé
        race.migrated = false;  // la migration pourra rejouer si besoin
        const fresh = buildWorld(race.seed);
        world.PORT = fresh.PORT; world.CONTINENT = fresh.CONTINENT;
        world.ISLANDS = fresh.ISLANDS; world.OUTPOSTS = fresh.OUTPOSTS;
        world.BEACONS = fresh.BEACONS; world.COAST = fresh.COAST;
        world.isLand = fresh.isLand;
        // Réattribution des slots d'amarrage (espacement 50 m) et de codes
        // radio NEUFS, garantis sans collision avec les balises de la NOUVELLE
        // graine ni entre navires.
        let slotIdx = 0;
        const usedCodes = new Set(world.BEACONS.map((b) => b.code));
        for (const [pid] of states) {
          race.spawnOrder[pid] = slotIdx;
          let shipCode;
          do {
            shipCode = randomCode();
          } while (usedCodes.has(shipCode));
          usedCodes.add(shipCode);
          const nst = newPlayerState(world, {
            weatherSeed: race.seed % 1000,
            shipCode,
            takenSpawns,
          });
          nst.t = gameMinutesNow();
          states.set(pid, nst);
          race.players[pid] = nst;
          slotIdx++;
        }
        // Sonar : l'état éphémère suit la remise à neuf
        for (const m of [noiseHistory, sonarPending, sonarLive, sonarNoisePending, sonarHeard, bioPending, bioHeard]) m.clear();
        // Population NPC : régénérée pour la NOUVELLE graine (codes uniques
        // vs nouvelles balises + codes joueurs frais).
        race.npcs = generateNpcs(world, usedCodes, gameMinutesNow());
        lastNpcT = gameMinutesNow();
        store.save();
        st.notifSeq = (st.notifSeq || 0) + 1;
        st.notifications.unshift({ id: st.notifSeq, t: st.t, text: "🔄 Course réinitialisée : nouveau monde, nouvelles balises, navires à quai. Horloge re-synchronisée sur Paris.", kind: "good", cat: "navire" });
      }
      persistPlayer(id);
      ws.send(JSON.stringify({ type: "snapshot", data: publicSnapshot(id) }));
    } else if (msg.type === "snapshot") {
      ws.send(JSON.stringify({ type: "snapshot", data: publicSnapshot(id) }));
    }
  });

  ws.on("close", () => {
    sockets.get(id)?.delete(ws);
    persistPlayer(id);
  });
});

// Pousse un snapshot à chaque joueur connecté, toutes les secondes réelles —
// en temps réel les mouvements sont lents, 1 Hz suffit.
setInterval(() => {
  for (const [id, set] of sockets) {
    if (set.size === 0) continue;
    const msg = JSON.stringify({ type: "snapshot", data: publicSnapshot(id) });
    for (const ws of set) if (ws.readyState === 1) ws.send(msg);
  }
}, TICK_MS);
