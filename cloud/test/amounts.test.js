'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeTVA, computeTotalPrice, toCents, sumAmounts } = require('../lib/amounts');
const { lease } = require('./helpers');

test('computeTVA is 20 % of the rent, unrounded', () => {
  assert.equal(computeTVA(lease({ price: 500 })), 100);
  assert.equal(computeTVA(lease({ price: 333.33 })), 333.33 * 0.2);
});

test('a professional lease adds the VAT on the rent alone, then charges and extras', () => {
  const l = lease({
    isPro: true,
    price: 1234,
    charge: 123,
    additionalCharges: [{ title: 'Parking', amount: 50 }],
  });
  assert.ok(Math.abs(computeTotalPrice(l) - 1653.8) < 1e-9);
});

test('a residential lease bills the rent as is', () => {
  assert.equal(computeTotalPrice(lease({ isPro: false, price: 300 })), 300);
  assert.equal(computeTotalPrice(lease({ isPro: false, price: 300, charge: 0 })), 300);
  assert.equal(computeTotalPrice(lease({ isPro: false, price: 300, charge: 20 })), 320);
});

test('toCents rounds like toFixed(2), never returns -0 and ignores non-finite amounts', () => {
  assert.equal(toCents(1309.296), 130930);
  assert.equal(toCents(1091.08), 109108);
  assert.equal(toCents(0.005), 1);
  assert.equal(toCents(NaN), 0);
  assert.equal(toCents(Infinity), 0);
  assert.ok(!Object.is(toCents(-0.001), -0));
});

test('three professional leases at 1091.08 total 3 927,90 (cents added, not raw floats)', () => {
  const totals = [1, 2, 3].map(() => computeTotalPrice(lease({ isPro: true, price: 1091.08 })));
  assert.equal(toCents(totals[0]), 130930);
  assert.equal(sumAmounts(totals), 3927.9);
  // The raw float sum would give 3927.888, i.e. 3927.89 once printed.
  assert.equal(Number((totals[0] + totals[1] + totals[2]).toFixed(2)), 3927.89);
});

test('sumAmounts of nothing is 0', () => {
  assert.equal(sumAmounts([]), 0);
});
