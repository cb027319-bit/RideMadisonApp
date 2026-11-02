/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ImpressionDedupe, newSessionKey, PARTNER_EVENTS, PARTNER_PLACEMENTS } from '../src/lib/partner-events';

test('impressions count once per partner and placement per session', () => {
  const d = new ImpressionDedupe();
  assert.equal(d.shouldSend('p1', 'impression', 'pin'), true);
  assert.equal(d.shouldSend('p1', 'impression', 'pin'), false);
  assert.equal(d.shouldSend('p1', 'impression', 'trail_sponsor'), true);
  assert.equal(d.shouldSend('p2', 'impression', 'pin'), true);
});

test('taps are always sent', () => {
  const d = new ImpressionDedupe();
  assert.equal(d.shouldSend('p1', 'call', 'card'), true);
  assert.equal(d.shouldSend('p1', 'call', 'card'), true);
  assert.ok(PARTNER_EVENTS.includes('offer'));
});

test('session key is 16 base-36 characters', () => {
  assert.match(newSessionKey(), /^[0-9a-z]{16}$/);
  assert.equal(newSessionKey(() => 0), '0000000000000000');
});

test('events placement: listed, and its impressions dedupe separately from pins', () => {
  assert.ok(PARTNER_PLACEMENTS.includes('events'));
  const d = new ImpressionDedupe();
  assert.equal(d.shouldSend('p1', 'impression', 'pin'), true);
  assert.equal(d.shouldSend('p1', 'impression', 'events'), true);
  assert.equal(d.shouldSend('p1', 'impression', 'events'), false);
  assert.equal(d.shouldSend('p1', 'route', 'events'), true);
});
