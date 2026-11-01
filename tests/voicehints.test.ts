/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { buildLine, buildManeuvers, directionsList, instruction } from '../src/lib/navigation';
import { parseBRouter, parseVoiceHints, parseWays, wayNameAt } from '../src/lib/routing';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'brouter-voicehints.json'), 'utf8'));

test('parses BRouter voice hints defensively', () => {
  const r = parseBRouter(fixture);
  // Junk rows, unknown codes, beeline and out-of-range indexes are skipped.
  assert.deepEqual(r.cues, [
    { index: 2, kind: 'left' },
    { index: 4, kind: 'keep-right' },
    { index: 5, kind: 'roundabout-right', exit: 2 },
  ]);
  assert.deepEqual(parseVoiceHints(undefined, 10), []);
  assert.deepEqual(parseVoiceHints([[0, 2, 0], [3, 2], [2, 5]], 10), [{ index: 3, kind: 'left' }]);
});

test('reads street names from the messages table by position', () => {
  const r = parseBRouter(fixture);
  assert.deepEqual(r.ways, [
    { from: 0, name: 'Williamson Street' },
    { from: 3, name: 'Capital City State Trail' },
    { from: 4 },
    { from: 5, name: 'Main St' },
  ]);
  assert.equal(wayNameAt(r.ways, 0), 'Williamson Street');
  assert.equal(wayNameAt(r.ways, 3), 'Capital City State Trail');
  assert.equal(wayNameAt(r.ways, 4), undefined);
  assert.equal(wayNameAt(undefined, 4), undefined);
  assert.deepEqual(parseWays([['Distance']], r.coords), []);
  assert.deepEqual(parseWays('nope', r.coords), []);
});

test('builds named maneuvers from cues, keeping the geometry fallback', () => {
  const r = parseBRouter(fixture);
  const line = buildLine(r.coords);
  const ms = buildManeuvers(line, r);
  assert.deepEqual(ms.map(instruction), [
    'Turn left onto Williamson Street',
    'Keep right',
    'At the roundabout, take the 2nd exit onto Main St',
    'Arrive at your destination',
  ]);
  // Without cues the geometry engine still finds the turns, and names them.
  const geo = buildManeuvers(line, { ways: r.ways }, () => 'Some Trail');
  assert.ok(geo.length >= 2);
  assert.equal(geo[geo.length - 1].type, 'arrive');
  const list = directionsList(ms);
  assert.match(list[0].text, /^In 0\.2 mi turn left onto Williamson Street$/);
  assert.match(list[3].text, /arrive at your destination$/);
});
