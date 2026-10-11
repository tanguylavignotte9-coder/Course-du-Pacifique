import React, { useEffect, useMemo, useRef, useState } from "react";
import NavMap from "./NavMap.jsx";
import {
  DEG_KM, MS_PER_MIN, CAPTURE_R_KM, DOUGLAS_LABEL, RARITY_STYLE,
  AUTOGUIDE_MODES, AUTOGUIDE_DEFAULT,
  SONAR_RANGE_KM, SONAR_PING_BATTERY_COST, SONAR_ECHO_PERSIST_S,
} from "../../shared/engine.js";

const AUTOGUIDE_LABEL = { off: "Aucun", active: "Actives", disabled: "Déjà capturées", all: "Toutes" };

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
          // La flottaison est a 26 px du bas de l'element ; le viewBox "0 0 100 40" est
          // etire sur isleH + 26 px, donc 1 unite = (isleH + 26) / 40 px. La flottaison
          // tombe a y = 40 * isleH / (isleH + 26) ; le pic (centre de l'ile) a y = 0.
          const vbWl = (40 * isleH) / (isleH + 26);
          const polyPts = verts
            .map(([vx, vy]) => {
              const d = Math.hypot(vx - cx, vy - cy) / (radDeg || 1);
              return `${(50 + wrap180(azTo(vx, vy) - e.az) * PXD / (isleW / 100 || 1)).toFixed(1)},${(vbWl * d).toFixed(1)}`;
            })
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

// ---------- Barre à roue (glisser pour barrer) : consigne, throttle 10 Hz + envoi final ----------
function Wheel({ order, heading, disabled, onOrder }) {
  const ref = useRef(null);
  const drag = useRef(null);
  const lastSent = useRef(0);
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (live != null && Math.abs(wrap180(order - live)) < 1.5) setLive(null);
  }, [order]);
  const angFrom = (e) => {
    const r = ref.current.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return (Math.atan2(e.clientX - cx, cy - e.clientY) * 180) / Math.PI;
  };
  const onDown = (e) => {
    if (disabled) return;
    drag.current = { start: angFrom(e), startOrder: live != null ? live : order };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.current || disabled) return;
    let d = angFrom(e) - drag.current.start;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    const v = wrap360(drag.current.startOrder + d);
    setLive(v);
    const t = performance.now();
    if (t - lastSent.current > 100) { lastSent.current = t; onOrder(Math.round(v)); }
  };
  const onUp = (e) => {
    if (!drag.current) return;
    let d = angFrom(e) - drag.current.start;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    const v = wrap360(drag.current.startOrder + d);
    setLive(v);
    onOrder(Math.round(v));
    drag.current = null;
  };
  const shown = live != null ? live : order;
  return (
    <svg ref={ref} viewBox="0 0 200 200" className={`w-[185px] select-none touch-none ${disabled ? "cursor-not-allowed opacity-50" : "cursor-grab"}`}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      <circle cx="100" cy="100" r="92" fill="none" stroke="#2c1f11" strokeWidth="16" />
      <circle cx="100" cy="100" r="92" fill="none" stroke="#8a5a2b" strokeWidth="11" />
      <circle cx="100" cy="100" r="92" fill="none" stroke="#b87333" strokeWidth="2" />
      <g transform={`rotate(${(shown * 3) % 360} 100 100)`}>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => {
          const rr = (d * Math.PI) / 180;
          return (
            <g key={d}>
              <line x1={100 + Math.sin(rr) * 16} y1={100 - Math.cos(rr) * 16}
                x2={100 + Math.sin(rr) * 76} y2={100 - Math.cos(rr) * 76} stroke="#3a2a16" strokeWidth="9" />
              <line x1={100 + Math.sin(rr) * 16} y1={100 - Math.cos(rr) * 16}
                x2={100 + Math.sin(rr) * 76} y2={100 - Math.cos(rr) * 76} stroke="#7c5a2b" strokeWidth="4" />
              <circle cx={100 + Math.sin(rr) * 88} cy={100 - Math.cos(rr) * 88} r="7.5"
                fill="#241a0e" stroke="#d4a24e" strokeWidth="2.5" />
            </g>
          );
        })}
      </g>
      <circle cx="100" cy="100" r="24" fill="#3b2a17" stroke="#8a5a2b" strokeWidth="3" />
      <circle cx="100" cy="100" r="6" fill="#d4a24e" stroke="#5c3a1a" />
    </svg>
  );
}

// ---------- Compas de route fusionné : cap réel + consigne + regard cabine ----------
function Binnacle({ heading, order, regard }) {
  const ticks = [];
  for (let d = 0; d < 360; d += 10) {
    const big = d % 30 === 0;
    const rr = (d * Math.PI) / 180;
    ticks.push(<line key={d} x1={70 + Math.sin(rr) * (big ? 49 : 52)} y1={70 - Math.cos(rr) * (big ? 49 : 52)}
      x2={70 + Math.sin(rr) * 55} y2={70 - Math.cos(rr) * 55} stroke="#64748b" strokeWidth={big ? 1.3 : 0.7} />);
  }
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 140" className="w-[128px]">
        <circle cx="70" cy="70" r="67" fill="#0d1420" stroke="#8a5a2b" strokeWidth="3.5" />
        <circle cx="70" cy="70" r="67" fill="none" stroke="#b87333" strokeWidth="1" />
        <g transform={`rotate(${-heading} 70 70)`}>
          <circle cx="70" cy="70" r="57" fill="#0f2331" stroke="#1f3a52" strokeWidth="1" />
          {ticks}
          {[["N", 0], ["E", 90], ["S", 180], ["O", 270]].map(([c, d]) => {
            const rr = (d * Math.PI) / 180;
            return <text key={c} x={70 + Math.sin(rr) * 42} y={70 - Math.cos(rr) * 42 + 3.5}
              textAnchor="middle" fontSize="11" fontWeight="bold" fill={c === "N" ? "#f87171" : "#cbd5e1"}>{c}</text>;
          })}
          <g transform={`rotate(${order} 70 70)`}>
            <line x1="70" y1="70" x2="70" y2="20" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="3 2.5" />
            <polygon points="70,13 66.5,21 73.5,21" fill="#fbbf24" />
          </g>
          <g transform={`rotate(${regard} 70 70)`}>
            <line x1="70" y1="70" x2="70" y2="16" stroke="#22d3ee" strokeWidth="1" strokeDasharray="2 2" />
            <polygon points="70,10 66.8,16.5 73.2,16.5" fill="#0d1420" stroke="#22d3ee" strokeWidth="1.2" />
          </g>
        </g>
        <polygon points="70,7 65.5,17 74.5,17" fill="#ef4444" />
        <circle cx="70" cy="70" r="4.5" fill="#d4a24e" stroke="#5c3a1a" />
      </svg>
      <div className="mt-0.5 flex gap-3 text-center">
        <p className="engrave text-[9px] uppercase tracking-widest">cap <b className="font-mono text-[11px] text-red-300">{Math.round(heading)}°</b></p>
        <p className="engrave text-[9px] uppercase tracking-widest">consigne <b className="font-mono text-[11px] text-amber-300">{Math.round(order)}°</b></p>
        <p className="engrave text-[9px] uppercase tracking-widest">regard <b className="font-mono text-[11px] text-cyan-300">{Math.round(regard)}°</b></p>
      </div>
    </div>
  );
}

