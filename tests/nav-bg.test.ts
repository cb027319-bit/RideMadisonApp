/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EN, ES } from '../src/locales';
import {
  arrivalDock, canTryBackgroundUpdates, DOCK_BCYCLE_M, DOCK_NEAR_M, freshFixes, type DockStation,
} from '../src/lib/navigation';

// Points due north of a destination near the Capitol.
const dest = { latitude: 43.0747, longitude: -89.3841 };
const north = (m: number) => ({ lat: dest.latitude + m / 111195, lon: dest.longitude });
const station = (id: string, m: number, docks = 5, returning = true): DockStation => ({
  id, name: `Station ${id}`, ...north(m), docks, returning,
});

test('background updates are tried on iOS and Android builds only', () => {
  assert.equal(canTryBackgroundUpdates({ os: 'ios', expoGo: false, taskManagerAvailable: true }), true);
  assert.equal(canTryBackgroundUpdates({ os: 'android', expoGo: false, taskManagerAvailable: true }), true);
  assert.equal(canTryBackgroundUpdates({ os: 'ios', expoGo: true, taskManagerAvailable: true }), false);
  assert.equal(canTryBackgroundUpdates({ os: 'android', expoGo: false, taskManagerAvailable: false }), false);
  assert.equal(canTryBackgroundUpdates({ os: 'web', expoGo: false, taskManagerAvailable: true }), false);
});

test('fresh fixes: oldest first, nothing repeated or older than the last one delivered', () => {
  const fixes = [{ timestamp: 30 }, { timestamp: 10 }, { timestamp: 20 }, { timestamp: 20 }];
  assert.deepEqual(freshFixes(fixes, 0).map((f) => f.timestamp), [10, 20, 20, 30]);
  assert.deepEqual(freshFixes(fixes, 20).map((f) => f.timestamp), [30]);
  assert.deepEqual(freshFixes(fixes, 30), []);
  assert.deepEqual(freshFixes([], 0), []);
  // Doesn't reorder the caller's array.
  assert.equal(fixes[0].timestamp, 30);
});

test('arrival dock: nearest station with an open spot within 400 m', () => {
  const r = arrivalDock([station('far', 350), station('near', 150), station('farther', 900)], dest, false);
  assert.equal(r?.station.id, 'near');
  assert.ok(Math.abs((r?.distanceM ?? 0) - 150) < 2);
  assert.equal(r?.here, false);
});

test('arrival dock: none for regular riders beyond 400 m', () => {
  assert.equal(arrivalDock([station('a', DOCK_NEAR_M + 50)], dest, false), null);
  assert.equal(arrivalDock([], dest, false), null);
});

test('arrival dock: BCycle riders get one farther away, up to 1600 m', () => {
  assert.equal(arrivalDock([station('a', 900)], dest, true)?.station.id, 'a');
  assert.equal(arrivalDock([station('a', DOCK_BCYCLE_M + 100)], dest, true), null);
});

test('arrival dock: skips full stations and ones not taking returns', () => {
  const r = arrivalDock([station('full', 50, 0), station('closed', 80, 4, false), station('ok', 300, 2)], dest, false);
  assert.equal(r?.station.id, 'ok');
  assert.equal(arrivalDock([station('full', 50, 0)], dest, true), null);
});

test('arrival dock: destination at the dock itself is "here"', () => {
  const r = arrivalDock([station('a', 10)], dest, false);
  assert.equal(r?.here, true);
});

test('nav strings exist in English and Spanish', () => {
  for (const k of ['nav.serviceTitle', 'nav.serviceBody', 'nav.keepOpen', 'nav.dock', 'nav.dock_one', 'nav.dockGo'] as const) {
    assert.ok(EN[k]?.trim(), k);
    assert.ok(ES[k]?.trim(), k);
  }
});
