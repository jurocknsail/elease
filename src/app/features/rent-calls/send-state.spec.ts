import { computeTotalPrice } from '../../core/billing/amounts';
import { formatEuro } from '../../core/format/fr';
import { BillingPeriod } from '../../core/billing/period';
import { leaseStatus } from '../../core/billing/send-status';
import { Lease } from '../../core/models/lease';
import { Leaseholder } from '../../core/models/leaseholder';
import {
  RentCallRow,
  buildRows,
  canSend,
  confirmMessage,
  dueDateLabel,
  initialSelection,
  parseDateInput,
  toDateInputValue,
  rowKey,
  selectionSummary,
  showReminderBanner,
  summary,
} from './send-state';
import { groupByEmail } from '../../core/email/rent-call-email';

function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    objectId: 'l-' + (overrides.name ?? 'bail'),
    isPro: false,
    name: 'Bail',
    lot: null,
    streetNumber: 1,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'La Ciotat',
    price: 500,
    charge: null,
    additionalCharges: [],
    lastSendDate: 0,
    renewalDate: null,
    ...overrides,
  };
}

function holder(name: string, leases: Lease[] = [], overrides: Partial<Leaseholder> = {}) {
  return {
    objectId: 'h-' + name,
    name,
    email: `${name.toLowerCase().replace(/[^a-z]/g, '')}@example.test`,
    phone: '',
    leases,
    ...overrides,
  } satisfies Leaseholder;
}

const DEC_2026: BillingPeriod = { year: 2026, month: 12 };

/** A row with just what `summary` and `showReminderBanner` read. */
function row(status: 'sent' | 'todo', amount = 100): RentCallRow {
  return { holder: holder('Dupont'), lease: lease(), amount, status };
}

/** Plain spaces instead of the no-break ones of the French formatting. */
const plainEuro = (value: string) =>
  value.replace(
    new RegExp('[' + String.fromCharCode(0xa0) + String.fromCharCode(0x202f) + ']', 'g'),
    ' ',
  );

/** « 1 309,30 € » -> 130930: the cents a person reads on the screen. */
function euroCents(shown: string): number {
  return Math.round(Number(shown.replace(/[^\d,-]/g, '').replace(',', '.')) * 100);
}

