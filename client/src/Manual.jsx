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
  SOUND_KMH, SOUND_DECAY_KM, SONAR_RANGE_KM, SONAR_PING_BATTERY_COST, SONAR_ECHO_PERSIST_S,
  NPC_FISHERMEN, NPC_CARGOS, NPC_WHALES, FISHER_RANGE_KM, FISHER_SPD_KMH,
  CARGO_SPD_KMH, WHALE_SPD_KMH,
  RARITY_MIN, RARITY_STYLE, VIS_BASE, VIS_NUIT,
} from "../../shared/engine.js";

const fmt = (v) => (typeof v === "number" ? String(Math.round(v * 10) / 10).replace(".", ",") : String(v));
// Portées d'émergence dérivées des constantes (jamais figées)
const OMNI_LONG_KM = LONG_DECAY_KM * (1 - OMNI_DETECT_PCT / 100);   // lecture omni, famille longue
const OMNI_SHORT_KM = SHORT_DECAY_KM * (1 - OMNI_DETECT_PCT / 100); // lecture omni, famille courte
const DIR_LONG_KM = LONG_DECAY_KM * (1 - dirSensitivity(1) / 100);  // lecture directionnelle 1°, famille longue
const SONAR_MAX_RANGE_KM = Math.max(...Object.values(SONAR_RANGE_KM)); // portée max du ping (îles/côte)
const ECHO_FULL_MIN = (2 * SONAR_MAX_RANGE_KM) / (SOUND_KMH / 60);     // aller-retour plein portée
const SONG_FULL_MIN = SOUND_DECAY_KM.biologique / (SOUND_KMH / 60);    // chant au bord de sa portée

function Sec({ t, children, open }) {
  return (
    <details name="pc-manuel" open={open} className="rounded-lg border border-slate-700 bg-slate-800/50">
      <summary className="cursor-pointer select-none rounded-lg px-3 py-2 text-sm font-semibold text-sky-300 hover:bg-slate-700/40">
        {t}
      </summary>
      <div className="space-y-2 px-4 pb-4 pt-1 text-xs leading-relaxed text-slate-300">{children}</div>
    </details>
  );
}

// Petite grille clé/valeur (annexes et tableaux)
function Kv({ rows }) {
  return (
    <div className="grid grid-cols-[minmax(9rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-slate-700/60 bg-slate-900/60 p-2.5">
      {rows.map(([k, v], i) => (
        <Fragment key={i}>
          <span className="text-slate-400">{k}</span>
          <span className="tabular-nums text-slate-200">{v}</span>
        </Fragment>
      ))}
    </div>
  );
}

const P = ({ children }) => <p className="text-slate-300">{children}</p>;

