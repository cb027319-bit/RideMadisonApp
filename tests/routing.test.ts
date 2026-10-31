/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  brouterUrl, buildGpx, classifyWayTags, parseBreakdown, formatDuration, googleMapsUrl, metersToFeet, parseBRouter, parsePhoton, shortLabel,
} from '../src/lib/routing';

const capitol = { latitude: 43.0747, longitude: -89.3842 };
const unionSouth = { latitude: 43.0719, longitude: -89.4081 };

test('builds a BRouter request with lon,lat pairs and the right profile', () => {
  const url = brouterUrl([capitol, unionSouth], 'quiet');
  assert.match(url, /lonlats=-89\.384200,43\.074700\|-89\.408100,43\.071900/);
  assert.match(url, /profile=safety/);
  assert.match(brouterUrl([capitol, unionSouth], 'fast'), /profile=fastbike/);
});

test('parses a BRouter GeoJSON route', () => {
  const r = parseBRouter({
    features: [{
      properties: { 'track-length': '2412', 'filtered ascend': '18', 'total-time': '601' },
      geometry: { type: 'LineString', coordinates: [[-89.3842, 43.0747, 262.5], [-89.39, 43.073, 265], [-89.4081, 43.0719]] },
    }],
  });
  assert.equal(r.distanceM, 2412);
  assert.equal(r.climbM, 18);
  assert.equal(r.timeS, 601);
  assert.equal(r.coords.length, 3);
  assert.deepEqual(r.coords[0], capitol);
  assert.deepEqual(r.elevations, [262.5, 265, null]);
  assert.throws(() => parseBRouter({ features: [] }), /No route/);
});

test('parses Photon search results into readable titles', () => {
  const results = parsePhoton({
    features: [
      { geometry: { coordinates: [-89.3842, 43.0747] }, properties: { osm_type: 'W', osm_id: 1, name: 'Wisconsin State Capitol', housenumber: '2', street: 'East Main Street', city: 'Madison', state: 'Wisconsin' } },
      { geometry: { coordinates: [-89.35, 43.08] }, properties: { osm_type: 'N', osm_id: 2, housenumber: '1200', street: 'Williamson Street', city: 'Madison', state: 'Wisconsin' } },
      { geometry: { coordinates: [-89.35, 43.08] }, properties: { osm_type: 'N', osm_id: 2, street: 'dup' } },
      { properties: { name: 'no geometry' } },
    ],
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Wisconsin State Capitol');
  assert.equal(results[0].subtitle, '2 East Main Street, Madison');
  assert.equal(results[1].title, '1200 Williamson Street');
  assert.equal(results[1].subtitle, 'Madison');
  assert.equal(shortLabel({ features: [{ properties: { housenumber: '5', street: 'Elm St' } }] }), '5 Elm St');
  assert.equal(shortLabel({ features: [] }), null);
});

test('GPX output is valid-looking and escapes names', () => {
  const gpx = buildGpx('Ride to Olbrich & back', { coords: [capitol, unionSouth], elevations: [262.46, null] });
  assert.match(gpx, /<name>Ride to Olbrich &amp; back<\/name>/);
  assert.match(gpx, /<trkpt lat="43\.074700" lon="-89\.384200"><ele>262\.5<\/ele><\/trkpt>/);
  assert.match(gpx, /<trkpt lat="43\.071900" lon="-89\.408100"><\/trkpt>/);
});

test('Google Maps hand-off includes waypoints and caps them at 9', () => {
  const url = googleMapsUrl([capitol, unionSouth, capitol]);
  assert.match(url, /travelmode=bicycling/);
  assert.match(url, /waypoints=43\.071900%2C-89\.408100/);
  const many = Array.from({ length: 14 }, (_, i) => ({ latitude: 43 + i / 100, longitude: -89.4 }));
  const decoded = decodeURIComponent(googleMapsUrl(many).split('waypoints=')[1]);
  assert.equal(decoded.split('|').length, 9);
});

test('formats durations and feet', () => {
  assert.equal(formatDuration(30), '1 min');
  assert.equal(formatDuration(26 * 60), '26 min');
  assert.equal(formatDuration(95 * 60), '1 hr 35 min');
  assert.equal(formatDuration(120 * 60), '2 hr');
  assert.equal(metersToFeet(30), 98);
});

test('route breakdown by way type and surface', () => {
  const b = parseBreakdown([
    ['Longitude', 'Latitude', 'Elevation', 'Distance', 'CostPerKm', 'ElevCost', 'TurnCost', 'NodeCost', 'InitialCost', 'WayTags', 'NodeTags', 'Time', 'Energy'],
    ['-89384200', '43074700', '262', '600', '1000', '0', '0', '0', '0', 'highway=cycleway surface=asphalt', '', '0', '0'],
    ['-89390000', '43073000', '262', '200', '1000', '0', '0', '0', '0', 'highway=residential surface=asphalt', '', '0', '0'],
    ['-89395000', '43072000', '262', '100', '1000', '0', '0', '0', '0', 'highway=secondary cycleway:right=lane', '', '0', '0'],
    ['-89400000', '43072000', '262', '100', '1000', '0', '0', '0', '0', 'highway=path bicycle=designated surface=fine_gravel', '', '0', '0'],
  ])!;
  assert.equal(b.path, 0.7);
  assert.equal(b.quiet, 0.2);
  assert.equal(b.lane, 0.1);
  assert.equal(b.road, 0);
  assert.equal(b.unpaved, 0.1);
  assert.equal(parseBreakdown(undefined), undefined);
  assert.equal(classifyWayTags({ highway: 'primary' }), 'road');
});