describe('buildRows', () => {
  it('produces no row for a tenant without leases', () => {
    const rows = buildRows(
      [holder('Sans bail'), holder('Dupont', [lease({ name: 'Studio' })])],
      DEC_2026,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].holder.name).toBe('Dupont');
  });

  it('produces no row at all without tenants, or when nobody has a lease', () => {
    expect(buildRows([], DEC_2026)).toEqual([]);
    expect(buildRows([holder('A'), holder('B')], DEC_2026)).toEqual([]);
  });

  it('gives one row per lease, with the holder, the lease, the amount the PDF bills and the status', () => {
    const pro = lease({
      name: 'Commerce',
      isPro: true,
      price: 1234,
      charge: 123,
      additionalCharges: [{ title: 'Parking', amount: 50 }],
    });
    const sent = lease({ name: 'Studio', lastSentPeriod: '2026-12', lastSentPeriodAt: 5 });
    const h = holder('Dupont', [pro, sent]);

    const rows = buildRows([h], DEC_2026);

    expect(rows).toHaveLength(2);
    expect(rows[0].holder).toBe(h);
    expect(rows[0].lease).toBe(pro);
    expect(rows[0].amount).toBe(computeTotalPrice(pro));
    expect(rows[0].amount).toBeCloseTo(1653.8, 10);
    expect(rows[0].status).toBe('todo');
    expect(rows[1].lease).toBe(sent);
    expect(rows[1].amount).toBe(300 + 200);
    expect(rows[1].status).toBe('sent');
  });

  it('takes the status from leaseStatus: lastSentPeriod, legacy send date, never sent', () => {
    const periodSent = lease({ name: 'A', lastSentPeriod: '2026-12', lastSentPeriodAt: 1 });
    // Sent from the legacy app on 25 November 2026: it bills December.
    const legacySent = lease({ name: 'B', lastSendDate: new Date(2026, 10, 25).getTime() });
    const never = lease({ name: 'C' });
    const old = lease({ name: 'D', lastSendDate: new Date(2026, 9, 25).getTime() });
    const leases = [periodSent, legacySent, never, old];

    const rows = buildRows([holder('Dupont', leases)], DEC_2026);

    expect(rows.map((r) => r.status)).toEqual(leases.map((l) => leaseStatus(l, DEC_2026)));
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent', 'todo', 'todo']);
  });

  describe('order', () => {
    it('sorts by tenant name, then by lease name', () => {
      const rows = buildRows(
        [
          holder('Martin', [lease({ name: 'B' }), lease({ name: 'A' })]),
          holder('Dupont', [lease({ name: 'Z' })]),
        ],
        DEC_2026,
      );

      expect(rows.map((r) => `${r.holder.name}/${r.lease.name}`)).toEqual([
        'Dupont/Z',
        'Martin/A',
        'Martin/B',
      ]);
    });

    it('sorts like a French reader: case and accents do not decide', () => {
      const rows = buildRows(
        [
          holder('Zoé', [lease({ name: 'Garage' })]),
          holder('élise', [lease({ name: 'Garage' })]),
          holder('Émile', [lease({ name: 'Garage' })]),
          holder('Bob', [lease({ name: 'Garage' })]),
          holder('alice', [lease({ name: 'Garage' })]),
          holder('Eve', [lease({ name: 'Garage' })]),
        ],
        DEC_2026,
      );

      // A plain `<` would give Bob, Eve, Zoé, alice, Émile, élise (uppercase, then accents, last).
      expect(rows.map((r) => r.holder.name)).toEqual([
        'alice',
        'Bob',
        'élise',
        'Émile',
        'Eve',
        'Zoé',
      ]);
    });
  });
});

describe('summary', () => {
  it('counts the leases to send and sent, totals the month sent ones included, ignores NaN', () => {
    expect(summary([])).toEqual({ todo: 0, sent: 0, total: 0 });
    expect(summary([row('todo', 1000), row('sent', 250.5), row('todo', 49.5)])).toEqual({
      todo: 2,
      sent: 1,
      total: 1300,
    });
    expect(summary([row('todo', NaN), row('sent', 100.5), row('todo', Infinity)])).toEqual({
      todo: 2,
      sent: 1,
      total: 100.5,
    });
  });

  it('totals the amounts as printed: each lease rounded to the cent, then added', () => {
    // Three professional leases at 1091.08: each bills 1309.296 and is shown as 1 309,30 €.
    const leases = ['A', 'B', 'C'].map((name) => lease({ name, isPro: true, price: 1091.08 }));
    const rows = buildRows([holder('Dupont', leases)], DEC_2026);

    expect(rows.map((r) => formatEuro(r.amount))).toEqual(rows.map(() => formatEuro(1309.3)));
    expect(plainEuro(formatEuro(rows[0].amount))).toBe('1 309,30 €');
    // The raw float sum is 3927.888, which prints 3 927,89: one cent short of the three rows.
    expect(summary(rows).total).toBe(3927.9);
    expect(plainEuro(formatEuro(summary(rows).total))).toBe('3 927,90 €');
    // What the owner adds by hand: the amounts printed on the rows, to the cent.
    const shown = rows.reduce((sum, r) => sum + euroCents(formatEuro(r.amount)), 0);
    expect(euroCents(formatEuro(summary(rows).total))).toBe(shown);
  });
});

describe('rowKey', () => {
  it("is the lease's objectId, else a position-based key that stays distinct and cannot collide", () => {
    const rows = buildRows(
      [
        holder('Dupont', [
          lease({ name: 'Atelier', objectId: 'abc123' }),
          lease({ name: 'Garage', objectId: undefined }),
          lease({ name: 'Garage', objectId: undefined }),
        ]),
      ],
      DEC_2026,
    );

    expect(rowKey(rows[0], 0)).toBe('abc123');
    expect(rowKey(rows[0], 7)).toBe('abc123');
    const keys = rows.map((r, i) => rowKey(r, i));
    expect(new Set(keys).size).toBe(3);
    expect(keys[1]).toBe('h-Dupont:1');
  });
});

