import type { AgentName, TaskStatus, TaskType } from './run-events';
import type { AgentStep, RunState } from './run-state';

// Reihenfolge und Namen der Lanes im Trace-Panel. Der Kritiker kommt in
// Phase 4 dazu.
export const LANE_ORDER: AgentName[] = ['planner', 'research', 'budget'];

export const AGENT_LABELS: Record<AgentName, string> = {
  orchestrator: 'Orchestrator',
  planner: 'Planer',
  research: 'Recherche',
  budget: 'Budget',
};

export const TASK_LABELS: Record<TaskType, string> = {
  triage: 'Anfrage verstehen',
  plan: 'Aufgaben planen',
  'research:weather': 'Wetter',
  'research:lodging': 'Unterkünfte',
  'research:transport': 'Anreise',
  'research:knowledge': 'Wissensbasis',
  'research:currency': 'Währung',
  compose: 'Tagesplan entwerfen',
  revise: 'Entwurf anpassen',
  budget: 'Budget rechnen',
  final: 'Antwort schreiben',
};

export interface LaneBar {
  step: AgentStep;
  // Lage und Länge des Balkens in Prozent der bisherigen Laufzeit
  leftPct: number;
  widthPct: number;
  // Summe der LLM-Tokens in diesem Schritt
  tokens: number;
}

export interface Lane {
  agent: AgentName;
  label: string;
  bars: LaneBar[];
}

// Ein Balken bleibt auch bei 0 ms sichtbar
const MIN_WIDTH_PCT = 0.8;

// Der Wasserfall als reine Funktion: Jeder Agent eine Lane, jeder Schritt
// ein Balken relativ zur Laufzeit. Laufende Schritte reichen bis "jetzt".
// Ohne nowMs ist das der Zeitpunkt des letzten Ereignisses (lastMs); die
// Live-Anzeige übergibt eine im Browser weiterlaufende Uhr, damit die Balken
// auch dann wachsen, wenn gerade kein Ereignis kommt (ein KI-Aufruf dauert
// Sekunden). Ist der Lauf vorbei, zählt nur lastMs.
// Gleichzeitige Recherche-Schritte liegen als eigene Zeilen übereinander
// und überlappen zeitlich.
export function agentLanes(
  run: RunState,
  nowMs: number = run.lastMs,
): { lanes: Lane[]; totalMs: number } {
  const now = run.status === 'running' ? Math.max(run.lastMs, nowMs) : run.lastMs;
  const end = (step: AgentStep) =>
    step.startedMs + (step.durationMs ?? Math.max(0, now - step.startedMs));
  const totalMs = Math.max(
    1,
    now,
    run.totals?.durationMs ?? 0,
    ...run.agentSteps.map(end),
  );
  const tokensOf = (stepId: string) =>
    run.steps
      .filter((step) => step.parentStepId === stepId)
      .reduce((sum, step) => sum + (step.inputTokens ?? 0) + (step.outputTokens ?? 0), 0);

  const lanes = LANE_ORDER.map((agent) => ({
    agent,
    label: AGENT_LABELS[agent],
    bars: run.agentSteps
      .filter((step) => step.agent === agent)
      .map((step) => {
        const leftPct = (step.startedMs / totalMs) * 100;
        const widthPct = Math.max(MIN_WIDTH_PCT, ((end(step) - step.startedMs) / totalMs) * 100);
        return {
          step,
          leftPct: Math.min(leftPct, 100 - MIN_WIDTH_PCT),
          widthPct: Math.min(widthPct, 100 - Math.min(leftPct, 100 - MIN_WIDTH_PCT)),
          tokens: tokensOf(step.id),
        };
      }),
  })).filter((lane) => lane.bars.length > 0);
  return { lanes, totalMs };
}

export const TASK_STATUS_ICONS: Record<TaskStatus, string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  skipped: '–',
  error: '✗',
};
