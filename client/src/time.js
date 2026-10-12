// Heure de jeu : dérivée UNIQUEMENT de t (minutes de jeu), jamais de l'horloge
// du navigateur. gameHour() suit le repère moteur ((t/60) % 24) : ciel et
// jour/nuit toujours synchronisés avec le serveur. L'affichage horodaté
// (fmtT, fmtTime, fmtParis, fmtParisLong) force le fuseau Europe/Paris :
// par défaut (pas de saut) c'est l'heure de Paris réelle ; après un saut de
// temps, t porte l'avance et l'heure affichée est VOLONTAIREMENT en avance
// (désynchronisation de debug assumée).

import { MS_PER_MIN } from "../../shared/engine.js";

export const gameHour = (t) => (t / 60) % 24; // repère moteur : pilote ciel et vitres

const TZ = { timeZone: "Europe/Paris" };
const fTime = new Intl.DateTimeFormat("fr-FR", { ...TZ, hour: "2-digit", minute: "2-digit" });
const fDateShort = new Intl.DateTimeFormat("fr-FR", { ...TZ, weekday: "short", day: "numeric", month: "short" });
const fFull = new Intl.DateTimeFormat("fr-FR", { ...TZ, dateStyle: "short", timeStyle: "medium" });
const fDateLong = new Intl.DateTimeFormat("fr-FR", { ...TZ, weekday: "long", day: "numeric", month: "long" });

const at = (t, epoch) => new Date((epoch || 0) + t * MS_PER_MIN);

export const fmtTime = (t, epoch) => fTime.format(at(t, epoch));
export const fmtT = (t, epoch) => fDateShort.format(at(t, epoch)).toUpperCase() + " " + fTime.format(at(t, epoch));
export const fmtParis = (t, epoch) => fFull.format(at(t, epoch));
export const fmtParisLong = (t, epoch) => fDateLong.format(at(t, epoch));
