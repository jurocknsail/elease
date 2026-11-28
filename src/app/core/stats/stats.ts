import { computeTotalPrice, sumAmounts } from '../billing/amounts';
import { BillingPeriod, billingPeriod, defaultCallDate, periodKey } from '../billing/period';
import { isSentForPeriod } from '../billing/send-status';
import { RentCallLog, RentChange } from '../models/history';
import { Leaseholder } from '../models/leaseholder';

/** Figures of the statistics screen. Pure: the page passes the data and the day. */

const SHORT_MONTH = new Intl.DateTimeFormat('fr-FR', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
const MONTH_ONLY = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });

/** « janv. », for the axis of a chart. */
export function monthOnlyLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return MONTH_ONLY.format(new Date(Date.UTC(year, month - 1, 1)));
}

/** « janv. 27 ». */
export function shortPeriodLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return SHORT_MONTH.format(new Date(Date.UTC(year, month - 1, 1)));
}

function shiftPeriod(p: BillingPeriod, months: number): BillingPeriod {
  const index = p.year * 12 + (p.month - 1) + months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The period of the next rent calls on `today` (calls of the 25th bill the month after). */
export function currentPeriod(today: Date): BillingPeriod {
  return billingPeriod(defaultCallDate(today));
}

export interface PortfolioSummary {
  leaseCount: number;
  /** Sum of the totals billed each month, at today's amounts. */
  monthly: number;
  annual: number;
  period: BillingPeriod;
  sent: number;
  todo: number;
}

export function portfolioSummary(holders: readonly Leaseholder[], today: Date): PortfolioSummary {
  const leases = holders.flatMap((h) => h.leases);
  const period = currentPeriod(today);
  const monthly = sumAmounts(leases.map(computeTotalPrice));
  const sent = leases.filter((lease) => isSentForPeriod(lease, period)).length;
  return {
    leaseCount: leases.length,
    monthly,
    annual: sumAmounts([monthly * 12]),
    period,
    sent,
    todo: leases.length - sent,
  };
}

/** The last send of each lease for each period (a correction re-send replaces the first one). */
function latestPerLeaseAndPeriod(sends: readonly RentCallLog[]): RentCallLog[] {
  const latest = new Map<string, RentCallLog>();
  for (const send of sends) {
    const key = `${send.leaseId}|${send.period}`;
    const known = latest.get(key);
    if (!known || send.sentAt >= known.sentAt) {
      latest.set(key, send);
    }
  }
  return [...latest.values()];
}

export interface MonthBar {
  period: string;
  label: string;
  /** Month only, for the axis. */
  short: string;
  total: number;
  count: number;
}

/** Amount called per billed period, over the `months` periods ending at `last` (empty months at 0). */
export function billedByMonth(
  sends: readonly RentCallLog[],
  last: BillingPeriod,
  months = 12,
): MonthBar[] {
  const rows = latestPerLeaseAndPeriod(sends);
  return Array.from({ length: months }, (_, i) => {
    const key = periodKey(shiftPeriod(last, i - months + 1));
    const ofPeriod = rows.filter((row) => row.period === key);
    return {
      period: key,
      label: shortPeriodLabel(key),
      short: monthOnlyLabel(key),
      total: sumAmounts(ofPeriod.map((row) => row.total)),
      count: ofPeriod.length,
    };
  });
}

export interface SendTiming {
  period: string;
  label: string;
  count: number;
  firstSentAt: number;
  lastSentAt: number;
  /** Every call left before the 1st of the billed month (the due date). */
  onTime: boolean;
}

/** When the calls of each period left, newest period first, at most `limit` periods. */
export function sendTimings(sends: readonly RentCallLog[], limit = 6): SendTiming[] {
  const byPeriod = new Map<string, RentCallLog[]>();
  for (const row of latestPerLeaseAndPeriod(sends)) {
    byPeriod.set(row.period, [...(byPeriod.get(row.period) ?? []), row]);
  }
  return [...byPeriod.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, limit)
    .map(([period, rows]) => {
      const times = rows.map((row) => row.sentAt);
      const [year, month] = period.split('-').map(Number);
      const due = new Date(year, month - 1, 1).getTime();
      const lastSentAt = Math.max(...times);
      return {
        period,
        label: shortPeriodLabel(period),
        count: rows.length,
        firstSentAt: Math.min(...times),
        lastSentAt,
        onTime: lastSentAt < due,
      };
    });
}

export interface IndexPoint {
  /** INSEE period, '2026-Q2'. */
  quarter: string;
  value: number;
}

/** The observations in time order. */
export function indexSeries(observations: ReadonlyMap<string, number>): IndexPoint[] {
  return [...observations.entries()]
    .filter(([quarter, value]) => /^\d{4}-Q[1-4]$/.test(quarter) && Number.isFinite(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([quarter, value]) => ({ quarter, value }));
}

/** Change of the last value over the same quarter a year before, in %, or null when unknown. */
export function yearOverYear(points: readonly IndexPoint[]): number | null {
  const last = points.at(-1);
  if (!last) {
    return null;
  }
  const [year, q] = last.quarter.split('-');
  const before = points.find((p) => p.quarter === `${Number(year) - 1}-${q}`);
  return before ? ((last.value - before.value) / before.value) * 100 : null;
}

/** « T2 2026 » from '2026-Q2'. */
export function inseeQuarterLabel(quarter: string): string {
  const [year, q] = quarter.split('-Q');
  return `T${q} ${year}`;
}

/** The rent changes worth showing (edits and revisions), newest first. */
export function recentRentChanges(changes: readonly RentChange[], limit = 8): RentChange[] {
  return changes
    .filter((c) => (c.reason === 'edit' || c.reason === 'revision') && c.oldTotal !== c.newTotal)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/** The day the history starts: the earliest row, or null when there is none yet. */
export function historyStart(
  sends: readonly RentCallLog[],
  changes: readonly RentChange[],
): number | null {
  const times = [
    ...sends.filter((s) => s.source !== 'baseline').map((s) => s.sentAt),
    ...changes.map((c) => c.at),
  ];
  return times.length ? Math.min(...times) : null;
}

/** Keeps only the lease `leaseId` (and the holder that has it): the page then shows that lease alone. */
export function onlyLease(holders: readonly Leaseholder[], leaseId: string): Leaseholder[] {
  return holders
    .map((h) => ({ ...h, leases: h.leases.filter((l) => l.objectId === leaseId) }))
    .filter((h) => h.leases.length > 0);
}

export interface LeaseRow {
  leaseId: string;
  leaseName: string;
  holderId?: string;
  holderName: string;
  monthly: number;
  annual: number;
  /** Share of the total called each month, 0-100. */
  share: number;
  /** Change of the monthly total since the first amount recorded, in %, or null when unknown. */
  evolution: number | null;
  lastSendDate: number;
  sendCount: number;
  /** Next anniversary (revision), ms, or null when the lease has none. */
  nextRevision: number | null;
}

/** One row per lease, highest monthly amount first. */
export function leaseRows(
  holders: readonly Leaseholder[],
  sends: readonly RentCallLog[],
  changes: readonly RentChange[],
  today: Date,
  anniversary: (renewalDate: number, today: Date) => Date,
): LeaseRow[] {
  const all = holders.flatMap((h) => h.leases.map((lease) => ({ holder: h, lease })));
  const grand = sumAmounts(all.map(({ lease }) => computeTotalPrice(lease)));
  return all
    .filter(({ lease }) => typeof lease.objectId === 'string')
    .map(({ holder, lease }) => {
      const id = lease.objectId as string;
      const monthly = computeTotalPrice(lease);
      const first = changes.filter((c) => c.leaseId === id).sort((a, b) => a.at - b.at)[0];
      const base = first ? (first.oldTotal ?? first.newTotal) : undefined;
      return {
        leaseId: id,
        leaseName: lease.name,
        holderId: holder.objectId,
        holderName: holder.name,
        monthly,
        annual: sumAmounts([monthly * 12]),
        share: grand > 0 ? (monthly / grand) * 100 : 0,
        evolution: base && base > 0 && base !== monthly ? ((monthly - base) / base) * 100 : null,
        lastSendDate: lease.lastSendDate,
        sendCount: latestPerLeaseAndPeriod(sends.filter((s) => s.leaseId === id)).length,
        nextRevision:
          lease.renewalDate != null && Number.isFinite(lease.renewalDate)
            ? anniversary(lease.renewalDate, today).getTime()
            : null,
      };
    })
    .sort((a, b) => b.monthly - a.monthly);
}
