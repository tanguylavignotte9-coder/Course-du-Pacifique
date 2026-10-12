// ---------- Manuel du jeu : référence des systèmes et de l'équilibrage ----------
// Page statique ouverte à tout moment depuis l'en-tête (bouton 📖 Manuel).
// Règle DRY : TOUTES les valeurs affichées sont importées des constantes du
// moteur — le manuel ne peut jamais se désynchroniser de l'équilibrage réel.
// Périmètre : les systèmes documentés ici uniquement.
import { Fragment, useEffect } from "react";
import {
  MAP, DEG_KM, PULSE_MIN, CAPTURE_R_KM, DELIVERY_R_KM,
  VMAX_KMH, SAIL_SPD_KMH, DIESEL_SPD_KMH, SCOPE_SPD_KMH, SUB_SPD_KMH, WIND_REF_KMH,
  ACCEL_SURF, ACCEL_SUB, DECEL_SURF, DECEL_SUB,
  LONG_DECAY_KM, SHORT_DECAY_KM, OMNI_DETECT_PCT, RADIO_MIN_STRENGTH, RADIO_EDGE_MALUS,
  CALL_BATTERY_COST, CODE_POOL, dirSensitivity,
  PROX_PING_MAX_KM, PROX_PING_MAX_S, PROX_PING_MIN_KM, PROX_PING_MIN_S,
  ANCHOR_DROP_KM, SIGNAL_LOG_MAX, PROX_ARM_KM, AUTOGUIDE_DEFAULT,
  ISLAND_SEP_KM, RES_WARN_PCT, RES_WARN_RESET_PCT, WX_HORIZON_H,
  COMP_DEV_MIN_DEG, COMP_DEV_MAX_DEG, LOG_ERR_MIN_PCT, LOG_ERR_MAX_PCT,
  CUR_SPD_MIN_KMH, CUR_SPD_MAX_KMH,
  TURN_MAX_SURF, TURN_MAX_SUB, STEER_AT_REST_SURF, STEER_AT_REST_SUB,
  FUEL_RATE_PCT_H, BATT_PERISCOPE_PCT_H, BATT_SUB_PCT_H, SOLAR_PCT_H, FOOD_PCT_H,
  UNC_PER_KM, UNC_PER_H, NAVFIX_MIN, NAVFIX_RETRY_MIN, NAVFIX_BASE_KM,
  NAVFIX_CLOUD_KM, NAVFIX_SEA_KM, NAVFIX_VIS_KM, NAVFIX_VIS_REF_KM,
  HORIZON_KM, SAIL_DEFAULT, SHIP_VIS_LIGHT,
  SAIL_EFF_CURVE, SAIL_FURL_DEG, STORM_SAIL_MAX, WIND_FACTOR_CAP,
  WIND_FLOOR_KMH, GEN_HORIZON_H, SWELL_KMH, LEEWAY_K, CUR_EKMAN_DEG,
  VISFIX_ISLE_KM, VISFIX_BEACON_KM, VISFIX_PORT_KM, VISFIX_COAST_KM, SOLAR_CLOUD_REF_PCT,
  DAMAGE_HIT_PCT, DAMAGE_ROLL_MIN, DAMAGE_ROLL_PCT, DAMAGE_WIND_KMH, DAMAGE_SPEED_KMH, DAMAGE_SEA_MIN,
  BEAST_SPD_KMH, BEAST_DIGEST_MIN, BEAST_DIGEST_MAX, BEAST_STRIKE_KM,
  BEAST_FLEE_LONG_KMH, BEAST_FLEE_LONG_MIN, BEAST_FLEE_SHORT_KM, BEAST_FLEE_SILENCE_MIN,
  BEAST_TRACE_PERSIST_MIN, BEAST_CRY_MEAN_MIN, PATROL_SPD_KMH, PATROL_VIS_KM, PATROL_VIS_NUIT_KM,
  FISHER_CHAT_MEAN_MIN, NEWSLETTER_MIN, NEWS_MAX,
  BEACON_COUNTS, ISLAND_COUNT, OUTPOST_COUNT,
  SOUND_KMH, SOUND_DECAY_KM, SONAR_RANGE_KM, SONAR_PING_BATTERY_COST, SONAR_ECHO_PERSIST_S,
  NPC_FISHERMEN, NPC_CARGOS, NPC_WHALES, FISHER_RANGE_KM, FISHER_SPD_KMH,
  CARGO_SPD_KMH, WHALE_SPD_KMH,
  RARITY_MIN, RARITY_STYLE, VIS_BASE, VIS_NUIT, clamp, sailAutoDrive,
} from "../../shared/engine.js";

const fmt = (v) => (typeof v === "number" ? String(Math.round(v * 10) / 10).replace(".", ",") : String(v));
// Portées d'émergence dérivées des constantes (jamais figées)
const OMNI_LONG_KM = LONG_DECAY_KM * (1 - OMNI_DETECT_PCT / 100);   // lecture omni, famille longue
const OMNI_SHORT_KM = SHORT_DECAY_KM * (1 - OMNI_DETECT_PCT / 100); // lecture omni, famille courte
const DIR_LONG_KM = LONG_DECAY_KM * (1 - dirSensitivity(1) / 100);  // lecture directionnelle 1°, famille longue
const SONAR_MAX_RANGE_KM = Math.max(...Object.values(SONAR_RANGE_KM)); // portée max du ping (îles/côte)
const ECHO_FULL_MIN = (2 * SONAR_MAX_RANGE_KM) / (SOUND_KMH / 60);     // aller-retour plein portée
const SONG_FULL_MIN = SOUND_DECAY_KM.biologique / (SOUND_KMH / 60);    // chant au bord de sa portée

