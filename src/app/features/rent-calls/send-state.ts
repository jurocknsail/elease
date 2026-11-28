import { computeTotalPrice, sumAmounts } from '../../core/billing/amounts';
import { BillingPeriod, periodLabel } from '../../core/billing/period';
import { leaseStatus } from '../../core/billing/send-status';
import { recipientKey } from '../../core/email/rent-call-email';
import { formatEuro } from '../../core/format/fr';
import { Lease } from '../../core/models/lease';
import { Leaseholder } from '../../core/models/leaseholder';

/** One lease on the « Appels de loyer » screen: who, what, how much, and whether it was sent. */
export interface RentCallRow {
  holder: Leaseholder;
  lease: Lease;
  /** What the PDF bills: rent (+ VAT for a professional lease), charges, additional charges. */
  amount: number;
  status: 'sent' | 'todo';
}

/** The first day of the month on which the reminder banner may appear. */
export const REMINDER_FROM_DAY = 25;

/** French collation: `Émile` sits with the E's, `alice` before `Bob`. */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'fr');
}

/**
 * One row per lease of every tenant, for the billing period `p`, sorted by tenant name then lease name.
 * A tenant without leases produces no row. The amount is the one the PDF bills (`computeTotalPrice`:
 * a single source of truth) and the status comes from `leaseStatus`. The input is not modified.
 */
export function buildRows(holders: Leaseholder[], p: BillingPeriod): RentCallRow[] {
  const rows: RentCallRow[] = [];
  for (const holder of holders) {
    for (const lease of holder.leases) {
      rows.push({ holder, lease, amount: computeTotalPrice(lease), status: leaseStatus(lease, p) });
    }
  }
  // `sort` is stable: identical names keep the order they were stored in.
  return rows.sort(
    (a, b) =>
      compareNames(a.holder.name, b.holder.name) || compareNames(a.lease.name, b.lease.name),
  );
}

/**
 * The numbers of the month: leases still to send, leases already sent, and the total of every row
 * (sent or not: it is the month's rent, not what is left to send). The total is the sum of the amounts
 * as printed, each rounded to the cent (`sumAmounts`), so it always equals what a person adds up from
 * the rows and from the PDFs.
 */
export function summary(rows: RentCallRow[]): { todo: number; sent: number; total: number } {
  let todo = 0;
  let sent = 0;
  for (const row of rows) {
    if (row.status === 'todo') {
      todo += 1;
    } else {
      sent += 1;
    }
  }
  return { todo, sent, total: sumAmounts(rows.map((row) => row.amount)) };
}

/**
 * A stable key for a row of the list (`@for` track): the lease's objectId, which every lease from the
 * backend has. A lease without one (not expected) falls back on the tenant and the position in the
 * list, so two such leases, even with the same name, never share a key. The fallback contains a colon,
 * which no objectId does.
 */
export function rowKey(row: RentCallRow, index: number): string {
  return row.lease.objectId ?? `${row.holder.objectId ?? 'holder'}:${index}`;
}

/**
 * Whether to remind the user that the rent calls are to be sent: from the 25th of the month (the day
 * they are usually sent) and as long as at least one is still to send. `today`'s local day is used.
 */
export function showReminderBanner(today: Date, rows: RentCallRow[]): boolean {
  return today.getDate() >= REMINDER_FROM_DAY && rows.some((row) => row.status === 'todo');
}

/** The keys (see `rowKey`) of every lease still to send: what the send screen starts with. */
export function initialSelection(rows: readonly RentCallRow[]): Set<string> {
  const selected = new Set<string>();
  rows.forEach((row, index) => {
    // Still to send, and ticked at the last send (a lease never sent has no value: ticked).
    if (row.status === 'todo' && row.lease.isSelected !== false) {
      selected.add(rowKey(row, index));
    }
  });
  return selected;
}

/** What the footer and the confirmation announce for the selected rows. */
export interface SelectionSummary {
  /** Selected leases = PDFs = rent calls. */
  count: number;
  /**
   * E-mails that will go out: distinct recipient addresses, by the key of `groupByEmail` (trimmed,
   * lower-cased). A holder without an address is its own group there and is NOT an e-mail: it is
   * refused by the sender, never counted here.
   */
  emails: number;
  /** Distinct tenants among the selected leases. */
  holders: number;
  /** Sum of the amounts, each rounded to the cent (`sumAmounts`): what the owner adds up by hand. */
  total: number;
}

export function selectionSummary(
  rows: readonly RentCallRow[],
  selected: ReadonlySet<string>,
): SelectionSummary {
  const chosen = rows.filter((row, index) => selected.has(rowKey(row, index)));
  const addresses = new Set<string>();
  const holders = new Set<unknown>();
  for (const row of chosen) {
    const address = recipientKey(row.holder);
    if (address !== '') {
      addresses.add(address);
    }
    holders.add(row.holder.objectId ?? row.holder);
  }
  return {
    count: chosen.length,
    emails: addresses.size,
    holders: holders.size,
    total: sumAmounts(chosen.map((row) => row.amount)),
  };
}

/**
 * Whether sending is allowed: at least one lease is selected AND every selected lease has its PDF
 * generated for the CURRENT call date (`previewed` holds the keys of those PDFs, and is emptied when
 * the date changes). Nothing is ever sent that could not be previewed.
 */
export function canSend(selected: ReadonlySet<string>, previewed: ReadonlySet<string>): boolean {
  if (selected.size === 0) {
    return false;
  }
  for (const key of selected) {
    if (!previewed.has(key)) {
      return false;
    }
  }
  return true;
}

/** `value` of an `<input type="date">` for a local date: 'yyyy-MM-dd'. */
export function toDateInputValue(date: Date): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}`;
}

/**
 * The local date of an `<input type="date">` value, or null when it is empty, not 'yyyy-MM-dd', not a
 * real day (31 February) or out of a sensible range (2000-2100). Built from numbers, never parsed from a
 * string by `Date` (UTC midnight would be the evening before west of Greenwich).
 */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 2000 || year > 2100) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  const real =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return real ? date : null;
}

/** « 1er janvier 2027 »: the rent of a period is due on its first day. */
export function dueDateLabel(p: BillingPeriod): string {
  return `1er ${periodLabel(p)}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What the confirmation says before anything is sent. */
export interface ConfirmFacts {
  emails: number;
  holders: number;
  total: number;
  /** Outside production: nothing reaches the tenants. */
  testMode: boolean;
  /** Selected leases already sent (or perhaps sent) for this period: sending them again is deliberate. */
  repeats: number;
  /** Selected tenants who have no e-mail address: they receive nothing. */
  withoutAddress: number;
}

/** « 2 e-mails à 2 locataires, total 1 680 €. » plus the warnings that apply. */
export function confirmMessage(facts: ConfirmFacts): string {
  const parts = [
    `${plural(facts.emails, 'e-mail', 'e-mails')} à ${plural(facts.holders, 'locataire', 'locataires')}, total ${formatEuro(facts.total)}.`,
  ];
  if (facts.withoutAddress > 0) {
    parts.push(
      `${plural(facts.withoutAddress, 'locataire sans adresse e-mail ne recevra', 'locataires sans adresse e-mail ne recevront')} rien.`,
    );
  }
  if (facts.repeats > 0) {
    parts.push(
      `Attention : ${plural(facts.repeats, 'appel déjà envoyé ou peut-être envoyé', 'appels déjà envoyés ou peut-être envoyés')} pour cette période.`,
    );
  }
  if (facts.testMode) {
    parts.push('Mode test : aucun e-mail ne sera livré aux locataires.');
  }
  return parts.join(' ');
}
