import type {
  LlmChatResult,
  LlmMessage,
} from '../../llm/llm-provider.interface';
import { itineraryValidationErrors } from '../../itinerary.dto';
import { PROMPT_INJECTION_RULES } from '../../llm/prompt-rules';
import type { RunEventPayloads } from '../../runs/run-events';
import { LISBON_BRIEF, TODAY, testContext } from '../testing.fixtures';
import { emptyFindings, parseTripBrief } from '../trip-draft';
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
  return { agent: new PlannerAgent() };
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
  assumptions: ['1 Person', 'Unterkunft: Mittelklasse'],
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

  describe('finalize', () => {
    async function finalizeLisbon(limitCents: number | null = 80_000) {
      const llm = scriptedLlm('## Dein Plan für Lissabon\n\n## Annahmen');
      const { ctx, events } = testContext(() => llm);
      const draft = await planner().agent.compose(
        { brief: LISBON_BRIEF, findings },
        testContext(() => scriptedLlm(VALID_STOPS)).ctx,
      );
      const result = await planner().agent.finalize(
        {
          brief: LISBON_BRIEF,
          draft,
          findings,
          budget: {
            currency: 'EUR',
            limitCents,
            totalCents: 57_600,
            status: 'ok',
            items: [],
          },
        },
        ctx,
      );
      const drafted = events.find((e) => e.type === 'itinerary.draft')
        ?.data as RunEventPayloads['itinerary.draft'];
      return { llm, events, result, drafted };
    }

    it('speichert nicht, sondern schickt den geprüften Entwurf als itinerary.draft', async () => {
      const { llm, events, result, drafted } = await finalizeLisbon();

      expect(events.some((e) => e.type.startsWith('tool.'))).toBe(false);
      expect(llm.chat).toHaveBeenCalledTimes(1);
      expect(drafted.itinerary).toMatchObject({
        destination: 'Lissabon',
        startDate: '2026-10-14',
        endDate: '2026-10-16',
        budgetCents: 80_000,
        currency: 'EUR',
        preferences: [],
      });
      expect(drafted.itinerary.stops).toHaveLength(4);
      expect(drafted.itinerary.stops[2]).toMatchObject({
        title: 'Museu Nacional do Azulejo',
        category: 'CULTURE',
        costCents: 800,
        lat: 38.72,
        lng: -9.14,
      });
      expect(drafted.assumptions).toEqual(LISBON_BRIEF.assumptions);
      expect(itineraryValidationErrors(drafted.itinerary)).toEqual([]);
      expect(result.itinerary).toEqual(drafted.itinerary);
      expect(result.reply).toBe('## Dein Plan für Lissabon\n\n## Annahmen');
      expect(result.route?.[0]).toEqual({
        name: 'Ankunft',
        lat: 38.77,
        lng: -9.13,
      });
      const finished = events.find((e) => e.type === 'agent.finished')
        ?.data as RunEventPayloads['agent.finished'];
      expect(finished.summary).toBe(
        'Antwort geschrieben, Entwurf mit 4 Programmpunkten',
      );
    });

    it('nimmt ohne genanntes Budget die geschätzte Summe', async () => {
      const { drafted } = await finalizeLisbon(null);
      expect(drafted.itinerary.budgetCents).toBe(57_600);
    });

    it('gibt der Antwort Annahmen, Budget und datesAssumed mit, aber keinen Speicherstatus', async () => {
      const { llm } = await finalizeLisbon();
      const facts = llm.chat.mock.calls[0][0][1].content ?? '';
      expect(facts).toContain(
        '"assumptions":["1 Person","Unterkunft: Mittelklasse"]',
      );
      expect(facts).toContain('"datesAssumed":true');
      expect(facts).toContain('"status":"ok"');
      expect(facts).not.toContain('saved');
    });
  });

  it('final-Prompt: Entwurf, Abschnitt "Annahmen", Einladung zum Anpassen, Hinweis auf "Plan speichern"', () => {
    const prompt = finalPrompt();
    expect(prompt).toContain('## Annahmen');
    expect(prompt).toContain('mehr Kulinarik');
    expect(prompt).toContain('Tag 2 entspannter');
    expect(prompt).toContain('günstiger übernachten');
    expect(prompt).toContain('Plan speichern');
    expect(prompt).not.toMatch(/gespeichert wurde/);
  });

  it('triage: keine Vorab-Fragen nach Vorlieben, Annahmen im Brief', () => {
    const prompt = triagePrompt(TODAY);
    expect(prompt).toContain('Frag nie nach Vorlieben');
    expect(prompt).toContain('assumptions');
  });

  it('ergänzt Annahmen in Code, wenn das Modell keine nennt', () => {
    const raw = JSON.parse(READY) as Record<string, unknown>;
    const parsed = parseTripBrief(
      { ...raw, assumptions: undefined, budget: null },
      TODAY,
    );
    expect('brief' in parsed && parsed.brief.assumptions).toEqual([
      'Keine Vorlieben genannt: gemischtes Programm aus Sehenswürdigkeiten, Kultur und Essen',
      'Kein Budget genannt: mittleres Preisniveau',
    ]);
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
