/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatPhone, isValidEmail, normalizePhone } from '../src/lib/contact';

test('normalizes US phone numbers to E.164', () => {
  assert.equal(normalizePhone('(608) 555-0123'), '+16085550123');
  assert.equal(normalizePhone('1-608-555-0123'), '+16085550123');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('555-0123'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(formatPhone('+16085550123'), '(608) 555-0123');
  assert.equal(formatPhone(null), '');
});

test('checks email shape', () => {
  assert.ok(isValidEmail('rider@example.com'));
  assert.ok(!isValidEmail('rider@example'));
  assert.ok(!isValidEmail('no at sign'));
});
