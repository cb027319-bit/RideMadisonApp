/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { BCycleStation } from '../src/lib/bcycle';
import {
  capitalize, eventCategories, featuredEvents, filterEvents, groupByDay, groupSubmissions, nearestParking, nearestStation, nextSubmission, parsePrice,
  priceLabel, rowA11yLabel, safeImageUrl, statusKey, submissionRows, submitErrorKey, timeLabel, uuidV4, validateSubmission,
  weeklyDates, weekendRange, type EventSubmission, type MySubmission, type RideEvent,
} from '../src/lib/events';
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

test('filterEvents: when and category combine; extra categories count; finished events drop', () => {
  const sat = ev({ starts_at: new Date(2026, 10, 7, 9).toISOString(), category: 'bike' });
  const satFamily = ev({ starts_at: new Date(2026, 10, 7, 13).toISOString(), category: 'bike', extra_categories: ['family'] });
  const tue = ev({ starts_at: new Date(2026, 10, 3, 19).toISOString(), category: 'music' });
  const today = ev({ starts_at: new Date(2026, 10, 2, 18).toISOString(), category: 'family' });
  const nextWeekFamily = ev({ starts_at: new Date(2026, 10, 14, 10).toISOString(), category: 'family' });
  const past = ev({ starts_at: new Date(2026, 10, 1, 9).toISOString(), ends_at: new Date(2026, 10, 1, 11).toISOString() });
  const list = [sat, satFamily, tue, today, nextWeekFamily, past];
  const ids = (when: 'upcoming' | 'today' | 'weekend', category: Parameters<typeof filterEvents>[1]['category']) =>
    filterEvents(list, { when, category }, MON).map((e) => e.id);
  assert.deepEqual(ids('upcoming', 'all'), [sat.id, satFamily.id, tue.id, today.id, nextWeekFamily.id]);
  assert.deepEqual(ids('weekend', 'all'), [sat.id, satFamily.id]);
  assert.deepEqual(ids('weekend', 'family'), [satFamily.id]);
  assert.deepEqual(ids('upcoming', 'family'), [satFamily.id, today.id, nextWeekFamily.id]);
  assert.deepEqual(ids('today', 'all'), [today.id]);
  assert.deepEqual(ids('today', 'music'), []);
  assert.deepEqual(ids('upcoming', 'music'), [tue.id]);
});

test('filterEvents: an event still running today counts as today', () => {
  const fair = ev({ starts_at: new Date(2026, 9, 31, 9).toISOString(), ends_at: new Date(2026, 10, 3, 17).toISOString() });
  assert.equal(filterEvents([fair], { when: 'today', category: 'all' }, MON).length, 1);
});

test('eventCategories: main first, no repeats', () => {
  assert.deepEqual(eventCategories({ category: 'bike', extra_categories: ['family', 'bike'] }), ['bike', 'family']);
  assert.deepEqual(eventCategories({ category: 'music', extra_categories: null }), ['music']);
});

test('priceLabel: free, single, range, from, unknown', () => {
  assert.equal(priceLabel({ is_free: true, price_min: null, price_max: null }), 'Free');
  assert.equal(priceLabel({ is_free: null, price_min: 0, price_max: 0 }), 'Free');
  assert.equal(priceLabel({ is_free: false, price_min: 25, price_max: 25 }), '$25');
  assert.equal(priceLabel({ is_free: false, price_min: 25, price_max: 80 }), '$25–$80');
  assert.equal(priceLabel({ is_free: null, price_min: 25, price_max: null }), 'From $25');
  assert.equal(priceLabel({ is_free: null, price_min: 12.5, price_max: 12.5 }), '$12.50');
  assert.equal(priceLabel({ is_free: null, price_min: null, price_max: null }), null);
  assert.equal(priceLabel({ is_free: false, price_min: null, price_max: null }), null);
  assert.equal(priceLabel({}), null);
});

test('parsePrice: plain, dollar sign, comma decimals, empty, junk', () => {
  assert.equal(parsePrice('25'), 25);
  assert.equal(parsePrice(' $25.50 '), 25.5);
  assert.equal(parsePrice('12,5'), 12.5);
  assert.equal(parsePrice(''), null);
  assert.ok(Number.isNaN(parsePrice('twenty')));
  assert.ok(Number.isNaN(parsePrice('-3')));
  assert.ok(Number.isNaN(parsePrice('20000')));
});

