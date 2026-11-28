import {
  callTitle,
  billingPeriod,
  defaultCallDate,
  dueDate,
  legacyPeriodMonth,
  periodKey,
  periodLabel,
  periodLastDay,
} from './period';

/**
 * The legacy `computePeriod()` of `tab-send.page.ts` (main), kept here verbatim as the reference
 * the new functions must agree with for every call date.
 */
function legacyComputePeriod(defaultSendDate: Date): string {
  let month;
  let year;
  if (defaultSendDate.getMonth() < 11) {
    month = defaultSendDate.getMonth() + 2;
    year = defaultSendDate.getFullYear();
  } else {
    month = 1;
    year = defaultSendDate.getFullYear() + 1;
  }
  return (
    month.toLocaleString('en-US', { minimumIntegerDigits: 2, useGrouping: false }) + '/' + year
  );
}

/** The legacy `daysInNextMonth()` of `tab-send.page.ts` (main). */
function legacyDaysInNextMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate();
}

describe('defaultCallDate', () => {
  it('is the 25th of the current month at midnight, as a valid local date for every month (the Safari bug)', () => {
    for (let month = 0; month < 12; month++) {
      const date = defaultCallDate(new Date(2026, month, 1 + (month % 3), 23, 59, 59));
      expect(Number.isNaN(date.getTime())).toBe(false);
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(month);
      expect(date.getDate()).toBe(25);
      expect(date.getHours()).toBe(0);
    }
  });
});

describe('billingPeriod', () => {
  it('is the month after the call date, rolling over to January after a December call, whatever the day or hour', () => {
    expect(billingPeriod(new Date(2026, 9, 25))).toEqual({ year: 2026, month: 11 });
    expect(billingPeriod(new Date(2026, 0, 31, 23, 59, 59))).toEqual({ year: 2026, month: 2 });
    expect(billingPeriod(new Date(2026, 11, 25))).toEqual({ year: 2027, month: 1 });
    expect(billingPeriod(new Date(2026, 11, 31, 23, 59, 59))).toEqual({ year: 2027, month: 1 });
  });

  it('agrees with the legacy computePeriod() and daysInNextMonth() around the year end and a leap February', () => {
    for (const callDate of [
      new Date(2026, 10, 25),
      new Date(2026, 11, 25),
      new Date(2027, 0, 25),
      new Date(2027, 11, 25),
    ]) {
      const period = billingPeriod(callDate);

      expect(legacyPeriodMonth(period)).toBe(legacyComputePeriod(callDate));
      expect(periodLastDay(period)).toBe(legacyDaysInNextMonth(callDate));
    }
  });
});

describe('period formats', () => {
  it("are 'YYYY-MM' for the key, 'MM/YYYY' for the PDF, and the lower-case French month for the label", () => {
    expect(periodKey({ year: 2027, month: 1 })).toBe('2027-01');
    expect(legacyPeriodMonth({ year: 2027, month: 1 })).toBe('01/2027');
    expect(legacyPeriodMonth({ year: 2026, month: 12 })).toBe('12/2026');
    expect(periodLabel({ year: 2027, month: 1 })).toBe('janvier 2027');
    expect(periodLabel({ year: 2026, month: 2 })).toBe('février 2026');
    expect(periodLabel({ year: 2026, month: 8 })).toBe('août 2026');
  });
});

describe('periodLastDay', () => {
  it('handles February in leap and non-leap years, and the 30 and 31 day months', () => {
    expect(periodLastDay({ year: 2027, month: 2 })).toBe(28);
    expect(periodLastDay({ year: 2028, month: 2 })).toBe(29);
    expect(periodLastDay({ year: 2100, month: 2 })).toBe(28);
    expect(periodLastDay({ year: 2026, month: 4 })).toBe(30);
    expect(periodLastDay({ year: 2026, month: 12 })).toBe(31);
  });
});

describe('dueDate', () => {
  it('is the 1st of the billing period, as a local date', () => {
    const date = dueDate({ year: 2027, month: 1 });

    expect(date.getFullYear()).toBe(2027);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(1);
    expect(date.getHours()).toBe(0);
  });
});

describe('callTitle', () => {
  it('names the month the calls go out and the billed period', () => {
    expect(callTitle({ year: 2026, month: 12 })).toEqual({
      calls: 'Appels de novembre',
      billed: 'pour décembre 2026',
    });
    expect(callTitle({ year: 2027, month: 1 }).calls).toBe('Appels de décembre');
  });

  it('elides before a vowel: avril, août, octobre', () => {
    expect(callTitle({ year: 2027, month: 5 }).calls).toBe('Appels d’avril');
    expect(callTitle({ year: 2027, month: 9 }).calls).toBe('Appels d’août');
    expect(callTitle({ year: 2027, month: 11 }).calls).toBe('Appels d’octobre');
  });
});
