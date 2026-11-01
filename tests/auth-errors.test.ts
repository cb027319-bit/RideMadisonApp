/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { friendlyAuthError, resendSecondsLeft } from '../src/lib/auth-errors';

test('rewrites the Supabase 60-second message', () => {
  const raw = 'For security purposes, you can only request this after 60 seconds.';
  assert.equal(friendlyAuthError(raw, 'email'), 'Please wait a minute before asking for another code.');
  assert.equal(friendlyAuthError('Email rate limit exceeded', 'email'), 'Please wait a minute before asking for another code.');
});

test('code step and email step get different messages', () => {
  assert.equal(friendlyAuthError('Token has expired or is invalid', 'code'), 'That code is wrong or expired. Check it, or send a new code.');
  assert.equal(
    friendlyAuthError('Unable to validate email address: invalid format', 'email'),
    'That email address doesn’t look right. Please check it.',
  );
});

test('never shows raw server text', () => {
  const raw = 'duplicate key value violates unique constraint "profiles_pkey"';
  for (const step of ['email', 'code', 'oauth', 'profile', 'delete'] as const) {
    const msg = friendlyAuthError(raw, step);
    assert.ok(!msg.includes('constraint'), `${step}: ${msg}`);
  }
  assert.equal(friendlyAuthError('TypeError: Network request failed', 'delete'), 'No connection. Check your signal and try again.');
  assert.equal(friendlyAuthError(undefined, 'oauth'), 'Sign-in didn’t finish. Please try again.');
});

test('resend cooldown counts down from 30 s', () => {
  assert.equal(resendSecondsLeft(null, 1000), 0);
  assert.equal(resendSecondsLeft(0, 0), 30);
  assert.equal(resendSecondsLeft(0, 100), 30);
  assert.equal(resendSecondsLeft(0, 29_001), 1);
  assert.equal(resendSecondsLeft(0, 30_000), 0);
  assert.equal(resendSecondsLeft(0, 90_000), 0);
});

test('password sign-in errors are plain and specific', () => {
  assert.match(friendlyAuthError('Invalid login credentials', 'signin'), /don’t match/);
  assert.match(friendlyAuthError('User already registered', 'signup'), /already have an account/);
  assert.match(friendlyAuthError('Password should be at least 6 characters', 'signup'), /at least 8 characters/);
  assert.match(friendlyAuthError('Email not confirmed', 'signin'), /confirmation is still turned on/);
});