test('featuredEvents: next 14 days only, soonest first, max 5, not over', () => {
  const f = (d: number, h = 10) => ev({ featured: true, starts_at: new Date(2026, 10, 2 + d, h).toISOString() });
  const later = f(20);
  const soon = [f(6), f(1), f(3), f(2), f(4), f(5)];
  const over = ev({ featured: true, starts_at: new Date(2026, 10, 1, 9).toISOString(), ends_at: new Date(2026, 10, 1, 11).toISOString() });
  const plain = ev({ starts_at: new Date(2026, 10, 3).toISOString() });
  const r = featuredEvents([later, ...soon, over, plain], MON);
  assert.equal(r.length, 5);
  assert.deepEqual(r.map((e) => new Date(e.starts_at).getDate()), [3, 4, 5, 6, 7]);
});

test('safeImageUrl: https only', () => {
  assert.equal(safeImageUrl('https://cdn.example.com/a.jpg'), 'https://cdn.example.com/a.jpg');
  assert.equal(safeImageUrl('http://cdn.example.com/a.jpg'), null);
  assert.equal(safeImageUrl('javascript:alert(1)'), null);
  assert.equal(safeImageUrl(null), null);
});

test('nearestStation: closest BCycle station within 500 m that has docks or bikes', () => {
  const st = (id: string, lat: number, lon: number, docks = 5, bikes = 3) =>
    ({ id, name: id, lat, lon, docks, bikes, renting: true, returning: true }) as BCycleStation;
  const venue = { latitude: 43.09, longitude: -89.33 };
  const close = st('close', 43.0915, -89.33); // ~170 m
  const closer = st('empty', 43.0905, -89.33, 0, 0); // ~55 m, nothing available
  const far = st('far', 43.1, -89.33); // ~1.1 km
  const r = nearestStation(venue, [far, closer, close]);
  assert.equal(r?.station.id, 'close');
  assert.ok(r!.meters > 150 && r!.meters < 190);
  assert.equal(nearestStation(venue, [far, closer]), null);
  assert.equal(nearestStation({ latitude: null, longitude: null }, [close]), null);
});

