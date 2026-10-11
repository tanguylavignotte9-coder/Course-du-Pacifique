import React, { useEffect, useRef, useState } from "react";
import { MAP, DEG_KM, distKm, PINS_MAX } from "../../shared/engine.js";
// ---------- NavMap : carte papier (punaises, mesures, tracé, pilote, trace, zoom/pan/pinch) ----------
// Extrait TEL QUEL de l'ancien App.jsx — logique interne intacte (clics francs,
// letterbox, pincement, suppression), habillage cuivre de la table à cartes.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function ToolBtn({ active, onClick, disabled, children, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`flex w-[54px] flex-col items-center gap-0.5 rounded-md border py-1 transition-transform hover:scale-[1.04] ${disabled ? "cursor-not-allowed opacity-40 " : ""}${active
        ? "border-amber-400 bg-amber-500/90 text-[#201503]"
        : "border-[#5c3a1a] bg-[#241a0e] text-amber-200/90"}`}>
      {children}
    </button>
  );
}

export default function NavMap({ snap, sock }) {
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
  const [hoverPt, setHoverPt] = useState(null);

  const clampVB = (v) => ({ ...v, x: clamp(v.x, 0, MAP_PX - v.w), y: clamp(v.y, 0, MAP_PX - v.w) });
  const zoomAt = (v, factor, zx, zy) => {
    const w = clamp(v.w / factor, MAP_PX / 8, MAP_PX);
    const k = w / v.w;
    return clampVB({ x: zx - (zx - v.x) * k, y: zy - (zy - v.y) * k, w });
  };
  const vbPoint = (v, rect, cx, cy) => {
    const scale = Math.min(rect.width / v.w, rect.height / v.w);
    const ox = (rect.width - v.w * scale) / 2;
    const oy = (rect.height - v.w * scale) / 2;
    return { x: v.x + (cx - rect.left - ox) / scale, y: v.y + (cy - rect.top - oy) / scale };
  };
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
  const kmOf = (a, b) => distKm(a[0], a[1], b[0], b[1]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="plate rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]">Table à cartes — officielle n° 04</span>
        <div className="flex flex-wrap gap-1">
          <ToolBtn active={tool === "pin"} onClick={() => { setTool(tool === "pin" ? null : "pin"); setMeasurePend(null); }} title="Épingler">
            <span className="text-[11px] leading-none">📌</span>
            <span className="text-[7px] font-bold uppercase leading-none tracking-wide">Épingler</span>
          </ToolBtn>
          <ToolBtn active={tool === "measure"} onClick={() => { setTool(tool === "measure" ? null : "measure"); setMeasurePend(null); }} title="Mesurer">
            <span className="text-[11px] leading-none">📏</span>
            <span className="text-[7px] font-bold uppercase leading-none tracking-wide">Mesurer</span>
          </ToolBtn>
          <ToolBtn active={planMode} onClick={() => setPlanMode(!planMode)} title="Tracer">
            <span className="text-[11px] leading-none">🧭</span>
            <span className="text-[7px] font-bold uppercase leading-none tracking-wide">Tracer</span>
          </ToolBtn>
          <ToolBtn
            active={player.autopilot}
            disabled={player.wpIdx >= (player.waypoints || []).length && !player.autopilot}
            onClick={() => sock.command({ autopilot: !player.autopilot })} title="Pilote"
          >
            <span className="text-[11px] leading-none">🤖</span>
            <span className="text-[7px] font-bold uppercase leading-none tracking-wide">Pilote</span>
          </ToolBtn>
          <ToolBtn onClick={() => sock.command({ traceClear: true })} disabled={!(player.trace || []).length} title="Effacer la trace">
            <span className="text-[11px] leading-none">🧹</span>
            <span className="text-[7px] font-bold uppercase leading-none tracking-wide">Effacer</span>
          </ToolBtn>
          <span className="flex gap-1">
            <ToolBtn onClick={() => setVB((v) => zoomAt(v, 1.5, v.x + v.w / 2, v.y + v.w / 2))} title="Zoom +">
              <span className="text-[11px] leading-none">➕</span>
              <span className="text-[7px] font-bold uppercase leading-none tracking-wide">Zoom</span>
            </ToolBtn>
            <ToolBtn onClick={() => setVB((v) => zoomAt(v, 1 / 1.5, v.x + v.w / 2, v.y + v.w / 2))} title="Zoom −">
              <span className="text-[11px] leading-none">➖</span>
              <span className="text-[7px] font-bold uppercase leading-none tracking-wide">Zoom</span>
            </ToolBtn>
            <ToolBtn onClick={() => setVB({ x: 0, y: 0, w: MAP_PX })} title="Vue globale">
              <span className="text-[11px] leading-none">⤢</span>
              <span className="text-[7px] font-bold uppercase leading-none tracking-wide">Vue</span>
            </ToolBtn>
          </span>
        </div>
      </div>
      {(planMode || player.pins.length > 0 || player.measures.length > 0) && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {planMode && (
            <>
              <button onClick={() => sock.command({ waypoints: player.waypoints.slice(0, -1) })} className="rounded border border-[#5c3a1a] bg-[#241a0e] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-200/90 hover:border-amber-500">🗑 Dernier point</button>
              <button onClick={() => sock.command({ waypoints: [] })} className="rounded border border-[#5c3a1a] bg-[#241a0e] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-200/90 hover:border-amber-500">🗑 Route entière</button>
            </>
          )}
          {player.pins.length > 0 && (
            <button onClick={() => sock.command({ pins: player.pins.slice(0, -1) })} className="rounded border border-[#5c3a1a] bg-[#241a0e] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-200/90 hover:border-amber-500">🗑 Dernière punaise</button>
          )}
          {player.measures.length > 0 && (
            <button onClick={() => sock.command({ measures: [] })} className="rounded border border-[#5c3a1a] bg-[#241a0e] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wide text-amber-200/90 hover:border-amber-500">🗑 Mesures</button>
          )}
        </div>
      )}
      <div className="relative rounded-lg border-4 border-[#241a0e] bg-[#8fb4d4] p-1 shadow-inner">
        <svg
          ref={svgRef}
          viewBox={`${vb.x.toFixed(2)} ${vb.y.toFixed(2)} ${vb.w.toFixed(2)} ${vb.w.toFixed(2)}`}
          className={`w-full rounded ${tool || planMode ? "cursor-crosshair" : "cursor-grab"}`}
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
            if ((tool === "measure" && measurePend) || planMode) {
              if (!drag.current || drag.current.moved < 5) {
                const hp = vbPoint(vb, rect, e.clientX, e.clientY);
                setHoverPt([hp.x / S, MAP - hp.y / S]);
              }
            }
            if (ids.length >= 2 && pinch.current) {
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
          {Array.from({ length: 11 }, (_, k) => (k + 1) * 5).map((d) => (
            <g key={d}>
              <line x1={d * S} y1={0} x2={d * S} y2={MAP_PX} stroke="rgba(15,42,71,0.35)" strokeWidth={d % 15 === 0 ? 1 : 0.5} />
              <line x1={0} y1={MAP_PX - d * S} x2={MAP_PX} y2={MAP_PX - d * S} stroke="rgba(15,42,71,0.35)" strokeWidth={d % 15 === 0 ? 1 : 0.5} />
              <text x={d * S + 2} y={vb.y + 9} fontSize="7" fill="#3d5a75">{d}°E</text>
              <text x={vb.x + 4} y={MAP_PX - d * S - 3} fontSize="7" fill="#3d5a75">{d}°N</text>
            </g>
          ))}
          <polygon points={world.continent.map(([vx, vy]) => `${px(vx)},${py(vy)}`).join(" ")} fill="#d9cba3" stroke="#8a7a55" strokeWidth="1.2" />
          {world.islands.map((verts, idx) => (
            <polygon key={idx} points={verts.map(([vx, vy]) => `${px(vx)},${py(vy)}`).join(" ")} fill="#d9cba3" stroke="#8a7a55" strokeWidth="1.2" />
          ))}
          {world.outposts.map((o, idx) => (
            <g key={idx}>
              <circle cx={px(o.x)} cy={py(o.y)} r="4.5" fill="#7a5c2e" />
              <text x={px(o.x) + 7} y={py(o.y) + 3} fontSize="9" fill="#3d2f14">Poste</text>
            </g>
          ))}
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
          {player.measures.map((m, idx) => {
            const km = Math.round(kmOf(m.a, m.b));
            const mx = (px(m.a[0]) + px(m.b[0])) / 2, my = (py(m.a[1]) + py(m.b[1])) / 2;
            return (
              <g key={idx}>
                <line x1={px(m.a[0])} y1={py(m.a[1])} x2={px(m.b[0])} y2={py(m.b[1])} stroke="#0f2a47" strokeWidth="1.4" strokeDasharray="6 4" />
                <circle cx={px(m.a[0])} cy={py(m.a[1])} r="2.5" fill="#0f2a47" />
                <circle cx={px(m.b[0])} cy={py(m.b[1])} r="2.5" fill="#0f2a47" />
                <text x={mx} y={my - 4} fontSize="11" fill="#0f2a47" fontWeight="bold" textAnchor="middle" stroke="#cfe0f0" strokeWidth="2.5" paintOrder="stroke">{km} km</text>
              </g>
            );
          })}
          {measurePend && (
            <g>
              <circle cx={px(measurePend[0])} cy={py(measurePend[1])} r="3" fill="none" stroke="#0f2a47" strokeWidth="1.4" />
              {hoverPt && (
                <g>
                  <line x1={px(measurePend[0])} y1={py(measurePend[1])} x2={px(hoverPt[0])} y2={py(hoverPt[1])} stroke="#0f2a47" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.8" />
                  <circle cx={px(hoverPt[0])} cy={py(hoverPt[1])} r="2" fill="#0f2a47" opacity="0.6" />
                  <text x={(px(measurePend[0]) + px(hoverPt[0])) / 2} y={(py(measurePend[1]) + py(hoverPt[1])) / 2 - 4} fontSize="11" fill="#0f2a47" fontWeight="bold" textAnchor="middle" stroke="#cfe0f0" strokeWidth="2.5" paintOrder="stroke">{Math.round(kmOf(measurePend, hoverPt))} km</text>
                </g>
              )}
            </g>
          )}
          {(player.waypoints || []).length > 0 && (() => {
            const wps = player.waypoints;
            const segs = [];
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
          {planMode && hoverPt && (() => {
            const wps = player.waypoints || [];
            const from = wps.length > 0 ? wps[wps.length - 1] : { x: player.estX, y: player.estY };
            return (
              <line x1={px(from.x)} y1={py(from.y)} x2={px(hoverPt[0])} y2={py(hoverPt[1])} stroke="#0ea5e9" strokeWidth="1.2" strokeDasharray="4 4" opacity="0.6" />
            );
          })()}
          {player.pins.map((p, idx) => (
            <g key={idx}>
              <circle cx={px(p.x)} cy={py(p.y)} r="2.5" fill="#0f172a" stroke="#000000" strokeWidth="0.8" />
              <text x={px(p.x)} y={py(p.y) - 5} fontSize="9" fill="#000000" fontWeight="bold" textAnchor="middle">{p.label}</text>
            </g>
          ))}
          {(player.trace || []).length > 1 && (
            <polyline
              points={(player.trace || []).map(([tx, ty]) => `${px(tx)},${py(ty)}`).join(" ")}
              fill="none" stroke="#94a3b8" strokeWidth="1.1" strokeDasharray="2 3" opacity="0.55"
            />
          )}
          {(() => {
            const ah = (player.heading + player.antOrient + 720) % 360;
            const hr = (player.antBeam / 2) * Math.PI / 180;
            const L = 30;
            return (
              <path
                transform={`translate(${px(player.estX)},${py(player.estY)}) rotate(${ah})`}
                d={`M 0 0 L ${(-L * Math.sin(hr)).toFixed(1)} ${(-L * Math.cos(hr)).toFixed(1)} A ${L} ${L} 0 0 1 ${(L * Math.sin(hr)).toFixed(1)} ${(-L * Math.cos(hr)).toFixed(1)} Z`}
                fill="rgba(192,132,252,0.15)" stroke="rgba(192,132,252,0.45)" strokeWidth="0.8"
              />
            );
          })()}
          <circle cx={px(player.estX)} cy={py(player.estY)} r={Math.max(1.2, (player.unc / DEG_KM) * S)} fill="rgba(220,38,38,0.18)" stroke="#dc2626" strokeWidth="0.8" />
          <circle cx={px(player.estX)} cy={py(player.estY)} r="2" fill="#dc2626" />
          <line x1={px(player.estX)} y1={py(player.estY)} x2={px(player.estX) + Math.sin((player.headingOrder * Math.PI) / 180) * 16} y2={py(player.estY) - Math.cos((player.headingOrder * Math.PI) / 180) * 16} stroke="#dc2626" strokeWidth="1.2" />
        </svg>
        <div className="pointer-events-none absolute inset-0 rounded"
          style={{ background: "radial-gradient(420px 300px at 20% 0%, rgba(255,230,170,0.22), transparent 65%)" }} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-serif text-[10px] italic leading-snug text-[#3d5a75]">
          🔴 estime (cercle = incertitude) · pointillés gris = route parcourue · ⚠️ zone d'exclusion officielle — advisory
          {player.pins.length > 0 && ` · 📌 ${player.pins.map((p) => `${p.label} ${p.y.toFixed(1)}°N ${p.x.toFixed(1)}°E`).join(" · ")}`}
          {` · zoom ×${((MAP * S) / vb.w).toFixed(1)}`}
        </p>
      </div>
    </div>
  );
}

// Minutes à simuler pour atteindre la prochaine heure cible (0-23) du jeu.
export function nextPhase(tMin, targetHour) {
  const cur = tMin / 60;
  let delta = (targetHour - (cur % 24) + 24) % 24;
  if (delta === 0) delta = 24; // pile sur l'heure cible : prochaine occurrence = demain
  return delta * 60;            // sinon : on saute les quelques minutes restantes (plus de 24 h à 6 min de la cible)
}