// ---------- Poignée de machine (thermique) : moletée, graduations, throttle 10 Hz ----------
function HandleLever({ label, value, onChange, cyan }) {
  const lastSent = useRef(0);
  const onInput = (e) => {
    const v = +e.target.value;
    const t = performance.now();
    if (t - lastSent.current > 100) { lastSent.current = t; onChange(v, false); }
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="engrave w-[86px] shrink-0 text-[9px] uppercase leading-tight tracking-wider">{label}</span>
        <input type="range" min={0} max={100} value={value} onInput={onInput} onChange={(e) => onChange(+e.target.value, true)}
          className={`hnd w-full ${cyan ? "cyan" : ""}`} />
        <span className="w-9 text-right font-mono text-[11px] text-amber-300">{value} %</span>
      </div>
      <div className="ml-[94px] mr-[52px] mt-[3px] flex justify-between">
        {[0, 25, 50, 75, 100].map((k) => (
          <span key={k} className="flex flex-col items-center gap-px">
            <span className={`w-px h-[5px] ${value >= k ? "bg-amber-400" : "bg-[#6b5a35]"}`} />
            <span className="font-mono text-[6px] leading-none text-[#8a6d3b]">{k}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- Drisse de voile : HALER VERS LE BAS HISSE, throttle 10 Hz + envoi final ----------
function RopeHandle({ value, onCommit }) {
  const ref = useRef(null);
  const lastSent = useRef(0);
  const [live, setLive] = useState(null);
  const set = (e) => {
    const r = ref.current.getBoundingClientRect();
    const travel = r.height - 18 - 32 - 4;
    const t = Math.min(1, Math.max(0, (e.clientY - r.top - 18 - 16) / travel));
    setLive(Math.round(t * 100));
    const now = performance.now();
    if (now - lastSent.current > 100) { lastSent.current = now; onCommit(Math.round(t * 100) / 100); }
  };
  const down = (e) => { e.currentTarget.setPointerCapture(e.pointerId); set(e); };
  const move = (e) => { if (e.buttons) set(e); };
  const up = () => {
    if (live != null) onCommit(Math.round(live) / 100);
    setLive(null);
  };
  const v = live != null ? live : Math.round(value * 100);
  return (
    <div className="flex flex-col items-center">
      <p className="engrave mb-1 text-[8px] uppercase tracking-[0.16em]">drisse — haler vers le bas pour hisser</p>
      <div ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className="relative h-[168px] w-[72px] cursor-grab touch-none select-none rounded-lg border-2 border-[#5c3a1a]"
        style={{ background: "linear-gradient(90deg, #241a0e, #17110a)" }}>
        <div className="absolute left-1/2 top-1 h-3.5 w-6 -translate-x-1/2 rounded-full border border-[#8a5a2b] bg-[#3a2a16]" />
        <div className="absolute bottom-1.5 left-1/2 w-[3px] -translate-x-1/2 rounded"
          style={{ top: 18, background: "repeating-linear-gradient(180deg, #c9b48a 0 6px, #9a835c 6px 12px)" }} />
        {[20, 50, 80, 110, 140].map((k) => (
          <div key={k} className="absolute left-[9px] h-[2px] w-[6px] rounded bg-[#4a3820]" style={{ top: k }} />
        ))}
        <div className={`absolute left-1/2 -translate-x-1/2 ${live == null ? "transition-[top] duration-75" : ""}`}
          style={{ top: `${18 + v * 1.14}px` }}>
          <div className="h-8 w-11 rounded-md border-2 border-[#5c3a1a] shadow-[0_2px_5px_rgba(0,0,0,0.7)]"
            style={{ background: "linear-gradient(180deg, #f0d089, #b08d4a 45%, #7c5a2b), repeating-linear-gradient(90deg, rgba(0,0,0,0.35) 0 3px, transparent 3px 7px)" }} />
        </div>
        {(() => {
          const f = v / 100;
          const hy = 148 - 142 * f;
          const cy = 152 - (152 - hy) * 0.35;
          return (
            <svg viewBox="0 0 20 160" preserveAspectRatio="none" className="absolute bottom-1 right-1 top-1 w-5">
              <defs>
                <linearGradient id="pcSailCloth" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#f4f7fa" />
                  <stop offset="1" stopColor="#b9c4d0" />
                </linearGradient>
              </defs>
              <line x1="2.5" y1="3" x2="2.5" y2="158" stroke="#8a5a2b" strokeWidth="2" />
              <line x1="2.5" y1="154" x2="19" y2="154" stroke="#8a5a2b" strokeWidth="2" />
              <path d={`M 2.5 ${hy} Q 14 ${cy} 17 152 L 2.5 152 Z`} fill="url(#pcSailCloth)" stroke="#eef2f6" strokeWidth="0.6" />
              <circle cx="2.5" cy={hy} r="2.6" fill={v >= 100 ? "#fcd34d" : "#d4a24e"} stroke="#5c3a1a" strokeWidth="0.8" />
            </svg>
          );
        })()}
      </div>
      <p className="engrave mt-1 text-[9px]">voile hissée : <b className="font-mono text-amber-300">{v} %</b></p>
    </div>
  );
}

// ---------- Grand levier d'immersion : BINAIRE (surface / plongée) ----------
function DiveLever({ dive, onSet }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const moved = useRef(false);
  const MAX = 34;
  const [ang, setAng] = useState(dive ? MAX : -MAX);
  useEffect(() => { if (!dragging.current) setAng(dive ? MAX : -MAX); }, [dive]);
  const clampA = (a) => Math.max(-MAX, Math.min(MAX, a));
  const angleAt = (e) => {
    const r = ref.current.getBoundingClientRect();
    const s = Math.min(r.width / 140, r.height / 170);
    const ox = (r.width - 140 * s) / 2;
    const oy = (r.height - 170 * s) / 2;
    const x = (e.clientX - r.left - ox) / s;
    const y = (e.clientY - r.top - oy) / s;
    return clampA((Math.atan2(x - 70, 150 - y) * 180) / Math.PI);
  };
  const down = (e) => { dragging.current = true; moved.current = false; e.currentTarget.setPointerCapture(e.pointerId); };
  const move = (e) => { if (!dragging.current) return; moved.current = true; setAng(angleAt(e)); };
  const up = (e) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (moved.current) { const a = angleAt(e); setAng(a > 0 ? MAX : -MAX); onSet(a > 0); }
    else { onSet(!dive); }
  };
  const rr = (ang * Math.PI) / 180;
  const lx = 70 + Math.sin(rr) * 100;
  const ly = 150 - Math.cos(rr) * 100;
  return (
    <div className="flex flex-col items-center">
      <p className="engrave mb-1 text-[8px] uppercase tracking-[0.16em]">immersion</p>
      <button ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className="relative h-[168px] w-[124px] cursor-grab touch-none select-none rounded-lg border-2 border-[#5c3a1a]"
        style={{ background: "linear-gradient(180deg, #1b2430, #0f151e)" }}>
        <svg viewBox="0 0 140 170" className="h-full w-full">
          <path d="M 14 67 A 100 100 0 0 1 126 67" fill="none" stroke="#4a3820" strokeWidth="2" />
          <text x="16" y="50" fontSize="6.5" fill={!dive ? "#fbbf24" : "#8fa3b5"} fontWeight="bold">SURFACE</text>
          <text x="124" y="50" fontSize="6.5" textAnchor="end" fill={dive ? "#67e8f9" : "#8fa3b5"} fontWeight="bold">PLONGÉE</text>
          <line x1="70" y1="150" x2={lx} y2={ly} stroke="#8a5a2b" strokeWidth="7" strokeLinecap="round" />
          <line x1="70" y1="150" x2={lx} y2={ly} stroke="#b87333" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx={lx} cy={ly} r="11" fill="#3b2a17" stroke="#d4a24e" strokeWidth="3" />
          <circle cx={lx} cy={ly} r="4" fill="#d4a24e" />
          <circle cx="70" cy="150" r="8" fill="#8a5a2b" stroke="#5c3a1a" strokeWidth="2" />
          <circle cx="70" cy="14" r="4" fill={dive ? "#67e8f9" : "#26333f"} stroke="#155e75"
            style={dive ? { boxShadow: "0 0 8px rgba(103,232,249,0.9)" } : {}} />
        </svg>
      </button>
      <p className="engrave mt-1 max-w-[116px] text-center text-[8px] leading-tight">
        {dive ? "plongée — radio muette, périscope requis" : "surface — radio libre"}
      </p>
    </div>
  );
}

// ---------- Jauge ronde à aiguille ----------
function Dial({ label, value, max, unit, color }) {
  const a = -135 + (Math.min(value, max) / max) * 270;
  const r = (a * Math.PI) / 180;
  const nx = 50 + Math.sin(r) * 33;
  const ny = 50 - Math.cos(r) * 33;
  const ticks = [-135, -67.5, 0, 67.5, 135];
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 100" className="w-[92px]">
        <circle cx="50" cy="50" r="47" fill="#0d1420" stroke="#8a5a2b" strokeWidth="2.5" />
        {ticks.map((d) => {
          const tr = (d * Math.PI) / 180;
          return <line key={d} x1={50 + Math.sin(tr) * 40} y1={50 - Math.cos(tr) * 40}
            x2={50 + Math.sin(tr) * 45} y2={50 - Math.cos(tr) * 45} stroke="#8fa3b5" strokeWidth="1.2" />;
        })}
        <path d={`M ${50 + Math.sin(-135 * Math.PI / 180) * 42} ${50 - Math.cos(-135 * Math.PI / 180) * 42}
          A 42 42 0 1 1 ${50 + Math.sin(135 * Math.PI / 180) * 42} ${50 - Math.cos(135 * Math.PI / 180) * 42}`}
          fill="none" stroke={color} strokeWidth="2" opacity="0.7" />
        <line x1="50" y1="50" x2={nx} y2={ny} stroke="#eef2f6" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="50" cy="50" r="4" fill="#d4a24e" stroke="#5c3a1a" />
        <text x="50" y="72" textAnchor="middle" fontSize="11" fontWeight="bold" fill="#e3c885" fontFamily="monospace">
          {Math.round(value * 10) / 10}{unit ? <tspan fontSize="7" fill="#8fa3b5">{" " + unit}</tspan> : null}
        </text>
      </svg>
      <span className="engrave mt-0.5 text-[8.5px] uppercase tracking-widest">{label}</span>
    </div>
  );
}

// ---------- Compteur mécanique ----------
function Counter({ label, value }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex overflow-hidden rounded border border-[#5c3a1a] bg-[#08090a]">
        {String(value).split("").map((ch, i) => (
          <span key={i} className="px-1.5 font-mono text-[12px] font-bold text-amber-400"
            style={{ textShadow: "0 0 7px rgba(251,191,36,0.55)" }}>{ch}</span>
        ))}
      </div>
      <span className="engrave mt-0.5 text-[7.5px] uppercase tracking-[0.14em]">{label}</span>
    </div>
  );
}

// ---------- Antenne : manette graduée moletée, throttle 10 Hz + envoi final ----------
function AntennaLever({ label, value, min, max, unit, onCommit }) {
  const lastSent = useRef(0);
  const onInput = (e) => {
    const t = performance.now();
    if (t - lastSent.current > 100) { lastSent.current = t; onCommit(+e.target.value); }
  };
  return (
    <div className="flex items-center gap-2">
      <span className="engrave w-[52px] shrink-0 text-[8.5px] uppercase tracking-wider">{label}</span>
      <div className="flex-1">
        <div className="mb-0.5 flex justify-between px-2">
          {Array.from({ length: 13 }, (_, i) => (
            <span key={i} className={`w-px ${i % 3 === 0 ? "h-[7px] bg-[#c9b48a]" : "h-[4px] bg-[#6b5a35]"}`} />
          ))}
        </div>
        <input type="range" min={min} max={max} value={value} onInput={onInput} onChange={(e) => onCommit(+e.target.value)} className="rngbig w-full" />
      </div>
      <span className="w-[44px] shrink-0 rounded border border-[#5c3a1a] bg-[#08090a] py-0.5 text-center font-mono text-[11px] font-bold text-amber-300"
        style={{ textShadow: "0 0 7px rgba(251,191,36,0.55)" }}>{value}{unit}</span>
    </div>
  );
}

// Radio muette si : ni surface, ni immersion+périscope, ou batteries à 0.
const radioOk = (snap) => {
  const p = snap.player;
  return (p.location === "surface" || (p.location === "underwater" && p.periscope)) && p.battery > 0;
};
const view_antHeading = (snap) => (snap.view || {}).antHeading ?? ((snap.player.heading + snap.player.antOrient + 720) % 360);

// ---------- Poste radio VHF : logique VhfKeypad réutilisée, habillage cuivre ----------
function RadioSet({ snap, cmd, dial, setDial, radioMode, setRadioMode }) {
  const player = snap.player;
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];
  const press = (k) => {
    if (k === "C") return setDial("");
    if (k === "⌫") return setDial(dial.slice(0, -1));
    if (dial.length < 4) setDial(dial + k);
  };
  const ready = dial.length === 4;
  const az = (view_antHeading(snap) + 720) % 360;
  const beam = player.antBeam;
  const hr = (beam / 2) * Math.PI / 180;
  const radioOn = radioOk(snap);
  const by = new Map();
  for (const sg of [...(player.signals || [])].reverse()) {
    const cur = by.get(sg.beaconId);
    if (cur) cur.n++;
    else by.set(sg.beaconId, { sg, n: 1 });
  }
  return (
    <div className="instrument rivets p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="plate rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]">Poste radio — VHF</span>
        <span className={`flex items-center gap-1 text-[9px] uppercase tracking-widest ${radioOn ? "text-emerald-300" : "text-rose-400"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${radioOn ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" : "bg-rose-500"}`} /> {radioOn ? "écoute" : "muette"}
        </span>
      </div>
      <div className="mb-2 h-8 rounded border border-[#244a2f] bg-[#0a1410]"
        style={{ backgroundImage: "radial-gradient(rgba(94,234,212,0.35) 1.1px, transparent 1.3px)", backgroundSize: "6px 6px" }} />
      <div className="flex gap-2.5">
        <div className="flex-1">
          <div className="mb-1.5 flex items-center justify-center gap-1 rounded border border-emerald-900 bg-[#020a08] px-2 py-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={`w-6 text-center font-mono text-base font-bold ${i < dial.length ? "text-emerald-300" : "text-slate-700"}`}>
                {dial[i] || "–"}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {keys.map((k) => (
              <button key={k} onClick={() => press(k)}
                className={`rounded py-1 font-mono text-[12px] font-bold ${k === "C" || k === "⌫"
                  ? "bg-[#4a1a1a] text-rose-200 hover:bg-[#5c2222]"
                  : "bg-gradient-to-b from-[#b87333] to-[#7c4a1a] text-[#1c130a] hover:from-[#d08a4a]"}`}>
                {k}
              </button>
            ))}
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-1">
            <button disabled={!ready || !radioOn} onClick={() => { cmd({ shipMsg: { kind: "posq", to: dial } }); setDial(""); }}
              className={`rounded py-1 text-[9.5px] font-bold uppercase tracking-wide ${ready && radioOn
                ? "bg-gradient-to-b from-[#b87333] to-[#7c4a1a] text-[#1c130a]" : "bg-[#1a2430] text-slate-600 cursor-not-allowed"}`}>❓ Position ?</button>
            <button disabled={!ready || !radioOn} onClick={() => { cmd({ shipMsg: { kind: "mypos", to: dial } }); setDial(""); }}
              className={`rounded py-1 text-[9.5px] font-bold uppercase tracking-wide ${ready && radioOn
                ? "bg-gradient-to-b from-[#b87333] to-[#7c4a1a] text-[#1c130a]" : "bg-[#1a2430] text-slate-600 cursor-not-allowed"}`}>📍 Ma position</button>
          </div>
        </div>
        <div className="w-[104px] shrink-0">
          <svg viewBox="0 0 100 100" className="w-[98px]">
            <circle cx="50" cy="50" r="46" fill="#0d1420" stroke="#7e22ce" strokeWidth="2.5" />
            <path transform={`translate(50 50) rotate(${az})`}
              d={`M 0 0 L ${(-42 * Math.sin(hr)).toFixed(1)} ${(-42 * Math.cos(hr)).toFixed(1)} A 42 42 0 0 1 ${(42 * Math.sin(hr)).toFixed(1)} ${(-42 * Math.cos(hr)).toFixed(1)} Z`}
              fill="rgba(192,132,252,0.25)" stroke="rgba(192,132,252,0.6)" strokeWidth="0.8" />
            <circle cx="50" cy="50" r="3.5" fill="#38bdf8" />
            <text x="50" y="95" textAnchor="middle" fontSize="8" fill="#c084fc" fontFamily="monospace">{Math.round(az)}°</text>
          </svg>
        </div>
      </div>

      <div className="mt-2.5 space-y-2 rounded border border-[#4a3820] bg-[#0a0f16]/60 p-2">
        <AntennaLever label="Faisceau" value={beam} min={1} max={180} unit="°" onCommit={(v) => cmd({ antBeam: v })} />
        <AntennaLever label="Azimut" value={player.antOrient} min={-180} max={180} unit="°" onCommit={(v) => cmd({ antOrient: v })} />
      </div>

      <div className="mt-2.5 flex gap-1.5">
        {["prive", "diffusion"].map((m) => (
          <button key={m} onClick={() => setRadioMode(m)}
            className={`flex-1 rounded border px-2 py-1.5 text-[9.5px] font-bold uppercase tracking-wide transition-transform hover:scale-[1.02] ${radioMode === m
              ? "border-amber-300 bg-gradient-to-b from-[#d08a4a] to-[#8a5a2b] text-[#1c130a] shadow-[inset_0_2px_4px_rgba(0,0,0,0.3),0_0_7px_rgba(251,191,36,0.4)]"
              : "border-[#3a2410] bg-gradient-to-b from-[#6b4a26] to-[#4a3218] text-[#c9b48a] hover:from-[#7d5830]"}`}>
            {m === "prive" ? "🔒 Privé" : "📢 Diffusion"}
          </button>
        ))}
      </div>
      {radioMode === "diffusion" && (
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button disabled={!radioOn} onClick={() => cmd({ shipMsg: { kind: "mypos" } })}
            className={`rounded border py-1 text-[9px] font-bold uppercase tracking-wide ${radioOn
              ? "border-emerald-700 bg-emerald-900/50 text-emerald-200 hover:bg-emerald-800/60" : "border-emerald-950 bg-[#0a1410] text-emerald-900 cursor-not-allowed"}`}>
            📍 Diffuser ma position
          </button>
          <button disabled={!radioOn} onClick={() => cmd({ sos: true })}
            className={`rounded border py-1 text-[9px] font-bold uppercase tracking-wide ${radioOn
              ? "border-rose-700 bg-rose-900/50 text-rose-200 hover:bg-rose-800/60" : "border-rose-950 bg-[#140a0a] text-rose-900 cursor-not-allowed"}`}>
            🆘 Émettre un SOS
          </button>
        </div>
      )}

      <div className="mt-2">
        <p className="engrave mb-1 text-[8px] uppercase tracking-[0.18em]">Autoguidage — verrouiller sur</p>
        <div className="flex gap-1">
          {AUTOGUIDE_MODES.map((m) => (
            <button key={m} onClick={() => cmd({ autoguide: m })}
              className={`flex-1 rounded border px-0.5 py-1.5 text-[8px] font-bold uppercase tracking-wide ${(player.autoguide || AUTOGUIDE_DEFAULT) === m
                ? "border-amber-300 bg-gradient-to-b from-[#d08a4a] to-[#8a5a2b] text-[#1c130a] shadow-[inset_0_2px_4px_rgba(0,0,0,0.3),0_0_7px_rgba(251,191,36,0.4)]"
                : "border-[#3a2410] bg-gradient-to-b from-[#6b4a26] to-[#4a3218] text-[#c9b48a] hover:from-[#7d5830]"}`}>
              {AUTOGUIDE_LABEL[m]}
            </button>
          ))}
        </div>
        {player.beaconLock && (
          <p className="engrave mt-1 text-center text-[8px] uppercase tracking-widest">🔒 verrou engagé : balise {player.beaconLock}</p>
        )}
      </div>
      <div className="mt-2 rounded border border-[#4a3820] p-1.5">
        <div className="paperbg rounded-sm px-2 py-1.5 font-mono text-[9px] leading-relaxed text-[#3a2c14]">
          {by.size === 0
            ? <p>— aucune station captée —</p>
            : [...by.entries()].map(([code, e]) => (
              <p key={code}>{e.sg.kind === "prox" ? "⚡" : "📡"} {code}{e.sg.off ? " [balise désactivée]" : ""} — signal {e.sg.strength}%{e.sg.side ? ` · zone ${e.sg.side}` : ""}{e.n > 1 ? ` · ×${e.n}` : ""}</p>
            ))}
        </div>
        <p className="engrave mt-1 text-center text-[7.5px] uppercase tracking-[0.2em]">ruban des signaux — par station</p>
      </div>
    </div>
  );
}

// ---------- Sonar cathodique : logique SonarTile réutilisée ----------
function SonarScope({ snap, cmd }) {
  const p = snap.player;
  const sonar = snap.sonar || { passive: [], echoes: [] };
  const uw = p.location === "underwater";
  const RMAX = Math.max(...Object.values(SONAR_RANGE_KM));
  const kmPx = (km) => (Math.min(km, RMAX) / RMAX) * 88;
  const pos = (az, r) => {
    const a = (az * Math.PI) / 180;
    return [105 + Math.sin(a) * r, 105 - Math.cos(a) * r];
  };
  return (
    <div className="instrument rivets p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="plate rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]">Sonar — hydrophone</span>
        <span className="text-[8px] uppercase tracking-widest text-emerald-300">passif continu</span>
      </div>
      <div className="relative mx-auto h-[210px] w-[210px] overflow-hidden rounded-full border-[6px] border-[#2c3a2e] bg-[#031408]">
        <div className="pcSweep absolute inset-0 rounded-full" />
        {[0.25, 0.5, 0.75].map((f) => (
          <div key={f} className="absolute rounded-full border border-emerald-500/20"
            style={{ inset: `${(1 - f) * 50}%` }} />
        ))}
        <div className="absolute left-0 right-0 top-1/2 h-px bg-emerald-500/20" />
        <div className="absolute bottom-0 top-0 left-1/2 w-px bg-emerald-500/20" />
        {sonar.passive.map((s, i) => {
          const [x, y] = pos(s.bearing, 88);
          const o = Math.max(0.25, s.strength / 100);
          return (
            <div key={`p${i}`} style={{ opacity: o }}>
              {s.kind === "moteur" && <div className="absolute h-2.5 w-2.5 rounded-full" style={{ left: x - 5, top: y - 5, border: "1.6px solid #f97316", boxShadow: "0 0 6px #f97316" }} />}
              {s.kind === "ping" && <div className="absolute text-[10px] font-bold" style={{ left: x - 4, top: y - 6, color: "#a855f7", textShadow: "0 0 6px #a855f7" }}>✕</div>}
              {s.kind === "biologique" && <div className="absolute text-[10px]" style={{ left: x - 6, top: y - 6, color: "#34d399", textShadow: "0 0 6px #34d399" }}>∿</div>}
              {s.kind === "canon" && <div className="absolute text-[10px]" style={{ left: x - 5, top: y - 6, color: "#fb923c", textShadow: "0 0 6px #fb923c" }}>✳</div>}
              {s.kind === "inconnu" && <div className="absolute text-[11px]" style={{ left: x - 6, top: y - 6, color: "#f8fafc", textShadow: "0 0 6px #f8fafc" }}>⌇</div>}
            </div>
          );
        })}
        {sonar.echoes.map((e, i) => {
          const [x, y] = pos(e.az, kmPx(e.distKm));
          const col = { ile: "#2dd4bf", balise: "#facc15", navire: "#22d3ee", cote: "#94a3b8", biologique: "#34d399" }[e.kind] || "#94a3b8";
          const fade = Math.max(0.15, 1 - e.ageS / SONAR_ECHO_PERSIST_S);
          return (
            <div key={`e${i}`} style={{ opacity: fade, color: col, textShadow: `0 0 6px ${col}` }}>
              {e.kind === "navire" && <span className="absolute text-[10px]" style={{ left: x - 4, top: y - 6 }}>●</span>}
              {e.kind === "biologique" && <span className="absolute text-[10px]" style={{ left: x - 5, top: y - 6 }}>○</span>}
              {e.kind === "balise" && <span className="absolute text-[10px]" style={{ left: x - 5, top: y - 6 }}>◆</span>}
              {e.kind === "ile" && <span className="absolute text-[10px]" style={{ left: x - 5, top: y - 6 }}>▲</span>}
              {e.kind === "cote" && <span className="absolute text-[10px]" style={{ left: x - 5, top: y - 6 }}>◡</span>}
            </div>
          );
        })}
        <svg viewBox="0 0 20 20" className="absolute left-1/2 top-1/2 h-5 w-5"
          style={{ transform: `translate(-50%, -50%) rotate(${p.heading}deg)` }}>
          <path d="M 10 2 L 16 17 L 10 14 L 4 17 Z" fill="#38bdf8" stroke="#e0f2fe" strokeWidth="0.8" />
        </svg>
      </div>
      <button disabled={!uw || p.battery < SONAR_PING_BATTERY_COST} onClick={() => cmd({ ping: true })}
        className={`mt-2.5 w-full rounded border-2 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] ${uw && p.battery >= SONAR_PING_BATTERY_COST
          ? "border-[#155e75] bg-gradient-to-b from-[#0e7490] to-[#155e75] text-[#e0f2fe] hover:from-[#0891b2]"
          : "border-[#123] bg-[#0a1014] text-[#3a4a52] cursor-not-allowed"}`}>
        🔊 Ping — {SONAR_PING_BATTERY_COST} % de batterie
      </button>
      <p className="engrave mt-1 text-center text-[8px] uppercase tracking-widest">gisement seul · le ping donne la distance · {RMAX} km{!uw && " · plongée requise"}</p>
    </div>
  );
}

