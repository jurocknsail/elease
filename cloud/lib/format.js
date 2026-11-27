'use strict';

const { parisParts } = require('./periods');
const { toCents } = require('./amounts');

/*
 * French formatting for the e-mails. Written by hand, with no dependency on Intl: Back4App's Node may not
 * ship the fr locale, and Intl would put a narrow no-break space (U+202F) between thousands. Amounts use
 * U+00A0 only (thousands separator and before the euro sign), so that they never wrap and render the same
 * in every mail client.
 */

const NBSP = ' ';
const NO_AMOUNT = '–';

/** '1 900 €' (whole) or '1 900,50 €' (with cents; never '1 900,00 €'); a non-finite value shows an en dash. */
function formatEuro(n) {
  if (!Number.isFinite(n)) {
    return NO_AMOUNT;
  }
  const cents = toCents(n);
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const fraction = abs % 100;
  const sign = cents < 0 ? '-' : '';
  const decimals = fraction === 0 ? '' : ',' + String(fraction).padStart(2, '0');
  return `${sign}${whole}${decimals}${NBSP}€`;
}

/** An index value with two decimals and a decimal comma: 136.42 -> '136,42'. */
function formatIndex(value) {
  return value.toFixed(2).replace('.', ',');
}

/** 'dd/MM/yyyy' from a calendar date { year, month, day }. */
function formatYmd(d) {
  return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${d.year}`;
}

/** 'dd/MM/yyyy' in Europe/Paris from a calendar date, a Date or an epoch. */
function formatDate(value) {
  const ymd =
    value !== null && typeof value === 'object' && !(value instanceof Date) ? value : parisParts(value);
  if (!ymd) {
    throw new RangeError('Date invalide');
  }
  return formatYmd(ymd);
}

/** '2026-T2' -> 'T2 2026'. */
function quarterLabel(quarter) {
  const match = /^(\d{4})-T([1-4])$/.exec(quarter);
  return match ? `T${match[2]} ${match[1]}` : quarter;
}

module.exports = { NBSP, formatEuro, formatIndex, formatYmd, formatDate, quarterLabel };
