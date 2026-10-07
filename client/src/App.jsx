import React, { useEffect, useMemo, useRef, useState } from "react";
import { login, GameSocket } from "./net.js";
import Scene from "./Scene.jsx";
import {
  MAP, KM_PER_DEG, KM_PER_NM, DEG_NM, RARITY_STYLE,
  distNm, dirSensitivity, DOUGLAS_LABEL,
} from "../../shared/engine.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mixHex = (a, b, t) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
};
const fmtT = (t, epoch) => {
  // Heure de jeu affichée = vraie heure de Paris (epoch + minutes de jeu).
  const d = new Date((epoch || 0) + t * 60000);
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
        <p className="text-xs text-slate-400">Course nautique temps réel — connectez-vous pour reprendre la mer.</p>
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
  const R = 20; // horizon km
  const P = 100 / R; // px par km
  const night = view.night;
  const heading = player.heading;
  // Position des objets relatifs à l'estimé : le serveur donne az/km depuis
  // la vraie position ; on les projette depuis le centre (l'erreur de
  // projection est incluse dans l'incertitude de l'estime).
  const proj = (az, km) => {
    const r = Math.min(km, 96) * P / 1; // clamp au bord du cercle
    const a = (az * Math.PI) / 180;
    return [100 + Math.sin(a) * Math.min(km, R + 30) * P / 1, 100 - Math.cos(a) * Math.min(km, R + 30) * P / 1];
  };
  const visF = clamp(view.visKm / R, 0, 1);
  const hr = (player.antBeam / 2) * Math.PI / 180;
  const antHeading = view.antHeading;
  const wrad = (view.windDir * Math.PI) / 180;
  const wax = 100 + Math.sin(wrad) * 91, way = 100 - Math.cos(wrad) * 91;
  const wbx = 100 + Math.sin(wrad) * 67, wby = 100 - Math.cos(wrad) * 67;
  const wux = (wbx - wax) / 24, wuy = (wby - way) / 24;
  return (
    <svg viewBox="0 0 200 200" className="mx-auto w-full max-w-[240px]">
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
        {/* Côte du continent (dessinée à l'échelle autour de l'estimé) */}
        {view.coast && view.continentVerts && (() => {
          const kx = (x) => 100 + (x - snap.player.estX) * KM_PER_DEG * (100 / R);
          const ky = (y) => 100 - (y - snap.player.estY) * KM_PER_DEG * (100 / R);
          return (
            <polygon
              points={view.continentVerts.map(([vx, vy]) => `${kx(vx).toFixed(1)},${ky(vy).toFixed(1)}`).join(" ")}
              fill={night ? "#0a1f16" : "#1c3a2a"} stroke={night ? "#1f4d38" : "#2f5c43"}
            />
          );
        })()}
        {/* Objets détectés : dans l'horizon = forme, au-delà = indicateur bord */}
        {view.islands.map((e, idx) => e.beyond ? null : (
          <circle key={idx} cx={proj(e.az, e.km)[0]} cy={proj(e.az, e.km)[1]} r="10"
            fill={night ? "#0a1f16" : "#1c3a2a"} stroke={night ? "#1f4d38" : "#2f5c43"} />
        ))}
        {view.port && !view.port.beyond && (
          <g>
            <circle cx={proj(view.port.az, view.port.km)[0]} cy={proj(view.port.az, view.port.km)[1]} r={night ? 3 : 6} fill="#f8fafc" />
            {!night && <text x={proj(view.port.az, view.port.km)[0]} y={proj(view.port.az, view.port.km)[1] - 9} fontSize="8" fill="#f8fafc" textAnchor="middle">Port</text>}
          </g>
        )}
        {view.outposts.map((e) => e.beyond ? null : (
          <g key={e.idx}>
            <circle cx={proj(e.az, e.km)[0]} cy={proj(e.az, e.km)[1]} r={night ? 2.2 : 4} fill="#e2e8f0" />
          </g>
        ))}
        {view.beacons.map((e) => e.beyond ? null : (
          <g key={e.id}>
            {night
              ? <circle cx={proj(e.az, e.km)[0]} cy={proj(e.az, e.km)[1]} r="2.5" fill="#f8fafc" />
              : <circle cx={proj(e.az, e.km)[0]} cy={proj(e.az, e.km)[1]} r="4" fill={RARITY_STYLE[e.rarity].color} />}
          </g>
        ))}
        {/* Brume : voile gris au-delà de la visibilité */}
        {view.visKm < R - 0.3 && (
          <g>
            <rect x="0" y="0" width="200" height="200" fill="url(#visGrad2)" />
            <circle cx="100" cy="100" r={Math.min(R, view.visKm) * P} fill="none" stroke="rgba(203,213,225,0.45)" strokeDasharray="2 3" />
          </g>
        )}
        {/* Vent */}
        <g>
          <line x1={wax} y1={way} x2={wbx - wux * 5} y2={wby - wuy * 5} stroke="#06263f" strokeWidth="3.6" strokeLinecap="round" />
          <line x1={wax} y1={way} x2={wbx - wux * 5} y2={wby - wuy * 5} stroke="#93c5fd" strokeWidth="1.7" />
          <polygon points={`${wbx},${wby} ${wbx - wux * 9 + wuy * 5},${wby - wuy * 9 - wux * 5} ${wbx - wux * 9 - wuy * 5},${wby - wuy * 9 + wux * 5}`} fill="#93c5fd" stroke="#06263f" strokeWidth="1.2" />
        </g>
        {/* Navires détectés : marqueurs (azimut/distance), feu si phare la nuit */}
        {(snap.ships || []).filter((s) => s.km <= R).map((s) => {
          const sx = proj(s.az, s.km)[0], sy = proj(s.az, s.km)[1];
          return (
            <g key={s.id}>
              <circle cx={sx} cy={sy} r={view.night ? (s.light ? 3 : 2.2) : 3.5}
                fill={view.night ? (s.light ? "#fde68a" : "#94a3b8") : "#f1f5f9"}
                stroke="#475569" strokeWidth="0.6" />
              <text x={sx} y={sy - 6} fontSize="6" fill="#cbd5e1" textAnchor="middle">{s.id.slice(0, 4)} · {Math.round(s.km)} km</text>
            </g>
          );
        })}
        {(snap.ships || []).filter((s) => s.km > R).map((s) => (
          <g key={"b" + s.id}>
            <text x={100 + Math.sin((s.az * Math.PI) / 180) * 78} y={100 - Math.cos((s.az * Math.PI) / 180) * 78} fontSize="9" textAnchor="middle">⛵</text>
            <text x={100 + Math.sin((s.az * Math.PI) / 180) * 78} y={100 - Math.cos((s.az * Math.PI) / 180) * 78 + 8} fontSize="6" fill="#cbd5e1" textAnchor="middle">{Math.round(s.km)} km</text>
          </g>
        ))}
        {/* Indicateurs de bord (au-delà de l'horizon) */}
        {[
          ...view.islands.filter((e) => e.beyond).slice(0, 2).map((e) => ({ icon: "⛰️", d: Math.round(e.km), az: e.az })),
          ...(view.port && view.port.beyond ? [{ icon: "🏛️", d: Math.round(view.port.km), az: view.port.az }] : []),
          ...view.outposts.filter((e) => e.beyond).map((e) => ({ icon: "🏕️", d: Math.round(e.km), az: e.az })),
          ...view.beacons.filter((e) => e.beyond).map((e) => ({ icon: "🔦", d: Math.round(e.km), az: e.az })),
        ].map((e, idx) => (
          <g key={idx}>
            <text x={100 + Math.sin((e.az * Math.PI) / 180) * 86} y={100 - Math.cos((e.az * Math.PI) / 180) * 86} fontSize="9" textAnchor="middle">{e.icon}</text>
            <text x={100 + Math.sin((e.az * Math.PI) / 180) * 86} y={100 - Math.cos((e.az * Math.PI) / 180) * 86 + 8} fontSize="6" fill="#cbd5e1" textAnchor="middle">{e.d} km</text>
          </g>
        ))}
        {/* Anneaux : capture 500 m (proche du centre) et 10 km */}
        <circle cx="100" cy="100" r={(0.5 / R) * 100} fill="none" stroke="rgba(251,191,36,0.5)" strokeDasharray="1 2" />
        <circle cx="100" cy="100" r="50" fill="none" stroke="rgba(56,189,248,0.25)" strokeDasharray="3 3" />
        {/* Faisceau de l'antenne */}
        <path
          transform={`translate(100,100) rotate(${antHeading})`}
          d={`M 0 0 L ${(-98 * Math.sin(hr)).toFixed(1)} ${(-98 * Math.cos(hr)).toFixed(1)} A 98 98 0 0 1 ${(98 * Math.sin(hr)).toFixed(1)} ${(-98 * Math.cos(hr)).toFixed(1)} Z`}
          fill="rgba(192,132,252,0.16)" stroke="rgba(192,132,254,0.45)" strokeWidth="0.7"
        />
        <line transform={`translate(100,100) rotate(${antHeading})`} x1="0" y1="0" x2="0" y2="-94" stroke="#c084fc" strokeDasharray="4 3" strokeWidth="0.7" />
        {/* Navire au centre, orienté au cap */}
        <g transform={`translate(100,100) rotate(${heading})`}>
          <path d="M 0 -12 L 8 10 L 0 5 L -8 10 Z" fill={player.grounded ? "#f87171" : "#38bdf8"} stroke="#e0f2fe" strokeWidth="0.8" />
        </g>
      </g>
      <text x="100" y="12" fontSize="9" fill="#94a3b8" textAnchor="middle">N</text>
    </svg>
  );
}

