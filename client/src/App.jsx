import React, { useEffect, useMemo, useRef, useState } from "react";
import { login, GameSocket } from "./net.js";
import Scene from "./Scene.jsx";
import Manual from "./Manual.jsx";
import {
  MAP, DEG_KM, RARITY_STYLE,
  distKm, dirSensitivity, DOUGLAS_LABEL, LONG_DECAY_KM,
  DELIVERY_R_KM, OMNI_DETECT_PCT, MS_PER_MIN, WX_HORIZON_H, AUTOGUIDE_MODES, AUTOGUIDE_DEFAULT,
  HORIZON_KM, PINS_MAX, SAIL_DEFAULT,
  SONAR_RANGE_KM, SOUND_DECAY_KM, SONAR_ECHO_PERSIST_S, SONAR_PING_BATTERY_COST,
} from "../../shared/engine.js";

const AUTOGUIDE_LABEL = { off: "Aucun", active: "Actives", disabled: "Déjà capturées", all: "Toutes" };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mixHex = (a, b, t) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
};
const fmtT = (t, epoch) => {
  // Heure de jeu affichée = vraie heure de Paris (epoch + minutes de jeu).
  const d = new Date((epoch || 0) + t * MS_PER_MIN);
  const date = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
};

// ---------- Écran de connexion ----------
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

