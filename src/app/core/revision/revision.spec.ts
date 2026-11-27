import { Lease } from '../models/lease';
import {
  INSEE_SERIES,
  REMINDER_DAYS_BEFORE,
  appliedRevision,
  nextAnniversary,
  probablePublication,
  proposeRent,
  revisionState,
  targetQuarter,
  toInseePeriod,
} from './revision';

/** Fictitious lease: ILAT, rent 1091.08, reference 2025-T2 = 133.69, anniversary on 1 March 2026. */
function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    objectId: 'l1',
    isPro: true,
    name: 'Commerce',
    lot: null,
    streetNumber: 1,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'Ville-Test',
    price: 1091.08,
    charge: null,
    additionalCharges: [],
    lastSendDate: 0,
    renewalDate: new Date(2026, 2, 1).getTime(),
    indexType: 'ILAT',
    referenceIndexQuarter: '2025-T2',
    referenceIndexValue: 133.69,
    ...overrides,
  };
}

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const ymd = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()];
const OBS = new Map([['2026-Q2', 136.42]]);

describe('constants', () => {
  it('uses the INSEE series of the spec and a 45-day reminder', () => {
    expect(REMINDER_DAYS_BEFORE).toBe(45);
    expect(INSEE_SERIES).toEqual({ IRL: '001515333', ILC: '001532540', ILAT: '001617112' });
  });
});

describe('proposeRent', () => {
  it('applies the index ratio and rounds to the cent', () => {
    expect(proposeRent(1091.08, 133.69, 136.42)).toBe(1113.36);
    expect(proposeRent(600, 145.47, 145.47)).toBe(600);
  });
});

describe('quarters', () => {
  it('targets the same quarter one year later', () => {
    expect(targetQuarter('2025-T2')).toBe('2026-T2');
    expect(targetQuarter('2025-T4')).toBe('2026-T4');
  });

  it('maps a lease quarter to the INSEE period', () => {
    expect(toInseePeriod('2026-T2')).toBe('2026-Q2');
    expect(toInseePeriod('2025-T4')).toBe('2025-Q4');
  });

  it('refuses a malformed quarter', () => {
    expect(() => targetQuarter('2025-Q2')).toThrow();
    expect(() => toInseePeriod('T2 2026')).toThrow();
    expect(() => probablePublication('IRL', '2026-T5')).toThrow();
  });
});

describe('probablePublication', () => {
  it('IRL: the 15th of the month after the quarter end', () => {
    expect(ymd(probablePublication('IRL', '2026-T2'))).toEqual([2026, 7, 15]);
    expect(ymd(probablePublication('IRL', '2026-T4'))).toEqual([2027, 1, 15]);
  });

  it('ILC and ILAT: the last day of the 3rd month after the quarter end', () => {
    expect(ymd(probablePublication('ILAT', '2026-T2'))).toEqual([2026, 9, 30]);
    expect(ymd(probablePublication('ILC', '2026-T3'))).toEqual([2026, 12, 31]);
    expect(ymd(probablePublication('ILC', '2026-T4'))).toEqual([2027, 3, 31]);
    expect(ymd(probablePublication('ILAT', '2027-T1'))).toEqual([2027, 6, 30]);
  });
});

describe('nextAnniversary', () => {
  it('returns a date still ahead as it is, as a local calendar date', () => {
    const renewal = new Date(2026, 2, 1, 15, 30).getTime();
    expect(ymd(nextAnniversary(renewal, day(2026, 1, 15)))).toEqual([2026, 3, 1]);
    expect(nextAnniversary(renewal, day(2026, 1, 15)).getHours()).toBe(0);
  });

  it('keeps today itself', () => {
    expect(ymd(nextAnniversary(day(2026, 3, 1).getTime(), new Date(2026, 2, 1, 18, 0)))).toEqual([
      2026, 3, 1,
    ]);
  });

  it('rolls a past date forward to its first occurrence from today', () => {
    expect(ymd(nextAnniversary(day(2024, 3, 1).getTime(), day(2026, 1, 15)))).toEqual([2026, 3, 1]);
    expect(ymd(nextAnniversary(day(2024, 3, 1).getTime(), day(2026, 3, 2)))).toEqual([2027, 3, 1]);
  });

  it('rolls over the year end', () => {
    expect(ymd(nextAnniversary(day(2026, 1, 5).getTime(), day(2026, 12, 20)))).toEqual([
      2027, 1, 5,
    ]);
  });

  it('puts a 29 February on the 28th in common years and keeps it in leap years', () => {
    const renewal = day(2028, 2, 29).getTime();
    expect(ymd(nextAnniversary(renewal, day(2029, 1, 1)))).toEqual([2029, 2, 28]);
    expect(ymd(nextAnniversary(renewal, day(2032, 1, 1)))).toEqual([2032, 2, 29]);
  });
});