// ---------- Interrupteur laiton avec voyant ----------
function BrassSwitch({ on, label, onClick }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 rounded-md border border-[#5c3a1a]
      bg-gradient-to-b from-[#3a2c18] to-[#241a0e] px-2 py-1.5 transition-transform hover:scale-[1.03]">
      <span className={`h-2 w-2 rounded-full ${on
        ? "bg-amber-300 shadow-[0_0_7px_2px_rgba(252,211,77,0.85)]" : "bg-[#151515] border border-[#333]"}`} />
      <svg viewBox="0 0 24 30" className="h-7 w-6">
        <circle cx="12" cy="27" r="3.6" fill="#8a5a2b" stroke="#5c3a1a" />
        <line x1="12" y1="27" x2={on ? 4 : 20} y2={on ? 6 : 12} stroke="#d4a24e" strokeWidth="3" strokeLinecap="round" />
        <circle cx={on ? 4 : 20} cy={on ? 6 : 12} r="2.6" fill={on ? "#fcd34d" : "#a9834a"} stroke="#5c3a1a" strokeWidth="0.8" />
      </svg>
      <span className="engrave whitespace-nowrap text-[8px] font-bold uppercase tracking-wide">{label}</span>
    </button>
  );
}

// ---------- Journal de bord : player.notifications filtrés par ruban ----------
const INK = { info: "#2b2b2b", good: "#1e4620", warn: "#7a5a10", bad: "#7a1f1f" };
function LogBook({ snap, filter, setFilter }) {
  const player = snap.player;
  const ribbons = [
    ["tout", "Tout"], ["navire", "Navire"], ["nav", "Nav"], ["meteo", "Météo"],
    ["radio", "Radio"], ["sonar", "Sonar"], ["vision", "Vision"], ["balises", "Balises"], ["alertes", "Alertes"],
  ];
  const shown = (player.notifications || []).filter((e) => filter === "tout" || e.cat === filter);
  return (
    <div className="relative rounded-lg p-3 pt-7"
      style={{ background: "linear-gradient(180deg, #5a4023, #3b2a17)", border: "2px solid #241a0e" }}>
      <div className="absolute left-4 right-4 top-0 flex justify-center gap-0.5">
        {ribbons.map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`px-1.5 pb-0.5 pt-2.5 font-serif text-[8.5px] tracking-wide transition-transform hover:-translate-y-0.5 ${filter === id
              ? "bg-[#7c2d12] text-amber-100" : "bg-[#8a5a2b] text-amber-50/75 hover:bg-[#9a6a3b]"}`}
            style={{ transform: "rotate(-1.5deg)", borderRadius: "2px 2px 0 0" }}>
            {label}
          </button>
        ))}
      </div>
      <div className="paperbg mx-auto flex h-[470px] max-w-[640px] flex-col overflow-hidden rounded-sm px-5 py-3 shadow-[0_0_18px_rgba(0,0,0,0.5)]">
        <h3 className="mb-0.5 font-serif text-base font-bold tracking-wide text-[#3a2c14]">Journal de bord</h3>
        <p className="mb-2 border-b border-[#8a6d3b]/40 pb-1 font-serif text-[10px] italic text-[#6b5a35]">
          navire {player.code} — course du Pacifique — {fmtT(snap.t, snap.epoch)}
        </p>
        <div className="flex-1 overflow-y-auto pr-1"
          style={{ backgroundImage: "repeating-linear-gradient(transparent, transparent 24px, rgba(120,90,40,0.10) 25px)" }}>
          {shown.length === 0
            ? <p className="font-serif text-[12px] italic text-[#6b5a35]">Rien à signaler — mer calme.</p>
            : shown.map((e) => (
              <div key={e.id} className="mb-1 flex gap-2.5 border-l-2 border-[#b91c1c]/40 pl-2.5">
                <span className="w-11 shrink-0 pt-px font-serif text-[10px] tabular-nums text-[#6b5a35]">{fmtTime(e.t, snap.epoch)}</span>
                <span className="font-serif text-[12.5px] leading-snug" style={{ color: INK[e.kind] || INK.info }}>{e.text}</span>
              </div>
            ))}
        </div>
        <p className="mt-1 border-t border-[#8a6d3b]/40 pt-1 font-serif text-[9px] italic text-[#6b5a35]">
          « Toute observation ne vaut que si elle est inscrite. »
        </p>
      </div>
    </div>
  );
}

