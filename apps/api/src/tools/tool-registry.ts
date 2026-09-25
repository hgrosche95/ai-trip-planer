import { startActiveObservation } from '@langfuse/tracing';
import type { LlmToolDefinition } from '../llm/llm-provider.interface';

export interface ChatSource {
  title: string;
  source: string;
  license: string;
  url: string | null;
  score: number;
}

// Ort, zu dem das Frontend den Globus dreht.
export interface GlobeFocus {
  name: string;
  lat: number;
  lng: number;
}

export interface ToolContext {
  userId: string;
}

// Ein Tool bringt alles mit, was der Agent über es wissen muss: die
// Beschreibung fürs Modell, die Ausführung und wie es in Langfuse erscheint.
// Der AgentService kennt dadurch keine einzelnen Tools mehr, ein neues Tool
// ist nur ein neuer Eintrag in createAgentTools().
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  definition: LlmToolDefinition;
  // "retriever" für Suchen in der Wissensbasis: eigener Observation-Typ in
  // Langfuse, und der Chat meldet searchAttempted + Quellen ans Frontend.
  kind: 'tool' | 'retriever';
  execute(input: TInput, context: ToolContext): Promise<TOutput> | TOutput;
  // Nur für retriever: welche Treffer das Frontend als Quellen anzeigt.
  sources?(output: TOutput): ChatSource[];
  // Ort, den das Frontend auf dem Globus zeigen soll, falls das Tool einen liefert.
  focus?(output: TOutput): GlobeFocus | undefined;
  // Was im Trace landet. Ohne eigene Angabe nur, ob ein Fehler kam, nie die
  // Ausgabe selbst, weil die Nutzerdaten enthalten kann.
  trace?(output: TOutput): {
    output?: unknown;
    metadata?: Record<string, unknown>;
  };
}

export interface ToolRun {
  output: unknown;
  // true, wenn ein retriever-Tool lief, auch ohne Treffer
  retrieval: boolean;
  sources: ChatSource[];
  focus?: GlobeFocus;
}

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: AgentTool[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.definition.name)) {
        throw new Error(`Tool doppelt registriert: ${tool.definition.name}`);
      }
      this.tools.set(tool.definition.name, tool);
    }
  }

  definitions(): LlmToolDefinition[] {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  async execute(
    name: string,
    input: unknown,
    context: ToolContext,
  ): Promise<ToolRun> {
    const tool = this.tools.get(name);
    if (!tool) {
      // Das Modell kann sich Tool-Namen ausdenken. Als Tool-Fehler zurück,
      // damit es sich korrigieren kann, statt dass der Chat abbricht.
      const output = { error: `Unbekanntes Tool: ${name}` };
      startActiveObservation(
        name,
        (span) => span.update({ metadata: { hasError: true } }),
        { asType: 'tool' },
      );
      return { output, retrieval: false, sources: [] };
    }

    const run = async (span: {
      update(attributes: {
        output?: unknown;
        metadata?: Record<string, unknown>;
      }): unknown;
    }) => {
      const result = await tool.execute(input, context);
      span.update(
        tool.trace?.(result) ?? { metadata: { hasError: hasError(result) } },
      );
      return result;
    };
    // Langfuse will den Observation-Typ als festes Literal, daher zwei Aufrufe
    const output =
      tool.kind === 'retriever'
        ? await startActiveObservation(name, run, { asType: 'retriever' })
        : await startActiveObservation(name, run, { asType: 'tool' });
    return {
      output,
      retrieval: tool.kind === 'retriever',
      sources: tool.sources?.(output) ?? [],
      focus: tool.focus?.(output),
    };
  }
}

function hasError(output: unknown): boolean {
  return typeof output === 'object' && output !== null && 'error' in output;
}
