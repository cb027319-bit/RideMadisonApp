/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { filterEvents, groupByDay, nearestParking, timeLabel, validateSubmission, weekendRange, type RideEvent } from '../src/lib/events';
import type { Place } from '../src/lib/osm';

const ev = (over: Partial<RideEvent>): RideEvent => ({
  id: Math.random().toString(36).slice(2),
  source: 'curated',
  category: 'bike',
  title: 'Coffee Ride',
  description: null,
  starts_at: new Date(2026, 10, 7, 9, 0).toISOString(),
  ends_at: null,
  venue_name: 'Olbrich Park',
  address: null,
  latitude: 43.09,
  longitude: -89.33,
  url: null,
  image_url: null,
  featured: false,
  ...over,
});

// Monday, Nov 2 2026, 10:00 local.
const MON = new Date(2026, 10, 2, 10, 0);

test('weekendRange: Monday looks ahead to Fri–Sun; Sunday is still this weekend', () => {
  const w = weekendRange(MON);
  assert.equal(w.start.getDate(), 6); // Fri Nov 6
  assert.equal(w.end.getDate(), 9); // Mon Nov 9, 00:00
  const sun = weekendRange(new Date(2026, 10, 8, 15, 0));
  assert.equal(sun.start.getDate(), 6);
  const fri = weekendRange(new Date(2026, 10, 6, 8, 0));
  assert.equal(fri.start.getDate(), 6);
});

test('filterEvents: weekend, category, and drops events that are over', () => {
  const sat = ev({ starts_at: new Date(2026, 10, 7, 9).toISOString(), category: 'bike' });
  const tue = ev({ starts_at: new Date(2026, 10, 3, 19).toISOString(), category: 'music' });
  const past = ev({ starts_at: new Date(2026, 10, 1, 9).toISOString(), ends_at: new Date(2026, 10, 1, 11).toISOString() });
  const list = [sat, tue, past];
  assert.deepEqual(filterEvents(list, 'all', MON).map((e) => e.id), [sat.id, tue.id]);
  assert.deepEqual(filterEvents(list, 'weekend', MON).map((e) => e.id), [sat.id]);
  assert.deepEqual(filterEvents(list, 'music', MON).map((e) => e.id), [tue.id]);
});

test('groupByDay: today/tomorrow titles, day order, featured first, ongoing under today', () => {
  const ongoing = ev({ starts_at: new Date(2026, 9, 30, 9).toISOString(), ends_at: new Date(2026, 10, 5).toISOString(), title: 'Art fair' });
  const tomorrowLate = ev({ starts_at: new Date(2026, 10, 3, 20).toISOString(), title: 'Late show' });
  const tomorrowFeatured = ev({ starts_at: new Date(2026, 10, 3, 21).toISOString(), title: 'Sponsor ride', featured: true });
  const s = groupByDay([tomorrowLate, ongoing, tomorrowFeatured], MON);
  assert.deepEqual(s.map((x) => x.title), ['Today', 'Tomorrow']);
  assert.equal(s[0].data[0].title, 'Art fair');
  assert.deepEqual(s[1].data.map((e) => e.title), ['Sponsor ride', 'Late show']);
});

test('validateSubmission: catches missing name, venue, past time, bad link', () => {
  const ok = {
    title: 'Coffee Ride',
    category: 'bike' as const,
    startsAt: new Date(2026, 10, 7, 9),
    endsAt: new Date(2026, 10, 7, 11),
    venueName: 'Olbrich Park',
    latitude: 43.09,
    longitude: -89.33,
    url: 'https://example.com/ride',
  };
  assert.deepEqual(validateSubmission(ok, MON), []);
  assert.deepEqual(validateSubmission({ ...ok, title: 'x' }, MON), ['events.err.title']);
  assert.deepEqual(validateSubmission({ ...ok, startsAt: new Date(2026, 10, 1) , endsAt: null }, MON), ['events.err.past']);
  assert.deepEqual(validateSubmission({ ...ok, latitude: undefined }, MON), ['events.err.venue']);
  assert.deepEqual(validateSubmission({ ...ok, url: 'example' }, MON), ['events.err.url']);
  assert.deepEqual(validateSubmission({ ...ok, endsAt: new Date(2026, 10, 7, 8) }, MON), ['events.err.end']);
});

test('nearestParking: closest bike parking within 400 m only', () => {
  const place = (id: string, lat: number, lon: number, kind: Place['kind'] = 'parking') =>
    ({ id, kind, lat, lon, name: null, address: null, details: [], hours: null }) as unknown as Place;
  const near = place('a', 43.0902, -89.3302); // ~30 m
  const far = place('b', 43.1, -89.33); // ~1.1 km
  const shop = place('c', 43.09, -89.33, 'shop');
  const r = nearestParking({ latitude: 43.09, longitude: -89.33 }, [far, shop, near]);
  assert.equal(r?.place.id, 'a');
  assert.ok(r!.meters < 50);
  assert.equal(nearestParking({ latitude: 43.09, longitude: -89.33 }, [far, shop]), null);
  assert.equal(nearestParking({ latitude: null, longitude: null }, [near]), null);
});

test('timeLabel: single time, range, all day', () => {
  assert.equal(timeLabel(ev({ starts_at: new Date(2026, 10, 7, 19, 30).toISOString() })), '7:30 PM');
  assert.equal(
    timeLabel(ev({ starts_at: new Date(2026, 10, 7, 18).toISOString(), ends_at: new Date(2026, 10, 7, 21).toISOString() })),
    '6 PM – 9 PM',
  );
  assert.equal(
    timeLabel(ev({ starts_at: new Date(2026, 10, 7).toISOString(), ends_at: new Date(2026, 10, 8).toISOString() })),
    'All day',
  );
});
