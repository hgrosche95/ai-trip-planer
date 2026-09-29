import type { ItinerariesService } from '../../itineraries.service';
import type {
  LlmChatResult,
  LlmMessage,
} from '../../llm/llm-provider.interface';
import { PROMPT_INJECTION_RULES } from '../../llm/prompt-rules';
import type { RunEventPayloads } from '../../runs/run-events';
import { ToolRegistry } from '../../tools';
import { createSaveItineraryTool } from '../../tools/save-itinerary.tool';
import { LISBON_BRIEF, TODAY, testContext } from '../testing.fixtures';
import { emptyFindings } from '../trip-draft';
import type { ResearchFindings } from '../trip-draft';
import { PlannerAgent, buildTaskPlan } from './planner.agent';
import { composePrompt, finalPrompt, triagePrompt } from './planner.prompts';
import { PlannerOutputError } from './planner.schema';

function reply(content: string): LlmChatResult {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 100, outputTokens: 50 },
    model: 'fake',
  };
}

// LLM, das der Reihe nach die übergebenen Antworten liefert
function scriptedLlm(...contents: string[]) {
  const chat = jest.fn<Promise<LlmChatResult>, [LlmMessage[], unknown[]]>();
  for (const content of contents) chat.mockResolvedValueOnce(reply(content));
  return { chat };
}

function planner() {
  const itineraries = { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) };
  const agent = new PlannerAgent(
    new ToolRegistry([
      createSaveItineraryTool(itineraries as unknown as ItinerariesService),
    ]),
  );
  return { agent, itineraries };
}

const READY = JSON.stringify({
  status: 'ready',
  destination: 'Lissabon',
  origin: 'Berlin',
  startDate: '2026-10-14',
  endDate: '2026-10-16',
  datesAssumed: true,
  travelers: 1,
  budget: { amount: 800, currency: 'EUR' },
  preferences: [],
});

const findings: ResearchFindings = {
  ...emptyFindings(),
  destination: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
};

const VALID_STOPS = JSON.stringify({
  stops: [
    {
      dayNumber: 1,
      order: 1,
      title: 'Ankunft',
      category: 'TRANSPORT',
      costCents: 0,
      lat: 38.77,
      lng: -9.13,
    },
    {
      dayNumber: 1,
      order: 2,
      title: 'Alfama',
      category: 'SIGHTSEEING',
      lat: 38.71,
      lng: -9.13,
    },
    // ohne Koordinaten: ergänzt der Code mit dem Ziel
    {
      dayNumber: 2,
      order: 1,
      title: 'Museu Nacional do Azulejo',
      category: 'CULTURE',
      costCents: 800,
    },
    {
      dayNumber: 3,
      order: 1,
      title: 'Abreise',
      category: 'TRANSPORT',
      lat: 38.77,
      lng: -9.13,
    },
  ],
});

