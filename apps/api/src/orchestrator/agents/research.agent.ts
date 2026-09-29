import { Logger } from '@nestjs/common';
import type { TravelKnowledgeSearchResult } from '../../rag-client';
import type { TaskStatus, TaskType } from '../../runs/run-events';
import { emitToolResults, observedToolRun } from '../../runs/step-events';
import { hasError } from '../../tools';
import type { GlobeFocus, ToolRegistry, ToolRun } from '../../tools';
import type {
  TransportMode,
  TransportOption,
} from '../../tools/transport-estimate.tool';
import { agentStep } from '../agent.types';
import { lodgingNightCapEur } from '../draft-revision';
import type { Agent, AgentContext, StepOutcome } from '../agent.types';
import { emptyFindings } from '../trip-draft';
import type { PlanTask, ResearchFindings, TripBrief } from '../trip-draft';

export interface ResearchInput {
  brief: TripBrief;
  // Die research:*-Aufgaben aus dem TaskPlan
  tasks: PlanTask[];
  // Meldet jeden Statuswechsel an den Orchestrator (plan.updated)
  onTaskStatus?: (taskId: string, status: TaskStatus) => void;
}

// Welches Tool eine Aufgabe erledigt und mit welchen Argumenten. Die
// Argumente entstehen in Code aus dem geprüften TripBrief, nicht aus
// Nutzerfreitext oder Modellausgabe.
const TASK_TOOLS: Partial<
  Record<TaskType, (brief: TripBrief) => { tool: string; args: object }>
> = {
  'research:weather': (brief) => ({
    tool: 'get_weather',
    args: {
      place: brief.destination,
      startDate: brief.startDate,
      endDate: brief.endDate,
    },
  }),
  'research:lodging': (brief) => ({
    tool: 'search_lodging',
    args: {
      place: brief.destination,
      checkIn: brief.startDate,
      checkOut: brief.endDate,
      guests: brief.travelers,
      // "günstig übernachten": passende Unterkünfte zuerst
      ...(lodgingNightCapEur(brief) !== undefined && {
        budgetPerNightEur: lodgingNightCapEur(brief),
      }),
    },
  }),
  'research:transport': (brief) => ({
    tool: 'estimate_transport',
    args: { origin: brief.origin, destination: brief.destination },
  }),
  'research:knowledge': (brief) => ({
    tool: 'search_travel_knowledge',
    args: {
      query: [
        brief.destination,
        'Sehenswürdigkeiten Essen Transport',
        ...brief.preferences,
      ].join(' '),
    },
  }),
  'research:holidays': (brief) => ({
    tool: 'get_public_holidays',
    args: {
      place: brief.destination,
      startDate: brief.startDate,
      endDate: brief.endDate,
    },
  }),
  'research:currency': (brief) => ({
    tool: 'convert_currency',
    args: {
      amount: brief.budget?.amount,
      from: brief.budget?.currency,
      to: 'EUR',
    },
  }),
};

// Wissens-Treffer gehen gekürzt an den Planer: drei Treffer à 500 Zeichen
// reichen für Programmpunkte mit Quellenangabe und halten den Prompt klein.
const MAX_KNOWLEDGE_HITS = 3;
const MAX_KNOWLEDGE_CHARS = 500;

// Der Recherche-Agent braucht in Phase 3a kein LLM: Jede Aufgabe aus dem
// Plan wird in Code auf genau ein Tool abgebildet, alle Aufgaben laufen
// gleichzeitig. Er nutzt dieselben Tools und dieselben Ereignisse wie der
// Classic-Agent (tool.started/finished, weather.updated, lodging.updated,
// place.added, route.added), deshalb funktionieren Globus, Chips und Replay
// ohne Änderung.
export class ResearchAgent implements Agent<ResearchInput, ResearchFindings> {
  readonly name = 'research' as const;
  private readonly logger = new Logger(ResearchAgent.name);

  constructor(private readonly tools: ToolRegistry) {}

  async run(
    { brief, tasks, onTaskStatus }: ResearchInput,
    ctx: AgentContext,
  ): Promise<ResearchFindings> {
    const findings = emptyFindings();
    await Promise.all(
      tasks.map(async (task) => {
        onTaskStatus?.(task.id, 'running');
        try {
          const status = await agentStep(ctx, this.name, task.type, (stepId) =>
            this.runTask(task.type, brief, findings, ctx, stepId),
          );
          onTaskStatus?.(task.id, status);
        } catch (error) {
          // Eine fehlgeschlagene Recherche hält den Plan nicht auf: Der
          // Planer plant dann ohne diese Angaben.
          this.logger.warn(`Recherche ${task.type} fehlgeschlagen: ${error}`);
          onTaskStatus?.(task.id, 'error');
        }
      }),
    );
    return findings;
  }

