/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { welcomeEmail } from '../supabase/functions/welcome-email/template';

test('welcome email is personal, bilingual and safe', () => {
  const en = welcomeEmail({ name: 'Christian Betancourt', lang: 'en' });
  assert.equal(en.subject, 'Welcome to the Ride Madison community, Christian!');
  assert.match(en.html, /Get rolling in 3 steps/);
  assert.match(en.text, /Lake Monona Loop/);
  const es = welcomeEmail({ name: null, lang: 'es' });
  assert.match(es.subject, /Bienvenido a la comunidad/);
  assert.match(es.html, /lang="es"/);
  const x = welcomeEmail({ name: '<script>' });
  assert.doesNotMatch(x.html, /<script>/);
});
