/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { areaId, parkTrailsQuery, parseParks, parseParkTrails } from '../src/lib/parks';

test('parses state parks and keeps one entry per park name', () => {
  const parks = parseParks({
    elements: [
      { type: 'relation', id: 5, center: { lat: 42.97, lon: -89.23 }, bounds: { minlat: 42.96, minlon: -89.25, maxlat: 42.99, maxlon: -89.21 }, tags: { name: 'Lake Kegonsa State Park', boundary: 'protected_area', website: 'https://dnr.wisconsin.gov/topic/parks/lakekegonsa' } },
      { type: 'way', id: 9, center: { lat: 42.97, lon: -89.23 }, bounds: { minlat: 42.965, minlon: -89.24, maxlat: 42.975, maxlon: -89.22 }, tags: { name: 'Lake Kegonsa State Park', leisure: 'park' } },
      { type: 'way', id: 10, center: { lat: 43.13, lon: -89.43 }, tags: { name: 'Governor Nelson State Park', leisure: 'park' } },
      { type: 'way', id: 11, center: { lat: 43.1, lon: -89.4 }, tags: { name: 'Vilas Park', leisure: 'park' } },
    ],
  });
  assert.deepEqual(parks.map((p) => p.name), ['Governor Nelson State Park', 'Lake Kegonsa State Park']);
  const kegonsa = parks[1];
  assert.equal(kegonsa.id, 'osm:relation:5'); // larger outline wins
  assert.equal(kegonsa.website, 'https://dnr.wisconsin.gov/topic/parks/lakekegonsa');
});

test('builds an area query for ways and relations, radius for nodes', () => {
  assert.equal(areaId({ osmType: 'way', osmId: 9 }), 2400000009);
  assert.equal(areaId({ osmType: 'relation', osmId: 5 }), 3600000005);
  assert.equal(areaId({ osmType: 'node', osmId: 1 }), null);
  assert.match(parkTrailsQuery({ id: 'x', name: 'x', osmType: 'relation', osmId: 5, lat: 0, lon: 0 }), /area\(id:3600000005\)/);
  assert.match(parkTrailsQuery({ id: 'x', name: 'x', osmType: 'node', osmId: 1, lat: 43, lon: -89 }), /around:2000,43,-89/);
});

test('groups park trails by name with bike access', () => {
  const trails = parseParkTrails({
    elements: [
      { type: 'way', id: 1, tags: { highway: 'path', name: 'White Oak Trail', bicycle: 'no' }, geometry: [{ lat: 42.97, lon: -89.23 }, { lat: 42.97, lon: -89.22 }] },
      { type: 'way', id: 2, tags: { highway: 'track', name: 'Bike Loop', bicycle: 'designated', surface: 'gravel' }, geometry: [{ lat: 42.98, lon: -89.23 }, { lat: 42.98, lon: -89.21 }] },
      { type: 'way', id: 3, tags: { highway: 'track', name: 'Bike Loop', bicycle: 'designated', surface: 'gravel' }, geometry: [{ lat: 42.98, lon: -89.21 }, { lat: 42.99, lon: -89.21 }] },
      { type: 'way', id: 4, tags: { highway: 'path', name: 'Tiny' }, geometry: [{ lat: 42.98, lon: -89.23 }, { lat: 42.98, lon: -89.2301 }] },
    ],
  });
  assert.deepEqual(trails.map((t) => t.name), ['Bike Loop', 'White Oak Trail']);
  assert.equal(trails[0].access, 'bike');
  assert.equal(trails[0].surface, 'gravel');
  assert.equal(trails[0].lines.length, 2);
  assert.equal(trails[1].access, 'no_bike');
});
