/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createAnalytics, pctBucket, roundMiles, roundMinutes, sanitize, screenName, shareBucket, sponsorEventName,
  type AnalyticsClient,
} from '../src/lib/analytics-core';
import { ImpressionDedupe } from '../src/lib/partner-events';

const MI = 1609.344;

function fakeClient() {
  const calls: string[] = [];
  const client: AnalyticsClient = {
    capture: (e, p) => void calls.push(`capture:${e}:${JSON.stringify(p ?? {})}`),
    screen: (n) => void calls.push(`screen:${n}`),
    identify: (id) => void calls.push(`identify:${id}`),
    reset: () => void calls.push('reset'),
    optIn: () => void calls.push('optIn'),
    optOut: () => void calls.push('optOut'),
  };
  return { client, calls };
}

test('with no key every call is a silent no-op', () => {
  const a = createAnalytics(null);
  assert.equal(a.configured, false);
  a.track('app_opened', {});
  a.screen('/route');
  a.identify('user-1');
  a.reset();
  a.setEnabled(true);
  a.setEnabled(false);
  assert.equal(a.pending, 0);
});

test('events wait for the opt-out choice, then send', () => {
  const { client, calls } = fakeClient();
  const a = createAnalytics(client);
  a.track('app_opened', {});
  a.screen('/');
  assert.deepEqual(calls, []);
  assert.equal(a.pending, 2);
  a.setEnabled(true);
  assert.deepEqual(calls, ['optIn', 'capture:app_opened:{}', 'screen:map']);
});

test('opted out: nothing is sent, and the buffer is dropped', () => {
  const { client, calls } = fakeClient();
  const a = createAnalytics(client);
  a.track('app_opened', {});
  a.setEnabled(false);
  a.track('layer_toggled', { layer: 'bcycle', on: true, from: 'chips' });
  a.identify('user-1');
  assert.deepEqual(calls, ['optOut']);
  assert.equal(a.pending, 0);
});

test('sign-out resets and keeps an opt-out in place', () => {
  const { client, calls } = fakeClient();
  const a = createAnalytics(client);
  a.setEnabled(false);
  a.identify('user-1');
  a.reset();
  assert.deepEqual(calls, ['optOut', 'reset', 'optOut']);
});

test('identify sends the account id only, once', () => {
  const { client, calls } = fakeClient();
  const a = createAnalytics(client);
  a.setEnabled(true);
  a.identify('abc');
  a.identify('abc');
  a.reset();
  a.reset(); // not identified any more: no second reset
  assert.deepEqual(calls, ['optIn', 'identify:abc', 'reset']);
});

test('sanitize drops location, personal info, search text and non-primitive values', () => {
  const out = sanitize({
    latitude: 43.07, longitude: -89.38, lat: 1, lng: 2, email: 'a@b.c', name: 'Jo', address: '1 Main St', query: 'coffee',
    coords: [[1, 2]], geometry: { type: 'LineString' }, nested: { a: 1 }, nan: NaN, gone: undefined,
    distance_mi: 2.5, partner_name: 'Isthmus Bike Works', ok: true, none: null,
  });
  assert.deepEqual(out, { distance_mi: 2.5, partner_name: 'Isthmus Bike Works', ok: true, none: null });
});

test('distances round to the nearest half mile', () => {
  assert.equal(roundMiles(0), 0);
  assert.equal(roundMiles(-5), 0);
  assert.equal(roundMiles(null), 0);
  assert.equal(roundMiles(0.2 * MI), 0);
  assert.equal(roundMiles(0.3 * MI), 0.5);
  assert.equal(roundMiles(2.74 * MI), 2.5);
  assert.equal(roundMiles(2.76 * MI), 3);
  assert.equal(roundMiles(12.3 * MI, 1), 12);
});

test('percent, share and minute buckets', () => {
  assert.equal(pctBucket(0), 0);
  assert.equal(pctBucket(0.44), 40);
  assert.equal(pctBucket(0.46), 50);
  assert.equal(pctBucket(1.3), 100);
  assert.equal(shareBucket(0), 'none');
  assert.equal(shareBucket(0.1), 'under_25');
  assert.equal(shareBucket(0.3), '25_50');
  assert.equal(shareBucket(0.6), '50_75');
  assert.equal(shareBucket(0.9), '75_plus');
  assert.equal(roundMinutes(0), 0);
  assert.equal(roundMinutes(17 * 60), 15);
  assert.equal(roundMinutes(18 * 60), 20);
});

test('screen names come from the path only', () => {
  assert.equal(screenName('/'), 'map');
  assert.equal(screenName('/route'), 'route');
  assert.equal(screenName('/navigate?lat=43'), 'navigate');
  assert.equal(screenName(null), 'map');
});

test('sponsor events mirror the Supabase partner event kinds', () => {
  assert.equal(sponsorEventName('impression'), 'sponsored_listing_impression');
  assert.equal(sponsorEventName('offer'), 'offer_viewed');
  for (const k of ['open', 'call', 'website', 'directions', 'route'] as const) {
    assert.equal(sponsorEventName(k), 'sponsored_listing_tap');
  }
});

test('sponsor impressions are deduped by the same rule as Supabase (once per partner and placement)', () => {
  const d = new ImpressionDedupe();
  const sent: string[] = [];
  const fire = (id: string, placement: string) => {
    if (d.shouldSend(id, 'impression', placement)) sent.push(`${sponsorEventName('impression')}:${id}:${placement}`);
  };
  for (let i = 0; i < 5; i++) fire('p1', 'pin'); // pin re-rendered / scrolled in and out
  fire('p1', 'trail_sponsor');
  assert.deepEqual(sent, ['sponsored_listing_impression:p1:pin', 'sponsored_listing_impression:p1:trail_sponsor']);
});
