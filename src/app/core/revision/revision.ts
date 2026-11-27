import { IndexType, Lease } from '../models/lease';

/*
 * Annual rent revision: when to propose it, which index applies, what the new rent is. PURE and free of
 * any framework: no clock (`today` is always a parameter), no `Date.now()`, no locale. The cloud reminder
 * job (cloud/lib/revision.js) is a mechanical port of this file, with the same test values.
 *
 * Dates are LOCAL calendar dates. Everything is computed from year / month / day numbers, never from
 * millisecond differences, so a daylight-saving change cannot move a day count.
 */

/** The owner is reminded this many days before the anniversary. */
export const REMINDER_DAYS_BEFORE = 45;

/** INSEE BDM series: IRL (housing), ILC (shops and crafts), ILAT (offices and other activities). */
export const INSEE_SERIES: Record<IndexType, string> = {
  IRL: '001515333',
  ILC: '001532540',
  ILAT: '001617112',
};

export type RevisionState =
  | { kind: 'incomplete' }
  | { kind: 'none' }
  | {
      kind: 'upcoming';
      /** The anniversary in view: a local date, midnight. */
      anniversary: Date;
      /** Calendar days from today to the anniversary (0 = today). */
      days: number;
      /** Quarter of the index to apply, 'YYYY-Tn'. */
      targetQuarter: string;
      /** Its published value; absent while the index is not published (or not loaded). */
      newIndex?: number;
      proposedRent?: number;
      /** Probable publication date of the index; set while `newIndex` is absent. */
      publication?: Date;
    };

/** What applying a revision writes on the lease: nothing else is changed. */
export interface RevisionChanges {
  price: number;
  referenceIndexQuarter: string;
  referenceIndexValue: number;
  /** The next anniversary: one year after the one just handled. */
  renewalDate: number;
}

const QUARTER = /^(\d{4})-T([1-4])$/;
const MS_PER_DAY = 86_400_000;

function parseQuarter(quarter: string): { year: number; n: number } {
  const match = QUARTER.exec(quarter);
  if (!match) {
    throw new Error(`Trimestre invalide : ${quarter}`);
  }
  return { year: Number(match[1]), n: Number(match[2]) };
}

function isUsable(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** The same day and month in `year`; a 29 February becomes the 28th in a common year. */
function inYear(year: number, monthIndex: number, dayOfMonth: number): Date {
  return new Date(year, monthIndex, Math.min(dayOfMonth, daysInMonth(year, monthIndex)));
}

/** Calendar days from `from` to `to`, whatever their time of day (UTC day numbers, no DST). */
function calendarDays(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / MS_PER_DAY);
}

/**
 * The anniversary in view: `renewalDate` itself while it is today or later, else its day and month in
 * the first year where the date is today or later. A 29 February falls on the 28th in common years.
 * Returned as a local date at midnight.
 *
 * A date that is already past is rolled forward silently: an owner who did not apply the revision by
 * its anniversary gets no proposal for that missed date (the next one is a year away).
 */
export function nextAnniversary(renewalDate: number, today: Date): Date {
  const start = new Date(renewalDate);
  const month = start.getMonth();
  const dayOfMonth = start.getDate();
  const first = new Date(start.getFullYear(), month, dayOfMonth);
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (first.getTime() >= now.getTime()) {
    return first;
  }
  let candidate = inYear(now.getFullYear(), month, dayOfMonth);
  if (candidate.getTime() < now.getTime()) {
    candidate = inYear(now.getFullYear() + 1, month, dayOfMonth);
  }
  return candidate;
}

/** The same quarter one year later: '2025-T2' becomes '2026-T2'. */
export function targetQuarter(referenceQuarter: string): string {
  const { year, n } = parseQuarter(referenceQuarter);
  return `${year + 1}-T${n}`;
}

/** INSEE's name of a quarter: '2026-T2' becomes '2026-Q2'. */
export function toInseePeriod(quarter: string): string {
  const { year, n } = parseQuarter(quarter);
  return `${year}-Q${n}`;
}

/** The new rent, rounded to the cent: rent x new index / reference index. */
export function proposeRent(price: number, refValue: number, newValue: number): number {
  return Math.round(((price * newValue) / refValue) * 100) / 100;
}

/**
 * When INSEE probably publishes the index of quarter `quarter`. IRL: the 15th of the month after the
 * quarter end. ILC and ILAT: the last day of the 3rd month after the quarter end.
 */
export function probablePublication(type: IndexType, quarter: string): Date {
  const { year, n } = parseQuarter(quarter);
  // `n * 3` is the (0-based) month right after the quarter end; Date rolls over the year end.
  return type === 'IRL' ? new Date(year, n * 3, 15) : new Date(year, n * 3 + 3, 0);
}

/**
 * Where the revision of `lease` stands on `today`. `incomplete`: something needed is missing or unusable
 * (anniversary, index family, reference quarter and value, a positive rent). `upcoming`: the anniversary
 * is at most `REMINDER_DAYS_BEFORE` days away. `observations` maps INSEE periods ('2026-Q2') to values
 * (`undefined` while they are not known).
 */
export function revisionState(
  lease: Lease,
  today: Date,
  observations: ReadonlyMap<string, number> | undefined,
): RevisionState {
  const { renewalDate, indexType, referenceIndexQuarter, referenceIndexValue, price } = lease;
  if (
    renewalDate == null ||
    !Number.isFinite(renewalDate) ||
    indexType === undefined ||
    referenceIndexQuarter === undefined ||
    !QUARTER.test(referenceIndexQuarter) ||
    !isUsable(referenceIndexValue) ||
    !isUsable(price)
  ) {
    return { kind: 'incomplete' };
  }
  const anniversary = nextAnniversary(renewalDate, today);
  const days = calendarDays(today, anniversary);
  if (days > REMINDER_DAYS_BEFORE) {
    return { kind: 'none' };
  }
  const target = targetQuarter(referenceIndexQuarter);
  const published = observations?.get(toInseePeriod(target));
  if (!isUsable(published)) {
    return {
      kind: 'upcoming',
      anniversary,
      days,
      targetQuarter: target,
      publication: probablePublication(indexType, target),
    };
  }
  const proposedRent = proposeRent(price, referenceIndexValue, published);
  if (!Number.isFinite(proposedRent)) {
    return { kind: 'incomplete' };
  }
  return {
    kind: 'upcoming',
    anniversary,
    days,
    targetQuarter: target,
    newIndex: published,
    proposedRent,
  };
}

/**
 * The fields to write to apply the proposal of `state`, or null when there is none to apply (nothing to
 * revise, or the index is not published yet). The anniversary moves one year on (a 29 February becomes
 * the 28th), so that the revision just applied is not proposed again: the next one only shows up
 * `REMINDER_DAYS_BEFORE` days before that date.
 */
export function appliedRevision(state: RevisionState): RevisionChanges | null {
  if (
    state.kind !== 'upcoming' ||
    state.newIndex === undefined ||
    state.proposedRent === undefined
  ) {
    return null;
  }
  const { anniversary } = state;
  return {
    price: state.proposedRent,
    referenceIndexQuarter: state.targetQuarter,
    referenceIndexValue: state.newIndex,
    renewalDate: inYear(
      anniversary.getFullYear() + 1,
      anniversary.getMonth(),
      anniversary.getDate(),
    ).getTime(),
  };
}
