import { Lease } from '../models/lease';
import { BillingPeriod } from './period';
import { isSentForPeriod, leaseStatus } from './send-status';

function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    isPro: true,
    name: 'Bail test',
    lot: null,
    streetNumber: 1,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'La Ciotat',
    price: 1000,
    charge: null,
    additionalCharges: [],
    lastSendDate: 0,
    renewalDate: null,
    ...overrides,
  };
}

const NOV_2026: BillingPeriod = { year: 2026, month: 11 };
const DEC_2026: BillingPeriod = { year: 2026, month: 12 };
const JAN_2027: BillingPeriod = { year: 2027, month: 1 };
const FEB_2027: BillingPeriod = { year: 2027, month: 2 };

/** Local timestamp: month is 1-12. */
function at(year: number, month: number, day: number, hours = 0, minutes = 0): number {
  return new Date(year, month - 1, day, hours, minutes).getTime();
}

describe('isSentForPeriod', () => {
  describe('from lastSentPeriod', () => {
    it('is sent when lastSentPeriod is the billing period', () => {
      expect(isSentForPeriod(lease({ lastSentPeriod: '2026-12' }), DEC_2026)).toBe(true);
    });

    it('is not sent when lastSentPeriod is another period and there is no send date', () => {
      expect(isSentForPeriod(lease({ lastSentPeriod: '2026-11' }), DEC_2026)).toBe(false);
      expect(isSentForPeriod(lease({ lastSentPeriod: '2027-01' }), DEC_2026)).toBe(false);
    });

    it('year rollover: a December period alone says nothing about January', () => {
      expect(isSentForPeriod(lease({ lastSentPeriod: '2026-12' }), JAN_2027)).toBe(false);
      expect(isSentForPeriod(lease({ lastSentPeriod: '2027-01' }), JAN_2027)).toBe(true);
    });
  });

  describe('fallback on lastSendDate (leases sent by the legacy app)', () => {
    it('lastSendDate on 25 Oct 2026 without lastSentPeriod: sent for November, to do for December', () => {
      const l = lease({ lastSendDate: at(2026, 10, 25) });

      expect(isSentForPeriod(l, NOV_2026)).toBe(true);
      expect(isSentForPeriod(l, DEC_2026)).toBe(false);
    });

    it('never sent (lastSendDate 0) is to do', () => {
      expect(isSentForPeriod(lease({ lastSendDate: 0 }), DEC_2026)).toBe(false);
      expect(isSentForPeriod(lease({ lastSendDate: 0 }), JAN_2027)).toBe(false);
    });

    it('a send in the same month as the period is not the month preceding it', () => {
      const l = lease({ lastSendDate: at(2027, 1, 25) });

      expect(isSentForPeriod(l, JAN_2027)).toBe(false);
      expect(isSentForPeriod(l, FEB_2027)).toBe(true);
    });

    it('year rollover: a send on 25 Dec 2026 covers January 2027', () => {
      expect(isSentForPeriod(lease({ lastSendDate: at(2026, 12, 25) }), JAN_2027)).toBe(true);
      expect(isSentForPeriod(lease({ lastSendDate: at(2026, 12, 25) }), DEC_2026)).toBe(false);
    });

    it('a send long before the previous month is to do', () => {
      expect(isSentForPeriod(lease({ lastSendDate: at(2026, 9, 25) }), DEC_2026)).toBe(false);
      expect(isSentForPeriod(lease({ lastSendDate: at(2025, 11, 25) }), DEC_2026)).toBe(false);
    });

    it('a send in a later month than the period does not count', () => {
      expect(isSentForPeriod(lease({ lastSendDate: at(2027, 3, 25) }), DEC_2026)).toBe(false);
    });

    it('uses local calendar-month boundaries', () => {
      // Period February 2027: the preceding month is January 2027.
      expect(isSentForPeriod(lease({ lastSendDate: at(2027, 1, 1, 0, 0) }), FEB_2027)).toBe(true);
      expect(isSentForPeriod(lease({ lastSendDate: at(2027, 1, 31, 23, 59) }), FEB_2027)).toBe(
        true,
      );
      expect(isSentForPeriod(lease({ lastSendDate: at(2026, 12, 31, 23, 59) }), FEB_2027)).toBe(
        false,
      );
      expect(isSentForPeriod(lease({ lastSendDate: at(2027, 2, 1, 0, 0) }), FEB_2027)).toBe(false);
    });

    it('ignores a nonsensical lastSendDate (negative or NaN)', () => {
      expect(isSentForPeriod(lease({ lastSendDate: -1 }), DEC_2026)).toBe(false);
      expect(isSentForPeriod(lease({ lastSendDate: Number.NaN }), DEC_2026)).toBe(false);
    });
  });

  describe('stale lastSentPeriod after a legacy send', () => {
    it('lastSentPeriod 2026-11 with a legacy send on 25 Nov 2026 is sent for December (no double send)', () => {
      const l = lease({ lastSentPeriod: '2026-11', lastSendDate: at(2026, 11, 25) });

      expect(isSentForPeriod(l, DEC_2026)).toBe(true);
    });

    it('is still sent for its own period, and to do for the following one', () => {
      const l = lease({ lastSentPeriod: '2026-11', lastSendDate: at(2026, 11, 25) });

      expect(isSentForPeriod(l, NOV_2026)).toBe(true);
      expect(isSentForPeriod(l, JAN_2027)).toBe(false);
    });
  });
});

describe('leaseStatus', () => {
  it("is 'sent' when the period has been sent and 'todo' otherwise", () => {
    expect(leaseStatus(lease({ lastSentPeriod: '2026-12' }), DEC_2026)).toBe('sent');
    expect(leaseStatus(lease({ lastSendDate: at(2026, 10, 25) }), NOV_2026)).toBe('sent');
    expect(leaseStatus(lease({ lastSendDate: at(2026, 10, 25) }), DEC_2026)).toBe('todo');
    expect(leaseStatus(lease(), DEC_2026)).toBe('todo');
  });
});
