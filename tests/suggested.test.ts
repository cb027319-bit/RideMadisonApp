/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { RouteResult } from '../src/lib/routing';
import {
  closestMiles, filterRides, rideTypeOf, routePoints, SUGGESTED_RIDES, type MeasuredRide,
} from '../src/lib/suggested';

const result = (miles: number, b: Partial<NonNullable<RouteResult['breakdown']>>): RouteResult => ({
  coords: [{ latitude: 43.07, longitude: -89.38 }],
  elevations: [null],
  distanceM: miles * 1609.344,
  climbM: 0,
  timeS: 0,
  breakdown: { path: 0, lane: 0, quiet: 0, road: 0, unpaved: 0, ...b },
});

test('every suggested ride has a unique id and at least two points', () => {
  const ids = new Set(SUGGESTED_RIDES.map((r) => r.id));
  assert.equal(ids.size, SUGGESTED_RIDES.length);
  for (const r of SUGGESTED_RIDES) assert.ok(r.points.length >= 2, r.id);
});

test('loops close and out-and-backs retrace to the start', () => {
  const loop = SUGGESTED_RIDES.find((r) => r.shape === 'loop')!;
  const pts = routePoints(loop);
  assert.deepEqual(pts[0], pts[pts.length - 1]);
  assert.equal(pts.length, loop.points.length + 1);
  const oab = SUGGESTED_RIDES.find((r) => r.shape === 'out_and_back' && r.points.length === 2)!;
  const op = routePoints(oab);
  assert.equal(op.length, 3);
  assert.deepEqual(op[0], op[2]);
});

test('ride type comes from the measured surface mix', () => {
  assert.equal(rideTypeOf({ path: 0.8, lane: 0, quiet: 0.2, road: 0, unpaved: 0.05 }), 'trail');
  assert.equal(rideTypeOf({ path: 0.8, lane: 0, quiet: 0.2, road: 0, unpaved: 0.6 }), 'gravel');
  assert.equal(rideTypeOf({ path: 0.2, lane: 0.3, quiet: 0.3, road: 0.2, unpaved: 0 }), 'road');
  assert.equal(rideTypeOf(undefined), undefined);
});

test('filters by length, type and distance from the rider, nearest first', () => {
  const [a, b, c] = SUGGESTED_RIDES;
  const rides: MeasuredRide[] = [
    { ride: a, result: result(12, { path: 0.3, quiet: 0.7 }), fromMeMi: 8 },
    { ride: b, result: result(24, { path: 0.9, quiet: 0.1 }), fromMeMi: 2 },
    { ride: c, result: result(6, { path: 0.9, unpaved: 0.8 }), fromMeMi: 20 },
  ];
  assert.deepEqual(filterRides(rides, { length: 'any', type: 'any', fromMe: 'any' }).map((m) => m.ride.id), [b.id, a.id, c.id]);
  assert.deepEqual(filterRides(rides, { length: 'medium', type: 'any', fromMe: 'any' }).map((m) => m.ride.id), [b.id, a.id]);
  assert.deepEqual(filterRides(rides, { length: 'any', type: 'gravel', fromMe: 'any' }).map((m) => m.ride.id), [c.id]);
  assert.deepEqual(filterRides(rides, { length: 'any', type: 'any', fromMe: 'near' }).map((m) => m.ride.id), [b.id]);
  // Unmeasured rides are kept only when no length filter is set
  const unmeasured: MeasuredRide[] = [{ ride: a, fromMeMi: 1 }];
  assert.equal(filterRides(unmeasured, { length: 'short', type: 'any', fromMe: 'any' }).length, 0);
  assert.equal(filterRides(unmeasured, { length: 'any', type: a.expectedType, fromMe: 'any' }).length, 1);
});

test('closest distance uses route points when measured', () => {
  const ride = SUGGESTED_RIDES[0];
  const mi = closestMiles({ latitude: 43.0717, longitude: -89.3808 }, ride);
  assert.ok(mi < 0.01);
});

test('family friendly filter and quiet-street labels', async () => {
  const { isFamilyFriendly, rideTypeLabel } = await import('../src/lib/suggested');
  const arb = SUGGESTED_RIDES.find((r) => r.id === 'arboretum-wingra')!;
  const monona = SUGGESTED_RIDES.find((r) => r.id === 'monona-loop')!;
  // Unmeasured: the hand-checked kids' ride counts; a road ride doesn't.
  assert.equal(isFamilyFriendly({ ride: arb }), true);
  assert.equal(isFamilyFriendly({ ride: monona }), false);
  // Measured: road share decides.
  const calm = result(8, { path: 0.4, quiet: 0.55, road: 0.05 });
  const busy = result(8, { path: 0.4, quiet: 0.3, road: 0.3 });
  assert.equal(isFamilyFriendly({ ride: monona, result: calm }), true);
  assert.equal(isFamilyFriendly({ ride: arb, result: busy }), false);
  assert.deepEqual(filterRides([{ ride: arb, result: calm, fromMeMi: 1 }], { length: 'any', type: 'family', fromMe: 'any' }).length, 1);
  // The Arboretum loop (measured "road" on quiet park roads) isn't hidden by the Paved trail filter.
  assert.equal(filterRides([{ ride: arb, result: calm, fromMeMi: 1 }], { length: 'any', type: 'trail', fromMe: 'any' }).length, 1);
  assert.equal(rideTypeLabel('road', calm.breakdown), 'Mostly quiet streets');
  assert.equal(rideTypeLabel('road', busy.breakdown), 'Roads & bike lanes');
  assert.equal(rideTypeLabel('trail', calm.breakdown), 'Paved trail');
});
