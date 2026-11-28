/** A calendar month being billed. `month` is 1-12. */
export type BillingPeriod = { year: number; month: number };

/**
 * All dates here are LOCAL dates built from numbers (`new Date(y, m, d)`), never parsed from a
 * string such as "2026-1-25": Safari/iOS rejects non-padded ISO-like strings (invalid date).
 */

const MONTH_LABEL = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The default date of the rent call: the 25th of the month `now` falls in. */
export function defaultCallDate(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 25);
}

/** The period billed by a call sent on `callDate`: the month AFTER it (December rolls over to January). */
export function billingPeriod(callDate: Date): BillingPeriod {
  const nextMonth = new Date(callDate.getFullYear(), callDate.getMonth() + 1, 1);
  return { year: nextMonth.getFullYear(), month: nextMonth.getMonth() + 1 };
}

/** Sortable and storable form, e.g. '2027-01' (the `lastSentPeriod` field). */
export function periodKey(p: BillingPeriod): string {
  return `${p.year}-${pad2(p.month)}`;
}

/** The legacy 'MM/YYYY' form, e.g. '01/2027' (printed in the PDF and used in file names). */
export function legacyPeriodMonth(p: BillingPeriod): string {
  return `${pad2(p.month)}/${p.year}`;
}

/** Human label, e.g. 'janvier 2027'. */
export function periodLabel(p: BillingPeriod): string {
  return MONTH_LABEL.format(new Date(Date.UTC(p.year, p.month - 1, 1))).toLowerCase();
}

/** Number of days of the period's month (28 to 31, leap years included). */
export function periodLastDay(p: BillingPeriod): number {
  return new Date(p.year, p.month, 0).getDate();
}

/** Rent due date: the 1st of the billed month. */
export function dueDate(p: BillingPeriod): Date {
  return new Date(p.year, p.month - 1, 1);
}

const MONTH_NAME = new Intl.DateTimeFormat('fr-FR', { month: 'long', timeZone: 'UTC' });

/**
 * The two parts of a rent-call title: the month the calls go out (the month BEFORE the billed one) and
 * the billed period. « Appels de novembre » / « pour décembre 2026 »; elided before a vowel
 * (« Appels d'avril », « d'août », « d'octobre »).
 */
export function callTitle(p: BillingPeriod): { calls: string; billed: string } {
  const callMonth = MONTH_NAME.format(new Date(Date.UTC(p.year, p.month - 2, 1))).toLowerCase();
  const de = /^[aeiouyàâéèêîôû]/.test(callMonth) ? 'd’' : 'de ';
  return { calls: `Appels ${de}${callMonth}`, billed: `pour ${periodLabel(p)}` };
}
