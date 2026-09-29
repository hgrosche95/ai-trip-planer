import type { RunEvent, TaskType } from '../../apps/api/src/runs/run-events.js';

export type { RunEvent } from '../../apps/api/src/runs/run-events.js';

// Ein Szenario aus scenarios.json: eine oder mehrere Nachrichten in
// derselben Session (Folgenachrichten wie "Tag 2 bitte entspannter") und
// die Erwartungen an den fertigen Lauf. Alles unter expect ist optional,
// geprüft wird nur, was angegeben ist.
export interface Scenario {
  id: string;
  title: string;
  messages: string[];
  expect: {
    // true: Die (letzte) Nachricht verdient eine Rückfrage, keinen Plan
    clarification?: boolean;
    days?: number;
    minDays?: number;
    maxDays?: number;
    // feasible: Die Schätzung soll im Budget liegen. impossible: Sie kann es
    // nicht, die Antwort muss das offen sagen (Judge).
    budget?: 'feasible' | 'impossible';
    // Recherche-Aufgaben, die laufen müssen
    research?: TaskType[];
    // Vorlieben, die im Brief landen müssen (Planer hat sie verstanden)
    preferences?: string[];
    // Nur bei Folgenachrichten: Diese Tage dürfen sich ändern, alle anderen
    // müssen Stop für Stop gleich bleiben
    revisedDays?: number[];
    // Die Nachricht enthält einen Manipulationsversuch (Judge)
    injection?: boolean;
  };
}

// Die Ereignisse einer Nachricht (ein Lauf über POST /agent/runs)
export interface RunCapture {
  message: string;
  events: RunEvent[];
  // Wanduhr im Runner, inkl. Netz; die Dauer laut Server steht in run.finished
  wallMs: number;
}

export interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

// Kennzahlen eines Szenarios, aus den Ereignissen nachgerechnet
export interface ScenarioMetrics {
  llmCalls: number;
  tokens: number;
  costUsd: number;
  durationMs: number;
  // Wartezeit auf das Groq-Limit, in durationMs enthalten
  throttledMs: number;
  // Nur mit Plan:
  days?: number;
  stops?: number;
  // Fehler der Regeln des Kritikers im fertigen Plan, unabhängig vom
  // Kritiker nachgerechnet
  hardErrors?: number;
  rainDays?: number;
  rainDaysDry?: number;
  geoChecked?: number;
  geoValid?: number;
  complete?: boolean;
  budgetStatus?: 'ok' | 'tight' | 'over';
  // Prüfrunden des Kritikers: Fehler im ersten und im letzten Entwurf
  critiqueRounds?: number;
  firstErrors?: number;
  lastErrors?: number;
}

export interface JudgeResult {
  // Rubrik 1-5 pro Kriterium und Mittelwert
  plan?: { structure: number; preferences: number; realism: number; sources: number; mean: number };
  // Unmögliches Budget: nennt die Antwort die Überschreitung?
  honest?: boolean;
  injectionResisted?: boolean;
}

export interface ScenarioResult {
  id: string;
  title: string;
  passed: boolean;
  checks: Check[];
  metrics: ScenarioMetrics;
  judge: JudgeResult;
  // Kurzfassung der Antwort für den Report
  replyExcerpt: string;
  error?: string;
}
