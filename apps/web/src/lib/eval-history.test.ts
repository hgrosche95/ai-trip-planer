import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPARISON_ROWS,
  METRICS,
  entryPassed,
  latestByProvider,
  nearestIndex,
  seriesFor,
  timeTicks,
  windowed,
  type HistoryEntry,
} from './eval-history.ts';

function entry(timestamp: string, provider: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: `${timestamp}:${provider}`,
    timestamp,
    provider,
    model: 'm',
    judgeModel: null,
    gitSha: null,
    runUrl: null,
    knowledge: { topK: 3, recall: 1, toolAcc: 0.9, thresholds: { recall: 0.8, toolAcc: 0.8 }, passed: true },
    scenarios: {
      summary: {
        scenarios: 12,
        passed: 9,
        budgetCompliance: 0.9,
        hardErrorsAvg: 0.1,
        tokensP50: 6000,
        latencyP50Ms: 30_000,
        latencyP95Ms: 60_000,
        costUsd: 0.024,
        judgeMean: 4.2,
      },
      thresholds: { budgetCompliance: 0.9, hardErrorsAvg: 0.1, judgeMean: 3.8 },
      failedThresholds: [],
      failures: [],
    },
    ...overrides,
  };
}

const metric = (id: string) => METRICS.find((m) => m.id === id)!;

test('windowed misst vom jüngsten Lauf aus, nicht von heute', () => {
  const entries = [
    entry('2026-01-01T03:00:00Z', 'groq'),
    entry('2026-03-01T03:00:00Z', 'groq'),
    entry('2026-03-05T03:00:00Z', 'groq'),
  ];
  assert.deepEqual(windowed(entries, 60).map((e) => e.timestamp), ['2026-03-01T03:00:00Z', '2026-03-05T03:00:00Z']);
  assert.deepEqual(windowed([]), []);
});

test('seriesFor: ein Punkt pro Anbieter und Tag, Anbieter in fester Reihenfolge', () => {
  const entries = [
    entry('2026-10-11T04:30:00Z', 'anthropic'),
    entry('2026-10-11T03:05:00Z', 'groq'),
    // von Hand nachgestartet, gleicher Tag: zählt
    entry('2026-10-11T18:00:00Z', 'groq', { knowledge: null }),
    entry('2026-10-12T03:05:00Z', 'groq'),
  ];
  const series = seriesFor(entries, metric('recall'));
  assert.deepEqual(series.map((s) => s.provider.id), ['groq', 'anthropic']);
  const groq = series[0].points;
  assert.equal(groq.length, 2);
  // Der spätere Lauf des Tages ersetzt den früheren, ohne Wert = Lücke
  assert.equal(groq[0].value, null);
  // Groq und Anthropic derselben Nacht stehen auf demselben Tag
  assert.equal(groq[0].time, series[1].points[0].time);
});

test('seriesFor lässt Anbieter ohne einen einzigen Wert weg', () => {
  const series = seriesFor([entry('2026-10-11T03:00:00Z', 'groq', { knowledge: null })], metric('recall'));
  assert.deepEqual(series, []);
});

test('Kennzahlen lesen die richtigen Felder', () => {
  const e = entry('2026-10-11T03:00:00Z', 'groq');
  assert.equal(metric('scenarios').value(e), 0.75);
  assert.equal(metric('judge').threshold(e), 3.8);
  assert.equal(metric('violations').bound, 'max');
  assert.equal(metric('scenarios').value(entry('x', 'groq', { scenarios: null })), null);
  const cost = COMPARISON_ROWS.find((r) => r.label === 'Kosten pro Szenario')!;
  assert.equal(cost.value(e), 0.002);
  assert.equal(cost.format(0.002), '0,0020 $');
});

test('latestByProvider und entryPassed', () => {
  const entries = [
    entry('2026-10-10T03:00:00Z', 'groq'),
    entry('2026-10-11T03:00:00Z', 'groq', { runUrl: 'neu' }),
    entry('2026-10-11T04:00:00Z', 'anthropic'),
  ];
  const latest = latestByProvider(entries);
  assert.equal(latest.get('groq')?.runUrl, 'neu');
  assert.ok(latest.get('anthropic'));
  assert.equal(entryPassed(entries[0]), true);
  const failed = entry('x', 'groq');
  failed.scenarios!.failedThresholds = ['Plan-Judge 3.1 < 3.8'];
  assert.equal(entryPassed(failed), false);
});

test('timeTicks und nearestIndex', () => {
  assert.deepEqual(timeTicks(0, 100), [0, 50, 100]);
  assert.deepEqual(timeTicks(5, 5), [5]);
  assert.equal(nearestIndex([0, 10, 20], 14), 1);
  assert.equal(nearestIndex([0, 10, 20], 99), 2);
});
