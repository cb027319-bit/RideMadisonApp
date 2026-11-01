/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bikeSummary, feedUrls, mergeStations } from '../src/lib/bcycle';
import { distanceMeters, formatDistance } from '../src/lib/geo';

test('finds station feeds in GBFS v1 (language-keyed) and v2+ shapes', () => {
  const v1 = {
    data: {
      en: {
        feeds: [
          { name: 'station_information', url: 'https://x/info.json' },
          { name: 'station_status', url: 'https://x/status.json' },
        ],
      },
    },
  };
  assert.deepEqual(feedUrls(v1), { info: 'https://x/info.json', status: 'https://x/status.json' });
  const v3 = { data: { feeds: [{ name: 'station_status', url: 's' }, { name: 'station_information', url: 'i' }] } };
  assert.deepEqual(feedUrls(v3), { info: 'i', status: 's' });
});

test('merges info and live status, drops uninstalled stations', () => {
  const info = {
    data: {
      stations: [
        { station_id: 'bcycle_madison_1', name: ' Capitol Square ', lat: 43.075, lon: -89.384, capacity: 15 },
        { station_id: 'bcycle_madison_2', name: 'Union South', lat: 43.072, lon: -89.408 },
        { station_id: 'bcycle_madison_3', name: 'Removed', lat: 43, lon: -89 },
      ],
    },
  };
  const status = {
    data: {
      stations: [
        {
          station_id: 'bcycle_madison_1', num_bikes_available: 6, num_docks_available: 9,
          num_bikes_available_types: { electric: 6 }, is_renting: 1, is_returning: 1, is_installed: 1, last_reported: 1761930000,
        },
        { station_id: 'bcycle_madison_2', num_bikes_available: 0, num_docks_available: 11, is_renting: false, is_returning: true },
        { station_id: 'bcycle_madison_3', is_installed: false },
      ],
    },
  };
  const merged = mergeStations(info, status);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], {
    id: 'bcycle_madison_1', name: 'Capitol Square', lat: 43.075, lon: -89.384, address: undefined, capacity: 15,
    bikes: 6, ebikes: 6, classic: 0, docks: 9, renting: true, returning: true, lastReported: 1761930000,
  });
  assert.equal(merged[1].renting, false);
  assert.equal(merged[1].bikes, 0);
});

test('distance helpers', () => {
  // Capitol to Camp Randall is about 1.6 miles as the crow flies
  const m = distanceMeters(43.0747, -89.3842, 43.0700, -89.4128);
  assert.ok(m > 2200 && m < 2500, `got ${m}`);
  assert.equal(formatDistance(m), '1.5 mi');
  assert.equal(formatDistance(30), '98 ft');
});

test('e-bike vs classic counts from either GBFS field, with plain summaries', () => {
  const info = { data: { stations: [
    { station_id: 'a', name: 'A', lat: 43, lon: -89 },
    { station_id: 'b', name: 'B', lat: 43, lon: -89 },
    { station_id: 'c', name: 'C', lat: 43, lon: -89 },
  ] } };
  const status = { data: { stations: [
    { station_id: 'a', num_bikes_available: 5, num_bikes_available_types: { electric: 3, classic: 2 }, is_renting: 1 },
    { station_id: 'b', num_bikes_available: 4, num_ebikes_available: 1, is_renting: 1 },
    { station_id: 'c', num_bikes_available: 2, is_renting: 1 },
  ] } };
  const [a, b, c] = mergeStations(info, status);
  assert.deepEqual([a.ebikes, a.classic], [3, 2]);
  assert.deepEqual([b.ebikes, b.classic], [1, 3]);
  assert.deepEqual([c.ebikes, c.classic], [undefined, undefined]);
  assert.equal(bikeSummary(a), '3 e-bikes · 2 classic');
  assert.equal(bikeSummary({ bikes: 1, ebikes: 1, classic: 0 }), '1 e-bike');
  assert.equal(bikeSummary({ bikes: 2, ebikes: 0, classic: 2 }), '2 classic bikes');
  assert.equal(bikeSummary(c), '2 bikes');
  assert.equal(bikeSummary({ bikes: 0, ebikes: 0, classic: 0 }), '0 bikes');
});
