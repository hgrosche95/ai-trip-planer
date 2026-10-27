// Historie der Nachtläufe für /evals. Geschrieben von evals/src/publish.ts
// in den Branch eval-data; die Typen hier spiegeln evals/src/history.ts
// (nur die Felder, die die Seite liest).

export const EVAL_HISTORY_URL =
  process.env.NEXT_PUBLIC_EVAL_HISTORY_URL ??
  'https://raw.githubusercontent.com/hgrosche95/ai-trip-planer/eval-data/history.json';

export const EVAL_METHOD_URL = 'https://github.com/hgrosche95/ai-trip-planer/blob/main/evals/README.md';

export interface ScenarioSummary {
  scenarios: number;
  passed: number;
  budgetCompliance: number | null;
  hardErrorsAvg: number | null;
  tokensP50: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  costUsd: number;
  judgeMean: number | null;
}

export interface ScenarioThresholds {
  budgetCompliance: number;
  hardErrorsAvg: number;
  judgeMean: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  judgeModel: string | null;
  gitSha: string | null;
  runUrl: string | null;
  knowledge: {
    topK: number;
    recall: number;
    toolAcc: number;
    thresholds: { recall: number; toolAcc: number };
    passed: boolean;
  } | null;
  scenarios: {
    summary: ScenarioSummary;
    thresholds: ScenarioThresholds;
    failedThresholds: string[];
    failures: { id: string; title: string; reasons: string[] }[];
  } | null;
}

export interface History {
  schemaVersion: number;
  updatedAt: string;
  entries: HistoryEntry[];
}

