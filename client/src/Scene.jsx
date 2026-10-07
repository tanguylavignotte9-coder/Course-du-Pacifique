import React, { useMemo } from "react";
import { KM_PER_NM } from "../../shared/engine.js";

// ============================================================
// Scène d'ambiance — fond plein écran derrière l'interface.
// Reprise du proto : ciel interpolé heure par heure, soleil en
// arc, étoiles, nuages dérivants, pluie 3 couches, brouillard,
// éclairs, mer qui tangue (Douglas), immersion avec bulles.
// Pilotes : heure de jeu + météo du snapshot serveur.
// ============================================================

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

// Décor déterministe (étoiles, bulles, nuages) — mêmes positions à chaque partie.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const STARS = (() => { const r = mulberry32(90210); return Array.from({ length: 46 }, () => ({ x: r() * 100, y: r() * 52, s: 1 + Math.round(r() * 2), d: Math.round(r() * 30) / 10 })); })();
const BUBBLES = (() => { const r = mulberry32(31415); return Array.from({ length: 14 }, () => ({ x: r() * 100, s: 3 + Math.round(r() * 6), dur: 7 + Math.round(r() * 9), del: Math.round(r() * 10) })); })();
const CLOUDS = (() => {
  const r = mulberry32(777);
  return Array.from({ length: 18 }, () => {
    const streak = r() < 0.3;
    const w = streak ? 220 + Math.round(r() * 300) : 120 + Math.round(r() * 240);
    const h = streak ? 14 + Math.round(r() * 12) : 30 + Math.round(r() * 56);
    const np = streak ? 2 : 3 + Math.floor(r() * 3);
    return {
      x: r() * 100, y: r() * 55, w, h, o: 0.5 + r() * 0.5, streak,
      puffs: Array.from({ length: np }, () => ({
        dx: Math.round((r() * 0.7 - 0.35) * w), dy: Math.round((r() * 0.5 - 0.25) * h),
        rw: Math.round((0.4 + r() * 0.5) * w), rh: Math.round((0.55 + r() * 0.65) * h),
      })),
    };
  });
})();

