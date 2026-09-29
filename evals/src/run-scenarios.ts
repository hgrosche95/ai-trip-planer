import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JUDGE_ENABLED, judgeInjectionResistance } from './judge.js';
import { finalDraft, evaluateScenario, replyOf } from './plan-metrics.js';
import { judgeBudgetHonesty, judgePlan } from './plan-judge.js';
import { runMulti } from './run-client.js';
import { failedThresholds, scenarioThresholds, summarize } from './scenario-summary.js';
import { renderScenarioReport, writeScenarioReport } from './scenario-report.js';
import type { JudgeResult, RunCapture, Scenario, ScenarioResult } from './scenario-types.js';

// Szenario-Evals gegen den Multi-Agenten-Modus: Jedes Szenario aus
// scenarios.json läuft über POST /agent/runs (wie im Browser), die
// Kennzahlen werden aus den Ereignissen nachgerechnet (plan-metrics.ts),
// optional bewertet ein Judge Plan, Ehrlichkeit und Injection-Resistenz.
//
//   npm run eval:scenarios                     alle Szenarien
//   EVAL_SCENARIOS=rom-regen-oktober,... npm run eval:scenarios

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER = process.env.LLM_PROVIDER ?? 'groq';
const MODEL =
  PROVIDER === 'anthropic'
    ? (process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5')
    : (process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b');
// Pause zwischen Szenarien: Das Groq-Limit zählt pro Minute, ein Szenario
// nach dem anderen ohne Pause würde die Wartezeiten in die Messung ziehen
const PAUSE_MS = Number(process.env.EVAL_SCENARIO_PAUSE_MS ?? 5_000);

function loadScenarios(): Scenario[] {
  const all = JSON.parse(readFileSync(path.join(__dirname, '..', 'scenarios.json'), 'utf-8')) as Scenario[];
  const only = process.env.EVAL_SCENARIOS?.split(',').map((id) => id.trim()).filter(Boolean);
  return only?.length ? all.filter((scenario) => only.includes(scenario.id)) : all;
}

function daysOf(capture: RunCapture): Record<string, string[]> {
  const days: Record<string, string[]> = {};
  for (const stop of finalDraft(capture)?.itinerary.stops ?? []) {
    (days[stop.dayNumber] ??= []).push(stop.title);
  }
  return days;
}

// Judge-Fehler (z. B. Groq-Limit) kosten nur die Judge-Zahl, nicht den Lauf
async function judge(scenario: Scenario, captures: RunCapture[]): Promise<JudgeResult> {
  if (!JUDGE_ENABLED) return {};
  const final = captures.at(-1)!;
  const reply = replyOf(final);
  const request = scenario.messages.join(' / ');
  const result: JudgeResult = {};
  const draft = finalDraft(final);
  try {
    if (draft) {
      const plan = await judgePlan({ request, preferences: draft.itinerary.preferences, days: daysOf(final), reply });
      if (plan) result.plan = plan;
    }
    if (scenario.expect.budget === 'impossible') {
      const honest = await judgeBudgetHonesty(request, reply);
      if (honest !== null) result.honest = honest;
    }
    if (scenario.expect.injection) {
      const resisted = await judgeInjectionResistance(request, reply);
      if (resisted !== null) result.injectionResisted = resisted;
    }
  } catch (error) {
    console.warn(`  Judge für ${scenario.id} fehlgeschlagen:`, error);
  }
  return result;
}

async function runScenario(scenario: Scenario, runId: string): Promise<ScenarioResult> {
  // Eigene Session pro Szenario und Lauf: sonst knüpft der Planer an den
  // Entwurf eines früheren Laufs an
  const sessionId = `eval-${runId}-${scenario.id}`;
  const captures: RunCapture[] = [];
  try {
    for (const message of scenario.messages) {
      captures.push(await runMulti(sessionId, message));
    }
  } catch (error) {
    return {
      id: scenario.id,
      title: scenario.title,
      passed: false,
      checks: [{ name: 'Lauf ohne Fehler', passed: false, detail: String(error) }],
      metrics: { llmCalls: 0, tokens: 0, costUsd: 0, durationMs: 0, throttledMs: 0 },
      judge: {},
      replyExcerpt: '',
      error: 'network',
    };
  }
  const { checks, metrics, error } = evaluateScenario(scenario, captures);
  const judged = await judge(scenario, captures);
  const passed =
    checks.every((c) => c.passed) && judged.honest !== false && judged.injectionResisted !== false;
  return {
    id: scenario.id,
    title: scenario.title,
    passed,
    checks,
    metrics,
    judge: judged,
    replyExcerpt: replyOf(captures.at(-1)!).slice(0, 300),
    ...(error && { error }),
  };
}

async function main(): Promise<void> {
  const scenarios = loadScenarios();
  const runId = Date.now().toString(36);
  const results: ScenarioResult[] = [];
  for (const [index, scenario] of scenarios.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    console.log(`→ ${scenario.id}: ${scenario.title}`);
    const result = await runScenario(scenario, runId);
    const failed = result.checks.filter((c) => !c.passed).map((c) => c.name);
    console.log(`  ${result.passed ? '✓' : '✗'} ${result.metrics.tokens} Tokens, ${result.metrics.llmCalls} Aufrufe${failed.length ? ` · nicht bestanden: ${failed.join('; ')}` : ''}`);
    results.push(result);
  }

  const summary = summarize(results);
  const thresholds = scenarioThresholds();
  const failed = failedThresholds(summary, results, thresholds);
  const report = {
    timestamp: new Date().toISOString(),
    gitSha: process.env.GITHUB_SHA ?? null,
    provider: PROVIDER,
    model: MODEL,
    judgeModel: JUDGE_ENABLED ? `groq/${process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b'}` : null,
    summary,
    thresholds,
    failed,
    results,
  };
  const paths = writeScenarioReport(report);
  console.log('');
  console.log(renderScenarioReport(report));
  console.log(`Report geschrieben nach ${paths.markdown} und ${paths.json}`);
  if (failed.length > 0) {
    console.error('Szenario-Schwellen verfehlt.');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Szenario-Evals fehlgeschlagen:', error);
  process.exitCode = 1;
});
