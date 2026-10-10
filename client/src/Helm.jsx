import React, { useEffect, useMemo, useRef, useState } from "react";
import NavMap from "./NavMap.jsx";
import {
  DEG_KM, MS_PER_MIN, CAPTURE_R_KM, DOUGLAS_LABEL, RARITY_STYLE,
} from "../../shared/engine.js";

const wrap360 = (d) => ((d % 360) + 360) % 360;
const wrap180 = (d) => (((d % 360) + 540) % 360) - 180;
const PXD = 7;
const CABIN_ROT_SPEED = 60;

const fmtT = (t, epoch) => {
  const d = new Date((epoch || 0) + t * MS_PER_MIN);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()
    + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};
const fmtTime = (t, epoch) => new Date((epoch || 0) + t * MS_PER_MIN).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// ---------- Ciel interpolé heure par heure (logique Scene.jsx de main) ----------
const SKY_STOPS = [
  [0, "#020617", "#0b2447"], [5, "#020617", "#0b2447"], [6.5, "#7c2d12", "#f59e0b"],
  [8, "#075985", "#0ea5e9"], [13, "#0369a1", "#38bdf8"], [18, "#075985", "#0ea5e9"],
  [19.5, "#581c87", "#f97316"], [21, "#020617", "#0b2447"], [24, "#020617", "#0b2447"],
];
function hexLerp(a, b, f) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * f)).join(",")})`;
}
function skyColors(h) {
  let i = 0;
  while (i < SKY_STOPS.length - 2 && h >= SKY_STOPS[i + 1][0]) i++;
  const [h0, ta, ba] = SKY_STOPS[i];
  const [h1, tb, bb] = SKY_STOPS[i + 1];
  const f = (h - h0) / (h1 - h0 || 1);
  return [hexLerp(ta, tb, f), hexLerp(ba, bb, f)];
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const STARS = (() => { const r = mulberry32(90210); return Array.from({ length: 46 }, () => ({ x: r() * 100, y: r() * 52, s: 1 + Math.round(r() * 2), d: Math.round(r() * 30) / 10 })); })();
const BUBBLES = (() => { const r = mulberry32(31415); return Array.from({ length: 12 }, () => ({ x: r() * 100, s: 3 + Math.round(r() * 6), dur: 5 + Math.round(r() * 7), del: Math.round(r() * 8) })); })();
function sunAz(h) { if (h <= 6) return 90; if (h >= 20) return 270; return 90 + ((h - 6) * 180) / 14; }

// Rayon apparent d'une île polygonale au gisement du joueur (moteur isleRadAt).
function isleRadAt(verts, brg) {
  const cx = verts.reduce((s, v) => s + v[0], 0) / verts.length;
  const cy = verts.reduce((s, v) => s + v[1], 0) / verts.length;
  const radii = verts.map(([vx, vy]) => Math.hypot(vx - cx, vy - cy));
  const n = radii.length;
  let a = brg % (Math.PI * 2); if (a < 0) a += Math.PI * 2;
  const step = (Math.PI * 2) / n;
  const k = Math.floor(a / step) % n;
  const f = (a - k * step) / step;
  const r0 = radii[k], r1 = radii[(k + 1) % n];
  return r0 + (r1 - r0) * f;
}

// ---------- Panorama 360° : chaque objet détecté est posé à son GISMENT VRAI ----------
// Habillage PUR : les détections viennent toutes du snapshot (view.*, snap.ships).
// Le client n'applique que la taille apparente (∝ 1/distance) et la silhouette
// le jour / feu la nuit.
function PortholeScene({ hour, w, dive, peri, regard, heading, snap }) {
  const deep = dive && !peri;
  const view = snap.view || {};
  const night = view.night;
  const sunUp = !night;
  const [skyTop, skyBot] = skyColors(hour);
  const sunF = Math.max(0, Math.min(1, (hour - 6) / 14));
  const sunX = 4 + sunF * 92;
  const sunY = 60 - Math.sin(sunF * Math.PI) * 48;
  const at = (az) => wrap180(az - regard) * PXD;

  const rollAmp = dive ? 0.2 : Math.min(4.5, 0.45 * w.douglas);
  const bobAmp = dive ? 0 : Math.min(22, 3.5 * w.douglas);
  const waveAmp = 0.25 + 0.26 * Math.pow(w.douglas, 1.25);
  const starOpacity = (hour < 5 ? 1 : hour < 7 ? (7 - hour) / 2 : hour >= 19 ? Math.min(1, (hour - 19) / 2) : 0) * (1 - (w.clouds / 100) * 0.85);
  const cloudTint = [226, 232, 240].map((v, i) => Math.round(v - (w.rain / 100) * (v - [100, 116, 139][i]))).join(",");
  const ambient = sunUp ? Math.max(0.25, 1 - w.clouds / 160) : 0;
  const fogTint = (day) => [15, 23, 42].map((nv, i) => Math.round(nv + (day[i] - nv) * ambient)).join(",");
  const rainF = (a, b) => Math.max(0, Math.min(1, (w.rain - a) / (b - a)));

  const shipW = (km) => Math.max(10, Math.round(16 * (12 / km)));
  const bcnH = (km) => Math.max(14, Math.round(26 * (2.1 / km)));

  // Traces de la Bête (view.traces) : marqueurs discrets au gisement.
  const traceGlyph = { epave: "🪵", carcasse: "🩸" };

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {!deep && (<>
        <div className="pcScene absolute -inset-[15%]"
          style={{ "--rollAmp": `${rollAmp}deg`, "--rollDur": `${Math.max(4, w.period)}s`, "--bobAmp": `${bobAmp}px` }}>
        <div className="absolute inset-0" style={{ background: `linear-gradient(${skyTop}, ${skyBot})` }} />
        <div className="absolute inset-0" style={{ opacity: starOpacity }}>
          {STARS.map((st, i) => {
            const dx = at(st.x * 3.6);
            if (Math.abs(dx) > 1100) return null;
            return (
              <div key={i} className="pcStar absolute rounded-full bg-white"
                style={{ left: `calc(50% + ${dx}px)`, top: `${st.y}%`, width: st.s, height: st.s, animationDelay: `${st.d}s` }} />
            );
          })}
        </div>
        {sunUp && Math.abs(at(sunAz(hour))) < 1100 && (
          <div className="absolute" style={{ left: `calc(50% + ${at(sunAz(hour))}px)`, top: `${sunY}%`, transform: "translate(-50%, -50%)" }}>
            <div className="h-14 w-14 rounded-full"
              style={{ background: "radial-gradient(circle, #fffbeb 25%, #fde68a 45%, rgba(251,191,36,0.35) 70%, transparent 100%)", boxShadow: "0 0 45px 16px rgba(251,191,36,0.35)" }} />
          </div>
        )}
        <div className="absolute" style={{ left: "11.54%", right: "11.54%", top: "11.54%", bottom: "11.54%" }}>
        <div className="absolute inset-0" style={{ opacity: Math.max(0, (w.clouds - 40) / 60), background: `linear-gradient(rgba(${cloudTint}, 0.9), rgba(${cloudTint}, 0.65))` }} />
        <div className="absolute inset-0" style={{ opacity: (w.clouds / 100) * 0.95 }}>
          {[0, 1].map((k) => (
            <div key={k} className="pcFog absolute left-[-15%] w-[130%]"
              style={{ top: k ? "4%" : "-8%", height: "62%", animationDuration: k ? "170s" : "120s", animationDelay: k ? "-50s" : "0s" }}>
              {[[8, 18, 90, 30, 0.7], [34, 10, 130, 22, 0.55], [58, 30, 80, 34, 0.65], [78, 14, 150, 20, 0.5], [50, 44, 60, 18, 0.45]]
                .filter((_, i) => i % 2 === k).map(([x, y, rw, rh, o], i) => (
                  <div key={i} className="absolute rounded-[50%] blur-md" style={{ left: `${x}%`, top: `${y}%`, width: rw, height: rh, background: `rgba(${cloudTint}, ${0.75 * o})` }} />
                ))}
            </div>
          ))}
        </div>
        </div>

        {/* Côte du continent (view.coast) : silhouette basse sur les azimuts couverts.
            continentVerts = sommets RELATIFS à la position vraie (degrés). */}
        {view.coast && view.continentVerts && (() => {
          const pts = view.continentVerts.map(([vx, vy]) => {
            const az = (Math.atan2(vx, vy) * 180) / Math.PI;
            const km = Math.hypot(vx, vy) * DEG_KM;
            return { az: wrap360(az), km };
          }).filter((p) => p.km > 0.01);
          if (pts.length < 2) return null;
          const minAz = pts[0].az, maxAz = pts[pts.length - 1].az;
          let span = wrap180(maxAz - minAz);
          if (span <= 0) span += 360;
          if (span > 140) return null; // sommets qui contournent : pas une silhouette en face
          const cx = (at(minAz) + at(maxAz)) / 2;
          return (
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute -translate-x-1/2"
              style={{ left: `calc(50% + ${cx}px)`, bottom: "calc(33% - 22px)", width: Math.max(40, span * PXD), height: 34 }}>
              <path d="M 0 40 L 8 22 L 26 28 L 44 14 L 62 24 L 80 18 L 100 40 Z" fill="#0d3040" opacity="0.92" />
            </svg>
          );
        })()}

        {/* Îles détectées (view.islands) : TAILLE ANGULAIRE RÉELLE depuis les
            sommets du snapshot (degrés absolus), base sous la ligne de flottaison. */}
        {view.islands.map((e, idx) => {
          const verts = e.verts || [];
          if (verts.length < 3) return null;
          const cx = verts.reduce((s, v) => s + v[0], 0) / verts.length;
          const cy = verts.reduce((s, v) => s + v[1], 0) / verts.length;
          const radDeg = verts.reduce((m, [vx, vy]) => Math.max(m, Math.hypot(vx - cx, vy - cy)), 0);
          const radKm = radDeg * DEG_KM;
          const azTo = (vx, vy) => wrap360((Math.atan2(vx - cx, vy - cy) * 180) / Math.PI);
          const isleW = 2 * Math.atan(radKm / Math.max(0.1, e.km)) * (180 / Math.PI) * PXD;
          const isleH = e.beyond ? 5 : Math.max(10, Math.atan(radKm / Math.max(0.1, e.km)) * (180 / Math.PI) * PXD);
          if (Math.abs(at(e.az)) > 1100 + isleW) return null;
          const polyPts = verts
            .map(([vx, vy]) => `${(50 + wrap180(azTo(vx, vy) - e.az) * PXD / (isleW / 100 || 1)).toFixed(1)},${(36 - 30 * (1 - Math.hypot(vx - cx, vy - cy) / (radDeg || 1))).toFixed(1)}`)
            .join(" ");
          return (
            <svg key={idx} viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute -translate-x-1/2"
              style={{ left: `calc(50% + ${at(e.az)}px)`, bottom: "calc(33% - 26px)", width: Math.max(24, isleW), height: isleH + 26 }}>
              <polygon points={polyPts} fill="#0d3040" opacity="0.94" />
            </svg>
          );
        })}

        {/* Balises détectées (view.beacons) : espar + feu de rareté, ÉTEINT si off */}
        {(view.beacons || []).map((e) => {
          if (Math.abs(at(e.az)) > 1100) return null;
          const h = bcnH(e.km);
          const col = e.off ? "#64748b" : RARITY_STYLE[e.rarity]?.color || "#facc15";
          return (
            <div key={e.id} className="absolute -translate-x-1/2" style={{ left: `calc(50% + ${at(e.az)}px)`, bottom: "calc(33% - 3px)" }}>
              <svg width={Math.round(h * 10 / 26)} height={h} viewBox="0 0 10 26">
                <line x1="5" y1="26" x2="5" y2="10" stroke="#a9834a" strokeWidth="1.4" />
                <path d="M1.5 10 L8.5 10 L5 15 Z" fill="#7c5a2b" />
                {!e.off && <circle cx="5" cy="5" r="2.6" fill={col} className="pcBlink" />}
              </svg>
            </div>
          );
        })}

        {/* Port (view.port) : silhouette de ville le jour, feux la nuit */}
        {view.port && Math.abs(at(view.port.az)) < 1100 && (
          night ? (
            <div className="absolute -translate-x-1/2" style={{ left: `calc(50% + ${at(view.port.az)}px)`, bottom: "calc(33% - 2px)" }}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="pcBlink absolute rounded-full bg-amber-200"
                  style={{ left: (i - 1) * 9, bottom: 2 + i * 4, width: 4, height: 4, boxShadow: "0 0 8px 2px rgba(252,211,77,0.7)", animationDelay: `${i * 0.4}s` }} />
              ))}
            </div>
          ) : (
            <div className="absolute -translate-x-1/2 opacity-80" style={{ left: `calc(50% + ${at(view.port.az)}px)`, bottom: "calc(33% - 2px)" }}>
              <svg width={shipW(view.port.km)} height={Math.round(shipW(view.port.km) * 0.7)} viewBox="0 0 20 14">
                <rect x="2" y="9" width="16" height="4" fill="#0c2233" />
                <rect x="5" y="5" width="3" height="4" fill="#0c2233" />
                <rect x="12" y="7" width="3" height="2" fill="#0c2233" />
              </svg>
            </div>
          )
        )}

        {/* Avant-postes (view.outposts) : feu fixe */}
        {(view.outposts || []).map((e) => (
          Math.abs(at(e.az)) < 1100 && (
            <div key={e.idx} className="absolute -translate-x-1/2 rounded-full bg-emerald-200"
              style={{ left: `calc(50% + ${at(e.az)}px)`, bottom: "calc(33% - 3px)", width: 4, height: 4, boxShadow: "0 0 8px 2px rgba(167,243,208,0.7)" }} />
          )
        ))}

        {/* Navires détectés (snap.ships — détection serveur) :
            silhouette le jour (grossit à l'approche), feu clignotant la nuit si light. */}
        {(snap.ships || []).map((s) => {
          if (Math.abs(at(s.az)) > 1100) return null;
          return night ? (s.light ? (
            <div key={s.id} className="pcBlink absolute -translate-x-1/2 rounded-full bg-amber-200"
              style={{ left: `calc(50% + ${at(s.az)}px)`, bottom: "calc(33% - 3px)", width: 5, height: 5, boxShadow: "0 0 9px 3px rgba(252,211,77,0.75)" }} />
          ) : null) : (
            <div key={s.id} className="absolute -translate-x-1/2 opacity-70" style={{ left: `calc(50% + ${at(s.az)}px)`, bottom: "calc(33% - 2px)" }}>
              <svg width={shipW(s.km)} height={Math.round(shipW(s.km) * 0.875)} viewBox="0 0 16 14">
                <path d="M2 9 L14 9 L12 13 L4 13 Z" fill="#0c2233" />
                <line x1="8" y1="9" x2="8" y2="2" stroke="#0c2233" strokeWidth="1.2" />
                <line x1="8" y1="4" x2="12" y2="4" stroke="#0c2233" strokeWidth="1" />
              </svg>
            </div>
          );
        })}

        {/* Traces de la Bête (view.traces) : marqueurs discrets au gisement */}
        {(view.traces || []).map((e, idx) => {
          if (Math.abs(at(e.az)) > 1100) return null;
          return (
            <span key={idx} className="absolute -translate-x-1/2 text-[11px] opacity-70"
              style={{ left: `calc(50% + ${at(e.az)}px)`, bottom: "calc(33% + 10px)" }}>{traceGlyph[e.kind] || "⚬"}</span>
          );
        })}

        {/* mer : bande d'eau — le haut = ligne de flottaison (33 % du bloc-paysage) */}
          <div className="absolute inset-x-0 bottom-0" style={{ height: "33%" }}>
            <div className="absolute inset-0" style={{ background: "linear-gradient(rgba(8,47,73,0.92), #061527)" }} />
            {[0, 1].map((k) => (
              <div key={k} className="absolute inset-x-0 top-0 h-10 overflow-hidden">
                <div className="absolute left-0 top-0 h-10" style={{ width: "200%", animation: `pcWave ${Math.max(3, w.period) * (k ? 1.6 : 1)}s linear infinite ${k ? "reverse" : "normal"}` }}>
                  <svg viewBox="0 0 1200 80" preserveAspectRatio="none" className="h-10 w-full"
                    style={{ transform: `scaleY(${k ? waveAmp * 0.6 : waveAmp})`, transformOrigin: "top", opacity: k ? 0.35 : 0.55 }}>
                    <path d="M0 50 Q 75 15 150 50 T 300 50 T 450 50 T 600 50 T 750 50 T 900 50 T 1050 50 T 1200 50 V 80 H 0 Z" fill="rgba(125,211,252,0.5)" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        {/* pluie : couches d'intensité croissante */}
        <div className="absolute -inset-[18%] rotate-[11deg] overflow-hidden">
          <div className="pcRain absolute left-0 w-full" style={{ top: "-260px", height: "calc(100% + 260px)", opacity: rainF(55, 80),
            backgroundImage: "radial-gradient(ellipse 1.6px 15px at 45% 15%, rgba(203,213,225,0.5) 99%, transparent), radial-gradient(ellipse 1.3px 12px at 80% 55%, rgba(203,213,225,0.4) 99%, transparent)", backgroundSize: "220px 260px" }} />
          <div className="pcRain absolute left-0 w-full" style={{ top: "-200px", height: "calc(100% + 200px)", opacity: rainF(25, 50),
            backgroundImage: "radial-gradient(ellipse 1px 10px at 30% 40%, rgba(203,213,225,0.4) 99%, transparent), radial-gradient(ellipse 1px 9px at 60% 80%, rgba(203,213,225,0.35) 99%, transparent)", backgroundSize: "130px 200px" }} />
        </div>
        {/* brouillard : voile + bancs dérivants */}
        {w.fog && (
          <div className="absolute inset-0">
            <div className="absolute inset-0" style={{ background: `linear-gradient(rgba(${fogTint([203, 213, 225])},0.55), rgba(${fogTint([148, 163, 184])},0.5))` }} />
            <div className="pcFog absolute left-[-15%] top-[8%] h-[55%] w-[130%] blur-3xl" style={{ background: `rgba(${fogTint([203, 213, 225])},0.75)`, animationDuration: "40s" }} />
          </div>
        )}
        {/* tempête : assombrissement + éclairs */}
        {w.storm && (<>
          <div className="absolute inset-0" style={{ background: "rgba(2,6,23,0.5)" }} />
          <div className="pcFlash absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% -10%, rgba(224,242,254,0.9), transparent 55%)" }} />
        </>)}
        </div>

        {/* bandeau de gisement gravé sur la vitre (solidaire du pont, pas du regard) */}
        <div className="absolute inset-x-0 bottom-[5px] h-5">
          {Array.from({ length: 61 }, (_, i) => {
            const b = Math.round((regard - 120) / 10) * 10 + i * 10;
            const d = wrap180(b - regard) * PXD;
            const bb = wrap360(b);
            const major = bb % 30 === 0;
            const lbl = bb === 0 ? "N" : bb === 90 ? "E" : bb === 180 ? "S" : bb === 270 ? "O" : `${bb}`;
            return (
              <span key={i} className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
                style={{ left: `calc(50% + ${d}px)` }}>
                <span className={`w-px ${major ? "h-2 bg-[#e3c885]" : "h-1 bg-[#e3c885]/50"}`} />
                {major && <span className={`font-mono text-[7px] leading-none ${bb === 0 ? "text-rose-300" : "text-[#e3c885]/90"}`}>{lbl}</span>}
              </span>
            );
          })}
          <span className="absolute top-0 -translate-x-1/2" style={{ left: `calc(50% + ${wrap180(heading - regard) * PXD}px)` }}>
            <span className="block h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-rose-400" />
          </span>
        </div>
        <div className="absolute inset-y-2 left-1/2 w-px bg-amber-300/30" />
      </>)}

      {/* plongée : colonne d'eau + rayons de soleil + bulles */}
      {deep && (<>
        <div className="absolute inset-0" style={{ background: "linear-gradient(#0a4d75, #05263f 45%, #02101f)" }} />
        <div className="absolute inset-0" style={{ background: "#010409", opacity: 0.35 }} />
        {sunUp && (
          <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse 55% 38% at ${sunX}% -6%, rgba(186,230,253,0.5), transparent 70%)` }} />
        )}
        {BUBBLES.map((b, i) => (
          <div key={i} className="pcBubble absolute rounded-full border border-sky-300/60 bg-sky-300/10"
            style={{ left: `${b.x}%`, bottom: "-3%", width: b.s, height: b.s, animationDuration: `${b.dur}s`, animationDelay: `${b.del}s` }} />
        ))}
      </>)}
    </div>
  );
}

