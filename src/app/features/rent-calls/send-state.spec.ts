import { computeTotalPrice, toCents } from '../../core/billing/amounts';
import { formatEuro } from '../../core/format/fr';
import { BillingPeriod } from '../../core/billing/period';
import { leaseStatus } from '../../core/billing/send-status';
import { Lease } from '../../core/models/lease';
import { Leaseholder } from '../../core/models/leaseholder';
import {
  RentCallRow,
  buildRows,
  canSend,
  initialSelection,
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

  it('follows the billing period it is given', () => {
    const l = lease({ lastSentPeriod: '2026-12', lastSentPeriodAt: 1 });
    const h = holder('Dupont', [l]);

    expect(buildRows([h], DEC_2026)[0].status).toBe('sent');
    expect(buildRows([h], { year: 2027, month: 1 })[0].status).toBe('todo');
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

    it('puts a tenant name before another even when the lease names say the opposite', () => {
      const rows = buildRows(
        [
          holder('Martin', [lease({ name: 'Bureau' })]),
          holder('Dupont', [lease({ name: 'Bureau' })]),
        ],
        DEC_2026,
      );

      expect(rows.map((r) => r.holder.name)).toEqual(['Dupont', 'Martin']);
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

    it('sorts the leases of a tenant the same way', () => {
      const rows = buildRows(
        [
          holder('Dupont', [
            lease({ name: 'local Z' }),
            lease({ name: 'Étage' }),
            lease({ name: 'Garage' }),
            lease({ name: 'étable' }),
            lease({ name: 'Appartement' }),
          ]),
        ],
        DEC_2026,
      );

      expect(rows.map((r) => r.lease.name)).toEqual([
        'Appartement',
        'étable',
        'Étage',
        'Garage',
        'local Z',
      ]);
    });

    it('keeps the stored order of identical names (stable)', () => {
      const first = lease({ name: 'Garage', objectId: 'first', price: 1 });
      const second = lease({ name: 'Garage', objectId: 'second', price: 2 });
      const rows = buildRows(
        [
          holder('Dupont', [first], { objectId: 'h1' }),
          holder('Dupont', [second], { objectId: 'h2' }),
        ],
        DEC_2026,
      );

      expect(rows.map((r) => r.lease.objectId)).toEqual(['first', 'second']);
    });

    it('does not reorder or modify what it is given', () => {
      const holders = [
        holder('Martin', [lease({ name: 'B' }), lease({ name: 'A' })]),
        holder('Dupont', [lease({ name: 'Z' })]),
      ];
      const before = JSON.stringify(holders);

      buildRows(holders, DEC_2026);

      expect(JSON.stringify(holders)).toBe(before);
      expect(holders.map((h) => h.name)).toEqual(['Martin', 'Dupont']);
    });
  });

  it('lists the rows of two tenants who share an e-mail address', () => {
    const rows = buildRows(
      [
        holder('Camille Roy', [lease({ name: 'Studio' })], { email: 'famille@example.test' }),
        holder('Louis Roy', [lease({ name: 'Garage' })], { email: 'famille@example.test' }),
      ],
      DEC_2026,
    );

    expect(rows.map((r) => r.holder.name)).toEqual(['Camille Roy', 'Louis Roy']);
  });

  it('keeps a lease that has no objectId, no charge, no renewal date and no lot', () => {
    const bare = lease({ objectId: undefined, lot: null, charge: null, renewalDate: null });
    const rows = buildRows([holder('Dupont', [bare])], DEC_2026);

    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(500);
  });
});

describe('summary', () => {
  it('counts the leases to send and the leases sent', () => {
    const s = summary([row('todo'), row('sent'), row('todo'), row('todo'), row('sent')]);

    expect(s.todo).toBe(3);
    expect(s.sent).toBe(2);
  });

  it('totals the month over all the rows, sent ones included', () => {
    const s = summary([row('todo', 1000), row('sent', 250.5), row('todo', 49.5)]);

    expect(s.total).toBe(1300);
  });

  it('is all zero without rows', () => {
    expect(summary([])).toEqual({ todo: 0, sent: 0, total: 0 });
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
  });

  it('has no float noise: 0.1 + 0.2 is 0.3', () => {
    const rows = buildRows(
      [holder('Dupont', [lease({ name: 'A', price: 0.1 }), lease({ name: 'B', price: 0.2 })])],
      DEC_2026,
    );

    expect(summary(rows).total).toBe(0.3);
  });

  it('rounds each lease like the PDF (toFixed(2)), not the total', () => {
    const leases = [
      lease({ name: 'A', price: 2.675 }),
      lease({ name: 'B', price: 1.005 }),
      lease({ name: 'C', price: 0.125 }),
    ];
    const rows = buildRows([holder('Dupont', leases)], DEC_2026);

    // 2.675 -> 2.67, 1.005 -> 1.00, 0.125 -> 0.13 (what toFixed(2) prints), i.e. 3.80 in all.
    expect(summary(rows).total).toBe(3.8);
  });

  it('counts an amount that is not a number as nothing, never NaN', () => {
    const s = summary([row('todo', NaN), row('sent', 100.5), row('todo', Infinity)]);

    expect(s.total).toBe(100.5);
    expect(s.todo).toBe(2);
    expect(s.sent).toBe(1);
  });

  it('always equals the sum of the amounts shown in the rows (2 000 pseudo-random portfolios)', () => {
    // Deterministic generator (mulberry32): the same portfolios on every run.
    let state = 0x1f2e3d4c;
    const random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const decimals = (max: number) => {
      const places = random() < 0.5 ? 2 : 3;
      return Math.round(random() * max * 10 ** places) / 10 ** places;
    };

    let rawSumDiffered = 0;
    for (let portfolio = 0; portfolio < 2000; portfolio++) {
      const count = 1 + Math.floor(random() * 15);
      const leases = Array.from({ length: count }, (_, i) =>
        lease({
          name: `Bail ${i}`,
          isPro: random() < 0.5,
          price: decimals(3000),
          charge: random() < 0.4 ? null : decimals(400),
          additionalCharges: Array.from({ length: Math.floor(random() * 4) }, (_, k) => ({
            title: `Frais ${k}`,
            amount: decimals(150),
          })),
        }),
      );
      const rows = buildRows([holder('Dupont', leases)], DEC_2026);
      const { total } = summary(rows);

      // What the owner adds by hand: the amounts printed on the rows, to the cent.
      const shown = rows.reduce((sum, r) => sum + euroCents(formatEuro(r.amount)), 0);
      expect(Math.round(total * 100)).toBe(shown);
      expect(euroCents(formatEuro(total))).toBe(shown);
      expect(Math.round(total * 100)).toBe(rows.reduce((sum, r) => sum + toCents(r.amount), 0));
      if (euroCents(formatEuro(rows.reduce((sum, r) => sum + r.amount, 0))) !== shown) {
        rawSumDiffered += 1;
      }
    }
    // The property is not vacuous: the plain float sum is off by a cent in many of these portfolios.
    expect(rawSumDiffered).toBeGreaterThan(100);
  });

  it('works on what buildRows returns', () => {
    const rows = buildRows(
      [
        holder('Dupont', [
          lease({ name: 'Studio', price: 600 }),
          lease({ name: 'Garage', price: 80, lastSentPeriod: '2026-12', lastSentPeriodAt: 1 }),
        ]),
        holder('Sans bail'),
      ],
      DEC_2026,
    );

    expect(summary(rows)).toEqual({ todo: 1, sent: 1, total: 680 });
  });
});

describe('rowKey', () => {
  it("is the lease's objectId when it has one", () => {
    const rows = buildRows(
      [holder('Dupont', [lease({ name: 'Studio', objectId: 'abc123' })])],
      DEC_2026,
    );

    expect(rowKey(rows[0], 0)).toBe('abc123');
    expect(rowKey(rows[0], 7)).toBe('abc123');
  });

  it('falls back on the position, so leases without an objectId and with the same name stay distinct', () => {
    const rows = buildRows(
      [
        holder('Dupont', [
          lease({ name: 'Garage', objectId: undefined }),
          lease({ name: 'Garage', objectId: undefined }),
        ]),
        holder('Dupont', [lease({ name: 'Garage', objectId: undefined })], { objectId: undefined }),
      ],
      DEC_2026,
    );

    const keys = rows.map((r, i) => rowKey(r, i));
    expect(new Set(keys).size).toBe(3);
  });

  it('cannot collide with a real objectId', () => {
    const rows = buildRows([holder('Dupont', [lease({ objectId: undefined })])], DEC_2026);

    expect(rowKey(rows[0], 0)).toContain(':');
    expect(rowKey(rows[0], 0)).toBe('h-Dupont:0');
  });
});

describe('showReminderBanner', () => {
  const todo = [row('sent'), row('todo')];
  const allSent = [row('sent'), row('sent')];

  it('is off on the 24th, even with leases to send', () => {
    expect(showReminderBanner(new Date(2026, 10, 24, 23, 59, 59, 999), todo)).toBe(false);
  });

  it('is on from the 25th when a lease is still to send', () => {
    expect(showReminderBanner(new Date(2026, 10, 25), todo)).toBe(true);
    expect(showReminderBanner(new Date(2026, 10, 25, 0, 0, 0, 0), todo)).toBe(true);
    expect(showReminderBanner(new Date(2026, 10, 25, 23, 59, 59, 999), todo)).toBe(true);
    expect(showReminderBanner(new Date(2026, 10, 30), todo)).toBe(true);
  });

  it('is off on the 25th when everything is sent', () => {
    expect(showReminderBanner(new Date(2026, 10, 25), allSent)).toBe(false);
  });

  it('is off without any row', () => {
    expect(showReminderBanner(new Date(2026, 10, 25), [])).toBe(false);
  });

  it('is off on the early days of the month, which cannot be after the 25th', () => {
    expect(showReminderBanner(new Date(2026, 11, 1), todo)).toBe(false);
    expect(showReminderBanner(new Date(2026, 11, 10), todo)).toBe(false);
  });

  it('reads the day of the month, whatever the length of the month', () => {
    // 28 February 2027 (not a leap year): the last day is after the 25th.
    expect(showReminderBanner(new Date(2027, 1, 28), todo)).toBe(true);
    expect(showReminderBanner(new Date(2027, 1, 24), todo)).toBe(false);
    // 29 February 2028 (leap year).
    expect(showReminderBanner(new Date(2028, 1, 29), todo)).toBe(true);
    expect(showReminderBanner(new Date(2028, 1, 25), todo)).toBe(true);
    expect(showReminderBanner(new Date(2028, 1, 24), todo)).toBe(false);
    // 31-day and 30-day months.
    expect(showReminderBanner(new Date(2026, 11, 31), todo)).toBe(true);
    expect(showReminderBanner(new Date(2026, 3, 30), todo)).toBe(true);
  });

  it('uses the local day of the date it is given', () => {
    // Built with local-time constructors: the 25th at the start and the end of the local day, in
    // whatever time zone the suite runs (run it under TZ=America/Los_Angeles and TZ=Pacific/Auckland).
    expect(showReminderBanner(new Date(2026, 10, 24, 23, 59), todo)).toBe(false);
    expect(showReminderBanner(new Date(2026, 10, 25, 0, 1), todo)).toBe(true);
    // 25 December 2026 at 00:30, then 24 December at 23:30.
    expect(showReminderBanner(new Date(2026, 11, 25, 0, 30), todo)).toBe(true);
    expect(showReminderBanner(new Date(2026, 11, 24, 23, 30), todo)).toBe(false);
  });

  it('does not depend on the amounts or on how many leases are sent', () => {
    expect(showReminderBanner(new Date(2026, 10, 25), [row('todo', 0)])).toBe(true);
    expect(
      showReminderBanner(new Date(2026, 10, 25), [row('sent'), row('sent'), row('todo')]),
    ).toBe(true);
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

    const selected = initialSelection(rows);

    expect(selected).toEqual(new Set(['l-Commerce', 'l-Studio']));
    expect(selected.has('l-Garage')).toBe(false);
  });

  it('uses the key of rowKey, also for a lease without objectId', () => {
    const rows = buildRows(
      [holder('Dupont', [lease({ name: 'Studio', objectId: undefined })])],
      DEC_2026,
    );

    expect([...initialSelection(rows)]).toEqual([rowKey(rows[0], 0)]);
  });

  it('is empty when everything is sent or there is no row', () => {
    expect(initialSelection([]).size).toBe(0);
    expect(
      initialSelection(buildRows([holder('Dupont', [lease({ ...sent })])], DEC_2026)).size,
    ).toBe(0);
  });
});

describe('selectionSummary', () => {
  const keysOf = (rows: RentCallRow[]) => new Set(rows.map(rowKey));

  it('3 leases of 2 holders with different e-mails: 3 calls, 2 e-mails, 2 holders', () => {
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
  });

  it('counts only the selected rows', () => {
    const rows = buildRows(
      [
        holder('Dupont', [
          lease({ name: 'Studio', price: 600 }),
          lease({ name: 'Garage', price: 80 }),
        ]),
      ],
      DEC_2026,
    );

    expect(selectionSummary(rows, new Set(['l-Garage']))).toEqual({
      count: 1,
      emails: 1,
      holders: 1,
      total: 80,
    });
    expect(selectionSummary(rows, new Set())).toEqual({
      count: 0,
      emails: 0,
      holders: 0,
      total: 0,
    });
  });

  it('two holders sharing one address are 2 holders but ONE e-mail, trimmed and case-insensitive', () => {
    const rows = buildRows(
      [
        holder('Dupont', [lease({ name: 'A' })], { email: ' Famille@Example.test ' }),
        holder('Martin', [lease({ name: 'B' })], { email: 'famille@example.test' }),
      ],
      DEC_2026,
    );

    expect(selectionSummary(rows, keysOf(rows))).toMatchObject({ count: 2, emails: 1, holders: 2 });
  });

  it('counts the e-mails with the very key of groupByEmail, whatever the spelling', () => {
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

    const { emails: counted } = selectionSummary(rows, keysOf(rows));

    expect(counted).toBe([...groups.keys()].filter((key) => key !== '').length);
    expect(counted).toBe(3);
  });

  it('a holder without an address is NOT an e-mail (own empty group) but is a holder', () => {
    const rows = buildRows(
      [
        holder('Dupont', [lease({ name: 'A' })], { email: 'dupont@example.test' }),
        holder('Sans', [lease({ name: 'B' })], { email: '' }),
        holder('Blanc', [lease({ name: 'C' })], { email: '   ' }),
      ],
      DEC_2026,
    );

    expect(selectionSummary(rows, keysOf(rows))).toMatchObject({ count: 3, emails: 1, holders: 3 });
  });

  it('a holder with several selected leases is counted once', () => {
    const rows = buildRows(
      [holder('Dupont', [lease({ name: 'A' }), lease({ name: 'B' }), lease({ name: 'C' })])],
      DEC_2026,
    );

    expect(selectionSummary(rows, keysOf(rows))).toMatchObject({ count: 3, emails: 1, holders: 1 });
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
  it('is false when nothing is selected', () => {
    expect(canSend(new Set(), new Set(['a']))).toBe(false);
    expect(canSend(new Set(), new Set())).toBe(false);
  });

  it('is false while one selected lease has no generated PDF', () => {
    expect(canSend(new Set(['a', 'b']), new Set(['a']))).toBe(false);
    expect(canSend(new Set(['a']), new Set())).toBe(false);
  });

  it('is true when every selected lease has its PDF', () => {
    expect(canSend(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(true);
  });

  it('ignores PDFs of leases that are not selected', () => {
    expect(canSend(new Set(['a']), new Set(['a', 'b', 'c']))).toBe(true);
  });
});
