'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSentForPeriod } = require('../lib/send-status');
const { noon, lease } = require('./helpers');

const NOV = { year: 2026, month: 11 };
const DEC = { year: 2026, month: 12 };
const JAN = { year: 2027, month: 1 };
const FEB = { year: 2027, month: 2 };
const MAR = { year: 2027, month: 3 };
const APR = { year: 2027, month: 4 };

const at = (y, m, d) => noon(y, m, d).getTime();

/** What the new app writes in one save: lastSentPeriod, lastSendDate and lastSentPeriodAt (equal). */
function sentByNewApp(period, sentAt) {
  return lease({ lastSentPeriod: period, lastSendDate: sentAt, lastSentPeriodAt: sentAt });
}

test('lastSentPeriod equal to the period, earlier or later (send-ahead)', () => {
  assert.equal(isSentForPeriod(lease({ lastSentPeriod: '2026-12' }), DEC), true);
  assert.equal(isSentForPeriod(lease({ lastSentPeriod: '2026-11' }), DEC), false);
  assert.equal(isSentForPeriod(lease({ lastSentPeriod: '2027-01' }), DEC), true);
  assert.equal(isSentForPeriod(lease({ lastSentPeriod: '2027-03' }), FEB), true);
  assert.equal(isSentForPeriod(lease({ lastSentPeriod: '2026-12' }), JAN), false);
});

test('a malformed lastSentPeriod is ignored', () => {
  assert.equal(isSentForPeriod(lease({ lastSentPeriod: 'oops' }), DEC), false);
  assert.equal(isSentForPeriod(lease({ lastSentPeriod: '' }), DEC), false);
  assert.equal(isSentForPeriod(lease({ lastSentPeriod: '2027-1' }), DEC), false);
});

test('legacy fallback: lastSendDate in the month before the period', () => {
  const l = lease({ lastSendDate: at(2026, 10, 25) });
  assert.equal(isSentForPeriod(l, NOV), true);
  assert.equal(isSentForPeriod(l, DEC), false);
  assert.equal(isSentForPeriod(lease({ lastSendDate: 0 }), DEC), false);
  assert.equal(isSentForPeriod(lease({ lastSendDate: at(2027, 1, 25) }), JAN), false);
  assert.equal(isSentForPeriod(lease({ lastSendDate: at(2027, 3, 25) }), DEC), false);
  assert.equal(isSentForPeriod(lease({ lastSendDate: at(2026, 12, 25) }), JAN), true);
  assert.equal(isSentForPeriod(lease({ lastSendDate: -1 }), DEC), false);
  assert.equal(isSentForPeriod(lease({ lastSendDate: NaN }), DEC), false);
});

test('the fallback reads lastSendDate in Paris time: 2027-01-31T23:30:00Z is February 1st', () => {
  // Sent at 00:30 on 1 February in Paris: the month before March, not before February.
  const l = lease({ lastSendDate: Date.parse('2027-01-31T23:30:00Z') });
  assert.equal(isSentForPeriod(l, FEB), false);
  assert.equal(isSentForPeriod(l, MAR), true);
  // Sent at 23:30 Paris time on 31 January (22:30Z): the month before February.
  const early = lease({ lastSendDate: Date.parse('2027-01-31T22:30:00Z') });
  assert.equal(isSentForPeriod(early, FEB), true);
  assert.equal(isSentForPeriod(early, MAR), false);
});

test('stale lastSentPeriod after a legacy send does not invite a double send', () => {
  const l = lease({ lastSentPeriod: '2026-11', lastSendDate: at(2026, 11, 25) });
  assert.equal(isSentForPeriod(l, DEC), true);
  assert.equal(isSentForPeriod(l, NOV), true);
  assert.equal(isSentForPeriod(l, JAN), false);
});

test('S1 on-time send', () => {
  const l = sentByNewApp('2027-01', at(2026, 12, 25));
  assert.equal(isSentForPeriod(l, JAN), true);
  assert.equal(isSentForPeriod(l, FEB), false);
});

test('S2 late send does not hide February', () => {
  const l = sentByNewApp('2027-01', at(2027, 1, 3));
  assert.equal(isSentForPeriod(l, JAN), true);
  assert.equal(isSentForPeriod(l, FEB), false);
});

test('S3 correction re-send does not hide February', () => {
  const l = sentByNewApp('2027-01', at(2027, 1, 12));
  assert.equal(isSentForPeriod(l, JAN), true);
  assert.equal(isSentForPeriod(l, FEB), false);
});

test('S4 early send', () => {
  const l = sentByNewApp('2027-02', at(2027, 1, 5));
  assert.equal(isSentForPeriod(l, FEB), true);
  assert.equal(isSentForPeriod(l, MAR), false);
});

test('S5 legacy send after a new-app send', () => {
  const l = lease({
    lastSentPeriod: '2026-11',
    lastSentPeriodAt: at(2026, 10, 25),
    lastSendDate: at(2026, 11, 25),
  });
  assert.equal(isSentForPeriod(l, NOV), true);
  assert.equal(isSentForPeriod(l, DEC), true);
  assert.equal(isSentForPeriod(l, JAN), false);
});

test('S6 send-ahead', () => {
  const l = sentByNewApp('2027-03', at(2027, 1, 26));
  assert.equal(isSentForPeriod(l, FEB), true);
  assert.equal(isSentForPeriod(l, MAR), true);
  assert.equal(isSentForPeriod(l, APR), false);
});

test('lastSentPeriod without lastSentPeriodAt falls back on the date rule', () => {
  const l = lease({ lastSentPeriod: '2027-01', lastSendDate: at(2027, 1, 3) });
  assert.equal(isSentForPeriod(l, JAN), true);
  assert.equal(isSentForPeriod(l, FEB), true);
});
