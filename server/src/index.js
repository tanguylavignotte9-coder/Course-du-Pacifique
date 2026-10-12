import fsSync from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { buildWorld, newPlayerState, tick, weatherAt, computeView, clamp, systemsAt, radioOk, notify, distKm, DELIVERY_R_KM, CAPTURE_R_KM, WX_HORIZON_H, AUTOGUIDE_MODES, autoguideMode, shipVisibleKm, shipsCollide, callPosition, scrambledIntercept, longStrengthKm, LONG_DECAY_KM, bearingTo, spawnPosition, MAP, CALL_BATTERY_COST, RADIO_MIN_STRENGTH, randomCode, MS_PER_MIN, NOTIF_MAX, PINS_MAX, SAIL_DEFAULT, SPAWN_SEP_KM, HULL_HIST_KM, recvCapture, detectBeacon, onProximityPing, proxPingIntervalS, captureBeacon, SHORT_DECAY_KM, PROX_ARM_KM, sonarPing, sonarPassiveHear, soundBlocked, shipNoisy, soundTravelMin, strengthKm, SOUND_DECAY_KM, SONAR_ECHO_PERSIST_S, generateNpcs, npcsTick, npcNoisy, npcBackPos, nextNpcEventMin, FISHER_CHAT_MEAN_MIN, CARGO_MSG_MEAN_MIN, WHALE_SONG_MEAN_MIN, detectKm, beastSpawn, beastTick, makeFisherman, makeCargo, makeWhale, BEAST_CRY_MEAN_MIN, BEAST_SPAWN_DIGEST_MIN, BEAST_SPAWN_DIGEST_MAX, BEAST_SONG_MEMORY_MIN, BEAST_TRACE_PERSIST_MIN, estimateZone, patrolTick, beastFlee, NEWSLETTER_MIN, NEWS_MAX, EXCLUSION_BULLETIN_MIN, EVIDENCE_MAX_AGE_MIN, TELEMETRY_MAX, BEACON_HEAR_KM, PATROL_HEAR_KM, PATROL_PUBLISH_MIN, PATROL_VIS_KM, PATROL_VIS_NUIT_KM, BEAST_FLEE_SILENCE_MIN, CANNON_DECAY_KM, DEG_KM, findStation, PATROL_BERTH_KM, tracePush, condFactor, damagePart, DAMAGE_HIT_PCT } from "../../shared/engine.js";
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
const SNAP_FLUSH_MS = 250; // flush des snapshots de réponse aux commandes (coalescence anti-tempête, voir boucle en fin de fichier)

// Bafouillage des pêcheurs (diffusion) : petites phrases de la vie à bord.
// JAMAIS de coordonnées dans le texte (règle : pas de position vraie dans
// les messages NPC — la position ne se révèle que par le geste du joueur).
// JAMAIS l'attaque de la Bête : ça, c'est le SOS, un message long en
// famille longue, émis au moment de l'attaque.
//
// PERSONNALITÉS : chaque pêcheur a un ARCHÉTYPE stable — humour, routine,
// lassitude, problème ou suspicion — dérivé de son code radio (déterministe :
// pas de migration, survit aux redémarrages, cohérent d'un message à l'autre).
// 130 phrases uniques. Les 18 phrases historiques sont conservées,
// redistribuées dans leur archétype.
// SUSPENSION : la « suspicion » décrit des PHÉNOMÈNES ÉTRANGES, jamais la
// bête vue explicitement — et elle n'est JAMAIS corrélée à la présence
// réelle de la créature (sinon la radio deviendrait un détecteur). Le SOS
// reste l'unique message qui dit l'attaque, en famille longue.
const FISHER_CHAT_LIBRARY = {
  humour: [
    "…et encore un qui a filé avec l'appât, ces bestioles apprennent.",
    "Du poisson, du poisson, du poisson !",
    "La mouette a piqué mon casse-croûte, la journée commence bien.",
    "Ma femme dit que je parle plus aux poissons qu'à elle. Elle n'a pas tort.",
    "Question du jour : le café d'hier, ça se boit encore ?",
    "Un poisson m'a regardé de travers, je l'ai relâché par principe.",
    "Ici on ne pêche pas, on fait de la thérapie à la moulinette.",
    "Mon copain trouve la mer romantique. Il n'a jamais viré une caisse à 4 h du matin.",
    "Le poisson doit rigoler, on lui fait la même blague depuis vingt ans.",
    "Si le poisson prenait le café, on ne ferait pas le poids.",
    "J'ai nommé ma bouée Dorothée. Elle s'accroche bien, Dorothée.",
    "Le vrai poisson, c'est celui qui mange l'appât et s'en va. Respect.",
    "La mer m'a pris mon chapeau. Je le récupérerai au prochain port.",
    "Mon chat de bord a le mal de mer. Le chat, pas moi. Ça change.",
    "On a pêché une botte. Demain l'autre, et on fera la paire.",
    "Le poisson du jour ment : il nous a menti toute la journée.",
    "La mer me doit de l'argent, mais elle paie en poisson.",
    "Ici l'ambiance est comme le café du bord : trop chaude.",
    "Mon moteur ronronne mieux que mon beau-frère chante, et c'est peu dire.",
    "Deuxième canne cassée du jour. Le record du magasin tient bon.",
    "Le poisson ne répond pas. Je laisse un message, il rappellera peut-être.",
    "Le café de bord est si fort que les mouettes tournent en sens inverse.",
    "La pêche du jour : trois poissons et un tabouret. Le tabouret a l'air frais.",
    "Un jour je prendrai ma retraite et j'ouvrirai un musée des cannes cassées.",
    "Ici le capitaine, le cuisinier et le mousse, c'est le même homme. Le mousse obéit bien.",
  ],
  routine: [
    "Filets remontés, pas grand-chose dedans…",
    "Banc de maquereaux au nord, ça donne espoir.",
    "La mer est belle ce soir, ça sent la bonne journée.",
    "Remontée des filets dans un quart d'heure, silence radio après.",
    "Bonne pêche à toutes les unités de la zone.",
    "Patience et malice — la pêche, c'est tout un art.",
    "Ce soir, soupe de poisson pour tout le monde.",
    "Deux caisses triées, le reste part à la cale.",
    "Le café du bord est prêt, qui vient en chercher ?",
    "Petit à petit, la soute se remplit. Bonne journée.",
    "Vérification des lignes de traîne, tout est en ordre.",
    "On tient le cap, la mer fait le reste.",
    "Marée du matin correcte, on repart pour la seconde.",
    "Le thermos est plein, la journée peut commencer.",
    "Changement de zone, ici c'était du désert.",
    "Fin de poste pour moi, mon frère prend la barre.",
    "On attend la météo du soir avant de décider.",
    "Le filet du fond remonte propre, du bon travail.",
    "J'ai remis de l'ordre dans la cale, on respire mieux.",
    "Trois heures de traîne, quatre maquereaux. On continue.",
    "Tout le monde à ses postes, on relève.",
    "L'appât est frais, la journée part bien.",
    "Un coup de balayage sur le pont et on déjeune.",
    "Ça mord par petites touches, on y va mollo.",
    "On marque la bouée, on garde la zone en mémoire.",
  ],
  lassitude: [
    "Douze heures de mer, les bras ne suivent plus.",
    "Encore une journée pareille, on dirait hier.",
    "Je compte les jours avant la pause.",
    "La cabine sent le gasoil et la fatigue.",
    "Le dos me tue, la mer me tient.",
    "Trop de quarts, pas assez d'oreillers.",
    "La mer est un métier pour les jeunes. J'étais jeune aussi.",
    "Trente ans de filets, ça laisse des marques aux mains.",
    "Ici les journées se ressemblent, seule la météo change.",
    "J'ai laissé la radio allumée pour la compagnie.",
    "Mon lit à terre me manque, ma couchette me tient chaud.",
    "On salue le lever du jour, on salue encore le café.",
    "La brume du jour me colle au moral.",
    "Je parle à mes filets comme à de vieux amis. Eux au moins, ils écoutent.",
    "Retour au port, retour à la vraie vie.",
    "Les genoux lâchent avant le moteur, heureusement.",
    "Café, filet, café, filet. Voilà ma culture générale.",
    "Personne ne dit merci quand les caisses sont pleines.",
    "Je ne me plains pas, je décris.",
    "Encore un coucher de soleil magnifique que je n'ai pas le temps de regarder.",
    "Les années passent, la mer reste identique.",
    "La nuit, seul le moteur me tient compagnie.",
    "Fatigué comme un chien, et je ne suis même pas un chien de mer.",
    "Un jour de plus, une vague de plus.",
    "Je rêve d'un banc de poissons et je me réveille sur un banc de brume.",
  ],
  probleme: [
    "Moteur qui chauffe, on rentre doucement.",
    "Par ici la brume, on garde les yeux ouverts.",
    "Le filet s'est déchiré sur un haut-fond, journée fichue.",
    "Le treuil grippe encore — bricolage ce soir.",
    "Une lame nous a emporté deux caisses, la mer ne rend rien.",
    "La pompe de cale fatigue, on écope à la main.",
    "La barre tire d'un côté, il faut que je regarde ça.",
    "Le sonar grésille, on pêche à l'instinct.",
    "Le générateur cale au ralenti, on croise les doigts.",
    "Filet emmêlé sur le fond, deux heures de tri en perspective.",
    "L'ancre a dérapé cette nuit, on a dérivé en silence.",
    "La lampe de pont a rendu l'âme, bricolage au scotch.",
    "Bouée de signalisation perdue, on refait le parcours de mémoire.",
    "Deux gilets à changer, le sel a fait son œuvre.",
    "Le tangage a renversé la gamelle, midi prend l'eau.",
    "Le réservoir d'eau douce fuit, rationnement à bord.",
    "Un requin a goûté le filet, on raccommode.",
    "La VHF crachote, si vous m'entendez, tant mieux.",
    "Trop de vent pour lever, on attend que ça tombe.",
    "L'hélice a pris un bout de filet, plongée à prévoir.",
    "La cale sent le gasoil, on cherche la fuite.",
    "Le treuil grince à la manœuvre, on ne force pas.",
    "Le vent de secteur tourne, on adapte la route.",
    "Le filet remonte chargé d'algues, tri ce soir.",
    "Une voie d'eau bouchée à la poix, on surveille la cale.",
  ],
  suspicion: [
    "Un silence de cathédrale ici. Même les mouettes n'osent plus.",
    "Un banc entier a viré d'un coup, tous en même temps. Jamais vu ça.",
    "Le sondeur a montré quelque chose de large sous la coque. Je n'ai pas insisté pour voir.",
    "Il y a un remous qui me suit depuis ce matin. Je ne lui ai pas demandé son cap.",
    "Les baleines ont arrêté de chanter d'un coup. Le silence, ça s'entend.",
    "J'ai remonté des poissons à moitié croqués. Pas l'œuvre d'un cormoran.",
    "Une odeur de vase profonde, ici qu'on est à plein large. Ça n'a pas de sens.",
    "Le filet a tremblé tout seul, sans rien dedans. J'ai changé de poste.",
    "Une ombre a glissé sous la quille. De ces ombres qu'on ne commente pas au dîner.",
    "Tous les oiseaux ont quitté le secteur d'un coup. Ils savent des choses, les oiseaux.",
    "Une nappe de mousse large comme une route, qui ne suit pas le courant.",
    "Un chant très grave dans les basses fréquences. Aucune baleine connue ne chante ça.",
    "Les prises ont disparu du secteur en une nuit. L'océan s'est vidé, ici.",
    "L'eau a chuté de quatre degrés d'un seul coup, à cet endroit précis.",
    "Une grosse houle de fond, sans vent, sans navire, sans raison.",
    "Le compas a tourné tout seul dix secondes. Le moteur tournait bien, lui.",
    "Ici, même les requins ne se baignent pas.",
    "J'ai sorti un poisson avec une marque que la dent d'aucun loup n'explique.",
    "Le sondeur affiche un double fond qui bouge. Les cartes marines n'en parlent pas.",
    "Des bulles remontent par gros paquets, et aucun navire au-dessus.",
    "La ligne de traîne s'est tendue comme un cordage de piano. Puis plus rien.",
    "Un long souffle le long de la coque, dans la brume. Personne n'a regardé par-dessus bord.",
    "Le chum n'attire plus rien depuis hier. Même les appâts font grève.",
    "Une écaille dans un filet vide. Une écaille de la taille de ma main.",
    "Une bosse mobile à l'échosondeur, trente mètres sous la quille. Elle descend quand je m'arrête, remonte quand je repars.",
    "Note sans commentaire : 4 h du matin, mer d'huile, et trois plongeons de quelque chose que je ne nommerai pas.",
    "Un grésillement de très basse fréquence sur la radio. La météo dit qu'il n'y a rien.",
    "Le bateau tangue dans un ressac qui n'existe pas, à 300 mètres de fond.",
    "J'ai décroché une masse qui n'a même pas essayé de fuir. C'est ça qui me travaille.",
    "Si vous pêchez ici cette nuit, gardez le moteur chaud. C'est tout ce que je dis, et je ne dis rien.",
  ],
};

