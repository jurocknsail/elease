import { RentCallLog, RentChange } from '../models/history';
import { Lease } from '../models/lease';
import { Leaseholder } from '../models/leaseholder';
import { nextAction } from './next-action';
import {
  billedByMonth,
  historyStart,
  indexSeries,
  portfolioSummary,
  recentRentChanges,
  sendTimings,
  yearOverYear,
} from './stats';

function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    objectId: 'L1',
    isPro: false,
    name: 'Studio',
    lot: null,
    streetNumber: 1,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'Ville-Test',
    price: 1000,
    charge: null,
    additionalCharges: [],
    lastSendDate: 0,
    renewalDate: null,
    ...overrides,
  };
}

function holder(leases: Lease[], objectId = 'H1'): Leaseholder {
  return { objectId, name: 'Dupont', email: 'dupont@example.test', phone: '', leases };
}

function send(overrides: Partial<RentCallLog>): RentCallLog {
  return {
    leaseId: 'L1',
    leaseName: 'Studio',
    period: '2026-12',
    sentAt: new Date(2026, 10, 25).getTime(),
    source: 'app',
    price: 1000,
    charge: 0,
    tva: 0,
    extras: 0,
    total: 1000,
    ...overrides,
  };
}

describe('portfolioSummary', () => {
  it('sums today’s totals and counts the calls of the coming period', () => {
    const sent = lease({
      objectId: 'A',
      isPro: true,
      price: 1000,
      lastSentPeriod: '2026-12',
      lastSentPeriodAt: 5,
      lastSendDate: 5,
    });
    const todo = lease({ objectId: 'B', price: 500, charge: 20 });
    const summary = portfolioSummary([holder([sent, todo])], new Date(2026, 10, 10));
    expect(summary.monthly).toBe(1720);
    expect(summary.annual).toBe(20640);
    expect(summary.period).toEqual({ year: 2026, month: 12 });
    expect([summary.sent, summary.todo, summary.leaseCount]).toEqual([1, 1, 2]);
  });
});

describe('billedByMonth', () => {
  it('lists every month up to the last one, keeping the latest send of a lease per period', () => {
    const bars = billedByMonth(
      [
        send({ period: '2026-11', total: 900 }),
        send({ period: '2026-12', total: 1000, sentAt: 1 }),
        send({ period: '2026-12', total: 1010, sentAt: 2 }),
        send({ leaseId: 'L2', period: '2026-12', total: 300 }),
      ],
      { year: 2027, month: 1 },
      3,
    );
    expect(bars.map((b) => [b.period, b.total, b.count])).toEqual([
      ['2026-11', 900, 1],
      ['2026-12', 1310, 2],
      ['2027-01', 0, 0],
    ]);
  });
});

describe('sendTimings', () => {
  it('says whether every call of a period left before its 1st, newest period first', () => {
    const timings = sendTimings([
      send({ period: '2026-12', sentAt: new Date(2026, 10, 25).getTime() }),
      send({ period: '2027-01', sentAt: new Date(2027, 0, 3).getTime() }),
    ]);
    expect(timings.map((t) => [t.period, t.onTime])).toEqual([
      ['2027-01', false],
      ['2026-12', true],
    ]);
  });
});

describe('indices', () => {
  it('orders the observations and gives the change over a year', () => {
    const points = indexSeries(
      new Map([
        ['2026-Q2', 138.01],
        ['2025-Q2', 133.69],
        ['2025-Q3', 134],
        ['nonsense', 1],
      ]),
    );
    expect(points.map((p) => p.quarter)).toEqual(['2025-Q2', '2025-Q3', '2026-Q2']);
    expect(yearOverYear(points)).toBeCloseTo(3.2314, 3);
    expect(yearOverYear(points.slice(0, 2))).toBeNull();
  });
});

describe('history helpers', () => {
  const change = (over: Partial<RentChange>): RentChange => ({
    leaseId: 'L1',
    leaseName: 'Studio',
    at: 10,
    reason: 'edit',
    oldTotal: 1000,
    newPrice: 1100,
    newTotal: 1100,
    ...over,
  });

  it('keeps only real edits and revisions, newest first', () => {
    const list = recentRentChanges([
      change({ at: 1, reason: 'baseline' }),
      change({ at: 2 }),
      change({ at: 3, reason: 'revision' }),
      change({ at: 4, newTotal: 1000 }),
    ]);
    expect(list.map((c) => c.at)).toEqual([3, 2]);
  });

  it('starts the history at the first real row, baseline sends aside', () => {
    expect(historyStart([send({ source: 'baseline', sentAt: 1 })], [])).toBeNull();
    expect(historyStart([send({ sentAt: 50 })], [change({ at: 20 })])).toBe(20);
  });
});

describe('nextAction', () => {
  const unsent = lease();
  const sentForDec = lease({ lastSentPeriod: '2026-12', lastSentPeriodAt: 5, lastSendDate: 5 });

  it('says nothing without leases', () => {
    expect(nextAction([], new Date(2026, 10, 10))).toBeNull();
  });

  it('before the 25th: the date of the next calls and the e-mail reminder', () => {
    const action = nextAction([holder([unsent])], new Date(2026, 10, 10))!;
    expect(action.tone).toBe('info');
    expect(action.text).toBe(
      'Prochaine étape : envoyer les appels de décembre 2026 le 25 novembre. Un rappel vous sera envoyé par e-mail.',
    );
    expect(action.link?.path).toBe('/appels');
  });

  it('from the 25th, while calls are not sent: to do now', () => {
    const action = nextAction(
      [holder([unsent, lease({ objectId: 'L2' })])],
      new Date(2026, 10, 26),
    )!;
    expect(action.tone).toBe('todo');
    expect(action.text).toContain('envoyer 2 appels de loyer de décembre 2026');
  });

  it('all sent: points to the next month', () => {
    const action = nextAction([holder([sentForDec])], new Date(2026, 10, 27))!;
    expect(action.text).toBe(
      'Tous les appels de décembre 2026 sont envoyés. Prochaine étape : les appels de janvier 2027, le 25 décembre.',
    );
  });

  it('a revision before the next calls comes first, with a link to the lease', () => {
    const revising = lease({
      objectId: 'L9',
      name: 'Lot 15',
      renewalDate: new Date(2021, 10, 20).getTime(),
      indexType: 'ILAT',
    });
    const action = nextAction([holder([revising], 'H7')], new Date(2026, 10, 10))!;
    expect(action.text).toContain('révision du loyer « Lot 15 » le 20 novembre');
    expect(action.link).toEqual({
      label: 'Voir le bail',
      path: '/locataires/H7',
      fragment: 'bail-L9',
    });
  });

  it('the id changes with the sentence, so a dismissed hint comes back when the situation changes', () => {
    const before = nextAction([holder([unsent])], new Date(2026, 10, 26))!;
    const after = nextAction(
      [holder([unsent, lease({ objectId: 'L2' })])],
      new Date(2026, 10, 26),
    )!;
    expect(before.id).not.toBe(after.id);
  });
});
