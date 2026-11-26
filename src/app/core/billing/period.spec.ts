import {
  BillingPeriod,
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
  it('is the 25th of the current month, as a valid local date', () => {
    const date = defaultCallDate(new Date(2026, 0, 3));

    expect(Number.isNaN(date.getTime())).toBe(false);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(25);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });

  it('is valid for every month of the year (no string-built "2026-1-25", the Safari bug)', () => {
    for (let month = 0; month < 12; month++) {
      const date = defaultCallDate(new Date(2026, month, 1));
      expect(Number.isNaN(date.getTime())).toBe(false);
      expect(date.getMonth()).toBe(month);
      expect(date.getDate()).toBe(25);
    }
  });

  it('ignores the time of day and the day of the month of `now`', () => {
    const date = defaultCallDate(new Date(2026, 11, 31, 23, 59, 59));

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(11);
    expect(date.getDate()).toBe(25);
  });
});

describe('billingPeriod', () => {
  it('is the month after the call date', () => {
    expect(billingPeriod(new Date(2026, 9, 25))).toEqual({ year: 2026, month: 11 });
    expect(billingPeriod(new Date(2026, 0, 25))).toEqual({ year: 2026, month: 2 });
  });

  it('rolls over to January of the next year after a December call', () => {
    expect(billingPeriod(new Date(2026, 11, 25))).toEqual({ year: 2027, month: 1 });
  });

  it('only looks at the local month of the call date, whatever the day or the hour', () => {
    expect(billingPeriod(new Date(2026, 0, 1, 0, 0, 0))).toEqual({ year: 2026, month: 2 });
    expect(billingPeriod(new Date(2026, 0, 31, 23, 59, 59))).toEqual({ year: 2026, month: 2 });
    expect(billingPeriod(new Date(2026, 11, 31, 23, 59, 59))).toEqual({ year: 2027, month: 1 });
  });

  it('agrees with the legacy computePeriod() and daysInNextMonth() for every call date', () => {
    for (let year = 2025; year <= 2030; year++) {
      for (let month = 0; month < 12; month++) {
        const callDate = new Date(year, month, 25);
        const period = billingPeriod(callDate);

        expect(legacyPeriodMonth(period)).toBe(legacyComputePeriod(callDate));
        expect(periodLastDay(period)).toBe(legacyDaysInNextMonth(callDate));
      }
    }
  });
});

describe('periodKey', () => {
  it("is 'YYYY-MM', zero-padded", () => {
    expect(periodKey({ year: 2027, month: 1 })).toBe('2027-01');
    expect(periodKey({ year: 2026, month: 9 })).toBe('2026-09');
    expect(periodKey({ year: 2026, month: 12 })).toBe('2026-12');
  });
});

describe('legacyPeriodMonth', () => {
  it("is 'MM/YYYY', zero-padded (used by the PDF and the file names)", () => {
    expect(legacyPeriodMonth({ year: 2027, month: 1 })).toBe('01/2027');
    expect(legacyPeriodMonth({ year: 2026, month: 11 })).toBe('11/2026');
    expect(legacyPeriodMonth({ year: 2026, month: 12 })).toBe('12/2026');
  });
});

describe('periodLabel', () => {
  it("is the lower-case French month and the year, e.g. 'janvier 2027'", () => {
    expect(periodLabel({ year: 2027, month: 1 })).toBe('janvier 2027');
  });

  it('names the twelve months', () => {
    const months = [
      'janvier',
      'février',
      'mars',
      'avril',
      'mai',
      'juin',
      'juillet',
      'août',
      'septembre',
      'octobre',
      'novembre',
      'décembre',
    ];

    months.forEach((name, index) => {
      expect(periodLabel({ year: 2026, month: index + 1 })).toBe(`${name} 2026`);
    });
  });
});

describe('periodLastDay', () => {
  it('handles February in leap and non-leap years', () => {
    expect(periodLastDay({ year: 2027, month: 2 })).toBe(28);
    expect(periodLastDay({ year: 2028, month: 2 })).toBe(29);
    expect(periodLastDay({ year: 2100, month: 2 })).toBe(28);
    expect(periodLastDay({ year: 2000, month: 2 })).toBe(29);
  });

  it('knows the 30 and 31 day months, including December', () => {
    expect(periodLastDay({ year: 2026, month: 4 })).toBe(30);
    expect(periodLastDay({ year: 2026, month: 11 })).toBe(30);
    expect(periodLastDay({ year: 2026, month: 1 })).toBe(31);
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
    expect(date.getMinutes()).toBe(0);
  });

  it('is valid and on the 1st for every month', () => {
    for (let month = 1; month <= 12; month++) {
      const period: BillingPeriod = { year: 2026, month };
      const date = dueDate(period);

      expect(Number.isNaN(date.getTime())).toBe(false);
      expect(date.getMonth()).toBe(month - 1);
      expect(date.getDate()).toBe(1);
    }
  });
});