// ---------- Petits composants ----------
function Bar({ label, value, color }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>{label}</span><span className="tabular-nums">{Math.round(value)}%</span>
      </div>
      <div className="h-2 w-full rounded bg-slate-700/60">
        <div className="h-2 rounded transition-all" style={{ width: `${clamp(value, 0, 100)}%`, background: color }} />
      </div>
    </div>
  );
}
function DirArrow({ deg, color = "#cbd5e1" }) {
  return (
    <svg viewBox="0 0 20 20" width="13" height="13" className="inline-block align-[-2px]" style={{ transform: `rotate(${deg}deg)` }}>
      <path d="M 10 1.5 L 15.5 18 L 10 14 L 4.5 18 Z" fill={color} />
    </svg>
  );
}
function Btn({ active, onClick, children, className = "" }) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? "bg-sky-500 text-slate-950" : "bg-slate-700/70 text-slate-200 hover:bg-slate-600"} ${className}`}
    >
      {children}
    </button>
  );
}

// ---------- Vue de dessus (fenêtre du pont) ----------
// Dessinée autour de la POSITION ESTIMÉE du navire (jamais la vraie) : les
// détections du serveur sont rapportées en azimut/distance depuis l'estimé.
function TopView({ snap }) {
  const { player, view, weather } = snap;
  const svgRef = useRef(null);
  const [zoom, setZoom] = useState(1);          // ×1 – ×16 (pas de pan : le navire reste au centre)
  const ptrs = useRef({});
  const drag = useRef(null);
  const pinch = useRef(null);

  const R = HORIZON_KM;            // horizon km (le disque entier)
  const HALF = 100;                // demi-taille du viewBox (200x200)
  // échelle courante : px par km — à ×1, l'horizon remplit le disque (100 px)
  const P = (HALF / R) * zoom;
  const night = view.night;
  const heading = player.heading;
  // rayon visible du monde en km selon le zoom (au-delà : clampé au bord)
  const visRangeKm = R / zoom;

  // Projection azimut/distance : tout est calculé côté serveur DEPUIS LA
  // POSITION VRAIE et dessiné autour d'elle — la vue du dessus ne triche
  // pas (l'incertitude d'estime se lit sur la carte de navigation, pas ici).
  const proj = (az, km) => {
    const a = (az * Math.PI) / 180;
    const x = 100 + Math.sin(a) * km * P;
    const y = 100 - Math.cos(a) * km * P;
    return [x, y];
  };
  const inDisk = ([x, y]) => Math.hypot(x - 100, y - 100) < 96;

  // tailles adaptatives : les éléments restent lisibles à tout zoom
  const font = (px) => Math.max(px / Math.sqrt(zoom), 4.5);      // labels
  const marker = (px) => Math.max(px / zoom, 1.6);               // rayons marqueurs
  const lw = (px) => Math.max(px / zoom, 0.4);                   // épaisseurs traits

  const visF = clamp(view.visKm / visRangeKm, 0, 1);
  const hr = (player.antBeam / 2) * Math.PI / 180;
  const antHeading = view.antHeading;

  // interactions : molette zoom, pincement tactile, glisser = pan
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onW = (e) => {
      e.preventDefault();
      setZoom((z) => clamp(z * Math.exp(-e.deltaY * 0.0012), 1, 16));
    };
    el.addEventListener("wheel", onW, { passive: false });
    return () => el.removeEventListener("wheel", onW);
  }, []);

  const wrad = (view.windDir * Math.PI) / 180;
  const wax = 100 + Math.sin(wrad) * 91, way = 100 - Math.cos(wrad) * 91;
  const wbx = 100 + Math.sin(wrad) * 67, wby = 100 - Math.cos(wrad) * 67;
  const wux = (wbx - wax) / 24, wuy = (wby - way) / 24;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 200 200"
      className="mx-auto w-full max-w-[280px] touch-none select-none"
      style={{ cursor: "default" }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        ptrs.current[e.pointerId] = { x: e.clientX, y: e.clientY };
        const ids = Object.keys(ptrs.current);
        if (ids.length === 2) {
          const [a, b] = Object.values(ptrs.current);
          pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom };
        }
      }}
      onPointerMove={(e) => {
        const pt = ptrs.current[e.pointerId];
        if (pt) { pt.x = e.clientX; pt.y = e.clientY; }
        const ids = Object.keys(ptrs.current);
        if (ids.length >= 2 && pinch.current) {
          // pincement tactile : zoom uniquement, pas de translation
          const [a, b] = Object.values(ptrs.current);
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          setZoom(clamp(pinch.current.zoom * d / pinch.current.d0, 1, 16));
        }
      }}
      onPointerUp={(e) => { delete ptrs.current[e.pointerId]; if (Object.keys(ptrs.current).length < 2) pinch.current = null; }}
      onPointerLeave={(e) => { delete ptrs.current[e.pointerId]; if (Object.keys(ptrs.current).length < 2) pinch.current = null; }}
    >
      <defs>
        <clipPath id="localClip"><circle cx="100" cy="100" r="98" /></clipPath>
        <radialGradient id="visGrad2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#94a3b8" stopOpacity="0" />
          <stop offset={`${visF * 94}%`} stopColor="#94a3b8" stopOpacity="0.03" />
          <stop offset={`${Math.min(visF * 99, 97)}%`} stopColor="#94a3b8" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.82" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="98" fill={!view.canSee ? "#010a14" : night ? "#03121f" : "#0b2a4a"} stroke="#38bdf8" strokeWidth="1.5" />
      <g clipPath="url(#localClip)">
        {/* Côte du continent — échelle exacte, suivie par le zoom.
            Sommets RELATIFS à la position VRAIE (calculés côté serveur) :
            la côte se dessine là où elle est, sans passer par l'estime. */}
        {view.coast && view.continentVerts && (() => {
          const kx = (x) => 100 + x * DEG_KM * P;
          const ky = (y) => 100 - y * DEG_KM * P;
          return (
            <polygon
              points={view.continentVerts.map(([vx, vy]) => `${kx(vx).toFixed(1)},${ky(vy).toFixed(1)}`).join(" ")}
              fill={night ? "#0a1f16" : "#1c3a2a"} stroke={night ? "#1f4d38" : "#2f5c43"}
              strokeWidth={lw(1)}
            />
          );
        })()}
        {/* Îles détectées (dans l'horizon agrandi) */}
        {view.islands.map((e, idx) => {
          const p = proj(e.az, e.km);
          return e.beyond ? null : (
            <circle key={idx} cx={p[0]} cy={p[1]} r={marker(10)}
              fill={night ? "#0a1f16" : "#1c3a2a"} stroke={night ? "#1f4d38" : "#2f5c43"} strokeWidth={lw(0.8)} />
          );
        })}
        {/* Port */}
        {view.port && !view.port.beyond && (() => {
          const p = proj(view.port.az, view.port.km);
          return (
            <g>
              <circle cx={p[0]} cy={p[1]} r={marker(night ? 3 : 6)} fill="#f8fafc" />
              {!night && <text x={p[0]} y={p[1] - marker(9)} fontSize={font(8)} fill="#f8fafc" textAnchor="middle">Port</text>}
            </g>
          );
        })()}
        {/* Avant-postes */}
        {view.outposts.map((e) => {
          if (e.beyond) return null;
          const p = proj(e.az, e.km);
          return <circle key={e.idx} cx={p[0]} cy={p[1]} r={marker(night ? 2.2 : 4)} fill="#e2e8f0" />;
        })}
        {/* Balises détectées : coque le jour, feu la nuit */}
        {view.beacons.map((e) => {
          if (e.beyond) return null;
          const p = proj(e.az, e.km);
          return night
            ? <circle key={e.id} cx={p[0]} cy={p[1]} r={marker(2.5)} fill="#f8fafc" />
            : <circle key={e.id} cx={p[0]} cy={p[1]} r={marker(4)} fill={e.off ? "#64748b" : RARITY_STYLE[e.rarity].color} />;
        })}
        {/* Traces de la Bête : épave (coque grise brisée) / mer de sang (tache rouge) */}
        {(view.traces || []).map((e, idx) => {
          if (e.beyond) return null;
          const p = proj(e.az, e.km);
          return e.kind === "epave" ? (
            <g key={"tr" + idx}>
              <path d={`M ${p[0] - marker(5)} ${p[1] - marker(1.5)} L ${p[0] + marker(5)} ${p[1] + marker(1.5)} M ${p[0] + marker(5)} ${p[1] - marker(1.5)} L ${p[0] - marker(5)} ${p[1] + marker(1.5)}`} stroke="#64748b" strokeWidth={lw(2)} strokeLinecap="round" />
            </g>
          ) : (
            <circle key={"tr" + idx} cx={p[0]} cy={p[1]} r={marker(7)} fill="rgba(153,27,27,0.45)" stroke="#b91c1c" strokeWidth={lw(0.8)} />
          );
        })}
        {/* Navires détectés : marqueur + nom + distance, feu si phare la nuit */}
        {(snap.ships || []).filter((s) => s.km <= visRangeKm + 30).map((s) => {
          const p = proj(s.az, s.km);
          if (!inDisk(p)) return null;
          return (
            <g key={s.id}>
              <circle cx={p[0]} cy={p[1]} r={marker(night ? (s.light ? 3 : 2.2) : 3.5)}
                fill={night ? (s.light ? "#fde68a" : "#94a3b8") : "#f1f5f9"}
                stroke="#475569" strokeWidth={lw(0.6)} />
              <text x={p[0]} y={p[1] - marker(6)} fontSize={font(6)} fill="#cbd5e1" textAnchor="middle">{s.id} · {Math.round(s.km)} km</text>
            </g>
          );
        })}
        {/* Navires au-delà de la portée visible : indicateur au bord */}
        {(snap.ships || []).filter((s) => s.km > visRangeKm + 30).map((s) => (
          <g key={"b" + s.id}>
            <text x={100 + Math.sin((s.az * Math.PI) / 180) * 78} y={100 - Math.cos((s.az * Math.PI) / 180) * 78} fontSize={font(9)} textAnchor="middle">⛵</text>
            <text x={100 + Math.sin((s.az * Math.PI) / 180) * 78} y={100 - Math.cos((s.az * Math.PI) / 180) * 78 + font(8)} fontSize={font(6)} fill="#cbd5e1" textAnchor="middle">{Math.round(s.km)} km</text>
          </g>
        ))}
        {/* Brume : voile gris au-delà de la visibilité météo */}
        {view.visKm < visRangeKm - 0.3 && (
          <g>
            <rect x="0" y="0" width="200" height="200" fill="url(#visGrad2)" />
            <circle cx={100} cy={100} r={Math.min(visRangeKm, view.visKm) * P} fill="none" stroke="rgba(203,213,225,0.45)" strokeDasharray="2 3" />
          </g>
        )}
        {/* Vent : flèche au bord du disque */}
        <g>
          <line x1={wax} y1={way} x2={wbx - wux * 5} y2={wby - wuy * 5} stroke="#06263f" strokeWidth={lw(3.6)} strokeLinecap="round" />
          <line x1={wax} y1={way} x2={wbx - wux * 5} y2={wby - wuy * 5} stroke="#93c5fd" strokeWidth={lw(1.7)} />
          <polygon points={`${wbx},${wby} ${wbx - wux * 9 + wuy * 5},${wby - wuy * 9 - wux * 5} ${wbx - wux * 9 - wuy * 5},${wby - wuy * 9 + wux * 5}`} fill="#93c5fd" stroke="#06263f" strokeWidth={lw(1.2)} />
        </g>
        {/* Anneaux de distance : 10 km et 3,7 km — échelle réelle au zoom */}
        {10 * P < 96 && (
          <circle cx={100} cy={100} r={10 * P} fill="none" stroke="rgba(56,189,248,0.25)" strokeDasharray="3 3" strokeWidth={lw(0.8)} />
        )}
        {0.5 * P > 0.8 && (
          <circle cx={100} cy={100} r={0.5 * P} fill="none" stroke="rgba(251,191,36,0.5)" strokeDasharray="1 2" strokeWidth={lw(0.6)} />
        )}
        {/* Faisceau de l'antenne directionnelle */}
        <path
          transform={`translate(${100},${100}) rotate(${antHeading})`}
          d={`M 0 0 L ${(-98 * Math.sin(hr)).toFixed(1)} ${(-98 * Math.cos(hr)).toFixed(1)} A 98 98 0 0 1 ${(98 * Math.sin(hr)).toFixed(1)} ${(-98 * Math.cos(hr)).toFixed(1)} Z`}
          fill="rgba(192,132,252,0.16)" stroke="rgba(192,132,252,0.45)" strokeWidth={lw(0.7)}
        />
        <line transform={`translate(${100},${100}) rotate(${antHeading})`} x1="0" y1="0" x2="0" y2="-94" stroke="#c084fc" strokeDasharray="4 3" strokeWidth={lw(0.7)} />
        {/* Consigne de cap : marqueur pointillé vers l'avant */}
        <line
          transform={`translate(${100},${100}) rotate(${player.headingOrder})`}
          x1="0" y1="0" x2="0" y2={-70 / Math.max(zoom, 1.4)}
          stroke="#fbbf24" strokeWidth={lw(1)} strokeDasharray="3 4" opacity="0.8"
        />
        {/* Navire au centre, orienté au cap */}
        <g transform={`translate(${100},${100}) rotate(${heading})`}>
          <path d={`M 0 ${-12 / Math.max(zoom, 1.2)} L ${8 / Math.max(zoom, 1.2)} ${10 / Math.max(zoom, 1.2)} L 0 ${5 / Math.max(zoom, 1.2)} L ${-8 / Math.max(zoom, 1.2)} ${10 / Math.max(zoom, 1.2)} Z`} fill={player.grounded ? "#f87171" : "#38bdf8"} stroke="#e0f2fe" strokeWidth={lw(0.8)} />
        </g>
        {/* Indicateur de zoom */}
        <text x="100" y="195" fontSize={font(8)} fill="#94a3b8" textAnchor="middle">
          ×{zoom.toFixed(1)} · horizon {Math.round(visRangeKm)} km
        </text>
      </g>
      <text x="100" y="12" fontSize={font(9)} fill="#94a3b8" textAnchor="middle">N</text>
    </svg>
  );
}

// ---------- Clavier radio VHF (appel « Position ? ») ----------
// Clavier cliquable immersif : touches 0-9, effacer (⌫), effacer tout (C).
// Le bouton d'appel n'est actif qu'avec 4 chiffres composés. L'émission
// utilise l'antenne TELLE QU'ELLE EST RÉGLÉE (viser avant d'appeler).
function VhfKeypad({ dialed, onDial, onAction, radioOk, portee }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];
  const press = (k) => {
    if (k === "C") return onDial("");
    if (k === "⌫") return onDial(dialed.slice(0, -1));
    if (dialed.length < 4) onDial(dialed + k);
  };
  return (
    <div className="rounded-xl border border-slate-600 bg-slate-900/80 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-400">Appel « Position ? »</span>
        <span className="text-[10px] text-slate-500">portée dir. : {portee} km</span>
      </div>
      {/* Afficheur du numéro composé */}
      <div className="mb-2 flex items-center justify-center gap-1 rounded-lg border border-sky-900 bg-sky-950/70 px-3 py-2">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`w-7 rounded text-center font-mono text-lg font-bold ${i < dialed.length ? "text-sky-300" : "text-slate-700"}`}>
            {dialed[i] || "–"}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {keys.map((k) => (
          <button
            key={k}
            onClick={() => press(k)}
            className={`rounded-lg py-2 font-mono text-sm font-bold transition-colors ${k === "C" || k === "⌫" ? "bg-rose-900/50 text-rose-200 hover:bg-rose-800/60" : "bg-slate-700/80 text-slate-100 hover:bg-slate-600"}`}
          >{k}</button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button
          disabled={dialed.length !== 4 || !radioOk}
          onClick={() => { onAction("posq", dialed); onDial(""); }}
          className={`rounded-lg py-2 text-xs font-bold transition-colors ${dialed.length === 4 && radioOk ? "bg-sky-500 text-slate-950 hover:bg-sky-400" : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}
        >❓ Position ?</button>
        <button
          disabled={dialed.length !== 4 || !radioOk}
          onClick={() => { onAction("mypos", dialed); onDial(""); }}
          className={`rounded-lg py-2 text-xs font-bold transition-colors ${dialed.length === 4 && radioOk ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400" : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}
        >📍 Ma position</button>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
        « Position ? » est un message littéral : un <b>navire</b> le lit et décide seul de répondre ; une <b>balise</b> l'interprète et répond automatiquement (c'est sa fonction). « Ma position » communique volontairement votre position <b>estimée</b>. (0,5 % batteries par message)
      </p>
    </div>
  );
}

// ---------- Carte de navigation (outil papier : estimé + punaises) ----------
// Reprise fidèle du proto : zoom molette/pincement centré curseur, pan par
// glissement, outils punaise (1 clic) et mesure (2 clics) avec conversion
// letterbox exacte, suppression, indicateur du 1er point.
const TRACE_STEP_KM = 0.5; // trace de route : écart mini entre deux points (km, position estimée)
const TRACE_MAX_PTS = 600; // trace de route : plafond mémoire (points, FIFO au-delà)
function NavMap({ snap, sock }) {
  const S = 10;
  const MAP_PX = MAP * S;
  const px = (x) => x * S;
  const py = (y) => (MAP - y) * S;
  const [vb, setVB] = useState({ x: 0, y: 0, w: MAP_PX });
  const svgRef = useRef(null);
  const ptrs = useRef({});
  const drag = useRef(null);
  const pinch = useRef(null);
  const [tool, setTool] = useState(null);
  const [measurePend, setMeasurePend] = useState(null);
  const [planMode, setPlanMode] = useState(false);
  const [hoverPt, setHoverPt] = useState(null); // position curseur (degres) pour la previsualisation
  const [trace, setTrace] = useState([]); // route parcourue (positions estimées, mémoire locale)

  const clampVB = (v) => ({ ...v, x: clamp(v.x, 0, MAP_PX - v.w), y: clamp(v.y, 0, MAP_PX - v.w) });
  // Zoom d'un facteur autour d'un point (coordonnées viewBox)
  const zoomAt = (v, factor, zx, zy) => {
    const w = clamp(v.w / factor, MAP_PX / 8, MAP_PX);
    const k = w / v.w;
    return clampVB({ x: zx - (zx - v.x) * k, y: zy - (zy - v.y) * k, w });
  };
  // Conversion écran -> viewBox : gère le letterbox (aspect-ratio préservé)
  const vbPoint = (v, rect, cx, cy) => {
    const scale = Math.min(rect.width / v.w, rect.height / v.w);
    const ox = (rect.width - v.w * scale) / 2;
    const oy = (rect.height - v.w * scale) / 2;
    return { x: v.x + (cx - rect.left - ox) / scale, y: v.y + (cy - rect.top - oy) / scale };
  };

  // Molette : zoom centré curseur
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onW = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setVB((v) => {
        const p = vbPoint(v, rect, e.clientX, e.clientY);
        return zoomAt(v, Math.exp(-e.deltaY * 0.0012), p.x, p.y);
      });
    };
    el.addEventListener("wheel", onW, { passive: false });
    return () => el.removeEventListener("wheel", onW);
  }, []);

  // Route parcourue : un point de trace par tranche de distance parcourue
  // (position ESTIMÉE), plafonné — mémoire locale au client, effaçable.
  useEffect(() => {
    const p = snap.player;
    setTrace((tr) => {
      const last = tr[tr.length - 1];
      if (last && distKm(last[0], last[1], p.estX, p.estY) < TRACE_STEP_KM) return tr;
      const pts = [...tr, [p.estX, p.estY]];
      return pts.length > TRACE_MAX_PTS ? pts.slice(pts.length - TRACE_MAX_PTS) : pts;
    });
  }, [snap]);

  const world = snap.world;
  const player = snap.player;
  const kmOf = (a, b) => distKm(a[0], a[1], b[0], b[1]);

  return (
    <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <h2 className="text-sm font-semibold text-sky-300">Carte de navigation</h2>
      <div className="grid grid-cols-2 gap-2">
        <Btn active={tool === "pin"} onClick={() => { setTool(tool === "pin" ? null : "pin"); setMeasurePend(null); }}>📌 Punaise{tool === "pin" ? " — cliquer la carte" : ""}</Btn>
        <Btn active={tool === "measure"} onClick={() => { setTool(tool === "measure" ? null : "measure"); setMeasurePend(null); }}>📏 Mesure{tool === "measure" ? (measurePend ? " — 2ᵉ point" : " — 1ᵉʳ point") : ""}</Btn>
        <Btn active={planMode} onClick={() => setPlanMode(!planMode)}>🧭 Planificateur{planMode ? " — cliquer la carte" : ""}</Btn>
        <Btn
          active={player.autopilot}
          disabled={player.wpIdx >= (player.waypoints || []).length && !player.autopilot}
          onClick={() => sock.command({ autopilot: !player.autopilot })}
        >🤖 Pilote auto{player.autopilot ? " — ACTIF" : ""}</Btn>
        <Btn onClick={() => setTrace([])} disabled={trace.length === 0}>🧹 Effacer la trace</Btn>
      </div>
      {planMode && (
        <div className="grid grid-cols-2 gap-2">
          <Btn onClick={() => sock.command({ waypoints: player.waypoints.slice(0, -1) })}>🗑 Dernier point</Btn>
          <Btn onClick={() => sock.command({ waypoints: [] })}>🗑 Route entière</Btn>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Btn onClick={() => sock.command({ pins: player.pins.slice(0, -1) })}>🗑 Dernière punaise</Btn>
        <Btn onClick={() => sock.command({ measures: [] })}>🗑 Mesures</Btn>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <Btn className="!px-2.5" onClick={() => setVB((v) => zoomAt(v, 1.5, v.x + v.w / 2, v.y + v.w / 2))}>➕</Btn>
          <Btn className="!px-2.5" onClick={() => setVB((v) => zoomAt(v, 1 / 1.5, v.x + v.w / 2, v.y + v.w / 2))}>➖</Btn>
          <Btn className="!px-2.5" onClick={() => setVB({ x: 0, y: 0, w: MAP_PX })}>⤢</Btn>
        </div>
        <span className="text-xs tabular-nums text-slate-400">Zoom ×{((MAP * S) / vb.w).toFixed(1)}</span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vb.w.toFixed(2)}`}
        className={`w-full rounded-lg ${tool || planMode ? "cursor-crosshair" : "cursor-grab"}`}
        style={{ background: "#8fb4d4", touchAction: "none" }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          ptrs.current[e.pointerId] = { x: e.clientX, y: e.clientY };
          const ids = Object.keys(ptrs.current);
          if (ids.length === 1) {
            drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vb, moved: 0 };
          } else if (ids.length === 2) {
            drag.current = null;
            const [a, b] = Object.values(ptrs.current);
            pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, vb };
          }
        }}
        onPointerMove={(e) => {
          const pt = ptrs.current[e.pointerId];
          if (pt) { pt.x = e.clientX; pt.y = e.clientY; }
          const rect = e.currentTarget.getBoundingClientRect();
          const ids = Object.keys(ptrs.current);
          // Prévisualisation mesure/plan : suit le curseur
          if ((tool === "measure" && measurePend) || planMode) {
            if (!drag.current || drag.current.moved < 5) {
              const hp = vbPoint(vb, rect, e.clientX, e.clientY);
              setHoverPt([hp.x / S, MAP - hp.y / S]);
            }
          }
          if (ids.length >= 2 && pinch.current) {
            // Pincement tactile : zoom centré entre les doigts
            const [a, b] = Object.values(ptrs.current);
            const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const p = vbPoint(pinch.current.vb, rect, (a.x + b.x) / 2, (a.y + b.y) / 2);
            setVB(zoomAt(pinch.current.vb, d / pinch.current.d0, p.x, p.y));
          } else if (drag.current && e.pointerId === drag.current.id) {
            const d = drag.current;
            const scale = Math.min(rect.width / d.vb.w, rect.height / d.vb.w);
            d.moved = Math.max(d.moved, Math.hypot(e.clientX - d.sx, e.clientY - d.sy));
            setVB(clampVB({ x: d.vb.x - (e.clientX - d.sx) / scale, y: d.vb.y - (e.clientY - d.sy) / scale, w: d.vb.w }));
          }
        }}
        onPointerUp={(e) => {
          delete ptrs.current[e.pointerId];
          const d = drag.current;
          drag.current = null;
          // Clic franc (pas un glissement) : outils punaise / mesure
          if (Object.keys(ptrs.current).length > 0 || !d || d.moved > 5 || (!tool && !planMode)) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const p = vbPoint(d.vb, rect, e.clientX, e.clientY);
          const xDeg = p.x / S;
          const yDeg = MAP - p.y / S;
          if (planMode) {
            sock.command({ waypoints: [...(player.waypoints || []), { x: xDeg, y: yDeg }] });
          } else if (tool === "pin") {
            if (player.pins.length < PINS_MAX) {
              sock.command({ pins: [...player.pins, { label: String.fromCharCode(65 + player.pins.length), x: xDeg, y: yDeg }] });
            }
          } else if (tool === "measure") {
            if (!measurePend) {
              setMeasurePend([xDeg, yDeg]);
            } else {
              sock.command({ measures: [...player.measures, { a: measurePend, b: [xDeg, yDeg] }] });
              setMeasurePend(null);
            }
          }
        }}
        onPointerLeave={(e) => { delete ptrs.current[e.pointerId]; }}
      >
        {/* Graticule 5° / 15°, labels flottants */}
        {Array.from({ length: 11 }, (_, k) => (k + 1) * 5).map((d) => (
          <g key={d}>
            <line x1={d * S} y1={0} x2={d * S} y2={MAP_PX} stroke="rgba(15,42,71,0.35)" strokeWidth={d % 15 === 0 ? 1 : 0.5} />
            <line x1={0} y1={MAP_PX - d * S} x2={MAP_PX} y2={MAP_PX - d * S} stroke="rgba(15,42,71,0.35)" strokeWidth={d % 15 === 0 ? 1 : 0.5} />
            <text x={d * S + 2} y={vb.y + 9} fontSize="7" fill="#3d5a75">{d}°E</text>
            <text x={vb.x + 4} y={MAP_PX - d * S - 3} fontSize="7" fill="#3d5a75">{d}°N</text>
          </g>
        ))}
        {/* Terres connues */}
        <polygon points={world.continent.map(([vx, vy]) => `${px(vx)},${py(vy)}`).join(" ")} fill="#d9cba3" stroke="#8a7a55" strokeWidth="1.2" />
        {world.islands.map((verts, idx) => (
          <polygon key={idx} points={verts.map(([vx, vy]) => `${px(vx)},${py(vy)}`).join(" ")} fill="#d9cba3" stroke="#8a7a55" strokeWidth="1.2" />
        ))}
        {world.outposts.map((o, idx) => (
          <g key={idx}>
            <circle cx={px(o.x)} cy={py(o.y)} r={4.5} fill="#7a5c2e" />
            <text x={px(o.x) + 7} y={py(o.y) + 3} fontSize="9" fill="#3d2f14">Poste</text>
          </g>
        ))}
        {/* Zone d'exclusion officielle (avis de la compagnie) : cercle
            pointillé — centre + rayon PUBLIÉS, données absolues comme la
            météo. Le joueur la porte sur sa carte ; à lui de croire ou pas. */}
        {snap.exclusion && (() => {
          const z = snap.exclusion;
          const r = (z.rKm / DEG_KM) * S;
          return (
            <g>
              <circle cx={px(z.x)} cy={py(z.y)} r={r} fill="rgba(180,83,9,0.10)" stroke="#b45309" strokeWidth="1.6" strokeDasharray="8 5" />
              <line x1={px(z.x) - 6} y1={py(z.y)} x2={px(z.x) + 6} y2={py(z.y)} stroke="#b45309" strokeWidth="1.2" />
              <line x1={px(z.x)} y1={py(z.y) - 6} x2={px(z.x)} y2={py(z.y) + 6} stroke="#b45309" strokeWidth="1.2" />
              <text x={px(z.x)} y={py(z.y) - r - 4} fontSize="9" fontWeight="bold" fill="#7c2d12" textAnchor="middle" stroke="#fde68a" strokeWidth="2" paintOrder="stroke">Zone d'exclusion</text>
            </g>
          );
        })()}
        {/* Mesures : segments pointillés + distance */}
        {player.measures.map((m, idx) => {
          const km = Math.round(kmOf(m.a, m.b));
          const mx = (px(m.a[0]) + px(m.b[0])) / 2, my = (py(m.a[1]) + py(m.b[1])) / 2;
          return (
            <g key={idx}>
              <line x1={px(m.a[0])} y1={py(m.a[1])} x2={px(m.b[0])} y2={py(m.b[1])} stroke="#0f2a47" strokeWidth="1.4" strokeDasharray="6 4" />
              <circle cx={px(m.a[0])} cy={py(m.a[1])} r={2.5} fill="#0f2a47" />
              <circle cx={px(m.b[0])} cy={py(m.b[1])} r={2.5} fill="#0f2a47" />
              <text x={mx} y={my - 4} fontSize="11" fill="#0f2a47" fontWeight="bold" textAnchor="middle" stroke="#cfe0f0" strokeWidth="2.5" paintOrder="stroke">{km} km</text>
            </g>
          );
        })}
        {/* 1er point de mesure en attente + prévisualisation live */}
        {measurePend && (
          <g>
            <circle cx={px(measurePend[0])} cy={py(measurePend[1])} r={3} fill="none" stroke="#0f2a47" strokeWidth="1.4" />
            {hoverPt && (
              <g>
                <line x1={px(measurePend[0])} y1={py(measurePend[1])} x2={px(hoverPt[0])} y2={py(hoverPt[1])} stroke="#0f2a47" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.8" />
                <circle cx={px(hoverPt[0])} cy={py(hoverPt[1])} r={2} fill="#0f2a47" opacity="0.6" />
                <text x={(px(measurePend[0]) + px(hoverPt[0])) / 2} y={(py(measurePend[1]) + py(hoverPt[1])) / 2 - 4} fontSize="11" fill="#0f2a47" fontWeight="bold" textAnchor="middle" stroke="#cfe0f0" strokeWidth="2.5" paintOrder="stroke">{Math.round(kmOf(measurePend, hoverPt))} km</text>
              </g>
            )}
          </g>
        )}
        {/* Route du planificateur : segments pointillés + pastilles numérotées */}
        {(player.waypoints || []).length > 0 && (() => {
          const wps = player.waypoints;
          const segs = [];
          // segment navire → 1er point non atteint, puis entre points
          // (px/py pour le rendu, coordonnées degrés pour la distance km)
          const cur = player.wpIdx;
          if (cur < wps.length) {
            segs.push([px(player.estX), py(player.estY), px(wps[cur].x), py(wps[cur].y), player.estX, player.estY, wps[cur].x, wps[cur].y]);
          }
          for (let i = cur; i < wps.length - 1; i++) {
            segs.push([px(wps[i].x), py(wps[i].y), px(wps[i + 1].x), py(wps[i + 1].y), wps[i].x, wps[i].y, wps[i + 1].x, wps[i + 1].y]);
          }
          return (
            <g>
              {segs.map((s, i) => {
                const [x1, y1, x2, y2] = s;
                const km = Math.round(distKm(s[4], s[5], s[6], s[7]));
                return (
                  <g key={"s" + i}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0ea5e9" strokeWidth="1.4" strokeDasharray="6 4" opacity="0.85" />
                    {km > 0 && (
                      <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} fontSize="10" fill="#0369a1" fontWeight="bold" textAnchor="middle" stroke="#cfe0f0" strokeWidth="2.5" paintOrder="stroke">{km} km</text>
                    )}
                  </g>
                );
              })}
              {wps.map((wp, i) => (
                <g key={i}>
                  <circle cx={px(wp.x)} cy={py(wp.y)} r="5.5"
                    fill={i < player.wpIdx ? "#94a3b8" : i === player.wpIdx ? "#0ea5e9" : "#7dd3fc"}
                    stroke="#0c4a6e" strokeWidth="1" />
                  <text x={px(wp.x)} y={py(wp.y) - 7} fontSize="10" fill="#0c4a6e" fontWeight="bold" textAnchor="middle">{i + 1}</text>
                </g>
              ))}
            </g>
          );
        })()}
        {/* Prévisualisation plan : dernier point (ou navire) → curseur */}
        {planMode && hoverPt && (() => {
          const wps = player.waypoints || [];
          const from = wps.length > 0 ? wps[wps.length - 1] : { x: player.estX, y: player.estY };
          return (
            <line x1={px(from.x)} y1={py(from.y)} x2={px(hoverPt[0])} y2={py(hoverPt[1])} stroke="#0ea5e9" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.6" />
          );
        })()}
        {/* Punaises A, B, C... */}
        {player.pins.map((p, idx) => (
          <g key={idx}>
            <circle cx={px(p.x)} cy={py(p.y)} r={2.5} fill="#0f172a" stroke="#000000" strokeWidth="0.8" />
            <text x={px(p.x)} y={py(p.y) - 5} fontSize="9" fill="#000000" fontWeight="bold" textAnchor="middle">{p.label}</text>
          </g>
        ))}
        {/* Route parcourue : pointillés gris (positions estimées, mémoire locale) */}
        {trace.length > 1 && (
          <polyline
            points={trace.map(([tx, ty]) => `${px(tx)},${py(ty)}`).join(" ")}
            fill="none" stroke="#94a3b8" strokeWidth="1.1" strokeDasharray="2 3" opacity="0.55"
          />
        )}
        {/* Faisceau de l'antenne directionnelle : où l'on vise à l'écoute */}
        {(() => {
          const ah = (player.heading + player.antOrient + 720) % 360;
          const hr = (player.antBeam / 2) * Math.PI / 180;
          const L = 30; // longueur visuelle du cône (px)
          return (
            <path
              transform={`translate(${px(player.estX)},${py(player.estY)}) rotate(${ah})`}
              d={`M 0 0 L ${(-L * Math.sin(hr)).toFixed(1)} ${(-L * Math.cos(hr)).toFixed(1)} A ${L} ${L} 0 0 1 ${(L * Math.sin(hr)).toFixed(1)} ${(-L * Math.cos(hr)).toFixed(1)} Z`}
              fill="rgba(192,132,252,0.15)" stroke="rgba(192,132,252,0.45)" strokeWidth="0.8"
            />
          );
        })()}
        {/* Position estimée + incertitude + consigne de cap */}
        <circle cx={px(player.estX)} cy={py(player.estY)} r={Math.max(1.2, (player.unc / DEG_KM) * S)} fill="rgba(220,38,38,0.18)" stroke="#dc2626" strokeWidth="0.8" />
        <circle cx={px(player.estX)} cy={py(player.estY)} r={2} fill="#dc2626" />
        <line x1={px(player.estX)} y1={py(player.estY)} x2={px(player.estX) + Math.sin((player.headingOrder * Math.PI) / 180) * 16} y2={py(player.estY) - Math.cos((player.headingOrder * Math.PI) / 180) * 16} stroke="#dc2626" strokeWidth="1.2" />
      </svg>
      <p className="text-[11px] leading-snug text-slate-500">
        Terres et avant-postes connus · 🔴 position estimée — cercle = incertitude, échelle exacte · trait rouge = consigne de cap · cône violet = visée de l'antenne · pointillés gris = route parcourue (estimée) · molette/pincement : zoom (×1–×8) · glisser : déplacer
        {snap.exclusion && " · ⚠️ zone d'exclusion officielle (advisory)"}
        {player.pins.length > 0 && ` · 📌 ${player.pins.map((p) => `${p.label} ${p.y.toFixed(1)}°N ${p.x.toFixed(1)}°E`).join(" · ")}`}
      </p>
    </div>
  );
}

