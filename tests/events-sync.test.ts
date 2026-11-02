/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  chicagoToUtc,
  isSameEvent,
  mapSeatGeek,
  mapTicketmaster,
  priceFields,
  type SgEvent,
  type TmEvent,
} from '../supabase/functions/events-sync/map';
import { IN_PROGRESS_MS, MIN_GAP_MS, throttleDecision, tokenMatches } from '../supabase/functions/events-sync/throttle';

const base: TmEvent = {
  id: 'Z7r9jZ1A7',
  name: '  Big Concert  ',
  url: 'https://www.ticketmaster.com/event/abc',
  dates: { start: { localDate: '2026-11-14', localTime: '20:00:00', dateTime: '2026-11-15T02:00:00Z' }, status: { code: 'onsale' } },
  classifications: [{ segment: { name: 'Music' }, genre: { name: 'Rock' } }],
  images: [
    { url: 'https://img/small.jpg', width: 305, ratio: '16_9' },
    { url: 'https://img/wide.jpg', width: 1024, ratio: '16_9' },
    { url: 'https://img/huge.jpg', width: 2048, ratio: '16_9' },
  ],
  _embedded: {
    venues: [{ name: 'The Sylvee', address: { line1: '25 S Livingston St' }, city: { name: 'Madison' }, state: { stateCode: 'WI' }, location: { latitude: '43.0806', longitude: '-89.3727' } }],
  },
};

test('mapTicketmaster: maps the essentials', () => {
  const r = mapTicketmaster(base)!;
  assert.equal(r.source, 'ticketmaster');
  assert.equal(r.source_id, 'Z7r9jZ1A7');
  assert.equal(r.title, 'Big Concert');
  assert.equal(r.category, 'music');
  assert.equal(r.status, 'approved');
  assert.equal(r.starts_at, '2026-11-15T02:00:00Z');
  assert.equal(r.ends_at, null);
  assert.equal(r.venue_name, 'The Sylvee');
  assert.equal(r.address, '25 S Livingston St, Madison, WI');
  assert.equal(r.latitude, 43.0806);
  assert.equal(r.longitude, -89.3727);
  assert.equal(r.image_url, 'https://img/wide.jpg');
});

test('mapTicketmaster: categories, cancelled, TBA, no-time all-day', () => {
  assert.equal(mapTicketmaster({ ...base, classifications: [{ segment: { name: 'Sports' } }] })!.category, 'sports');
  assert.equal(mapTicketmaster({ ...base, classifications: [{ segment: { name: 'Arts & Theatre' } }] })!.category, 'arts');
  assert.equal(mapTicketmaster({ ...base, classifications: [{ segment: { name: 'Miscellaneous' }, genre: { name: 'Family' } }] })!.category, 'family');
  assert.equal(mapTicketmaster({ ...base, dates: { ...base.dates, status: { code: 'cancelled' } } })!.status, 'rejected');
  assert.equal(mapTicketmaster({ ...base, dates: { start: { localDate: '2026-11-14', dateTBA: true } } }), null);
  const allDay = mapTicketmaster({ ...base, dates: { start: { localDate: '2026-11-14', noSpecificTime: true } } })!;
  assert.equal(allDay.starts_at, '2026-11-14T06:00:00.000Z'); // midnight CST
  assert.equal(allDay.ends_at, '2026-11-15T06:00:00.000Z');
});

test('chicagoToUtc handles daylight saving', () => {
  assert.equal(chicagoToUtc('2026-07-04', '20:00:00'), '2026-07-05T01:00:00.000Z'); // CDT, UTC-5
  assert.equal(chicagoToUtc('2026-12-05', '20:00:00'), '2026-12-06T02:00:00.000Z'); // CST, UTC-6
});

const sg: SgEvent = {
  id: 6012345,
  title: ' Big Concert ',
  url: 'https://seatgeek.com/big-concert-tickets/123',
  datetime_utc: '2026-11-15T02:00:00',
  type: 'concert',
  taxonomies: [{ name: 'concert' }],
  performers: [{ image: 'https://seatgeek.com/images/performers/1.jpg' }],
  venue: { name: 'The Sylvee', address: '25 S Livingston St', city: 'Madison', state: 'WI', location: { lat: 43.0789, lon: -89.3746 } },
};

