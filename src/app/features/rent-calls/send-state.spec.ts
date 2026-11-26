import { computeTotalPrice } from '../../core/billing/amounts';
import { BillingPeriod } from '../../core/billing/period';
import { leaseStatus } from '../../core/billing/send-status';
import { Lease } from '../../core/models/lease';
import { Leaseholder } from '../../core/models/leaseholder';
import { RentCallRow, buildRows, showReminderBanner, summary } from './send-state';

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

  it('adds the amounts as they are, without rounding of its own', () => {
    // 0.1 + 0.2 is 0.30000000000000004: the sum of the amounts the PDFs bill, not a rounded one.
    const leases = [
      lease({ name: 'A', price: 0.1 }),
      lease({ name: 'B', price: 0.2 }),
      lease({ name: 'C', isPro: true, price: 1091.08, charge: 33.33 }),
      lease({ name: 'D', price: 2.675, additionalCharges: [{ title: 'x', amount: 1.005 }] }),
    ];
    const rows = buildRows([holder('Dupont', leases)], DEC_2026);

    let expected = 0;
    for (const l of leases) {
      expected += computeTotalPrice(l);
    }
    expect(summary(rows).total).toBe(expected);
    expect(summary(buildRows([holder('Dupont', leases.slice(0, 2))], DEC_2026)).total).toBe(
      0.1 + 0.2,
    );
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
