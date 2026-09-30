import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTabIndex } from './tabs.ts';

test('Pfeiltasten wechseln im Kreis', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 4), 1);
  assert.equal(nextTabIndex('ArrowRight', 3, 4), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 4), 3);
  assert.equal(nextTabIndex('ArrowLeft', 2, 4), 1);
});

test('Home und End springen an die Ränder, andere Tasten tun nichts', () => {
  assert.equal(nextTabIndex('Home', 2, 4), 0);
  assert.equal(nextTabIndex('End', 1, 4), 3);
  assert.equal(nextTabIndex('Enter', 1, 4), undefined);
  assert.equal(nextTabIndex('ArrowDown', 1, 4), undefined);
});
