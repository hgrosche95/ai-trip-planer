import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScenarioSummary, ScenarioThresholds } from './scenario-summary.js';
import type { ScenarioResult } from './scenario-types.js';

// Ergebnis eines Nachtlaufs. Das JSON ist die Grundlage für die Seite
// /evals und das Badge (Phase 5b); der Markdown-Report ist für Menschen.
export interface ScenarioReport {
  timestamp: string;
  gitSha: string | null;
  provider: string;
  model: string;
  judgeModel: string | null;
  summary: ScenarioSummary;
  thresholds: ScenarioThresholds;
  failed: string[];
  results: ScenarioResult[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pct = (v: number | null) => (v === null ? '–' : `${(v * 100).toFixed(0)} %`);
const num = (v: number | null, digits = 1) => (v === null ? '–' : v.toFixed(digits).replace('.', ','));
const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

export function renderScenarioReport(report: ScenarioReport): string {
  const { summary: s, thresholds: t } = report;
  const lines = [
    `# Szenario-Evals ${report.timestamp}`,
    '',
    `Modell: ${report.provider}/${report.model}${report.judgeModel ? ` · Judge: ${report.judgeModel}` : ' · ohne Judge'}${report.gitSha ? ` · Commit ${report.gitSha.slice(0, 7)}` : ''}`,
    '',
    `**${s.passed} von ${s.scenarios} Szenarien bestanden** · ${report.failed.length === 0 ? 'alle Schwellen erfüllt' : `Schwellen verfehlt: ${report.failed.join('; ')}`}`,
    '',
    '| Kennzahl | Wert | Schwelle |',
    '| --- | --- | --- |',
    `| Budget-Einhaltung | ${pct(s.budgetCompliance)} | ≥ ${pct(t.budgetCompliance)} |`,
    `| Harte Regelverstöße pro Plan (Ø / max) | ${num(s.hardErrorsAvg, 2)} / ${s.hardErrorsMax ?? '–'} | ≤ ${num(t.hardErrorsAvg, 2)} / ${t.hardErrorsMax} |`,
    `| Wetterbewusstsein (Regentage ohne Programm draußen) | ${pct(s.weatherAwareness)} | ≥ ${pct(t.weatherAwareness)} |`,
    `| Vollständigkeit (jeder Tag ≥ 2 Punkte) | ${pct(s.completeness)} | ≥ ${pct(t.completeness)} |`,
    `| Geo-Validität (≤ 30 km vom Ziel) | ${pct(s.geoValidity)} | ≥ ${pct(t.geoValidity)} |`,
    `| Rückfrage-Genauigkeit | ${pct(s.clarificationAccuracy)} | ≥ ${pct(t.clarificationAccuracy)} |`,
    `| Revisionswirksamkeit | ${pct(s.revisionEffectiveness)} | ≥ ${pct(t.revisionEffectiveness)} |`,
    `| Tokens pro Szenario (p50 / p95) | ${s.tokensP50} / ${s.tokensP95} | p95 ≤ ${t.tokensP95} |`,
    `| LLM-Aufrufe pro Szenario (p50 / p95) | ${s.llmCallsP50} / ${s.llmCallsP95} | – |`,
    `| Dauer (p50 / p95, p95 ohne Groq-Wartezeit) | ${sec(s.latencyP50Ms)} / ${sec(s.latencyP95Ms)} (${sec(s.latencyP95NoWaitMs)}) | – |`,
    `| Kosten (Listenpreis) | ${s.costUsd.toFixed(4)} $ | – |`,
    `| Plan-Judge (1–5) | ${num(s.judgeMean, 2)} | ≥ ${num(t.judgeMean, 1)} |`,
    `| Ehrlichkeit bei unmöglichem Budget | ${pct(s.honesty)} | ≥ ${pct(t.honesty)} |`,
    `| Injection-Resistenz | ${pct(s.injectionResistance)} | ≥ ${pct(t.injectionResistance)} |`,
    '',
    '## Szenarien',
    '',
    '| Szenario | Ergebnis | Tokens | Aufrufe | Dauer | Judge | Nicht bestanden |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.results.map((r) => {
      const failed = r.checks.filter((c) => !c.passed).map((c) => (c.detail ? `${c.name} (${c.detail})` : c.name));
      if (r.judge.honest === false) failed.push('Budget nicht ehrlich genannt');
      if (r.judge.injectionResisted === false) failed.push('MANIPULIERT');
      return `| ${r.id} | ${r.passed ? '✓' : '✗'} | ${r.metrics.tokens} | ${r.metrics.llmCalls} | ${sec(r.metrics.durationMs)} | ${r.judge.plan ? num(r.judge.plan.mean, 2) : '–'} | ${failed.join('; ') || '–'} |`;
    }),
    '',
  ];
  return lines.join('\n');
}

export function writeScenarioReport(report: ScenarioReport): { markdown: string; json: string } {
  const dir = path.join(__dirname, '..', 'reports');
  mkdirSync(dir, { recursive: true });
  const stamp = report.timestamp.replace(/[:.]/g, '-');
  const markdown = path.join(dir, `scenarios-${stamp}.md`);
  const json = path.join(dir, `scenarios-${stamp}.json`);
  writeFileSync(markdown, renderScenarioReport(report));
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`);
  return { markdown, json };
}
