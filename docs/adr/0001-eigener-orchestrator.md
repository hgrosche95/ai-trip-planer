# ADR 0001: Eigener Orchestrator statt Agenten-Framework

- **Status:** angenommen (Phase 3a, umgesetzt in `apps/api/src/orchestrator/`)
- **Kontext:** [Plan 2.2](../trip-planner-2.0-plan.md#22-orchestrierung-eigener-orchestrator-in-nestjs), [Phase 3](../phase-3/README.md)

## Kontext

Ab Phase 3 teilen sich mehrere Agenten (Planer, Recherche, Budget, ab Phase 4 Kritiker) einen Lauf.
Die Randbedingungen stehen schon fest:

- Eine eigene LLM-Abstraktion (`LlmProvider`) mit Groq, Anthropic und Fake, Retry bei 429 und dem
  `TokenBudgetLimiter` aus Phase 2e.
- Ein Ereignis-Protokoll (SSE, Replay) und Langfuse-Messpunkte genau an LLM- und Tool-Grenzen.
- **Groq Free Tier: 8.000 Tokens pro Minute.** Welche Schritte ein LLM brauchen, was parallel läuft
  und wie viele Aufrufe ein Lauf höchstens macht, ist die wichtigste Stellschraube.
- Der Ablauf ist fest: triage → plan → research → compose → budget → finalize, später eine
  begrenzte Revisionsschleife.

## Entscheidung

Der Orchestrator ist eine **eigene, explizite State Machine** in NestJS. Kein LangGraph.js, Mastra
oder Agents SDK.

- Jeder Zustand ist ein `case` in `Orchestrator.step()`, stößt genau einen Agenten-Schritt an und
  gibt den Folgezustand zurück. Der Ablauf ist damit in einer Datei lesbar.
- Agenten sind einfache Klassen mit `AgentContext` (`emit`, `llm(agent)`, `signal`). Recherche und
  Budget kommen ohne LLM aus, der Planer macht höchstens 4 Aufrufe.
- Die Tools, der Provider, der Limiter und die Ereignisse sind dieselben wie im Classic-Agenten
  (`runs/step-events.ts`), nichts wird dupliziert.

## Folgen

- **Plus:** volle Kontrolle über Anzahl, Größe und Parallelität der LLM-Aufrufe; keine doppelte
  Instrumentierung; jeder Zustandsübergang ist mit `FakeLlmProvider`/jest-Mocks testbar
  (`orchestrator.spec.ts`); keine neue Abhängigkeit.
- **Minus:** Checkpointing, Wiederaufnahme nach Absturz und beliebige Graphen müssten wir selbst
  bauen. Für einen festen Ablauf mit wenigen Zuständen brauchen wir sie nicht; Retry gibt es schon,
  Abbruch läuft über `AbortSignal`.
- **Neu bewerten, wenn** der Ablauf dynamisch wird (Agenten wählen ihre Nachfolger selbst) oder Läufe
  über Minuten mit menschlichen Zwischenschritten laufen sollen.
