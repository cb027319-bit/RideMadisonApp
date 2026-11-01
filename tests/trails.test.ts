/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bboxOf, type LonLat } from '../src/lib/geo';
import type { BikePath } from '../src/lib/osm';
import {
  closestPointOnTrail, distanceToPathsM, ebikeRule, groupTrails, nearestPath, paidSectionLines, rulesFor, trailsByDistance, verdictFor,
} from '../src/lib/trails';

function path(id: string, kind: BikePath['kind'], coords: LonLat[], name?: string, surface?: string): BikePath {
  return { id, kind, coords, name, surface, bbox: bboxOf(coords) };
}

const cc1 = path('a', 'path_paved', [[-89.40, 43.03], [-89.39, 43.03]], 'Capital City State Trail', 'asphalt');
const cc2 = path('b', 'path_paved', [[-89.39, 43.03], [-89.38, 43.03]], 'Capital City State Trail', 'asphalt');
const mr = path('c', 'path_unpaved', [[-89.50, 43.00], [-89.49, 43.00]], 'Military Ridge State Trail', 'fine_gravel');
const lane = path('d', 'lane', [[-89.395, 43.0302], [-89.385, 43.0302]], 'Fish Hatchery Road');
const unnamed = path('e', 'path_paved', [[-89.3, 43.1], [-89.29, 43.1]]);

test('groups segments by trail name and measures them', () => {
  const { trails, trailOfPath } = groupTrails([cc1, cc2, mr, lane, unnamed]);
  assert.equal(trails.length, 4);
  const cc = trails.find((t) => t.name === 'Capital City State Trail')!;
  assert.deepEqual(cc.pathIds, ['a', 'b']);
  assert.ok(cc.lengthM > 1550 && cc.lengthM < 1650, `got ${cc.lengthM}`); // 0.02° lon at 43°N ≈ 1.63 km
  assert.equal(cc.surface, 'asphalt');
  assert.equal(cc.rules?.badge, 'Pass on part');
  assert.equal(trailOfPath.get('b'), cc.id);
  const ridge = trails.find((t) => t.name?.startsWith('Military'))!;
  assert.equal(ridge.unpavedShare, 1);
  assert.equal(ridge.rules?.badge, 'State trail pass');
  // Streets with lanes never get trail-pass rules
  assert.equal(trails.find((t) => t.kind === 'lane')!.rules, undefined);
});

test('rules lookup only matches known managed trails', () => {
  assert.ok(rulesFor('Badger State Trail'));
  assert.ok(rulesFor('Glacial Drumlin State Trail'));
  assert.equal(rulesFor('Southwest Commuter Path'), undefined);
  assert.equal(rulesFor(undefined), undefined);
});

test('tap picks the nearest path and prefers trails over close lanes', () => {
  const tol = 0.0005; // ~55 m
  // Tap between the trail (43.0300) and the lane (43.0302), slightly nearer the lane
  const hit = nearestPath([cc1, cc2, lane], { latitude: 43.03012, longitude: -89.392 }, tol);
  assert.equal(hit?.id, 'a');
  // Far from everything: no hit
  assert.equal(nearestPath([cc1, cc2, lane], { latitude: 43.05, longitude: -89.39 }, tol), null);
  // Lanes can be excluded
  assert.equal(nearestPath([lane], { latitude: 43.0302, longitude: -89.39 }, tol, false), null);
});

test('closest point on a trail', () => {
  const p = closestPointOnTrail([cc1, cc2], { latitude: 43.0, longitude: -89.381 });
  assert.deepEqual(p, { latitude: 43.03, longitude: -89.38 });
});

test('pass verdicts and class-specific e-bike rules', () => {
  const cc = rulesFor('Capital City State Trail');
  assert.equal(verdictFor(cc), 'part');
  assert.equal(verdictFor(rulesFor('Military Ridge State Trail')), 'pass');
  assert.equal(verdictFor(undefined), 'free');
  assert.match(cc!.pass, /^Free in Madison/);
  assert.equal(ebikeRule(cc, '2'), "Class 2 e-bikes can't use the motor on state trails; pedal only.");
  assert.match(ebikeRule(cc, '1'), /Class 1/);
  assert.equal(ebikeRule(cc, null), cc!.ebikes);
  assert.equal(ebikeRule(cc, 'unsure'), cc!.ebikes);
  assert.match(ebikeRule(undefined, '2'), /posted signs/);
});

test('paid section of the Capital City Trail is cut out for highlighting', () => {
  // Free part east of Nob Hill Rd, paid part west of it
  const p = path('x', 'path_paved', [[-89.35, 43.03], [-89.36, 43.03], [-89.37, 43.03], [-89.40, 43.02], [-89.45, 43.0]], 'Capital City State Trail');
  const lines = paidSectionLines([p], rulesFor('Capital City State Trail'));
  assert.deepEqual(lines, [[[-89.37, 43.03], [-89.40, 43.02], [-89.45, 43.0]]]);
  assert.deepEqual(paidSectionLines([p], rulesFor('Military Ridge State Trail')), []);
  assert.deepEqual(paidSectionLines([p], undefined), []);
});

test('distance to a trail and trails sorted by distance', () => {
  const d = distanceToPathsM([cc1, cc2], { latitude: 43.031, longitude: -89.39 });
  assert.ok(d > 100 && d < 120, `got ${d}`);
  assert.equal(distanceToPathsM([], { latitude: 43, longitude: -89 }), Infinity);
  const { trails } = groupTrails([cc1, cc2, mr, lane, unnamed]);
  const pathById = new Map([cc1, cc2, mr, lane, unnamed].map((p) => [p.id, p]));
  const sorted = trailsByDistance(trails, pathById, { latitude: 43.0, longitude: -89.5 }, 100);
  // Lanes and unnamed paths are left out; nearest first
  assert.deepEqual(sorted.map((s) => s.trail.name), ['Military Ridge State Trail', 'Capital City State Trail']);
});