const FISHER_CHAT_KINDS = ["humour", "routine", "lassitude", "probleme", "suspicion"];

// Archétype stable d'un pêcheur : somme des caractères de son code radio.
const fisherChatKind = (code) =>
  FISHER_CHAT_KINDS[[...code].reduce((s, c) => s + c.charCodeAt(0), 0) % FISHER_CHAT_KINDS.length];
const clamp01 = (v) => clamp(v, 0, 1);

// ---------- Persistance & comptes ----------
const store = new Store(path.join(ROOT, "data"));
const auth = new Auth(store);

function readAdminSecret() {
  if (process.env.ADMIN_SECRET) return process.env.ADMIN_SECRET;
  try {
    return fsSync.readFileSync(path.join(ROOT, "data/admin-secret.txt"), "utf8").trim();
  } catch {
    // Premier lancement : génération automatique du secret, écrit dans le
    // dossier data/ (créé par le Store au démarrage, avant tout usage).
    // Permission 0600 : lisible par le propriétaire uniquement. Le secret
    // n'est JAMAIS affiché dans la console — seul le chemin est annoncé.
    const s = crypto.randomBytes(12).toString("hex");
    fsSync.writeFileSync(path.join(ROOT, "data/admin-secret.txt"), s + "\n", { mode: 0o600 });
    console.log("🔑 Secret admin généré : data/admin-secret.txt — ouvrez ce fichier pour la page /admin.");
    return s;
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
  delete r.spawnOrder; // persistance morte : le spawn vit par takenSpawns
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

// Bulletins officiels de la course (newsletter 7 h / 19 h) : persistés dans
// la course, reçus par TOUS les navigateurs — y compris hors ligne (badge
// de non-lus à la reconnexion, contenu servi dans le snapshot). Le bulletin
// est le SEUL canal public de la zone d'exclusion : il n'écrit JAMAIS dans
// le journal de bord — les navigateurs le lisent via un bouton dédié.
if (!Array.isArray(race.newsletters)) race.newsletters = [];
// Migration : une course existante garde sa dernière zone visible jusqu'à
// la première édition publiée par la nouvelle passe.
if (race.exclusionPub == null && race.exclusion) race.exclusionPub = { ...race.exclusion };

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
    const heard = sonarPassiveHear(me, p.x, p.y, SOUND_DECAY_KM.moteur, world);
    if (heard) out.push({ kind: "moteur", bearing: heard.bearing, strength: heard.strength });
  }
  // Bruits moteurs des NPC (hydrophone) : cargo en traversée, pêcheur en
  // transit — position RETARDÉE du son (npcBackPos), gisement + force.
  const npcs = race.npcs;
  if (npcs) {
    // décroissance PAR TYPE : un pêcheur en transit et un cargo ne portent pas
    // à la même distance — l'hydrophone les entend chacun à sa portée propre.
    for (const f of npcs.fishermen) {
      if (!npcNoisy(f)) continue;
      const d = distKm(me.x, me.y, f.x, f.y);
      const p = npcBackPos(f, soundTravelMin(d));
      const heard = sonarPassiveHear(me, p.x, p.y, SOUND_DECAY_KM.pecheur, world);
      if (heard) out.push({ kind: "moteur", bearing: heard.bearing, strength: heard.strength });
    }
    for (const c of npcs.cargos) {
      if (!npcNoisy(c)) continue;
      const d = distKm(me.x, me.y, c.x, c.y);
      const p = npcBackPos(c, soundTravelMin(d));
      const heard = sonarPassiveHear(me, p.x, p.y, SOUND_DECAY_KM.cargo, world);
      if (heard) out.push({ kind: "moteur", bearing: heard.bearing, strength: heard.strength });
    }
  }
  // Le patrouilleur officiel : moteur allumé en permanence — c'est une
  // vraie coque de cent mètres, on l'entend venir (et on la VOIT de jour).
  if (race.patrol) {
    const heard = sonarPassiveHear(me, race.patrol.x, race.patrol.y, SOUND_DECAY_KM.patrouille, world);
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

// Échantillon de position pour le retard du son (écoute passive) : poussé à
// CHAQUE PAS de simulation — temps réel comme sauts de temps. Avant, un
// saut ne poussait rien : l'hydrophone juste après un saut replongeait
// dans des positions d'avant-saut.
function pushNoise(id, tMin, x, y) {
  let hist = noiseHistory.get(id);
  if (!hist) { hist = []; noiseHistory.set(id, hist); }
  hist.push({ t: tMin, x, y });
  while (hist.length > 500) hist.shift(); // ~8 min : couvre le retard max (500 km ≈ 5,6 min)
}

// Passe sonar (boucle 1 Hz) : historique des positions, arrivées des échos
// et des pings entendus, purge des événements expirés.
function sonarPass() {
  const nowMs = Date.now();
  const cut = nowMs - SONAR_ECHO_PERSIST_S * 1000;
  for (const [id, st] of states) {
    // (l'échantillon de position est poussé par simulateTo, à chaque pas de simulation)
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
    delete states.get(id).ffEvents; // champ mort (plus écrit par le moteur) : purge des vieilles sauvegardes
    // migration : un état ancien sans consigne prend son cap actuel
    if (states.get(id).headingOrder == null) states.get(id).headingOrder = states.get(id).heading;
    if (!Array.isArray(states.get(id).waypoints)) {
      states.get(id).waypoints = [];
      states.get(id).wpIdx = 0;
      states.get(id).autopilot = false;
    }
  }
}
// Re-logement des navires superposés à quai — rejoué à CHAQUE démarrage :
// les superpositions peuvent renaître après coup (un serveur redémarré
// « oubliait » le quai occupé : takenSpawns repartait vide et le premier
// nouveau join tombait pile sur le premier point de spirale, déjà occupé).
// Deux navires superposés NE SONT RE-LOGÉS que s'ils sont tous deux DANS LA
// ZONE D'ACOSTAGE du port. Deux navires qui se croisent à < 300 m EN MER
// (régate, rendez-vous) ne sont JAMAIS déplacés — ils se débrouillent, la
// collision est gérable en jeu.
let reHoused = false;
{
  const ids = [...states.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = states.get(ids[i]), b = states.get(ids[j]);
      const bothAtPort =
        distKm(a.x, a.y, world.PORT.x, world.PORT.y) < SPAWN_SEP_KM &&
        distKm(b.x, b.y, world.PORT.x, world.PORT.y) < SPAWN_SEP_KM;
      const dm = distKm(a.x, a.y, b.x, b.y);
      if (dm < 0.05 && bothAtPort) {
        // re-loger via la spirale, en partant des positions DÉJÀ occupées
        // par TOUS les navires : les deux sont repoussés aux prochains
        // points valides — jamais sur un navire existant.
        const fresh = [...states.values()].map((s) => ({ x: s.x, y: s.y }));
        const sa = spawnPosition(world, fresh);
        const sb = spawnPosition(world, fresh);
        a.x = sa.x; a.y = sa.y; a.estX = sa.x; a.estY = sa.y;
        b.x = sb.x; b.y = sb.y; b.estX = sb.x; b.estY = sb.y;
        a.collided = false; b.collided = false;
        reHoused = true;
        console.log(`[migration] Navires ${ids[i]} et ${ids[j]} re-logés à 50 m (superposés à quai)`);
      }
    }
  }
}
// Réamorçage des slots d'amarrage : TOUTE position persistée occupe son
// point de spawn (y compris les re-logés ci-dessus) — un serveur redémarré
// ne « vide » pas le quai, le prochain join part du prochain point libre.
for (const s of states.values()) takenSpawns.push({ x: s.x, y: s.y });
if (reHoused) store.save();

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
// RÉCEPTION UNIQUE (omni ≥ 75 % / directionnel ≥ sens), famille donnée
// (défaut : longue). Sert au bafouillage (famille COURTE), aux messages
// cargos et au SOS d'un bateau attaqué (famille longue — un SOS porte loin).
const radioSend = (fromX, fromY, deliver, decayKm = LONG_DECAY_KM) => {
  for (const [oid, ost] of states) {
    if (!radioOk(ost)) continue;
    const dKm = distKm(ost.x, ost.y, fromX, fromY);
    const strength = strengthKm(dKm, decayKm);
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
      hunger: 1, // repue : elle vient de se nourrir juste avant le départ
      // Digestion pré-course tirée uniformément [6 h, 42 h] : le premier
      // cri (fin de digestion) tombe dans cette fenêtre, et la PREMIÈRE
      // estimation (le bulletin de 6 h qui suit) tombe aléatoirement dans
      // la plage 6–48 h — un état digestif initial, pas un timer.
      satietyMin: BEAST_SPAWN_DIGEST_MIN + Math.random() * (BEAST_SPAWN_DIGEST_MAX - BEAST_SPAWN_DIGEST_MIN),
      nextCryMin: nextNpcEventMin(gameMinutesNow(), BEAST_CRY_MEAN_MIN),
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
function emitSoundToAll(x, y, kind, nowMin, decayKm) {
  const decay = decayKm ?? SOUND_DECAY_KM[kind]; // décroissance du type de bruit
  for (const [oid, ost] of states) {
    const dKm = distKm(ost.x, ost.y, x, y);
    const strength = strengthKm(dKm, decay);
    if (strength <= 0) continue;
    if (soundBlocked(world, x, y, ost.x, ost.y)) continue; // la terre coupe le son
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
      if (dKm > BEACON_HEAR_KM || soundBlocked(world, x, y, b.x, b.y)) continue;
      race.evidence.push({
        k: "cry", x: b.x, y: b.y,
        brg: Math.round(bearingTo(b.x, b.y, x, y)),
        str: strengthKm(dKm, decay), t: nowMin,
      });
    }
    const patrol = race.patrol;
    if (patrol && distKm(patrol.x, patrol.y, x, y) <= PATROL_HEAR_KM && !soundBlocked(world, x, y, patrol.x, patrol.y)) {
      race.evidence.push({
        k: "cry", x: patrol.x, y: patrol.y,
        brg: Math.round(bearingTo(patrol.x, patrol.y, x, y)),
        str: strengthKm(distKm(patrol.x, patrol.y, x, y), decay), t: nowMin,
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
  // code radio du pêcheur, aucune coordonnée). Famille COURTE (500 km) :
  // des blablas de VHF, ça ne porte pas loin — contrairement au SOS.
  for (const f of npcs.fishermen) {
    if (now < f.nextChatMin) continue;
    f.nextChatMin = nextNpcEventMin(now, FISHER_CHAT_MEAN_MIN);
    // Le pêcheur pioche dans SA banque (archétype stable) — jamais deux
    // fois la même phrase d'affilée.
    const pool = FISHER_CHAT_LIBRARY[fisherChatKind(f.code)];
    let idx = Math.floor(Math.random() * pool.length);
    if (idx === f.lastChatIdx)
      idx = (idx + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length;
    f.lastChatIdx = idx;
    const line = pool[idx];
    radioSend(f.x, f.y, (ost, cap) => {
      notify(ost, `📻 Navire ${f.code} : « ${line} »`, "info", "radio");
    }, SHORT_DECAY_KM);
  }
  // Cargos : message PRIVÉ vers un autre cargo — les joueurs ne sont jamais
  // destinataires : ils ne capent que du BROUILLÉ (scrambledIntercept).
  for (const c of npcs.cargos) {
    if (now < c.nextMsgMin) continue;
    c.nextMsgMin = nextNpcEventMin(now, CARGO_MSG_MEAN_MIN);
    radioSend(c.x, c.y, (ost, cap) => {
      const info = scrambledIntercept(Math.round(cap.strength), cap.source, cap.side);
      notify(ost, info.text, "info", info.cat);
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
  // ouïe : bruits moteurs NPC à leur portée PAR TYPE + chants récents (mémoire)
  for (let i = recentSongs.length - 1; i >= 0; i--) {
    if (now - recentSongs[i].t > BEAST_SONG_MEMORY_MIN) recentSongs.splice(i, 1);
  }
  const sources = [];
  if (npcs) {
    for (const f of npcs.fishermen) {
      if (!npcNoisy(f) || distKm(beast.x, beast.y, f.x, f.y) >= SOUND_DECAY_KM.pecheur || soundBlocked(world, beast.x, beast.y, f.x, f.y)) continue;
      sources.push({ x: f.x, y: f.y, liveX: f.x, liveY: f.y, ref: f });
    }
    for (const c of npcs.cargos) {
      if (!npcNoisy(c) || distKm(beast.x, beast.y, c.x, c.y) >= SOUND_DECAY_KM.cargo || soundBlocked(world, beast.x, beast.y, c.x, c.y)) continue;
      sources.push({ x: c.x, y: c.y, liveX: c.x, liveY: c.y, ref: c });
    }
    for (const s of recentSongs) {
      if (distKm(beast.x, beast.y, s.x, s.y) >= SOUND_DECAY_KM.biologique || soundBlocked(world, beast.x, beast.y, s.x, s.y)) continue;
      sources.push({ x: s.x, y: s.y, liveX: s.ref.x, liveY: s.ref.y, ref: s.ref });
    }
  }
  // JOUEURS : la Bête entend AUSSI les moteurs diesel des navires joueurs —
  // ciblage par le bruit, joueurs et NPC égaux devant la créature. Voile pure,
  // électrique, ancre : silencieux — couper le moteur fait perdre la cible à
  // la passe suivante. `ref` référence l'état PERSISTANT (beastTick ne lit que
  // x/y — jamais de mutation de sa part).
  for (const [, pst] of states) {
    if (!shipNoisy(pst) || distKm(beast.x, beast.y, pst.x, pst.y) >= SOUND_DECAY_KM.moteur || soundBlocked(world, beast.x, beast.y, pst.x, pst.y)) continue;
    if (!pst.kind) pst.kind = "player"; // migration des états anciens
    sources.push({ x: pst.x, y: pst.y, liveX: pst.x, liveY: pst.y, ref: pst });
  }
  const prev = lastBeastT;
  lastBeastT = now;
  const eaten = beastTick(beast, now - prev, world, sources);
  // Repas : la cible disparaît, une trace naît, un cri part — et un SOS si
  // c'est un bateau (une baleine n'a pas de radio).
  if (eaten && eaten.kind === "player") {
    // Navire JOUEUR percuté : −25 % sur les TROIS éléments, puis la Bête
    // digère (une attaque par chasse — beastTick a déjà mis hunger = 1).
    // Pas de disparition, pas d'épave, pas de SOS : l'équipage vit. Si la
    // coque tombe à 0 %, c'est le remorquage (simulateTo) qui prend le relais.
    damagePart(eaten, "hullH", DAMAGE_HIT_PCT, "💀 PERCUTATION — quelque chose vous éperonne : la coque encaisse (−25 %).");
    damagePart(eaten, "sailH", DAMAGE_HIT_PCT, "💀 Le choc déchire la voilure (−25 %).");
    damagePart(eaten, "antH", DAMAGE_HIT_PCT, "💀 L'antenne craque sous l'impact (−25 %).");
    emitSoundToAll(beast.x, beast.y, "inconnu", now); // le cri de l'attaque
    store.save();
  } else if (eaten && npcs) {
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
        notify(ost, sosText, "bad", "radio");
        // Télémetre caché : le SOS (position déclarée) est consigné — la
        // compagnie lit aussi les ondes de sa propre flotte.
        telemeter(ost, { k: "sos", x: eaten.x, y: eaten.y, t: ost.t });
      });
    }
  }
  // Cris périodiques — EN CHASSE UNIQUEMENT : une créature qui digère est
  // silencieuse et immobile. C'est ce silence digestif qui étale la
  // première estimation sur la plage 6–48 h (une zone publiée pendant
  // une digestion serait de la pure invention).
  if (now >= beast.nextCryMin && beast.hunger <= 0) {
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
    const used = new Set([world.PORT.code, ...world.OUTPOSTS.map((o) => o.code), ...world.BEACONS.map((b) => b.code), ...[...states.values()].map((s) => s.code)]);
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
    const w = weatherAt(st.x, st.y, st.t, st.weatherSeed, world);
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
      notify(st, tr.kind === "epave"
        ? "🚢 Une épave dérive — coque déchiquetée, aucun survivant en vue."
        : "🩸 La mer est rouge de sang sur des centaines de mètres — une carcasse tourne lentement.", "info", "vision");
    }
  }
}
// ---------- Le Patrouilleur : état persisté (race.patrol) ----------
// Frégate officielle de la compagnie : part du port au début de la
// course, attend à quai tant qu'il n'y a aucune estimation, puis rejoint
// la zone estimée et la fouille. Navire RÉEL : moteur audible au sonar
// passif, coque visible selon la météo, position publiée au NETWORK.
// Poste de la frégate : POINT FIXE au large du port — PAS sur le point
// d'accostage (le navire de guerre n'occupe pas le quai des joueurs, il
// ne chevauche donc jamais un navire à quai). Balayage déterministe par
// caps de 10° à PATROL_BERTH_KM : même monde ⇒ même poste (spawn initial
// comme reset). La position retenue est en eau libre et à ≥ SPAWN_SEP_KM
// de tout navire déjà posé (anti-chevauchement, comme le spawn joueur) ;
// dernier recours : le point historique du port.
function patrolBerth() {
  const rd = PATROL_BERTH_KM / DEG_KM;
  const clear = (x, y) =>
    !world.isLand(x, y) && [...states.values()].every((s) => distKm(s.x, s.y, x, y) >= SPAWN_SEP_KM);
  for (let a = 0; a < 360; a += 10) {
    const rad = (a * Math.PI) / 180;
    const x = world.PORT.x + Math.sin(rad) * rd;
    const y = world.PORT.y + Math.cos(rad) * rd;
    if (clear(x, y)) return { x, y };
  }
  for (let a = 0; a < 360; a += 1) { // quai encombré : balayage fin
    const rad = (a * Math.PI) / 180;
    const x = world.PORT.x + Math.sin(rad) * rd;
    const y = world.PORT.y + Math.cos(rad) * rd;
    if (clear(x, y)) return { x, y };
  }
  return { x: world.PORT.x, y: world.PORT.y }; // ne devrait jamais servir
}

function ensurePatrol() {
  if (!race.patrol) {
    const berth = patrolBerth();
    race.patrol = {
      x: berth.x, y: berth.y, heading: 0,
      mode: "quai", tgtX: berth.x, tgtY: berth.y,
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
  const beast = race.beast;
  // BULLETIN-GATING : la patrouille vit sur la zone PUBLIÉE (les avis
  // officiels d'exclusionPass, cadence EXCLUSION_BULLETIN_MIN) — pas sur
  // une estimation recalculée en continu. Une seule source de vérité
  // (« une estimation, trois surfaces ») et un rythme de fouille gouverné
  // par la cadence officielle des avis.
  const events = patrolTick(patrol, now - prev, world, race.exclusion, beast ? { x: beast.x, y: beast.y } : null);
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
    const w = weatherAt(st.x, st.y, st.t, st.weatherSeed, world);
    const hour = (st.t / 60) % 24;
    const night = hour < 6 || hour >= 20;
    const det = Math.min(w.visibility, night ? PATROL_VIS_NUIT_KM : PATROL_VIS_KM);
    const visible = distKm(st.x, st.y, patrol.x, patrol.y) <= det;
    if (visible && !st.sawPatrol) {
      notify(st, `🚢 Frégate de la Patrouille repérée : ~${Math.round(distKm(st.x, st.y, patrol.x, patrol.y))} km — grande coque grise, marque MaxMedia.`, "info", "vision");
    }
    st.sawPatrol = visible;
  }
}

// ---------- Zone d'exclusion : estimation INTERNE de la compagnie ----------
// Recalcul à cadence fixe (EXCLUSION_BULLETIN_MIN) de la zone estimée.
// Cette estimation interne nourrit la PATROUILLE (bulletin-gating : la
// frégate vit sur race.exclusion — cadence et routine inchangées). Côté
// joueurs, elle n'est JAMAIS publiée ici : la zone publique
// (race.exclusionPub → snapshot → carte) ne bouge qu'aux éditions du
// bulletin 7 h/19 h (newsletterPass) — le bulletin est le SEUL canal.
// Le prétexte reste INVÉRIFIABLE (« opérations hydrographiques ») : la
// compagnie ne ment que sur le sens, jamais sur les faits. Le retard de
// la zone EST le gameplay : croyance, jamais clôture.
let nextBulletinMin = gameMinutesNow();
function exclusionPass(now) {
  if (now < nextBulletinMin) return;
  nextBulletinMin = now + EXCLUSION_BULLETIN_MIN;
  // purge : les relevés de plus de EVIDENCE_MAX_AGE_MIN sont morts
  race.evidence = race.evidence.filter((e) => now - e.t < EVIDENCE_MAX_AGE_MIN);
  const est = estimateZone(race.evidence, now);
  if (!est) {
    // Plus de relevés vivants : la zone interne est levée (la patrouille
    // regagne son quai). Côté joueurs, la levée ne paraît qu'à la prochaine
    // édition du bulletin — plus AUCUN avis dans le journal de bord.
    if (race.exclusion) {
      race.exclusion = null;
      store.save();
    }
    return;
  }
  race.exclusion = { x: est.x, y: est.y, rKm: est.rKm, t: now };
  store.save();
}

// ---------- Bulletin officiel de la course (newsletter 7 h / 19 h) ----------
// Le journal de la compagnie, reçu par TOUS les navigateurs, y compris
// hors ligne (badge de non-lus à la reconnexion). Pas de gate NETWORK,
// aucune écriture dans le journal de bord : un BOUTON dédié côté client
// ouvre le bulletin. Contenu : classement officiel (points LIVRÉS au
// port), classement officieux (points potentiels des codes en cale,
// non livrés), météo dominante des 4 zones de la carte (quadrants
// N-O / N-E / S-O / S-E), et zone d'exclusion PUBLIÉE — le seul biais
// de mise à jour de la zone pour les joueurs.
// Prochaine édition (minutes de jeu) : t mod 1440 = minute du jour de Paris
// (l'epoch est minuit Paris) — 07:00 ou 19:00, la suivante sinon.
function nextNewsMin(t) {
  const m = ((t % 1440) + 1440) % 1440;
  const base = t - m;
  if (m < NEWSLETTER_MIN[0]) return base + NEWSLETTER_MIN[0];
  if (m < NEWSLETTER_MIN[1]) return base + NEWSLETTER_MIN[1];
  return base + 1440 + NEWSLETTER_MIN[0];
}
let nextNewsAtMin = nextNewsMin(gameMinutesNow());

// Météo dominante d'un quadrant (grille 5×5 = 25 relevés déterministes
// weatherAt au centre des cellules) : archétype majoritaire + vent et
// visibilité moyens. Seed météo = celui de la course (météo uniforme).
function quadWeather(x0, y0, now) {
  const counts = new Map();
  let wind = 0, vis = 0;
  for (let ix = 0; ix < 5; ix++) {
    for (let iy = 0; iy < 5; iy++) {
      const x = x0 + ((ix + 0.5) * MAP) / 10;
      const y = y0 + ((iy + 0.5) * MAP) / 10;
      const w = weatherAt(x, y, now, race.seed % 1000, world);
      counts.set(w.name, (counts.get(w.name) || 0) + 1);
      wind += w.windSpd;
      vis += w.visibility;
    }
  }
  let wx = "?", best = -1;
  for (const [name, c] of counts) if (c > best) { best = c; wx = name; }
  return { wx, wind: Math.round(wind / 25), vis: Math.round((vis / 25) * 10) / 10 };
}

function newsletterPass(now) {
  if (now < nextNewsAtMin) return;
  nextNewsAtMin = nextNewsMin(now);
  race.newsSeq = (race.newsSeq || 0) + 1;
  // Zone d'exclusion PUBLIÉE : copie figée de l'estimation interne à
  // l'instant de l'édition — la carte des joueurs ne bouge qu'ici.
  race.exclusionPub = race.exclusion
    ? { x: race.exclusion.x, y: race.exclusion.y, rKm: race.exclusion.rKm, t: now }
    : null;
  // Classements : officiel = points LIVRÉS au port (st.score) ; officieux =
  // points potentiels des codes en cale (capturés, pas encore livrés).
  const rows = [...states.entries()].map(([id, st]) => ({
    who: id,
    code: st.code,
    score: st.score || 0,
    held: (st.codes || []).reduce((a, c) => a + (c.pts || 0), 0),
  }));
  const standings = [...rows].sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  const unofficial = rows.filter((p) => p.held > 0).sort((a, b) => b.held - a.held || a.code.localeCompare(b.code));
  const half = MAP / 2;
  race.newsletters.push({
    seq: race.newsSeq,
    t: now,
    kind: (now % 1440) < 720 ? "matin" : "soir",
    standings,
    unofficial,
    zones: [
      { id: "N-O", ...quadWeather(0, half, now) },
      { id: "N-E", ...quadWeather(half, half, now) },
      { id: "S-O", ...quadWeather(0, 0, now) },
      { id: "S-E", ...quadWeather(half, 0, now) },
    ],
    exclusion: race.exclusionPub,
  });
  while (race.newsletters.length > NEWS_MAX) race.newsletters.shift();
  store.save();
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
    // Le poste de la frégate est réservé : jamais de spawn joueur dessus.
    if (race.patrol && !takenSpawns.some((t) => t.x === race.patrol.x && t.y === race.patrol.y))
      takenSpawns.push({ x: race.patrol.x, y: race.patrol.y });
    // Code radio du navire : unique, SANS collision avec les codes des
    // stations (balises, port, avant-postes) — un code désigne exactement
    // un système du monde.
    let shipCode;
    do {
      shipCode = randomCode();
    } while (findStation(world, shipCode)
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
// Tick + trace de route : la trace vit côté SERVEUR — elle persiste à la
// reconnexion (comme le reste de l'état) et s'enregistre à CHAQUE tick. Un
// saut de temps debug rejoue les ticks : la trace du saut est donc la vraie
// route parcourue, virages compris.
const tickTraced = (st, step) => {
  tick(st, step, world);
  st.trace = tracePush(st.trace, st.estX, st.estY);
};
// — Balise-vigie : signal de proximité (famille courte), accéléré —
// l'intervalle se règle sur le navire le plus proche de la station.
// Cadence en MINUTES DE JEU (une minute de jeu = une minute réelle à
// TIME_MULT=1 : comportement temps réel inchangé) : les pings vivent
// AUSSI pendant les sauts de temps — avant, cadence Date.now() = silence
// total d'un saut. Une balise CAPTURÉE (désactivée) émet aussi :
// l'autoguidage du joueur (4 positions) décide seul si elle peut
// verrouiller son pilote.
const proxNextMin = new Map(); // code station → prochaine émission (min de jeu)
function proxPass(now) {
  // Stations émettrices : les 40 balises + le PORT + les 5 AVANT-POSTES
  // (autoguidage d'approche « identique au balise » : le retour au port
  // et les escales se verrouillent comme une balise — ancre auto à 50 m,
  // donc à l'intérieur de la zone de livraison de 500 m).
  for (const b of [world.PORT, ...world.OUTPOSTS, ...world.BEACONS]) {
    let dMin = Infinity;
    for (const st of states.values()) dMin = Math.min(dMin, distKm(st.x, st.y, b.x, b.y));
    if (!isFinite(dMin)) continue; // personne sur l'eau
    // VIGIE ARMÉE : la station n'émet son signal de proximité que si un
    // navire est dans son rayon de veille (PROX_ARM_KM — tout navire,
    // même plongé : la vigie détecte la coque, pas la radio). Silencieuse
    // sinon, et c'est l'information : une balise qui s'affole au loin
    // dans un faisceau, c'est un concurrent qui approche.
    if (dMin > PROX_ARM_KM) { proxNextMin.delete(b.code); continue; } // désarmée : réarmement → ping immédiat
    const next = proxNextMin.get(b.code);
    if (next != null && now < next) continue;
    proxNextMin.set(b.code, now + proxPingIntervalS(dMin) / 60);
    for (const st of states.values()) {
      if (!radioOk(st)) continue;
      const cap = detectBeacon(st, b, world, SHORT_DECAY_KM);
      if (cap) onProximityPing(st, b, cap);
    }
  }
}

// ---------- Avancement du temps (voie UNIQUE : temps réel ET sauts) ----------

// simulateTo fait vivre TOUT le monde jusqu'à l'instant de jeu `now` :
// navires (ticks moteur par pas de MAX_STEP_MIN) ET passes monde —
// détections inter-navires, NPC, Bête, patrouille, exclusion, pings de
// proximité, coupure NETWORK — INTERLEACÉES au fil des pas. La boucle 1 Hz
// l'appelle avec l'instant courant ; le saut de temps super user l'appelle
// avec l'instant post-saut : un saut est une accélération EXACTE du temps
// réel — mêmes événements, mêmes journaux, AUCUN raccourci (avant : NPC,
// Bête et patrouille plafonnés à 120 min de rattrapage, événements
// programmés manqués, détections et collisions non échantillonnées).
// Garde epsilon : l'arithmétique flottante peut laisser un curseur à un ulp
// de la cible sans progresser — on boucle sur `now - EPS` puis on raccorde
// (jamais de boucle infinie).
const SIM_EPS_MIN = 1e-6;
let simT = gameMinutesNow(); // curseur monde : dernier instant simulé
function simulateTo(now) {
  let guard = 0;
  while (simT < now - SIM_EPS_MIN && guard++ < 100000) {
    const step = Math.min(MAX_STEP_MIN, now - simT);
    simT += step;
    // Navires d'abord : les passes monde voient les positions de l'instant.
    for (const [, st] of states) {
      let g = 0;
      while (st.t < simT - SIM_EPS_MIN && g++ < 10000) {
        tickTraced(st, Math.min(MAX_STEP_MIN, simT - st.t));
      }
      if (st.t < simT) st.t = simT; // raccord epsilon (jamais en arrière)
    }
    // Passes monde à l'instant intermédiaire : les timers NPC (bafouillage
    // 2 h, cargos 4 h, chants 2 h, cris 1,5 h) tirent à ≥ 0,5× la cadence
    // (≥ 45 min) : un pas de 5 min ne peut rater aucun événement prévu.
    multiplayerPass(simT);
    npcPass(simT);
    beastPass(simT);
    patrolPass(simT);
    exclusionPass(simT);
    newsletterPass(simT);
    proxPass(simT);
    // NETWORK : coupure automatique dès que le navire quitte la zone —
    // revenir = se RECONNECTER = nouvelle entrée dans le journal global.
    for (const [, st] of states) if (st.networked && !netZone(st)) st.networked = false;
    // Coque 0 % : remorquage immédiat — balayé à CHAQUE instant simulé, il
    // vit donc AUSSI pendant les sauts de temps (jamais dans tick : pas de
    // respawn au milieu d'un tick).
    for (const [id, st] of states) if (st.needsRescue) rescueShip(id, st);
    // Sonar : échantillon de positions retardées à l'instant simulé.
    for (const [id, st] of states) pushNoise(id, simT, st.x, st.y);
  }
  simT = now;
}

setInterval(() => {
  // Temps réel : le monde entier avance à l'instant courant. Le sonar
  // (persistance des écoutes en temps RÉEL) et la sauvegarde restent
  // sur l'horloge réelle.
  simulateTo(gameMinutesNow());
  sonarPass();
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
    const w = weatherAt(st.x, st.y, st.t, st.weatherSeed, world);
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
        const az = Math.round((Math.atan2(ti.x - st.x, ti.y - st.y) * 180) / Math.PI + 360) % 360;
        notify(st, `⛵ Navire repéré (${infos.get(tid).st.code}) : ~${Math.round(km)} km, azimut ${az}°.`, "info", "vision");
      }
    }
    for (const tid of before) {
      if (!seen.includes(tid)) {
        notify(st, `👁️ Navire ${infos.get(tid).st.code} perdu de vue.`, "info", "vision");
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
            notify(st, "💥 Contact avec un autre navire — vitesse stoppée. Écartez-vous en changeant de cap.", "warn", "alertes");
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
    if (!radioOk(ost)) continue;
    const dKm = distKm(fromX, fromY, ost.x, ost.y);
    const strength = longStrengthKm(dKm);
    if (strength < RADIO_MIN_STRENGTH) continue;
    const brg = bearingTo(ost.x, ost.y, fromX, fromY);
    const cap = recvCapture(ost, brg, strength);
    if (!cap) continue; // ne capte pas : silence
    const info = scrambledIntercept(Math.round(strength), cap.source, cap.side);
    notify(ost, info.text, "info", info.cat);
  }
}

// ---------- HTTP ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, "client/dist")));
app.get("/admin", (req, res) => res.sendFile(path.join(ROOT, "server/public/admin.html")));

// ---------- Remorquage : coque 0 % = game over doux ----------

// Le navire coule : la compagnie le remorque instantanément au port.
// Identité, score et cartographie conservés ; navire remis à NEUF (valeurs
// d'usine de newPlayerState) ; le stock de codes est PERDU et les balises
// correspondantes redeviennent CAPTURABLES (réactivées pour toute la flotte).
function rescueShip(id, st) {
  for (const c of st.codes || []) {
    const b = world.BEACONS.find((x) => x.id === c.id);
    if (b) b.active = true;
  }
  st.codes = [];
  const sp = spawnPosition(world, takenSpawns); // nouveau slot de quai
  st.x = sp.x; st.y = sp.y; st.estX = sp.x; st.estY = sp.y; st.unc = 0;
  st.heading = world.CONTINENT.x1 <= MAP / 2 ? 90 : 270;
  st.headingOrder = st.heading;
  st.hullH = 100; st.sailH = 100; st.antH = 100;
  st.fuel = 100; st.battery = 100; st.food = 100;
  st.engine = 0.8; st.engineOn = false; st.electricOn = false; st.periscope = false;
  st.mast = false; st.sail = SAIL_DEFAULT;
  st.vkmh = 0; st.anchored = true; st.grounded = false;
  st.groundHitArmed = true; st.needsRescue = false;
  st.beaconLock = null; st.lockBrg = null; st.autopilot = false;
  notify(st, "🚢 Coque brisée — remorquage par la compagnie : navire remis à neuf au port. Stock de codes perdu : les balises correspondantes redeviennent capturables.", "warn", "navire");
  store.save();
}

function publicSnapshot(id) {
  const st = ensureState(id);
  const w = weatherAt(st.x, st.y, st.t, st.weatherSeed, world);
  return {
    t: st.t,
    epoch: race.displayEpoch ?? race.epoch ?? new Date(race.startedAt).getTime(),
    isSuper: isSuper(id),
    player: {
      heading: st.heading, headingOrder: st.headingOrder ?? st.heading, sail: st.sail ?? SAIL_DEFAULT, engine: st.engine,
      electric: st.electric ?? st.engine,
      location: st.location, mast: st.mast, engineOn: st.engineOn,
      electricOn: st.electricOn, periscope: st.periscope, vkmh: st.vkmh,
      fuel: st.fuel, battery: st.battery, food: st.food,
      hullH: st.hullH ?? 100, sailH: st.sailH ?? 100, antH: st.antH ?? 100,
      score: st.score, codes: st.codes, unc: st.unc,
      estX: st.estX, estY: st.estY,
      trace: st.trace || [],   // route parcourue (mémoire serveur, positions estimées)
      travelledKm: st.travelledKm, dailyKm: st.dailyKm,
      waypoints: st.waypoints || [], wpIdx: st.wpIdx || 0, autopilot: !!st.autopilot,
      navFixActive: st.navFix.active,
      grounded: st.grounded,
      collided: !!st.collided,
      light: !!st.light,
      boom: st.boom ?? 0, awSpd: st.awSpd ?? 0, awRel: st.awRel ?? 0,
      beaconLock: st.beaconLock ?? null, anchored: !!st.anchored,
      autoguide: autoguideMode(st), // migration : « disabled »/« all » → « beacons »
      networked: !!st.networked,
      signals: (st.signals || []).slice(-10),
      antBeam: st.antBeam, antOrient: st.antOrient,
      code: st.code,
      notifications: st.notifications.slice(0, 60),
      pins: st.pins, measures: st.measures,
    },
    world: {
      continent: world.CONTINENT.verts,
      // Port/avant-postes : coordonnées seules — leurs codes radio
      // (autoguidage) ne sont PAS exposés dans le snapshot (même politique
      // que les codes de balises : un code s'apprend à la radio).
      port: { x: world.PORT.x, y: world.PORT.y },
      islands: world.ISLANDS.map((i) => i.verts),
      outposts: world.OUTPOSTS.map((o) => ({ x: o.x, y: o.y })),
      activeBeaconIds: world.BEACONS.filter((b) => b.active).map((b) => b.id),
      beaconCount: world.BEACONS.length,
    },
    weather: w,
    view: computeView(st, world, (race.beast && race.beast.traces) || []),
    // NETWORK : zone serveur (bouton + connexion) et journal global, exposé
    // UNIQUEMENT aux joueurs connectés ET encore en zone.
    networkZone: netZone(st),
    networkLog: st.networked && netZone(st) ? race.network : null,
    // Zone d'exclusion PUBLIÉE : copie figée de l'estimation interne à la
    // dernière édition du bulletin (7 h/19 h) — le bulletin est le seul
    // canal de mise à jour pour les joueurs. L'estimation interne (6 h)
    // nourrit la patrouille, pas la carte. Le tampon du télémetre, lui,
    // n'est JAMAIS exposé.
    exclusion: race.exclusionPub || null,
    // Bulletin officiel de la course (newsletter 7 h/19 h) : dernières
    // éditions + compteur de non-lus pour le bouton dédié (le bulletin
    // n'écrit JAMAIS dans le journal de bord).
    news: {
      items: (race.newsletters || []).slice(-NEWS_MAX),
      unread: Math.max(0, (race.newsSeq || 0) - (st.newsRead || 0)),
    },
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

const loginFails = new Map(); // compte -> { n, until } : 5 échecs → 15 min de verrou

app.post("/api/login", (req, res) => {
  const { name, password } = req.body || {};
  const id0 = String(name || "").trim().toLowerCase();
  const f = loginFails.get(id0);
  if (f && Date.now() < f.until)
    return res.status(429).json({ error: "compte temporairement verrouillé (trop d'essais)" });
  const token = auth.login(name, password);
  if (!token) {
    const rec = loginFails.get(id0) || { n: 0, until: 0 };
    rec.n += 1;
    if (rec.n >= 5) { rec.until = Date.now() + 15 * 60000; rec.n = 0; }
    loginFails.set(id0, rec);
    return res.status(401).json({ error: "identifiants invalides" });
  }
  loginFails.delete(id0);
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
      const w = weatherAt(gx * 2 + 1, gy * 2 + 1, st.t + h * 60, st.weatherSeed, world);
      cells.push({ x: gx * 2 + 1, y: gy * 2 + 1, clouds: w.clouds, rain: w.rain, storm: w.storm, fog: w.fog, windSpd: w.windSpd, windDir: w.windDir });
    }
  const here = weatherAt(st.x, st.y, st.t + h * 60, st.weatherSeed, world);
  const systems = systemsAt(st.t + h * 60, st.weatherSeed, world);
  res.json({ t: st.t, h, cells, here, systems });
});

// ---------- API d'administration (interface /admin) ----------
// Toutes les routes exigent le secret admin : variable d'environnement
// ADMIN_SECRET si définie, sinon data/admin-secret.txt — GÉNÉRÉ au
// premier lancement s'il n'existe pas (permission 0600). Le secret
// n'est jamais affiché dans la console — seul le chemin est annoncé.
function getAdminSecret() {
  return readAdminSecret();
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
  getAdminSecret(); // génère data/admin-secret.txt au premier lancement
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
  ws._snapDirty = false; // réponse de commande en attente de flush (coalescence anti-tempête)

  ws.send(JSON.stringify({ type: "snapshot", data: publicSnapshot(id) }));

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    const st = ensureState(id);
    if (msg.type === "command") {
      const nowMs = Date.now();
      if (nowMs > ws._budgetReset) { ws._cmdBudget = 20; ws._budgetReset = nowMs + 1000; }
      if ((ws._cmdBudget ?? 20) <= 0) return; // rafale : ignorée, le snapshot suivant rétablit la vérité
      ws._cmdBudget = (ws._cmdBudget ?? 20) - 1;
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
      if (typeof c.electric === "number") st.electric = clamp01(c.electric);
      if (typeof c.antBeam === "number") st.antBeam = Math.round(clamp(c.antBeam, 1, 180));
      if (typeof c.antOrient === "number") st.antOrient = Math.round(clamp(c.antOrient, -180, 180));
      if (typeof c.mast === "boolean") st.mast = c.mast;
      if (typeof c.engineOn === "boolean") st.engineOn = c.engineOn;
      if (typeof c.electricOn === "boolean") st.electricOn = c.electricOn;
      if (typeof c.periscope === "boolean") st.periscope = c.periscope;
      if (typeof c.light === "boolean") st.light = c.light;
      // Ancre : mécanique générale, activable / désactivable à la main.
      // Poser l'ancre COUPE le moteur et baisse le mât : refuge silencieux,
      // aucun carburant brûlé au poste (redémarrage manuel ensuite).
      if (typeof c.anchor === "boolean") {
        st.anchored = c.anchor;
        if (c.anchor) {
          st.engineOn = false;
          st.mast = false;
        }
      }
      // Capture de balise : action MANUELLE du joueur.
      if (c.capture === true) {
        const r = captureBeacon(st, world);
        if (!r.ok) {
          notify(st, `⚠️ ${r.error}`, "warn", "radio");
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
          notify(st, `⚠️ Sonar : ${res.error}`, "warn", "sonar");
        } else {
          const pend = sonarPending.get(id) || [];
          for (const e of res.echoes) pend.push({ kind: e.kind, az: e.az, distKm: e.dKm, arriveMin: e.arriveMin });
          sonarPending.set(id, pend);
          for (const [oid, ost] of states) {
            if (oid === id) continue;
            const d = distKm(ost.x, ost.y, st.x, st.y);
            const strength = strengthKm(d, SOUND_DECAY_KM.ping);
            if (strength <= 0) continue;
            if (soundBlocked(world, st.x, st.y, ost.x, ost.y)) continue; // le ping ne traverse pas la terre
            const q = sonarNoisePending.get(oid) || [];
            q.push({
              bearing: Math.round(bearingTo(ost.x, ost.y, st.x, st.y)),
              strength,
              arriveMin: ost.t + soundTravelMin(d),
            });
            sonarNoisePending.set(oid, q);
          }
          notify(st, "🔊 Ping émis (1 % batteries).", "info", "sonar");
        }
      }
      if (c.dive === true) { st.location = "underwater"; st.mast = false; st.engineOn = false; }
      if (c.surface === true) st.location = "surface";
      // Autoguidage balise-vigie (4 positions) : quelles stations peuvent
      // engager le verrou du pilote. Filtre à l'engagement uniquement —
      // un verrou en cours tient, même si l'interrupteur change.
      if (typeof c.autoguide === "string" && AUTOGUIDE_MODES.includes(c.autoguide)) {
        st.autoguide = c.autoguide;
      }
      // Bulletin de la course : ouvrir le bulletin marque TOUT comme lu
      // (le badge du bouton dédié disparaît). Le contenu vit dans le
      // snapshot (snap.news), jamais dans le journal de bord.
      if (c.newsRead === true) st.newsRead = race.newsSeq || 0;
      // NETWORK : connexion depuis la zone d'un port / avant-poste / balise
      // (capturée ou non). Le coût : l'identité et le code du joueur sont
      // révélés et enregistrés dans le journal global, consulté par tous les
      // abonnés (« qui est allé où, quand ») — base de la future newsletter
      // quotidienne. Chaque REconnexion écrit une nouvelle entrée.
      if (c.network === true) {
        if (!netZone(st)) {
          notify(st, "⚠️ NETWORK : aucune station à portée (port, avant-poste ou balise à ≤ 500 m).", "warn", "radio");
        } else if (st.networked) {
          notify(st, "🌐 NETWORK : déjà connecté.", "info", "radio");
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
          notify(st, "🌐 Connecté au NETWORK — identité et code enregistrés dans le journal global. Météo 48 h disponible.", "good", "radio");
        }
      }
      // Appel « Position ? » : coût batteries, réponse privée de la balise,
      // et TRANSMISSION BROUILLÉE pour tout autre navire qui capte l'émission
      // sans en être destinataire (« émettre, c'exister »).
      // SOS (mode diffusion) : message lisible par TOUS les navires à portée
      // de l'émission double chemin. Le contenu inclut la position ESTIMÉE
      // de l'émetteur (ce qu'il croit — ses instruments, pas la vérité).
      if (c.sos === true) {
        if (radioOk(st)) {
          st.battery = Math.max(0, st.battery - CALL_BATTERY_COST);
          const sosText = `🆘 SOS du navire ${st.code} — position déclarée : ${st.estY.toFixed(2)}°N ${st.estX.toFixed(2)}°E (±${Math.round(st.unc)} km).`;
          notify(st, `${sosText} Diffusion émise.`, "warn", "radio");
          for (const [oid, ost] of states) {
            if (oid === id) continue;
            if (!radioOk(ost)) continue;
            const dKm = distKm(ost.x, ost.y, st.x, st.y);
            const brg = bearingTo(ost.x, ost.y, st.x, st.y);
            const strength = longStrengthKm(dKm) * condFactor(st.antH); // émission navire : omni, longue — antenne avariée : émission affaiblie
            if (strength < RADIO_MIN_STRENGTH) continue;
            const cap = recvCapture(ost, brg, strength); // lire exige capter
            if (!cap) continue;
            notify(ost, sosText, "bad", "radio");
          }
        }
      }
      // Messages entre navires. AUCUNE ACTION AUTOMATIQUE : « Position ? » est
      // une question littérale, « Ma position » est un envoi volontaire de sa
      // position ESTIMÉE (jamais la vraie). Seules les balises répondent
      // automatiquement (c'est leur fonction).
      // shipMsg: { kind: "posq" | "mypos", to?: "1234" } — sans `to` : diffusion.
      if (c.shipMsg && ["posq", "mypos"].includes(c.shipMsg.kind)) {
        if (radioOk(st)) {
          st.battery = Math.max(0, st.battery - CALL_BATTERY_COST);
          const isBroadcast = !c.shipMsg.to;
          const text = c.shipMsg.kind === "posq"
            ? `❓ Navire ${st.code} demande : « Position ? »`
            : `📍 Navire ${st.code} communique sa position : ${st.estY.toFixed(2)}°N ${st.estX.toFixed(2)}°E (±${Math.round(st.unc)} km)`;
          const label = c.shipMsg.kind === "posq" ? "« Position ? »" : "« Ma position »";
          notify(st, `📡 Message ${label} ${isBroadcast ? "diffusé" : `émis vers ${c.shipMsg.to}`} (0,5 % batteries).`, "info", "radio");
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
            if (!radioOk(ost)) continue;
            const dKm = distKm(ost.x, ost.y, st.x, st.y);
            const brg = bearingTo(ost.x, ost.y, st.x, st.y);
            const strength = longStrengthKm(dKm) * condFactor(st.antH); // émission navire : omni, longue — antenne avariée : émission affaiblie
            if (strength < RADIO_MIN_STRENGTH) continue;
            const cap = recvCapture(ost, brg, strength); // lire exige capter
            if (!cap) continue;
            if (isBroadcast) {
              // diffusion : contenu lisible par tous
              notify(ost, text, "info", "radio");
            } else if (ost.code === c.shipMsg.to) {
              // destinataire : contenu privé lisible
              notify(ost, text, "good", "radio");
            } else {
              // tiers : transmission brouillée, aucun contenu
              const info = scrambledIntercept(Math.round(strength), cap.source, cap.side);
              notify(ost, info.text, "info", info.cat);
            }
          }
        }
      }
      // Avitaillement uniquement à quai (port ou avant-poste) : contrôle
      // serveur — le client masquant le bouton ne suffit pas (anti-triche)
      if (c.refuel === true) {
        if (st.location === "surface" &&
            (distKm(st.x, st.y, world.PORT.x, world.PORT.y) < DELIVERY_R_KM ||
             world.OUTPOSTS.some((o) => distKm(st.x, st.y, o.x, o.y) < DELIVERY_R_KM))) {
          st.fuel = 100; st.food = 100;
          notify(st, "🛒 Avitaillement complet : carburant et vivres à 100 %.", "good", "navire");
        } else {
          notify(st, "⚠️ Avitaillement refusé : il faut être en surface, à quai (port ou avant-poste).", "warn", "navire");
        }
      }

      // Radoub (réparation santé) : gratuit et instantané, uniquement à quai —
      // même garde anti-triche serveur que l'avitaillement (le client masquant
      // le bouton ne suffit pas).
      if (c.repair === true) {
        if (st.location === "surface" &&
            (distKm(st.x, st.y, world.PORT.x, world.PORT.y) < DELIVERY_R_KM ||
             world.OUTPOSTS.some((o) => distKm(st.x, st.y, o.x, o.y) < DELIVERY_R_KM))) {
          st.hullH = 100; st.sailH = 100; st.antH = 100; st.groundHitArmed = true; st.needsRescue = false;
          notify(st, "🛠️ Radoub complet : coque, voilure et antenne réparées (100 %).", "good", "navire");
        } else {
          notify(st, "⚠️ Radoub refusé : il faut être en surface, à quai (port ou avant-poste).", "warn", "navire");
        }
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
      // Trace de route (outil papier) : effacement à la demande du joueur.
      if (c.traceClear === true) { st.trace = []; store.save(); }
      // Saut de temps : super utilisateur uniquement. L'horloge de course est
      // PARTAGÉE : le saut est global — l'epoch recule, puis simulateTo fait
      // vivre TOUT le monde (navires ET passes : NPC, Bête, patrouille,
      // exclusion, pings de proximité, détections inter-navires) au fil des
      // pas de MAX_STEP_MIN : pulsations, points aux étoiles, consommations,
      // bafouillages, SOS, avis officiels — tout est conservé, pour tous.
      if (c.timeSkipMin != null && isSuper(id)) {
        const mins = Math.round(clamp(Number(c.timeSkipMin) || 0, 1, 24 * 60));
        race.epoch = (race.epoch || new Date(race.startedAt).getTime()) - mins * MS_PER_MIN / TIME_MULT;
        // (displayEpoch reste fixe : l'heure affichée avance avec t)
        simulateTo(gameMinutesNow());
        store.save();
        // Journal : le saut est un événement MONDIAL — chaque journal de
        // bord (les 200 dernières entrées, serveur) le consigne, pas
        // seulement le maître de course.
        const dur = mins % 60 === 0 ? `+${mins / 60} h` : `+${mins} min`;
        for (const [, pst] of states) {
          notify(pst, `⏱️ Saut de temps du maître de course : ${dur}.`, "info", "navire");
        }
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
        takenSpawns = [];       // nouvelle course : quai vidé
        const fresh = buildWorld(race.seed);
        world.PORT = fresh.PORT; world.CONTINENT = fresh.CONTINENT;
        world.ISLANDS = fresh.ISLANDS; world.OUTPOSTS = fresh.OUTPOSTS;
        world.BEACONS = fresh.BEACONS; world.COAST = fresh.COAST;
        world.isLand = fresh.isLand;
        // Réattribution des slots d'amarrage (espacement 50 m) et de codes
        // radio NEUFS, garantis sans collision avec les STATIONS (balises,
        // port, avant-postes) de la NOUVELLE graine ni entre navires.
        const usedCodes = new Set([world.PORT.code, ...world.OUTPOSTS.map((o) => o.code), ...world.BEACONS.map((b) => b.code)]);
        for (const [pid] of states) {
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
        // Relevés, zone d'exclusion et bulletins : la nouvelle course
        // repart à vide (aucune édition, aucun non-lu, zone effacée).
        race.evidence = [];
        race.exclusion = null;
        race.exclusionPub = null;
        race.newsletters = [];
        race.newsSeq = 0;
        nextBulletinMin = gameMinutesNow();
        nextNewsAtMin = nextNewsMin(gameMinutesNow());
        simT = gameMinutesNow(); // curseur monde : la nouvelle course part de l'instant présent
        proxNextMin.clear();     // vigies : réarmement → premier ping immédiat
        store.save();
        // Notifier le NOUVEL état du joueur : l'ancien objet `st` a été
        // remplacé dans `states` par le rebuild ci-dessus (sinon : notif perdue)
        const newSt = states.get(id);
        if (newSt) {
          notify(newSt, "🔄 Course réinitialisée : nouveau monde, nouvelles balises, navires à quai. Horloge re-synchronisée sur Paris.", "good", "navire");
        }
      }
      persistPlayer(id);
      ws._snapDirty = true; // COALESCÉ : le flush SNAP_FLUSH_MS répondra (dernier état gagne, jamais de file)
    } else if (msg.type === "snapshot") {
      ws.send(JSON.stringify({ type: "snapshot", data: publicSnapshot(id) }));
    }
  });

  ws.on("close", () => {
    sockets.get(id)?.delete(ws);
    if (sockets.get(id)?.size === 0) sockets.delete(id); // l'entrée vide ne s'accumule pas
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

// Réponses aux COMMANDES — coalescence anti-tempête. Pendant un drag (roue,
// manettes : ~10 commandes/s), le serveur répondait à CHAQUE commande par un
// snapshot complet (~8 Ko) : une rafale de ~11 trames/s, ininterrompue tant
// que le joueur manipule. Or ce flux massif est le SEUL élément qui
// distingue « jouer » (gel de l'interface ~10 s après la connexion) de
// « rester connecté sans rien faire » (aucun gel) — on le plafonne. Une
// commande marque simplement la socket sale ; ce flush envoie AU PLUS UN
// snapshot par socket et par SNAP_FLUSH_MS (dernier état gagne, jamais de
// file d'attente). Le broadcast 1 Hz ci-dessus reste la vérité de fond :
// pire cas, l'écho d'une commande arrive 250 ms plus tard — invisible sur
// des mécaniques à convergence lente (giration, voile).
setInterval(() => {
  for (const [id, set] of sockets) {
    for (const ws of set) {
      if (!ws._snapDirty || ws.readyState !== 1) continue;
      ws._snapDirty = false;
      ws.send(JSON.stringify({ type: "snapshot", data: publicSnapshot(id) }));
    }
  }
}, SNAP_FLUSH_MS);
