import React, { useEffect, useRef, useState } from "react";
import { login, GameSocket } from "./net.js";
import Manual from "./Manual.jsx";
import Helm from "./Helm.jsx";
import { nextPhase } from "./NavMap.jsx";
import {
  MAP, DEG_KM, distKm, MS_PER_MIN, DELIVERY_R_KM, WX_HORIZON_H,
} from "../../shared/engine.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mixHex = (a, b, t) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

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
  const [netOpen, setNetOpen] = useState(false);
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

  useEffect(() => {
    if (!session) return;
    const sock = new GameSocket(setSnap, setStatus);
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
        onWx={() => { setWxOpen(true); setWxH(0); }}
        canShop={atDock}
      />

      {/* NETWORK (port / avant-poste / balise) : connexion, météo 48 h, journal global */}
      {netOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setNetOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-sky-300">🌐 NETWORK — réseau de la course</h2>
            <p className="text-xs text-slate-400">Journal global de la course : chaque connexion y est inscrite. Météo 48 h et journal accessibles tant que vous restez dans la zone (port, avant-poste ou balise).</p>
            {!player.networked ? (
              <div className="space-y-2 rounded-lg border border-amber-800/60 bg-amber-950/30 p-3">
                <p className="text-[11px] leading-snug text-amber-200/80">
                  Se connecter révèle votre identité et votre code : ils seront enregistrés dans le journal global, consulté par tous les abonnés (qui est allé où, quand).
                </p>
                <button onClick={() => cmd({ network: true })} className="rounded bg-sky-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950">Se connecter au NETWORK</button>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-3">
                <p className="text-xs text-emerald-300">● Connecté — accès au réseau météo et au journal global.</p>
                <button onClick={() => { setWxOpen(true); setWxH(0); }} className="rounded bg-sky-500 px-2.5 py-1.5 text-xs font-semibold text-slate-950">🌦️ Afficher la météo (48 h)</button>
              </div>
            )}
            {(snap.networkLog || []).length > 0 && (
              <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-2">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Journal global — connexions ({snap.networkLog.length})</p>
                <div className="max-h-56 space-y-0.5 overflow-y-auto">
                  {[...snap.networkLog].reverse().map((e, i) => (
                    <p key={i} className="text-[10px] leading-snug tabular-nums text-slate-400">
                      {new Date(snap.epoch + e.t * MS_PER_MIN).toLocaleString("fr-FR")} · {e.who} (navire {e.code}) — {e.place.kind === "port" ? "au port" : e.place.kind === "avant-poste" ? `à l'avant-poste ${e.place.id + 1}` : `à la balise ${e.place.id} (code ${e.place.code})`}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {snap.patrolPub && (
              <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-2">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Patrouille de sécurité — position officielle</p>
                <p className="text-[11px] leading-snug tabular-nums text-slate-300">
                  🚢 Frégate MaxMedia — {snap.patrolPub.y.toFixed(1)}°N {snap.patrolPub.x.toFixed(1)}°E (publiée il y a {Math.max(0, Math.round(snap.t - snap.patrolPub.t))} min)
                </p>
              </div>
            )}
            <button onClick={() => setNetOpen(false)} className="rounded bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200">Reprendre la navigation</button>
          </div>
        </div>
      )}

      {/* Prévisions météo (via NETWORK) */}
      {wxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setWxOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-sky-300">🌦️ Prévisions météo — NETWORK</h2>
            <p className="text-xs text-slate-400">Bulletin du NETWORK, reçu en zone (port, avant-poste ou balise). Prévision parfaite sur 48 h · Instant : <b className="tabular-nums text-sky-300">+{wxH} h</b></p>
            <svg viewBox={`0 0 600 600`} className="mx-auto w-full max-w-[440px] rounded-lg bg-slate-950">
              {(wxData?.cells || []).map((c) => {
                const S = 10;
                const px = (x) => x * S, py = (y) => (MAP - y) * S;
                const color = c.storm ? "#dc2626" : c.fog ? "#cbd5e1" : c.rain > 55 ? "#3b82f6" : c.rain > 20 ? "#64748b"
                  : mixHex("#fde68a", "#94a3b8", clamp(c.clouds / 100, 0, 1));
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
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">Maintenant</span>
              <input type="range" min={0} max={WX_HORIZON_H} step={2} value={Math.min(wxH, WX_HORIZON_H)} onChange={(e) => setWxH(+e.target.value)} className="w-full accent-sky-400" />
              <span className="text-xs text-slate-400">48 h</span>
            </div>
            {wxData?.here && (
              <p className="rounded-lg bg-slate-800/70 p-2.5 text-center text-xs text-slate-300">
                À votre position à cet instant : vent <b className="text-sky-300">{wxData.here.windSpd.toFixed(0)} km/h</b> · nuages <b className="text-sky-300">{wxData.here.clouds.toFixed(0)} %</b> · pluie <b className="text-sky-300">{wxData.here.rain.toFixed(0)} %</b> · visibilité <b className="text-sky-300">{wxData.here.visibility.toFixed(1)} km</b> · houle <b className="text-sky-300">{wxData.here.hs.toFixed(1)} m</b>
                {wxData.here.storm ? " · ⛈️ TEMPÊTE" : wxData.here.fog ? " · 🌫️ BROUILLARD" : ""}
              </p>
            )}
            <button onClick={() => setWxOpen(false)} className="rounded bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200">Reprendre la navigation</button>
          </div>
        </div>
      )}

      {/* Avitaillement */}
      {shopOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShopOpen(false)}>
          <div className="w-full max-w-sm space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-sky-300">🛒 Avitaillement</h2>
            <p className="text-xs text-slate-400">Navire à quai : plein de carburant et de vivres.</p>
            <button onClick={() => { cmd({ refuel: true }); setShopOpen(false); }} className="rounded bg-emerald-500 px-2.5 py-1.5 text-xs font-bold text-slate-950">✅ Plein complet</button>
            <button onClick={() => setShopOpen(false)} className="rounded bg-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-200">Reprendre la mer</button>
          </div>
        </div>
      )}

      {/* Manuel du jeu */}
      {manualOpen && <Manual onClose={() => setManualOpen(false)} />}
    </>
  );
}
