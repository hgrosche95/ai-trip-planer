// Rechnet aus den Ereignissen eines Laufs nach, wie gut der fertige Plan
// ist - unabhängig davon, was der Kritiker selbst gemeldet hat. Dafür nutzt
// es dieselben Regelfunktionen wie der Kritiker (apps/api/src/orchestrator/
// rules): Sie sind reine Funktionen ohne Abhängigkeiten und lassen sich
// direkt importieren.
import { checkRules } from '../../apps/api/src/orchestrator/rules/index.js';
import { NEAR_KM } from '../../apps/api/src/orchestrator/rules/far-away.rule.js';
import { RAIN_MM, isOutdoor } from '../../apps/api/src/orchestrator/rules/rain-outdoor.rule.js';
import { dateOfDay, isProgram } from '../../apps/api/src/orchestrator/rules/rule.types.js';
import { haversineKm } from '../../apps/api/src/tools/transport-estimate.tool.js';
import type { RuleInput } from '../../apps/api/src/orchestrator/rules/index.js';
import type { RunEventPayloads } from '../../apps/api/src/runs/run-events.js';
import type {
  Check,
  RunCapture,
  RunEvent,
  Scenario,
  ScenarioMetrics,
} from './scenario-types.js';

type Payload<T extends RunEvent['type']> = RunEventPayloads[T];

function all<T extends RunEvent['type']>(events: RunEvent[], type: T): Payload<T>[] {
  return events.filter((event) => event.type === type).map((event) => event.data as Payload<T>);
}

function last<T extends RunEvent['type']>(events: RunEvent[], type: T): Payload<T> | undefined {
  return all(events, type).at(-1);
}

export function finalDraft(capture: RunCapture) {
  return last(capture.events, 'itinerary.draft');
}

export function replyOf(capture: RunCapture): string {
  return last(capture.events, 'message.completed')?.text ?? '';
}

// RuleInput aus den Ereignissen: Entwurf, Ziel, Wetter und Budget stehen
// darin. Feiertage und Unterkünfte nicht, die Feiertagsregel ist ohnehin
// nur ein Hinweis. outdoor fehlt im gespeicherten Entwurf, dann entscheidet
// wie im Kritiker der Titel.
export function ruleInput(capture: RunCapture): RuleInput | undefined {
  const draft = finalDraft(capture);
  const budget = last(capture.events, 'budget.updated');
  if (!draft || !budget) return undefined;
  const destination = all(capture.events, 'place.added').find((place) => place.kind === 'destination');
  const weather = last(capture.events, 'weather.updated');
  const itinerary = draft.itinerary;
  return {
    brief: {
      destination: itinerary.destination,
      startDate: itinerary.startDate,
      endDate: itinerary.endDate,
      datesAssumed: false,
      travelers: 1,
      preferences: itinerary.preferences,
      assumptions: draft.assumptions,
    },
    draft: { ...itinerary, stops: itinerary.stops },
    findings: {
      ...(destination && {
        destination: { name: destination.name, lat: destination.lat, lng: destination.lng },
      }),
      ...(weather && { weather }),
      knowledge: [],
      sources: [],
      searchAttempted: false,
    },
    budget,
  };
}

