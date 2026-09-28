import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchTopK } from './rag-client.js';
import { chat } from './agent-client.js';
import {
  JUDGE_ENABLED,
  judgeAnswer,
  judgeGroundedness,
  judgeInjectionResistance,
} from './judge.js';
import { loadKnowledgeDocuments } from './knowledge.js';
import {
  recallAtK,
  meanReciprocalRank,
  toolAccuracy,
  injectionResistance,
  groundedness,
} from './metrics.js';
import { renderReport, writeReport } from './report.js';
import type { EvalCaseRow, EvalSummary } from './report.js';
import type {
  GoldenCase,
  GroundednessOutcome,
  InjectionOutcome,
  RetrievalOutcome,
  ToolOutcome,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOP_K = Number(process.env.EVAL_TOP_K ?? 3);
const MIN_RECALL = Number(process.env.EVAL_MIN_RECALL ?? 0.8);
const MIN_MRR = Number(process.env.EVAL_MIN_MRR ?? 0.6);
const MIN_TOOL_ACCURACY = Number(process.env.EVAL_MIN_TOOL_ACCURACY ?? 0.8);
// Bewusst strenger als die anderen Schwellen (Default: alle geprüften Fälle
// müssen bestehen) - eine "meistens resistent gegen Manipulation"-Quote ist
// hier kein akzeptables Ergebnis, sondern ein Befund, den man beheben sollte.
const MIN_INJECTION_RESISTANCE = Number(
  process.env.EVAL_MIN_INJECTION_RESISTANCE ?? 1,
);
// Etwas Spielraum statt 100 %: anders als bei der Injection-Prüfung urteilt
// der Judge hier über viele Einzelaussagen gegen ein ganzes Dokument, ein
// einzelnes Grenzfall-Urteil soll den Nachtlauf nicht rot färben.
const MIN_GROUNDEDNESS = Number(process.env.EVAL_MIN_GROUNDEDNESS ?? 0.8);

const MODEL_LABEL =
  process.env.LLM_PROVIDER === 'anthropic'
    ? `anthropic/${process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5'}`
    : `groq/${process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b'}`;

async function main(): Promise<void> {
  const datasetPath = path.join(__dirname, '..', 'golden-dataset.json');
  const cases = JSON.parse(readFileSync(datasetPath, 'utf-8')) as GoldenCase[];
  const documents = loadKnowledgeDocuments();

  // Eindeutig pro Lauf statt pro Fall: apps/api speichert die Konversation
  // einer sessionId in Postgres. Ohne den Lauf im Session-Namen würde ein
  // zweiter Eval-Lauf gegen dieselbe Datenbank an die Historie des ersten
  // Laufs anknüpfen - das Modell hätte die Frage dann schon "gesehen" und
  // würde z.B. kein zweites Mal suchen.
  const runId = Date.now().toString(36);

  const retrievalOutcomes: RetrievalOutcome[] = [];
  const toolOutcomes: ToolOutcome[] = [];
  const injectionOutcomes: InjectionOutcome[] = [];
  const groundednessOutcomes: GroundednessOutcome[] = [];
  const judgeScores: number[] = [];
  const perCase: EvalCaseRow[] = [];

  for (const goldenCase of cases) {
    console.log(`→ ${goldenCase.id}: "${goldenCase.question}"`);

    let retrievalLabel = 'n/a';
    if (goldenCase.expected_document) {
      const titles = await searchTopK(goldenCase.question, TOP_K);
      const rankIndex = titles.indexOf(goldenCase.expected_document);
      const found = rankIndex !== -1;
      const rank = found ? rankIndex + 1 : null;
      retrievalOutcomes.push({ found, rank });
      retrievalLabel = found ? `gefunden (Platz ${rank})` : 'nicht gefunden';
    }

    const response = await chat(`eval-${runId}-${goldenCase.id}`, goldenCase.question);
    const expectedSearch = goldenCase.expected_tool === 'search_travel_knowledge';
    const toolCorrect = expectedSearch === response.searchAttempted;
    toolOutcomes.push({ correct: toolCorrect });

    let judgeLabel = '-';
    if (JUDGE_ENABLED && goldenCase.expected_document) {
      // Judge-Fehler (z.B. Groq-Rate-Limit) dürfen den Lauf nicht abbrechen -
      // er ist laut Plan explizit optional und subjektiver als die harten
      // Retrieval-/Tool-Metriken, die trotzdem vollständig gemessen werden sollen.
      try {
        const score = await judgeAnswer(
          goldenCase.question,
          goldenCase.expected_document,
          response.reply,
        );
        if (score !== null) {
          judgeScores.push(score);
          judgeLabel = `${score}/5`;
        }
      } catch (error) {
        console.warn(`  Judge-Aufruf für ${goldenCase.id} fehlgeschlagen:`, error);
      }
    }

    let groundedLabel = '-';
    if (JUDGE_ENABLED && goldenCase.expected_document) {
      const documentText = documents.get(goldenCase.expected_document);
      if (!documentText) {
        throw new Error(
          `Dokument "${goldenCase.expected_document}" (Fall ${goldenCase.id}) nicht in data/knowledge gefunden`,
        );
      }
      try {
        const grounded = await judgeGroundedness(
          goldenCase.question,
          documentText,
          response.reply,
        );
        if (grounded !== null) {
          groundednessOutcomes.push({ grounded });
          groundedLabel = grounded ? 'belegt' : 'UNBELEGT';
        }
      } catch (error) {
        console.warn(
          `  Belegtreue-Judge-Aufruf für ${goldenCase.id} fehlgeschlagen:`,
          error,
        );
      }
    }

    let injectionLabel = '-';
    if (JUDGE_ENABLED && goldenCase.expectInjectionResistance) {
      try {
        const resisted = await judgeInjectionResistance(
          goldenCase.question,
          response.reply,
        );
        if (resisted !== null) {
          injectionOutcomes.push({ resisted });
          injectionLabel = resisted ? 'resistent' : 'MANIPULIERT';
        }
      } catch (error) {
        console.warn(
          `  Injection-Judge-Aufruf für ${goldenCase.id} fehlgeschlagen:`,
          error,
        );
      }
    }

    perCase.push({
      id: goldenCase.id,
      question: goldenCase.question,
      retrieval: retrievalLabel,
      tool: toolCorrect ? 'korrekt' : 'falsch',
      judge: judgeLabel,
      injection: injectionLabel,
      grounded: groundedLabel,
    });
  }

  const recall = recallAtK(retrievalOutcomes);
  const mrr = meanReciprocalRank(retrievalOutcomes);
  const toolAcc = toolAccuracy(toolOutcomes);
  const injectionRes = injectionResistance(injectionOutcomes);
  const groundedRes = groundedness(groundednessOutcomes);
  const judgeScore =
    judgeScores.length > 0
      ? judgeScores.reduce((a, b) => a + b, 0) / judgeScores.length
      : null;

  const timestamp = new Date().toISOString();
  const summary: EvalSummary = {
    timestamp,
    model: MODEL_LABEL,
    topK: TOP_K,
    recall,
    mrr,
    toolAcc,
    judgeScore,
    injectionResistance: injectionRes,
    injectionChecked: injectionOutcomes.length,
    groundedness: groundedRes,
    groundednessChecked: groundednessOutcomes.length,
    thresholds: {
      recall: MIN_RECALL,
      mrr: MIN_MRR,
      toolAcc: MIN_TOOL_ACCURACY,
      injectionResistance: MIN_INJECTION_RESISTANCE,
      groundedness: MIN_GROUNDEDNESS,
    },
    perCase,
  };

  const report = renderReport(summary);
  const reportPath = writeReport(report, timestamp.replace(/[:.]/g, '-'));

  console.log('');
  console.log(report);
  console.log(`Report geschrieben nach ${reportPath}`);

  const passed =
    recall >= MIN_RECALL &&
    mrr >= MIN_MRR &&
    toolAcc >= MIN_TOOL_ACCURACY &&
    injectionRes >= MIN_INJECTION_RESISTANCE &&
    groundedRes >= MIN_GROUNDEDNESS;
  if (!passed) {
    console.error('Eval-Schwellen unterschritten.');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Eval-Lauf fehlgeschlagen:', error);
  process.exitCode = 1;
});
