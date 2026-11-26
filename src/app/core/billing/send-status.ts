import { Lease } from '../models/lease';
import { BillingPeriod, periodKey } from './period';

export type LeaseStatus = 'sent' | 'todo';

const PERIOD_KEY = /^\d{4}-\d{2}$/;

function previousMonth(p: BillingPeriod): BillingPeriod {
  return p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
}

/** True when the lease's `lastSendDate` (local time) falls in the calendar month before `p`. */
function sentInMonthBefore(lease: Lease, p: BillingPeriod): boolean {
  if (!(lease.lastSendDate > 0)) {
    return false;
  }
  const sentOn = new Date(lease.lastSendDate);
  const before = previousMonth(p);
  return sentOn.getFullYear() === before.year && sentOn.getMonth() + 1 === before.month;
}

/**
 * Whether the rent call of period `p` has already been sent for this lease.
 *
 * The status follows the BILLED period, not the send date: calls leave around the 25th of month M
 * for period M+1 (a `lastSendDate` of 25 Oct 2026 means the November call went out).
 *
 * A lease is sent for `p` when any of these holds:
 *  1. `lastSentPeriod === periodKey(p)`: the new app recorded that very period.
 *  2. `lastSentPeriod` is a LATER period: only the latest send is recorded, so a later period means
 *     the calls were sent ahead (February then March on 26 Jan leaves '2027-03'; February must not
 *     read "to do" again). Only an ascending send order can be recognised this way.
 *  3. Date fallback: `lastSendDate` falls in the calendar month that PRECEDES `p`, unless the new
 *     app itself wrote that `lastSendDate`.
 *
 * Why the date fallback exists at all (and why it is conditional). The legacy app is still in use and
 * its send only rewrites `lastSendDate`, never `lastSentPeriod`. After a legacy send for December
 * on 25 Nov, a stale `lastSentPeriod` ('2026-11') would show December as "À envoyer" again and invite
 * a DOUBLE SEND to a real tenant: the fallback must therefore apply even when `lastSentPeriod` is
 * present (scenario S5).
 *
 * But the fallback is wrong after a LATE send from the new app. The January call sent on 3 Jan 2027
 * records `lastSentPeriod = '2027-01'` and `lastSendDate = 3 Jan`; judged on the date alone, February
 * would read "sent" (3 Jan is in the month before February) and February's call would be silently
 * skipped (scenarios S2, correction re-send S3). Stored data alone cannot tell that apart from S5,
 * hence `lastSentPeriodAt`: the new app writes it, in the same save as `lastSentPeriod`, equal to the
 * `lastSendDate` it writes. While `lastSentPeriodAt === lastSendDate` the date is the new app's own
 * and rule 1 is authoritative, so the fallback is blocked. A legacy send changes `lastSendDate` but
 * not `lastSentPeriodAt`, which re-enables the fallback (S5). Without `lastSentPeriod` or without
 * `lastSentPeriodAt` (leases never sent by the new app, or written by something else) the fallback
 * always applies.
 *
 * A `lastSendDate` in the same month as `p` (or later) does not count, and neither does 0 (never).
 * January looks back to December of the previous year.
 *
 * SUNSET: the date fallback (rule 3) and `lastSentPeriodAt` exist only for leases sent from the
 * legacy app. Once the legacy app is retired, rule 3 can be removed and the status can rest on
 * `lastSentPeriod` alone.
 */
export function isSentForPeriod(lease: Lease, p: BillingPeriod): boolean {
  const key = periodKey(p);
  const { lastSentPeriod } = lease;

  if (lastSentPeriod === key) {
    return true;
  }
  // Keys are 'YYYY-MM': lexicographic order is chronological order.
  if (lastSentPeriod !== undefined && PERIOD_KEY.test(lastSentPeriod) && lastSentPeriod > key) {
    return true;
  }

  const dateIsFromNewApp =
    lastSentPeriod !== undefined &&
    lease.lastSentPeriodAt !== undefined &&
    lease.lastSentPeriodAt === lease.lastSendDate;
  return !dateIsFromNewApp && sentInMonthBefore(lease, p);
}

export function leaseStatus(lease: Lease, p: BillingPeriod): LeaseStatus {
  return isSentForPeriod(lease, p) ? 'sent' : 'todo';
}