function tripDays(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

// Summen über alle Nachrichten des Szenarios
function runTotals(captures: RunCapture[]) {
  let llmCalls = 0;
  let tokens = 0;
  let costUsd = 0;
  let durationMs = 0;
  let throttledMs = 0;
  for (const { events, wallMs } of captures) {
    const totals = last(events, 'run.finished')?.totals;
    const calls = all(events, 'llm.call');
    llmCalls += totals?.llmCalls ?? calls.length;
    tokens += totals
      ? totals.inputTokens + totals.outputTokens
      : calls.reduce((sum, call) => sum + call.inputTokens + call.outputTokens, 0);
    costUsd += totals?.costUsd ?? 0;
    durationMs += totals?.durationMs ?? wallMs;
    throttledMs += all(events, 'llm.throttled').reduce((sum, t) => sum + t.waitMs, 0);
  }
  return { llmCalls, tokens, costUsd: Math.round(costUsd * 1e6) / 1e6, durationMs, throttledMs };
}

// Kennzahlen des fertigen Plans (letzte Nachricht)
export function planMetrics(capture: RunCapture): Partial<ScenarioMetrics> {
  const draft = finalDraft(capture);
  const input = ruleInput(capture);
  if (!draft || !input) return {};
  const { itinerary } = draft;
  const days = tripDays(itinerary.startDate, itinerary.endDate);
  const stops = itinerary.stops;

  const hardErrors = checkRules(input).filter((v) => v.severity === 'error').length;

  // Regentage (ab RAIN_MM) ohne Programm draußen
  const rain = (input.findings.weather?.days ?? []).filter((day) => day.precipMm >= RAIN_MM);
  const rainDaysDry = rain.filter(
    (day) => !stops.some((stop) => dateOfDay(itinerary.startDate, stop.dayNumber) === day.date && isOutdoor(stop)),
  ).length;

  // Programm höchstens NEAR_KM vom Ziel (Anreise und Unterkunft zählen nicht)
  const center = input.findings.destination;
  const located = stops.filter((stop) => isProgram(stop) && stop.lat !== undefined && stop.lng !== undefined);
  const geoValid = center
    ? located.filter((stop) => haversineKm(center, { lat: stop.lat!, lng: stop.lng! }) <= NEAR_KM).length
    : located.length;

  const perDay = Array.from({ length: days }, (_, i) => stops.filter((stop) => stop.dayNumber === i + 1).length);
  const rounds = all(capture.events, 'critique');
  const errorsOf = (round: Payload<'critique'>) => round.violations.filter((v) => v.severity === 'error').length;

  return {
    days,
    stops: stops.length,
    hardErrors,
    rainDays: rain.length,
    rainDaysDry,
    geoChecked: located.length,
    geoValid,
    complete: perDay.every((count) => count >= 2),
    budgetStatus: input.budget.status,
    critiqueRounds: rounds.length,
    ...(rounds.length > 0 && {
      firstErrors: errorsOf(rounds[0]),
      lastErrors: errorsOf(rounds.at(-1)!),
    }),
  };
}

function researchTasks(capture: RunCapture): string[] {
  return all(capture.events, 'agent.started')
    .filter((step) => step.agent === 'research')
    .map((step) => step.task);
}

// Alle Erwartungen eines Szenarios, die sich ohne Judge prüfen lassen
export function evaluateScenario(
  scenario: Scenario,
  captures: RunCapture[],
): { checks: Check[]; metrics: ScenarioMetrics; error?: string } {
  const final = captures.at(-1)!;
  const expect = scenario.expect;
  const checks: Check[] = [];
  const check = (name: string, passed: boolean, detail?: string) =>
    checks.push({ name, passed, ...(detail !== undefined && { detail }) });

  const runError = captures.map((c) => last(c.events, 'run.error')).find(Boolean);
  const metrics: ScenarioMetrics = { ...runTotals(captures), ...planMetrics(final) };
  if (runError) {
    check('Lauf ohne Fehler', false, `${runError.code}: ${runError.message}`);
    return { checks, metrics, error: runError.code };
  }

  const draft = finalDraft(final);
  if (expect.clarification) {
    const research = researchTasks(final);
    check('Rückfrage statt Plan', !draft && replyOf(final).trim() !== '');
    check('keine Recherche', research.length === 0, research.join(', ') || undefined);
    return { checks, metrics };
  }

  check('Plan als Entwurf', draft !== undefined);
  if (!draft) return { checks, metrics };

  const days = metrics.days!;
  if (expect.days !== undefined) check(`${expect.days} Tage`, days === expect.days, `${days} Tage`);
  if (expect.minDays !== undefined || expect.maxDays !== undefined) {
    const min = expect.minDays ?? 1;
    const max = expect.maxDays ?? Infinity;
    check(`${min}–${max} Tage`, days >= min && days <= max, `${days} Tage`);
  }
  check('jeder Tag mit mindestens 2 Programmpunkten', metrics.complete === true);
  check('keine harten Regelverstöße im fertigen Plan', metrics.hardErrors === 0, `${metrics.hardErrors} Fehler`);
  if (metrics.rainDays! > 0) {
    check('Regentage ohne Programm draußen', metrics.rainDaysDry === metrics.rainDays, `${metrics.rainDaysDry}/${metrics.rainDays}`);
  }
  if (metrics.geoChecked! > 0) {
    check(`Programm höchstens ${NEAR_KM} km vom Ziel`, metrics.geoValid === metrics.geoChecked, `${metrics.geoValid}/${metrics.geoChecked}`);
  }
  if (expect.budget === 'feasible') {
    check('Budget eingehalten', metrics.budgetStatus !== 'over', metrics.budgetStatus);
  }
  if (expect.budget === 'impossible') {
    check('Budget als überschritten erkannt', metrics.budgetStatus === 'over', metrics.budgetStatus);
  }
  for (const task of expect.research ?? []) {
    check(`Recherche ${task}`, researchTasks(final).includes(task));
  }
  for (const preference of expect.preferences ?? []) {
    const known = draft.itinerary.preferences.some((p) => p.toLowerCase().includes(preference.toLowerCase()));
    check(`Vorliebe "${preference}" verstanden`, known, draft.itinerary.preferences.join(', '));
  }
  if (expect.revisedDays) {
    const first = captures.length > 1 ? finalDraft(captures[0]) : undefined;
    check('Überarbeitung als neue Fassung', draft.revision === (first?.revision ?? 0) + 1, `Fassung ${draft.revision}`);
    if (first) {
      const keep = (d: typeof draft) =>
        JSON.stringify(
          d.itinerary.stops
            .filter((stop) => !expect.revisedDays!.includes(stop.dayNumber))
            .map(({ dayNumber, order, title }) => [dayNumber, order, title]),
        );
      check(`nur Tag ${expect.revisedDays.join(', ')} geändert`, keep(first) === keep(draft));
    }
  }
  return { checks, metrics };
}
