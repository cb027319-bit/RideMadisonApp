/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bboxOf, type LonLat } from '../src/lib/geo';
import type { BikePath } from '../src/lib/osm';
import { distanceOrigin, insideCoverage, OUTSIDE_NOTE } from '../src/lib/origin';
import { isPartnerPlace, partnersOnTrail, partnersToPin, type PartnerLike } from '../src/lib/partner-geo';

const path = (id: string, coords: LonLat[]): BikePath => ({ id, kind: 'path_paved', coords, bbox: bboxOf(coords) });
// East-west trail along 43.03 N
const trailPaths = [path('a', [[-89.40, 43.03], [-89.38, 43.03]])];
const trail = { name: 'Capital City State Trail' };

function partner(id: string, lat: number, lon: number, extra: Partial<PartnerLike> = {}): PartnerLike {
  return { id, name: id, tier: 'featured', category: 'shop', latitude: lat, longitude: lon, ...extra };
}

test('Nearby pins partners only within ~3 mi, closest first, at most 2', () => {
  const origin = { latitude: 43.0731, longitude: -89.3844 };
  const near1 = partner('near1', 43.075, -89.385); // ~0.2 km
  const near2 = partner('near2', 43.09, -89.38); // ~2 km
  const near3 = partner('near3', 43.10, -89.38); // ~3 km
  const far = partner('far', 43.2, -89.38); // ~14 km
  const food = partner('food', 43.074, -89.384, { category: 'food' });
  const noPos = { ...partner('nopos', 0, 0), latitude: null, longitude: null };
  const pinned = partnersToPin([far, near3, near2, near1, food, noPos], origin, (p) => p.category === 'shop');
  assert.deepEqual(pinned.map((r) => r.partner.id), ['near1', 'near2']);
  assert.equal(partnersToPin([far], origin).length, 0);
});

test('Trail Partners show only near the trail, and only on their named trail', () => {
  const onTrail = partner('on', 43.031, -89.39, { tier: 'trail' }); // ~110 m north
  const named = partner('named', 43.032, -89.39, { tier: 'trail', trail_name: 'capital city state trail' });
  const otherTrail = partner('other', 43.031, -89.39, { tier: 'trail', trail_name: 'Military Ridge State Trail' });
  const tooFar = partner('far', 43.045, -89.39, { tier: 'trail' }); // ~1.7 km
  const featured = partner('featured', 43.0305, -89.39); // close, but $49 tier
  const res = partnersOnTrail([tooFar, named, otherTrail, featured, onTrail], trail, trailPaths);
  assert.deepEqual(res.map((r) => r.partner.id), ['on', 'named']);
  assert.ok(res[0].meters > 90 && res[0].meters < 130, `got ${res[0].meters}`);
  assert.deepEqual(partnersOnTrail([onTrail], trail, []), []);
});

test('OSM places matching a partner are not listed twice', () => {
  const p = partner('Isthmus Bike Works', 43.0789, -89.3714, { osm_place_id: 'osm:node:9' });
  assert.equal(isPartnerPlace({ id: 'osm:node:9', lat: 0, lon: 0 }, [p]), true);
  assert.equal(isPartnerPlace({ id: 'osm:node:1', name: 'Isthmus Bike Works!', lat: 43.0790, lon: -89.3715 }, [p]), true);
  assert.equal(isPartnerPlace({ id: 'osm:node:2', name: 'Isthmus Bike Works', lat: 43.09, lon: -89.3714 }, [p]), false);
  assert.equal(isPartnerPlace({ id: 'osm:node:3', name: 'Other Shop', lat: 43.0789, lon: -89.3714 }, [p]), false);
});

test('distances fall back to the Capitol outside the coverage area', () => {
  const home = { latitude: 43.08, longitude: -89.4 };
  assert.deepEqual(distanceOrigin(home), { origin: home, fromMe: true, outside: false });
  const chicago = { latitude: 41.88, longitude: -87.63 };
  const r = distanceOrigin(chicago);
  assert.equal(r.outside, true);
  assert.equal(r.fromMe, false);
  assert.ok(insideCoverage(r.origin));
  assert.deepEqual(distanceOrigin(null), { origin: r.origin, fromMe: false, outside: false });
  assert.match(OUTSIDE_NOTE, /outside Madison/);
});