describe('showReminderBanner', () => {
  const todo = [row('sent'), row('todo')];

  it('is off on the 24th, on from the 25th while a lease is still to send, including month ends', () => {
    expect(showReminderBanner(new Date(2026, 10, 24, 23, 59, 59, 999), todo)).toBe(false);
    expect(showReminderBanner(new Date(2026, 10, 25, 0, 0, 0, 0), todo)).toBe(true);
    expect(showReminderBanner(new Date(2027, 1, 28), todo)).toBe(true);
  });

  it('is off from the 25th when everything is sent or there is no row', () => {
    expect(showReminderBanner(new Date(2026, 10, 25), [row('sent'), row('sent')])).toBe(false);
    expect(showReminderBanner(new Date(2026, 10, 25), [])).toBe(false);
  });
});

describe('initialSelection', () => {
  const sent = { lastSendDate: 1, lastSentPeriod: '2026-12', lastSentPeriodAt: 1 };

  it('selects every lease still to send and none of the sent ones', () => {
    const rows = buildRows(
      [
        holder('Dupont', [lease({ name: 'Studio' }), lease({ name: 'Garage', ...sent })]),
        holder('Martin', [lease({ name: 'Commerce' })]),
      ],
      DEC_2026,
    );

    expect(initialSelection(rows)).toEqual(new Set(['l-Commerce', 'l-Studio']));
    expect(initialSelection([]).size).toBe(0);
  });

  it('keeps unticked a lease that was not ticked at the last send (isSelected false)', () => {
    const rows = buildRows(
      [
        holder('Dupont', [
          lease({ name: 'Studio', isSelected: true }),
          lease({ name: 'Garage', isSelected: false }),
          lease({ name: 'Cave' }),
        ]),
      ],
      DEC_2026,
    );

    expect(initialSelection(rows)).toEqual(new Set(['l-Studio', 'l-Cave']));
  });

  it('follows isSelected true even for a lease already sent for the period (the confirmation warns)', () => {
    const sent = { lastSendDate: 1, lastSentPeriod: '2026-12', lastSentPeriodAt: 1 };
    const rows = buildRows(
      [
        holder('Dupont', [
          lease({ name: 'Studio', isSelected: true, ...sent }),
          lease({ name: 'Garage', isSelected: false, ...sent }),
          lease({ name: 'Cave', ...sent }),
        ]),
      ],
      DEC_2026,
    );

    expect(initialSelection(rows)).toEqual(new Set(['l-Studio']));
  });

  it('uses the key of rowKey, also for a lease without objectId', () => {
    const rows = buildRows(
      [holder('Dupont', [lease({ name: 'Studio', objectId: undefined })])],
      DEC_2026,
    );

    expect([...initialSelection(rows)]).toEqual([rowKey(rows[0], 0)]);
  });
});