// ---------- Clavier radio VHF (appel « Position ? ») ----------
// Clavier cliquable immersif : touches 0-9, effacer (⌫), effacer tout (C).
// Le bouton d'appel n'est actif qu'avec 4 chiffres composés. L'émission
// utilise l'antenne TELLE QU'ELLE EST RÉGLÉE (viser avant d'appeler).
function VhfKeypad({ dialed, onDial, onCall, radioOk, portee }) {
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
      <button
        disabled={dialed.length !== 4 || !radioOk}
        onClick={() => { onCall(dialed); onDial(""); }}
        className={`mt-2 w-full rounded-lg py-2 text-sm font-bold transition-colors ${dialed.length === 4 && radioOk ? "bg-amber-500 text-slate-950 hover:bg-amber-400" : "bg-slate-800 text-slate-600 cursor-not-allowed"}`}
      >📡 Émettre (0,5 % batteries)</button>
    </div>
  );
}

// ---------- Carte de navigation (outil papier : estimé + punaises) ----------
// Reprise fidèle du proto : zoom molette/pincement centré curseur, pan par
// glissement, outils punaise (1 clic) et mesure (2 clics) avec conversion
// letterbox exacte, suppression, indicateur du 1er point.
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
  const [hoverPt, setHoverPt] = useState(null); // position curseur (degres) pour la previsualisation

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

  const world = snap.world;
  const player = snap.player;
  const kmOf = (a, b) => distNm(a[0], a[1], b[0], b[1]) * KM_PER_NM;

  return (
    <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
      <h2 className="text-sm font-semibold text-sky-300">Carte de navigation</h2>
      <div className="grid grid-cols-2 gap-2">
        <Btn active={tool === "pin"} onClick={() => { setTool(tool === "pin" ? null : "pin"); setMeasurePend(null); }}>📌 Punaise{tool === "pin" ? " — cliquer la carte" : ""}</Btn>
        <Btn active={tool === "measure"} onClick={() => { setTool(tool === "measure" ? null : "measure"); setMeasurePend(null); }}>📏 Mesure{tool === "measure" ? (measurePend ? " — 2ᵉ point" : " — 1ᵉʳ point") : ""}</Btn>
      </div>
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
        className={`w-full rounded-lg ${tool ? "cursor-crosshair" : "cursor-grab"}`}
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
          // Prévisualisation de mesure : suit le curseur dès le 1er point posé
          if (tool === "measure" && measurePend && !drag.current) {
            const hp = vbPoint(vb, rect, e.clientX, e.clientY);
            setHoverPt([hp.x / S, MAP - hp.y / S]);
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
          if (Object.keys(ptrs.current).length > 0 || !d || d.moved > 5 || !tool) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const p = vbPoint(d.vb, rect, e.clientX, e.clientY);
          const xDeg = p.x / S;
          const yDeg = MAP - p.y / S;
          if (tool === "pin") {
            if (player.pins.length < 26) {
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
        {/* Punaises A, B, C... */}
        {player.pins.map((p, idx) => (
          <g key={idx}>
            <circle cx={px(p.x)} cy={py(p.y)} r={5} fill="#dc2626" stroke="#7f1d1d" strokeWidth="1" />
            <text x={px(p.x)} y={py(p.y) - 7} fontSize="10" fill="#7f1d1d" fontWeight="bold" textAnchor="middle">{p.label}</text>
          </g>
        ))}
        {/* Position estimée + incertitude + cap */}
        <circle cx={px(player.estX)} cy={py(player.estY)} r={Math.max(1.2, (player.unc / KM_PER_DEG) * S)} fill="rgba(220,38,38,0.18)" stroke="#dc2626" strokeWidth="0.8" />
        <circle cx={px(player.estX)} cy={py(player.estY)} r={2} fill="#dc2626" />
        <line x1={px(player.estX)} y1={py(player.estY)} x2={px(player.estX) + Math.sin((player.heading * Math.PI) / 180) * 16} y2={py(player.estY) - Math.cos((player.heading * Math.PI) / 180) * 16} stroke="#dc2626" strokeWidth="1.2" />
      </svg>
      <p className="text-[11px] leading-snug text-slate-500">
        Terres et avant-postes connus · 🔴 position estimée — cercle = incertitude, échelle exacte · trait rouge = cap · molette/pincement : zoom (×1–×8) · glisser : déplacer
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

// ---------- Application principale ----------
export default function App() {
  const [session, setSession] = useState(null);
  const [snap, setSnap] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [logFilter, setLogFilter] = useState("tout");
  const sockRef = useRef(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [wxOpen, setWxOpen] = useState(false);
  const [dial, setDial] = useState("");
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
  const hour = snap ? ((new Date(snap.epoch + snap.t * 60000).getHours() + new Date(snap.epoch + snap.t * 60000).getMinutes() / 60)) : 12;
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
    (distNm(player.estX, player.estY, snap.world.port.x, snap.world.port.y) < 0.5 ||
    snap.world.outposts.some((o) => distNm(player.estX, player.estY, o.x, o.y) < 0.5));
  const antSens = Math.round(dirSensitivity(player.antBeam));
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
        <span className={`text-xs ${status === "connected" ? "text-emerald-300" : "text-amber-300"}`}>
          {status === "connected" ? "● connecté" : "● reconnexion…"}
        </span>
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
          <h2 className="text-sm font-semibold text-sky-300">Navire — {session.account}</h2>
          {atDock && (
            <div className="grid grid-cols-2 gap-2">
              <Btn active onClick={() => setShopOpen(true)}>🛒 Avitaillement</Btn>
              <Btn active onClick={() => { setWxOpen(true); setWxH(0); }}>🌤️ Prévisions J+15</Btn>
            </div>
          )}
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Vue de dessus — horizon 20 km</p>
          <TopView snap={snap} />
          <p className="text-[11px] text-slate-500">
            {uw && !player.periscope && "🕳️ Périscope rentré : aucune observation visuelle · "}
            {!daylight && "🌙 Nuit : seuls les feux sont visibles · "}
            Antenne : azimut {Math.round(antHeading)}°, ouverture {player.antBeam}°
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
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Cap</span>
            <Btn onClick={() => cmd({ heading: player.heading - 10 })}>◀</Btn>
            <input
              type="range" min={0} max={359} value={Math.round(player.heading)}
              onChange={(e) => cmd({ heading: +e.target.value })}
              className="w-full accent-sky-400"
            />
            <Btn onClick={() => cmd({ heading: player.heading + 10 })}>▶</Btn>
            <span className="w-12 text-right text-xs tabular-nums text-sky-300">{Math.round(player.heading)}°</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-20 text-xs text-slate-400">Voiles</span>
            <input
              type="range" min={0} max={100} value={Math.round(player.sail * 100)}
              onChange={(e) => cmd({ sail: +e.target.value / 100 })}
              className="w-full accent-sky-400"
            />
            <span className="w-12 text-right text-xs tabular-nums text-sky-300">{Math.round(player.sail * 100)}%</span>
          </div>
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
            Vitesse (eau) : <b className="text-sky-300">{(player.vkn * KM_PER_NM).toFixed(1)} km/h</b>
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
              <p className="text-sm font-bold tabular-nums">{Math.round(player.travelledNm * KM_PER_NM)} km</p>
              <p className="text-[10px] text-slate-500">aujourd'hui : {Math.round(player.dailyNm * KM_PER_NM)} km</p>
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
              <span>💨 Vent : <b>{(weather.windSpd * KM_PER_NM).toFixed(1)} km/h</b> <DirArrow deg={(weather.windDir + 180) % 360} color="#93c5fd" /> <b>{weather.windDir}°</b></span>
              <span>🌊 Courant : <b>{(weather.curSpd * KM_PER_NM).toFixed(1)} km/h</b> <DirArrow deg={weather.curDir} color="#5eead4" /> <b>{weather.curDir}°</b></span>
              <span>☁️ Nuages : <b>{weather.clouds}%</b></span>
              <span>🌡️ Temp. : <b>{weather.temp}°C</b></span>
              <span>👁️ Visibilité : <b>{(weather.visibility * KM_PER_NM).toFixed(1)} km</b></span>
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
              Directionnelle : capte dès <b className="text-purple-300">{antSens}%</b> (≈ {Math.round(2000 * (1 - antSens / 100))} km) si la balise est centrée · omnidirectionnelle : dès 75 % (≈ 500 km), azimut inconnu.
            </p>
            <p className="text-[11px] text-slate-400">
              Code du navire : <b className="font-mono text-sm text-sky-300">{player.code}</b> — c'est votre numéro radio (donnez-le aux autres navires pour qu'ils vous appellent).
            </p>
            <VhfKeypad
              dialed={dial}
              onDial={setDial}
              onCall={(code) => cmd({ call: code })}
              radioOk={radioOk}
              portee={Math.round(1000 + 4000 * (180 - player.antBeam) / 179)}
            />
          </div>

          <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
            <h2 className="text-sm font-semibold text-sky-300">Journal de bord</h2>
            <div className="flex flex-wrap gap-1">
              {[
                { id: "tout", label: "📋 Tout" }, { id: "navire", label: "⚙️ Navire" },
                { id: "nav", label: "🔭 Nav" }, { id: "meteo", label: "🌦️ Météo" },
                { id: "vision", label: "👁️ Vision" }, { id: "radio", label: "📡 Radio" },
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
      </div>

      {/* Prévisions météo (à quai) */}
      {wxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setWxOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-sky-300">🌤️ Prévisions météo — service côtier</h2>
            <p className="text-xs text-slate-400">Bulletin du monde extérieur, reçu à quai. Prévision parfaite jusqu'à J+15 · Instant : <b className="tabular-nums text-sky-300">+{wxH} h (J+{Math.floor(wxH / 24)})</b></p>
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
              <input type="range" min={0} max={360} step={6} value={wxH} onChange={(e) => setWxH(+e.target.value)} className="w-full accent-sky-400" />
              <span className="text-xs text-slate-400">J+15</span>
            </div>
            {wxData?.here && (
              <p className="rounded-lg bg-slate-800/70 p-2.5 text-center text-xs text-slate-300">
                À votre position à cet instant : vent <b className="text-sky-300">{wxData.here.windSpd.toFixed(0)} kn</b> · nuages <b className="text-sky-300">{wxData.here.clouds.toFixed(0)} %</b> · pluie <b className="text-sky-300">{wxData.here.rain.toFixed(0)} %</b> · visibilité <b className="text-sky-300">{(wxData.here.visibility * KM_PER_NM).toFixed(1)} km</b> · houle <b className="text-sky-300">{wxData.here.hs.toFixed(1)} m</b>
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
      </div>
    </div>
  );
}
