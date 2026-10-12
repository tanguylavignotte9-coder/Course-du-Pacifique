import React, { useCallback, useEffect, useRef, useState } from "react";
import { login, GameSocket } from "./net.js";
import Manual from "./Manual.jsx";
import Helm from "./Helm.jsx";
import {
  MAP, DEG_KM, distKm, DELIVERY_R_KM, WX_HORIZON_H, DOUGLAS_LABEL, clamp, nextPhase,
} from "../../shared/engine.js";
import { fmtParis, fmtParisLong } from "./time.js";
import { hexLerp } from "./color.js";


// ---------- Écran de connexion (inchangé) ----------
function Login({ onLogin }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(name, password);
      onLogin(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4 rounded-xl border border-slate-700 bg-slate-800/80 p-6">
        <h1 className="text-lg font-bold text-sky-300">⚓ Pacific Chase</h1>
        <p className="text-xs text-slate-400">Course en temps réel sur l'océan — connectez-vous pour reprendre la mer.</p>
        <input
          autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom du marin"
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
        />
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe"
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100"
        />
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">
          {busy ? "Connexion…" : "Embarquer"}
        </button>
      </form>
    </div>
  );
}

// ---------- Application principale : login → poste de barre ----------
export default function App() {
  const [session, setSession] = useState(null);
  const [snap, setSnap] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [shopOpen, setShopOpen] = useState(false);
  const [wxOpen, setWxOpen] = useState(false);
  const [wxTab, setWxTab] = useState("prev");
  const [netOpen, setNetOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [wxH, setWxH] = useState(0);
  const [wxData, setWxData] = useState(null);
  const sockRef = useRef(null);

  useEffect(() => {
    if (!wxOpen || !snap) return;
    const cancel = { dead: false };
    const token = session.token;
    fetch(`/api/wx?h=${wxH}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancel.dead) setWxData(d); });
    return () => { cancel.dead = true; };
  }, [wxOpen, wxH, snap && Math.floor(snap.t / 60)]);

  // Anti-gel + fluidité : le serveur COALESCÉ désormais ses réponses de
  // commande (au plus 1 snapshot par 250 ms et par socket, voir index.js),
  // donc le flux entrant reste raisonnable (~5/s en plein drag, 1/s au
  // repos). On garde le mécanisme « dernier snapshot gagne » — re-rendu
  // plafonné à un toutes les 80 ms, jamais de file d'attente — mais le
  // plafond remonté de 200 à 80 ms rend la console réactive au drag.
  const snapBuf = useRef(null); // dernier snapshot non encore rendu
  const snapTimer = useRef(0);
  const pushSnap = useCallback((data) => {
    snapBuf.current = data;
    if (snapTimer.current) return; // un rendu est déjà planifié
    snapTimer.current = setTimeout(() => {
      snapTimer.current = 0;
      const d = snapBuf.current;
      snapBuf.current = null;
      if (d) setSnap(d); // rend le PLUS RÉCENT — les intermédiaires sont jetés
    }, 80);
  }, []);

  useEffect(() => {
    if (!session) return;
    const sock = new GameSocket(pushSnap, setStatus);
    sock.connect();
    sockRef.current = sock;
    return () => sock.close();
  }, [session]);

  const sock = sockRef.current;
  const player = snap?.player;
  const cmd = (data) => sock && sock.command(data);

  if (!session) return <Login onLogin={setSession} />;
  if (!snap) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-400">Connexion au serveur… ({status})</p>
      </div>
    );
  }

  const atDock = player.location === "surface" &&
    (distKm(player.estX, player.estY, snap.world.port.x, snap.world.port.y) < DELIVERY_R_KM ||
    snap.world.outposts.some((o) => distKm(player.estX, player.estY, o.x, o.y) < DELIVERY_R_KM));

  // Bloc « maître de course » (super-user) : rendu SEULEMENT si snap.isSuper.
  const superBlock = snap.isSuper ? (
    <div className="instrument flex items-center gap-1 px-2 py-1">
      <span className="engrave text-[7.5px] uppercase tracking-[0.16em]">maître de course</span>
      <button onClick={() => cmd({ timeSkipMin: 60 })} className="rounded border border-[#5c3a1a] bg-[#241a0e] px-1.5 py-0.5 text-[9px] hover:border-amber-500">⏩ 1 h</button>
      <button onClick={() => cmd({ timeSkipMin: 360 })} className="rounded border border-[#5c3a1a] bg-[#241a0e] px-1.5 py-0.5 text-[9px] hover:border-amber-500">⏩ 6 h</button>
      <span className="mx-0.5 text-[9px] text-[#5c4620]">|</span>
      <button onClick={() => cmd({ timeSkipMin: Math.round(nextPhase(snap.t, 6)) })} className="rounded border border-[#5c3a1a] bg-[#241a0e] px-1.5 py-0.5 text-[9px] hover:border-amber-500">🌅</button>
      <button onClick={() => cmd({ timeSkipMin: Math.round(nextPhase(snap.t, 8)) })} className="rounded border border-[#5c3a1a] bg-[#241a0e] px-1.5 py-0.5 text-[9px] hover:border-amber-500">☀️</button>
      <button onClick={() => cmd({ timeSkipMin: Math.round(nextPhase(snap.t, 18)) })} className="rounded border border-[#5c3a1a] bg-[#241a0e] px-1.5 py-0.5 text-[9px] hover:border-amber-500">🌇</button>
      <button onClick={() => cmd({ timeSkipMin: Math.round(nextPhase(snap.t, 20)) })} className="rounded border border-[#5c3a1a] bg-[#241a0e] px-1.5 py-0.5 text-[9px] hover:border-amber-500">🌙</button>
      <span className="mx-0.5 text-[9px] text-[#5c4620]">|</span>
      <button onClick={() => { if (confirm("Réinitialiser la course ? Nouveau monde, nouvelles balises, tous les navires à quai, scores remis à zéro. Irréversible.")) cmd({ resetRace: true }); }}
        className="rounded border border-rose-800 bg-[#3a1414] px-1.5 py-0.5 text-[9px] text-rose-200 hover:border-rose-500">reset</button>
    </div>
  ) : null;

  return (
    <>
      <Helm
        snap={snap}
        sock={sock}
        status={status}
        superBlock={superBlock}
        onManual={() => setManualOpen(true)}
        onShop={() => setShopOpen(true)}
        onNetwork={() => setNetOpen(true)}
        onNews={() => { setNewsOpen(true); cmd({ newsRead: true }); }}
        canShop={atDock}
      />

      {/* NETWORK (port / avant-poste / balise) : connexion, météo 48 h, journal global */}
      {netOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setNetOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border-2 border-[#241a0e] p-5 shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
            style={{ background: "linear-gradient(180deg, #4a3421, #33230f)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="plate rounded px-2.5 py-1 text-center text-[12px] font-bold uppercase tracking-[0.14em]">🌐 NETWORK — réseau de la course</h2>
            <p className="engrave text-[9px] uppercase tracking-[0.14em]">Journal global de la course : chaque connexion y est inscrite. Météo 48 h et journal accessibles tant que vous restez dans la zone (port, avant-poste ou balise).</p>
            {!player.networked ? (
              <div className="space-y-2 rounded-lg border border-amber-800/60 bg-[#241b0e]/80 p-3">
                <p className="text-[11px] leading-snug text-amber-200/80">
                  Se connecter révèle votre identité et votre code : ils seront enregistrés dans le journal global, consulté par tous les abonnés (qui est allé où, quand).
                </p>
                <button onClick={() => cmd({ network: true })} className="rounded border border-[#5c3a1a] bg-gradient-to-b from-[#b87333] to-[#7c4a1a] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#1c130a] hover:from-[#d08a4a]">Se connecter au NETWORK</button>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-emerald-800/60 bg-[#0a1410]/70 p-3">
                <p className="text-xs text-emerald-300">● Connecté — accès au réseau météo et au journal global.</p>
                <button onClick={() => { setWxOpen(true); setWxH(0); }} className="rounded border border-[#5c3a1a] bg-gradient-to-b from-[#b87333] to-[#7c4a1a] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#1c130a] hover:from-[#d08a4a]">🌦️ Météo</button>
              </div>
            )}
            {(snap.networkLog || []).length > 0 && (
              <div className="rounded-lg border border-[#4a3820] bg-[#0a0f16]/60 p-2">
                <p className="engrave mb-1 text-[8.5px] uppercase tracking-[0.18em]">Journal global — connexions ({snap.networkLog.length})</p>
                <div className="max-h-56 space-y-0.5 overflow-y-auto">
                  {[...snap.networkLog].reverse().map((e, i) => (
                    <p key={i} className="font-mono text-[10px] leading-snug tabular-nums text-amber-100/75">
                      {fmtParis(e.t, snap.epoch)} · {e.who} (navire {e.code}) — {e.place.kind === "port" ? "au port" : e.place.kind === "avant-poste" ? `à l'avant-poste ${e.place.id + 1}` : `à la balise ${e.place.id} (code ${e.place.code})`}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {snap.patrolPub && (
              <div className="rounded-lg border border-[#4a3820] bg-[#0a0f16]/60 p-2">
                <p className="engrave mb-1 text-[8.5px] uppercase tracking-[0.18em]">Patrouille de sécurité — position officielle</p>
                <p className="text-[11px] leading-snug tabular-nums text-amber-100/85">
                  🚢 Frégate MaxMedia — {snap.patrolPub.y.toFixed(1)}°N {snap.patrolPub.x.toFixed(1)}°E (publiée il y a {Math.max(0, Math.round(snap.t - snap.patrolPub.t))} min)
                </p>
              </div>
            )}
            <button onClick={() => setNetOpen(false)} className="plate rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider hover:brightness-110">Reprendre la navigation</button>
          </div>
        </div>
      )}

      {/* Bulletin officiel de la course (newsletter 7 h/19 h) : reçu par
          tous les navigateurs, bouton dédié — JAMAIS dans le journal de bord */}
      {newsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setNewsOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl border-2 border-[#241a0e] p-5 shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
            style={{ background: "linear-gradient(180deg, #4a3421, #33230f)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="plate rounded px-2.5 py-1 text-center text-[12px] font-bold uppercase tracking-[0.14em]">📰 Bulletin de la course — MaxMedia</h2>
            <p className="engrave text-[9px] uppercase tracking-[0.14em]">Éditions 07:00 et 19:00 — classements, météo des zones, zone d'exclusion en vigueur.</p>
            {(snap.news?.items || []).length === 0 && (
              <p className="text-center text-xs text-amber-100/75">Aucun bulletin reçu pour l'instant — première édition à 07:00 ou 19:00.</p>
            )}
            {[...(snap.news?.items || [])].reverse().map((n) => (
              <div key={n.seq} className="space-y-2.5 rounded-lg border border-[#4a3820] bg-[#0a0f16]/60 p-3">
                <p className="text-center font-serif text-[13px] font-bold text-amber-200">
                  {fmtParisLong(n.t, snap.epoch)} — édition du {n.kind}
                </p>
                <div>
                  <p className="engrave mb-1 text-[8.5px] uppercase tracking-[0.18em]">Classement officiel — balises livrées</p>
                  {n.standings.length === 0 && <p className="font-mono text-[10px] italic text-amber-100/50">aucun navigateur au départ</p>}
                  {n.standings.map((p, i) => (
                    <p key={p.code} className="font-mono text-[10px] leading-snug tabular-nums text-amber-100/85">
                      {i + 1}. {p.who} (navire {p.code}) — {p.score} pts
                    </p>
                  ))}
                </div>
                <div>
                  <p className="engrave mb-1 text-[8.5px] uppercase tracking-[0.18em]">Classement officieux — codes en cale, non livrés</p>
                  {n.unofficial.length === 0
                    ? <p className="font-mono text-[10px] italic text-amber-100/50">aucun code en cale</p>
                    : n.unofficial.map((p, i) => (
                      <p key={p.code} className="font-mono text-[10px] leading-snug tabular-nums text-amber-100/85">
                        {i + 1}. {p.who} (navire {p.code}) — {p.held} pts potentiels
                      </p>
                    ))}
                </div>
                <div>
                  <p className="engrave mb-1 text-[8.5px] uppercase tracking-[0.18em]">Météo dominante par zone</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {n.zones.map((z) => (
                      <p key={z.id} className="rounded border border-[#4a3820] bg-[#241b0e]/60 px-2 py-1 font-mono text-[10px] leading-snug text-amber-100/85">
                        {z.id} : {z.wx} · vent {z.wind} km/h · vis. {z.vis} km
                      </p>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="engrave mb-1 text-[8.5px] uppercase tracking-[0.18em]">Zone d'exclusion en vigueur</p>
                  {n.exclusion ? (
                    <p className="font-mono text-[10px] leading-snug tabular-nums text-amber-100/85">
                      ⚠️ {n.exclusion.y.toFixed(1)}°N {n.exclusion.x.toFixed(1)}°E — rayon {Math.round(n.exclusion.rKm)} km (opérations hydrographiques — navigation à vos risques et périls)
                    </p>
                  ) : (
                    <p className="font-mono text-[10px] italic text-amber-100/50">⚖️ aucune zone d'exclusion en vigueur</p>
                  )}
                </div>
              </div>
            ))}
            <button onClick={() => setNewsOpen(false)} className="plate rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider hover:brightness-110">Reprendre la navigation</button>
          </div>
        </div>
      )}

      {/* Prévisions météo (via NETWORK) */}
      {wxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setWxOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border-2 border-[#241a0e] p-5 shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
            style={{ background: "linear-gradient(180deg, #4a3421, #33230f)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="plate rounded px-2.5 py-1 text-center text-[12px] font-bold uppercase tracking-[0.14em]">🌦️ Prévisions météo — NETWORK</h2>
            <p className="engrave text-[9px] uppercase tracking-[0.14em]">Bulletin du NETWORK, reçu en zone (port, avant-poste ou balise). Prévision parfaite sur 48 h · Instant : <b className="font-mono">+{wxH} h</b></p>
            <div className="flex justify-center gap-2">
              <button onClick={() => setWxTab("prev")}
                className={wxTab === "prev" ? "rounded border border-amber-200/60 bg-[#3a2a12] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-100" : "rounded border border-[#5c3a1a] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-100/60"}>Prévisions météo</button>
              <button onClick={() => setWxTab("vent")}
                className={wxTab === "vent" ? "rounded border border-amber-200/60 bg-[#3a2a12] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-100" : "rounded border border-[#5c3a1a] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-100/60"}>Carte des vents</button>
            </div>
            {wxTab === "prev" && (
            <svg viewBox={`0 0 600 600`} className="mx-auto w-full max-w-[440px] rounded-lg border border-[#4a3820] bg-[#0a2033]">
              {(wxData?.cells || []).map((c) => {
                const S = 10;
                const px = (x) => x * S, py = (y) => (MAP - y) * S;
                const color = c.storm ? "#dc2626" : c.fog ? "#cbd5e1" : c.rain > 55 ? "#3b82f6" : c.rain > 20 ? "#64748b"
                  : hexLerp("#fde68a", "#94a3b8", clamp(c.clouds / 100, 0, 1));
                return <rect key={`${c.x}-${c.y}`} x={px(c.x) - S} y={py(c.y) - S} width={S * 2} height={S * 2} fill={color} />;
              })}
              <polygon points={snap.world.continent.map(([vx, vy]) => `${vx * 10},${(MAP - vy) * 10}`).join(" ")} fill="none" stroke="rgba(248,250,252,0.35)" strokeWidth="1" />
              {snap.world.islands.map((verts, i) => (
                <polygon key={i} points={verts.map(([vx, vy]) => `${vx * 10},${(MAP - vy) * 10}`).join(" ")} fill="none" stroke="rgba(248,250,252,0.35)" strokeWidth="1" />
              ))}
              <circle cx={snap.world.port.x * 10} cy={(MAP - snap.world.port.y) * 10} r="5" fill="#34d399" />
              {snap.world.outposts.map((o, i) => <circle key={i} cx={o.x * 10} cy={(MAP - o.y) * 10} r="4" fill="#34d399" />)}
              <circle cx={snap.player.estX * 10} cy={(MAP - snap.player.estY) * 10} r="7" fill="none" stroke="#f8fafc" strokeWidth="2" />
            </svg>
            )}
            {wxTab === "vent" && (
            <svg viewBox={`0 0 600 600`} className="mx-auto w-full max-w-[440px] rounded-lg border border-[#4a3820] bg-[#0a2033]">
              {(wxData?.cells || []).map((c) => {
                const S = 10;
                const cx = c.x * S, cy = (MAP - c.y) * S;
                const flow = ((c.windDir + 180) * Math.PI) / 180; // vers où ça souffle
                const col = c.windSpd < 15 ? "#94a3b8" : c.windSpd < 30 ? "#34d399" : c.windSpd < 45 ? "#fbbf24" : "#ef4444";
                const L = 6 + Math.min(9, (c.windSpd - 8) * 0.3);
                const dx = Math.sin(flow) * L, dy = -Math.cos(flow) * L;
                return (
                  <g key={`w${c.x}-${c.y}`} stroke={col} fill={col} strokeWidth="1.3" strokeLinecap="round" opacity="0.9">
                    <line x1={cx - dx / 2} y1={cy - dy / 2} x2={cx + dx / 2} y2={cy + dy / 2} />
                    <polygon points={`${cx + dx},${cy + dy} ${cx + dx * 0.4 - dy * 0.35},${cy + dy * 0.4 + dx * 0.35} ${cx + dx * 0.4 + dy * 0.35},${cy + dy * 0.4 - dx * 0.35}`} />
                  </g>
                );
              })}
              {(wxData?.systems || []).filter((s) => s.x > -10 && s.x < 70 && s.y > -10 && s.y < 70).map((s, i) => {
                const col = s.label === "ANTICYCLONE" ? "#34d399" : "#ef4444";
                const R = (s.rKm / DEG_KM) * 10;
                return (
                  <g key={`sys${i}`}>
                    <circle cx={s.x * 10} cy={(MAP - s.y) * 10} r={R} fill="none" stroke={col} strokeWidth="1.5" strokeDasharray="6 4" opacity="0.85" />
                    <circle cx={s.x * 10} cy={(MAP - s.y) * 10} r="2.5" fill={col} />
                    <text x={s.x * 10 + R * 0.72} y={(MAP - s.y) * 10 - R * 0.72} fontSize="9" fill={col} fontWeight="bold">{s.label} · {s.effKmh} km/h</text>
                  </g>
                );
              })}
              <polygon points={snap.world.continent.map(([vx, vy]) => `${vx * 10},${(MAP - vy) * 10}`).join(" ")} fill="none" stroke="rgba(248,250,252,0.35)" strokeWidth="1" />
              {snap.world.islands.map((verts, i) => (
                <polygon key={i} points={verts.map(([vx, vy]) => `${vx * 10},${(MAP - vy) * 10}`).join(" ")} fill="none" stroke="rgba(248,250,252,0.35)" strokeWidth="1" />
              ))}
              <circle cx={snap.world.port.x * 10} cy={(MAP - snap.world.port.y) * 10} r="5" fill="#34d399" />
              {snap.world.outposts.map((o, i) => <circle key={i} cx={o.x * 10} cy={(MAP - o.y) * 10} r="4" fill="#34d399" />)}
              <circle cx={snap.player.estX * 10} cy={(MAP - snap.player.estY) * 10} r="7" fill="none" stroke="#f8fafc" strokeWidth="2" />
            </svg>
            )}
            <p className="engrave text-center text-[8.5px] uppercase tracking-widest">calme &lt;15 · brise 15-30 · fort 30-45 · tempête &gt;45 km/h · pointillé = système</p>
            <div className="flex items-center gap-3">
              <span className="engrave text-[8.5px] uppercase tracking-widest">Maintenant</span>
              <input type="range" min={0} max={WX_HORIZON_H} step={2} value={Math.min(wxH, WX_HORIZON_H)} onChange={(e) => setWxH(+e.target.value)} className="rng w-full" />
              <span className="engrave text-[8.5px] uppercase tracking-widest">48 h</span>
            </div>
            {wxData?.here && (
              <p className="rounded-lg border border-[#4a3820] bg-[#0a0f16]/60 p-2.5 text-center text-xs text-amber-100/85">
                À votre position à cet instant : vent <b className="text-sky-300">{wxData.here.windSpd.toFixed(0)} km/h de {wxData.here.windDir.toFixed(0)}°</b> · <b className="text-sky-300">{wxData.here.regime}</b> · mer <b className="text-sky-300">{DOUGLAS_LABEL[wxData.here.douglas]}</b> (<b className="text-sky-300">{wxData.here.hs.toFixed(1)} m</b>) · nuages <b className="text-sky-300">{wxData.here.clouds.toFixed(0)} %</b> · pluie <b className="text-sky-300">{wxData.here.rain.toFixed(0)} %</b> · visibilité <b className="text-sky-300">{wxData.here.visibility.toFixed(1)} km</b>
                {wxData.here.storm ? " · ⛈️ TEMPÊTE" : wxData.here.fog ? " · 🌫️ BROUILLARD" : ""}
              </p>
            )}
            <button onClick={() => setWxOpen(false)} className="plate rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider hover:brightness-110">Reprendre la navigation</button>
          </div>
        </div>
      )}

      {/* Avitaillement */}
      {shopOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShopOpen(false)}>
          <div className="w-full max-w-sm space-y-3 rounded-xl border-2 border-[#241a0e] p-5 shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
            style={{ background: "linear-gradient(180deg, #4a3421, #33230f)" }} onClick={(e) => e.stopPropagation()}>
            <h2 className="plate rounded px-2.5 py-1 text-center text-[12px] font-bold uppercase tracking-[0.14em]">🛒 Avitaillement</h2>
            <p className="engrave text-[9px] uppercase tracking-[0.14em]">Navire à quai : plein, vivres et radoub gratuits.</p>
            <button onClick={() => { cmd({ refuel: true }); setShopOpen(false); }} className="w-full rounded border border-[#5c3a1a] bg-gradient-to-b from-[#b87333] to-[#7c4a1a] px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide text-[#1c130a] hover:from-[#d08a4a]">✅ Plein complet</button>
            <button onClick={() => { cmd({ repair: true }); setShopOpen(false); }} className="w-full rounded border border-[#5c3a1a] bg-gradient-to-b from-[#b87333] to-[#7c4a1a] px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide text-[#1c130a] hover:from-[#d08a4a]">🛠️ Réparation complète</button>
            <button onClick={() => setShopOpen(false)} className="plate rounded w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider hover:brightness-110">Reprendre la mer</button>
          </div>
        </div>
      )}

      {/* Manuel du jeu */}
      {manualOpen && <Manual onClose={() => setManualOpen(false)} />}
    </>
  );
}