// ---------- Annexe technique : générée depuis les constantes importées ----------
const ANNEX = [
  {
    titre: "Monde & balises",
    rows: [
      ["Carte", MAP + "° × " + MAP + "° — " + fmt(MAP * DEG_KM) + " km de côté (1° = " + fmt(DEG_KM) + " km)"],
      ["Séparation minimale des îles", fmt(ISLAND_SEP_KM) + " km"],
      ["Balises", "40 : 20 communes, 10 rares, 5 légendaires, 5 inconnues"],
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
      ["Courant", fmt(CUR_SPD_MIN_KMH) + " à " + fmt(CUR_SPD_MAX_KMH) + " km/h (jamais intégré à l'estime)"],
      ["Croissance de l'incertitude", "+ " + fmt(UNC_PER_KM) + " km par km parcouru · + " + fmt(UNC_PER_H) + " km par heure"],
      ["Point aux étoiles", fmt(NAVFIX_MIN) + " min · plancher " + fmt(NAVFIX_BASE_KM) + " km · + " + fmt(NAVFIX_CLOUD_KM) + " km par % de nuages · + " + fmt(NAVFIX_SEA_KM) + " km par m de houle · + " + fmt(NAVFIX_VIS_KM) + " km par km de visibilité sous " + fmt(NAVFIX_VIS_REF_KM) + " km · nouvelle tentative " + fmt(NAVFIX_RETRY_MIN) + " min après échec"],
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
      ["Solaire (de jour)", "+ " + fmt(SOLAR_PCT_H) + " %/h"],
      ["Vivres", fmt(FOOD_PCT_H) + " %/h"],
      ["Alerte ressources", fmt(RES_WARN_PCT) + " % — réarmée au-dessus de " + fmt(RES_WARN_RESET_PCT) + " %"],
    ],
  },
  {
    titre: "Sonar",
    rows: [
      ["Vitesse du son (eau)", "≈ " + fmt(SOUND_KMH) + " km/h"],
      ["Décroissance des bruits", "par type — moteur " + fmt(SOUND_DECAY_KM.moteur) + " · pêcheur " + fmt(SOUND_DECAY_KM.pecheur) + " · cargo " + fmt(SOUND_DECAY_KM.cargo) + " · ping " + fmt(SOUND_DECAY_KM.ping) + " · biologique " + fmt(SOUND_DECAY_KM.biologique) + " km"],
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
        className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl border border-slate-700 bg-slate-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-sky-300">📖 Manuel du jeu</h2>
            <p className="text-[11px] text-slate-400">Référence des systèmes et de l'équilibrage — valeurs lues directement dans le moteur.</p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700"
          >
            Fermer ✕
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto pr-1">
          <Sec t="1 · Le monde" open>
            <P>
              L'océan couvre {MAP}° × {MAP}°, soit {fmt(MAP * DEG_KM)} km de côté (1° = {fmt(DEG_KM)} km).
              On y trouve un continent, un port de départ, 10 îles et 5 avant-postes — les îles sont
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
              40 balises flottent en pleine eau : 20 communes ({RARITY_STYLE.commune.pts} pt),
              10 rares ({RARITY_STYLE.rare.pts} pts), 5 légendaires ({RARITY_STYLE.legendaire.pts} pts)
              et 5 inconnues ({RARITY_STYLE.inconnue.pts} pts). Chacune possède un code radio à 4 chiffres.
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
              Ordres de grandeur par vent fort : environ 15 km/h au près serré, 33 km/h au travers,
              40 km/h au largue (l'allure la plus rapide) et 29 km/h au vent arrière. En tempête, le
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
              Les prévisions sont parfaites sur {fmt(WX_HORIZON_H)} h et accessibles via le service
              météo du NETWORK, en zone (port, avant-poste ou balise).
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
              Trois sources de divergence : la déviation de compas (± {fmt(COMP_DEV_MIN_DEG)} à
              {" "}{fmt(COMP_DEV_MAX_DEG)}°), l'erreur de loch (± {fmt(LOG_ERR_MIN_PCT)} à
              {" "}{fmt(LOG_ERR_MAX_PCT)} % sur la distance parcourue) et le courant
              ({" "}{fmt(CUR_SPD_MIN_KMH)} à {fmt(CUR_SPD_MAX_KMH)} km/h), qui déporte le navire réel
              mais n'est jamais intégré à l'estime.
            </P>
            <P>
              Le cercle d'incertitude affiché grandit de {fmt(UNC_PER_KM)} km par km parcouru et de
              {" "}{fmt(UNC_PER_H)} km par heure (dérives lentes). À 30 km/h, l'incertitude croît
              d'environ 2,6 km par heure de route.
            </P>
            <P>
              Deux moyens de recentrer l'estime : le point aux étoiles ({fmt(NAVFIX_MIN)} min
              d'observation, de nuit, ciel suffisamment dégagé — plancher {fmt(NAVFIX_BASE_KM)} km,
              aggravé par les nuages, la houle et la brume, nouvelle tentative {fmt(NAVFIX_RETRY_MIN)} min
              après un échec) et le point visuel : reconnaître un repère connu (île, balise, port,
              avant-poste, côte) recentre l'estime sous les seuils de détection ci-dessous.
            </P>
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
              Autoguidage (interrupteur de l'onglet radio, défaut « {AUTOGUIDE_DEFAULT === "off" ? "Aucun" : AUTOGUIDE_DEFAULT} ») :
              au premier ping fort, le pilote s'engage et l'ordinateur oriente l'antenne sur la source,
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
              ["Solaire (de jour)", "+ " + fmt(SOLAR_PCT_H) + " %/h"],
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

          <Sec t="11 · Sonar">
            <P>
              Passif (hydrophone) : continu, gratuit, en surface comme en plongée. Il ne donne qu'un
              gisement — aucune distance. Les icônes se placent au bord du cercle, l'opacité traduit la
              force, qui tombe à zéro à une distance propre à chaque bruit : moteur
              {" "}{fmt(SOUND_DECAY_KM.moteur)} km, pêcheur en transit {fmt(SOUND_DECAY_KM.pecheur)} km,
              cargo {fmt(SOUND_DECAY_KM.cargo)} km, ping {fmt(SOUND_DECAY_KM.ping)} km, chant
              biologique {fmt(SOUND_DECAY_KM.biologique)} km. Un navire à la voile ou en
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

          <Sec t="12 · Vie du monde">
            <P>
              La mer est habitée : {NPC_FISHERMEN} pêcheurs travaillent autour des côtes (jusqu'à
              {" "}{fmt(FISHER_RANGE_KM)} km au large, transit à {fmt(FISHER_SPD_KMH)} km/h —
              silencieux à la pêche, bruyants en transit), {NPC_CARGOS} cargos traversent la carte
              bord à bord ({fmt(CARGO_SPD_KMH)} km/h), {NPC_WHALES} baleines errent partout
              ({" "}{fmt(WHALE_SPD_KMH)} km/h).
            </P>
            <P>
              À la radio : les pêcheurs bavardent en diffusion (lisible par tous dans la zone de
              réception), les cargos s'échangent des messages privés — interceptables en brouillé
              comme toute émission. Au sonar, les chants de baleines s'affichent comme signaux
              biologiques.
            </P>
            <P>Cette population est persistante : elle survit aux redémarrages du serveur.</P>

          </Sec>

          <Sec t="13 · Annexe technique — équilibrage">
            <P>
              Toutes les valeurs de ce manuel proviennent des constantes du moteur, importées
              directement : elles reflètent l'équilibrage exact de la version en cours, sans copie
              manuelle. Cette annexe les regroupe ; elle couvre les systèmes documentés ci-dessus.
            </P>
            {ANNEX.map((g) => (
              <div key={g.titre} className="space-y-1.5">
                <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.titre}</p>
                <Kv rows={g.rows} />
              </div>
            ))}
          </Sec>

          <p className="pt-1 text-center text-[11px] text-slate-500">Échap ou clic à l'extérieur pour reprendre la navigation.</p>
        </div>
      </div>
    </div>
  );
}
