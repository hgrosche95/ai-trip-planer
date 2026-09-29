// Gemeinsame Test-Bausteine für die Specs des Orchestrators (nicht im
// Build, siehe tsconfig.build.json). Wer sie nutzt, muss '../rag-client'
// bzw. '../../rag-client' selbst per jest.mock ersetzen.
import type { FrankfurterClient } from '../external/frankfurter.client';
import type { OpenMeteoClient } from '../external/open-meteo.client';
import type { OverpassClient } from '../external/overpass.client';
import { searchTravelKnowledge } from '../rag-client';
import type { RunEventType } from '../runs/run-events';
import { ToolRegistry } from '../tools';
import { createCurrencyTool } from '../tools/currency.tool';
import { createLodgingTool } from '../tools/lodging.tool';
import { createTransportEstimateTool } from '../tools/transport-estimate.tool';
import { travelKnowledgeTool } from '../tools/travel-knowledge.tool';
import { createWeatherTool } from '../tools/weather.tool';
import type { AgentContext } from './agent.types';
import type { TripBrief } from './trip-draft';

export const TODAY = '2026-09-28';

export const PLACES: Record<
  string,
  { name: string; lat: number; lng: number }
> = {
  lissabon: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
  berlin: { name: 'Berlin', lat: 52.52, lng: 13.4 },
  porto: { name: 'Porto', lat: 41.15, lng: -8.61 },
};

// Die echten Tools mit nachgebauten API-Clients: kein Netz, aber dieselben
// Hooks (weather, lodging, flight) wie im Betrieb.
export function researchTools() {
  const openMeteo = {
    geocode: jest.fn((name: string) =>
      Promise.resolve({
        available: true,
        cached: false,
        data: PLACES[name.toLowerCase()] ?? null,
      }),
    ),
    dailyWeather: jest.fn(() =>
      Promise.resolve({
        available: true,
        cached: false,
        data: {
          source: 'climate',
          days: ['2026-10-14', '2026-10-15', '2026-10-16'].map((date, i) => ({
            date,
            tMin: 15,
            tMax: 22,
            precipMm: i === 1 ? 6 : 0,
            code: i === 1 ? 63 : 1,
            label: i === 1 ? 'Regen' : 'überwiegend klar',
          })),
        },
      }),
    ),
  };
  const overpass = {
    lodgings: jest.fn(() =>
      Promise.resolve({
        available: true,
        cached: true,
        data: [
          { name: 'Hotel Alfama', lat: 38.711, lng: -9.13, kind: 'hotel' },
          { name: 'Casa Baixa', lat: 38.712, lng: -9.138, kind: 'guest_house' },
        ],
      }),
    ),
  };
  const frankfurter = {
    rate: jest.fn(() =>
      Promise.resolve({
        available: true,
        cached: false,
        data: { rate: 0.23, date: '2026-09-25' },
      }),
    ),
  };
  (searchTravelKnowledge as jest.Mock).mockResolvedValue({
    available: true,
    results: [
      {
        content: 'Die Tram 28 fährt durch die Alfama.',
        title: 'Lissabon – Reiseziel-Überblick',
        source: 'Eigene Recherche',
        license: 'Eigene Inhalte',
        url: null,
        score: 0.9,
      },
    ],
  });
  const geocoder = openMeteo as unknown as OpenMeteoClient;
  const registry = new ToolRegistry([
    createWeatherTool(geocoder, () => TODAY),
    createLodgingTool(geocoder, overpass as unknown as OverpassClient),
    createTransportEstimateTool(geocoder),
    travelKnowledgeTool,
    createCurrencyTool(frankfurter as unknown as FrankfurterClient),
  ]);
  return { registry, openMeteo, overpass, frankfurter };
}

// AgentContext, der alle Ereignisse in ein Array schreibt
export function testContext(llm?: AgentContext['llm']) {
  const events: { type: RunEventType; data: unknown }[] = [];
  const ctx: AgentContext = {
    runId: 'run-1',
    userId: 'user-a',
    emit: (type, data) => events.push({ type, data }),
    llm:
      llm ??
      (() => {
        throw new Error('Dieser Agent darf kein LLM aufrufen');
      }),
    signal: new AbortController().signal,
    today: TODAY,
  };
  return { ctx, events };
}

// 3 Tage Lissabon im Oktober, 800 €, ab Berlin
export const LISBON_BRIEF: TripBrief = {
  destination: 'Lissabon',
  origin: 'Berlin',
  startDate: '2026-10-14',
  endDate: '2026-10-16',
  datesAssumed: true,
  travelers: 1,
  budget: { amount: 800, currency: 'EUR' },
  preferences: [],
  assumptions: ['1 Person', 'Unterkunft: Mittelklasse'],
};