export async function fetchHistory(url = EVAL_HISTORY_URL): Promise<History> {
  // no-store: Die Datei ändert sich jede Nacht, der Browser-Cache soll
  // keinen Stand von gestern zeigen
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return { schemaVersion: 1, updatedAt: '', entries: [] };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Feste Reihenfolge und Farbe pro Anbieter: Die Farbe folgt dem Anbieter,
// nicht seiner Position (fehlt Anthropic, bleibt Groq blau)
export const PROVIDERS = [
  { id: 'groq', label: 'Groq', color: 'var(--series-1)' },
  { id: 'anthropic', label: 'Anthropic', color: 'var(--series-2)' },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]['id'];

export interface MetricDef {
  id: string;
  label: string;
  // Was die Zahl bedeutet, ein Satz unter dem Titel
  hint: string;
  value: (entry: HistoryEntry) => number | null;
  threshold: (entry: HistoryEntry) => number | null;
  format: (value: number) => string;
  // Feste Achse, damit kleine Schwankungen nicht wie Abstürze aussehen
  domain: [number, number];
  // 'max': Die Schwelle ist eine Obergrenze (weniger ist besser)
  bound: 'min' | 'max';
}

export const formatPct = (value: number) => `${Math.round(value * 100)} %`;
const formatDecimal = (digits: number) => (value: number) =>
  value.toFixed(digits).replace('.', ',');

export const METRICS: MetricDef[] = [
  {
    id: 'scenarios',
    label: 'Szenarien bestanden',
    hint: '12 ganze Reiseanfragen gegen den Multi-Agenten-Modus',
    value: (e) => (e.scenarios && e.scenarios.summary.scenarios > 0 ? e.scenarios.summary.passed / e.scenarios.summary.scenarios : null),
    threshold: () => null,
    format: formatPct,
    domain: [0, 1],
    bound: 'min',
  },
  {
    id: 'judge',
    label: 'Plan-Judge',
    hint: 'Rubrik 1–5: Tagesstruktur, Vorlieben, Realismus, Quellen',
    value: (e) => e.scenarios?.summary.judgeMean ?? null,
    threshold: (e) => e.scenarios?.thresholds.judgeMean ?? null,
    format: formatDecimal(2),
    domain: [1, 5],
    bound: 'min',
  },
  {
    id: 'budget',
    label: 'Budget-Einhaltung',
    hint: 'Pläne, deren Kostenschätzung im Budget liegt',
    value: (e) => e.scenarios?.summary.budgetCompliance ?? null,
    threshold: (e) => e.scenarios?.thresholds.budgetCompliance ?? null,
    format: formatPct,
    domain: [0, 1],
    bound: 'min',
  },
  {
    id: 'violations',
    label: 'Regelverstöße pro Plan',
    hint: 'Im fertigen Plan nachgerechnet, nicht vom Kritiker übernommen',
    value: (e) => e.scenarios?.summary.hardErrorsAvg ?? null,
    threshold: (e) => e.scenarios?.thresholds.hardErrorsAvg ?? null,
    format: formatDecimal(2),
    domain: [0, 1],
    bound: 'max',
  },
  {
    id: 'recall',
    label: 'Recall@3',
    hint: 'Wissenssuche: richtiges Dokument unter den ersten 3 Treffern',
    value: (e) => e.knowledge?.recall ?? null,
    threshold: (e) => e.knowledge?.thresholds.recall ?? null,
    format: formatPct,
    domain: [0, 1],
    bound: 'min',
  },
  {
    id: 'tools',
    label: 'Tool-Genauigkeit',
    hint: 'Sucht der Agent in der Wissensbasis, wenn er soll, und nur dann?',
    value: (e) => e.knowledge?.toolAcc ?? null,
    threshold: (e) => e.knowledge?.thresholds.toolAcc ?? null,
    format: formatPct,
    domain: [0, 1],
    bound: 'min',
  },
];

export interface SeriesPoint {
  time: number;
  value: number | null;
  entry: HistoryEntry;
}

export interface Series {
  provider: (typeof PROVIDERS)[number];
  points: SeriesPoint[];
}

export const WINDOW_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

// Die letzten WINDOW_DAYS Tage, gemessen am jüngsten Lauf (nicht an heute:
// Bleibt der Nightly eine Woche aus, wird das Diagramm nicht leer)
export function windowed(entries: HistoryEntry[], days = WINDOW_DAYS): HistoryEntry[] {
  if (entries.length === 0) return [];
  const newest = Math.max(...entries.map((e) => Date.parse(e.timestamp)));
  return entries.filter((e) => Date.parse(e.timestamp) > newest - days * DAY_MS);
}

// Ein Punkt pro Anbieter und Tag (UTC): Groq- und Anthropic-Lauf derselben
// Nacht starten zu verschiedenen Uhrzeiten, sollen aber übereinander
// stehen. Mehrere Läufe an einem Tag (von Hand nachgestartet): der letzte.
export const dayOf = (timestamp: string) => Math.floor(Date.parse(timestamp) / DAY_MS) * DAY_MS;

export function seriesFor(entries: HistoryEntry[], metric: MetricDef): Series[] {
  return PROVIDERS.map((provider) => {
    const byDay = new Map<number, SeriesPoint>();
    for (const entry of entries.filter((e) => e.provider === provider.id)) {
      const time = dayOf(entry.timestamp);
      const previous = byDay.get(time);
      if (!previous || previous.entry.timestamp <= entry.timestamp) {
        byDay.set(time, { time, value: metric.value(entry), entry });
      }
    }
    return { provider, points: [...byDay.values()].sort((a, b) => a.time - b.time) };
  }).filter((series) => series.points.some((p) => p.value !== null));
}

export function latestByProvider(entries: HistoryEntry[]): Map<ProviderId, HistoryEntry> {
  const latest = new Map<ProviderId, HistoryEntry>();
  for (const provider of PROVIDERS) {
    const entry = entries.filter((e) => e.provider === provider.id).at(-1);
    if (entry) latest.set(provider.id, entry);
  }
  return latest;
}

export function entryPassed(entry: HistoryEntry): boolean {
  return (entry.knowledge?.passed ?? true) && (entry.scenarios?.failedThresholds.length ?? 0) === 0;
}

// Szenarien, die über mehrere Nächte scheitern: Ein einzelner Fehlschlag
// kann Zufall sein, sieben von dreizehn sind ein Muster. Gezählt werden nur
// Läufe mit Szenario-Report, die Reihenfolge der Läufe ist alt -> neu.
export interface RecurringFailure {
  id: string;
  title: string;
  failed: number;
  runs: number;
  // Pro Lauf: true = gescheitert, false = bestanden
  history: boolean[];
  failedLatest: boolean;
  lastReasons: string[];
}

export function recurringFailures(entries: HistoryEntry[], provider: ProviderId, minFailed = 2): RecurringFailure[] {
  const runs = entries.filter((e) => e.provider === provider && e.scenarios);
  const byId = new Map<string, RecurringFailure>();
  runs.forEach((run, i) => {
    for (const failure of run.scenarios!.failures) {
      const item = byId.get(failure.id) ?? {
        id: failure.id,
        title: failure.title,
        failed: 0,
        runs: runs.length,
        history: runs.map(() => false),
        failedLatest: false,
        lastReasons: [],
      };
      item.failed++;
      item.history[i] = true;
      item.title = failure.title;
      item.lastReasons = failure.reasons;
      item.failedLatest = i === runs.length - 1;
      byId.set(failure.id, item);
    }
  });
  return [...byId.values()]
    .filter((item) => item.failed >= minFailed)
    .sort((a, b) => b.failed - a.failed || Number(b.failedLatest) - Number(a.failedLatest) || a.id.localeCompare(b.id));
}

// Zeilen des Modellvergleichs; Kosten pro Szenario, damit ein Lauf mit
// weniger Szenarien (z. B. abgebrochen) nicht billiger aussieht
export interface ComparisonRow {
  label: string;
  // Beschriftet, damit klar ist, in welche Richtung "besser" geht
  better: 'höher' | 'niedriger';
  value: (entry: HistoryEntry) => number | null;
  format: (value: number) => string;
}

const formatSeconds = (ms: number) => `${formatDecimal(1)(ms / 1000)} s`;

export const COMPARISON_ROWS: ComparisonRow[] = [
  { label: 'Szenarien bestanden', better: 'höher', value: METRICS[0].value, format: formatPct },
  { label: 'Plan-Judge (1–5)', better: 'höher', value: METRICS[1].value, format: formatDecimal(2) },
  {
    label: 'Kosten pro Szenario',
    better: 'niedriger',
    value: (e) => (e.scenarios && e.scenarios.summary.scenarios > 0 ? e.scenarios.summary.costUsd / e.scenarios.summary.scenarios : null),
    format: (v) => `${(v < 0.01 ? v.toFixed(4) : v.toFixed(3)).replace('.', ',')} $`,
  },
  { label: 'Tokens pro Szenario (p50)', better: 'niedriger', value: (e) => e.scenarios?.summary.tokensP50 ?? null, format: (v) => v.toLocaleString('de-DE') },
  { label: 'Dauer p50', better: 'niedriger', value: (e) => e.scenarios?.summary.latencyP50Ms ?? null, format: formatSeconds },
  { label: 'Dauer p95', better: 'niedriger', value: (e) => e.scenarios?.summary.latencyP95Ms ?? null, format: formatSeconds },
];

// Ticks der Zeitachse: Anfang, Mitte, Ende statt jedem Tag
export function timeTicks(min: number, max: number, count = 3): number[] {
  if (min === max) return [min];
  return Array.from({ length: count }, (_, i) => min + ((max - min) * i) / (count - 1));
}

// Index des Punkts, der einer Zeit am nächsten liegt (Fadenkreuz)
export function nearestIndex(times: number[], time: number): number {
  let best = 0;
  for (let i = 1; i < times.length; i++) {
    if (Math.abs(times[i] - time) < Math.abs(times[best] - time)) best = i;
  }
  return best;
}