// Minutes à simuler pour atteindre la prochaine heure cible (0-23) du jeu.
// L'aube = 6 h, le jour = 8 h, le crépuscule = 18 h, la nuit = 20 h.
function nextPhase(tMin, targetHour) {
  const cur = tMin / 60;
  let delta = (targetHour - (cur % 24) + 24) % 24;
  if (delta < 0.1) delta = 24; // déjà pile à la cible : saut au prochain cycle
  return delta * 60;
}

// ---------- Tuile Sonar (écoute passive continue + ping actif au clic) ----------
// AUCUN RETOUR TEXTUEL : les bruits (moteur, ping d'un autre navire) sont des
// icônes au bord du cercle — GISEMENT SEUL, aucune distance. Les échos du
// ping sont des FORMES en gisement + distance, affichées
// SONAR_ECHO_PERSIST_S secondes. Le ping est disponible en plongée
// uniquement ; tout rebondit, sauf un navire immergé.
function SonarTile({ snap, cmd }) {
  const p = snap.player;
  const sonar = snap.sonar || { passive: [], echoes: [] };
  const uw = p.location === "underwater";
  const RMAX = Math.max(...Object.values(SONAR_RANGE_KM)); // portée max du ping (par type d'écho)
  const R = 96; // rayon du disque (viewBox 200) — le bord = RMAX
  const kmPx = (km) => (Math.min(km, RMAX) / RMAX) * (R - 8);
  const pos = (az, r) => {
    const a = (az * Math.PI) / 180;
    return [100 + Math.sin(a) * r, 100 - Math.cos(a) * r];
  };
  const ECHO_COLOR = { ile: "#2dd4bf", balise: "#facc15", navire: "#22d3ee", cote: "#94a3b8", biologique: "#34d399" };
  const ECHO_SHAPE = { ile: "triangle", balise: "diamond", navire: "round", cote: "arc", biologique: "ring" };
  return (
    <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <h2 className="text-sm font-semibold text-sky-300">Sonar</h2>
      <svg viewBox="0 0 200 200" className="mx-auto w-full max-w-[280px]">
        <circle cx="100" cy="100" r={R} fill="#04121a" stroke="#334155" strokeWidth="1.5" />
        {[0.25, 0.5, 0.75].map((f) => (
          <circle key={f} cx="100" cy="100" r={R * f} fill="none" stroke="#1e293b" strokeWidth="0.7" />
        ))}
        <line x1={100 - R} y1="100" x2={100 + R} y2="100" stroke="#1e293b" strokeWidth="0.7" />
        <line x1="100" y1={100 - R} x2="100" y2={100 + R} stroke="#1e293b" strokeWidth="0.7" />
        <text x="100" y="9" fontSize="7" fill="#64748b" textAnchor="middle">0°</text>
        <text x="192" y="103" fontSize="7" fill="#64748b" textAnchor="middle">90°</text>
        <text x="100" y="197" fontSize="7" fill="#64748b" textAnchor="middle">180°</text>
        <text x="8" y="103" fontSize="7" fill="#64748b" textAnchor="middle">270°</text>
        {/* Écoute passive : icônes au bord — gisement seul, opacité = force */}
        {sonar.passive.map((s, i) => {
          const [x, y] = pos(s.bearing, R - 9);
          return (
            <g key={`p${i}`} opacity={Math.max(0.25, s.strength / 100)}>
              {s.kind === "moteur" && (
                <circle cx={x} cy={y} r="4" fill="none" stroke="#f97316" strokeWidth="1.4" />
              )}
              {s.kind === "ping" && (
                <path d={`M ${x - 4} ${y - 4} L ${x + 4} ${y + 4} M ${x + 4} ${y - 4} L ${x - 4} ${y + 4}`} stroke="#a855f7" strokeWidth="1.6" />
              )}
              {s.kind === "biologique" && (
                <path d={`M ${x - 4.5} ${y + 1.5} q 2.25 -4 4.5 0 q 2.25 4 4.5 0`} stroke="#34d399" strokeWidth="1.6" fill="none" />
              )}
              {s.kind === "canon" && (
                <path d={`M ${x - 4} ${y} L ${x + 4} ${y} M ${x} ${y - 4} L ${x} ${y + 4} M ${x - 3} ${y - 3} L ${x + 3} ${y + 3} M ${x + 3} ${y - 3} L ${x - 3} ${y + 3}`} stroke="#fb923c" strokeWidth="1.5" />
              )}
              {s.kind === "inconnu" && (
                <path d={`M ${x - 5} ${y + 1} l 2 -3 l 1.5 3 l 2 -4 l 1.5 4 l 2 -2`} fill="none" stroke="#f8fafc" strokeWidth="1.5" />
              )}
            </g>
          );
        })}
        {/* Échos du ping : formes en gisement + distance, affichées 10 s */}
        {sonar.echoes.map((e, i) => {
          const [x, y] = pos(e.az, kmPx(e.distKm));
          const col = ECHO_COLOR[e.kind] || "#94a3b8";
          const fade = Math.max(0.15, 1 - e.ageS / SONAR_ECHO_PERSIST_S);
          const shape = ECHO_SHAPE[e.kind];
          return (
            <g key={`e${i}`} opacity={fade} fill={col} stroke={col}>
              {shape === "round" && <circle cx={x} cy={y} r="3.5" fill={col} />}
              {shape === "ring" && <circle cx={x} cy={y} r="3.5" fill="none" strokeWidth="1.6" />}
              {shape === "diamond" && <rect x={x - 3.5} y={y - 3.5} width="7" height="7" transform={`rotate(45 ${x} ${y})`} fill={col} />}
              {shape === "triangle" && <path d={`M ${x} ${y - 4} L ${x + 3.8} ${y + 3} L ${x - 3.8} ${y + 3} Z`} fill={col} />}
              {shape === "arc" && (() => {
                const [x0, y0] = pos(e.az - 12, R - 4);
                const [x1, y1] = pos(e.az + 12, R - 4);
                return <path d={`M ${x0} ${y0} A ${R - 4} ${R - 4} 0 0 1 ${x1} ${y1}`} fill="none" strokeWidth="3" />;
              })()}

            </g>
          );
        })}
        {/* Navire au centre, orienté au cap — même convention que TopView :
            le cadran reste nord en haut, le pictogramme pivote au cap réel. */}
        <path d="M 0 -7 L 5 6 L -5 6 Z" transform={`translate(100 100) rotate(${p.heading})`} fill="#38bdf8" stroke="#e0f2fe" strokeWidth="0.7" />
        <text x="100" y="188" fontSize="6.5" fill="#475569" textAnchor="middle">
          cercle = {RMAX} km · portées par type
        </text>
      </svg>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
          <span><span className="text-orange-400">◯</span> moteur (passif)</span>
          <span><span className="text-purple-400">✕</span> ping d'un autre (passif)</span>
          <span><span className="text-emerald-300">∿</span> chant de baleine (passif)</span>
          <span><span className="text-slate-100">⌇</span> son inconnu</span>
          <span><span className="text-orange-300">✳</span> canon (tirs lointains)</span>
          <span><span className="text-teal-300">▲</span> île</span>
          <span><span className="text-yellow-300">◆</span> balise</span>
          <span><span className="text-cyan-300">●</span> navire</span>
          <span><span className="text-emerald-300">◯</span> baleine</span>
          <span><span className="text-slate-400">◡</span> côte</span>
        </div>
        <button
          disabled={!uw || p.battery < SONAR_PING_BATTERY_COST}
          onClick={() => cmd({ ping: true })}
          className={`w-full rounded-lg py-2 text-sm font-bold transition-colors ${uw && p.battery >= SONAR_PING_BATTERY_COST ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400" : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}
        >
          🔊 PING — {SONAR_PING_BATTERY_COST} % de batterie</button>
        <p className="text-[11px] leading-snug text-slate-500">
          Écoute passive continue : gisement des bruits uniquement, aucune distance. Le ping révèle gisement + distance de tout ce qui traîne — sauf un navire immergé. Vos pings sont audibles par les autres jusqu'à {SOUND_DECAY_KM.ping} km. La terre coupe le son : une île ou la côte masque une source.
          {!uw && " Sonar actif disponible en plongée uniquement."}
        </p>
      </div>
    </div>
  );
}

// ---------- Application principale ----------
export default function App() {
  const [session, setSession] = useState(null);
  const [snap, setSnap] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [logFilter, setLogFilter] = useState("tout");
  const sockRef = useRef(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [wxOpen, setWxOpen] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [dial, setDial] = useState("");
  const [radioMode, setRadioMode] = useState("prive"); // prive | diffusion
  const [wxH, setWxH] = useState(0);
  const [wxData, setWxData] = useState(null);

  // Prévisions météo (à quai) : grille 2° à J+h, recalculée quand le curseur bouge.
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
  const weather = snap?.weather;
  // Heure de jeu : la vraie heure de Paris dérivée de l'epoch + minutes de jeu
  const hour = snap ? ((new Date(snap.epoch + snap.t * MS_PER_MIN).getHours() + new Date(snap.epoch + snap.t * MS_PER_MIN).getMinutes() / 60)) : 12;
  const daylight = hour >= 6 && hour < 20;
  const cmd = (data) => sock && sock.command(data);

  if (!session) return <Login onLogin={setSession} />;
  if (!snap) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-400">Connexion au serveur… ({status})</p>
      </div>
    );
  }

  const logNotifs = (player.notifications || []).filter((n) => logFilter === "tout" || n.cat === logFilter);
  const uw = player.location === "underwater";
  const atDock = player.location === "surface" &&
    (distKm(player.estX, player.estY, snap.world.port.x, snap.world.port.y) < DELIVERY_R_KM ||
    snap.world.outposts.some((o) => distKm(player.estX, player.estY, o.x, o.y) < DELIVERY_R_KM));
  const radioOk = (player.location === "surface" || (player.location === "underwater" && player.periscope)) && player.battery > 0;
  const antHeading = (player.heading + player.antOrient + 720) % 360;

  return (
    <div className="min-h-screen p-3 text-slate-100 sm:p-4">
      {/* Scène d'ambiance animée : ciel, soleil, nuages, pluie, mer, immersion */}
      {snap && <Scene hour={hour} weather={weather} underwater={player.location === "underwater"} />}
      {/* Contenu : au-dessus de la scène (z-10 + position) */}
      <div className="relative z-10">
      {/* En-tête */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
        <div>
          <h1 className="text-xl font-semibold">⚓ Pacific Chase</h1>
          <p className="text-xs text-slate-400">
            {daylight ? "☀️ Jour" : "🌙 Nuit"} · {fmtT(snap.t, snap.epoch)} (heure de Paris) · Score : <span className="font-semibold text-sky-300">{player.score} pts</span> · Codes à bord : {player.codes.length} · Balises restantes : {snap.world.activeBeaconIds.length}/{snap.world.beaconCount}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${status === "connected" ? "text-emerald-300" : "text-amber-300"}`}>
            {status === "connected" ? "● connecté" : "● reconnexion…"}
          </span>
          <Btn onClick={() => setManualOpen(true)}>📖 Manuel</Btn>
        </div>
      </div>

      {/* Boîte à outils super utilisateur : accélération et sauts de temps */}
      {snap.isSuper && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-700/60 bg-amber-900/30 p-3">
          <span className="text-xs font-semibold text-amber-200">⭐ Outils super user — temps :</span>
          <Btn onClick={() => cmd({ timeSkipMin: 60 })}>⏩ +1 h</Btn>
          <Btn onClick={() => cmd({ timeSkipMin: 360 })}>⏩ +6 h</Btn>
          <Btn onClick={() => cmd({ timeSkipMin: Math.round(nextPhase(snap.t, 6)) })}>🌅 Aube</Btn>
          <Btn onClick={() => cmd({ timeSkipMin: Math.round(nextPhase(snap.t, 8)) })}>☀️ Jour</Btn>
          <Btn onClick={() => cmd({ timeSkipMin: Math.round(nextPhase(snap.t, 18)) })}>🌇 Crépuscule</Btn>
          <Btn onClick={() => cmd({ timeSkipMin: Math.round(nextPhase(snap.t, 20)) })}>🌙 Nuit</Btn>
          <span className="mx-1 text-amber-700">|</span>
          <Btn className="!bg-rose-900/70 hover:!bg-rose-800" onClick={() => { if (confirm("Réinitialiser la course ? Nouveau monde, nouvelles balises, tous les navires à quai, scores remis à zéro. Irréversible.")) cmd({ resetRace: true }); }}>🔄 Reset course</Btn>
          <span className="text-[11px] text-amber-200/60">Sauts : la simulation est rejouée minute par minute. Après un saut, l'heure affichée avance devant l'heure de Paris (le jeu vit plus vite) — le bouton Reset re-synchronise sur Paris.</span>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Navire + vue de dessus */}
        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
          <h2 className="text-sm font-semibold text-sky-300">Navire <span className="font-mono text-sky-200">{player.code}</span></h2>
          {(atDock || snap.networkZone) && (
            <div className="grid grid-cols-2 gap-2">
              {atDock && <Btn active onClick={() => setShopOpen(true)}>🛒 Avitaillement</Btn>}
              {snap.networkZone && <Btn active onClick={() => setNetOpen(true)}>🌐 NETWORK</Btn>}
            </div>
          )}
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Vue de dessus — horizon 20 km</p>
          <TopView snap={snap} />
          <p className="text-[11px] text-slate-500">
            {uw && !player.periscope && "🕳️ Périscope rentré : aucune observation visuelle · "}
            {!daylight && "🌙 Nuit : seuls les feux sont visibles · "}
            Antenne : direction d'écoute {Math.round(antHeading)}°, ouverture {player.antBeam}°
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Btn active={player.location === "surface"} onClick={() => cmd({ surface: true })}>☀️ Surface</Btn>
            <Btn active={uw} onClick={() => cmd({ dive: true })}>🌊 Plongée</Btn>
          </div>
          {player.location === "surface" ? (
            <div className="grid grid-cols-2 gap-2">
              <Btn active={player.mast} onClick={() => cmd({ mast: !player.mast })}>⛵ Mât</Btn>
              <Btn active={player.engineOn} onClick={() => cmd({ engineOn: !player.engineOn })}>🚤 Moteur</Btn>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Btn active={player.electricOn} onClick={() => cmd({ electricOn: !player.electricOn })}>🔋 Électrique</Btn>
              <Btn active={player.periscope} onClick={() => cmd({ periscope: !player.periscope })}>🔭 Périscope</Btn>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Btn active={player.light} onClick={() => cmd({ light: !player.light })}>💡 Phare{player.light ? " — visible la nuit à 10 km" : ""}</Btn>
            <Btn active={player.anchored} onClick={() => cmd({ anchor: !player.anchored })}>⚓ Ancre{player.anchored ? " — position figée" : ""}</Btn>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={() => cmd({ capture: true })}>📦 Capturer la balise (≤ 500 m)</Btn>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Cap</span>
            {player.autopilot && <span className="rounded bg-sky-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200">🤖 pilotage automatique</span>}
            {player.beaconLock && <span className="rounded bg-purple-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-purple-200">🔒 Verrou : balise {player.beaconLock}</span>}
            <Btn disabled={player.autopilot || !!player.beaconLock} onClick={() => cmd({ headingOrder: player.headingOrder - 10 })}>◀</Btn>
            <input
              type="range" min={0} max={359} value={Math.round(player.headingOrder)}
              disabled={player.autopilot || !!player.beaconLock}
              onChange={(e) => cmd({ headingOrder: +e.target.value })}
              className="w-full accent-sky-400"
            />
            <Btn disabled={player.autopilot || !!player.beaconLock} onClick={() => cmd({ headingOrder: player.headingOrder + 10 })}>▶</Btn>
            <span className="w-14 text-right text-xs tabular-nums text-sky-300">{Math.round(player.heading)}°</span>
          </div>
          {Math.abs(((player.headingOrder - player.heading + 540) % 360) - 180) > 2 && (
            <p className="text-[11px] text-amber-300">
              🧭 en virage — consigne {Math.round(player.headingOrder)}° (écart {Math.round(((player.headingOrder - player.heading + 540) % 360) - 180)}°)
            </p>
          ) || (
            <p className="text-[11px] text-slate-500">Cap stable — consigne {Math.round(player.headingOrder)}°</p>
          )}
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-slate-400">Voile</span>
            <input
              type="range" min={0} max={100} value={Math.round((player.sail ?? SAIL_DEFAULT) * 100)}
              onChange={(e) => cmd({ sail: +e.target.value / 100 })}
              className="w-full accent-sky-400"
            />
            <span className="w-12 text-right text-xs tabular-nums text-sky-300">{Math.round((player.sail ?? SAIL_DEFAULT) * 100)}%</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Inclinaison auto — boom {Math.round(player.boom)}° · vent apparent {Math.round(player.awSpd)} km/h {player.awRel >= 0 ? "T" : "B"}
          </p>
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-slate-400">Moteur</span>
            <input
              type="range" min={0} max={100} value={Math.round(player.engine * 100)}
              onChange={(e) => cmd({ engine: +e.target.value / 100 })}
              className="w-full accent-sky-400"
            />
            <span className="w-12 text-right text-xs tabular-nums text-sky-300">{Math.round(player.engine * 100)}%</span>
          </div>
          <p className="text-xs text-slate-400">
            Vitesse (eau) : <b className="text-sky-300">{player.vkmh.toFixed(1)} km/h</b>
            {player.grounded && <span className="ml-2 text-rose-300">⚠️ échouement — changez de cap</span>}
            {player.collided && <span className="ml-2 text-rose-300">💥 collision — écartez-vous</span>}
          </p>
          <div className="space-y-1.5">
            <Bar label="⛽ Carburant" value={player.fuel} color="#fb923c" />
            <Bar label="🔋 Batteries" value={player.battery} color="#4ade80" />
            <Bar label="🍲 Vivres" value={player.food} color="#e879f9" />
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-sky-900/60 bg-slate-900/70 p-2.5">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Position estimée</p>
              <p className="text-sm font-bold tabular-nums">{player.estY.toFixed(2)}° N · {player.estX.toFixed(2)}° E</p>
              <p className="text-[10px] text-purple-300">{player.navFixActive ? "🔭 point en cours" : "\u00a0"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Incertitude</p>
              <p className={`text-sm font-bold tabular-nums ${player.unc > 28 ? "text-amber-300" : player.unc > 13 ? "text-sky-300" : "text-emerald-300"}`}>± {player.unc.toFixed(1)} km</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Distance</p>
              <p className="text-sm font-bold tabular-nums">{Math.round(player.travelledKm)} km</p>
              <p className="text-[10px] text-slate-500">aujourd'hui : {Math.round(player.dailyKm)} km</p>
            </div>
          </div>
        </div>

        {/* Carte de navigation : côte à côte avec le navire (PC) */}
        <NavMap snap={snap} sock={sock} />

      </div>

      {/* Météo + radio + journal : en dessous, pleine largeur */}
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="space-y-4">
          <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
            <h2 className="text-sm font-semibold text-sky-300">Météo</h2>
            <p className="text-xs text-slate-300">Situation : <b className="text-sky-200">{weather.name}</b></p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span>💨 Vent : <b>{weather.windSpd.toFixed(1)} km/h</b> <DirArrow deg={(weather.windDir + 180) % 360} color="#93c5fd" /> <b>{weather.windDir}°</b></span>
              <span>🌊 Courant : <b>{weather.curSpd.toFixed(1)} km/h</b> <DirArrow deg={weather.curDir} color="#5eead4" /> <b>{weather.curDir}°</b></span>
              <span>☁️ Nuages : <b>{weather.clouds}%</b></span>
              <span>🌡️ Temp. : <b>{weather.temp}°C</b></span>
              <span>👁️ Visibilité : <b>{weather.visibility.toFixed(1)} km</b></span>
              <span>🌊 Houle : <b>{weather.hs} m</b> · {DOUGLAS_LABEL[weather.douglas]} (Douglas {weather.douglas})</span>
            </div>
            {weather.storm && <p className="rounded bg-rose-900/50 px-2 py-1 text-xs text-rose-200">⚡ TEMPÊTE</p>}
            {weather.fog && <p className="rounded bg-amber-900/50 px-2 py-1 text-xs text-amber-200">🌫️ Brouillard dense</p>}
          </div>

          <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
            <h2 className="text-sm font-semibold text-sky-300">Radio</h2>
            <div className="flex items-center gap-2">
              <span className="w-24 text-xs text-slate-400">Ouverture</span>
              <input
                type="range" min={1} max={180} value={player.antBeam}
                onChange={(e) => cmd({ antBeam: +e.target.value })}
                className="w-full accent-purple-400"
              />
              <span className="w-10 text-right text-xs tabular-nums text-purple-300">{player.antBeam}°</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-24 text-xs text-slate-400">Orientation</span>
              <input
                type="range" min={-180} max={180} value={player.antOrient}
                onChange={(e) => cmd({ antOrient: +e.target.value })}
                className="w-full accent-purple-400"
              />
              <span className="w-10 text-right text-xs tabular-nums text-purple-300">{player.antOrient}°</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Émission : omnidirectionnelle, {LONG_DECAY_KM} km. Écoute : omni dès {OMNI_DETECT_PCT} % (sans gisement) ; faisceau serré = sensible et pointé, large = sourd et panoramique.
            </p>
            <p className="text-[11px] text-slate-400">
              Code du navire : <b className="font-mono text-sm text-sky-300">{player.code}</b> — c'est votre numéro radio (donnez-le aux autres navires pour qu'ils vous appellent).
            </p>
            {/* Autoguidage balise-vigie : 4 positions, Aucun par défaut, filtre à l'engagement */}
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Autoguidage balise-vigie — verrouillage sur</p>
              <div className="flex gap-1.5">
                {AUTOGUIDE_MODES.map((m) => (
                  <Btn key={m} active={(player.autoguide || AUTOGUIDE_DEFAULT) === m} onClick={() => cmd({ autoguide: m })}>{AUTOGUIDE_LABEL[m]}</Btn>
                ))}
              </div>
              <p className="text-[11px] leading-snug text-slate-500">
                Par défaut <b>Aucun</b> : aucun verrouillage automatique. Sinon, le verrou s'engage uniquement sur les balises choisies — <b>Actives</b> (non capturées), <b>Déjà capturées</b> ou <b>Toutes</b>. Le journal des signaux reste complet ; une consigne de cap coupe toujours le verrou.
              </p>
            </div>
            {(player.signals || []).length > 0 && (() => {
              // Journal GROUPÉ PAR STATION : une ligne vivante par station
              // (dernier signal + compteur), pas une ligne par ping — à quai
              // la même balise pulse toutes les 10–14 s et le journal ne
              // devait plus afficher QUE elle.
              const by = new Map();
              for (const sg of [...player.signals].reverse()) {
                const cur = by.get(sg.beaconId);
                if (cur) cur.n++;
                else by.set(sg.beaconId, { sg, n: 1 });
              }
              return (
                <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-2">
                  <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Journal des signaux (par station)</p>
                  <div className="space-y-0.5">
                    {[...by.entries()].map(([code, e]) => (
                      <p key={code} className={`text-[10px] leading-snug tabular-nums ${e.sg.kind === "prox" ? "text-purple-300" : "text-slate-400"}`}>
                        {e.sg.kind === "prox" ? "⚡" : "📡"} {code}{e.sg.off ? " (balise désactivée)" : ""} — signal {e.sg.strength}%{e.sg.side ? `, zone ${e.sg.side}` : ""}{e.n > 1 ? ` · ×${e.n}` : ""}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })()}
            {/* Mode radio : privé (appels) ou diffusion (SOS) */}
            <div className="flex gap-1.5">
              <Btn active={radioMode === "prive"} onClick={() => setRadioMode("prive")}>🔒 Privé — appels</Btn>
              <Btn active={radioMode === "diffusion"} onClick={() => setRadioMode("diffusion")}>📢 Diffusion — SOS</Btn>
            </div>
            {radioMode === "prive" ? (
              <VhfKeypad
                dialed={dial}
                onDial={setDial}
                onAction={(kind, code) => cmd({ shipMsg: { kind, to: code } })}
                radioOk={radioOk}
                portee={Math.round(LONG_DECAY_KM * (1 - dirSensitivity(player.antBeam) / 100))}
              />
            ) : (
              <div className="space-y-2">
                <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/40 p-3">
                  <p className="mb-2 text-[11px] leading-snug text-emerald-200/80">
                    « Ma position » en <b>diffusion</b> : tous les navires à portée lisent votre position <b>estimée</b> et son incertitude.
                  </p>
                  <button
                    disabled={!radioOk}
                    onClick={() => cmd({ shipMsg: { kind: "mypos" } })}
                    className={`w-full rounded-lg py-2 text-sm font-bold transition-colors ${radioOk ? "bg-emerald-600 text-white hover:bg-emerald-500" : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}
                  >📍 Diffuser ma position (0,5 %)</button>
                </div>
                <div className="rounded-xl border border-rose-800/60 bg-rose-950/40 p-3">
                  <p className="mb-2 text-[11px] leading-snug text-rose-200/80">
                    <b>SOS</b> en diffusion générale : tous les navires à portée le lisent, avec votre position <b>estimée</b>.
                  </p>
                  <button
                    disabled={!radioOk}
                    onClick={() => cmd({ sos: true })}
                    className={`w-full rounded-lg py-2 text-sm font-bold transition-colors ${radioOk ? "bg-rose-600 text-white hover:bg-rose-500" : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}
                  >🆘 Émettre un SOS (0,5 %)</button>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
            <h2 className="text-sm font-semibold text-sky-300">Journal de bord</h2>
            <div className="flex flex-wrap gap-1">
              {[
                { id: "tout", label: "📋 Tout" }, { id: "navire", label: "⚙️ Navire" },
                { id: "nav", label: "🔭 Nav" }, { id: "meteo", label: "🌦️ Météo" },
                { id: "vision", label: "👁️ Vision" }, { id: "radio", label: "📡 Radio" },
                { id: "sonar", label: "🔊 Sonar" },
                { id: "balises", label: "📦 Balises" }, { id: "alertes", label: "⚠️ Alertes" },
              ].map((c) => (
                <button
                  key={c.id} onClick={() => setLogFilter(c.id)}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${logFilter === c.id ? "bg-sky-500 text-slate-950" : "bg-slate-700/70 text-slate-300"}`}
                >{c.label}</button>
              ))}
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {logNotifs.length === 0 ? (
                <p className="text-xs text-slate-500">Rien à signaler.</p>
              ) : logNotifs.map((n) => (
                <p key={n.id} className={`text-[11px] leading-snug ${n.kind === "good" ? "text-emerald-300" : n.kind === "warn" ? "text-amber-300" : n.kind === "bad" ? "text-rose-300" : "text-slate-300"}`}>
                  <span className="mr-1 tabular-nums text-slate-500">{fmtT(n.t, snap.epoch)}</span>{n.text}
                </p>
              ))}
            </div>
          </div>
        </div>
        {/* Sonar : hydrophone passif continu + ping actif au clic — deuxième colonne */}
        <SonarTile snap={snap} cmd={cmd} />
      </div>

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
                <Btn active onClick={() => cmd({ network: true })}>Se connecter au NETWORK</Btn>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border border-emerald-800/60 bg-emerald-950/30 p-3">
                <p className="text-xs text-emerald-300">● Connecté — accès au réseau météo et au journal global.</p>
                <Btn active onClick={() => { setWxOpen(true); setWxH(0); }}>🌤️ Afficher la météo (48 h)</Btn>
              </div>
            )}
            {(snap.networkLog || []).length > 0 && (
              <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-2">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Journal global — connexions ({snap.networkLog.length})</p>
                <div className="max-h-56 space-y-0.5 overflow-y-auto">
                  {[...snap.networkLog].reverse().map((e, i) => (
                    <p key={i} className="text-[10px] leading-snug tabular-nums text-slate-400">
                      {fmtT(e.t, snap.epoch)} · {e.who} (navire {e.code}) — {e.place.kind === "port" ? "au port" : e.place.kind === "avant-poste" ? `à l'avant-poste ${e.place.id + 1}` : `à la balise ${e.place.id} (code ${e.place.code})`}
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
            <Btn onClick={() => setNetOpen(false)}>Reprendre la navigation</Btn>
          </div>
        </div>
      )}

      {/* Prévisions météo (via NETWORK) */}
      {wxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setWxOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-sky-300">🌤️ Prévisions météo — NETWORK</h2>
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
              <circle cx={snap.world.port.x * 10} cy={(MAP - snap.world.port.y) * 10} r={5} fill="#34d399" />
              {snap.world.outposts.map((o, i) => <circle key={i} cx={o.x * 10} cy={(MAP - o.y) * 10} r={4} fill="#34d399" />)}
              <circle cx={snap.player.estX * 10} cy={(MAP - snap.player.estY) * 10} r={7} fill="none" stroke="#f8fafc" strokeWidth="2" />
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
            <Btn onClick={() => setWxOpen(false)}>Reprendre la navigation</Btn>
          </div>
        </div>
      )}

      {/* Avitaillement */}
      {shopOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShopOpen(false)}>
          <div className="w-full max-w-sm space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-sky-300">🛒 Avitaillement</h2>
            <p className="text-xs text-slate-400">Navire à quai : plein de carburant et de vivres.</p>
            <Btn active onClick={() => { cmd({ refuel: true }); setShopOpen(false); }}>✅ Plein complet</Btn>
            <Btn onClick={() => setShopOpen(false)}>Reprendre la mer</Btn>
          </div>
        </div>
      )}

      {/* Manuel du jeu : ouvert à tout moment depuis l'en-tête */}
      {manualOpen && <Manual onClose={() => setManualOpen(false)} />}
      </div>
    </div>
  );
}