// ---------- Vitres : cabine motorisée — regard LOCAL, remontée à 10 Hz ----------
function WindowsBand({ hour, w, dive, peri, heading, onRegard, snap }) {
  const [regard, setRegard] = useState(42);
  const [lock, setLock] = useState(false);
  const raf = useRef(null);
  const regardRef = useRef(42);
  const lastSent = useRef(0);
  const view = snap.view || {};
  const player = snap.player;

  useEffect(() => {
    if (lock) { regardRef.current = heading; setRegard(heading); onRegard(Math.round(heading)); }
  }, [lock, heading]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  const stop = () => { if (raf.current) cancelAnimationFrame(raf.current); raf.current = null; };
  const start = (dir) => {
    if (lock) return;
    stop();
    let prev = performance.now();
    const step = (t) => {
      regardRef.current = wrap360(regardRef.current + dir * CABIN_ROT_SPEED * ((t - prev) / 1000));
      setRegard(regardRef.current);
      if (t - lastSent.current > 100) { lastSent.current = t; onRegard(Math.round(regardRef.current)); }
      prev = t;
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  const nearestIsland = (view.islands || [])[0];
  const sight = dive
    ? (peri ? "👁️ périscope sorti — observation en surface" : "🌊 immersion — vitres blindées, périscope rentré")
    : nearestIsland
      ? `👁️ terre en vue au ${Math.round(nearestIsland.az)}° — ${Math.round(nearestIsland.km)} km`
      : "👁️ pleine mer — rien en vue";

  return (
    <div>
      <div className="relative h-44 overflow-hidden rounded-md border-2 border-[#6b5323] bg-[#0a2033] shadow-inner md:h-52 xl:h-60">
        <PortholeScene hour={hour} w={w} dive={dive} peri={peri} regard={regard} heading={heading} snap={snap} />
        {dive && !peri && (
          <>
            <div className="pcShutter pointer-events-none absolute inset-0" style={{
              background: "repeating-linear-gradient(180deg, rgba(186,133,66,0.85) 0px, rgba(140,94,43,0.85) 8px, rgba(74,56,32,0.85) 12px, rgba(38,30,17,0.4) 13px, transparent 15px, transparent 32px)"
            }} />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[9px] border-b border-[#8a5a2b]/60"
              style={{ background: "linear-gradient(180deg, #6b4a20, #3a2a16)", boxShadow: "0 2px 5px rgba(0,0,0,0.65)" }} />
          </>
        )}
        {dive && peri && (
          <>
            <div className="pointer-events-none absolute inset-0" style={{
              background: "radial-gradient(circle closest-side at 50% 50%, transparent 0 74%, rgba(1,4,10,0.55) 74.5%, rgba(10,8,4,0.9) 76%, #b87333 78%, #8a5a2b 79.5%, #3a2a16 81.5%, #02060c 83%, #01040a 100%)"
            }} />
            <div className="pointer-events-none absolute inset-0" style={{
              background: "radial-gradient(circle closest-side at 50% 50%, rgba(103,232,249,0.08) 0 72%, transparent 74%)"
            }} />
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/2 h-full w-px -translate-x-1/2 bg-emerald-300/25" />
              <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-emerald-300/25" />
              <div className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300/70" />
            </div>
          </>
        )}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-full w-[14px] -translate-x-1/2 border-x-2 border-[#2c1f11] bg-gradient-to-b from-[#a9834a] via-[#7c5a2b] to-[#4a3820]" />
          <div className="absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-[#0d0a06]/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-2 bg-gradient-to-t from-[#0d0a06]/60 to-transparent" />
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="engrave text-[8.5px] uppercase tracking-[0.18em]">{sight}</p>
        <div className="flex items-center gap-1.5 rounded-md border border-[#5c3a1a] bg-gradient-to-b from-[#3a2c18] to-[#241a0e] px-1.5 py-0.5">
          <span className="engrave text-[7px] uppercase tracking-[0.14em]">orientation</span>
          {[[-1, "◀", "pivoter vers bâbord"], [1, "▶", "pivoter vers tribord"]].map(([dir, arrow, tip]) => (
            <button key={dir} disabled={lock} title={tip}
              onPointerDown={() => start(dir)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
              className={`rounded border px-1.5 py-0.5 text-[9px] font-bold leading-none ${lock
                ? "cursor-not-allowed border-[#3a2c18] bg-[#1a140c] text-[#6b5a35]"
                : "border-[#5c3a1a] bg-gradient-to-b from-[#b87333] to-[#7c4a1a] text-[#1c130a] hover:from-[#d08a4a] active:shadow-[inset_0_2px_3px_rgba(0,0,0,0.5)]"}`}>
              {arrow}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <p className="engrave text-[8.5px] uppercase tracking-[0.18em]">
            {dive ? (peri ? "👁️ périscope sorti — observation en surface" : "🌊 vitres blindées, sortez le périscope") : `💨 ${w.windSpd} km/h au ${w.windDir}° · visibilité ${w.visibility} km · regard ${Math.round(regard)}°`}
          </p>
          <button onClick={() => setLock(!lock)}
            title={lock ? "regard verrouillé sur le cap — cliquer pour libérer" : "verrouiller le regard sur le cap"}
            className={`rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide ${lock
              ? "border-amber-400 bg-amber-500/90 text-[#201503]"
              : "border-[#5c3a1a] bg-[#241a0e] text-amber-200/80 hover:border-amber-600"}`}>
            {lock ? "🔒 sur le cap" : "🔓 libre"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Composants diégétiques (annexe, inchangés) ----------
function Gear({ size, reverse, className }) {
  const teeth = Array.from({ length: 8 }, (_, i) => i * 45);
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={`${reverse ? "pcGearR" : "pcGear"} ${className || ""}`}>
      {teeth.map((d) => (
        <rect key={d} x="18.5" y="2" width="3" height="7" rx="1" fill="#8a5a2b" transform={`rotate(${d} 20 20)`} />
      ))}
      <circle cx="20" cy="20" r="15" fill="none" stroke="#8a5a2b" strokeWidth="4" />
      <circle cx="20" cy="20" r="5" fill="#241a0e" stroke="#b87333" strokeWidth="2" />
      <circle cx="20" cy="20" r="1.6" fill="#d4a24e" />
    </svg>
  );
}

// TODO INTEGRATION: sections 3.3 à 3.6 (console, table à cartes, radio/sonar, journal)

export default function Helm({ snap, sock, onManual, onShop, onNetwork, onWx, superBlock }) {
  const cmd = (data) => sock && sock.command(data);
  const player = snap.player;
  const weather = snap.weather;
  const d = new Date(snap.epoch + snap.t * MS_PER_MIN);
  const hour = d.getHours() + d.getMinutes() / 60;
  const [regardCabin, setRegardCabin] = useState(42);
  const uw = player.location === "underwater";

  return (
    <div className="deck min-h-screen pb-6 pt-4 text-slate-100">
      <div className="relative z-10 mx-auto max-w-[1500px] px-4">
        {/* Bandeau : vitres + plaques de bord */}
        <div className="mb-3 rounded-xl border-2 border-[#241a0e] p-3 shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
          style={{ background: "linear-gradient(180deg, #4a3421, #33230f)" }}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="plate rounded px-3 py-1 font-mono text-sm font-bold tracking-[0.2em]">⚓ {player.code}</span>
              <span className="plate rounded px-2.5 py-1 text-[10px] font-bold tracking-wider">{fmtT(snap.t, snap.epoch)} (PARIS)</span>
              <span className="plate rounded px-2.5 py-1 text-[10px] font-bold tracking-wider">SCORE {player.score} PTS — CODES À BORD : {player.codes.length}</span>
              <span className="plate rounded px-2.5 py-1 text-[10px] font-bold tracking-wider">BALISES {snap.world.activeBeaconIds.length}/{snap.world.beaconCount}</span>
              <span className="flex items-center gap-1 rounded border border-[#5c3a1a] bg-[#141b26] px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" /> en ligne
              </span>
              {player.beaconLock && (
                <span className="plate rounded px-2.5 py-1 text-[10px] font-bold tracking-wider">🔒 BALISE {player.beaconLock}</span>
              )}
              {player.autopilot && (
                <span className="plate rounded px-2.5 py-1 text-[10px] font-bold tracking-wider">🤖 PILOTE</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Gear size={22} />
              <Gear size={14} reverse />
              <button onClick={onManual} className="plate rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider hover:brightness-110">📖 Livre des systèmes</button>
              {superBlock}
            </div>
          </div>
          <WindowsBand hour={hour} w={weather} dive={uw} peri={player.periscope} heading={player.heading} onRegard={setRegardCabin} snap={snap} />
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <button onClick={onShop} className="plate rounded px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider hover:brightness-110">📦 Avitaillement</button>
            <button onClick={onNetwork} className="plate rounded px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider hover:brightness-110">📡 NETWORK</button>
            <button onClick={onWx} className="plate rounded px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider hover:brightness-110">🌦️ Prévisions météo</button>
          </div>
        </div>
        <p className="mt-4 text-center font-serif text-[11px] italic text-amber-200/50">
          Poste de barre — branche experimental
        </p>
      </div>
    </div>
  );
}
