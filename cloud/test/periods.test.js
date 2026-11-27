'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parisParts,
  billingPeriod,
  periodKey,
  periodLabel,
  daysInMonth,
  calendarDays,
  ymdToIso,
} = require('../lib/periods');
const { noon } = require('./helpers');

test('parisParts reads the calendar date in Europe/Paris, whatever the process time zone', () => {
  assert.deepEqual(parisParts(new Date('2027-01-15T12:00:00Z')), { year: 2027, month: 1, day: 15 });
  // 23:30 UTC on 31 January is 00:30 on 1 February in Paris (UTC+1).
  assert.deepEqual(parisParts(new Date('2027-01-31T23:30:00Z')), { year: 2027, month: 2, day: 1 });
  // Paris summer time (UTC+2): 22:00 UTC is already the next day.
  assert.deepEqual(parisParts(new Date('2026-06-30T22:00:00Z')), { year: 2026, month: 7, day: 1 });
  assert.deepEqual(parisParts(Date.parse('2026-12-31T22:59:59Z')), { year: 2026, month: 12, day: 31 });
  assert.deepEqual(parisParts(Date.parse('2026-12-31T23:00:00Z')), { year: 2027, month: 1, day: 1 });
});

test('parisParts refuses what is not an instant', () => {
  assert.equal(parisParts(NaN), null);
  assert.equal(parisParts(undefined), null);
  assert.equal(parisParts(null), null);
  assert.equal(parisParts('2027-01-01'), null);
  assert.equal(parisParts(new Date(NaN)), null);
  assert.equal(parisParts(1e300), null);
});

test('billingPeriod is the month after the call date, rolling December over to January', () => {
  assert.deepEqual(billingPeriod(noon(2026, 10, 25)), { year: 2026, month: 11 });
  assert.deepEqual(billingPeriod(noon(2026, 11, 25)), { year: 2026, month: 12 });
  assert.deepEqual(billingPeriod(noon(2026, 12, 25)), { year: 2027, month: 1 });
  assert.deepEqual(billingPeriod(noon(2027, 1, 31)), { year: 2027, month: 2 });
});

test('billingPeriod follows the Paris calendar at the month boundary', () => {
  // 2027-01-31T23:30:00Z is 1 February in Paris: the period is March, not February.
  assert.deepEqual(billingPeriod(new Date('2027-01-31T23:30:00Z')), { year: 2027, month: 3 });
  assert.deepEqual(billingPeriod(new Date('2027-01-31T22:30:00Z')), { year: 2027, month: 2 });
  // 31 December 23:30 UTC is 1 January in Paris.
  assert.deepEqual(billingPeriod(new Date('2026-12-31T23:30:00Z')), { year: 2027, month: 2 });
});

test('periodKey and periodLabel', () => {
  assert.equal(periodKey({ year: 2027, month: 1 }), '2027-01');
  assert.equal(periodKey({ year: 2026, month: 12 }), '2026-12');
  assert.equal(periodLabel({ year: 2027, month: 1 }), 'janvier 2027');
  assert.equal(periodLabel({ year: 2027, month: 2 }), 'février 2027');
  assert.equal(periodLabel({ year: 2026, month: 8 }), 'août 2026');
  assert.equal(periodLabel({ year: 2026, month: 12 }), 'décembre 2026');
});

test('daysInMonth, calendarDays and ymdToIso do plain calendar arithmetic', () => {
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 12), 31);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(calendarDays({ year: 2026, month: 1, day: 15 }, { year: 2026, month: 3, day: 1 }), 45);
  assert.equal(calendarDays({ year: 2026, month: 3, day: 1 }, { year: 2026, month: 3, day: 1 }), 0);
  assert.equal(calendarDays({ year: 2026, month: 12, day: 31 }, { year: 2027, month: 1, day: 1 }), 1);
  assert.equal(ymdToIso({ year: 2027, month: 3, day: 5 }), '2027-03-05');
});
