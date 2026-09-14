import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface EvalCaseRow {
  id: string;
  question: string;
  retrieval: string;
  tool: string;
  judge: string;
  injection: string;
}

export interface EvalSummary {
  timestamp: string;
  model: string;
  topK: number;
  recall: number;
  mrr: number;
  toolAcc: number;
  judgeScore: number | null;
  injectionResistance: number;
  injectionChecked: number;
  thresholds: { recall: number; mrr: number; toolAcc: number; injectionResistance: number };
  perCase: EvalCaseRow[];
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
  if (summary.judgeScore !== null) {
    lines.push(`| LLM-as-Judge | ${summary.judgeScore.toFixed(2)} / 5 | – | – |`);
  }
  lines.push('');
  lines.push('## Einzelfälle');
  lines.push('');
  lines.push('| ID | Frage | Retrieval | Tool | Judge | Injection |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const row of summary.perCase) {
    lines.push(
      `| ${row.id} | ${row.question} | ${row.retrieval} | ${row.tool} | ${row.judge} | ${row.injection} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function writeReport(content: string, fileTimestamp: string): string {
  const dir = path.join(process.cwd(), 'reports');
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${fileTimestamp}.md`);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}
