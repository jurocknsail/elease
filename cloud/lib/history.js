'use strict';

/*
 * Lease history, for the statistics screen. Pure functions: given a lease before and after a save
 * (as leases.leaseFromParse returns them), the rows to append to the two history classes.
 *
 * Backward compatible by construction: nothing in `Lease` or `Leaseholder` is read differently or
 * written. The rows go to two NEW classes, append-only, written by the server (master key) from an
 * afterSave trigger, so a send or an edit made from the legacy app is recorded too.
 *
 *  RentCallLog  one rent call sent for one lease
 *    leaseId, leaseName, period ('YYYY-MM'), sentAt (ms), source ('app' | 'legacy' | 'baseline'),
 *    price, charge, tva, extras, total (amounts as they were when the call left)
 *  RentChange   one change of the amount billed for one lease
 *    leaseId, leaseName, at (ms), reason ('create' | 'edit' | 'revision' | 'baseline'),
 *    oldPrice, newPrice, oldTotal, newTotal, indexType, oldIndexQuarter, oldIndexValue,
 *    newIndexQuarter, newIndexValue (absent values are left out)
 */

const { computeTVA, computeTotalPrice, sumAmounts } = require('./amounts');
const { billingPeriod, periodKey } = require('./periods');

const SEND_CLASS = 'RentCallLog';
const CHANGE_CLASS = 'RentChange';
const PERIOD_KEY = /^\d{4}-\d{2}$/;

function amountsOf(lease) {
  return {
    price: lease.price,
    charge: lease.charge === null ? 0 : lease.charge,
    tva: computeTVA(lease),
    extras: sumAmounts(lease.additionalCharges.map((c) => c.amount)),
    total: computeTotalPrice(lease),
  };
}

function withoutUndefined(fields) {
  const result = {};
  Object.keys(fields).forEach((key) => {
    if (fields[key] !== undefined && fields[key] !== null) {
      result[key] = fields[key];
    }
  });
  return result;
}

/**
 * The period a send billed. The new app writes `lastSentPeriod` and `lastSentPeriodAt` in the same
 * save as `lastSendDate`; the legacy app only rewrites `lastSendDate`, whose billed period is the
 * month after it (Europe/Paris), as in send-status.js.
 */
function sentPeriod(lease) {
  const fromApp =
    typeof lease.lastSentPeriod === 'string' &&
    PERIOD_KEY.test(lease.lastSentPeriod) &&
    lease.lastSentPeriodAt === lease.lastSendDate;
  return fromApp
    ? { period: lease.lastSentPeriod, source: 'app' }
    : { period: periodKey(billingPeriod(lease.lastSendDate)), source: 'legacy' };
}

function sendRow(lease, source) {
  const sent = sentPeriod(lease);
  return Object.assign(
    {
      leaseId: lease.objectId,
      leaseName: lease.name,
      period: sent.period,
      sentAt: lease.lastSendDate,
      source: source || sent.source,
    },
    amountsOf(lease),
  );
}

function sameCharges(a, b) {
  return JSON.stringify(a.additionalCharges) === JSON.stringify(b.additionalCharges);
}

function amountChanged(before, after) {
  return (
    before.price !== after.price ||
    before.charge !== after.charge ||
    before.isPro !== after.isPro ||
    !sameCharges(before, after)
  );
}

function indexChanged(before, after) {
  return (
    before.referenceIndexQuarter !== after.referenceIndexQuarter ||
    before.referenceIndexValue !== after.referenceIndexValue
  );
}

function changeRow(before, after, reason, at) {
  return withoutUndefined({
    leaseId: after.objectId,
    leaseName: after.name,
    at,
    reason,
    oldPrice: before ? before.price : undefined,
    newPrice: after.price,
    oldTotal: before ? computeTotalPrice(before) : undefined,
    newTotal: computeTotalPrice(after),
    indexType: after.indexType,
    oldIndexQuarter: before ? before.referenceIndexQuarter : undefined,
    oldIndexValue: before ? before.referenceIndexValue : undefined,
    newIndexQuarter: after.referenceIndexQuarter,
    newIndexValue: after.referenceIndexValue,
  });
}

/**
 * The history rows of one save of a lease. `before` is null when the lease was just created.
 * Returns { sends: [fields], changes: [fields] }.
 *
 *  - A send: `lastSendDate` changed to a real date on an EXISTING lease (a lease created with a send
 *    date is a backup restore, not a send).
 *  - A change: creation, or a change of price, charge, additional charges or VAT. It is a 'revision'
 *    when the reference index changed in the same save (what « Appliquer la révision » writes).
 */
function historyRows(before, after, now) {
  const result = { sends: [], changes: [] };
  if (!after || typeof after.objectId !== 'string') {
    return result;
  }
  if (!before) {
    result.changes.push(changeRow(null, after, 'create', now));
    return result;
  }
  if (after.lastSendDate > 0 && after.lastSendDate !== before.lastSendDate) {
    result.sends.push(sendRow(after));
  }
  if (amountChanged(before, after)) {
    result.changes.push(
      changeRow(before, after, indexChanged(before, after) ? 'revision' : 'edit', now),
    );
  }
  return result;
}

/**
 * The starting point of a lease that has no history yet (backfill job): its current amounts as a
 * 'baseline' change, and its last send, if any, as a 'baseline' send.
 */
function baselineRows(lease, now, has) {
  const result = { sends: [], changes: [] };
  if (!has.change) {
    result.changes.push(changeRow(null, lease, 'baseline', now));
  }
  if (!has.send && lease.lastSendDate > 0) {
    result.sends.push(sendRow(lease, 'baseline'));
  }
  return result;
}

module.exports = { SEND_CLASS, CHANGE_CLASS, historyRows, baselineRows, sentPeriod };
