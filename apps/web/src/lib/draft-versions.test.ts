import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_LABELS } from './agent-lanes.ts';
import { draftVersions } from './draft-versions.ts';
import { applyRunEvent, initialRunState, type RunState } from './run-state.ts';
import type { RunEvent } from './run-events.ts';

// Ein abgeschlossener Lauf mit Entwurf der Fassung `revision`
function draftRun(revision: number, change?: string): RunState {
  const events: RunEvent[] = [
    {
      type: 'run.started',
      seq: 1,
      elapsedMs: 0,
      data: { runId: `run-${revision}`, mode: 'multi' },
    },
    {
      type: 'itinerary.draft',
      seq: 2,
      elapsedMs: 10,
      data: {
        itinerary: {
          destination: 'Lissabon',
          startDate: '2026-10-14',
          endDate: '2026-10-16',
          budgetCents: 80_000,
          currency: 'EUR',
          preferences: [],
          stops: [],
        },
        assumptions: [],
        revision,
        ...(change && { change }),
      },
    },
    {
      type: 'run.finished',
      seq: 3,
      elapsedMs: 20,
      data: {
        totals: {
          llmCalls: 3,
          toolCalls: 0,
          inputTokens: 1,
          outputTokens: 1,
          costUsd: 0,
          durationMs: 20,
        },
      },
    },
  ];
  return events.reduce(applyRunEvent, initialRunState());
}

// Ein Lauf ohne Entwurf (Rückfrage, Classic)
function plainRun(): RunState {
  return applyRunEvent(initialRunState(), {
    type: 'run.finished',
    seq: 1,
    elapsedMs: 5,
    data: {
      totals: {
        llmCalls: 1,
        toolCalls: 0,
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        durationMs: 5,
      },
    },
  });
}

test('nur der neueste Entwurf bietet "Plan speichern", ältere sind überholt', () => {
  // Nutzer, Erstplan, Nutzer, Überarbeitung
  const versions = draftVersions([undefined, draftRun(1), undefined, draftRun(2, 'Tag 2 ruhiger')]);

  assert.deepEqual(versions, [undefined, 'superseded', undefined, 'latest']);
});

test('eine Antwort ohne Entwurf (Rückfrage) löst den Entwurf davor nicht ab', () => {
  assert.deepEqual(draftVersions([draftRun(1), plainRun()]), ['latest', undefined]);
});

test('ein abgebrochener Lauf zählt nicht, auch wenn er schon einen Entwurf hatte', () => {
  const aborted = applyRunEvent(draftRun(2), {
    type: 'run.error',
    seq: 4,
    elapsedMs: 30,
    data: { code: 'internal', message: 'kaputt' },
  });
  // run.error nach run.finished kommt nicht vor; hier nur als Fehlerzustand
  assert.equal(aborted.status, 'error');

  assert.deepEqual(draftVersions([draftRun(1), aborted]), ['latest', undefined]);
});

test('ohne Entwurf gibt es nichts zu speichern', () => {
  assert.deepEqual(draftVersions([]), []);
  assert.deepEqual(draftVersions([undefined, plainRun()]), [undefined, undefined]);
});

test('die Checkliste nennt die Überarbeitung "Entwurf anpassen"', () => {
  assert.equal(TASK_LABELS.revise, 'Entwurf anpassen');
});