// Vitesses stabilisées par allure à vent de référence (point fixe du vent
// apparent, calculé depuis sailAutoDrive du moteur — jamais figé)
const ALLURES = [["au près serré", 45], ["au travers", 90], ["au largue", 135], ["au vent arrière", 180]];
function steadySpeed(awAngle, windSpd) {
  const st = { heading: 0, compDev: 0, vkmh: 0, boom: 0 };
  const w = { windSpd, windDir: awAngle, storm: false };
  let v = 0;
  for (let i = 0; i < 200; i++) {
    st.vkmh = v;
    const { drive, aw } = sailAutoDrive(st, w);
    const target = Math.min(SAIL_SPD_KMH * clamp(aw / WIND_REF_KMH, 0, WIND_FACTOR_CAP) * drive, VMAX_KMH);
    v = v + (target - v) * 0.3; // amortissement : convergence du point fixe oscillant
  }
  return v;
}

function Sec({ t, children, open }) {
  return (
    <details name="pc-manuel" open={open} className="rounded-lg border border-[#4a3820] bg-[#0a0f16]/50">
      <summary className="cursor-pointer select-none rounded-lg px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-[#3a2c18]/60">
        {t}
      </summary>
      <div className="space-y-2 px-4 pb-4 pt-1 text-xs leading-relaxed text-amber-100/85">{children}</div>
    </details>
  );
}