describe('PlannerAgent', () => {
  describe('triage', () => {
    it('liest die Eckdaten mit genau einem LLM-Aufruf', async () => {
      const llm = scriptedLlm(`\`\`\`json\n${READY}\n\`\`\``);
      const { ctx, events } = testContext(() => llm);

      const result = await planner().agent.triage(
        {
          message: '3 Tage Lissabon im Oktober, 800 €, ab Berlin',
          history: [],
        },
        ctx,
      );

      expect(llm.chat).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ kind: 'ready', brief: LISBON_BRIEF });
      // Keine Tools für den Planer, der Prompt kennt das heutige Datum
      const [messages, tools] = llm.chat.mock.calls[0];
      expect(tools).toEqual([]);
      expect(messages[0].content).toContain(TODAY);
      const call = events.find((e) => e.type === 'llm.call')
        ?.data as RunEventPayloads['llm.call'];
      expect(call.agent).toBe('planner');
    });

    it('fragt nach, wenn das Modell eine Rückfrage liefert', async () => {
      const llm = scriptedLlm(
        '{"status":"ask","question":"Wohin und wann möchtest du reisen?"}',
      );
      const { ctx, events } = testContext(() => llm);

      const result = await planner().agent.triage(
        { message: 'Ich will verreisen', history: [] },
        ctx,
      );

      expect(result).toEqual({
        kind: 'ask',
        question: 'Wohin und wann möchtest du reisen?',
      });
      expect(llm.chat).toHaveBeenCalledTimes(1);
      const finished = events.find((e) => e.type === 'agent.finished')
        ?.data as RunEventPayloads['agent.finished'];
      expect(finished.summary).toBe('Rückfrage nötig');
    });

    it('fragt nach, wenn "ready" ohne Zeitraum kommt, statt zu raten', async () => {
      const llm = scriptedLlm('{"status":"ready","destination":"Lissabon"}');
      const { ctx } = testContext(() => llm);

      const result = await planner().agent.triage(
        { message: 'Lissabon', history: [] },
        ctx,
      );

      expect(result.kind).toBe('ask');
    });

    it('fragt nach, wenn die Antwort kein JSON ist', async () => {
      const llm = scriptedLlm('Wohin soll es gehen?');
      const { ctx } = testContext(() => llm);

      const result = await planner().agent.triage(
        { message: 'Hallo', history: [] },
        ctx,
      );

      expect(result.kind).toBe('ask');
      expect(llm.chat).toHaveBeenCalledTimes(1);
    });

    it('bekommt die letzten Dialog-Nachrichten ohne Tool-Runden mit', async () => {
      const llm = scriptedLlm(READY);
      const { ctx } = testContext(() => llm);
      const history: LlmMessage[] = [
        { role: 'user', content: 'Ich will verreisen' },
        {
          role: 'assistant',
          toolCalls: [{ id: 'x', name: 'get_weather', arguments: {} }],
        },
        { role: 'tool', toolResults: [{ toolCallId: 'x', content: '{}' }] },
        { role: 'assistant', content: 'Wohin und wann?' },
      ];

      await planner().agent.triage(
        { message: 'Lissabon, 3 Tage im Oktober', history },
        ctx,
      );

      const [messages] = llm.chat.mock.calls[0];
      expect(messages.map((m) => m.role)).toEqual([
        'system',
        'user',
        'assistant',
        'user',
      ]);
    });
  });

  it('plant die Aufgaben in Code, ohne LLM', async () => {
    const { ctx } = testContext();

    const plan = await planner().agent.plan(LISBON_BRIEF, ctx);

    expect(plan.tasks.map((task) => task.id)).toEqual([
      'research:weather',
      'research:lodging',
      'research:transport',
      'research:knowledge',
      'compose',
      'budget',
      'final',
    ]);
    expect(plan.tasks.find((t) => t.id === 'compose')?.dependsOn).toHaveLength(
      4,
    );
  });

  it('lässt Anreise ohne Abreiseort und Unterkunft bei Tagesausflug weg, rechnet fremde Währung um', () => {
    const plan = buildTaskPlan({
      ...LISBON_BRIEF,
      origin: undefined,
      endDate: LISBON_BRIEF.startDate,
      budget: { amount: 3500, currency: 'PLN' },
    });
    expect(
      plan.tasks.filter((t) => t.agent === 'research').map((t) => t.id),
    ).toEqual(['research:weather', 'research:knowledge', 'research:currency']);
  });

  describe('compose', () => {
    it('baut den Entwurf und ergänzt fehlende Koordinaten mit dem Ziel', async () => {
      const llm = scriptedLlm(VALID_STOPS);
      const { ctx } = testContext(() => llm);

      const draft = await planner().agent.compose(
        { brief: LISBON_BRIEF, findings },
        ctx,
      );

      expect(llm.chat).toHaveBeenCalledTimes(1);
      expect(draft).toMatchObject({
        destination: 'Lissabon',
        startDate: '2026-10-14',
        endDate: '2026-10-16',
        budgetCents: 80_000,
        currency: 'EUR',
      });
      expect(draft.stops).toHaveLength(4);
      expect(draft.stops[2]).toMatchObject({ lat: 38.72, lng: -9.14 });
      expect(
        draft.stops.every((s) => s.lat !== undefined && s.lng !== undefined),
      ).toBe(true);
    });

    it('repariert ungültiges JSON mit genau einem weiteren Aufruf', async () => {
      const llm = scriptedLlm(
        'Hier ist dein Plan: {stops: kaputt',
        VALID_STOPS,
      );
      const { ctx } = testContext(() => llm);

      const draft = await planner().agent.compose(
        { brief: LISBON_BRIEF, findings },
        ctx,
      );

      expect(llm.chat).toHaveBeenCalledTimes(2);
      expect(draft.stops).toHaveLength(4);
      // Der Reparaturversuch sieht die eigene Antwort und die Fehler
      const [messages] = llm.chat.mock.calls[1];
      expect(messages.map((m) => m.role)).toEqual([
        'system',
        'user',
        'assistant',
        'user',
      ]);
      expect(messages[3].content).toMatch(/ungültig.*Kein gültiges JSON/);
    });

    it('schickt Regelverstöße (fehlender Tag, falsche Kategorie) in den Reparaturversuch', async () => {
      const broken = JSON.stringify({
        stops: [
          {
            dayNumber: 1,
            order: 1,
            title: 'Alfama',
            category: 'PARTY',
            lat: 1,
            lng: 1,
          },
        ],
      });
      const llm = scriptedLlm(broken, VALID_STOPS);
      const { ctx } = testContext(() => llm);

      await planner().agent.compose({ brief: LISBON_BRIEF, findings }, ctx);

      const repair = llm.chat.mock.calls[1][0][3].content;
      expect(repair).toContain('category');
      expect(llm.chat).toHaveBeenCalledTimes(2);
    });

    it('bricht nach einem gescheiterten Reparaturversuch sauber ab', async () => {
      const llm = scriptedLlm('kein json', '{"stops": "immer noch nicht"}');
      const { ctx, events } = testContext(() => llm);

      await expect(
        planner().agent.compose({ brief: LISBON_BRIEF, findings }, ctx),
      ).rejects.toBeInstanceOf(PlannerOutputError);

      expect(llm.chat).toHaveBeenCalledTimes(2);
      const finished = events.find((e) => e.type === 'agent.finished')
        ?.data as RunEventPayloads['agent.finished'];
      expect(finished).toMatchObject({ task: 'compose', status: 'error' });
    });
  });

  it('finalize speichert den Plan mit Koordinaten und schreibt die Antwort', async () => {
    const llm = scriptedLlm('## Dein Plan für Lissabon');
    const { ctx, events } = testContext(() => llm);
    const { agent, itineraries } = planner();
    const draft = await planner().agent.compose(
      { brief: LISBON_BRIEF, findings },
      testContext(() => scriptedLlm(VALID_STOPS)).ctx,
    );

    const result = await agent.finalize(
      {
        brief: LISBON_BRIEF,
        draft,
        findings,
        budget: {
          currency: 'EUR',
          limitCents: 80_000,
          totalCents: 57_600,
          status: 'ok',
          items: [],
        },
      },
      ctx,
    );

    expect(itineraries.create).toHaveBeenCalledWith(
      'user-a',
      expect.objectContaining({ destination: 'Lissabon', budgetCents: 80_000 }),
    );
    expect(result.reply).toBe('## Dein Plan für Lissabon');
    expect(result.itineraryId).toBe('plan-1');
    expect(result.route?.[0]).toEqual({
      name: 'Ankunft',
      lat: 38.77,
      lng: -9.13,
    });
    const tool = events.find((e) => e.type === 'tool.started')
      ?.data as RunEventPayloads['tool.started'];
    expect(tool).toMatchObject({ tool: 'save_itinerary', agent: 'planner' });
    // Die Antwort bekommt Budget, Speicherstatus und datesAssumed mit
    const facts = llm.chat.mock.calls[0][0][1].content ?? '';
    expect(facts).toContain('"saved":true');
    expect(facts).toContain('"datesAssumed":true');
    expect(facts).toContain('"status":"ok"');
  });

  it('übernimmt die Regeln gegen Prompt-Injection in jeden Prompt', () => {
    for (const prompt of [
      triagePrompt(TODAY),
      composePrompt(3),
      finalPrompt(),
    ]) {
      expect(prompt).toContain(PROMPT_INJECTION_RULES);
    }
  });
});
