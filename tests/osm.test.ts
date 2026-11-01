/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { simplify } from '../src/lib/geo';
import { classifyWay, parsePaths, parsePlaces, pathsQuery, placesQuery, type OverpassElement } from '../src/lib/osm';

test('classifies off-street paths by surface', () => {
  assert.equal(classifyWay({ highway: 'cycleway' }), 'path_paved');
  assert.equal(classifyWay({ highway: 'cycleway', surface: 'asphalt' }), 'path_paved');
  // Military Ridge / Capital City style crushed limestone
  assert.equal(classifyWay({ highway: 'path', bicycle: 'designated', surface: 'fine_gravel' }), 'path_unpaved');
  assert.equal(classifyWay({ highway: 'track', bicycle: 'yes' }), 'path_unpaved');
  assert.equal(classifyWay({ highway: 'footway', bicycle: 'designated' }), 'path_paved');
});

test('classifies on-street lanes and rejects non-bike ways', () => {
  assert.equal(classifyWay({ highway: 'secondary', cycleway: 'lane' }), 'lane');
  assert.equal(classifyWay({ highway: 'residential', 'cycleway:right': 'track' }), 'lane');
  assert.equal(classifyWay({ highway: 'residential', cycleway: 'shared_lane' }), null);
  assert.equal(classifyWay({ highway: 'footway' }), null);
  assert.equal(classifyWay({ highway: 'cycleway', access: 'private' }), null);
  assert.equal(classifyWay({}), null);
});

test('parsePaths builds simplified, bounded lines and skips junk', () => {
  const json: { elements: OverpassElement[] } = {
    elements: [
      {
        type: 'way' as const,
        id: 42,
        tags: { highway: 'cycleway', name: 'Southwest Commuter Path' },
        geometry: [
          { lat: 43.06, lon: -89.42 },
          { lat: 43.060001, lon: -89.41 }, // nearly collinear: dropped
          { lat: 43.06, lon: -89.4 },
          { lat: 43.07, lon: -89.39 },
        ],
      },
      { type: 'way' as const, id: 43, tags: { highway: 'footway' }, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
      { type: 'way' as const, id: 44, tags: { highway: 'cycleway' }, geometry: [{ lat: 1, lon: 1 }] },
      { type: 'node' as const, id: 45, lat: 43, lon: -89 },
    ],
  };
  const paths = parsePaths(json);
  assert.equal(paths.length, 1);
  const p = paths[0];
  assert.equal(p.id, 'osm:way:42');
  assert.equal(p.name, 'Southwest Commuter Path');
  assert.equal(p.kind, 'path_paved');
  assert.equal(p.coords.length, 3);
  assert.deepEqual(p.coords[0], [-89.42, 43.06]);
  assert.deepEqual(p.bbox, { minLon: -89.42, minLat: 43.06, maxLon: -89.39, maxLat: 43.07 });
});

test('parsePlaces handles nodes and way centers with details', () => {
  const json: { elements: OverpassElement[] } = {
    elements: [
      {
        type: 'node' as const, id: 1, lat: 43.0745, lon: -89.3935,
        tags: {
          shop: 'bicycle', name: 'Example Cycles', 'addr:housenumber': '100', 'addr:street': 'State Street',
          'addr:city': 'Madison', phone: '+1 608 555 0100', website: 'example.com', opening_hours: 'Mo-Sa 10:00-18:00',
          'service:bicycle:repair': 'yes',
        },
      },
      {
        type: 'way' as const, id: 2, center: { lat: 43.07, lon: -89.4 },
        tags: { amenity: 'bicycle_parking', bicycle_parking: 'stands', capacity: '12', covered: 'yes' },
      },
      { type: 'node' as const, id: 3, lat: 43.08, lon: -89.38, tags: { amenity: 'bicycle_repair_station', 'service:bicycle:pump': 'yes' } },
      { type: 'node' as const, id: 4, lat: 43.08, lon: -89.38, tags: { amenity: 'bicycle_parking', access: 'private' } },
      { type: 'node' as const, id: 5, lat: 43.08, lon: -89.38, tags: { amenity: 'bench' } },
      { type: 'way' as const, id: 6, tags: { shop: 'bicycle' } }, // no position
    ],
  };
  const places = parsePlaces(json);
  assert.deepEqual(places.map((p) => p.kind), ['shop', 'parking', 'repair']);
  const [shop, parking, repair] = places;
  assert.equal(shop.address, '100 State Street, Madison');
  assert.equal(shop.hours, 'Mo-Sa 10:00-18:00');
  assert.deepEqual(shop.details, ['Repairs']);
  assert.equal(parking.id, 'osm:way:2');
  assert.deepEqual(parking.details, ['Bike racks', '12 spaces', 'Covered']);
  assert.deepEqual(repair.details, ['Air pump']);
});

test('queries use south,west,north,east bbox order', () => {
  assert.match(pathsQuery([-89.65, 42.9, -89.15, 43.25]), /\(42\.9,-89\.65,43\.25,-89\.15\)/);
  assert.match(placesQuery(), /bicycle_repair_station/);
});

test('simplify keeps endpoints and the shape-defining corner', () => {
  const out = simplify([[0, 0], [1, 0.000001], [2, 0], [2, 1]], 0.001);
  assert.deepEqual(out, [[0, 0], [2, 0], [2, 1]]);
});

test('restaurants, cafes, bars and breweries become food and drink places', () => {
  const places = parsePlaces({
    elements: [
      { type: 'node', id: 10, lat: 43.07, lon: -89.38, tags: { amenity: 'restaurant', name: 'Trailside Grill', cuisine: 'burger;american', outdoor_seating: 'yes' } },
      { type: 'node', id: 11, lat: 43.07, lon: -89.38, tags: { amenity: 'cafe', name: 'Bean There' } },
      { type: 'way', id: 12, center: { lat: 43.07, lon: -89.38 }, tags: { craft: 'brewery', amenity: 'pub', name: 'Hop Haus' } },
      { type: 'node', id: 13, lat: 43.07, lon: -89.38, tags: { amenity: 'bar', name: 'The Spoke' } },
    ],
  });
  assert.deepEqual(places.map((p) => p.kind), ['food', 'food', 'drink', 'drink']);
  assert.deepEqual(places[0].details, ['Restaurant', 'burger, american', 'Patio']);
  assert.deepEqual(places[1].details, ['Café']);
  assert.deepEqual(places[2].details, ['Brewery']);
});
