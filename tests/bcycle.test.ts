/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { feedUrls, mergeStations } from '../src/lib/bcycle';
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
    bikes: 6, ebikes: 6, docks: 9, renting: true, returning: true, lastReported: 1761930000,
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
