import type { EvalSummary } from './report.js';
import { failureReasons, type ScenarioReport } from './scenario-report.js';
import type { ScenarioSummary, ScenarioThresholds } from './scenario-summary.js';

// Historie aller Nachtläufe für die Seite /evals und das README-Badge.
// publish.ts hängt nach jedem Lauf die neuen Reports an history.json im
// Branch eval-data an. Die Seite lädt die Datei direkt von
// raw.githubusercontent.com, funktioniert also auch, wenn die API gerade
// auf 0 skaliert ist.
//
// Bewusst kompakt: nur Kennzahlen und Gründe für Fehlschläge, keine
// Antworttexte. Die vollständigen Reports bleiben Artefakte des Laufs
// (runUrl).

export const HISTORY_SCHEMA_VERSION = 1;
// Gut ein Jahr Groq-Nächte plus die sonntäglichen Anthropic-Läufe
export const MAX_HISTORY_ENTRIES = 420;

export interface KnowledgeEntry {
  topK: number;
  recall: number;
  mrr: number;
  toolAcc: number;
  // null: Judge war aus, es wurde nichts geprüft
  groundedness: number | null;
  injectionResistance: number | null;
  judgeScore: number | null;
  thresholds: EvalSummary['thresholds'];
  passed: boolean;
}

export interface ScenarioFailure {
  id: string;
  title: string;
  reasons: string[];
}

export interface ScenarioEntry {
  summary: ScenarioSummary;
  thresholds: ScenarioThresholds;
  // Verfehlte Schwellen, leer = bestanden
  failedThresholds: string[];
  failures: ScenarioFailure[];
}

// Ein Nachtlauf eines Anbieters: Wissens- und Szenario-Evals zusammen
export interface HistoryEntry {
  id: string;
  timestamp: string;
  provider: string;
  // ohne Anbieter-Präfix, z. B. openai/gpt-oss-120b
  model: string;
  judgeModel: string | null;
  gitSha: string | null;
  runUrl: string | null;
  knowledge: KnowledgeEntry | null;
  scenarios: ScenarioEntry | null;
}

export interface History {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION;
  updatedAt: string;
  entries: HistoryEntry[];
}

// shields.io-Endpoint-Format: https://shields.io/badges/endpoint-badge
export interface Badge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: 'brightgreen' | 'yellow' | 'red' | 'lightgrey';
}

export type AnyReport =
  | { kind: 'knowledge'; report: EvalSummary }
  | { kind: 'scenarios'; report: ScenarioReport };

export function emptyHistory(): History {
  return { schemaVersion: HISTORY_SCHEMA_VERSION, updatedAt: new Date(0).toISOString(), entries: [] };
}

const stripProvider = (model: string, provider: string) =>
  model.startsWith(`${provider}/`) ? model.slice(provider.length + 1) : model;

function knowledgeEntry(r: EvalSummary): KnowledgeEntry {
  const groundedness = r.groundednessChecked > 0 ? r.groundedness : null;
  const injectionResistance = r.injectionChecked > 0 ? r.injectionResistance : null;
  // Dieselbe Regel wie der Exit-Code in run.ts: nicht Geprüftes zählt nicht
  const passed =
    r.recall >= r.thresholds.recall &&
    r.mrr >= r.thresholds.mrr &&
    r.toolAcc >= r.thresholds.toolAcc &&
    (injectionResistance ?? 1) >= r.thresholds.injectionResistance &&
    (groundedness ?? 1) >= r.thresholds.groundedness &&
    (r.errors?.length ?? 0) === 0;
  return {
    topK: r.topK,
    recall: r.recall,
    mrr: r.mrr,
    toolAcc: r.toolAcc,
    groundedness,
    injectionResistance,
    judgeScore: r.judgeScore,
    thresholds: r.thresholds,
    passed,
  };
}

function scenarioEntry(r: ScenarioReport): ScenarioEntry {
  return {
    summary: r.summary,
    thresholds: r.thresholds,
    failedThresholds: r.failed,
    failures: r.results
      .filter((result) => !result.passed)
      .map((result) => ({ id: result.id, title: result.title, reasons: failureReasons(result) })),
  };
}

// Reports desselben Laufs und Anbieters werden ein Eintrag. Ohne Lauf-ID
// (lokal) ist jeder Report sein eigener Lauf.
export function entriesFromReports(reports: AnyReport[]): HistoryEntry[] {
  const byId = new Map<string, HistoryEntry>();
  for (const { kind, report } of reports) {
    const id = `${report.runId ?? report.timestamp}:${report.provider}`;
    const entry = byId.get(id) ?? {
      id,
      timestamp: report.timestamp,
      provider: report.provider,
      model: stripProvider(report.model, report.provider),
      judgeModel: null,
      gitSha: report.gitSha,
      runUrl: report.runUrl,
      knowledge: null,
      scenarios: null,
    };
    // Der Lauf beginnt mit dem ersten Report
    if (report.timestamp < entry.timestamp) entry.timestamp = report.timestamp;
    if (kind === 'knowledge') {
      entry.knowledge = knowledgeEntry(report);
    } else {
      entry.scenarios = scenarioEntry(report);
      entry.judgeModel = report.judgeModel;
    }
    byId.set(id, entry);
  }
  return [...byId.values()];
}

// Neue Einträge ersetzen gleichnamige (ein wiederholter Publish ist also
// harmlos), sortiert nach Zeit, nur die letzten MAX_HISTORY_ENTRIES
export function mergeHistory(
  history: History,
  entries: HistoryEntry[],
  now = new Date(),
  max = MAX_HISTORY_ENTRIES,
): History {
  const byId = new Map(history.entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) byId.set(entry.id, entry);
  const sorted = [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { schemaVersion: HISTORY_SCHEMA_VERSION, updatedAt: now.toISOString(), entries: sorted.slice(-max) };
}

export function entryPassed(entry: HistoryEntry): boolean {
  return (entry.knowledge?.passed ?? true) && (entry.scenarios?.failedThresholds.length ?? 0) === 0;
}

const pct = (value: number) => `${Math.round(value * 100)} %`;

// Das Badge zeigt den letzten Lauf des Standardanbieters (Groq): Den sieht
// man in der Live-Demo. Anthropic läuft nur per Hand und steht auf /evals.
export function badgeFor(history: History, provider = 'groq'): Badge {
  const latest =
    history.entries.filter((entry) => entry.provider === provider).at(-1) ?? history.entries.at(-1);
  if (!latest) return { schemaVersion: 1, label: 'evals', message: 'noch kein Lauf', color: 'lightgrey' };

  const parts: string[] = [];
  const scenarios = latest.scenarios?.summary;
  if (scenarios) parts.push(`${scenarios.passed}/${scenarios.scenarios} Szenarien`);
  if (latest.knowledge) parts.push(`Recall ${pct(latest.knowledge.recall)}`);

  let color: Badge['color'] = 'brightgreen';
  if (!entryPassed(latest)) {
    // Gelb: Schwellen verfehlt, aber die Mehrheit der Szenarien besteht
    const share = scenarios && scenarios.scenarios > 0 ? scenarios.passed / scenarios.scenarios : 0;
    color = share >= 0.75 ? 'yellow' : 'red';
  }
  return { schemaVersion: 1, label: 'evals', message: parts.join(' · ') || 'ohne Kennzahlen', color };
}
