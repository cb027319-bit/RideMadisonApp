/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chicagoToUtc, isSameEvent, mapSeatGeek, mapTicketmaster, type SgEvent, type TmEvent } from '../supabase/functions/events-sync/map';

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