describe('revisionState', () => {
  it('is upcoming 45 days before the anniversary, with the proposal when the index is published', () => {
    const state = revisionState(lease(), day(2026, 1, 15), OBS);
    expect(state).toMatchObject({
      kind: 'upcoming',
      days: 45,
      targetQuarter: '2026-T2',
      newIndex: 136.42,
      proposedRent: 1113.36,
    });
    if (state.kind === 'upcoming') {
      expect(ymd(state.anniversary)).toEqual([2026, 3, 1]);
      expect(state.publication).toBeUndefined();
    }
  });

  it('is none one day earlier', () => {
    expect(revisionState(lease(), day(2026, 1, 14), OBS)).toEqual({ kind: 'none' });
  });

  it('counts calendar days, across a daylight-saving change', () => {
    const state = revisionState(
      lease({ renewalDate: day(2026, 3, 30).getTime() }),
      day(2026, 3, 1),
      OBS,
    );
    expect(state).toMatchObject({ kind: 'upcoming', days: 29 });
  });

  it('is upcoming on the day itself (0 days)', () => {
    expect(revisionState(lease(), day(2026, 3, 1), OBS)).toMatchObject({
      kind: 'upcoming',
      days: 0,
    });
  });

  it('gives the probable publication when the target quarter is not published', () => {
    for (const observations of [new Map([['2026-Q1', 135.9]]), undefined]) {
      const state = revisionState(lease(), day(2026, 2, 1), observations);
      expect(state.kind).toBe('upcoming');
      if (state.kind === 'upcoming') {
        expect(state.newIndex).toBeUndefined();
        expect(state.proposedRent).toBeUndefined();
        expect(state.publication && ymd(state.publication)).toEqual([2026, 9, 30]);
      }
    }
  });

  it('ignores a published value that is not a usable number', () => {
    const state = revisionState(lease(), day(2026, 2, 1), new Map([['2026-Q2', Number.NaN]]));
    expect(state.kind).toBe('upcoming');
    expect(state).not.toHaveProperty('newIndex');
    expect(state).not.toHaveProperty('proposedRent');
    expect(state).toHaveProperty('publication');
  });

  it('is incomplete when the anniversary, the family, the quarter or the value is missing', () => {
    const today = day(2026, 2, 1);
    expect(revisionState(lease({ renewalDate: null }), today, OBS)).toEqual({ kind: 'incomplete' });
    expect(revisionState(lease({ indexType: undefined }), today, OBS)).toEqual({
      kind: 'incomplete',
    });
    expect(revisionState(lease({ referenceIndexQuarter: undefined }), today, OBS)).toEqual({
      kind: 'incomplete',
    });
    expect(revisionState(lease({ referenceIndexValue: undefined }), today, OBS)).toEqual({
      kind: 'incomplete',
    });
  });

  it('is incomplete, never NaN or Infinity, for a rent or an index that cannot be used', () => {
    const today = day(2026, 2, 1);
    const bad: Partial<Lease>[] = [
      { price: 0 },
      { price: Number.NaN },
      { referenceIndexValue: 0 },
      { referenceIndexValue: -1 },
      { referenceIndexValue: Number.POSITIVE_INFINITY },
      { referenceIndexQuarter: '2025-Q2' },
      { renewalDate: Number.NaN },
    ];
    for (const overrides of bad) {
      expect(revisionState(lease(overrides), today, OBS)).toEqual({ kind: 'incomplete' });
    }
  });

  it('does not read the clock: the same inputs give the same answer', () => {
    expect(revisionState(lease(), day(2026, 1, 15), OBS)).toEqual(
      revisionState(lease(), day(2026, 1, 15), OBS),
    );
  });
});

describe('appliedRevision', () => {
  it('changes the rent, the reference and moves the anniversary one year on', () => {
    const state = revisionState(lease(), day(2026, 1, 15), OBS);
    const changes = appliedRevision(state);
    expect(changes).not.toBeNull();
    expect(changes).toMatchObject({
      price: 1113.36,
      referenceIndexQuarter: '2026-T2',
      referenceIndexValue: 136.42,
    });
    expect(ymd(new Date(changes!.renewalDate))).toEqual([2027, 3, 1]);
  });

  it('leaves nothing to propose right after: the state is none', () => {
    const today = day(2026, 1, 15);
    const changes = appliedRevision(revisionState(lease(), today, OBS))!;
    const applied = lease(changes);
    expect(revisionState(applied, today, OBS)).toEqual({ kind: 'none' });
    // Not even the next year's proposal, whatever is published, until the next window opens.
    expect(revisionState(applied, day(2026, 12, 1), new Map([['2027-Q2', 140]]))).toEqual({
      kind: 'none',
    });
    expect(revisionState(applied, day(2027, 1, 15), new Map([['2027-Q2', 140]]))).toMatchObject({
      kind: 'upcoming',
      targetQuarter: '2027-T2',
    });
  });

  it('moves a 29 February anniversary to the 28th of the next year', () => {
    const l = lease({ renewalDate: day(2028, 2, 29).getTime(), referenceIndexQuarter: '2027-T2' });
    const state = revisionState(l, day(2028, 1, 20), new Map([['2028-Q2', 140]]));
    const changes = appliedRevision(state)!;
    expect(ymd(new Date(changes.renewalDate))).toEqual([2029, 2, 28]);
  });

  it('rolls a late anniversary first: the new date is one year after the rolled one', () => {
    // 1 March 2025 was never advanced; on 15 January 2026 the anniversary in view is 1 March 2026.
    const l = lease({ renewalDate: day(2025, 3, 1).getTime() });
    const changes = appliedRevision(revisionState(l, day(2026, 1, 15), OBS))!;
    expect(ymd(new Date(changes.renewalDate))).toEqual([2027, 3, 1]);
  });

  it('is null when there is no proposal, or the index is not published', () => {
    expect(appliedRevision({ kind: 'none' })).toBeNull();
    expect(appliedRevision({ kind: 'incomplete' })).toBeNull();
    expect(appliedRevision(revisionState(lease(), day(2026, 2, 1), undefined))).toBeNull();
  });
});
