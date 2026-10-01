import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftVersions } from './draft-versions.ts';
import { editSession, editedItinerary, type SeededDraft } from './edit-trip.ts';
import { initialRunState, type RunState } from './run-state.ts';

const seed: SeededDraft = {
  itineraryId: 'trip-1',
  revision: 1,
  itinerary: {
    destination: 'Lissabon',
    startDate: '2026-10-14',
    endDate: '2026-10-16',
    budgetCents: 80_000,
    currency: 'EUR',
    preferences: [],
    travelers: 2,
    stops: [{ dayNumber: 1, order: 1, title: 'Alfama' }],
  },
  assumptions: ['Unterkunft: Mittelklasse'],
  budget: { currency: 'EUR', limitCents: 80_000, totalCents: 70_000, status: 'ok', items: [] },
};

test('editSession: eine Antwort mit dem Entwurf, als gespeichert markiert', () => {
  const session = editSession('s-edit', seed);
  assert.equal(session.sessionId, 's-edit');
  assert.equal(session.messages.length, 1);
  const [message] = session.messages;
  assert.equal(message.role, 'assistant');
  assert.match(message.content, /Lissabon/);
  assert.deepEqual(message.trace.draft, {
    itinerary: seed.itinerary,
    assumptions: seed.assumptions,
    revision: 1,
    itineraryId: 'trip-1',
  });
  assert.equal(message.trace.budget?.totalCents, 70_000);
  assert.deepEqual(session.saved, { 0: 'trip-1' });
  // Die Arbeitsfläche zeigt ihn wie einen frisch geplanten Entwurf
  assert.deepEqual(draftVersions([message.trace]), ['latest']);
});

test('editedItinerary: die Reise des neuesten Entwurfs, nicht mehr nach einer neuen Reise', () => {
  const edited = editSession('s', seed).messages[0].trace;
  const revised: RunState = {
    ...initialRunState(),
    status: 'done',
    draft: { ...edited.draft!, revision: 2 },
  };
  const otherTrip: RunState = {
    ...initialRunState(),
    status: 'done',
    draft: { ...edited.draft!, itineraryId: undefined, revision: 1 },
  };
  const failed: RunState = { ...initialRunState(), status: 'error' };

  assert.equal(editedItinerary([edited]), 'trip-1');
  assert.equal(editedItinerary([edited, undefined, revised, failed]), 'trip-1');
  assert.equal(editedItinerary([edited, otherTrip]), undefined);
  assert.equal(editedItinerary([]), undefined);
});