// Petite grille clé/valeur (annexes et tableaux)
function Kv({ rows }) {
  return (
    <div className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-[#4a3820] bg-[#0a0f16]/60 p-2.5">
      {rows.map(([k, v], i) => (
        <Fragment key={i}>
          <span className="engrave text-[9.5px] tracking-wider">{k}</span>
          <span className="tabular-nums text-amber-100">{v}</span>
        </Fragment>
      ))}
    </div>
  );
}

const P = ({ children }) => <p className="text-amber-100/85">{children}</p>;

// ---------- Annexe technique : générée depuis les constantes importées ----------
const ANNEX = [
  {
    titre: "Monde & balises",
    rows: [
      ["Carte", MAP + "° × " + MAP + "° — " + fmt(MAP * DEG_KM) + " km de côté (1° = " + fmt(DEG_KM) + " km)"],
      ["Séparation minimale des îles", fmt(ISLAND_SEP_KM) + " km"],
      ["Balises", Object.values(BEACON_COUNTS).reduce((a, b) => a + b, 0) + " : " + Object.entries(BEACON_COUNTS).map(([r, n]) => n + " " + r).join(", ")],
      ["Îles / avant-postes", ISLAND_COUNT + " îles · " + Math.min(OUTPOST_COUNT, ISLAND_COUNT) + " avant-postes"],
      ["Points", "commune " + RARITY_STYLE.commune.pts + " · rare " + RARITY_STYLE.rare.pts + " · légendaire " + RARITY_STYLE.legendaire.pts + " · inconnue " + RARITY_STYLE.inconnue.pts],
      ...Object.entries(RARITY_MIN).map(([r, m]) => [
        "Placement " + r, "≥ " + m.port + " km du port · ≥ " + m.outpost + " km d'un avant-poste · ≥ " + m.beacon + " km d'une autre balise",
      ]),
      ["Pulsation des balises", "toutes les " + PULSE_MIN + " min (famille longue)"],
      ["Rayon de capture", fmt(CAPTURE_R_KM) + " km"],
      ["Zone de livraison / ravitaillement", fmt(DELIVERY_R_KM) + " km"],
      ["Horizon géographique", fmt(HORIZON_KM) + " km"],
      ["Pool de codes radio", fmt(CODE_POOL) + " codes à 4 chiffres"],
    ],
  },
  {
    titre: "Navire, propulsion & voile",
    rows: [
      ["Vitesse de coque max", fmt(VMAX_KMH) + " km/h"],
      ["Voile (pleine puissance)", fmt(SAIL_SPD_KMH) + " km/h au facteur 1"],
      ["Moteur thermique", fmt(DIESEL_SPD_KMH) + " km/h"],
      ["Électrique en périscope", fmt(SCOPE_SPD_KMH) + " km/h"],
      ["Électrique en plongée", fmt(SUB_SPD_KMH) + " km/h (plus rapide qu'au périscope)"],
      ["Vent de référence voile", fmt(WIND_REF_KMH) + " km/h"],
      ["Voilure par défaut", Math.round(SAIL_DEFAULT * 100) + " %"],
      ["Courbe de rendement", SAIL_EFF_CURVE.map(([a, r]) => fmt(a) + " km/h → × " + fmt(r)).join(" · ")],
      ["Voile fasée sous", fmt(SAIL_FURL_DEG) + "° d'incidence"],
      ["Voile en tempête", "rendement × " + fmt(STORM_SAIL_MAX)],
      ["Plafond de survent", "× " + fmt(WIND_FACTOR_CAP)],
      ["Accélération (surface / plongée)", fmt(ACCEL_SURF) + " / " + fmt(ACCEL_SUB) + " km/h par minute"],
      ["Décélération (surface / plongée)", fmt(DECEL_SURF) + " / " + fmt(DECEL_SUB) + " km/h par minute"],
      ["Giration max (surface / plongée)", fmt(TURN_MAX_SURF) + " / " + fmt(TURN_MAX_SUB) + " °/min"],
      ["Barre à l'arrêt (surface / plongée)", Math.round(STEER_AT_REST_SURF * 100) + " % / " + Math.round(STEER_AT_REST_SUB * 100) + " %"],
      ["Phare la nuit", "visible à " + fmt(SHIP_VIS_LIGHT) + " km"],
    ],
  },
  {
    titre: "Radio & signaux",
    rows: [
      ["Famille longue", "force 100 → 0 % sur " + fmt(LONG_DECAY_KM) + " km"],
      ["Famille courte", "force 100 → 0 % sur " + fmt(SHORT_DECAY_KM) + " km"],
      ["Formule de force", "100 × (1 − distance/portée), arrondie"],
      ["Seuil omni", "force ≥ " + fmt(OMNI_DETECT_PCT) + " % — sans azimut, ≈ " + fmt(OMNI_LONG_KM) + " km en longue"],
      ["Sensibilité directionnelle", "1 + ((faisceau − 1)/179) × 49 — de " + fmt(dirSensitivity(1)) + " % (1°) à " + fmt(dirSensitivity(180)) + " % (180°)"],
      ["Portée directionnelle 1°", "≈ " + fmt(DIR_LONG_KM) + " km en famille longue"],
      ["Malus de bord de faisceau", "force × " + fmt(1 - RADIO_EDGE_MALUS)],
      ["Seuil d'audibilité des stations", "force ≥ " + fmt(RADIO_MIN_STRENGTH) + " %"],
      ["Coût d'un appel / message", fmt(CALL_BATTERY_COST) + " % de batterie"],
    ],
  },
  {
    titre: "Vigie & autoguidage",
    rows: [
      ["Vigie armée si un navire est à", "≤ " + fmt(PROX_ARM_KM) + " km"],
      ["Signal de proximité", fmt(PROX_PING_MAX_S) + " s à ≥ " + fmt(PROX_PING_MAX_KM) + " km → " + fmt(PROX_PING_MIN_S) + " s à ≤ " + fmt(PROX_PING_MIN_KM) + " km (accélération géométrique)"],
      ["Ancre automatique du verrou", fmt(ANCHOR_DROP_KM) + " km"],
      ["Mode d'autoguidage par défaut", AUTOGUIDE_DEFAULT === "off" ? "Aucun" : AUTOGUIDE_DEFAULT],
      ["Journal des signaux", fmt(SIGNAL_LOG_MAX) + " derniers pings, groupés par station"],
    ],
  },
  {
    titre: "Navigation & incertitude",
    rows: [
      ["Déviation de compas", "± " + fmt(COMP_DEV_MIN_DEG) + " à " + fmt(COMP_DEV_MAX_DEG) + "°"],
      ["Erreur de loch", "± " + fmt(LOG_ERR_MIN_PCT) + " à " + fmt(LOG_ERR_MAX_PCT) + " %"],
      ["Courant", fmt(CUR_SPD_MIN_KMH) + " à " + fmt(CUR_SPD_MAX_KMH) + " km/h — couplé au régime météo (offset d'Ekman " + fmt(CUR_EKMAN_DEG) + "°), jamais intégré à l'estime"],
      ["Croissance de l'incertitude", "+ " + fmt(UNC_PER_KM) + " km par km parcouru · + " + fmt(UNC_PER_H) + " km par heure"],
      ["Point aux étoiles", fmt(NAVFIX_MIN) + " min · plancher " + fmt(NAVFIX_BASE_KM) + " km · + " + fmt(NAVFIX_CLOUD_KM) + " km par % de nuages · + " + fmt(NAVFIX_SEA_KM) + " km par m de houle · + " + fmt(NAVFIX_VIS_KM) + " km par km de visibilité sous " + fmt(NAVFIX_VIS_REF_KM) + " km · nouvelle tentative " + fmt(NAVFIX_RETRY_MIN) + " min après échec"],
      ["Point visuel — plancher île", fmt(VISFIX_ISLE_KM) + " km"],
      ["Point visuel — plancher balise / avant-poste", fmt(VISFIX_BEACON_KM) + " km"],
      ["Point visuel — plancher port", fmt(VISFIX_PORT_KM) + " km"],
      ["Point visuel — plancher côte", fmt(VISFIX_COAST_KM) + " km"],
      ["Leeway", "≈ " + fmt(LEEWAY_K * 100) + " % de la vitesse du vent, jamais intégré à l'estime"],
      ...Object.entries(VIS_BASE).map(([kind, d]) => [
        "Point visuel " + kind, "jour : " + fmt(d) + " km · nuit : " + fmt(VIS_NUIT[kind]) + " km",
      ]),
    ],
  },
  {
    titre: "Énergie & ressources",
    rows: [
      ["Carburant (moteur plein)", fmt(FUEL_RATE_PCT_H) + " %/h"],
      ["Batteries en plongée", fmt(BATT_SUB_PCT_H) + " %/h"],
      ["Batteries en périscope", fmt(BATT_PERISCOPE_PCT_H) + " %/h"],
      ["Solaire (de jour)", "+ " + fmt(SOLAR_PCT_H) + " %/h, atténué par la couverture nuageuse, nul à " + fmt(SOLAR_CLOUD_REF_PCT) + " %"],
      ["Vivres", fmt(FOOD_PCT_H) + " %/h"],
      ["Alerte ressources", fmt(RES_WARN_PCT) + " % — réarmée au-dessus de " + fmt(RES_WARN_RESET_PCT) + " %"],
    ],
  },
  {
    titre: "Sonar",
    rows: [
      ["Vitesse du son (eau)", "≈ " + fmt(SOUND_KMH) + " km/h"],
      ["Décroissance des bruits", "par type — " + Object.entries(SOUND_DECAY_KM).map(([k, d]) => k + " " + fmt(d)).join(" · ") + " km"],
      ["Portée du ping actif", "par écho — île " + fmt(SONAR_RANGE_KM.ile) + " · côte " + fmt(SONAR_RANGE_KM.cote) + " · balise " + fmt(SONAR_RANGE_KM.balise) + " · navire " + fmt(SONAR_RANGE_KM.navire) + " · biologique " + fmt(SONAR_RANGE_KM.biologique) + " km"],
      ["Coût d'un ping", fmt(SONAR_PING_BATTERY_COST) + " % de batterie"],
      ["Affichage d'un écho", fmt(SONAR_ECHO_PERSIST_S) + " s"],
      ["Retard plein portée", "aller-retour " + fmt(SONAR_MAX_RANGE_KM) + " km ≈ " + fmt(ECHO_FULL_MIN) + " min"],
      ["Champ libre", "le son ne traverse ni les îles ni le continent — un trajet d'eau libre est requis entre source et récepteur"],
    ],
  },
  {
    titre: "Vie du monde",
    rows: [
      ["Pêcheurs", fmt(NPC_FISHERMEN) + " — transit " + fmt(FISHER_SPD_KMH) + " km/h, jusqu'à " + fmt(FISHER_RANGE_KM) + " km au large"],
      ["Cargos", fmt(NPC_CARGOS) + " — traversée " + fmt(CARGO_SPD_KMH) + " km/h"],
      ["Baleines", fmt(NPC_WHALES) + " — errance " + fmt(WHALE_SPD_KMH) + " km/h"],
      ["Bafouillage radio des pêcheurs", "toutes les " + fmt(FISHER_CHAT_MEAN_MIN) + " min en moyenne (diffusion lisible par tous, famille courte)"],
      ["Bête — chasse", fmt(BEAST_SPD_KMH) + " km/h · cri toutes les " + fmt(BEAST_CRY_MEAN_MIN) + " min en moyenne"],
      ["Bête — digestion", fmt(BEAST_DIGEST_MIN / 60) + " à " + fmt(BEAST_DIGEST_MAX / 60) + " h"],
      ["Bête — frappe", "à ≤ " + fmt(BEAST_STRIKE_KM) + " km : − " + fmt(DAMAGE_HIT_PCT) + " % coque, voilure et antenne"],
      ["Bête — fuite post-engagement", fmt(BEAST_FLEE_LONG_KMH) + " km/h pendant " + fmt(BEAST_FLEE_LONG_MIN / 60) + " h, ou " + fmt(BEAST_FLEE_SHORT_KM) + " km d'un coup · silence " + fmt(BEAST_FLEE_SILENCE_MIN / 60) + " h"],
      ["Bête — traces", fmt(BEAST_TRACE_PERSIST_MIN / 60) + " h de visibilité"],
      ["Frégate de patrouille", fmt(PATROL_SPD_KMH) + " km/h · visible jour " + fmt(PATROL_VIS_KM) + " km / nuit " + fmt(PATROL_VIS_NUIT_KM) + " km (feux)"],
    ],
  },
  {
    titre: "Santé du navire",
    rows: [
      ["Jauges", "coque · voilure · antenne — 100 % → 0 %, efficacité × 1 → × 0,5"],
      ["Tirage des avaries", "toutes les " + fmt(DAMAGE_ROLL_MIN) + " min de jeu, " + fmt(DAMAGE_ROLL_PCT) + " % par tirage"],
      ["Avarie de toile", "voilure hissée sous vent ≥ " + fmt(DAMAGE_WIND_KMH) + " km/h ou tempête"],
      ["Avarie de coque (mer)", "vitesse ≥ " + fmt(DAMAGE_SPEED_KMH) + " km/h dans un état de mer ≥ " + fmt(DAMAGE_SEA_MIN)],
      ["Avarie d'antenne", "en tempête"],
      ["Dégât par coup", "− " + fmt(DAMAGE_HIT_PCT) + " % (échouement et heurt de limite inclus)"],
      ["Coque 0 %", "remorquage : retour au port, navire neuf, stock de codes perdu"],
      ["Radoub", "gratuit, instantané, à quai uniquement (port ou avant-poste, en surface)"],
    ],
  },
  {
    titre: "Météo & océan",
    rows: [
      ["Vent plancher", fmt(WIND_FLOOR_KMH) + " km/h (aucune latitude innavigable)"],
      ["Houle propagée", fmt(SWELL_KMH) + " km/h — la mer se dégrade avant le vent local"],
      ["Leeway (dérive de coque)", "≈ " + fmt(LEEWAY_K * 100) + " % de la vitesse du vent, jamais intégré à l'estime"],
      ["Courant — offset d'Ekman", fmt(CUR_EKMAN_DEG) + "° sur la direction du régime (prévisible)"],
      ["Histoire météo par graine", fmt(GEN_HORIZON_H / 24) + " jours"],
      ["Horizon des prévisions", fmt(WX_HORIZON_H) + " h (port, avant-postes, NETWORK)"],
    ],
  },
  {
    titre: "Bulletin officiel",
    rows: [
      ["Éditions", Math.round(NEWSLETTER_MIN[0] / 60) + " h et " + Math.round(NEWSLETTER_MIN[1] / 60) + " h (heure de Paris)"],
      ["Réception", "tous les navigateurs, même hors ligne (badge de non-lus)"],
      ["Contenu", "classement officiel (livrés) · classement officieux (en cale) · météo des 4 quadrants · zone d'exclusion publiée"],
      ["Archive", NEWS_MAX + " dernières éditions"],
    ],
  },
];

export default function Manual({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border-2 border-[#241a0e] p-5 shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
        style={{ background: "linear-gradient(180deg, #4a3421, #33230f)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2 className="plate rounded px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.14em]">📖 Manuel du jeu</h2>
            <p className="engrave mt-1 text-[9px] uppercase tracking-[0.14em]">Référence des systèmes et de l'équilibrage — valeurs lues directement dans le moteur.</p>
          </div>
          <button
            onClick={onClose}
            className="plate rounded shrink-0 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider hover:brightness-110"
          >
            Fermer ✕
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto pr-1">
          <Sec t="1 · Le monde" open>
            <P>
              L'océan couvre {MAP}° × {MAP}°, soit {fmt(MAP * DEG_KM)} km de côté (1° = {fmt(DEG_KM)} km).
              On y trouve un continent, un port de départ, {ISLAND_COUNT} îles et
              {" "}{Math.min(OUTPOST_COUNT, ISLAND_COUNT)} avant-postes — les îles sont
              séparées d'au moins {fmt(ISLAND_SEP_KM)} km les unes des autres.
            </P>
            <P>
              L'horizon géographique vu du pont est à {fmt(HORIZON_KM)} km : au-delà, la courbure de la
              Terre cache tout, quelle que soit la taille de l'obstacle.
            </P>
            <P>
              Le monde est généré à partir d'une graine : deux courses lancées sur la même graine
              produisent exactement le même océan, les mêmes îles, les mêmes balises.
            </P>

          </Sec>

          <Sec t="2 · Balises & capture">
            <P>
              {Object.values(BEACON_COUNTS).reduce((a, b) => a + b, 0)} balises flottent en pleine eau :
              {" "}{Object.entries(BEACON_COUNTS).map(([r, n]) => `${n} ${r} (${RARITY_STYLE[r].pts} ${RARITY_STYLE[r].pts > 1 ? "pts" : "pt"})`).join(", ")}.
              Chacune possède un code radio à 4 chiffres.
            </P>
            <P>
              Chaque balise émet un ping toutes les {PULSE_MIN} min (famille longue). Le ping porte son
              code, jamais sa position. Un appel « Position ? » à une station qui vous entend reçoit en
              réponse ses coordonnées exactes.
            </P>
            <P>
              La capture est une action manuelle : le bouton Capturer n'agit que si vous êtes à
              ≤ {fmt(CAPTURE_R_KM)} km de la balise.
            </P>
            <P>
              Une balise capturée n'est pas retirée du monde : elle continue d'émettre (ping « désactivé »)
              et de répondre à « Position ? ». Seul son compteur de capture change.
            </P>

          </Sec>

          <Sec t="3 · Propulsion & vitesses">
            <Kv rows={[
              ["Voile (mât levé)", fmt(SAIL_SPD_KMH) + " km/h au facteur 1"],
              ["Moteur thermique", fmt(DIESEL_SPD_KMH) + " km/h"],
              ["Électrique en périscope", fmt(SCOPE_SPD_KMH) + " km/h"],
              ["Électrique en plongée", fmt(SUB_SPD_KMH) + " km/h"],
              ["Vitesse de coque maximale", fmt(VMAX_KMH) + " km/h"],
            ]} />
            <P>
              La plongée est volontairement plus rapide que le périscope. L'inertie est simulée :
              {" "}{fmt(ACCEL_SURF)} km/h gagnés par minute en surface ({fmt(ACCEL_SUB)} en plongée),
              décélération de {fmt(DECEL_SURF)} km/h par minute en surface ({fmt(DECEL_SUB)} en plongée).
            </P>
            <P>
              Giration : jusqu'à {fmt(TURN_MAX_SURF)}°/min en surface, {fmt(TURN_MAX_SUB)}°/min en
              plongée. À l'arrêt, la barre ne conserve qu'une fraction de son efficacité
              ({" "}{Math.round(STEER_AT_REST_SURF * 100)} % en surface).
            </P>

          </Sec>

          <Sec t="4 · Voile">
            <P>
              Vous réglez la voilure déployée (curseur 0–100 %, défaut {Math.round(SAIL_DEFAULT * 100)} %) ;
              l'écoute est entièrement automatique. La stratégie se joue au placement du cap par
              rapport au vent.
            </P>
            <P>
              Vitesse à la voile = {fmt(SAIL_SPD_KMH)} × (vent apparent / {fmt(WIND_REF_KMH)}, plafonné à
              × {fmt(WIND_FACTOR_CAP)}) × rendement de l'allure × voilure. Le rendement suit le vent
              apparent : {SAIL_EFF_CURVE.map(([a, r]) => "× " + fmt(r) + " à " + fmt(a) + " km/h").join(", ")}.
              Sous {fmt(SAIL_FURL_DEG)}° d'incidence, la voile fase : vitesse nulle — le vent debout est
              un no-go, il n'y a pas de marche arrière.
            </P>
            <P>
              Par vent de {fmt(WIND_REF_KMH)} km/h : {" "}
              {ALLURES.map(([l, a]) => `${fmt(steadySpeed(a, WIND_REF_KMH))} km/h ${l}`).join(", ")} —
              l'allure la plus rapide reste calculée depuis le moteur. En tempête, le
              rendement est plafonné à × {fmt(STORM_SAIL_MAX)} (voilure réduite).
            </P>
            <P>
              À l'arrivée d'un itinéraire, le mât est rentré automatiquement : redressez-le pour
              repartir à la voile.
            </P>

          </Sec>

          <Sec t="5 · Météo">
            <P>
              La météo est déterministe : calculée à partir de la graine du monde et de l'heure de jeu.
              Elle est donc identique pour tous les navires, et prévisible exactement.
            </P>
            <P>
              Quatre couches se superposent :
              1) un régime de vents par latitude — les grandes bandes de la carte ont chacune leur
              régime, avec un méandre lent ;
              2) des perturbations advectées qui traversent la carte ;
              3) des systèmes rares — cyclones (œil calme, demi-cercle dangereux : ne jamais couper
              un cyclone par l'avant) et anticyclones — qui décroissent à terre ;
              4) une houle PROPAGÉE à {fmt(SWELL_KMH)} km/h : la mer se dégrade AVANT l'arrivée du
              vent local — la douleur est le signal.
            </P>
            <P>
              Garde-fou : le vent ne descend jamais sous {fmt(WIND_FLOOR_KMH)} km/h — aucune latitude
              innavigable.
            </P>
            <P>
              Tempête = archétype d'orage OU influence cyclonique forte, SAUF sous anticyclone (la
              voile y est plafonnée à × {fmt(STORM_SAIL_MAX)}).
            </P>
            <P>
              Chaque graine porte {fmt(GEN_HORIZON_H / 24)} jours d'histoire météo. Les prévisions
              sont parfaites sur {fmt(WX_HORIZON_H)} h et accessibles via le service météo du
              NETWORK, en zone (port, avant-poste ou balise).
            </P>
            <P>
              La météo agit sur : la vitesse à la voile (vent), le point aux étoiles (nuages, houle,
              visibilité) et la détection visuelle (visibilité, jour/nuit).
            </P>

          </Sec>

          <Sec t="6 · Navigation à l'estime & incertitude">
            <P>
              Votre position sur la carte est une estime : cap affiché × vitesse mesurée. Ce n'est
              jamais votre vraie position, et l'écart grandit sans cesse.
            </P>
            <P>
              Quatre sources de divergence : la déviation de compas (± {fmt(COMP_DEV_MIN_DEG)} à
              {" "}{fmt(COMP_DEV_MAX_DEG)}°), l'erreur de loch (± {fmt(LOG_ERR_MIN_PCT)} à
              {" "}{fmt(LOG_ERR_MAX_PCT)} % sur la distance parcourue), le courant
              ({" "}{fmt(CUR_SPD_MIN_KMH)} à {fmt(CUR_SPD_MAX_KMH)} km/h — couplé au régime météo :
              direction du régime décalée d'un offset d'Ekman de {fmt(CUR_EKMAN_DEG)}°, donc
              prévisible) et la dérive de coque (leeway : environ {fmt(LEEWAY_K * 100)} % de la
              vitesse du vent). Courant et leeway déportent le navire réel mais ne sont jamais
              intégrés à l'estime.
            </P>
            <P>
              Le cercle d'incertitude affiché grandit de {fmt(UNC_PER_KM)} km par km parcouru et de
              {" "}{fmt(UNC_PER_H)} km par heure (dérives lentes). À {fmt(DIESEL_SPD_KMH)} km/h,
              l'incertitude croît d'environ {fmt(UNC_PER_KM * DIESEL_SPD_KMH + UNC_PER_H)} km par
              heure de route.
            </P>
            <P>
              Deux moyens de recentrer l'estime : le point aux étoiles ({fmt(NAVFIX_MIN)} min
              d'observation, de nuit, ciel suffisamment dégagé — plancher {fmt(NAVFIX_BASE_KM)} km,
              aggravé par les nuages, la houle et la brume, nouvelle tentative {fmt(NAVFIX_RETRY_MIN)} min
              après un échec) et le point visuel : reconnaître un repère connu recentre l'estime
              avec un plancher propre —
            </P>
            <Kv rows={[
              ["Point visuel — plancher île", fmt(VISFIX_ISLE_KM) + " km"],
              ["Point visuel — plancher balise / avant-poste", fmt(VISFIX_BEACON_KM) + " km"],
              ["Point visuel — plancher port", fmt(VISFIX_PORT_KM) + " km"],
              ["Point visuel — plancher côte", fmt(VISFIX_COAST_KM) + " km"],
            ]} />
            <Kv rows={Object.entries(VIS_BASE).map(([kind, d]) => [
              "Détection " + kind, "jour : " + fmt(d) + " km · nuit : " + fmt(VIS_NUIT[kind]) + " km",
            ])} />
          </Sec>

          <Sec t="7 · Radio">
            <P>
              Deux familles de signaux. Famille longue — pulsations des balises, réponses des
              stations, appels, messages et SOS de navires : force de 100 % à 0 % sur
              {" "}{fmt(LONG_DECAY_KM)} km. Famille courte — signal de proximité des balises et
              bafouillage VHF des pêcheurs : force de 100 % à 0 % sur {fmt(SHORT_DECAY_KM)} km.
              Formule unique :
              force = 100 × (1 − distance/portée), arrondie.
            </P>
            <P>
              Lire exige de capter, par l'un des deux canaux : le canal omnidirectionnel capte à partir
              de {fmt(OMNI_DETECT_PCT)} % de force (≈ {fmt(OMNI_LONG_KM)} km en famille longue,
              {" "}{fmt(OMNI_SHORT_KM)} km en courte — sans azimut), ou l'antenne directionnelle
              pointée dans son faisceau, avec une sensibilité qui dépend de l'ouverture : de
              {" "}{fmt(dirSensitivity(1))} % (faisceau 1°) à {fmt(dirSensitivity(180))} % (180°) — soit
              environ {fmt(DIR_LONG_KM)} km en famille longue à 1°. Au bord du faisceau, la force
              reçue est réduite à {Math.round((1 - RADIO_EDGE_MALUS) * 100)} %.
            </P>
            <P>
              L'émission d'un navire est toujours omnidirectionnelle : pas de gain à pointer pour
              émettre. Au-delà de la portée de lecture, un message reste néanmoins audible en brouillé
              par les tiers : force et zone du faisceau, contenu illisible. Aucun message ne contient
              jamais d'azimut — une position s'obtient en coordonnées, une direction en pointant
              l'antenne.
            </P>
            <P>
              Chaque appel, message ou SOS coûte {fmt(CALL_BATTERY_COST)} % de batterie. Les codes
              radio font 4 chiffres, tirés dans un pool de {fmt(CODE_POOL)}.
            </P>

          </Sec>

          <Sec t="8 · Balise-vigie & autoguidage">
            <P>
              Une station arme sa vigie dès qu'un navire passe à ≤ {fmt(PROX_ARM_KM)} km : elle émet
              alors un signal de proximité rapide (famille courte), non brouillé — audible par tous
              les navires du secteur. Une station qui s'affole au loin signale qu'un concurrent
              approche.
            </P>
            <P>
              La cadence accélère à l'approche : {fmt(PROX_PING_MAX_S)} s à {fmt(PROX_PING_MAX_KM)} km
              ou plus, jusqu'à {fmt(PROX_PING_MIN_S)} s à {fmt(PROX_PING_MIN_KM)} km et moins.
            </P>
            <P>
              Autoguidage (interrupteur 4 positions de l'onglet radio, défaut « {AUTOGUIDE_DEFAULT === "off" ? "Aucun" : AUTOGUIDE_DEFAULT} ») :
              Aucun, Balises actives, Toutes balises, ou Port et avant-postes. Au premier ping fort d'une
              station visée par le mode, le pilote s'engage et l'ordinateur oriente l'antenne sur la source,
              puis corrige le cap ping après ping. À {fmt(ANCHOR_DROP_KM * 1000)} m, le verrou coupe et
              l'ancre tombe automatiquement. La capture reste toujours manuelle.
            </P>
            <P>
              Le verrou se coupe sur une consigne de cap manuelle ou un échouement ; pendant sa durée,
              il coupe le pilote de route. Une consigne de cap reste toujours prioritaire.
            </P>
            <P>
              Le journal des signaux conserve les {fmt(SIGNAL_LOG_MAX)} derniers pings, groupés par
              station (le plus récent d'abord).
            </P>

          </Sec>

          <Sec t="9 · Ancre">
            <P>
              L'ancre fige entièrement la position : vent et courant sont ignorés. Sa pose coupe le
              moteur et rentre le mât — lever l'ancre ne les rallume pas.
            </P>
            <P>
              À l'ancre, le navire ne rayonne aucun bruit moteur : c'est un refuge acoustique.
            </P>

          </Sec>

          <Sec t="10 · Énergie & ressources">
            <Kv rows={[
              ["Carburant (moteur plein)", fmt(FUEL_RATE_PCT_H) + " %/h"],
              ["Batteries en plongée", fmt(BATT_SUB_PCT_H) + " %/h"],
              ["Batteries en périscope", fmt(BATT_PERISCOPE_PCT_H) + " %/h"],
              ["Solaire (de jour)", "+ " + fmt(SOLAR_PCT_H) + " %/h, atténué par la couverture nuageuse, nul à " + fmt(SOLAR_CLOUD_REF_PCT) + " %"],
              ["Vivres", fmt(FOOD_PCT_H) + " %/h"],
              ["Appel / message radio", fmt(CALL_BATTERY_COST) + " %"],
              ["Ping sonar", fmt(SONAR_PING_BATTERY_COST) + " %"],
            ]} />
            <P>
              Alertes dès {fmt(RES_WARN_PCT)} % sur une jauge, réarmées une fois remontées au-dessus
              de {fmt(RES_WARN_RESET_PCT)} %. L'avitaillement complet (carburant + vivres) se fait au
              port et aux avant-postes, à moins de {fmt(DELIVERY_R_KM)} km.
            </P>

          </Sec>

          <Sec t="11 · Santé du navire">
            <P>
              Trois jauges — coque, voilure, antenne — descendent de 100 % à 0 %. L'efficacité est
              linéaire : × 1 à 100 %, × 0,5 à 0 %. La coque frappe TOUTE la propulsion, la voilure
              la poussée de voile, l'antenne les émissions ET les réceptions radio.
            </P>
            <P>
              Avaries de mer : un tirage toutes les {DAMAGE_ROLL_MIN} min de jeu, {fmt(DAMAGE_ROLL_PCT)} %
              de chance par tirage — voilure hissée sous vent ≥ {fmt(DAMAGE_WIND_KMH)} km/h ou
              tempête → la toile ; vitesse ≥ {fmt(DAMAGE_SPEED_KMH)} km/h dans un état de mer
              ≥ {DAMAGE_SEA_MIN} → la coque ; tempête → l'antenne. Chaque coup retire
              {" "}{fmt(DAMAGE_HIT_PCT)} %.
            </P>
            <P>
              Échouement et heurt de la limite de zone : − {fmt(DAMAGE_HIT_PCT)} % de coque.
            </P>
            <P>
              Coque à 0 % : remorquage immédiat par la compagnie — retour au port, navire remis à
              neuf, MAIS stock de codes perdu (les balises correspondantes redeviennent capturables
              par tous).
            </P>
            <P>
              Radoub : gratuit, instantané, à quai uniquement (port ou avant-poste, en surface) —
              coque, voilure et antenne à 100 %.
            </P>

          </Sec>

          <Sec t="12 · Sonar">
            <P>
              Passif (hydrophone) : continu, gratuit, en surface comme en plongée. Il ne donne qu'un
              gisement — aucune distance. Les icônes se placent au bord du cercle, l'opacité traduit la
              force, qui tombe à zéro à une distance propre à chaque bruit :
              {" "}{Object.entries(SOUND_DECAY_KM).map(([k, d]) => `${k} ${fmt(d)} km`).join(", ")}. Un navire à la voile ou en
              propulsion électrique est silencieux. Et la terre est un mur : un bruit ne s'entend
              qu'en champ libre — une île ou le continent entre la source et l'auditeur coupe le son.
            </P>
            <P>
              Actif : un bouton, en plongée uniquement. Portée par type d'écho : îles et côte
              {" "}{fmt(SONAR_RANGE_KM.ile)} km, navires en surface {fmt(SONAR_RANGE_KM.navire)} km,
              balises {fmt(SONAR_RANGE_KM.balise)} km, baleines {fmt(SONAR_RANGE_KM.biologique)} km.
              Coût {" "}{fmt(SONAR_PING_BATTERY_COST)} % de batterie. Tout ce qui traîne rebondit — îles,
              côtes, balises, navires en surface — et s'affiche en formes pendant
              {" "}{fmt(SONAR_ECHO_PERSIST_S)} s, avec gisement et distance. Chaque écho exige
              lui aussi un trajet d'eau libre entre le navire et sa cible.
            </P>
            <P>
              Les sons voyagent à ≈ {fmt(SOUND_KMH)} km/h dans l'eau : un écho plein portée
              ({" "}{fmt(SONAR_MAX_RANGE_KM)} km) met environ {fmt(ECHO_FULL_MIN)} min à revenir, un
              chant au bord de sa portée ({fmt(SOUND_DECAY_KM.biologique)} km) s'entend au bout
              {" "}d'environ {fmt(SONG_FULL_MIN)} min.
            </P>
            <P>
              Un navire en plongée n'apparaît ni au passif ni au ping : il n'est repérable que s'il
              émet lui-même. Pingez = révélez votre présence à {fmt(SOUND_DECAY_KM.ping)} km pour voir
              {" "}jusqu'à {fmt(SONAR_MAX_RANGE_KM)} km.
            </P>

          </Sec>

          <Sec t="13 · Vie du monde">
            <P>
              La mer est habitée : {NPC_FISHERMEN} pêcheurs travaillent autour des côtes (jusqu'à
              {" "}{fmt(FISHER_RANGE_KM)} km au large, transit à {fmt(FISHER_SPD_KMH)} km/h —
              silencieux à la pêche, bruyants en transit), {NPC_CARGOS} cargos traversent la carte
              bord à bord ({fmt(CARGO_SPD_KMH)} km/h), {NPC_WHALES} baleines errent partout
              ({" "}{fmt(WHALE_SPD_KMH)} km/h).
            </P>
            <P>
              À la radio : les pêcheurs bavardent en diffusion (lisible par tous dans la zone de
              réception, cadence moyenne d'un message toutes les {fmt(FISHER_CHAT_MEAN_MIN)} min),
              les cargos s'échangent des messages privés — interceptables en brouillé comme toute
              émission. Au sonar, les chants de baleines s'affichent comme signaux biologiques.
            </P>
            <P>
              La Bête : une créature chasse en pleine eau. Ses cris s'entendent très loin (voir
              sonar : son « inconnu », en moyenne toutes les {fmt(BEAST_CRY_MEAN_MIN)} min en
              chasse). Après un repas elle digère ({fmt(BEAST_DIGEST_MIN / 60)} à
              {" "}{fmt(BEAST_DIGEST_MAX / 60)} h — elle ralentit, puis repart), puis chasse à
              nouveau à {fmt(BEAST_SPD_KMH)} km/h. À ≤ {fmt(BEAST_STRIKE_KM)} km :
              − {fmt(DAMAGE_HIT_PCT)} % sur coque, voilure ET antenne — la coque peut y rester.
              Après un engagement, elle fuit ({fmt(BEAST_FLEE_LONG_KMH)} km/h pendant
              {" "}{fmt(BEAST_FLEE_LONG_MIN / 60)} h, ou {fmt(BEAST_FLEE_SHORT_KM)} km d'un coup)
              et se tait {fmt(BEAST_FLEE_SILENCE_MIN / 60)} h.
            </P>
            <P>
              Traces : épaves et carcasses restent visibles {fmt(BEAST_TRACE_PERSIST_MIN / 60)} h
              (voir « trace » dans les portées visuelles).
            </P>
            <P>
              La frégate de patrouille : navire de guerre de la compagnie, visible de jour à
              {" "}{fmt(PATROL_VIS_KM)} km et de nuit à {fmt(PATROL_VIS_NUIT_KM)} km (feux),
              moteur audible et tirs de canon au sonar. Elle vaque à ses opérations à
              {" "}{fmt(PATROL_SPD_KMH)} km/h ; on la croise, on l'entend, on ne la commande pas.
            </P>
            <P>Cette population est persistante : elle survit aux redémarrages du serveur.</P>

          </Sec>

          <Sec t="14 · Bulletin officiel">
            <P>
              La compagnie publie un bulletin à {Math.round(NEWSLETTER_MIN[0] / 60)} h et
              {" "}{Math.round(NEWSLETTER_MIN[1] / 60)} h (heure de Paris) — reçu par TOUS les
              navigateurs, même hors ligne (badge de non-lus à la reconnexion). Il ne s'écrit
              jamais dans le journal de bord : un bouton dédié l'ouvre.
            </P>
            <P>
              Contenu : classement officiel (points livrés au port), classement officieux (points
              potentiels des codes en cale), météo dominante des quatre quadrants de la carte
              (N-O / N-E / S-O / S-E), et zone d'exclusion PUBLIÉE — le seul canal de mise à jour
              de la zone pour les joueurs. Archive des {NEWS_MAX} dernières éditions.
            </P>
            <P>
              La zone d'exclusion délimite un périmètre autour de la position estimée de la Bête —
              le pourquoi en reste à la discrétion de la compagnie. Navigation dans le secteur à
              vos risques et périls.
            </P>

          </Sec>

          <Sec t="15 · Poste de barre">
            <P>
              L'interface est le poste de barre du navire : vue de dessus, fenêtre d'ambiance,
              console de barre, table à cartes, poste radio, sonar, journal de bord. Tout y est
              un objet physique cliquable ou glissable.
            </P>
            <Kv rows={[
              ["Fenêtre d'ambiance", "habillage PUR — aucune détection n'y est calculée : ciel, soleil, étoiles, nuages, pluie, brouillard, éclairs, mer qui tangue, immersion — pilotés par l'heure de jeu et la météo du serveur"],
              ["Vue de dessus", "disque horizon " + fmt(HORIZON_KM) + " km, zoom ×1–×16 (molette, pincement) : côte, îles, port, avant-postes, balises, traces, navires détectés — servis par le serveur depuis la position vraie ; c'est LA vue d'observation du jeu"],
              ["Source unique des observations visuelles", "le périscope — surface OU (plongée + périscope sorti) ; périscope rentré en plongée = volets anti-pression baissés, aucune vue extérieure"],
              ["Volets anti-pression", "en plongée périscope rentré, lamelles cuivre ; la colonne d'eau et les bulles restent visibles à ~50 % entre les lames"],
              ["Œilleton du périscope", "en plongée périscope sorti : masque radial laiton + réticule croix + teinte cyan sur la fenêtre d'ambiance — habillage pur, aucune détection n'y est calculée"],
              ["Drisse", "haler la poignée vers le BAS hisse la voile (sens physique) — proportionnel, poignée en haut = 0 %"],
              ["Levier d'immersion", "BINAIRE, sans crans : SURFACE = faire surface, PLONGÉE = plonger"],
              ["Manette électrique", `MODULABLE 0–100 % — consigne de machine PARTAGÉE avec la manette thermique (une seule machine, deux moteurs) ; le bouton « contact » enclenche l'électrique. Le dosage module la vitesse (${fmt(SCOPE_SPD_KMH)} km/h max en périscope, ${fmt(SUB_SPD_KMH)} km/h en plongée) et la décharge des batteries`],
              ["Consigne électrique indépendante", "la manette électrique règle la consigne du moteur ÉLECTRIQUE, indépendante de la consigne du moteur thermique : bouger l'une ne bouge pas l'autre"],
              ["Consignes continues", "roue, manettes, drisse, antennes : envoi throttlé à 10 Hz pendant le glissement + envoi final au relâchement"],
              ["Compas de route", "repère rouge = cap réel, ambre = consigne"],
              ["Portées visuelles", `jour : ile ${fmt(VIS_BASE.ile)} km · nuit : ile ${fmt(VIS_NUIT.ile)} km — les détections servies par le serveur s'arrêtent à ces portées`],
              ["Phare la nuit", `feu visible à ${fmt(SHIP_VIS_LIGHT)} km`],
            ]} />
          </Sec>
          <Sec t="16 · Annexe technique — équilibrage">
            <P>
              Toutes les valeurs de ce manuel proviennent des constantes du moteur, importées
              directement : elles reflètent l'équilibrage exact de la version en cours, sans copie
              manuelle. Cette annexe les regroupe ; elle couvre les systèmes documentés ci-dessus.
            </P>
            {ANNEX.map((g) => (
              <div key={g.titre} className="space-y-1.5">
                <p className="engrave pt-1 text-[9.5px] uppercase tracking-wider">{g.titre}</p>
                <Kv rows={g.rows} />
              </div>
            ))}
          </Sec>

          <p className="engrave pt-1 text-center text-[8.5px] uppercase tracking-[0.18em]">Échap ou clic à l'extérieur pour reprendre la navigation.</p>
        </div>
      </div>
    </div>
  );
}
