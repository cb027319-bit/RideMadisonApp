/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatClock, openStatus, parseOpeningHours } from '../src/lib/hours';

// Local-time dates. 2026-11-02 is a Monday.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, 2 + day, h, m);
const MON = 0, TUE = 1, FRI = 4, SAT = 5, SUN = 6;

test('formats clock times in plain words', () => {
  assert.equal(formatClock(11 * 60), '11 am');
  assert.equal(formatClock(22 * 60 + 30), '10:30 pm');
  assert.equal(formatClock(12 * 60), 'noon');
  assert.equal(formatClock(0), 'midnight');
  assert.equal(formatClock(1440), 'midnight');
  assert.equal(formatClock(26 * 60), '2 am');
});

test('weekday and weekend rules', () => {
  const h = 'Mo-Fr 11:00-22:00; Sa,Su 10:00-23:00';
  assert.deepEqual(openStatus(h, at(MON, 12)), { open: true, text: 'Open now · closes 10 pm' });
  assert.deepEqual(openStatus(h, at(MON, 9)), { open: false, text: 'Closed · opens 11 am' });
  assert.deepEqual(openStatus(h, at(FRI, 23)), { open: false, text: 'Closed · opens tomorrow 10 am' });
  assert.deepEqual(openStatus(h, at(SUN, 22, 15)), { open: true, text: 'Open now · closes 11 pm' });
});

test('24/7 and all-day', () => {
  assert.deepEqual(openStatus('24/7', at(TUE, 3)), { open: true, text: 'Open 24 hours' });
  assert.deepEqual(openStatus('Mo-Su 00:00-24:00', at(TUE, 3)), { open: true, text: 'Open 24 hours' });
});

test('off days and later rules override earlier ones', () => {
  const h = 'Mo-Su 07:00-15:00; Mo off';
  assert.deepEqual(openStatus(h, at(MON, 10)), { open: false, text: 'Closed · opens tomorrow 7 am' });
  assert.deepEqual(openStatus(h, at(TUE, 10)), { open: true, text: 'Open now · closes 3 pm' });
  // Only Monday listed: opens next week on Monday
  assert.deepEqual(openStatus('Mo 09:00-17:00', at(TUE, 10)), { open: false, text: 'Closed · opens Mon 9 am' });
});

test('hours that run past midnight', () => {
  const h = 'Mo-Th 16:00-00:00; Fr-Sa 16:00-02:00; Su off';
  assert.deepEqual(openStatus(h, at(SAT, 1)), { open: true, text: 'Open now · closes 2 am' }); // Friday night
  assert.deepEqual(openStatus(h, at(SAT, 23)), { open: true, text: 'Open now · closes 2 am' });
  assert.deepEqual(openStatus(h, at(SUN, 1, 30)), { open: true, text: 'Open now · closes 2 am' }); // Saturday night
  assert.deepEqual(openStatus(h, at(SUN, 12)), { open: false, text: 'Closed · opens tomorrow 4 pm' });
  assert.deepEqual(openStatus(h, at(MON, 20)), { open: true, text: 'Open now · closes midnight' });
});

test('split shifts, wrapping day ranges, loose spacing and additional rules', () => {
  const split = 'Mo-Fr 08:00-12:00,13:00-17:00';
  assert.deepEqual(openStatus(split, at(TUE, 12, 30)), { open: false, text: 'Closed · opens 1 pm' });
  assert.deepEqual(openStatus(split, at(TUE, 14)), { open: true, text: 'Open now · closes 5 pm' });
  assert.deepEqual(openStatus('Fr-Mo 10:00-14:00', at(SUN, 11))?.open, true);
  assert.deepEqual(openStatus('Fr-Mo 10:00-14:00', at(TUE, 11))?.text, 'Closed · opens Fri 10 am');
  assert.deepEqual(openStatus('mo-fr 9:00 - 17:00', at(MON, 10))?.text, 'Open now · closes 5 pm');
  assert.deepEqual(openStatus('Mo-Fr 10:00-18:00, Sa 10:00-14:00', at(SAT, 11))?.text, 'Open now · closes 2 pm');
  assert.deepEqual(openStatus('Mo-Fr 10:00–18:00; PH off', at(MON, 11))?.open, true);
});

test('closed everywhere and unparseable forms', () => {
  assert.deepEqual(openStatus('off', at(MON, 12)), { open: false, text: 'Closed' });
  assert.equal(openStatus('Apr-Oct: Mo-Su 10:00-20:00', at(MON, 12)), null);
  assert.equal(openStatus('sunrise-sunset', at(MON, 12)), null);
  assert.equal(openStatus('Mo-Fr 10:00+', at(MON, 12)), null);
  assert.equal(openStatus('"call ahead"', at(MON, 12)), null);
  assert.equal(openStatus('', at(MON, 12)), null);
  assert.equal(openStatus(undefined, at(MON, 12)), null);
  assert.equal(parseOpeningHours('PH off'), null);
});
