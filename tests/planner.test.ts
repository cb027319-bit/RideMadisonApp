/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COVERAGE_BBOX } from '../src/lib/config';
import { insertIndex, movedText, planKey, shouldStartFromMe, thinResult, trimStart } from '../src/lib/planner';
import type { RouteResult } from '../src/lib/routing';

// 11 points, 50 m apart, heading east.
const east = (m: number) => ({ latitude: 43.07, longitude: -89.4 + m / (111320 * Math.cos((43.07 * Math.PI) / 180)) });
const route: RouteResult = {
  coords: Array.from({ length: 11 }, (_, i) => east(i * 50)),
  elevations: Array.from({ length: 11 }, (_, i) => 260 + i),
  distanceM: 500,
  climbM: 10,
  timeS: 100,
  cues: [{ index: 2, kind: 'left' }, { index: 6, kind: 'right' }],
  ways: [{ from: 0, name: 'Home St' }, { from: 6, name: 'Trail' }],
};

test('new stops go before the destination', () => {
  assert.equal(insertIndex(0, false), 0);
  assert.equal(insertIndex(1, false), 0);
  assert.equal(insertIndex(3, false), 2);
  assert.equal(insertIndex(3, true), 3); // round trip: the end is the start
});

test('hides about the first 200 m of a ride', () => {
  const t = trimStart(route, 200);
  assert.equal(t.coords.length, 7);
  assert.deepEqual(t.coords[0], route.coords[4]);
  assert.equal(t.elevations[0], 264);
  assert.ok(Math.abs(t.distanceM - 300) < 2);
  // The cue inside the hidden part is gone; the later one is remapped.
  assert.deepEqual(t.cues, [{ index: 2, kind: 'right' }]);
  assert.deepEqual(t.ways, [{ from: 0, name: 'Home St' }, { from: 2, name: 'Trail' }]);
  // Short routes keep at least two points.
  const short = trimStart({ ...route, coords: route.coords.slice(0, 3), elevations: route.elevations.slice(0, 3) }, 5000);
  assert.equal(short.coords.length, 2);
});

test('thinning keeps cue and way indexes pointing at the same places', () => {
  const t = thinResult(route, (i) => i % 2 === 0);
  assert.equal(t.coords.length, 6);
  assert.deepEqual(t.cues, [{ index: 1, kind: 'left' }, { index: 3, kind: 'right' }]);
  assert.deepEqual(t.ways, [{ from: 0, name: 'Home St' }, { from: 3, name: 'Trail' }]);
});

test('suggested rides start from the rider only when far and inside Madison', () => {
  const start = { latitude: 43.0717, longitude: -89.3808 };
  assert.equal(shouldStartFromMe(null, start, COVERAGE_BBOX), false);
  assert.equal(shouldStartFromMe({ latitude: 43.0718, longitude: -89.3808 }, start, COVERAGE_BBOX), false);
  assert.equal(shouldStartFromMe({ latitude: 43.1, longitude: -89.4 }, start, COVERAGE_BBOX), true);
  assert.equal(shouldStartFromMe({ latitude: 41.88, longitude: -87.63 }, start, COVERAGE_BBOX), false); // Chicago
});

test('plan keys and announcements', () => {
  assert.equal(planKey([east(0), east(100)], 'quiet'), planKey([east(0.1), east(100)], 'quiet'));
  assert.notEqual(planKey([east(0), east(100)], 'quiet'), planKey([east(0), east(100)], 'fast'));
  assert.equal(movedText('Colectivo', 2, 3), 'Colectivo is now stop 2 of 3');
});
