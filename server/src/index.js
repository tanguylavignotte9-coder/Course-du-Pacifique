import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { buildWorld, newPlayerState, tick, weatherAt, computeView, clamp, distKm, DELIVERY_R_KM, CAPTURE_R_KM, WX_HORIZON_H, AUTOGUIDE_MODES, AUTOGUIDE_DEFAULT, shipVisibleKm, shipsCollide, callPosition, scrambledIntercept, longStrengthKm, bearingTo, spawnPosition, MAP, CALL_BATTERY_COST, RADIO_MIN_STRENGTH, randomCode, MS_PER_MIN, NOTIF_MAX, PINS_MAX, SAIL_DEFAULT, SPAWN_SEP_KM, HULL_HIST_KM, recvCapture, detectBeacon, onProximityPing, proxPingIntervalS, captureBeacon, SHORT_DECAY_KM, PROX_ARM_KM, sonarPing, sonarPassiveHear, shipNoisy, soundTravelMin, strengthKm, SOUND_DECAY_KM, SONAR_ECHO_PERSIST_S, generateNpcs, npcsTick, npcNoisy, npcBackPos, nextNpcEventMin, FISHER_CHAT_MEAN_MIN, CARGO_MSG_MEAN_MIN, WHALE_SONG_MEAN_MIN, detectKm, beastSpawn, beastTick, makeFisherman, makeCargo, makeWhale, BEAST_CRY_MEAN_MIN, BEAST_SONG_MEMORY_MIN, BEAST_TRACE_PERSIST_MIN, estimateZone, patrolTick, beastFlee, EXCLUSION_BULLETIN_MIN, EVIDENCE_MAX_AGE_MIN, TELEMETRY_MAX, BEACON_HEAR_KM, PATROL_HEAR_KM, PATROL_PUBLISH_MIN, PATROL_VIS_KM, PATROL_VIS_NUIT_KM, BEAST_FLEE_SILENCE_MIN, CANNON_DECAY_KM } from "../../shared/engine.js";
import { Store } from "./store.js";
import { Auth, hashPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
// Multiplicateur de temps (debug uniquement ; production = temps réel ×1).
const TIME_MULT = process.env.TIME_MULT ? Number(process.env.TIME_MULT) : 1;
const TICK_MS = 1000; // tick serveur : 1 s réelle
const MAX_STEP_MIN = 5; // pas de simulation max 5 min de jeu (design)
const PERSIST_MS = MS_PER_MIN; // persistance disque : 1 min réelle

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
  return process.env.ADMIN_SECRET || null;
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

// Relevés agrégés de la compagnie (télémesure exfiltrée aux connexions
// NETWORK + gisements des balises hydrophones et du patrouilleur).
// JAMAIS exposés en détail — seule la zone d'exclusion (le RÉSULTAT
// lissé) est publique.
if (!Array.isArray(race.evidence)) race.evidence = [];

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
  // Le patrouilleur officiel : moteur allumé en permanence — c'est une
  // vraie coque de cent mètres, on l'entend venir (et on la VOIT de jour).
  if (race.patrol) {
    const heard = sonarPassiveHear(me, race.patrol.x, race.patrol.y);
    if (heard) out.push({ kind: "moteur", bearing: heard.bearing, strength: heard.strength });
  }
  for (const ev of (sonarHeard.get(id) || [])) {
    out.push({ kind: "ping", bearing: ev.bearing, strength: ev.strength });
  }
  for (const ev of (bioHeard.get(id) || [])) {
    out.push({ kind: ev.kind || "biologique", bearing: ev.bearing, strength: ev.strength });
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
          heard.push({ kind: ev.kind || "biologique", bearing: ev.bearing, strength: ev.strength, heardMs: nowMs });
          bioHeard.set(id, heard);
          // Télémetre caché : un son INCONNU entendu est consigné (gisement +
          // force, depuis la position vraie — l'instrument sait, pas le
          // joueur). Remonté en cachette à la prochaine connexion NETWORK.
          if ((ev.kind || "biologique") === "inconnu") {
            telemeter(st, { k: "cry", x: st.x, y: st.y, brg: ev.bearing, str: ev.strength, t: st.t });
          }
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
function npcCodes() {
  const s = new Set();
  if (race.npcs) {
    for (const f of race.npcs.fishermen) s.add(f.code);
    for (const c of race.npcs.cargos) s.add(c.code);
  }
  return s;
}
function ensureNpcs() {
  if (!race.npcs) {
    const used = [...world.BEACONS.map((b) => b.code), ...[...states.values()].map((s) => s.code)];
    race.npcs = generateNpcs(world, used, gameMinutesNow());
    store.save();
  }
}
ensureNpcs();
let lastNpcT = gameMinutesNow();

// Émission radio depuis un NPC vers tous les navires joueurs : LOI DE
// RÉCEPTION UNIQUE (omni ≥ 75 % / directionnel ≥ sens), famille longue.
// Sert au bafouillage, aux messages cargos et au SOS d'un bateau attaqué.
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

// Télémetre caché de l'ordinateur de bord : consigne, À L'INSU du joueur,
// ce que ses instruments entendent (sons inconnus au sonar) et découvrent
// (traces, SOS reçus). JAMAIS dans le snapshot — le joueur n'en voit rien.
// Le tampon est exfiltré vers race.evidence à chaque connexion NETWORK.
function telemeter(st, entry) {
  if (!Array.isArray(st.telemetry)) st.telemetry = [];
  st.telemetry.push(entry);
  while (st.telemetry.length > TELEMETRY_MAX) st.telemetry.shift();
}

// ---------- La Bête v1 : état persisté (race.beast) ----------
// Une seule Bête, invisible, persistée dans la course. Elle entend les
// bruits moteurs des NPC et les chants de baleines récents ; les joueurs
// sont ignorés en v1. Ses cris (kind « inconnu ») sont des bruits sonar
// passifs ; ses traces (épaves, mers de sang) sont visibles de près et
// rebondissent ANONYMEMENT au ping (épave = « navire », carcasse =
// « biologique » — rien de nouveau à étiqueter côté joueur).
const recentSongs = []; // [{ x, y, t, ref }] chants récents — ouïe de la Bête (éphémère : perdus au redémarrage)
function ensureBeast() {
  if (!race.beast) {
    const p = beastSpawn(world);
    race.beast = {
      x: p.x, y: p.y, heading: Math.floor(Math.random() * 360),
      hunger: 1, nextCryMin: nextNpcEventMin(gameMinutesNow(), BEAST_CRY_MEAN_MIN),
      traces: [], traceSeq: 0,
    };
    store.save();
  }
}
ensureBeast();
let lastBeastT = gameMinutesNow();

// Bruit sonar passif pour tous les joueurs (retard de propagation réel) :
// chants de baleines (kind « biologique »), cris de la Bête (kind
// « inconnu ») et tirs de canon du patrouilleur (kind « canon », décroissance
// propre). Passe par la même file que les chants : bioPending.
// Les BALISES-STATIONS et le PATROUILLEUR ont un hydrophone : tout son
// INCONNU à portée d'écoute alimente directement la carte de la compagnie
// — un gisement depuis une position connue (triangulation gratuite,
// réseau dense : la baseline officielle de l'estimation).
function emitSoundToAll(x, y, kind, nowMin, decayKm = SOUND_DECAY_KM) {
  for (const [oid, ost] of states) {
    const dKm = distKm(ost.x, ost.y, x, y);
    const strength = strengthKm(dKm, decayKm);
    if (strength <= 0) continue;
    const q = bioPending.get(oid) || [];
    q.push({
      kind,
      bearing: Math.round(bearingTo(ost.x, ost.y, x, y)),
      strength,
      arriveMin: ost.t + soundTravelMin(dKm),
    });
    bioPending.set(oid, q);
  }
  if (kind === "inconnu") {
    for (const b of world.BEACONS) {
      const dKm = distKm(b.x, b.y, x, y);
      if (dKm > BEACON_HEAR_KM) continue;
      race.evidence.push({
        k: "cry", x: b.x, y: b.y,
        brg: Math.round(bearingTo(b.x, b.y, x, y)),
        str: strengthKm(dKm, SOUND_DECAY_KM), t: nowMin,
      });
    }
    const patrol = race.patrol;
    if (patrol && distKm(patrol.x, patrol.y, x, y) <= PATROL_HEAR_KM) {
      race.evidence.push({
        k: "cry", x: patrol.x, y: patrol.y,
        brg: Math.round(bearingTo(patrol.x, patrol.y, x, y)),
        str: strengthKm(distKm(patrol.x, patrol.y, x, y), SOUND_DECAY_KM), t: nowMin,
      });
    }
  }
}

// Passe NPC (boucle 1 Hz) : déplacement simple + émissions. Le monde vit
// même sans joueur connecté. dt borné par le garde-fou du moteur (les
// sauts de temps super user font vivre les NPC de 120 min au plus).
function npcPass(now) {
  const npcs = race.npcs;
  if (!npcs) return;
  const prev = lastNpcT;
  lastNpcT = now;
  npcsTick(npcs, now - prev, world);
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
  // Chant de baleine : bruit sonar passif (kind « biologique », retard réel)
  // + OUÏE DE LA BÊTE : un chant est un bruit — chanter révèle la baleine.
  for (const wh of npcs.whales) {
    if (now < wh.nextSongMin) continue;
    wh.nextSongMin = nextNpcEventMin(now, WHALE_SONG_MEAN_MIN);
    recentSongs.push({ x: wh.x, y: wh.y, t: now, ref: wh });
    emitSoundToAll(wh.x, wh.y, "biologique", now);
  }
}

// Passe Bête (boucle 1 Hz) : ouïe → chasse → repas (trace + cri + SOS) →
// cris périodiques → expiration des traces + respawn → vue des traces.
// Le monde vit même sans joueur connecté.
function beastPass(now) {
  ensureBeast();
  const beast = race.beast;
  const npcs = race.npcs;
  // ouïe : bruits moteurs NPC dans les 500 km + chants récents (mémoire)
  for (let i = recentSongs.length - 1; i >= 0; i--) {
    if (now - recentSongs[i].t > BEAST_SONG_MEMORY_MIN) recentSongs.splice(i, 1);
  }
  const sources = [];
  if (npcs) {
    for (const f of npcs.fishermen) {
      if (!npcNoisy(f) || distKm(beast.x, beast.y, f.x, f.y) >= SOUND_DECAY_KM) continue;
      sources.push({ x: f.x, y: f.y, liveX: f.x, liveY: f.y, ref: f });
    }
    for (const c of npcs.cargos) {
      if (!npcNoisy(c) || distKm(beast.x, beast.y, c.x, c.y) >= SOUND_DECAY_KM) continue;
      sources.push({ x: c.x, y: c.y, liveX: c.x, liveY: c.y, ref: c });
    }
    for (const s of recentSongs) {
      if (distKm(beast.x, beast.y, s.x, s.y) >= SOUND_DECAY_KM) continue;
      sources.push({ x: s.x, y: s.y, liveX: s.ref.x, liveY: s.ref.y, ref: s.ref });
    }
  }
  const prev = lastBeastT;
  lastBeastT = now;
  const eaten = beastTick(beast, now - prev, world, sources);
  // Repas : la cible disparaît, une trace naît, un cri part — et un SOS si
  // c'est un bateau (une baleine n'a pas de radio).
  if (eaten && npcs) {
    const list = eaten.kind === "whale" ? npcs.whales : eaten.kind === "cargo" ? npcs.cargos : npcs.fishermen;
    const idx = list.indexOf(eaten);
    if (idx >= 0) list.splice(idx, 1);
    for (let i = recentSongs.length - 1; i >= 0; i--) {
      if (recentSongs[i].ref === eaten) recentSongs.splice(i, 1); // plus jamais une cible fantôme
    }
    beast.traceSeq = (beast.traceSeq || 0) + 1;
    beast.traces.push({
      id: `t${beast.traceSeq}`,
      kind: eaten.kind === "whale" ? "carcasse" : "epave",
      src: eaten.kind, x: eaten.x, y: eaten.y, t: now,
    });
    emitSoundToAll(beast.x, beast.y, "inconnu", now); // le cri de l'attaque
    if (eaten.kind !== "whale") {
      // SOS du bateau en perdition : diffusion lisible (loi de réception),
      // position déclarée — un vrai SOS, il sert à retrouver l'épave.
      const sosText = `🆘 SOS du navire ${eaten.code} — position déclarée : ${eaten.y.toFixed(2)}°N ${eaten.x.toFixed(2)}°E — quelque chose nous percute, on coule !`;
      radioSend(eaten.x, eaten.y, (ost, cap) => {
        ost.notifSeq = (ost.notifSeq || 0) + 1;
        ost.notifications.unshift({ id: ost.notifSeq, t: ost.t, text: sosText, kind: "bad", cat: "radio" });
        // Télémetre caché : le SOS (position déclarée) est consigné — la
        // compagnie lit aussi les ondes de sa propre flotte.
        telemeter(ost, { k: "sos", x: eaten.x, y: eaten.y, t: ost.t });
      });
    }
  }
  // Cris périodiques (en chasse comme rassasiée — on ne sait jamais où elle est)
  if (now >= beast.nextCryMin) {
    beast.nextCryMin = nextNpcEventMin(now, BEAST_CRY_MEAN_MIN);
    emitSoundToAll(beast.x, beast.y, "inconnu", now);
  }
  // Traces : expiration (12 h) puis respawn du NPC mangé — population constante
  const expired = [];
  beast.traces = (beast.traces || []).filter((tr) => {
    if (now - tr.t < BEAST_TRACE_PERSIST_MIN) return true;
    expired.push(tr);
    return false;
  });
  for (const tr of expired) {
    if (!npcs) continue;
    const used = new Set([...world.BEACONS.map((b) => b.code), ...[...states.values()].map((s) => s.code)]);
    for (const f of npcs.fishermen) used.add(f.code);
    for (const c of npcs.cargos) used.add(c.code);
    let code;
    do { code = randomCode(); } while (used.has(code));
    if (tr.src === "fisher") npcs.fishermen.push(makeFisherman(world, code, now, `f${npcs.fishermen.length}`));
    else if (tr.src === "cargo") npcs.cargos.push(makeCargo(world, code, now, `c${npcs.cargos.length}`));
    else npcs.whales.push(makeWhale(world, now, `w${npcs.whales.length}`));
  }
  // Vue des traces : première détection visuelle → notification
  for (const [id, st] of states) {
    const w = weatherAt(st.x, st.y, st.t, st.weatherSeed);
    const hour = (st.t / 60) % 24;
    const night = hour < 6 || hour >= 20;
    const canSee = st.location === "surface" || st.periscope;
    const det = canSee ? detectKm("trace", w.visibility, night) : -1;
    for (const tr of (beast.traces || [])) {
      if ((st.sawTraceIds || []).includes(tr.id)) continue;
      if (distKm(st.x, st.y, tr.x, tr.y) > det) continue;
      if (!Array.isArray(st.sawTraceIds)) st.sawTraceIds = [];
      st.sawTraceIds.push(tr.id);
      if (st.sawTraceIds.length > 60) st.sawTraceIds.shift();
      // Télémetre caché : une trace découverte est un POINT QUASI EXACT
      // pour la carte de la compagnie — la preuve la plus forte qui soit.
      telemeter(st, { k: "trace", x: tr.x, y: tr.y, t: st.t });
      st.notifSeq = (st.notifSeq || 0) + 1;
      st.notifications.unshift({
        id: st.notifSeq, t: st.t, kind: "info", cat: "vision",
        text: tr.kind === "epave"
          ? "🚢 Une épave dérive — coque déchiquetée, aucun survivant en vue."
          : "🩸 La mer est rouge de sang sur des centaines de mètres — une carcasse tourne lentement.",
      });
    }
  }
}
// ---------- Le Patrouilleur : état persisté (race.patrol) ----------
// Frégate officielle de la compagnie : part du port au début de la
// course, attend à quai tant qu'il n'y a aucune estimation, puis rejoint
// la zone estimée et la fouille. Navire RÉEL : moteur audible au sonar
// passif, coque visible selon la météo, position publiée au NETWORK.
function ensurePatrol() {
  if (!race.patrol) {
    race.patrol = {
      x: world.PORT.x, y: world.PORT.y, heading: 0,
      mode: "quai", tgtX: world.PORT.x, tgtY: world.PORT.y,
      searchMin: 0, searchAcc: 0,
      engageLeftMin: 0, shotClock: 0, cooldownLeftMin: 0,
      pub: null, nextPubMin: gameMinutesNow(),
    };
    store.save();
  }
}
ensurePatrol();
let lastPatrolT = gameMinutesNow();

// Passe Patrouilleur (boucle 1 Hz) : la frégate vit sur l'estimation
// FRAÎCHE (recalculée à chaque passe — pas seulement la zone publiée),
// fouille, tire au canon au contact (la créature fuit, jamais tuée), et
// publie sa position au NETWORK à cadence horaire.
function patrolPass(now) {
  ensurePatrol();
  const patrol = race.patrol;
  const prev = lastPatrolT;
  lastPatrolT = now;
  const est = estimateZone(race.evidence, now);
  const beast = race.beast;
  const events = patrolTick(patrol, now - prev, world, est, beast ? { x: beast.x, y: beast.y } : null);
  // Publication NETWORK : position officielle horaire (toujours en retard
  // d'une heure au plus — la donnée publique est un service, pas une vue).
  if (now >= (patrol.nextPubMin || 0)) {
    patrol.pub = { x: patrol.x, y: patrol.y, t: now };
    patrol.nextPubMin = now + PATROL_PUBLISH_MIN;
  }
  for (const ev of events) {
    if (ev.k === "detect") {
      // Contact : la preuve la plus forte — un point quasi exact.
      race.evidence.push({ k: "seen", x: ev.x, y: ev.y, t: now });
      // La créature s'enfuit — JAMAIS tuée. Deux régimes (loin / pas loin).
      if (beast) {
        beastFlee(beast, patrol.x, patrol.y);
        beast.nextCryMin = now + BEAST_FLEE_SILENCE_MIN; // silence : la zone regonfle
      }
      emitSoundToAll(patrol.x, patrol.y, "canon", now, CANNON_DECAY_KM);
      store.save();
    } else if (ev.k === "shot") {
      emitSoundToAll(ev.x, ev.y, "canon", now, CANNON_DECAY_KM);
    }
  }
  // Visibilité physique de la frégate : météo du jour (PATROL_VIS_KM) ou
  // de nuit (feux, PATROL_VIS_NUIT_KM). Notification à la 1re détection —
  // navire OFFICIEL : il porte son nom, tout le monde sait ce que c'est.
  for (const [, st] of states) {
    const canSee = st.location === "surface" || st.periscope;
    if (!canSee) { st.sawPatrol = false; continue; }
    const w = weatherAt(st.x, st.y, st.t, st.weatherSeed);
    const hour = (st.t / 60) % 24;
    const night = hour < 6 || hour >= 20;
    const det = Math.min(w.visibility, night ? PATROL_VIS_NUIT_KM : PATROL_VIS_KM);
    const visible = distKm(st.x, st.y, patrol.x, patrol.y) <= det;
    if (visible && !st.sawPatrol) {
      st.notifSeq = (st.notifSeq || 0) + 1;
      st.notifications.unshift({
        id: st.notifSeq, t: st.t, kind: "info", cat: "vision",
        text: `🚢 Frégate de la Patrouille repérée : ~${Math.round(distKm(st.x, st.y, patrol.x, patrol.y))} km — grande coque grise, marque MaxMedia.`,
      });
    }
    st.sawPatrol = visible;
  }
}

// ---------- Zone d'exclusion officielle (bulletins périodiques) ----------
// La compagnie publie, à cadence fixe, la zone estimée en AVIS OFFICIEL à
// TOUS (advisory : entrer = à ses risques, aucune sanction). Le prétexte
// est INVÉRIFIABLE (« opérations hydrographiques ») : la compagnie ne
// ment que sur le sens, jamais sur les faits. Le retard de la zone EST
// le gameplay : croyance, jamais clôture — elle est toujours en retard.
let nextBulletinMin = gameMinutesNow();
function exclusionPass(now) {
  if (now < nextBulletinMin) return;
  nextBulletinMin = now + EXCLUSION_BULLETIN_MIN;
  // purge : les relevés de plus de EVIDENCE_MAX_AGE_MIN sont morts
  race.evidence = race.evidence.filter((e) => now - e.t < EVIDENCE_MAX_AGE_MIN);
  const est = estimateZone(race.evidence, now);
  if (!est) return; // aucune donnée vivante : aucune zone publiée
  race.exclusion = { x: est.x, y: est.y, rKm: est.rKm, t: now };
  store.save();
  const text = `⚠️ AVIS OFFICIEL — zone d'exclusion ${est.y.toFixed(1)}°N ${est.x.toFixed(1)}°E, rayon ${Math.round(est.rKm)} km (opérations hydrographiques en cours). Navigation dans le secteur à vos risques et périls.`;
  for (const [, st] of states) {
    st.notifSeq = (st.notifSeq || 0) + 1;
    st.notifications.unshift({ id: st.notifSeq, t: st.t, text, kind: "warn", cat: "radio" });
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
      || [...states.values()].some((s) => s.code === shipCode)
      || npcCodes().has(shipCode));
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
  beastPass(now);
  patrolPass(now);
  exclusionPass(now);
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
      const targetRange = shipVisibleKm(ti.st, oi.night);
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
    if (st.notifications.length > NOTIF_MAX) st.notifications.length = NOTIF_MAX;
  }
  // Collisions : coques 15 m x 5 m en rectangles ORIENTÉS (OBB/SAT),
  // précises au mètre. La vitesse de chaque navire en contact est stoppée.
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
      if (o.location === st.location && distKm(st.x, st.y, o.x, o.y) < HULL_HIST_KM) touching = true;
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
      heading: st.heading, headingOrder: st.headingOrder ?? st.heading, sail: st.sail ?? SAIL_DEFAULT, engine: st.engine,
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
      beaconCount: world.BEACONS.length,
    },
    weather: w,
    view: computeView(st, world, (race.beast && race.beast.traces) || []),
    // NETWORK : zone serveur (bouton + connexion) et journal global, exposé
    // UNIQUEMENT aux joueurs connectés ET encore en zone.
    networkZone: netZone(st),
    networkLog: st.networked && netZone(st) ? race.network : null,
    // Zone d'exclusion officielle : donnée PUBLIQUE de la compagnie (comme
    // la météo) — coordonnées absolues, dessinables sur la carte papier.
    // C'est le résultat lissé de l'estimation, toujours en retard sur le
    // réel. Le tampon du télémetre, lui, n'est JAMAIS exposé.
    exclusion: race.exclusion || null,
    // Position PUBLIÉE du patrouilleur : réservée aux abonnés connectés en
    // zone (service NETWORK) — « qui est allé où, quand » inclut la flotte.
    patrolPub: st.networked && netZone(st) && race.patrol ? race.patrol.pub : null,
    // Navires détectés : azimut et distance uniquement (jamais la position
    // absolue — le client dessine depuis son estimé, comme pour les îles).
    ships: (st.sawShips || []).map((tid) => {
      const ts = states.get(tid);
      const km = distKm(st.x, st.y, ts.x, ts.y);
      const az = Math.round((Math.atan2(ts.x - st.x, ts.y - st.y) * 180) / Math.PI + 360) % 360;
      return { id: ts.code, km: Math.round(km * 10) / 10, az, light: !!ts.light };
    }).concat(st.sawPatrol && race.patrol ? [{
      id: "PATROUILLE",
      km: Math.round(distKm(st.x, st.y, race.patrol.x, race.patrol.y) * 10) / 10,
      az: Math.round((Math.atan2(race.patrol.x - st.x, race.patrol.y - st.y) * 180) / Math.PI + 360) % 360,
      light: true,
    }] : []),
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
// Toutes les routes exigent le secret admin, défini UNIQUEMENT via la
// variable d'environnement ADMIN_SECRET (jamais généré, jamais écrit sur
// disque, jamais affiché dans la console).
function getAdminSecret() {
  return process.env.ADMIN_SECRET || null;
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
        // les baleines comme « biologique ». Les TRACES de la Bête aussi —
        // ANONYMEMENT : épave = « navire » (corps de surface), carcasse =
        // « biologique » (elle passe par la file biologics). La Bête elle-
        // même est immergée : invisible au ping, comme tout corps immergé.
        // Aucune position n'est exposée au client.
        const npcSurf = race.npcs
          ? [...race.npcs.cargos, ...race.npcs.fishermen].map((n) => ({ x: n.x, y: n.y, location: "surface" }))
          : [];
        const patrolSurf = race.patrol ? [{ x: race.patrol.x, y: race.patrol.y, location: "surface" }] : [];
        const traces = (race.beast && race.beast.traces) || [];
        const epaves = traces.filter((tr) => tr.kind === "epave").map((tr) => ({ x: tr.x, y: tr.y, location: "surface" }));
        const carcasses = traces.filter((tr) => tr.kind === "carcasse").map((tr) => ({ x: tr.x, y: tr.y }));
        const res = sonarPing(
          st, world,
          [...states.values()].filter((o) => o !== st).concat(npcSurf).concat(patrolSurf).concat(epaves),
          ((race.npcs || {}).whales || []).concat(carcasses),
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
          // Exfiltration silencieuse : la connexion remonte le tampon du
          // télémetre vers la carte de la compagnie, puis le purge. Aucun
          // texte ne l'annonce — le joueur croit consulter, il transmet.
          if (Array.isArray(st.telemetry) && st.telemetry.length) {
            race.evidence.push(...st.telemetry);
            st.telemetry = [];
          }
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
      // Avitaillement uniquement à quai (port ou avant-poste) : contrôle
      // serveur — le client masquant le bouton ne suffit pas (anti-triche)
      if (c.refuel === true && st.location === "surface" &&
          (distKm(st.x, st.y, world.PORT.x, world.PORT.y) < DELIVERY_R_KM ||
           world.OUTPOSTS.some((o) => distKm(st.x, st.y, o.x, o.y) < DELIVERY_R_KM))) {
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
      if (Array.isArray(c.pins)) st.pins = c.pins.slice(0, PINS_MAX);
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
        race.npcs = undefined; // nouvelle population régénérée en fin de reset, sur le nouveau monde
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
        // Correctif Bête : le reset ne régénérait PAS la créature — elle
        // survivait au reset avec des coordonnées de l'ANCIEN monde.
        race.beast = undefined;
        ensureBeast();
        lastBeastT = gameMinutesNow();
        recentSongs.length = 0;
        // Patrouilleur : nouvelle course, frégate neuve au port.
        race.patrol = undefined;
        ensurePatrol();
        lastPatrolT = gameMinutesNow();
        // Relevés et zone d'exclusion : la nouvelle course repart à vide.
        race.evidence = [];
        race.exclusion = null;
        nextBulletinMin = gameMinutesNow();
        store.save();
        // Notifier le NOUVEL état du joueur : l'ancien objet `st` a été
        // remplacé dans `states` par le rebuild ci-dessus (sinon : notif perdue)
        const newSt = states.get(id);
        if (newSt) {
          newSt.notifSeq = (newSt.notifSeq || 0) + 1;
          newSt.notifications.unshift({ id: newSt.notifSeq, t: newSt.t, text: "🔄 Course réinitialisée : nouveau monde, nouvelles balises, navires à quai. Horloge re-synchronisée sur Paris.", kind: "good", cat: "navire" });
        }
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
