import type { StoredChatSession } from './chat-session';
import type { BudgetReport, ItineraryDraft } from './run-events';
import { initialRunState, type RunState } from './run-state.ts';

// "Im Chat bearbeiten": Antwort von POST /agent/drafts. Die API hat die
// gespeicherte Reise zum Entwurf der neuen Session gemacht; dieselbe Form wie
// itinerary.draft plus Budgetbericht.
export interface SeededDraft {
  itineraryId: string;
  revision: number;
  itinerary: ItineraryDraft;
  assumptions: string[];
  budget?: BudgetReport;
}

// Erste Nachricht im Chat beim Bearbeiten, mit Beispielen für Änderungen
export function editIntro(destination: string): string {
  return (
    `Hier ist deine gespeicherte Reise nach **${destination}**. Was möchtest du ändern? Zum Beispiel:\n\n` +
    '- „Mach Tag 2 entspannter“\n' +
    '- „Tausch das Museum gegen etwas draußen“\n' +
    '- „Einen Tag länger bleiben“\n\n' +
    'Die erste Änderung holt Wetter und Unterkünfte neu. Gespeichert wird erst mit „Änderungen speichern“.'
  );
}

// Chat-Stand für den Tab: eine Antwort des Planers, deren Lauf den Entwurf
// trägt, damit Arbeitsfläche, Fassungen und Speichern wie bei einem frisch
// geplanten Entwurf funktionieren. Die Antwort zählt als gespeichert (es ist
// ja die Reise selbst), deshalb warnt der Chat erst nach einer Änderung.
export function editSession(
  sessionId: string,
  seed: SeededDraft,
): StoredChatSession<{ role: 'assistant'; content: string; trace: RunState }> {
  const trace: RunState = {
    ...initialRunState(),
    status: 'done',
    mode: 'multi',
    ...(seed.budget && { budget: seed.budget }),
    draft: {
      itinerary: seed.itinerary,
      assumptions: seed.assumptions,
      revision: seed.revision,
      itineraryId: seed.itineraryId,
    },
    reply: editIntro(seed.itinerary.destination),
  };
  return {
    sessionId,
    messages: [{ role: 'assistant', content: trace.reply!, trace }],
    saved: { 0: seed.itineraryId },
  };
}

// Läuft der Chat gerade an einer gespeicherten Reise? Dann gilt der
// Multi-Modus: Nur der Orchestrator kennt den Entwurf der Session.
export function editedItinerary(traces: (RunState | undefined)[]): string | undefined {
  const latest = traces.findLast((trace) => trace?.status === 'done' && trace.draft);
  return latest?.draft?.itineraryId;
}
