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
const MAR_2027: BillingPeriod = { year: 2027, month: 3 };
const APR_2027: BillingPeriod = { year: 2027, month: 4 };

/** Local timestamp: month is 1-12. */
function at(year: number, month: number, day: number, hours = 0, minutes = 0): number {
  return new Date(year, month - 1, day, hours, minutes).getTime();
}

describe('isSentForPeriod', () => {
  describe('from lastSentPeriod', () => {
    it('is sent when lastSentPeriod is the billing period', () => {
      expect(isSentForPeriod(lease({ lastSentPeriod: '2026-12' }), DEC_2026)).toBe(true);
    });

    it('is not sent when lastSentPeriod is an earlier period and there is no send date', () => {
      expect(isSentForPeriod(lease({ lastSentPeriod: '2026-11' }), DEC_2026)).toBe(false);
      expect(isSentForPeriod(lease({ lastSentPeriod: '2025-12' }), DEC_2026)).toBe(false);
    });

    it('a period recorded after p means p was sent first (send-ahead)', () => {
      expect(isSentForPeriod(lease({ lastSentPeriod: '2027-01' }), DEC_2026)).toBe(true);
      expect(isSentForPeriod(lease({ lastSentPeriod: '2027-03' }), FEB_2027)).toBe(true);
    });

    it('ignores a malformed lastSentPeriod', () => {
      expect(isSentForPeriod(lease({ lastSentPeriod: 'oops' }), DEC_2026)).toBe(false);
      expect(isSentForPeriod(lease({ lastSentPeriod: '' }), DEC_2026)).toBe(false);
      expect(isSentForPeriod(lease({ lastSentPeriod: '2027-1' }), DEC_2026)).toBe(false);
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

/**
 * Sends recorded by the new app write lastSentPeriod, lastSendDate and lastSentPeriodAt (equal to
 * lastSendDate) in one save; the legacy app only rewrites lastSendDate.
 */
function sentByNewApp(period: string, sentAt: number, overrides: Partial<Lease> = {}): Lease {
  return lease({
    lastSentPeriod: period,
    lastSendDate: sentAt,
    lastSentPeriodAt: sentAt,
    ...overrides,
  });
}

describe('isSentForPeriod with lastSentPeriodAt (scenarios S1 to S6)', () => {
  it('S1 on-time send: the January call sent on 25 Dec 2026 is sent for January, Feb is to do', () => {
    const l = sentByNewApp('2027-01', at(2026, 12, 25));

    expect(isSentForPeriod(l, JAN_2027)).toBe(true);
    expect(isSentForPeriod(l, FEB_2027)).toBe(false);
  });

  it('S2 late send: the January call sent on 3 Jan 2027 does not hide February', () => {
    const l = sentByNewApp('2027-01', at(2027, 1, 3));

    expect(isSentForPeriod(l, JAN_2027)).toBe(true);
    expect(isSentForPeriod(l, FEB_2027)).toBe(false);
  });

  it('S3 correction re-send: the January call re-sent on 12 Jan 2027 does not hide February', () => {
    const l = sentByNewApp('2027-01', at(2027, 1, 12));

    expect(isSentForPeriod(l, JAN_2027)).toBe(true);
    expect(isSentForPeriod(l, FEB_2027)).toBe(false);
  });

  it('S4 early send: the February call sent on 5 Jan 2027 is sent for February, March is to do', () => {
    const l = sentByNewApp('2027-02', at(2027, 1, 5));

    expect(isSentForPeriod(l, FEB_2027)).toBe(true);
    expect(isSentForPeriod(l, MAR_2027)).toBe(false);
  });

  it('S5 legacy send after a new-app send: the stale lastSentPeriod does not hide the December call already sent', () => {
    // The new app sent November on 25 Oct; the legacy app then sent December on 25 Nov and only
    // rewrote lastSendDate: lastSentPeriodAt no longer equals it.
    const l = lease({
      lastSentPeriod: '2026-11',
      lastSentPeriodAt: at(2026, 10, 25),
      lastSendDate: at(2026, 11, 25),
    });

    expect(isSentForPeriod(l, NOV_2026)).toBe(true);
    expect(isSentForPeriod(l, DEC_2026)).toBe(true);
    expect(isSentForPeriod(l, JAN_2027)).toBe(false);
  });

  it('S6 send-ahead: February then March sent on 26 Jan 2027, both are sent, April is to do', () => {
    // After the second send the lease records March, with the same timestamp.
    const l = sentByNewApp('2027-03', at(2027, 1, 26));

    expect(isSentForPeriod(l, FEB_2027)).toBe(true);
    expect(isSentForPeriod(l, MAR_2027)).toBe(true);
    expect(isSentForPeriod(l, APR_2027)).toBe(false);
  });

  it('a lease with lastSentPeriod but no lastSentPeriodAt falls back on the date rule', () => {
    const l = lease({ lastSentPeriod: '2027-01', lastSendDate: at(2027, 1, 3) });

    expect(isSentForPeriod(l, JAN_2027)).toBe(true);
    expect(isSentForPeriod(l, FEB_2027)).toBe(true);
    expect(isSentForPeriod(l, MAR_2027)).toBe(false);
  });

  it('a lastSentPeriodAt without lastSentPeriod does not block the date fallback', () => {
    const l = lease({ lastSentPeriodAt: at(2026, 10, 25), lastSendDate: at(2026, 10, 25) });

    expect(isSentForPeriod(l, NOV_2026)).toBe(true);
    expect(isSentForPeriod(l, DEC_2026)).toBe(false);
  });

  it('year rollover: a December 2026 send for January, then February, and a legacy send in January', () => {
    const newApp = sentByNewApp('2027-01', at(2026, 12, 25));
    expect(isSentForPeriod(newApp, JAN_2027)).toBe(true);
    expect(isSentForPeriod(newApp, FEB_2027)).toBe(false);

    // A legacy send on 25 Jan for February after that new-app send.
    const legacyAfter = lease({
      lastSentPeriod: '2027-01',
      lastSentPeriodAt: at(2026, 12, 25),
      lastSendDate: at(2027, 1, 25),
    });
    expect(isSentForPeriod(legacyAfter, FEB_2027)).toBe(true);
    expect(isSentForPeriod(legacyAfter, MAR_2027)).toBe(false);
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
