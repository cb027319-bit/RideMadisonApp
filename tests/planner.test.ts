/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { COVERAGE_BBOX } from '../src/lib/config';
import {
  docksNear, EBIKE_MPS, endsNearStart, insertIndex, movedText, planKey, savedStartsAtMe, shouldStartFromMe, thinResult, trimEnd, trimEnds,
  trimStart, withBikeTime,
} from '../src/lib/planner';
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

// A 1 km out-and-back: 0 → 500 m east → back to 0, points every 50 m.
const outBack: RouteResult = {
  coords: [...Array.from({ length: 11 }, (_, i) => east(i * 50)), ...Array.from({ length: 10 }, (_, i) => east(450 - i * 50))],
  elevations: Array.from({ length: 21 }, () => 260),
  distanceM: 1000,
  climbM: 0,
  timeS: 200,
  cues: [{ index: 10, kind: 'uturn' }, { index: 19, kind: 'left' }],
  ways: [{ from: 0, name: 'Home St' }, { from: 8, name: 'Trail' }, { from: 18, name: 'Home St' }],
};

test('hides about the last 200 m of a ride', () => {
  const t = trimEnd(route, 200);
  assert.equal(t.coords.length, 7);
  assert.deepEqual(t.coords[t.coords.length - 1], route.coords[6]);
  assert.ok(Math.abs(t.distanceM - 300) < 2);
  assert.ok(Math.abs(t.timeS - 60) < 1);
  // Cues and names inside the hidden end are dropped; earlier ones keep their places.
  assert.deepEqual(t.cues, [{ index: 2, kind: 'left' }]);
  assert.deepEqual(t.ways, [{ from: 0, name: 'Home St' }]);
  const short = trimEnd({ ...route, coords: route.coords.slice(0, 3), elevations: route.elevations.slice(0, 3) }, 5000);
  assert.equal(short.coords.length, 2);
});

test('hide my start: loops and out-and-backs lose both ends, one-way rides only the start', () => {
  assert.equal(endsNearStart(outBack), true);
  assert.equal(endsNearStart(route), false);
  const home = outBack.coords[0];
  const t = trimEnds(outBack);
  // Neither end is within ~190 m of home.
  const far = (p: { latitude: number; longitude: number }) => Math.abs(p.longitude - home.longitude) * 111320 * Math.cos((43.07 * Math.PI) / 180);
  assert.ok(far(t.coords[0]) >= 190);
  assert.ok(far(t.coords[t.coords.length - 1]) >= 190);
  assert.ok(Math.abs(t.distanceM - 600) < 3);
  assert.deepEqual(t.ways?.map((w) => w.name), ['Home St', 'Trail']);
  assert.ok(t.cues?.every((c) => c.index > 0 && c.index < t.coords.length - 1));
  // A one-way ride keeps its end.
  const one = trimEnds(route);
  assert.deepEqual(one.coords[one.coords.length - 1], route.coords[10]);
  assert.deepEqual(one.coords[0], route.coords[4]);
});

test('plan keys leave out a hidden start (and a round trip back to it)', () => {
  const home = { latitude: 43.08123, longitude: -89.41234 };
  const a = { latitude: 43.07, longitude: -89.38 };
  const b = { latitude: 43.06, longitude: -89.39 };
  const oneWay = planKey([home, a], 'quiet', true);
  const loop = planKey([home, a, b, home], 'quiet', true);
  for (const k of [oneWay, loop]) {
    assert.ok(!k.includes('43.0812'), k);
    assert.ok(!k.includes('-89.4123'), k);
  }
  assert.equal(oneWay, 'quiet:me|43.0700,-89.3800');
  assert.equal(loop, 'quiet:me|43.0700,-89.3800|43.0600,-89.3900');
  // Same plan from a different spot at home: same key, so it isn't saved twice.
  assert.equal(planKey([{ latitude: 43.09, longitude: -89.4 }, a], 'quiet', true), oneWay);
  // Not the same as a plan that really starts at a.
  assert.notEqual(planKey([a], 'quiet'), oneWay);
  // Without hiding, the start is part of the key.
  assert.ok(planKey([home, a], 'quiet').includes('43.0812'));
});

test('saved rides with a hidden start reopen from my location', () => {
  assert.equal(savedStartsAtMe({ startHidden: true, stops: [1, 2] }), true);
  assert.equal(savedStartsAtMe({ startHidden: false, stops: [1] }), false);
  assert.equal(savedStartsAtMe({ stops: [1] }), true); // older ride: a lone point means the start was hidden
  assert.equal(savedStartsAtMe({ stops: [1, 2] }), false);
});

test('e-bike ride times use about 15 mph', () => {
  const r = { distanceM: 8046.72, timeS: 40 * 60 }; // 5 mi at the router's speed: 40 min
  assert.ok(Math.abs(EBIKE_MPS - 6.7056) < 0.001);
  assert.ok(Math.abs(withBikeTime(r, 'ebike').timeS - 20 * 60) < 1); // 5 mi at 15 mph = 20 min
  assert.equal(withBikeTime(r, 'bike'), r);
  assert.equal(withBikeTime(r, null), r);
  // Never slower than the router's own time, and safe to apply twice.
  const quick = { distanceM: 8046.72, timeS: 15 * 60 };
  assert.equal(withBikeTime(quick, 'ebike'), quick);
  const once = withBikeTime(r, 'ebike');
  assert.equal(withBikeTime(once, 'ebike'), once);
  assert.equal(withBikeTime({ distanceM: 0, timeS: 0 }, 'ebike').timeS, 0);
});

test('BCycle docks near the destination', () => {
  const dest = { latitude: 43.07, longitude: -89.4 };
  const st = (id: string, m: number, docks: number, returning = true) => ({ id, lat: east(m).latitude, lon: east(m).longitude, docks, returning });
  const stations = [st('far', 900, 5), st('mid', 500, 3), st('near', 300, 6), st('full', 100, 0), st('closed', 150, 4, false)];
  // A station within 400 m: show docks within 600 m with room, nearest first.
  assert.deepEqual(docksNear(stations, dest, false).map((s) => s.id), ['near', 'mid']);
  assert.ok(Math.abs(docksNear(stations, dest, false)[0].distanceM - 300) < 2);
  // Nothing within 400 m: only BCycle riders see them.
  const away = [st('mid', 500, 3), st('far', 900, 5)];
  assert.deepEqual(docksNear(away, dest, false), []);
  assert.deepEqual(docksNear(away, dest, true).map((s) => s.id), ['mid']);
  assert.deepEqual(docksNear(stations, null, true), []);
});
