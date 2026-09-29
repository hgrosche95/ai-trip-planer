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
import {
  PlannerAgent,
  buildRevisionPlan,
  buildTaskPlan,
  draftDigest,
} from './planner.agent';
import {
  composePrompt,
  finalPrompt,
  finalRevisionPrompt,
  revisePrompt,
  triagePrompt,
  triageRevisePrompt,
} from './planner.prompts';
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

describe('PlannerAgent: Überarbeitung eines Entwurfs', () => {
  async function currentDraft() {
    const draft = await planner().agent.compose(
      { brief: LISBON_BRIEF, findings },
      testContext(() => scriptedLlm(VALID_STOPS)).ctx,
    );
    return { brief: LISBON_BRIEF, draft };
  }

  const REVISE_DAY_2 = JSON.stringify({
    status: 'ready',
    intent: 'revise',
    days: [2],
    changes: {},
    summary: 'Tag 2 ruhiger',
  });

  const DAY_2 = JSON.stringify({
    stops: [
      {
        dayNumber: 2,
        order: 1,
        title: 'Café und Miradouro',
        category: 'FOOD',
        costCents: 500,
      },
    ],
  });

  describe('triage mit bestehendem Entwurf', () => {
    it('nutzt den kurzen Prompt mit der Kurzfassung des Entwurfs und erkennt die Änderung', async () => {
      const llm = scriptedLlm(REVISE_DAY_2);
      const { ctx, events } = testContext(() => llm);
      const current = await currentDraft();

      const result = await planner().agent.triage(
        { message: 'Tag 2 entspannter', history: [], current },
        ctx,
      );

      expect(result).toEqual({
        kind: 'revise',
        brief: LISBON_BRIEF,
        revision: {
          days: [2],
          research: [],
          recompose: false,
          summary: 'Tag 2 ruhiger',
        },
      });
      const [messages] = llm.chat.mock.calls[0];
      expect(messages[0].content).toBe(
        triageRevisePrompt(TODAY, draftDigest(current)),
      );
      expect(messages[0].content).toContain(
        '"days":{"1":["Ankunft","Alfama"],"2":["Museu Nacional do Azulejo"],"3":["Abreise"]}',
      );
      const finished = events.find((e) => e.type === 'agent.finished')
        ?.data as RunEventPayloads['agent.finished'];
      // Zusammenfassung ohne Nutzerfreitext
      expect(finished.summary).toBe(
        'Überarbeitung: Tag 2, 0 Recherche-Aufgaben',
      );
    });

    it('ein anderes Ziel in changes wird eine neue Reise', async () => {
      const llm = scriptedLlm(
        '{"status":"ready","intent":"new","days":[],"changes":{"destination":"Porto"},"summary":"Porto statt Lissabon"}',
      );
      const { ctx } = testContext(() => llm);

      const result = await planner().agent.triage(
        {
          message: 'Lieber nach Porto',
          history: [],
          current: await currentDraft(),
        },
        ctx,
      );

      expect(result).toEqual({
        kind: 'ready',
        brief: { ...LISBON_BRIEF, destination: 'Porto' },
      });
    });

    it('"plan alles neu" (intent new mit changes, gleiches Ziel) plant mit dem Brief neu', async () => {
      const llm = scriptedLlm(
        '{"status":"ready","intent":"new","days":[],"changes":{},"summary":"alles neu"}',
      );
      const { ctx } = testContext(() => llm);

      const result = await planner().agent.triage(
        {
          message: 'Plan alles neu',
          history: [],
          current: await currentDraft(),
        },
        ctx,
      );

      expect(result).toEqual({ kind: 'ready', brief: LISBON_BRIEF });
    });

    it('vollständige Eckdaten ohne changes gelten als neue Reise', async () => {
      const llm = scriptedLlm(READY);
      const { ctx } = testContext(() => llm);

      const result = await planner().agent.triage(
        { message: 'x', history: [], current: await currentDraft() },
        ctx,
      );

      expect(result).toEqual({ kind: 'ready', brief: LISBON_BRIEF });
    });

    it('eine ungültige Änderung wird eine Rückfrage', async () => {
      const llm = scriptedLlm(
        '{"status":"ready","intent":"revise","days":[],"changes":{"startDate":"2025-01-01"}}',
      );
      const { ctx } = testContext(() => llm);

      const result = await planner().agent.triage(
        { message: 'x', history: [], current: await currentDraft() },
        ctx,
      );

      expect(result).toMatchObject({ kind: 'ask' });
    });

    it('eine Änderung ohne Entwurf wird eine Rückfrage', async () => {
      const llm = scriptedLlm(REVISE_DAY_2);
      const { ctx } = testContext(() => llm);

      const result = await planner().agent.triage(
        { message: 'Tag 2 entspannter', history: [] },
        ctx,
      );

      expect(result).toMatchObject({ kind: 'ask' });
      // Ohne Entwurf der normale Prompt
      expect(llm.chat.mock.calls[0][0][0].content).toBe(triagePrompt(TODAY));
    });

    it('kürzt frühere Antworten im Verlauf auf 300 Zeichen', async () => {
      const llm = scriptedLlm(REVISE_DAY_2);
      const { ctx } = testContext(() => llm);

      await planner().agent.triage(
        {
          message: 'Tag 2 entspannter',
          history: [
            { role: 'user', content: '3 Tage Lissabon' },
            { role: 'assistant', content: 'x'.repeat(3000) },
          ],
          current: await currentDraft(),
        },
        ctx,
      );

      const [messages] = llm.chat.mock.calls[0];
      expect(messages[2]).toEqual({
        role: 'assistant',
        content: 'x'.repeat(300),
      });
    });
  });

  describe('plan', () => {
    const revision = (
      change: Partial<Parameters<typeof buildRevisionPlan>[1]>,
    ) =>
      buildRevisionPlan(LISBON_BRIEF, {
        days: [],
        research: [],
        recompose: false,
        summary: '',
        ...change,
      }).tasks.map((task) => `${task.id}<${task.dependsOn.join(',')}>`);

    it('nur betroffene Tage: revise, budget, final ohne Recherche', () => {
      expect(revision({ days: [2] })).toEqual([
        'revise<>',
        'budget<revise>',
        'final<budget>',
      ]);
    });

    it('nur Eckdaten: Recherche, dann direkt budget', () => {
      expect(revision({ research: ['research:lodging'] })).toEqual([
        'research:lodging<>',
        'budget<research:lodging>',
        'final<budget>',
      ]);
    });

    it('andere Reisedauer: compose statt revise', () => {
      expect(
        revision({
          recompose: true,
          research: ['research:weather', 'research:lodging'],
        }),
      ).toEqual([
        'research:weather<>',
        'research:lodging<>',
        'compose<research:weather,research:lodging>',
        'budget<compose>',
        'final<budget>',
      ]);
    });
  });

  describe('revise', () => {
    async function reviseDay2(...contents: string[]) {
      const llm = scriptedLlm(...contents);
      const { ctx, events } = testContext(() => llm);
      const { draft } = await currentDraft();
      const run = planner().agent.revise(
        {
          brief: LISBON_BRIEF,
          draft,
          findings,
          revision: {
            days: [2],
            research: [],
            recompose: false,
            summary: 'Tag 2 ruhiger',
          },
          request: 'Mach Tag 2 entspannter',
        },
        ctx,
      );
      return { llm, events, draft, run };
    }

    it('ersetzt nur Tag 2, die anderen Stops bleiben dieselben Objekte', async () => {
      const { llm, events, draft, run } = await reviseDay2(DAY_2);

      const revised = await run;

      expect(llm.chat).toHaveBeenCalledTimes(1);
      expect(revised.stops.map((s) => s.title)).toEqual([
        'Ankunft',
        'Alfama',
        'Café und Miradouro',
        'Abreise',
      ]);
      for (const stop of draft.stops.filter((s) => s.dayNumber !== 2)) {
        expect(revised.stops).toContain(stop);
      }
      // fehlende Koordinaten mit dem Ziel ergänzt
      expect(revised.stops[2]).toMatchObject({ lat: 38.72, lng: -9.14 });
      const [messages] = llm.chat.mock.calls[0];
      expect(messages[0].content).toBe(revisePrompt([2], 3));
      const finished = events.find((e) => e.type === 'agent.finished')
        ?.data as RunEventPayloads['agent.finished'];
      expect(finished).toMatchObject({
        task: 'revise',
        status: 'ok',
        summary: 'Tag 2 neu, 1 Programmpunkte',
      });
    });

    it('Punkte an anderen Tagen gehen in genau einen Reparaturversuch', async () => {
      const wrongDay = JSON.stringify({
        stops: [{ dayNumber: 1, order: 1, title: 'X', category: 'FOOD' }],
      });
      const { llm, run } = await reviseDay2(wrongDay, DAY_2);

      const revised = await run;

      expect(llm.chat).toHaveBeenCalledTimes(2);
      const repair = llm.chat.mock.calls[1][0].at(-1)?.content ?? '';
      expect(repair).toContain('gehört nicht zu den Tagen 2');
      expect(revised.stops.filter((s) => s.dayNumber === 1)).toHaveLength(2);
    });

    it('ein leerer Tag ist ein Fehler, nach dem zweiten Versuch bricht revise ab', async () => {
      const empty = '{"stops":[]}';
      const { llm, events, run } = await reviseDay2(empty, empty);

      await expect(run).rejects.toBeInstanceOf(PlannerOutputError);
      expect(llm.chat).toHaveBeenCalledTimes(2);
      expect(llm.chat.mock.calls[1][0].at(-1)?.content).toContain(
        'Tag 2 hat keine Programmpunkte',
      );
      const finished = events.find((e) => e.type === 'agent.finished')
        ?.data as RunEventPayloads['agent.finished'];
      expect(finished).toMatchObject({ task: 'revise', status: 'error' });
    });
  });

  describe('finalize einer Überarbeitung', () => {
    it('kurzer Prompt, "Geändert:" vorn, Fassung und Änderung im Entwurf', async () => {
      const llm = scriptedLlm('### Tag 2\n- Café');
      const { ctx, events } = testContext(() => llm);
      const { draft } = await currentDraft();

      const result = await planner().agent.finalize(
        {
          brief: LISBON_BRIEF,
          draft,
          findings,
          budget: {
            currency: 'EUR',
            limitCents: 80_000,
            totalCents: 50_000,
            status: 'ok',
            items: [],
          },
          version: 3,
          revision: {
            days: [2],
            research: [],
            recompose: false,
            summary: 'Tag 2 ruhiger',
          },
        },
        ctx,
      );

      expect(result.reply).toBe(
        '**Geändert:** Tag 2 ruhiger\n\n### Tag 2\n- Café',
      );
      const [messages] = llm.chat.mock.calls[0];
      expect(messages[0].content).toBe(finalRevisionPrompt());
      const facts = JSON.parse(messages[1].content!) as {
        Reise: {
          changedDays: { dayNumber: number }[];
          unchangedDays: number[];
        };
        Recherche: { lodging: unknown };
      };
      expect(facts.Reise.changedDays.map((s) => s.dayNumber)).toEqual([2]);
      expect(facts.Reise.unchangedDays).toEqual([1, 3]);
      expect(facts.Recherche.lodging).toBeNull();
      const drafted = events.find((e) => e.type === 'itinerary.draft')
        ?.data as RunEventPayloads['itinerary.draft'];
      expect(drafted).toMatchObject({ revision: 3, change: 'Tag 2 ruhiger' });
    });

    it('der erste Plan ist Fassung 1 ohne Änderung', async () => {
      const llm = scriptedLlm('## Plan');
      const { ctx, events } = testContext(() => llm);
      const { draft } = await currentDraft();

      const result = await planner().agent.finalize(
        {
          brief: LISBON_BRIEF,
          draft,
          findings,
          budget: {
            currency: 'EUR',
            limitCents: null,
            totalCents: 50_000,
            status: 'ok',
            items: [],
          },
        },
        ctx,
      );

      expect(result.reply).toBe('## Plan');
      expect(llm.chat.mock.calls[0][0][0].content).toBe(finalPrompt());
      const drafted = events.find((e) => e.type === 'itinerary.draft')
        ?.data as RunEventPayloads['itinerary.draft'];
      expect(drafted.revision).toBe(1);
      expect(drafted).not.toHaveProperty('change');
    });
  });

  it('übernimmt die Regeln gegen Prompt-Injection auch in die Prompts der Überarbeitung', () => {
    for (const prompt of [
      triageRevisePrompt(TODAY, '{}'),
      revisePrompt([2], 3),
      finalRevisionPrompt(),
    ]) {
      expect(prompt).toContain(PROMPT_INJECTION_RULES);
    }
  });
});
