/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addFix, badgeProgress, newlyEarned, newRecorder, summarize, weekStreak, type RideLog } from '../src/lib/stats';

const MI = 1609.344;
const day = 86400000;
// Wednesday 2026-10-28, noon local
const NOW = new Date(2026, 9, 28, 12).getTime();
const ride = (o: Partial<RideLog>): RideLog => ({
  id: Math.random().toString(36), startedAt: NOW - day, distanceM: 10 * MI, movingS: 3600, elapsedS: 4000,
  climbM: 50, maxSpeedMps: 8, title: 'Ride', ...o,
});

test('summarizes miles, average and top speed', () => {
  const s = summarize([ride({}), ride({ distanceM: 5 * MI, movingS: 1800, maxSpeedMps: 10 })], NOW);
  assert.equal(s.rides, 2);
  assert.ok(Math.abs(s.miles - 15) < 0.01);
  assert.ok(Math.abs(s.avgMph - 10) < 0.01);
  assert.ok(Math.abs(s.topMph - 22.37) < 0.05);
  assert.ok(Math.abs(s.longestMiles - 10) < 0.01);
});

test('week streak counts consecutive weeks and survives a quiet current week', () => {
  const logs = [ride({ startedAt: NOW - 7 * day }), ride({ startedAt: NOW - 14 * day }), ride({ startedAt: NOW - 21 * day })];
  assert.equal(weekStreak(logs, NOW), 3);
  assert.equal(weekStreak([...logs, ride({ startedAt: NOW })], NOW), 4);
  assert.equal(weekStreak([ride({ startedAt: NOW - 28 * day })], NOW), 0);
});

test('badges: first ride, distance and suggested ride by name', () => {
  assert.equal(badgeProgress([], NOW).filter((b) => b.earned).length, 0);
  const earned = newlyEarned([], [ride({ title: 'Lake Monona Loop', distanceM: 12 * MI })], NOW).map((b) => b.id);
  assert.ok(earned.includes('first-ride'));
  assert.ok(earned.includes('ride-10'));
  assert.ok(earned.includes('monona'));
  assert.ok(!earned.includes('miles-100'));
});

test('recorder ignores GPS jumps and counts only moving time', () => {
  let r = newRecorder();
  r = addFix(r, 43.07, -89.38, 0, null);
  r = addFix(r, 43.0701, -89.38, 2000, 5); // ~11 m in 2 s: moving
  assert.ok(r.distanceM > 10 && r.distanceM < 12);
  assert.equal(r.movingS, 2);
  r = addFix(r, 43.0701, -89.38, 12000, 0); // stopped 10 s
  assert.equal(r.movingS, 2);
  r = addFix(r, 43.08, -89.38, 13000, null); // 1 km in 1 s: glitch
  assert.ok(r.distanceM < 12);
});
