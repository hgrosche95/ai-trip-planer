import { haversineKm } from '../../tools/transport-estimate.tool';
import { isProgram, stopRef } from './rule.types';
import type { Rule } from './rule.types';

// Bis hierhin ist ein Programmpunkt in der Stadt oder nah dran
export const NEAR_KM = 30;
// Darüber sind die Koordinaten fast sicher falsch (anderes Land, vertauschte
// Zahlen); dazwischen ist es ein Tagesausflug, den der Nutzer kennen sollte.
export const WRONG_KM = 150;

// Programmpunkte weit weg vom Ziel (Zentrum aus der Geokodierung)
export const farAwayRule: Rule = {
  id: 'far-away',
  description: `Programm liegt höchstens ${NEAR_KM} km vom Ziel entfernt; ab ${WRONG_KM} km sind die Koordinaten falsch`,
  check({ draft, findings }) {
    const center = findings.destination;
    if (!center) return [];
    return draft.stops.filter(isProgram).flatMap((stop) => {
      if (stop.lat === undefined || stop.lng === undefined) return [];
      const km = Math.round(
        haversineKm(center, { lat: stop.lat, lng: stop.lng }),
      );
      if (km <= NEAR_KM) return [];
      const wrong = km > WRONG_KM;
      return [
        {
          ruleId: 'far-away',
          severity: wrong ? ('error' as const) : ('warning' as const),
          ...stopRef(stop),
          message: wrong
            ? `${stop.title} liegt ${km} km von ${center.name} entfernt, die Koordinaten passen nicht zum Ziel`
            : `${stop.title} ist ein Ausflug: ${km} km von ${center.name}`,
        },
      ];
    });
  },
};
