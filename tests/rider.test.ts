/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { BIKE_OPTIONS, buildPrefs, isEbikeRider, prefsComplete, prefsSummary, profileFor } from '../src/lib/rider';

test('BCycle riders get e-bike trail rules', () => {
  assert.equal(isEbikeRider({ bike: 'ebike' }), true);
  assert.equal(isEbikeRider({ bike: 'bcycle' }), true);
  assert.equal(isEbikeRider({ bike: 'tandem' }), false);
  assert.equal(isEbikeRider(null), false);
});

test('offers BCycle and tandem / adaptive options', () => {
  const ids = BIKE_OPTIONS.map((o) => o.id);
  assert.ok(ids.includes('bcycle'));
  assert.ok(ids.includes('tandem'));
  assert.equal(BIKE_OPTIONS.find((o) => o.id === 'bcycle')?.label, 'BCycle (renting)');
});

test('e-bike riders must pick a class before saving', () => {
  assert.equal(prefsComplete('ebike', 'paths', null), false);
  assert.equal(prefsComplete('ebike', 'paths', 'unsure'), true);
  assert.equal(prefsComplete('bike', 'paths', null), true);
  assert.equal(prefsComplete('bike', null, null), false);
});

test('class is only stored for e-bikes', () => {
  assert.deepEqual(buildPrefs('ebike', 'some', '2'), { bike: 'ebike', comfort: 'some', ebikeClass: '2' });
  assert.deepEqual(buildPrefs('road', 'some', '2'), { bike: 'road', comfort: 'some' });
});

test('summarises prefs for the More tab', () => {
  assert.equal(prefsSummary(null), 'Not set yet');
  assert.equal(prefsSummary({ bike: 'ebike', comfort: 'some', ebikeClass: '1' }), 'E-bike (Class 1) · Some traffic is OK');
  assert.equal(prefsSummary({ bike: 'ebike', comfort: 'paths', ebikeClass: 'unsure' }), 'E-bike · Paths and quiet streets');
  assert.equal(profileFor('confident'), 'fast');
});