test('mapSeatGeek maps a concert', () => {
  const row = mapSeatGeek(sg)!;
  assert.equal(row.source, 'seatgeek');
  assert.equal(row.source_id, '6012345');
  assert.equal(row.title, 'Big Concert');
  assert.equal(row.category, 'music');
  assert.equal(row.starts_at, '2026-11-15T02:00:00.000Z');
  assert.equal(row.address, '25 S Livingston St, Madison, WI');
  assert.equal(row.latitude, 43.0789);
});

test('mapSeatGeek skips events without a date and sorts sports', () => {
  assert.equal(mapSeatGeek({ ...sg, date_tbd: true }), null);
  assert.equal(mapSeatGeek({ ...sg, type: 'ncaa_basketball', taxonomies: [{ name: 'sports' }] })!.category, 'sports');
});

test('isSameEvent spots a show listed on both sites', () => {
  const a = mapSeatGeek(sg)!;
  const b = { ...a, source: 'ticketmaster' as const, latitude: 43.0791, longitude: -89.3749, starts_at: '2026-11-15T01:30:00.000Z' };
  assert.equal(isSameEvent(b, a), true);
  assert.equal(isSameEvent({ ...b, starts_at: '2026-11-16T02:00:00.000Z' }, a), false);
  assert.equal(isSameEvent({ ...b, latitude: 43.06, longitude: -89.4 }, a), false);
  assert.equal(isSameEvent({ ...b, latitude: null, longitude: null, venue_name: 'the sylvee' }, a), true);
});

// ---------- prices ----------

test('mapTicketmaster: USD price ranges become price_min/price_max', () => {
  const r = mapTicketmaster({
    ...base,
    priceRanges: [
      { type: 'standard', currency: 'USD', min: 25, max: 79.5 },
      { type: 'standard including fees', currency: 'USD', min: 31.4, max: 92.123 },
      { type: 'standard', currency: 'CAD', min: 5, max: 500 },
    ],
  })!;
  assert.equal(r.price_min, 25);
  assert.equal(r.price_max, 92.12);
  assert.equal(r.is_free, null);
});

test('mapTicketmaster: no USD price → unknown; all zero → free', () => {
  const none = mapTicketmaster(base)!;
  assert.deepEqual([none.price_min, none.price_max, none.is_free], [null, null, null]);
  const cad = mapTicketmaster({ ...base, priceRanges: [{ currency: 'CAD', min: 10, max: 20 }] })!;
  assert.deepEqual([cad.price_min, cad.price_max, cad.is_free], [null, null, null]);
  const free = mapTicketmaster({ ...base, priceRanges: [{ currency: 'USD', min: 0, max: 0 }] })!;
  assert.deepEqual([free.price_min, free.price_max, free.is_free], [0, 0, true]);
  const fromZero = mapTicketmaster({ ...base, priceRanges: [{ currency: 'USD', min: 0, max: 15 }] })!;
  assert.equal(fromZero.is_free, null);
});

test('priceFields ignores bad values and keeps one price', () => {
  assert.deepEqual(priceFields([NaN, -5, 1e7, undefined, null]), { price_min: null, price_max: null, is_free: null });
  assert.deepEqual(priceFields([40]), { price_min: 40, price_max: 40, is_free: null });
  assert.deepEqual(priceFields([60, 18]), { price_min: 18, price_max: 60, is_free: null });
});

test('mapSeatGeek: stats lowest/highest price', () => {
  const r = mapSeatGeek({ ...sg, stats: { lowest_price: 42, highest_price: 310 } })!;
  assert.equal(r.price_min, 42);
  assert.equal(r.price_max, 310);
  assert.equal(r.is_free, null);
  const none = mapSeatGeek({ ...sg, stats: { lowest_price: null, highest_price: null } })!;
  assert.deepEqual([none.price_min, none.price_max, none.is_free], [null, null, null]);
  assert.equal(mapSeatGeek(sg)!.price_min, null);
});

// ---------- family as an extra category ----------

