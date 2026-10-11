import React, { useEffect, useRef, useState } from "react";
import { clamp, DEG_KM, RARITY_STYLE, HORIZON_KM } from "../../shared/engine.js";
// ---------- Vue de dessus : disque horizon 20 km, zoom ×1–×16 ----------
// Portée TELLE QUELLE depuis main (App.jsx) — projection azimut/distance :
// tout est servi par le serveur, calculé DEPUIS LA POSITION VRAIE.
// Habillage cuivre au montage (Helm.jsx) ; ici seul le pourtour passe au laiton.
export default function TopView({ snap }) {
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
      <circle cx="100" cy="100" r="98" fill={!view.canSee ? "#010a14" : night ? "#03121f" : "#0b2a4a"} stroke="#b87333" strokeWidth="1.5" />
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
