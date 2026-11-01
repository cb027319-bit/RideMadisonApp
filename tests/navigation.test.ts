/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bearing, buildLine, classify, detectManeuvers, instruction, nextManeuver, pointAt, project, shortDistance,
  reachedStop, speakDistance, turnAngle, voicePrompt,
} from '../src/lib/navigation';

// An L-shaped route: 300 m east, then 300 m north (a left turn).
const east = (m: number) => ({ latitude: 43.07, longitude: -89.4 + m / (111320 * Math.cos((43.07 * Math.PI) / 180)) });
const north = (m: number) => ({ latitude: 43.07 + m / 110540, longitude: east(300).longitude });
const L = [east(0), east(100), east(200), east(300), north(100), north(200), north(300)];

test('bearings and turn angles', () => {
  assert.ok(Math.abs(bearing(east(0), east(100)) - 90) < 0.5);
  assert.ok(Math.abs(bearing(east(300), north(100)) - 0) < 0.5);
  assert.equal(turnAngle(90, 0), -90);
  assert.equal(turnAngle(350, 10), 20);
  assert.equal(classify(-90), 'left');
  assert.equal(classify(45), 'slight-right');
  assert.equal(classify(150), 'sharp-right');
  assert.equal(classify(10), null);
  assert.equal(classify(175), 'uturn');
});

test('line length and interpolation', () => {
  const line = buildLine(L);
  assert.ok(Math.abs(line.total - 600) < 5, `got ${line.total}`);
  const mid = pointAt(line, 150);
  assert.ok(Math.abs(mid.longitude - east(150).longitude) < 1e-5);
  assert.deepEqual(pointAt(line, -5), L[0]);
  assert.deepEqual(pointAt(line, 9999), L[L.length - 1]);
});

test('detects the left turn and the arrival', () => {
  const line = buildLine(L);
  const ms = detectManeuvers(line);
  assert.deepEqual(ms.map((m) => m.type), ['left', 'arrive']);
  assert.ok(Math.abs(ms[0].at - 300) < 2);
  assert.equal(instruction({ ...ms[0], onto: 'Capital City State Trail' }), 'Turn left onto Capital City State Trail');
});

test('gentle curves are not turns', () => {
  // A smooth arc turning 30° over 300 m
  const arc = Array.from({ length: 31 }, (_, i) => {
    const θ = ((i / 30) * 30 * Math.PI) / 180;
    return { latitude: 43.07 + (Math.sin(θ) * 300) / 110540 / 0.5236, longitude: -89.4 + ((1 - Math.cos(θ)) * 300) / 81300 / 0.5236 };
  });
  const ms = detectManeuvers(buildLine(arc));
  assert.deepEqual(ms.map((m) => m.type), ['arrive']);
});

test('projects the rider onto the route and measures off-route distance', () => {
  const line = buildLine(L);
  const p = project(line, { latitude: east(120).latitude + 10 / 110540, longitude: east(120).longitude }, 0);
  assert.ok(Math.abs(p.along - 120) < 2, `along ${p.along}`);
  assert.ok(Math.abs(p.offRoute - 10) < 1, `off ${p.offRoute}`);
  const far = project(line, { latitude: 43.08, longitude: -89.41 }, 0);
  assert.ok(far.offRoute > 500);
});

test('next maneuver, distances and voice prompts', () => {
  const line = buildLine(L);
  const ms = detectManeuvers(line);
  assert.equal(nextManeuver(ms, 100).current?.type, 'left');
  assert.equal(nextManeuver(ms, 100).then?.type, 'arrive');
  assert.equal(nextManeuver(ms, 350).current?.type, 'arrive');
  assert.equal(shortDistance(120), '390 ft');
  assert.equal(shortDistance(5000), '3.1 mi');
  assert.equal(speakDistance(200), '700 feet');
  const spoken = new Set<string>();
  assert.equal(voicePrompt(ms[0], 200, spoken), 'In 700 feet, turn left');
  assert.equal(voicePrompt(ms[0], 190, spoken), null); // said once
  assert.equal(voicePrompt(ms[0], 20, spoken), 'Turn left');
  // Arrival is spoken once by the screen, never by the turn prompts.
  assert.equal(voicePrompt(ms[1], 10, spoken), null);
  assert.equal(voicePrompt({ ...ms[0], index: 99, type: 'slight-left', keep: true, onto: 'Capital City Trail' }, 200, spoken), 'In 700 feet, keep left onto Capital City Trail');
});

test('curvy roads are not turns unless at a junction', () => {
  // A 90° bend on a 45 m radius curve: no instruction needed to follow the road.
  const r = 45;
  const k = 111320 * Math.cos((43.07 * Math.PI) / 180);
  const pts: { latitude: number; longitude: number }[] = [];
  for (let x = -200; x < 0; x += 25) pts.push({ latitude: 43.07, longitude: -89.4 + x / k });
  for (let i = 0; i <= 12; i++) {
    const θ = (i / 12) * (Math.PI / 2);
    pts.push({ latitude: 43.07 + (r * (1 - Math.cos(θ))) / 110540, longitude: -89.4 + (r * Math.sin(θ)) / k });
  }
  for (let y = 25; y <= 200; y += 25) pts.push({ latitude: 43.07 + (r + y) / 110540, longitude: -89.4 + r / k });
  const line = buildLine(pts);
  assert.deepEqual(detectManeuvers(line).map((m) => m.type), ['arrive']);
  // The same bend at a junction (the way changes there) is announced.
  const mid = 8 + 6;
  assert.match(detectManeuvers(line, 20, 30, [mid])[0].type, /left/);
});

test('intermediate stops are announced once, never the start or the end', () => {
  const reached = new Set<number>();
  const stops = [0, 300, 600];
  assert.equal(reachedStop(stops, 100, 600, reached), null);
  assert.equal(reachedStop(stops, 290, 600, reached), 1);
  assert.equal(reachedStop(stops, 310, 600, reached), null);
  assert.equal(reachedStop(stops, 600, 600, reached), null);
});
