import fsSync from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { buildWorld, newPlayerState, tick, weatherAt, computeView, clamp, distNm, DELIVERY_R_NM } from "../../shared/engine.js";
import { Store } from "./store.js";
import { Auth, hashPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
// Multiplicateur de temps (debug uniquement ; production = temps réel ×1).
const TIME_MULT = process.env.TIME_MULT ? Number(process.env.TIME_MULT) : 1;
const TICK_MS = 1000; // tick serveur : 1 s réelle
const MAX_STEP_MIN = 5; // pas de simulation max 5 min de jeu (design)
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
    r = { seed: Math.floor(Math.random() * 1e9), epoch: epoch.getTime(), startedAt: new Date().toISOString(), players: {} };
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

// Minutes de jeu écoulées depuis le départ (temps réel × TIME_MULT)
function gameMinutesNow() {
  // Minutes de jeu = temps réel écoulé depuis minuit Paris du jour du
  // lancement (epoch). ×TIME_MULT pour le debug uniquement.
  const ms = Date.now() - (race.epoch || new Date(race.startedAt).getTime());
  return Math.max(0, ms / 60000) * TIME_MULT;
}

const states = new Map(); // accountId -> player state (engine)
for (const [id, saved] of Object.entries(race.players || {})) {
  if (saved) {
    states.set(id, saved);
    states.get(id).t = gameMinutesNow();
  }
}
function persistPlayer(id) {
  race.players[id] = states.get(id);
  store.save();
}
function ensureState(id) {
  if (!states.has(id)) {
    const st = newPlayerState(world, { weatherSeed: (race.seed + id.length * 7) % 1000 });
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
  if (Date.now() - lastPersist > 60000) {
    lastPersist = Date.now();
    for (const [id] of states) race.players[id] = states.get(id);
    race.beacons = Object.fromEntries(world.BEACONS.map((b) => [b.id, { active: b.active }]));
    store.save();
  }
}, TICK_MS);

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
    epoch: race.epoch || new Date(race.startedAt).getTime(),
    isSuper: isSuper(id),
    player: {
      heading: st.heading, sail: st.sail, engine: st.engine,
      location: st.location, mast: st.mast, engineOn: st.engineOn,
      electricOn: st.electricOn, periscope: st.periscope, vkn: st.vkn,
      fuel: st.fuel, battery: st.battery, food: st.food,
      score: st.score, codes: st.codes, unc: st.unc,
      estX: st.estX, estY: st.estY,
      travelledNm: st.travelledNm, dailyNm: st.dailyNm,
      navFixActive: st.navFix.active,
      grounded: st.grounded,
      antBeam: st.antBeam, antOrient: st.antOrient,
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
    view: computeView(st, world),
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

// Service météo de quai (prévision parfaite J+15, design). Réservé aux
// joueurs amarrés : port principal ou avant-poste, en surface. La grille 2°
// est calculée à l'instant demandé (t + h heures).
app.get("/api/wx", (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, "")
    || (req.headers.cookie || "").match(/pc_token=([^;]+)/)?.[1];
  const account = token && auth.accountOf(token);
  if (!account) return res.status(401).json({ error: "auth requise" });
  const st = ensureState(account);
  const atDock = st.location === "surface" &&
    (distNm(st.x, st.y, world.PORT.x, world.PORT.y) < DELIVERY_R_NM ||
     world.OUTPOSTS.some((o) => distNm(st.x, st.y, o.x, o.y) < DELIVERY_R_NM));
  if (!atDock) return res.status(403).json({ error: "service disponible à quai uniquement" });
  const h = clamp(Number(req.query.h) || 0, 0, 15 * 24);
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
      if (typeof c.heading === "number") st.heading = ((Math.round(c.heading) % 360) + 360) % 360;
      if (typeof c.sail === "number") st.sail = clamp01(c.sail);
      if (typeof c.engine === "number") st.engine = clamp01(c.engine);
      if (typeof c.antBeam === "number") st.antBeam = Math.round(clamp(c.antBeam, 1, 180));
      if (typeof c.antOrient === "number") st.antOrient = Math.round(clamp(c.antOrient, -180, 180));
      if (typeof c.mast === "boolean") st.mast = c.mast;
      if (typeof c.engineOn === "boolean") st.engineOn = c.engineOn;
      if (typeof c.electricOn === "boolean") st.electricOn = c.electricOn;
      if (typeof c.periscope === "boolean") st.periscope = c.periscope;
      if (c.dive === true) { st.location = "underwater"; st.mast = false; st.engineOn = false; }
      if (c.surface === true) st.location = "surface";
      if (c.refuel === true && st.location === "surface") {
        st.fuel = 100; st.food = 100;
        st.notifSeq = (st.notifSeq || 0) + 1;
        st.notifications.unshift({ id: st.notifSeq, t: st.t, text: "🛒 Avitaillement complet : carburant et vivres à 100 %.", kind: "good", cat: "navire" });
      }
      if (Array.isArray(c.pins)) st.pins = c.pins.slice(0, 26);
      if (Array.isArray(c.measures)) st.measures = c.measures.slice(0, 40);
      // Saut de temps : super utilisateur uniquement. L'horloge de course est
      // PARTAGÉE : le saut est global — l'epoch recule, le serveur simule
      // ensuite chaque minute pour chaque navire (pulsations, détections,
      // points aux étoiles et consommations sont conservés pour tous).
      if (c.timeSkipMin != null && isSuper(id)) {
        const mins = Math.round(clamp(Number(c.timeSkipMin) || 0, 1, 24 * 60));
        race.epoch = (race.epoch || new Date(race.startedAt).getTime()) - mins * 60000 / TIME_MULT;
        const now = gameMinutesNow();
        for (const [, pst] of states) {
          while (pst.t < now) tick(pst, Math.min(MAX_STEP_MIN, now - pst.t), world);
        }
        store.save();
        st.notifSeq = (st.notifSeq || 0) + 1;
        st.notifications.unshift({ id: st.notifSeq, t: st.t, text: `⏱️ Saut de temps : +${mins} min (super user).`, kind: "info", cat: "navire" });
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
