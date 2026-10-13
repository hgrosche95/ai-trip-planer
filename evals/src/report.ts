import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunMeta } from './ci-meta.js';

export interface EvalCaseRow {
  id: string;
  question: string;
  retrieval: string;
  tool: string;
  judge: string;
  injection: string;
  grounded: string;
  // Volle Antwort des Agenten, nur bei unbelegten Antworten
  reply?: string;
}

export interface EvalSummary extends RunMeta {
  timestamp: string;
  provider: string;
  model: string;
  topK: number;
  recall: number;
  mrr: number;
  toolAcc: number;
  judgeScore: number | null;
  injectionResistance: number;
  injectionChecked: number;
  groundedness: number;
  groundednessChecked: number;
  thresholds: {
    recall: number;
    mrr: number;
    toolAcc: number;
    injectionResistance: number;
    groundedness: number;
  };
  perCase: EvalCaseRow[];
  // Fälle, bei denen der Agent mit einem Fehler antwortete (zählen als falsch)
  errors?: string[];
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)} %`;
}

function gate(value: number, threshold: number): string {
  return value >= threshold ? '✓ ok' : '✗ fail';
}

export function renderReport(summary: EvalSummary): string {
  const lines: string[] = [];
  lines.push('# Eval-Report');
  lines.push('');
  lines.push(`- **Datum:** ${summary.timestamp}`);
  lines.push(`- **Modell:** ${summary.model}`);
  lines.push(`- **Top-k (Retrieval):** ${summary.topK}`);
  lines.push('');
  lines.push('| Metrik | Wert | Schwelle | |');
  lines.push('| --- | --- | --- | --- |');
  lines.push(
    `| Recall@${summary.topK} | ${fmtPct(summary.recall)} | ≥ ${fmtPct(summary.thresholds.recall)} | ${gate(summary.recall, summary.thresholds.recall)} |`,
  );
  lines.push(
    `| MRR | ${summary.mrr.toFixed(2)} | ≥ ${summary.thresholds.mrr.toFixed(2)} | ${gate(summary.mrr, summary.thresholds.mrr)} |`,
  );
  lines.push(
    `| Tool-Genauigkeit | ${fmtPct(summary.toolAcc)} | ≥ ${fmtPct(summary.thresholds.toolAcc)} | ${gate(summary.toolAcc, summary.thresholds.toolAcc)} |`,
  );
  if (summary.injectionChecked > 0) {
    lines.push(
      `| Injection-Resistenz | ${fmtPct(summary.injectionResistance)} (${summary.injectionChecked} geprüft) | ≥ ${fmtPct(summary.thresholds.injectionResistance)} | ${gate(summary.injectionResistance, summary.thresholds.injectionResistance)} |`,
    );
  } else {
    lines.push('| Injection-Resistenz | nicht geprüft (LLM-as-Judge deaktiviert) | – | – |');
  }
  if (summary.groundednessChecked > 0) {
    lines.push(
      `| Belegtreue | ${fmtPct(summary.groundedness)} (${summary.groundednessChecked} geprüft) | ≥ ${fmtPct(summary.thresholds.groundedness)} | ${gate(summary.groundedness, summary.thresholds.groundedness)} |`,
    );
  } else {
    lines.push('| Belegtreue | nicht geprüft (LLM-as-Judge deaktiviert) | – | – |');
  }
  if (summary.judgeScore !== null) {
    lines.push(`| LLM-as-Judge | ${summary.judgeScore.toFixed(2)} / 5 | – | – |`);
  }
  if (summary.errors && summary.errors.length > 0) {
    lines.push('');
    lines.push(`**Fehlgeschlagen (Agent antwortete mit Fehler, zählt als falsch):** ${summary.errors.join(', ')}`);
  }
  lines.push('');
  lines.push('## Einzelfälle');
  lines.push('');
  lines.push('| ID | Frage | Retrieval | Tool | Judge | Belegt | Injection |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of summary.perCase) {
    lines.push(
      `| ${row.id} | ${row.question} | ${row.retrieval} | ${row.tool} | ${row.judge} | ${row.grounded} | ${row.injection} |`,
    );
  }
  const unbelegt = summary.perCase.filter((row) => row.reply !== undefined);
  if (unbelegt.length > 0) {
    lines.push('');
    lines.push('## Unbelegte Antworten');
    lines.push('');
    lines.push('Zum Nachprüfen: Mischt der Agent eigenes Wissen unter die Quelle, oder urteilt der Judge zu streng?');
    for (const row of unbelegt) {
      lines.push('');
      lines.push(`### ${row.id}: ${row.question}`);
      lines.push('');
      lines.push(...row.reply!.split('\n').map((line) => `> ${line}`));
    }
  }
  lines.push('');
  return lines.join('\n');
}

// Markdown für Menschen, JSON (knowledge-<Zeit>.json) für die Historie
// hinter /evals und das Badge (publish.ts)
export function writeReport(
  content: string,
  summary: EvalSummary,
  fileTimestamp: string,
): { markdown: string; json: string } {
  const dir = path.join(process.cwd(), 'reports');
  mkdirSync(dir, { recursive: true });
  const markdown = path.join(dir, `${fileTimestamp}.md`);
  const json = path.join(dir, `knowledge-${fileTimestamp}.json`);
  writeFileSync(markdown, content, 'utf-8');
  writeFileSync(json, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
  return { markdown, json };
}