  private async runTask(
    type: TaskType,
    brief: TripBrief,
    findings: ResearchFindings,
    ctx: AgentContext,
    stepId: string,
  ): Promise<StepOutcome<TaskStatus>> {
    const mapping = TASK_TOOLS[type];
    if (!mapping) {
      return { value: 'skipped', status: 'skipped', summary: 'unbekannt' };
    }
    const { tool, args } = mapping(brief);
    const run = await observedToolRun(
      this.tools,
      tool,
      args,
      ctx.userId,
      ctx.emit,
      { agent: this.name, parentStepId: stepId },
    );
    emitToolResults(run, ctx.emit);
    this.noteDestination(run, findings, ctx);
    // Wie im Classic-Modus: Die Wissensbasis wurde befragt, auch wenn sie
    // nicht erreichbar war oder nichts fand (eigene Meldung im Frontend)
    if (run.retrieval) findings.searchAttempted = true;

    if (hasError(run.output)) {
      return { value: 'error', status: 'error', summary: 'nicht verfügbar' };
    }
    const summary = collect(type, run, findings);
    return { value: 'done', summary };
  }

  // Der Globus fliegt zum Ziel, sobald das erste Tool es geokodiert hat.
  // Wetter, Unterkünfte und Anreise kennen alle den Ort; wer zuerst fertig
  // ist, liefert ihn.
  private noteDestination(
    run: ToolRun,
    findings: ResearchFindings,
    ctx: AgentContext,
  ): void {
    const place: GlobeFocus | undefined =
      run.weather?.place ?? run.lodging?.place ?? run.flight?.to;
    if (findings.destination || !place) return;
    findings.destination = place;
    ctx.emit('place.added', { ...place, kind: 'destination' });
  }
}

// Übernimmt die Kennzahlen eines Tool-Ergebnisses in die Findings und
// liefert die Zusammenfassung für agent.finished (ohne Nutzerfreitext).
function collect(
  type: TaskType,
  run: ToolRun,
  findings: ResearchFindings,
): string {
  switch (type) {
    case 'research:weather': {
      if (!run.weather) return 'keine Daten';
      findings.weather = run.weather;
      const source =
        run.weather.source === 'forecast' ? 'Vorhersage' : 'Vorjahreswerte';
      return `${run.weather.days.length} Tage, ${source}`;
    }
    case 'research:lodging': {
      if (!run.lodging) return 'keine Daten';
      const output = run.output as { priceBasis?: string };
      findings.lodging = {
        priceBasis: output.priceBasis,
        searchLinks: run.lodging.searchLinks,
        items: run.lodging.items,
      };
      return `${run.lodging.items.length} Unterkünfte`;
    }
    case 'research:transport': {
      const output = run.output as {
        straightLineKm: number;
        recommended: TransportMode;
        options: TransportOption[];
      };
      findings.transport = {
        straightLineKm: output.straightLineKm,
        recommended: output.recommended,
        options: output.options,
      };
      if (run.flight) findings.origin = run.flight.from;
      const mode = output.recommended === 'train' ? 'Bahn' : 'Flug';
      return `${mode} empfohlen, ${output.straightLineKm} km`;
    }
    case 'research:knowledge': {
      const output = run.output as TravelKnowledgeSearchResult;
      findings.sources.push(...run.sources);
      findings.knowledge = output.results
        .slice(0, MAX_KNOWLEDGE_HITS)
        .map((hit) => ({
          title: hit.title,
          source: hit.source,
          content: hit.content.slice(0, MAX_KNOWLEDGE_CHARS),
        }));
      return output.available
        ? `${output.results.length} Treffer`
        : 'Wissensbasis nicht erreichbar';
    }
    case 'research:holidays': {
      const output = run.output as {
        holidays: { date: string; name: string }[];
      };
      findings.holidays = output.holidays;
      return output.holidays.length === 0
        ? 'keine Feiertage'
        : `${output.holidays.length} ${output.holidays.length === 1 ? 'Feiertag' : 'Feiertage'}`;
    }
    case 'research:currency': {
      const output = run.output as { converted: number };
      findings.budgetEurCents = Math.round(output.converted * 100);
      return 'Budget in Euro umgerechnet';
    }
    default:
      return 'erledigt';
  }
}
