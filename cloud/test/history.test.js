'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { historyRows, baselineRows, sentPeriod } = require('../lib/history');
const { lease, noon } = require('./helpers');

const NOW = 1_800_000_000_000;

test('a lease created writes one « create » change and no send', () => {
  const rows = historyRows(null, lease({ price: 800, lastSendDate: noon(2026, 11, 25).getTime() }), NOW);
  assert.equal(rows.sends.length, 0);
  assert.equal(rows.changes.length, 1);
  assert.equal(rows.changes[0].reason, 'create');
  assert.equal(rows.changes[0].newPrice, 800);
  assert.equal(rows.changes[0].newTotal, 800);
  assert.equal(rows.changes[0].oldPrice, undefined);
});

test('a send from the new app records its own period and the amounts of that day', () => {
  const at = noon(2026, 12, 3).getTime();
  const before = lease({ isPro: true, price: 1000, charge: 50, additionalCharges: [{ title: 'Parking', amount: 30 }] });
  const after = Object.assign({}, before, { lastSendDate: at, lastSentPeriod: '2026-12', lastSentPeriodAt: at });
  const rows = historyRows(before, after, NOW);
  assert.equal(rows.changes.length, 0);
  assert.deepEqual(rows.sends, [
    {
      leaseId: 'lease1',
      leaseName: 'Bail test',
      period: '2026-12',
      sentAt: at,
      source: 'app',
      price: 1000,
      charge: 50,
      tva: 200,
      extras: 30,
      total: 1280,
    },
  ]);
});

test('a legacy send (only lastSendDate) bills the month after the send date', () => {
  const at = noon(2026, 12, 25).getTime();
  const before = lease({ lastSentPeriod: '2026-12', lastSentPeriodAt: 1, lastSendDate: 1 });
  const after = Object.assign({}, before, { lastSendDate: at });
  const rows = historyRows(before, after, NOW);
  assert.equal(rows.sends[0].period, '2027-01');
  assert.equal(rows.sends[0].source, 'legacy');
  assert.deepEqual(sentPeriod(after), { period: '2027-01', source: 'legacy' });
});

test('a save that changes nothing billed writes nothing', () => {
  const before = lease({ renewalDate: 1 });
  const after = Object.assign({}, before, { name: 'Autre nom', renewalDate: 2, revisionReminderSentFor: '2027-01-01' });
  assert.deepEqual(historyRows(before, after, NOW), { sends: [], changes: [] });
});

test('a price change with a new reference index is a revision', () => {
  const before = lease({ price: 1000, indexType: 'ILAT', referenceIndexQuarter: '2025-T2', referenceIndexValue: 133.69 });
  const after = Object.assign({}, before, { price: 1032.3, referenceIndexQuarter: '2026-T2', referenceIndexValue: 138.01 });
  const [change] = historyRows(before, after, NOW).changes;
  assert.equal(change.reason, 'revision');
  assert.equal(change.oldPrice, 1000);
  assert.equal(change.newPrice, 1032.3);
  assert.equal(change.oldIndexValue, 133.69);
  assert.equal(change.newIndexQuarter, '2026-T2');
  assert.equal(change.at, NOW);
});

test('a charge edit is an « edit » with old and new totals', () => {
  const before = lease({ price: 500 });
  const after = Object.assign({}, before, { additionalCharges: [{ title: 'Eau', amount: 20 }] });
  const [change] = historyRows(before, after, NOW).changes;
  assert.equal(change.reason, 'edit');
  assert.equal(change.oldTotal, 500);
  assert.equal(change.newTotal, 520);
});

test('baseline: current amounts and last send, only for what has no history yet', () => {
  const at = noon(2026, 11, 25).getTime();
  const l = lease({ price: 700, lastSendDate: at });
  const all = baselineRows(l, NOW, { send: false, change: false });
  assert.equal(all.changes[0].reason, 'baseline');
  assert.equal(all.sends[0].source, 'baseline');
  assert.equal(all.sends[0].period, '2026-12');
  assert.deepEqual(baselineRows(l, NOW, { send: true, change: true }), { sends: [], changes: [] });
  assert.equal(baselineRows(lease(), NOW, { send: false, change: true }).sends.length, 0);
});
