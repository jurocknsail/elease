import { Lease } from '../models/lease';
import { BillingPeriod, periodKey } from './period';

export type LeaseStatus = 'sent' | 'todo';

function previousMonth(p: BillingPeriod): BillingPeriod {
  return p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
}

/**
 * Whether the rent call of period `p` has already been sent for this lease.
 *
 * The status follows the BILLED period, not the send date: calls leave around the 25th of month M
 * for period M+1 (a `lastSendDate` of 25 Oct 2026 means the November call went out).
 *
 * A lease is sent for `p` when either
 *  - `lastSentPeriod === periodKey(p)` (written by the new app at send time), or
 *  - `lastSendDate` (local time) falls in the calendar month that PRECEDES `p`.
 *
 * The second rule is applied even when `lastSentPeriod` is present but different. This is a
 * deliberate, safe-side deviation from "fall back on lastSendDate only when lastSentPeriod is
 * absent": the legacy app is still in use and its send only writes `lastSendDate`, never
 * `lastSentPeriod`. After a legacy send for December, a stale `lastSentPeriod` ('2026-11') would
 * otherwise show the lease as "À envoyer" again and invite a double send to a real tenant. The rule
 * therefore errs toward "sent".
 *
 * A `lastSendDate` in the same month as `p` (or later) does not count, and neither does 0 (never).
 * January looks back to December of the previous year.
 */
export function isSentForPeriod(lease: Lease, p: BillingPeriod): boolean {
  if (lease.lastSentPeriod === periodKey(p)) {
    return true;
  }
  if (!(lease.lastSendDate > 0)) {
    return false;
  }

  const sentOn = new Date(lease.lastSendDate);
  const before = previousMonth(p);
  return sentOn.getFullYear() === before.year && sentOn.getMonth() + 1 === before.month;
}

export function leaseStatus(lease: Lease, p: BillingPeriod): LeaseStatus {
  return isSentForPeriod(lease, p) ? 'sent' : 'todo';
}