test('mapTicketmaster: family genre/subGenre/segment adds family to extra_categories', () => {
  assert.deepEqual(mapTicketmaster(base)!.extra_categories, []);
  const sub = mapTicketmaster({
    ...base,
    classifications: [{ segment: { name: 'Arts & Theatre' }, genre: { name: 'Theatre' }, subGenre: { name: "Children's Theatre" } }],
  })!;
  assert.equal(sub.category, 'arts');
  assert.deepEqual(sub.extra_categories, ['family']);
  const music = mapTicketmaster({
    ...base,
    classifications: [{ segment: { name: 'Music' }, genre: { name: 'Children\'s Music' } }],
  })!;
  assert.equal(music.category, 'music');
  assert.deepEqual(music.extra_categories, ['family']);
  const flagged = mapTicketmaster({ ...base, classifications: [{ segment: { name: 'Sports' }, family: true }] })!;
  assert.deepEqual(flagged.extra_categories, ['family']);
  // Main category already family: no repeat.
  const fam = mapTicketmaster({ ...base, classifications: [{ segment: { name: 'Miscellaneous' }, genre: { name: 'Family' } }] })!;
  assert.equal(fam.category, 'family');
  assert.deepEqual(fam.extra_categories, []);
});

test('mapSeatGeek: family taxonomy adds family to extra_categories', () => {
  assert.deepEqual(mapSeatGeek(sg)!.extra_categories, []);
  const show = mapSeatGeek({ ...sg, type: 'concert', taxonomies: [{ name: 'concert' }, { name: 'family' }] })!;
  assert.equal(show.category, 'music');
  assert.deepEqual(show.extra_categories, ['family']);
  const fam = mapSeatGeek({ ...sg, type: 'family', taxonomies: [{ name: 'family' }] })!;
  assert.equal(fam.category, 'family');
  assert.deepEqual(fam.extra_categories, []);
});

// ---------- throttle ----------

const NOW = Date.parse('2026-11-02T15:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test('throttle: first run and runs 20+ minutes apart are allowed', () => {
  assert.deepEqual(throttleDecision({ now: NOW }), { run: true, bypass: false });
  assert.deepEqual(throttleDecision({ now: NOW, lastSuccess: ago(MIN_GAP_MS) }), { run: true, bypass: false });
  assert.deepEqual(throttleDecision({ now: NOW, lastSuccess: 'garbage' }), { run: true, bypass: false });
});

test('throttle: a run less than 20 minutes after a success gets refused with retry time', () => {
  const d = throttleDecision({ now: NOW, lastSuccess: ago(5 * 60_000) });
  assert.deepEqual(d, { run: false, retryAfterSec: 15 * 60 });
});

test('throttle: a run still in progress blocks for 3 minutes; finished starts do not', () => {
  assert.equal(throttleDecision({ now: NOW, lastStart: ago(60_000) }).run, false);
  assert.equal(throttleDecision({ now: NOW, lastStart: ago(IN_PROGRESS_MS + 1) }).run, true);
  // Started before the last success (that run finished): only the 20-minute rule applies.
  assert.equal(
    throttleDecision({ now: NOW, lastStart: ago(MIN_GAP_MS + 60_000), lastSuccess: ago(MIN_GAP_MS + 30_000) }).run,
    true,
  );
});

test('throttle: future timestamps count as now', () => {
  const d = throttleDecision({ now: NOW, lastSuccess: new Date(NOW + 86_400_000).toISOString() });
  assert.deepEqual(d, { run: false, retryAfterSec: MIN_GAP_MS / 1000 });
});

test('throttle: the right x-sync-token always runs; a wrong or missing secret does not bypass', () => {
  const recent = ago(60_000);
  assert.deepEqual(throttleDecision({ now: NOW, lastSuccess: recent, token: 's3cret', secret: 's3cret' }), {
    run: true,
    bypass: true,
  });
  assert.equal(throttleDecision({ now: NOW, lastSuccess: recent, token: 's3creT', secret: 's3cret' }).run, false);
  assert.equal(throttleDecision({ now: NOW, lastSuccess: recent, token: '', secret: '' }).run, false);
  assert.equal(throttleDecision({ now: NOW, lastSuccess: recent, token: 'x', secret: undefined }).run, false);
  assert.equal(tokenMatches('abc', 'abcd'), false);
  assert.equal(tokenMatches(null, 'abc'), false);
});
