import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface EvalCaseRow {
  id: string;
  question: string;
  retrieval: string;
  tool: string;
  judge: string;
}

export interface EvalSummary {
  timestamp: string;
  model: string;
  topK: number;
  recall: number;
  mrr: number;
  toolAcc: number;
  judgeScore: number | null;
  thresholds: { recall: number; mrr: number; toolAcc: number };
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
  if (summary.judgeScore !== null) {
    lines.push(`| LLM-as-Judge | ${summary.judgeScore.toFixed(2)} / 5 | – | – |`);
  }
  lines.push('');
  lines.push('## Einzelfälle');
  lines.push('');
  lines.push('| ID | Frage | Retrieval | Tool | Judge |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const row of summary.perCase) {
    lines.push(
      `| ${row.id} | ${row.question} | ${row.retrieval} | ${row.tool} | ${row.judge} |`,
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
