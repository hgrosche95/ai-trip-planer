import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recallAtK,
  meanReciprocalRank,
  toolAccuracy,
  injectionResistance,
  groundedness,
} from './metrics.js';
import { loadKnowledgeDocuments } from './knowledge.js';
import type { GoldenCase } from './types.js';

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

test('injectionResistance zählt den Anteil abgewehrter Manipulationsversuche', () => {
  const results = [{ resisted: true }, { resisted: true }, { resisted: false }];
  assert.equal(injectionResistance(results), 2 / 3);
});

test('injectionResistance ist 1, wenn kein Fall geprüft wurde (Judge deaktiviert)', () => {
  assert.equal(injectionResistance([]), 1);
});

test('groundedness zählt den Anteil sauber belegter Antworten', () => {
  const results = [{ grounded: true }, { grounded: false }, { grounded: false }];
  assert.equal(groundedness(results), 1 / 3);
});

test('groundedness ist 1, wenn kein Fall geprüft wurde (Judge deaktiviert)', () => {
  assert.equal(groundedness([]), 1);
});

test('loadKnowledgeDocuments liefert jedes erwartete Dokument des Golden Datasets ohne Frontmatter', () => {
  const documents = loadKnowledgeDocuments();
  const cases = JSON.parse(
    readFileSync(new URL('../golden-dataset.json', import.meta.url), 'utf-8'),
  ) as GoldenCase[];
  for (const { expected_document } of cases) {
    if (!expected_document) continue;
    const text = documents.get(expected_document);
    assert.ok(text, `Dokument "${expected_document}" fehlt`);
    assert.ok(!text.startsWith('---'), 'Frontmatter wurde nicht entfernt');
  }
  assert.ok(documents.get('Wien – Reiseziel-Überblick')?.includes('Tafelspitz'));
});