describe('selectionSummary', () => {
  const keysOf = (rows: RentCallRow[]) => new Set(rows.map(rowKey));

  it('counts calls, e-mails and holders of the selected rows only', () => {
    const rows = buildRows(
      [
        holder('Dupont', [
          lease({ name: 'Studio', price: 600 }),
          lease({ name: 'Garage', price: 80 }),
        ]),
        holder('Martin', [lease({ name: 'Commerce', price: 1000 })]),
      ],
      DEC_2026,
    );

    expect(selectionSummary(rows, keysOf(rows))).toEqual({
      count: 3,
      emails: 2,
      holders: 2,
      total: 1680,
    });
    expect(selectionSummary(rows, new Set(['l-Garage']))).toEqual({
      count: 1,
      emails: 1,
      holders: 1,
      total: 80,
    });
  });

  it('counts the e-mails with the very key of groupByEmail: shared addresses merge, blank ones are not e-mails', () => {
    const emails = ['a@x.test', ' A@X.test', 'b@x.test ', '', '   ', 'B@x.TEST', 'c@x.test'];
    const holders = emails.map((email, i) =>
      holder('H' + i, [lease({ name: 'L' + i })], { email }),
    );
    const rows = buildRows(holders, DEC_2026);
    const items = rows.map((r) => ({
      holder: r.holder,
      pdf: { lease: r.lease, fileName: 'x.pdf', base64: '' },
    }));
    const groups = groupByEmail(items);

    const counted = selectionSummary(rows, keysOf(rows));

    expect(counted.emails).toBe([...groups.keys()].filter((key) => key !== '').length);
    expect(counted).toMatchObject({ count: 7, emails: 3, holders: 7 });
  });

  it('the total is the sum of the amounts rounded to the cent (3 pro leases of 1091.08)', () => {
    const rows = buildRows(
      [
        holder('Dupont', [
          lease({ name: 'A', isPro: true, price: 1091.08 }),
          lease({ name: 'B', isPro: true, price: 1091.08 }),
          lease({ name: 'C', isPro: true, price: 1091.08 }),
        ]),
      ],
      DEC_2026,
    );

    const { total } = selectionSummary(rows, keysOf(rows));

    expect(total).toBe(3927.9);
    expect(total).not.toBe(rows.reduce((sum, r) => sum + r.amount, 0));
  });
});

describe('canSend', () => {
  it('needs a selection whose every lease has its PDF, and ignores other PDFs', () => {
    expect(canSend(new Set(), new Set(['a']))).toBe(false);
    expect(canSend(new Set(['a', 'b']), new Set(['a']))).toBe(false);
    expect(canSend(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(true);
    expect(canSend(new Set(['a']), new Set(['a', 'b', 'c']))).toBe(true);
  });
});

describe('date input helpers', () => {
  it('formats and parses a local date without any time zone shift', () => {
    expect(toDateInputValue(new Date(2026, 10, 25))).toBe('2026-11-25');
    expect(toDateInputValue(new Date(2027, 0, 3))).toBe('2027-01-03');
    const parsed = parseDateInput('2026-11-25');
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(10);
    expect(parsed?.getDate()).toBe(25);
  });

  it('rejects malformed, impossible and out-of-range dates, accepts a leap day', () => {
    for (const value of ['', '2026-13-01', '2026-02-30', '25/11/2026', '1999-12-31', 'abc']) {
      expect(parseDateInput(value), JSON.stringify(value)).toBeNull();
    }
    expect(parseDateInput('2028-02-29')).not.toBeNull();
    expect(parseDateInput('2027-02-29')).toBeNull();
  });

  it('labels the due date with the ordinal « 1er »', () => {
    expect(dueDateLabel({ year: 2027, month: 1 })).toBe('1er janvier 2027');
  });
});

describe('confirmMessage', () => {
  const base = {
    emails: 6,
    holders: 5,
    total: 8420,
    testMode: false,
    repeats: 0,
    withoutAddress: 0,
  };

  it('says « N e-mails à M locataires, total T. », in the singular for 1', () => {
    expect(plainEuro(confirmMessage(base))).toBe('6 e-mails à 5 locataires, total 8 420 €.');
    expect(plainEuro(confirmMessage({ ...base, emails: 1, holders: 1, total: 1900 }))).toBe(
      '1 e-mail à 1 locataire, total 1 900 €.',
    );
  });

  it('adds the test-mode sentence outside production only', () => {
    expect(confirmMessage({ ...base, testMode: true })).toContain(
      'Mode test : aucun e-mail ne sera livré aux locataires.',
    );
    expect(confirmMessage(base)).not.toContain('Mode test');
  });

  it('warns about deliberate repeats and about tenants without an address', () => {
    const message = confirmMessage({ ...base, repeats: 2, withoutAddress: 1 });
    expect(message).toContain(
      'Attention : 2 appels déjà envoyés ou peut-être envoyés pour cette période.',
    );
    expect(message).toContain('1 locataire sans adresse e-mail ne recevra rien.');
  });
});
