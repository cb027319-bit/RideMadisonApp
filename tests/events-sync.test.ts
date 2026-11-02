/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chicagoToUtc, mapTicketmaster, type TmEvent } from '../supabase/functions/events-sync/map';

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
