'use strict';

/*
 * Billing periods and calendar dates, ported from src/app/core/billing/period.ts.
 *
 * Back4App cloud code runs in UTC, the owner lives in Europe/Paris. Every epoch is therefore turned into
 * a calendar date (year, month, day) in Europe/Paris with Intl, and all arithmetic is done on those integers.
 * Never call getMonth() / getFullYear() / getDate() on an epoch in this folder: they read the process
 * time zone (UTC on Back4App, anything on a developer machine).
 *
 * A calendar date is the plain object { year, month, day }, month 1-12.
 */

const TIME_ZONE = 'Europe/Paris';

const MONTHS_FR = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];

const PARIS = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * The calendar date, in Europe/Paris, of an instant (a Date or an epoch in milliseconds).
 * Returns null when it is not a usable instant.
 */
function parisParts(instant) {
  const t = instant instanceof Date ? instant.getTime() : instant;
  if (typeof t !== 'number' || !Number.isFinite(t) || Math.abs(t) > 8.64e15) {
    return null;
  }
  const result = { year: NaN, month: NaN, day: NaN };
  PARIS.formatToParts(new Date(t)).forEach((part) => {
    if (part.type === 'year' || part.type === 'month' || part.type === 'day') {
      result[part.type] = Number(part.value);
    }
  });
  return Number.isFinite(result.year) && Number.isFinite(result.month) && Number.isFinite(result.day)
    ? result
    : null;
}

/** Number of days of a month (28 to 31, leap years included); month is 1-12. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Calendar days from date `from` to date `to` (0 = same day), no time zone involved. */
function calendarDays(from, to) {
  const a = Date.UTC(from.year, from.month - 1, from.day);
  const b = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((b - a) / 86400000);
}

/** Sortable number of a calendar date, e.g. 20270131. */
function ymdNumber(d) {
  return d.year * 10000 + d.month * 100 + d.day;
}

/** 'YYYY-MM-DD'. */
function ymdToIso(d) {
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

/** The period billed by a call sent on `callDate`: the month AFTER it (December rolls over to January). */
function billingPeriod(callDate) {
  const p = parisParts(callDate);
  if (!p) {
    throw new RangeError('Date invalide');
  }
  return p.month === 12 ? { year: p.year + 1, month: 1 } : { year: p.year, month: p.month + 1 };
}

/** Sortable and storable form, e.g. '2027-01' (the `lastSentPeriod` field). */
function periodKey(p) {
  return `${p.year}-${pad2(p.month)}`;
}

/** Human label, e.g. 'janvier 2027'. */
function periodLabel(p) {
  return `${MONTHS_FR[p.month - 1]} ${p.year}`;
}

module.exports = {
  TIME_ZONE,
  MONTHS_FR,
  parisParts,
  daysInMonth,
  calendarDays,
  ymdNumber,
  ymdToIso,
  billingPeriod,
  periodKey,
  periodLabel,
};
