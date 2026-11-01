/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EN, ES } from '../src/locales';

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every English string has a Spanish translation with the same {variables}', () => {
  for (const [k, en] of Object.entries(EN)) {
    const es = (ES as Record<string, string>)[k];
    assert.ok(typeof es === 'string' && es.trim().length > 0, `missing Spanish for ${k}`);
    assert.equal(vars(es), vars(en), `variables differ for ${k}`);
  }
});

test('keys are namespaced', () => {
  for (const k of Object.keys(EN)) assert.match(k, /^[a-z]+\.[A-Za-z0-9_.]+$/, k);
});