// ---------- Instruments de pont : chaque instrument = sa fonction ----------
function WeatherBoard({ snap }) {
  const WX = snap.weather;
  const player = snap.player;
  return (
    <div className="instrument rivets p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="plate rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]">Instruments de pont</span>
        <Gear size={18} />
      </div>
      <p className="engrave mb-2 text-center text-[9px] uppercase tracking-[0.18em]">{WX.name}</p>
      <div className="grid grid-cols-3 gap-2">
        {/* anémomètre = vent APPARENT du navire */}
        <Dial label="Anémomètre" value={player.awSpd} max={60} unit="km/h" color="#7dd3fc" />
        {/* girouette : vent vrai */}
        <div className="flex flex-col items-center">
          <svg viewBox="0 0 100 100" className="w-[92px]">
            <circle cx="50" cy="50" r="47" fill="#0d1420" stroke="#8a5a2b" strokeWidth="2.5" />
            {[["N", 0], ["E", 90], ["S", 180], ["O", 270]].map(([c, d]) => {
              const rr = (d * Math.PI) / 180;
              return <text key={c} x={50 + Math.sin(rr) * 36} y={50 - Math.cos(rr) * 36 + 3} textAnchor="middle" fontSize="9" fill="#8fa3b5">{c}</text>;
            })}
            <g transform={`rotate(${WX.windDir} 50 50)`}>
              <path d="M 50 12 L 55 44 L 50 38 L 45 44 Z" fill="#93c5fd" />
              <line x1="50" y1="50" x2="50" y2="38" stroke="#93c5fd" strokeWidth="1.6" />
            </g>
            <circle cx="50" cy="50" r="3.5" fill="#d4a24e" stroke="#5c3a1a" />
          </svg>
          <span className="engrave mt-0.5 text-[8.5px] uppercase tracking-widest">Girouette</span>
          <span className="font-mono text-[9px] text-sky-300">{WX.windDir}°</span>
        </div>
        {/* nébulosité : la lucarne de ciel se voile — l'opacité = la couverture */}
        <div className="flex flex-col items-center">
          <div className="relative h-[74px] w-[88px] overflow-hidden rounded-md border-2 border-[#8a5a2b]"
            style={{ background: "linear-gradient(180deg, #38bdf8, #bae6fd 70%, #e0f2fe)" }}>
            <div className="absolute right-[9px] top-[7px] h-[18px] w-[18px] rounded-full bg-[#fde68a]"
              style={{ opacity: Math.max(0.08, 1 - WX.clouds / 110), boxShadow: "0 0 10px rgba(253,230,138,0.8)" }} />
            <div className="absolute inset-0" style={{ opacity: WX.clouds / 100, background: "linear-gradient(180deg, #e2e8f0, #cbd5e1)" }} />
            <div className="pcFog absolute inset-0" style={{ opacity: (WX.clouds / 100) * 0.55 }}>
              {[[-6, 4, 34, 16], [18, 22, 40, 18], [46, 2, 36, 15], [58, 26, 38, 16]].map(([x, y, rw, rh], i) => (
                <span key={i} className="absolute rounded-[50%] blur-[2px] bg-white"
                  style={{ left: `${x}%`, top: `${y}px`, width: rw, height: rh }} />
              ))}
            </div>
          </div>
          <span className="engrave mt-0.5 text-[8.5px] uppercase tracking-widest">Nébulosité</span>
          <span className="font-mono text-[9px] text-slate-300">{WX.clouds} % — ciel voilé</span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-[#4a3820] bg-[#0a0f16]/60 p-2">
        {/* thermomètre */}
        <div className="flex items-center justify-center gap-1.5">
          <svg viewBox="0 0 30 90" className="h-[86px] w-[26px]">
            <rect x="10" y="6" width="10" height="66" rx="5" fill="#0d1420" stroke="#8a5a2b" strokeWidth="1.5" />
            <circle cx="15" cy="78" r="7" fill="#7f1d1d" stroke="#8a5a2b" strokeWidth="1.5" />
            <rect x="12" y={72 - (WX.temp / 40) * 62} width="6" height={(WX.temp / 40) * 62 + 2} rx="3" fill="#ef4444" />
            {[0, 10, 20, 30, 40].map((t) => (
              <g key={t}>
                <line x1="21" y1={72 - (t / 40) * 62} x2="25" y2={72 - (t / 40) * 62} stroke="#8fa3b5" strokeWidth="1" />
                <text x="24" y={75 - (t / 40) * 62} fontSize="6" fill="#8fa3b5">{t}</text>
              </g>
            ))}
          </svg>
          <div>
            <p className="engrave text-[8px] uppercase tracking-widest">Thermo.</p>
            <p className="font-mono text-[13px] font-bold text-amber-300">{WX.temp} °C</p>
          </div>
        </div>
        {/* houle : échelle de Douglas */}
        <div className="flex flex-col items-center">
          <div className="relative h-[80px] w-8 overflow-hidden rounded border border-[#5c3a1a] bg-[#0d1420]">
            <div className="absolute inset-x-0 bottom-0 bg-sky-800/70" style={{ height: `${(WX.douglas / 9) * 100}%` }} />
            <div className="absolute inset-x-0 border-t-2 border-amber-400" style={{ bottom: `${(WX.douglas / 9) * 100}%` }} />
          </div>
          <span className="engrave mt-0.5 text-[8px] uppercase tracking-widest">Houle — Douglas {WX.douglas}</span>
          <span className="font-mono text-[9px] text-sky-300">{WX.hs} m · {DOUGLAS_LABEL[WX.douglas]}</span>
        </div>
        {/* visibilité */}
        <div className="flex flex-col items-center justify-center gap-1">
          <svg viewBox="0 0 100 60" className="w-[80px]">
            <ellipse cx="50" cy="30" rx="20" ry="13" fill="none" stroke="#7dd3fc" strokeWidth="2" />
            <circle cx="50" cy="30" r="6" fill="#7dd3fc" />
            <circle cx="50" cy="30" r="2.2" fill="#0d1420" />
            <path d="M 12 30 Q 50 -2 88 30" fill="none" stroke="#7dd3fc" strokeWidth="1" opacity="0.6" />
            <path d="M 12 30 Q 50 62 88 30" fill="none" stroke="#7dd3fc" strokeWidth="1" opacity="0.6" />
          </svg>
          <span className="engrave text-[8px] uppercase tracking-widest">Visibilité</span>
          <span className="font-mono text-[13px] font-bold text-amber-300">{WX.visibility} km</span>
          <span className="text-[7.5px] uppercase tracking-wide text-amber-200/70">
            {WX.fog ? "brouillard dense" : WX.storm ? "⛈️ tempête" : WX.rain > 20 ? "pluie en cours" : "air clair"}
          </span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-[#4a3820] bg-[#0a0f16]/60 px-2 py-1.5">
        <svg viewBox="0 0 40 40" className="h-8 w-8">
          <g transform={`rotate(${WX.curDir} 20 20)`}>
            <line x1="20" y1="38" x2="20" y2="10" stroke="#5eead4" strokeWidth="2.4" />
            <polygon points="20,4 15,13 25,13" fill="#5eead4" />
          </g>
        </svg>
        <p className="engrave text-[9px] leading-tight">
          <b className="font-mono text-teal-300">{WX.curSpd} km/h · {WX.curDir}°</b> — courant :<br />
          affiché au quart, non intégré à l'estime
        </p>
        <p className="engrave text-[9px] leading-tight">
          vent vrai <b className="font-mono text-sky-300">{WX.windSpd} km/h au {WX.windDir}°</b><br />
          apparent <b className="font-mono text-sky-300">{Math.round(player.awSpd)} km/h {player.awRel >= 0 ? "T" : "B"}</b>
        </p>
      </div>
    </div>
  );
}

export default function Helm({ snap, sock, status, onManual, onShop, onNetwork, superBlock, canShop }) {
  const cmd = (data) => sock && sock.command(data);
  const player = snap.player;
  const weather = snap.weather;
  const view = snap.view || {};
  const d = new Date(snap.epoch + snap.t * MS_PER_MIN);
  const hour = d.getHours() + d.getMinutes() / 60;
  const [regardCabin, setRegardCabin] = useState(42);
  const [dial, setDial] = useState("");
  const [radioMode, setRadioMode] = useState("prive");
  const [logFilter, setLogFilter] = useState("tout");
  const uw = player.location === "underwater";
  const wheelLocked = player.autopilot || !!player.beaconLock;
  const canCapture = (view.beacons || []).some((b) => b.km <= CAPTURE_R_KM);

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
              <span className={`flex items-center gap-1 rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${status === "connected" ? "border-emerald-800 bg-[#141b26] text-emerald-300" : "border-amber-800 bg-[#241b0e] text-amber-300"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${status === "connected" ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" : "bg-amber-400"}`} /> {status === "connected" ? "en ligne" : "reconnexion…"}
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
            {canShop && <button onClick={onShop} className="plate rounded px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider hover:brightness-110">📦 Avitaillement</button>}
            {snap.networkZone && <button onClick={onNetwork} className="plate rounded px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider hover:brightness-110">📡 NETWORK</button>}
          </div>
        </div>

        {/* Pont principal : console de barre | table à cartes | radio + sonar */}
        <div className="grid grid-cols-12 gap-3">

          {/* CONSOLE DE BARRE */}
          <div className="col-span-12 xl:col-span-3">
            <div className="instrument rivets p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="plate rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]">Console de barre</span>
                <Gear size={16} />
              </div>
              <div className="flex items-center justify-center gap-1">
                <Wheel order={player.headingOrder} heading={player.heading} disabled={wheelLocked} onOrder={(v) => cmd({ headingOrder: v })} />
                <Binnacle heading={player.heading} order={player.headingOrder} regard={regardCabin} />
              </div>
              <p className="engrave mt-1 text-center text-[7.5px] uppercase tracking-[0.2em]">
                {wheelLocked ? "barre verrouillée — pilote ou verrou balise" : "glisser la roue pour barrer — repère ambre = consigne sur la rose"}
              </p>

              <div className="mt-3 space-y-2.5 rounded-lg border border-[#4a3820] bg-[#0a0f16]/60 p-2.5">
                <div>
                  <HandleLever label="Moteur thermique" value={Math.round(player.engine * 100)} onChange={(v) => cmd({ engine: v / 100 })} />
                  <div className="mt-1 flex items-center gap-1.5">
                    <button onClick={() => cmd({ engineOn: !player.engineOn })}
                      className={`rounded border px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide ${player.engineOn
                        ? "border-amber-400 bg-amber-500/90 text-[#201503]" : "border-[#5c3a1a] bg-[#241a0e] text-amber-200/70"}`}>contact</button>
                    <span className={`h-2 w-2 rounded-full ${player.engineOn ? "bg-amber-300 shadow-[0_0_7px_2px_rgba(252,211,77,0.85)]" : "bg-[#151515] border border-[#333]"}`} />
                    <span className="engrave text-[7.5px] uppercase tracking-widest">moteur {player.engineOn ? "en marche" : "coupé"}</span>
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="engrave w-[86px] shrink-0 text-[9px] uppercase leading-tight tracking-wider">Moteur électrique</span>
                    <button onClick={() => cmd({ electricOn: !player.electricOn })}
                      className={`flex-1 rounded border py-1 text-[9px] font-bold uppercase tracking-wide ${player.electricOn
                        ? "border-cyan-300 bg-gradient-to-b from-[#0e7490] to-[#155e75] text-[#e0f2fe]" : "border-[#3a2410] bg-gradient-to-b from-[#6b4a26] to-[#4a3218] text-[#c9b48a]"}`}>
                      {player.electricOn ? "■ 100 %" : "□ 0 %"}
                    </button>
                    <span className="w-9 text-right font-mono text-[11px] text-cyan-300">{player.electricOn ? 100 : 0} %</span>
                  </div>
                </div>
              </div>

              <div className="mt-2.5 flex items-stretch justify-center gap-2">
                <RopeHandle value={player.sail} onCommit={(v) => cmd({ sail: v })} />
                <DiveLever dive={uw} onSet={(down) => cmd(down ? { dive: true } : { surface: true })} />
              </div>

              <div className="mt-2.5 flex items-end justify-center gap-1">
                <Dial label="⛽ Carburant" value={player.fuel} max={100} unit="%" color="#fb923c" />
                <Dial label="🔋 Batteries" value={player.battery} max={100} unit="%" color="#4ade80" />
                <Dial label="🍲 Vivres" value={player.food} max={100} unit="%" color="#e879f9" />
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 rounded-lg border border-[#4a3820] bg-[#0a0f16]/60 px-2 py-2">
                <Counter label="vitesse km/h" value={player.vkmh.toFixed(1)} />
                <Counter label="incertitude km" value={player.unc.toFixed(1)} />
                <Counter label="distance km" value={Math.round(player.travelledKm)} />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-lg border border-[#4a3820] bg-[#0a0f16]/60 p-2">
                <BrassSwitch on={player.mast} label="Mât" onClick={() => cmd({ mast: !player.mast })} />
                <BrassSwitch on={uw && player.periscope} label="Périscope" onClick={() => cmd({ periscope: !player.periscope })} />
                <BrassSwitch on={player.light} label="Phare" onClick={() => cmd({ light: !player.light })} />
                <BrassSwitch on={player.anchored} label="Ancre" onClick={() => cmd({ anchor: !player.anchored })} />
              </div>

              <div className="mt-2.5 flex justify-center">
                <button onClick={() => cmd({ capture: true })} disabled={!canCapture}
                  className={`flex items-center gap-2 rounded-full border-2 py-1 pl-1.5 pr-3 transition-transform hover:scale-[1.03] ${canCapture
                    ? "border-[#5c3a1a] bg-gradient-to-b from-[#3a2c18] to-[#241a0e]"
                    : "border-[#3a2c18] bg-[#1a140c] opacity-50 cursor-not-allowed"}`}>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#78350f] text-[12px]
                    bg-gradient-to-b from-[#ef4444] to-[#7f1d1d] shadow-[0_0_8px_rgba(239,68,68,0.5)]">📦</span>
                  <span className="engrave text-[8.5px] font-bold uppercase tracking-[0.12em]">Amarrer la balise — {Math.round(CAPTURE_R_KM * 1000)} m</span>
                </button>
              </div>
            </div>
          </div>

          {/* TABLE À CARTES */}
          <div className="col-span-12 xl:col-span-5">
            <div className="instrument rivets p-3">
              <NavMap snap={snap} sock={sock} />
            </div>
          </div>

          {/* RADIO + SONAR */}
          <div className="col-span-12 space-y-3 xl:col-span-4">
            <RadioSet snap={snap} cmd={cmd} dial={dial} setDial={setDial} radioMode={radioMode} setRadioMode={setRadioMode} />
            <SonarScope snap={snap} cmd={cmd} />
          </div>

          {/* JOURNAL DE BORD */}
          <div className="col-span-12 xl:col-span-8">
            <LogBook snap={snap} filter={logFilter} setFilter={setLogFilter} />
          </div>

          {/* INSTRUMENTS DE PONT */}
          <div className="col-span-12 xl:col-span-4">
            <WeatherBoard snap={snap} />
          </div>
        </div>

        <p className="mt-4 text-center font-serif text-[11px] italic text-amber-200/50">
          Poste de barre — branche experimental
        </p>
      </div>
    </div>
  );
}
