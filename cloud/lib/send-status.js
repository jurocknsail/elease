'use strict';

const { parisParts, periodKey } = require('./periods');

/*
 * Whether the rent call of a period was already sent for a lease: port (rule A2) of
 * src/app/core/billing/send-status.ts. See that file for the full rationale of the three rules and the
 * scenarios S1 to S6. The only difference: the `lastSendDate` epoch is read as a calendar date in
 * Europe/Paris (the process runs in UTC), not in the process time zone.
 *
 * `lease` is a lease as returned by leases.leaseFromParse.
 */

const PERIOD_KEY = /^\d{4}-\d{2}$/;

function previousMonth(p) {
  return p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
}

/** True when the lease's `lastSendDate` (Paris calendar) falls in the calendar month before `p`. */
function sentInMonthBefore(lease, p) {
  const t = lease.lastSendDate;
  if (!(typeof t === 'number' && t > 0)) {
    return false;
  }
  const sentOn = parisParts(t);
  if (!sentOn) {
    return false;
  }
  const before = previousMonth(p);
  return sentOn.year === before.year && sentOn.month === before.month;
}

/**
 * Sent for `p` when any of these holds:
 *  1. `lastSentPeriod === periodKey(p)`;
 *  2. `lastSentPeriod` is a LATER period (calls sent ahead);
 *  3. date fallback: `lastSendDate` is in the month preceding `p`, unless the new app itself wrote that
 *     date (`lastSentPeriodAt === lastSendDate`, with a `lastSentPeriod`): then rule 1 is authoritative.
 */
function isSentForPeriod(lease, p) {
  const key = periodKey(p);
  const lastSentPeriod = lease.lastSentPeriod;

  if (lastSentPeriod === key) {
    return true;
  }
  // Keys are 'YYYY-MM': lexicographic order is chronological order.
  if (typeof lastSentPeriod === 'string' && PERIOD_KEY.test(lastSentPeriod) && lastSentPeriod > key) {
    return true;
  }

  const dateIsFromNewApp =
    lastSentPeriod != null &&
    lease.lastSentPeriodAt != null &&
    lease.lastSentPeriodAt === lease.lastSendDate;
  return !dateIsFromNewApp && sentInMonthBefore(lease, p);
}

module.exports = { isSentForPeriod };