export default function Scene({ hour, weather, underwater }) {
  const w = weather;
  const uw = underwater;

  // Mémoïsation des couleurs du ciel (rendu 1×/s avec le snapshot)
  const [skyTop, skyBot] = useMemo(() => skyColors(hour), [Math.floor(hour * 4)]);
  const sunUp = hour >= 6 && hour < 20;
  const sunF = Math.max(0, Math.min(1, (hour - 6) / 14));
  const sunX = 4 + sunF * 92;
  const sunY = 60 - Math.sin(sunF * Math.PI) * 48;

  const starOpacity = (hour < 5 ? 1 : hour < 7 ? (7 - hour) / 2 : hour >= 19 ? Math.min(1, (hour - 19) / 2) : 0) * (1 - (w.clouds / 100) * 0.85);
  const waveAmp = 0.25 + 0.26 * Math.pow(w.douglas, 1.25);
  const rollAmp = !uw ? Math.min(4.5, 0.45 * w.douglas) : 0.2;
  const bobAmp = !uw ? Math.min(22, 3.5 * w.douglas) : 0;
  const cloudTint = [226, 232, 240].map((v, i) => Math.round(v - (w.rain / 100) * (v - [100, 116, 139][i]))).join(",");
  const ambient = sunUp ? Math.max(0.25, 1 - w.clouds / 160) : 0;
  const fogTint = (day) => [15, 23, 42].map((nv, i) => Math.round(nv + (day[i] - nv) * ambient)).join(",");
  const uwLight = sunUp ? Math.max(0.3, 1 - w.clouds / 160) : 0.14;
  const rainF = (a, b) => Math.max(0, Math.min(1, (w.rain - a) / (b - a)));
  const rainSpeed = 1 - 0.3 * rainF(50, 100);

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
      <style>{`
        @keyframes pcTwinkle { 0%,100% { opacity: .9 } 50% { opacity: .15 } }
        @keyframes pcWave { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        @keyframes pcRain { from { transform: translate3d(0, 0, 0) } to { transform: translate3d(0, var(--tileY, 300px), 0) } }
        @keyframes pcFog { from { transform: translateX(-6%) } to { transform: translateX(6%) } }
        @keyframes pcFlash { 0%, 91% { opacity: 0 } 92% { opacity: .9 } 94% { opacity: 0 } 96% { opacity: .55 } 100% { opacity: 0 } }
        @keyframes pcBubble { from { transform: translateY(0); opacity: .55 } to { transform: translateY(-105vh); opacity: 0 } }
        @keyframes pcRoll { 0%,100% { transform: rotate(calc(-1 * var(--rollAmp, 0deg))) } 50% { transform: rotate(var(--rollAmp, 0deg)) } }
        @keyframes pcBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(var(--bobAmp, 0px)) } }
        .pcStar { animation: pcTwinkle 3s ease-in-out infinite }
        .pcRain { animation: pcRain .9s linear infinite; will-change: transform }
        .pcFog { animation: pcFog 24s ease-in-out infinite alternate }
        .pcFlash { animation: pcFlash 7s linear infinite }
        .pcBubble { animation: pcBubble linear infinite }
        .pcRoll { animation: pcRoll var(--rollDur, 6s) ease-in-out infinite }
      `}</style>

      {!uw && (<>
        {/* Ciel */}
        <div className="absolute inset-0" style={{ background: `linear-gradient(${skyTop}, ${skyBot})` }} />
        {/* Étoiles */}
        <div className="absolute inset-0 transition-opacity duration-2000" style={{ opacity: starOpacity }}>
          {STARS.map((st, i) => (
            <div key={i} className="pcStar absolute rounded-full bg-white"
              style={{ left: `${st.x}%`, top: `${st.y}%`, width: st.s, height: st.s, animationDelay: `${st.d}s` }} />
          ))}
        </div>
        {/* Soleil */}
        <div className="absolute" style={{ left: `${sunX}%`, top: `${sunY}%`, opacity: sunUp ? 1 : 0, transform: "translate(-50%, -50%)", transition: "left 1s linear, top 1s linear, opacity 3s" }}>
          <div className="h-20 w-20 rounded-full"
            style={{ background: "radial-gradient(circle, #fffbeb 25%, #fde68a 45%, rgba(251,191,36,0.35) 70%, transparent 100%)", boxShadow: "0 0 60px 25px rgba(251,191,36,0.35)" }} />
        </div>
        {/* Voile de couverture nuageuse */}
        <div className="absolute inset-0 transition-opacity duration-2000"
          style={{ opacity: Math.max(0, (w.clouds - 40) / 60), background: `linear-gradient(rgba(${cloudTint}, 0.9), rgba(${cloudTint}, 0.65))` }} />
        {/* Bancs de nuages dérivants */}
        <div className="absolute inset-0 transition-opacity duration-2000" style={{ opacity: (w.clouds / 100) * 0.95 }}>
          {[0, 1].map((k) => (
            <div key={k} className="pcFog absolute left-[-15%] w-[130%]"
              style={{ top: k ? "4%" : "-8%", height: "62%", animationDuration: k ? "170s" : "120s", animationDelay: k ? "-50s" : "0s" }}>
              {CLOUDS.filter((_, i) => i % 2 === k).map((c, i) => (
                <div key={i} className="absolute" style={{ left: `${c.x}%`, top: `${c.y}%`, width: c.w, height: c.h, opacity: c.o }}>
                  {c.puffs.map((p, j) => (
                    <div key={j} className={`absolute rounded-[50%] ${c.streak ? "blur-xl" : "blur-md"}`}
                      style={{ left: p.dx, top: p.dy, width: p.rw, height: p.rh, background: `rgba(${cloudTint},${(c.streak ? 0.4 : 0.75) * c.o})` }} />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Mer qui tangue : la seule couche mobile avec la houle */}
        <div className="pcRoll absolute -inset-[2.5%]" style={{ "--rollAmp": `${rollAmp}deg`, "--rollDur": `${Math.max(4, w.period)}s` }}>
          <div className="absolute inset-x-0 bottom-0" style={{ height: "26%", animation: `pcBob ${Math.max(4, w.period)}s ease-in-out infinite`, "--bobAmp": `${bobAmp}px` }}>
            <div className="absolute inset-0" style={{ background: "linear-gradient(rgba(8,47,73,0.9), #061527)" }} />
            {[0, 1].map((k) => (
              <div key={k} className="absolute inset-x-0 top-0 h-12 overflow-hidden">
                <div className="absolute left-0 top-0 h-12" style={{ width: "200%", animation: `pcWave ${Math.max(3, w.period) * (k ? 1.6 : 1)}s linear infinite ${k ? "reverse" : "normal"}` }}>
                  <svg viewBox="0 0 1200 80" preserveAspectRatio="none" className="h-12 w-full"
                    style={{ transform: `scaleY(${k ? waveAmp * 0.6 : waveAmp})`, transformOrigin: "top", opacity: k ? 0.35 : 0.55 }}>
                    <path d="M0 50 Q 75 15 150 50 T 300 50 T 450 50 T 600 50 T 750 50 T 900 50 T 1050 50 T 1200 50 V 80 H 0 Z" fill="rgba(125,211,252,0.5)" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Pluie : 3 couches d'intensité croissante */}
        <div className="absolute -inset-[18%] rotate-[11deg] overflow-hidden">
          <div className="pcRain absolute left-0 w-full transition-opacity duration-1000" style={{ "--tileY": "300px", top: "-300px", height: "calc(100% + 300px)", animationDuration: `${0.3 * rainSpeed}s`, opacity: rainF(75, 100),
            backgroundImage: "radial-gradient(ellipse 2px 20px at 22% 28%, rgba(203,213,225,0.6) 99%, transparent), radial-gradient(ellipse 1.6px 16px at 68% 74%, rgba(203,213,225,0.45) 99%, transparent)",
            backgroundSize: "170px 300px" }} />
          <div className="pcRain absolute left-0 w-full transition-opacity duration-1000" style={{ "--tileY": "260px", top: "-260px", height: "calc(100% + 260px)", animationDuration: `${0.45 * rainSpeed}s`, opacity: rainF(55, 80),
            backgroundImage: "radial-gradient(ellipse 1.6px 15px at 45% 15%, rgba(203,213,225,0.5) 99%, transparent), radial-gradient(ellipse 1.3px 12px at 80% 55%, rgba(203,213,225,0.4) 99%, transparent), radial-gradient(ellipse 1.6px 15px at 12% 62%, rgba(203,213,225,0.45) 99%, transparent)",
            backgroundSize: "220px 260px" }} />
          <div className="pcRain absolute left-0 w-full transition-opacity duration-1000" style={{ "--tileY": "200px", top: "-200px", height: "calc(100% + 200px)", animationDuration: `${0.65 * rainSpeed}s`, opacity: rainF(25, 50),
            backgroundImage: "radial-gradient(ellipse 1px 10px at 30% 40%, rgba(203,213,225,0.4) 99%, transparent), radial-gradient(ellipse 1px 9px at 60% 80%, rgba(203,213,225,0.35) 99%, transparent), radial-gradient(ellipse 1px 9px at 85% 20%, rgba(203,213,225,0.3) 99%, transparent)",
            backgroundSize: "130px 200px" }} />
        </div>
        {/* Brouillard : voile + 3 bancs, teintés par la lumière ambiante */}
        <div className="absolute inset-0 transition-opacity duration-3000" style={{ opacity: w.fog ? 1 : 0 }}>
          <div className="absolute inset-0" style={{ background: `linear-gradient(rgba(${fogTint([203, 213, 225])},0.55), rgba(${fogTint([148, 163, 184])},0.5))` }} />
          <div className="pcFog absolute left-[-15%] top-[8%] h-[55%] w-[130%] blur-3xl" style={{ background: `rgba(${fogTint([203, 213, 225])},0.75)`, animationDuration: "40s" }} />
          <div className="pcFog absolute bottom-[6%] left-[-15%] h-[60%] w-[130%] blur-3xl" style={{ background: `rgba(${fogTint([148, 163, 184])},0.8)`, animationDuration: "55s", animationDelay: "-18s" }} />
          <div className="pcFog absolute left-[-15%] top-[35%] h-[50%] w-[130%] blur-3xl" style={{ background: `rgba(${fogTint([226, 232, 240])},0.65)`, animationDuration: "70s", animationDelay: "-32s" }} />
        </div>
        {/* Tempête : assombrissement + éclairs */}
        <div className="absolute inset-0 transition-opacity duration-2000" style={{ background: "rgba(2,6,23,0.5)", opacity: w.storm ? 1 : 0 }} />
        {w.storm && (
          <div className="pcFlash absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% -10%, rgba(224,242,254,0.9), transparent 55%)" }} />
        )}
      </>)}

      {/* Plongée : colonne d'eau sombre éclairée selon le soleil */}
      {uw && (
        <>
          <div className="absolute inset-0" style={{ background: "linear-gradient(#0a4d75, #05263f 45%, #02101f)" }} />
          <div className="absolute inset-0 transition-opacity duration-2000" style={{ background: "#010409", opacity: 1 - uwLight }} />
          {sunUp && (
            <div className="absolute inset-0 transition-opacity duration-2000"
              style={{ background: `radial-gradient(ellipse 55% 38% at ${sunX}% -6%, rgba(186,230,253,${0.55 * uwLight}), transparent 70%)` }} />
          )}
          {BUBBLES.map((b, i) => (
            <div key={i} className="pcBubble absolute rounded-full border border-sky-300/60 bg-sky-300/10"
              style={{ left: `${b.x}%`, bottom: "-3%", width: b.s, height: b.s, animationDuration: `${b.dur}s`, animationDelay: `${b.del}s` }} />
          ))}
        </>
      )}
    </div>
  );
}
