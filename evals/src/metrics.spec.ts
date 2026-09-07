import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallAtK, meanReciprocalRank, toolAccuracy } from './metrics.js';

test('recallAtK zählt gefundene Treffer unabhängig von ihrer Position', () => {
  const outcomes = [
    { found: true, rank: 1 },
    { found: true, rank: 3 },
    { found: false, rank: null },
  ];
  assert.equal(recallAtK(outcomes), 2 / 3);
});

test('recallAtK ist 1 ohne anwendbare Fälle (leere Eingabe)', () => {
  assert.equal(recallAtK([]), 1);
});

test('meanReciprocalRank unterscheidet Rangqualität, die recallAtK gleich behandelt', () => {
  const frueherTreffer = [{ found: true, rank: 1 }];
  const spaeterTreffer = [{ found: true, rank: 3 }];

  assert.equal(recallAtK(frueherTreffer), recallAtK(spaeterTreffer));
  assert.ok(meanReciprocalRank(frueherTreffer) > meanReciprocalRank(spaeterTreffer));
});

test('meanReciprocalRank ist 0 bei einem kompletten Miss', () => {
  assert.equal(meanReciprocalRank([{ found: false, rank: null }]), 0);
});

test('toolAccuracy zählt auch "bewusst kein Tool aufgerufen" als korrekt', () => {
  const results = [{ correct: true }, { correct: true }, { correct: false }];
  assert.equal(toolAccuracy(results), 2 / 3);
});
