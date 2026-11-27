'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatEuro, formatIndex, formatDate, formatYmd, quarterLabel } = require('../lib/format');

test('amounts: U+00A0 as thousands separator and before the euro sign, comma for cents', () => {
  assert.equal(formatEuro(1900), '1 900 €');
  assert.equal(formatEuro(1900.5), '1 900,50 €');
  assert.equal(formatEuro(3927.9), '3 927,90 €');
  assert.equal(formatEuro(1091.08), '1 091,08 €');
  assert.equal(formatEuro(300), '300 €');
  assert.equal(formatEuro(0.05), '0,05 €');
  assert.equal(formatEuro(0), '0 €');
  assert.equal(formatEuro(1234567.89), '1 234 567,89 €');
  assert.equal(formatEuro(-5), '-5 €');
  assert.equal(formatEuro(NaN), '–');
});

test('amounts never contain U+202F nor a plain space between digits and the euro sign', () => {
  [1, 999.99, 1000, 12345.67, 1309.296].forEach((n) => {
    const s = formatEuro(n);
    assert.ok(!s.includes(' '), s);
    assert.ok(!/ /.test(s), s);
    assert.ok(s.endsWith(' €'), s);
  });
});

test('amounts are rounded like the PDF (toFixed(2))', () => {
  assert.equal(formatEuro(1309.296), '1 309,30 €');
  assert.equal(formatEuro(1113.355), '1 113,36 €');
});

test('index values show two decimals with a comma', () => {
  assert.equal(formatIndex(136.42), '136,42');
  assert.equal(formatIndex(133.7), '133,70');
  assert.equal(formatIndex(138), '138,00');
});

test('dates are dd/MM/yyyy, in Europe/Paris for an instant', () => {
  assert.equal(formatYmd({ year: 2026, month: 3, day: 1 }), '01/03/2026');
  assert.equal(formatDate({ year: 2026, month: 12, day: 25 }), '25/12/2026');
  assert.equal(formatDate(new Date('2027-01-31T23:30:00Z')), '01/02/2027');
  assert.equal(formatDate(Date.parse('2027-01-31T22:30:00Z')), '31/01/2027');
  assert.throws(() => formatDate(NaN), RangeError);
});

test('quarter labels', () => {
  assert.equal(quarterLabel('2026-T2'), 'T2 2026');
});
