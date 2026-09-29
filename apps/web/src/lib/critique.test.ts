import { test } from 'node:test';
import assert from 'node:assert/strict';
import { critiqueBadge, critiqueOverview, issueMarkers } from './critique.ts';
import { applyRunEvent, initialRunState } from './run-state.ts';
import type { RunEvent, RunEventPayloads, Violation } from './run-events.ts';

const RAIN: Violation = {
  ruleId: 'rain-outdoor',
  severity: 'error',
  dayNumber: 2,
  stopTitle: 'Torre de Belém',
  lat: 38.69,
  lng: -9.21,
  message: 'Torre de Belém liegt draußen, an Tag 2 regnet es (14 mm)',
};
const BUDGET: Violation = {
  ruleId: 'budget-over',
  severity: 'warning',
  message: 'Geschätzt 950 €, 150 € über dem Budget von 800 €',
};

let seq = 0;
function critique(data: RunEventPayloads['critique']): RunEvent {
  return { type: 'critique', seq: ++seq, elapsedMs: seq * 100, data };
}

function stateOf(...events: RunEvent[]) {
  return events.reduce(applyRunEvent, initialRunState());
}

test('Reducer: jede Prüfrunde wird angehängt, changes fehlt in Runde 0', () => {
  const state = stateOf(
    critique({ round: 0, violations: [RAIN, BUDGET], final: false }),
    critique({
      round: 1,
      violations: [BUDGET],
      changes: [{ dayNumber: 2, removed: ['Torre de Belém'], added: ['MAAT'] }],
      final: true,
    }),
  );
  assert.equal(state.critiques.length, 2);
  assert.deepEqual(state.critiques[0].changes, []);
  assert.equal(state.critiques[1].changes[0].added[0], 'MAAT');
});

test('Globus: behobener Fehler wird grün, offener bleibt rot, Hinweise ohne Ring', () => {
  const fixed = stateOf(
    critique({ round: 0, violations: [RAIN, BUDGET], final: false }),
    critique({ round: 1, violations: [BUDGET], final: true }),
  );
  assert.deepEqual(issueMarkers(fixed.critiques), [
    { name: 'Torre de Belém', lat: 38.69, lng: -9.21, resolved: true },
  ]);

  const stubborn = stateOf(
    critique({ round: 0, violations: [RAIN], final: false }),
    critique({ round: 1, violations: [RAIN], final: false }),
    critique({ round: 2, violations: [RAIN], final: true }),
  );
  assert.deepEqual(
    issueMarkers(stubborn.critiques).map((m) => m.resolved),
    [false],
  );
  assert.deepEqual(issueMarkers([]), []);
});

test('Badge: Weg der Fehlerzahl über die Nachbesserungen', () => {
  const fixed = critiqueOverview(
    stateOf(
      critique({ round: 0, violations: [RAIN, BUDGET], final: false }),
      critique({ round: 1, violations: [BUDGET], final: true }),
    ).critiques,
  )!;
  assert.equal(critiqueBadge(fixed), '1 Fehler → Nachbesserung → 0 Fehler');
  assert.deepEqual(fixed.resolved, [RAIN]);
  assert.deepEqual(fixed.open, [BUDGET]);

  const clean = critiqueOverview(stateOf(critique({ round: 0, violations: [], final: true })).critiques)!;
  assert.equal(critiqueBadge(clean), 'keine Befunde');

  const warnings = critiqueOverview(
    stateOf(critique({ round: 0, violations: [BUDGET], final: true })).critiques,
  )!;
  assert.equal(critiqueBadge(warnings), '0 Fehler, 1 Hinweis');

  const stubborn = critiqueOverview(
    stateOf(
      critique({ round: 0, violations: [RAIN], final: false }),
      critique({ round: 1, violations: [RAIN], final: false }),
      critique({ round: 2, violations: [RAIN], final: true }),
    ).critiques,
  )!;
  assert.equal(critiqueBadge(stubborn), '1 Fehler → 2 Nachbesserungen → 1 Fehler');
  assert.deepEqual(stubborn.resolved, []);
  assert.equal(critiqueOverview([]), null);
});