test('rowA11yLabel: title, day and time, venue, price', () => {
  const e = ev({ title: 'Badgers hockey', starts_at: new Date(2026, 10, 3, 19, 30).toISOString(), venue_name: 'Kohl Center', price_min: 25, price_max: 80 });
  assert.equal(rowA11yLabel(e, MON), 'Badgers hockey, Tomorrow, 7:30 PM, Kohl Center, $25–$80');
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

const sub = (over: Partial<EventSubmission> = {}): EventSubmission => ({
  title: 'Tuesday Shop Ride',
  category: 'bike',
  startsAt: new Date(2026, 10, 3, 18, 30),
  endsAt: new Date(2026, 10, 3, 20, 30),
  venueName: 'Isthmus Bike Works',
  address: null,
  latitude: 43.08,
  longitude: -89.37,
  url: null,
  description: null,
  contactEmail: 'a@b.co',
  ...over,
});

test('weeklyDates: same local time each week, clamped to 1–12', () => {
  const d = weeklyDates(new Date(2026, 9, 27, 18, 30), 3); // crosses the Nov 1 DST change
  assert.deepEqual(d.map((x) => [x.getMonth(), x.getDate(), x.getHours(), x.getMinutes()]), [[9, 27, 18, 30], [10, 3, 18, 30], [10, 10, 18, 30]]);
  assert.equal(weeklyDates(new Date(2026, 10, 3), 40).length, 12);
  assert.equal(weeklyDates(new Date(2026, 10, 3), 0).length, 1);
});

test('submissionRows: a weekly series shares one id, keeps its length, max 12', () => {
  let n = 0;
  const rows = submissionRows(sub({ weeks: 4, extraCategories: ['family', 'bike', 'family'], cost: 'paid', price: 10 }), () => `id-${++n}`);
  assert.equal(rows.length, 4);
  assert.equal(n, 1);
  assert.ok(rows.every((r) => r.series_id === 'id-1'));
  assert.deepEqual(rows.map((r) => new Date(r.starts_at).getDate()), [3, 10, 17, 24]);
  assert.ok(rows.every((r) => new Date(r.ends_at!).getTime() - new Date(r.starts_at).getTime() === 2 * 3_600_000));
  assert.deepEqual(rows[0].extra_categories, ['family']);
  assert.equal(rows[0].is_free, false);
  assert.equal(rows[0].price_min, 10);
  assert.equal(rows[0].status, 'pending');
  assert.equal(rows[0].source, 'partner');
  assert.equal(submissionRows(sub({ weeks: 30 })).length, 12);
});

test('submissionRows: one date has no series id; cost maps to is_free', () => {
  const [one] = submissionRows(sub(), () => 'nope');
  assert.equal(one.series_id, null);
  assert.equal(one.is_free, null);
  assert.equal(one.price_min, null);
  assert.equal(submissionRows(sub({ cost: 'free', price: 5 }))[0].is_free, true);
  assert.equal(submissionRows(sub({ cost: 'free', price: 5 }))[0].price_min, null);
  const allDay = submissionRows(sub({ allDay: true, startsAt: new Date(2026, 10, 7), endsAt: new Date(2026, 10, 8), weeks: 2 }));
  assert.equal(new Date(allDay[1].ends_at!).getDate(), 15);
});

test('uuidV4: valid version-4 format, random by default', () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(uuidV4(), re);
  assert.notEqual(uuidV4(), uuidV4());
  assert.equal(uuidV4(new Uint8Array(16)), '00000000-0000-4000-8000-000000000000');
});

test('validateSubmission: price, weeks, and all-day events for today', () => {
  const ok = sub();
  assert.deepEqual(validateSubmission({ ...ok, cost: 'paid', price: NaN }, MON), ['events.err.price']);
  assert.deepEqual(validateSubmission({ ...ok, cost: 'paid', price: null }, MON), []);
  assert.deepEqual(validateSubmission({ ...ok, weeks: 13 }, MON), ['events.err.weeks']);
  assert.deepEqual(validateSubmission({ ...ok, weeks: 12 }, MON), []);
  const todayAllDay = { ...ok, allDay: true, startsAt: new Date(2026, 10, 2), endsAt: new Date(2026, 10, 3) };
  assert.deepEqual(validateSubmission(todayAllDay, MON), []);
  const yesterdayAllDay = { ...ok, allDay: true, startsAt: new Date(2026, 10, 1), endsAt: new Date(2026, 10, 2) };
  assert.deepEqual(validateSubmission(yesterdayAllDay, MON), ['events.err.past']);
});

test('submitErrorKey: limit, network, anything else generic', () => {
  assert.equal(submitErrorKey('Too many events waiting for review. Please wait for approval.'), 'events.err.tooMany');
  assert.equal(submitErrorKey('TypeError: Network request failed'), 'events.err.network');
  assert.equal(submitErrorKey('new row violates row-level security policy for table "events"'), 'events.err.generic');
  assert.equal(submitErrorKey(undefined), 'events.err.generic');
});

test('groupSubmissions: series grouped, newest first, mixed status', () => {
  const row = (id: string, series: string | null, day: number, status: string, created: string): MySubmission => ({
    id, series_id: series, title: id, starts_at: new Date(2026, 10, day, 18).toISOString(), status, created_at: created,
  });
  const g = groupSubmissions([
    row('s2', 'S', 10, 'pending', '2026-11-02T10:00:00Z'),
    row('s1', 'S', 3, 'approved', '2026-11-02T10:00:00Z'),
    row('one', null, 5, 'rejected', '2026-11-01T10:00:00Z'),
    row('new', null, 9, 'pending', '2026-11-02T12:00:00Z'),
  ]);
  assert.deepEqual(g.map((x) => x.key), ['new', 'S', 'one']);
  assert.deepEqual(g[1].rows.map((r) => r.id), ['s1', 's2']);
  assert.equal(g[1].status, null);
  assert.equal(g[0].status, 'pending');
  assert.equal(nextSubmission(g[1], new Date(2026, 10, 5)).id, 's2');
  assert.equal(nextSubmission(g[1], new Date(2026, 11, 1)).id, 's1');
  assert.equal(statusKey('approved'), 'events.mine.live');
  assert.equal(statusKey('rejected'), 'events.mine.rejected');
  assert.equal(statusKey('pending'), 'events.mine.pending');
});

test('capitalize: first letter only', () => {
  assert.equal(capitalize('sáb, 7 de nov.'), 'Sáb, 7 de nov.');
  assert.equal(capitalize(''), '');
});
